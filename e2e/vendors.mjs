import { BASE, launchBrowser } from "./_shared.mjs";

/**
 * The vendor directory and its one integration point: assigning a vendor to
 * a maintenance request. Not hermetic — see e2e/README.md — so the vendor
 * name carries a run-unique suffix and requests are matched by unique title
 * text from prisma/seed.ts, never by "the first row".
 */

let passed = 0;
let failed = 0;

function check(label, ok, detail = "") {
  if (ok) {
    passed++;
    console.log(`PASS  ${label}`);
  } else {
    failed++;
    console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function login(page, email, password = "demo-password-123") {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 }),
    page.click('button[type="submit"]'),
  ]);
}

const suffix = Date.now().toString(36);
const vendorName = `E2E Plumbing ${suffix}`;

const browser = await launchBrowser();

// ------------------------------------------------------------- build a vendor
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, "admin@example.com");

  await page.goto(`${BASE}/app/maintenance/vendors`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.click('a:has-text("Add vendor")');
  await page.waitForURL(/\/app\/maintenance\/vendors\/new$/, { timeout: 10000 });
  await page.waitForLoadState("networkidle").catch(() => {});

  await page.fill('input[name="name"]', vendorName);
  await page.fill('input[name="trade"]', "Plumbing");
  await page.fill('input[name="contactName"]', "Pat Ortiz");
  await page.fill('input[name="phone"]', "555-0199");
  await page.fill('input[name="email"]', "pat@e2e-plumbing.test");
  await Promise.all([
    page.waitForURL(/\/app\/maintenance\/vendors$/, { timeout: 15000 }),
    page.click('button:has-text("Add vendor")'),
  ]);

  const body = await page.textContent("body");
  check("new vendor appears in the directory", body.includes(vendorName));
  check("trade is shown", body.includes("Plumbing"));

  await ctx.close();
}

// ------------------------------------------------------------- edit a vendor
let vendorEditUrl;
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, "admin@example.com");

  await page.goto(`${BASE}/app/maintenance/vendors`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.click(`a:has-text("${vendorName}")`);
  await page.waitForURL(/\/app\/maintenance\/vendors\/[a-z0-9]+\/edit$/, { timeout: 10000 });
  vendorEditUrl = page.url();
  await page.waitForLoadState("networkidle").catch(() => {});

  check("edit form is prefilled with the vendor's name", (await page.locator('input[name="name"]').inputValue()) === vendorName);
  check("edit form is prefilled with the trade", (await page.locator('input[name="trade"]').inputValue()) === "Plumbing");

  await page.fill('input[name="trade"]', "Plumbing & Drains");
  await page.click('button:has-text("Save changes")');
  await page.waitForTimeout(600);
  await page.reload({ waitUntil: "domcontentloaded" });

  check(
    "saved trade persists on reload",
    (await page.locator('input[name="trade"]').inputValue()) === "Plumbing & Drains",
  );

  await ctx.close();
}

const vendorId = vendorEditUrl.match(/\/vendors\/([a-z0-9]+)\/edit/)?.[1];

// ------------------------------------------------------------- assign to a maintenance request
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, "admin@example.com");

  // Seeded by prisma/seed.ts — see requestSpecs.
  await page.goto(`${BASE}/app/maintenance?filter=all`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.click('a:has-text("Dishwasher not draining")');
  await page.waitForURL(/\/app\/maintenance\/[a-z0-9]+$/, { timeout: 10000 });
  await page.waitForLoadState("networkidle").catch(() => {});

  const vendorSelect = page.locator('select[name="vendorId"]');
  await vendorSelect.selectOption({ value: vendorId });
  await page.waitForTimeout(600);

  const body = await page.textContent("body");
  check("assignment success message shown", /Assigned to/.test(body));
  check("vendor contact info shown in the sidebar", body.includes("555-0199"));

  const requestUrl = page.url();

  // A vendor with an email on file gets a plain FYI — no link into the app,
  // since they have no login. See notifyVendorAssigned.
  await page.goto(`${BASE}/app/settings/outbox`, { waitUntil: "networkidle" });
  const outbox = await page.textContent("body");
  check("assigning a vendor with an email on file emails them", outbox.includes("pat@e2e-plumbing.test"));
  check("the vendor email names the job", /Dishwasher not draining/.test(outbox));

  await page.goto(`${BASE}/app/maintenance?filter=all`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  const listBody = await page.textContent("body");
  check("vendor name appears in the maintenance list", listBody.includes(vendorName));

  // Unassign
  await page.goto(requestUrl, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.locator('select[name="vendorId"]').selectOption({ label: "Unassigned" });
  await page.waitForTimeout(600);
  check(
    "unassigning clears the current selection",
    (await page.locator('select[name="vendorId"]').inputValue()) === "",
  );
  check("unassignment note recorded", (await page.textContent("body")).includes("Vendor unassigned."));

  await ctx.close();
}

// ------------------------------------------------------------- archive and reactivate
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, "admin@example.com");

  await page.goto(vendorEditUrl, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.click('button:has-text("Archive vendor")');
  await page.waitForTimeout(600);

  check(
    "archiving flips the button to Reactivate",
    (await page.locator('button:has-text("Reactivate vendor")').count()) === 1,
  );

  await page.goto(`${BASE}/app/maintenance/vendors`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  const row = page.locator("tr", { hasText: vendorName });
  check("archived vendor's row reads Reactivate in the list", (await row.locator('button:has-text("Reactivate")').count()) === 1);

  await row.locator('button:has-text("Reactivate")').click();
  await page.waitForTimeout(600);
  check(
    "reactivating flips the row back to Archive",
    (await page.locator("tr", { hasText: vendorName }).locator('button:has-text("Archive")').count()) === 1,
  );

  await ctx.close();
}

await browser.close();

console.log(`\n${passed}/${passed + failed} checks passed`);
if (failed > 0) process.exit(1);
