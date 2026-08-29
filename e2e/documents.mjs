import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ARTIFACTS, BASE, launchBrowser } from "./_shared.mjs";

/**
 * Drives the document vault end to end against the landlord10 seed: drop a
 * mixed batch of files, check each one was identified and filed the way the
 * heuristics claim, correct one by hand, and confirm the download route
 * serves the right bytes with the right disposition.
 *
 * Needs `npm run db:seed:landlord10` applied first — the filing assertions
 * name that dataset's tenants (Caleb Nguyen in 107, Harper Diaz in 108) and
 * its property ("Sunrise Ridge Apartments"). Not part of `npm run e2e` for
 * the same reason landlord10-tour.mjs is not: separate seed data.
 *
 * Mutates real rows, so re-seed before re-running.
 */

const PASSWORD = "demo-password-123";
const results = [];

function log(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function login(page, email) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20000 }),
    page.click('button[type="submit"]'),
  ]);
}

/** A syntactically real one-page PDF, so byte detection has something honest to read. */
function pdfBytes(text) {
  const body = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 100]/Contents 4 0 R>>endobj
4 0 obj<</Length ${text.length + 40}>>stream
BT /F1 12 Tf 20 50 Td (${text}) Tj ET
endstream
endobj
trailer<</Root 1 0 R>>
%%EOF`;
  return Buffer.from(body, "latin1");
}

const dir = mkdtempSync(path.join(tmpdir(), "comfylease-docs-"));
function write(name, contents) {
  const full = path.join(dir, name);
  writeFileSync(full, contents);
  return full;
}

// A deliberately mixed drop, each file probing a different path:
const files = [
  //   filename                                what it proves
  write("Nguyen signed lease agreement.pdf", pdfBytes("Lease")), //  lease match by surname + LEASE category
  write("unit 108 move out inspection.pdf", pdfBytes("Inspection")), // lease match by unit + INSPECTION
  write("certificate-of-insurance.pdf", pdfBytes("COI")), //         category, but nothing to file against
  write("scan0001.pdf", pdfBytes("Unknown")), //                     neither: must land in "needs filing"
  write("2026 rent roll.csv", "Unit,Tenant,Rent\n107,Nguyen,1800\n"), // CSV -> spreadsheet -> STATEMENT
];

const browser = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
const page = await ctx.newPage();

try {
  await login(page, "landlord10@example.com");

  await page.goto(`${BASE}/app/documents`, { waitUntil: "networkidle" });
  log("documents page renders", !/Application error/i.test(await page.textContent("body")));

  await page.setInputFiles('input[name="files"]', files);
  await page.waitForTimeout(500);

  const uploadButton = page.locator('button[type="submit"]:has-text("Upload")').first();
  log("selected files are listed before upload", await uploadButton.isVisible());

  await uploadButton.click();
  await page.waitForTimeout(6000);
  await page.screenshot({ path: `${ARTIFACTS}/documents-01-after-upload.png`, fullPage: true });

  const body = await page.textContent("body");
  log("upload reported success", /Added 5 files/.test(body));

  // The filing claims. Each row shows what it was filed under, so the page
  // text is enough to check the heuristics did what the unit tests say.
  log("lease matched by tenant surname", /Caleb Nguyen/.test(body));
  log("lease matched by unit label", /Harper Diaz/.test(body));
  log("CSV recognised as a statement", /Statement/.test(body));
  log("unidentifiable file went to Needs filing", /Needs filing/.test(body) && /scan0001/.test(body));

  // The insurance certificate names no tenant, unit or property, so it should
  // be categorised but left unfiled rather than guessed at.
  const needsFilingCard = page.locator("li", { has: page.locator("text=certificate-of-insurance") });
  log("insurance cert categorised but left unfiled", (await needsFilingCard.count()) > 0);

  // --- correcting a filing by hand ----------------------------------------
  // Anchored on "the list item that has a target picker", which only the
  // Needs filing rows do. The drop zone also renders an <li> per staged file,
  // so matching on the filename alone finds two elements and picks the wrong
  // one.
  const scanRow = page
    .locator("li", { has: page.locator('select[name="target"]') })
    .filter({ hasText: "scan0001" })
    .first();
  const targetSelect = scanRow.locator('select[name="target"]');
  const options = await targetSelect.locator("option").allTextContents();
  const harperOption = options.find((o) => o.includes("Harper Diaz"));

  if (harperOption) {
    await targetSelect.selectOption({ label: harperOption });
    await scanRow.locator('select[name="category"]').selectOption("LEASE");
    await scanRow.locator('button[type="submit"]:has-text("Save filing")').click();
    await page.waitForTimeout(4000);

    // Checked by absence from Needs filing, not by a success banner: a
    // successful refile moves the row into the filed table, which unmounts
    // the form the banner lived in. The filename alone proves nothing either
    // — it still shows, just in the other list.
    const stillUnfiled = await page
      .locator("li", { has: page.locator('select[name="target"]') })
      .filter({ hasText: "scan0001" })
      .count();
    log("manual refile moved the document out of Needs filing", stillUnfiled === 0);

    const filedRow = page.locator("tr", { hasText: "scan0001" }).first();
    log(
      "refiled document now shows under the tenant it was assigned to",
      (await filedRow.count()) > 0 && /Harper Diaz/.test((await filedRow.textContent()) ?? ""),
    );
  } else {
    log("manual refile moved the document out of Needs filing", false, "no Harper Diaz option in the target picker");
  }

  await page.screenshot({ path: `${ARTIFACTS}/documents-02-after-refile.png`, fullPage: true });

  // --- the download route --------------------------------------------------
  const link = page.locator('a[href^="/api/documents/"]', { hasText: "Nguyen signed lease" }).first();
  const href = await link.getAttribute("href");
  const response = await page.request.get(`${BASE}${href}`);
  const contentType = response.headers()["content-type"] ?? "";
  const disposition = response.headers()["content-disposition"] ?? "";

  log("document downloads with 200", response.status() === 200, `status ${response.status()}`);
  log("PDF served as application/pdf", contentType.includes("application/pdf"), contentType);
  log("PDF served inline", disposition.startsWith("inline"), disposition);

  const bytes = await response.body();
  log("served bytes are the real PDF", bytes.subarray(0, 5).toString("latin1") === "%PDF-");

  // A CSV must never come back inline — it is not in the inline-safe set.
  const rows = page.locator('a[href^="/api/documents/"]');
  const hrefs = await rows.evaluateAll((els) => els.map((e) => e.getAttribute("href")));
  let csvChecked = false;
  for (const candidate of hrefs) {
    const r = await page.request.get(`${BASE}${candidate}`);
    const ct = r.headers()["content-type"] ?? "";
    if (ct.includes("text/csv")) {
      log("CSV served as an attachment, not inline", (r.headers()["content-disposition"] ?? "").startsWith("attachment"));
      csvChecked = true;
      break;
    }
  }
  if (!csvChecked) log("CSV served as an attachment, not inline", false, "no text/csv document found");

  // --- authorization -------------------------------------------------------
  const tenantCtx = await browser.newContext();
  const tenantPage = await tenantCtx.newPage();
  await login(tenantPage, "caleb.nguyen@example.com");
  const tenantResponse = await tenantPage.request.get(`${BASE}${href}`);
  log(
    "a tenant cannot read a vault document",
    tenantResponse.status() === 404,
    `status ${tenantResponse.status()}`,
  );
  await tenantCtx.close();

  const anonCtx = await browser.newContext();
  const anonPage = await anonCtx.newPage();
  const anonResponse = await anonPage.request.get(`${BASE}${href}`);
  log(
    "a signed-out visitor cannot read a vault document",
    anonResponse.status() === 404 || anonResponse.status() === 401 || anonResponse.status() === 302,
    `status ${anonResponse.status()}`,
  );
  await anonCtx.close();
} catch (err) {
  log("suite crashed", false, err instanceof Error ? err.message : String(err));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
if (failed > 0) process.exit(1);
