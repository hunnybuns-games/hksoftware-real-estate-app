import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ARTIFACTS, BASE, launchBrowser } from "./_shared.mjs";

/**
 * Drives the portfolio importer against the landlord10 seed: upload a rent
 * roll that deliberately mixes clean rows with the messy realities (a tenant
 * who already exists, a unit that is already leased, a missing email, a
 * duplicate row, a bad date), confirm the preview classifies each correctly,
 * import, and check the records that came out the other side.
 *
 * Needs `npm run db:seed:landlord10` applied first. Mutates real rows — it
 * creates a second property — so re-seed before re-running.
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

// Headers chosen to look like a real export rather than this app's own
// vocabulary — including "St" for state, which is exactly the abbreviation
// that must not be allowed to swallow "Lease Start".
const csv = [
  "Building,Unit #,Resident Name,Email Address,Phone,City,St,Zip,Monthly Rent,Security Deposit,Lease Start,Lease End",
  // Clean rows for a brand-new property.
  "Cedar Court Duplex,A,\"Alvarez, Mia\",mia.alvarez@example.com,208-555-2001,Boise,ID,83702,1250.00,1250.00,2026-01-15,2027-01-14",
  "Cedar Court Duplex,B,Owen Fitzgerald,owen.f@example.com,208-555-2002,Boise,ID,83702,1300.00,1300.00,2/1/2026,1/31/27",
  // No email at all -> placeholder, imported with a warning.
  "Cedar Court Duplex,C,Rosa Lindqvist,,208-555-2003,Boise,ID,83702,1195.00,,2026-03-01,",
  // Same unit as row 1 -> the second occurrence must be blocked.
  "Cedar Court Duplex,A,Duplicate Person,dupe@example.com,,Boise,ID,83702,1250.00,,2026-01-15,",
  // A unit that already has a live lease in the seed -> blocked, not merged.
  "Sunrise Ridge Apartments,107,Someone New,someone.new@example.com,,Boise,ID,83702,1800.00,,2026-01-01,",
  // Clean and importable, but unticked below: proves the checkbox excludes.
  "Cedar Court Duplex,E,Skip Me,skip.me@example.com,,Boise,ID,83702,1400.00,,2026-04-01,",
  // Unreadable lease start -> blocked with a reason.
  "Cedar Court Duplex,D,Bad Date,bad.date@example.com,,Boise,ID,83702,1100.00,,not-a-date,",
].join("\n");

const dir = mkdtempSync(path.join(tmpdir(), "rentroll-"));
const csvPath = path.join(dir, "2026 rent roll.csv");
writeFileSync(csvPath, csv);

const browser = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1200 } });
const page = await ctx.newPage();

try {
  await login(page, "landlord10@example.com");

  // Asserted on the HTTP status, not on the absence of an error string: a
  // dev-mode 500 renders a page that contains neither the word "error" nor
  // the form, so a text check quietly passes while nothing works.
  const landing = await page.goto(`${BASE}/app/import`, { waitUntil: "networkidle" });
  log("import page renders", landing.status() === 200, `status ${landing.status()}`);

  await page.setInputFiles('input[name="file"]', csvPath);
  await Promise.all([
    page.waitForURL(/\/app\/import\/[a-z0-9]+$/, { timeout: 20000 }),
    page.locator('button[type="submit"]:has-text("Continue")').click(),
  ]);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${ARTIFACTS}/portfolio-01-preview.png`, fullPage: true });

  const body = await page.textContent("body");

  // Column auto-detection, including the "St" vs "Lease Start" trap.
  const startSelect = page.locator('select[name="leaseStart"]');
  log(
    "lease start column auto-detected (not swallowed by the State column)",
    (await startSelect.inputValue()) === "Lease Start",
    await startSelect.inputValue(),
  );
  log(
    "state column auto-detected",
    (await page.locator('select[name="state"]').inputValue()) === "St",
  );
  log(
    "tenant name and email mapped to different columns",
    (await page.locator('select[name="tenantName"]').inputValue()) === "Resident Name" &&
      (await page.locator('select[name="tenantEmail"]').inputValue()) === "Email Address",
  );

  // The plan.
  log("preview blocks the duplicate and already-leased rows", /3\s*$|Blocked rows/.test(body));
  log("preview warns about the missing email", /no email address|placeholder/i.test(body));
  log("preview flags the unreadable date", /Could not read a lease start date/i.test(body));
  log("preview flags the already-leased unit", /already has an active lease/i.test(body));
  log("preview flags the in-file duplicate", /lists the same unit more than once/i.test(body));
  log("preview marks the existing property as Existing", /Existing/.test(body));

  // The checkbox must mean what its column header says. An importable row
  // is ticked; a blocked one is not. (These were inverted once — the good
  // rows showed unticked, so ticking them would have skipped everything.)
  const skipRow = page.locator("tr", { hasText: "Skip Me" }).first();
  const skipBox = skipRow.locator('input[type="checkbox"]');
  log("importable rows are ticked by default", await skipBox.isChecked());
  const blockedBox = page.locator("tr", { hasText: "Someone New" }).first().locator('input[type="checkbox"]');
  log("blocked rows are unticked and disabled", !(await blockedBox.isChecked()) && (await blockedBox.isDisabled()));
  await skipBox.uncheck();

  // Import.
  await page.locator('button[type="submit"]:has-text("Import these rows")').click();
  await page.waitForTimeout(6000);
  await page.screenshot({ path: `${ARTIFACTS}/portfolio-02-imported.png`, fullPage: true });
  const after = await page.textContent("body");
  log("import reported success", /Imported 3 leases|Already imported/i.test(after));

  // What actually landed.
  await page.goto(`${BASE}/app/properties`, { waitUntil: "networkidle" });
  const props = await page.textContent("body");
  log("new property created", /Cedar Court Duplex/.test(props));

  await page.goto(`${BASE}/app/tenants`, { waitUntil: "networkidle" });
  const tenants = await page.textContent("body");
  log("tenant with a comma-formatted name split correctly", /Mia\s+Alvarez/.test(tenants));
  log("tenant with a plain name imported", /Owen\s+Fitzgerald/.test(tenants));
  log("tenant with no email still imported", /Rosa\s+Lindqvist/.test(tenants));
  log("blocked rows did not create tenants", !/Duplicate Person/.test(tenants) && !/Someone New/.test(tenants));
  log("an unticked row was not imported", !/Skip Me/.test(tenants));
  log("row with the bad date did not create a tenant", !/Bad Date/.test(tenants));

  await page.goto(`${BASE}/app/leases`, { waitUntil: "networkidle" });
  const leases = await page.textContent("body");
  log("leases created for the imported rows", /Mia Alvarez/.test(leases) && /Owen Fitzgerald/.test(leases));

  // Re-running the same file must be a no-op rather than doubling everything.
  await page.goto(`${BASE}/app/import`, { waitUntil: "networkidle" });
  await page.setInputFiles('input[name="file"]', csvPath);
  await Promise.all([
    page.waitForURL(/\/app\/import\/[a-z0-9]+$/, { timeout: 20000 }),
    page.locator('button[type="submit"]:has-text("Continue")').click(),
  ]);
  await page.waitForTimeout(2000);
  const second = await page.textContent("body");
  log(
    "re-uploading the same file reopens it rather than duplicating the batch",
    /Already imported/i.test(second),
  );
  await page.screenshot({ path: `${ARTIFACTS}/portfolio-03-reupload.png`, fullPage: true });
} catch (err) {
  log("suite crashed", false, err instanceof Error ? err.message : String(err));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
if (failed > 0) process.exit(1);
