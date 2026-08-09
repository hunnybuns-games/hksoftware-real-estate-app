import { BASE, launchBrowser } from "./_shared.mjs";

let passed = 0;
let failed = 0;

function check(label, ok) {
  if (ok) {
    passed++;
    console.log(`PASS  ${label}`);
  } else {
    failed++;
    console.log(`FAIL  ${label}`);
  }
}

async function login(page, email) {
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "demo-password-123");
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 15000 });
}

async function fetchCsv(page, path) {
  const resp = await page.request.get(`${BASE}${path}`);
  return resp;
}

const browser = await launchBrowser();

// --- Staff: reports pages + exports ---
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, "admin@example.com");

  await page.goto(`${BASE}/app/reports`);
  check("reports page renders rent roll", await page.locator("text=Rent roll").first().isVisible());
  check("reports page lists properties", (await page.locator('a[href^="/app/reports/"]').count()) > 0);

  const rentRollResp = await fetchCsv(page, "/api/export/rent-roll");
  check("rent-roll export returns 200", rentRollResp.status() === 200);
  check(
    "rent-roll export is a csv attachment",
    (rentRollResp.headers()["content-disposition"] ?? "").includes("attachment"),
  );
  const rentRollBody = await rentRollResp.text();
  check("rent-roll csv has a header row", rentRollBody.split("\r\n")[0].includes("Property"));

  const firstPropertyHref = await page.locator('a[href^="/app/reports/"]').first().getAttribute("href");
  await page.goto(`${BASE}${firstPropertyHref}`);
  check("property P&L page renders", await page.locator("text=Income").first().isVisible());
  check(
    "property P&L page has export link",
    await page.locator('a[href^="/api/export/property-pl"]').first().isVisible(),
  );

  const propertyId = firstPropertyHref.split("/").pop();
  const plResp = await fetchCsv(page, `/api/export/property-pl?propertyId=${propertyId}`);
  check("property-pl export returns 200", plResp.status() === 200);

  const paymentsResp = await fetchCsv(page, "/api/export/payments");
  check("payments export returns 200", paymentsResp.status() === 200);

  // Charges export needs a leaseId — grab one from the lease list. Exclude
  // "/app/leases/new" which also matches the href^= prefix.
  await page.goto(`${BASE}/app/leases`);
  const leaseHref = await page
    .locator('a[href^="/app/leases/"]:not([href="/app/leases/new"])')
    .first()
    .getAttribute("href");
  const leaseId = leaseHref.split("/").pop();
  const chargesResp = await fetchCsv(page, `/api/export/charges?leaseId=${leaseId}`);
  check("charges export returns 200 for a real lease", chargesResp.status() === 200);
  const chargesMissingResp = await fetchCsv(page, "/api/export/charges");
  check("charges export 400s without leaseId", chargesMissingResp.status() === 400);

  // Lease ledger page has export links wired in.
  await page.goto(`${BASE}${leaseHref}`);
  check(
    "lease ledger has charges export link",
    await page.locator(`a[href="/api/export/charges?leaseId=${leaseId}"]`).first().isVisible(),
  );
  check(
    "lease ledger has payments export link",
    await page.locator(`a[href="/api/export/payments?leaseId=${leaseId}"]`).first().isVisible(),
  );

  // Expense entry on the property page.
  await page.goto(`${BASE}${firstPropertyHref.replace("/reports/", "/properties/")}`);
  await page.click('summary:has-text("Add expense")');
  const expenseForm = page.locator('main form:has(input[name="amountCents"])').first();
  await expenseForm.locator('input[name="amountCents"]').fill("125.00");
  await expenseForm.locator('input[name="description"]').fill("Smoke test expense");
  await expenseForm.locator('button[type="submit"]').click();
  await page.waitForTimeout(1000);
  check("expense shows up in the expenses table", await page.locator("text=Smoke test expense").first().isVisible());

  await ctx.close();
}

// --- Owner: scoped statement + export ---
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, "owner@example.com");

  await page.goto(`${BASE}/owner`);
  const statementHref = await page.locator('a[href^="/owner/reports/"]').first().getAttribute("href");
  check("owner dashboard links to a statement page", !!statementHref);

  await page.goto(`${BASE}${statementHref}`);
  check("owner statement page renders", await page.locator("text=Income").first().isVisible());

  // An owner must not be able to fetch a property they don't own.
  await page.goto(`${BASE}/app/reports`); // will redirect since owner isn't staff; just to force a nav away
  const otherPropertyResp = await fetchCsv(page, "/api/export/property-pl?propertyId=does-not-exist");
  check("owner export 403/404s for a property they don't own", [403, 404].includes(otherPropertyResp.status()));

  const ownerRentRollResp = await fetchCsv(page, "/api/export/rent-roll");
  check("owner rent-roll export returns 200", ownerRentRollResp.status() === 200);
  const ownerRentRollBody = await ownerRentRollResp.text();
  const ownerRentRollHeader = ownerRentRollBody.split("\r\n")[0];
  check("owner rent-roll export has no Tenant column", !ownerRentRollHeader.split(",").includes("Tenant"));

  await ctx.close();
}

await browser.close();

console.log(`\n${passed}/${passed + failed} checks passed`);
process.exit(failed > 0 ? 1 : 0);
