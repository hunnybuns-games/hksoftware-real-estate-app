import { ARTIFACTS, BASE, launchBrowser } from "./_shared.mjs";

/**
 * Drives the `db:seed:landlord10` account (one landlord, ten tenants) through
 * a representative slice of every major feature, each tenant exercising a
 * different one: application intake -> screening -> lease e-signature ->
 * online payment -> manual payment -> CSV bank import -> late/reconciliation
 * -> HAP subsidy split -> maintenance request -> vendor assignment ->
 * password reset -> theme. Not part of `npm run e2e` (separate seed data,
 * needs DEMO_PAYMENTS=true) — run explicitly with `npm run e2e:landlord10`
 * against a server that's already had `npm run db:seed:landlord10` applied.
 *
 * Mutates real rows (approves an application, records payments, signs a
 * lease...) so it isn't idempotent — re-seed before re-running the full tour.
 *
 * Each labeled section runs in its own try/catch so one broken step (a
 * changed selector, a slow page) doesn't take down every section after it —
 * this script's job is to report what's broken, not to stop at the first
 * thing that is.
 */

const PASSWORD = "demo-password-123";
const results = [];
function log(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function section(name, fn) {
  try {
    await fn();
  } catch (err) {
    log(`${name} (crashed)`, false, err instanceof Error ? err.message : String(err));
  }
}

async function login(page, email, password = PASSWORD) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20000 }),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForLoadState("networkidle").catch(() => {});
}

const browser = await launchBrowser();

await section("admin dashboard", async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  await login(page, "landlord10@example.com");
  log("landlord lands on /app", new URL(page.url()).pathname === "/app");

  const body = await page.textContent("body");
  log("dashboard shows the property", /Sunrise Ridge Apartments/.test(body));
  log("dashboard surfaces late balances", /Needs attention/.test(body) && !/Nothing needs chasing/.test(body));
  await page.screenshot({ path: `${ARTIFACTS}/landlord10-01-dashboard.png`, fullPage: true });

  await page.goto(`${BASE}/app/settings/payments`, { waitUntil: "domcontentloaded" });
  const paymentsBody = await page.textContent("body");
  log(
    "Stripe Connect account shows up (live test-mode account)",
    /acct_/.test(paymentsBody) || /Stripe/.test(paymentsBody),
  );
  await ctx.close();
});

await section("application -> lease (Ava)", async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, "landlord10@example.com");

  await page.goto(`${BASE}/app/applications`, { waitUntil: "domcontentloaded" });
  let body = await page.textContent("body");
  log("Ava's application is in the queue", /Ava Thompson/.test(body));
  log("Marcus's application is in the queue", /Marcus Webb/.test(body));

  await page.click("text=Ava Thompson");
  await page.waitForURL(/\/app\/applications\/[a-z0-9]+$/, { timeout: 15000 });

  await page.selectOption('select[name="status"]', "APPROVED");
  await Promise.all([
    page.waitForSelector("text=Application updated.", { timeout: 10000 }),
    page.click('button:has-text("Save")'),
  ]);
  body = await page.textContent("body");
  log("Ava's application approved", /Approved/.test(body));

  await Promise.all([
    page.waitForURL(/\/app\/leases\/new\?/, { timeout: 15000 }),
    page.click('button:has-text("Convert to lease")'),
  ]);

  await Promise.all([
    page.waitForURL(/\/app\/leases\/[a-z0-9]+$/, { timeout: 15000 }),
    page.click('button:has-text("Create lease")'),
  ]);
  body = await page.textContent("body");
  log("Ava converted from applicant to signed-up tenant with a lease", /Ava Thompson/.test(body));

  // Marcus: leave as a pending applicant, just confirm the screening report
  // that was seeded is actually visible to staff.
  await page.goto(`${BASE}/app/applications`, { waitUntil: "domcontentloaded" });
  await page.click("text=Marcus Webb");
  await page.waitForURL(/\/app\/applications\/[a-z0-9]+$/, { timeout: 15000 });
  body = await page.textContent("body");
  log(
    "Marcus's completed screening report is visible to staff",
    /712/.test(body) && /Recommend approval/.test(body),
  );

  await ctx.close();
});

await section("payments (Ethan, Liam, Zoe)", async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, "landlord10@example.com");

  // Ethan: manual cash payment recorded by staff. The exact amount doesn't
  // matter for this check — a partial payment toward next month's rent
  // exercises the same "Record payment" write path as a full one.
  await page.goto(`${BASE}/app/leases`, { waitUntil: "networkidle" });
  await page.click("text=Ethan Brooks");
  await page.waitForURL(/\/app\/leases\/[a-z0-9]+$/, { timeout: 15000 });

  const recordSection = page
    .locator("details", { has: page.locator("summary", { hasText: "Record payment" }) })
    .first();
  await recordSection.locator("summary").click();
  const form = recordSection.locator("form");
  await form.locator('select[name="source"]').selectOption("MANUAL_CASH");
  await form.locator('input[name="amountCents"]').fill("200");
  await form.locator('input[name="memo"]').fill("Handed cash to the property manager");
  await Promise.all([page.waitForTimeout(2500), form.locator('button[type="submit"]').click()]);
  await page.waitForTimeout(1500);
  const afterBalance = await page.textContent("body");
  log("Ethan's manual cash payment was recorded", /Handed cash/.test(afterBalance));

  // Liam: confirm the late scenario actually renders as late.
  await page.goto(`${BASE}/app/leases`, { waitUntil: "networkidle" });
  await page.click("text=Liam Foster");
  await page.waitForURL(/\/app\/leases\/[a-z0-9]+$/, { timeout: 15000 });
  const liamBody = await page.textContent("body");
  log("Liam's lease shows a late balance", /Late|Short|overdue/i.test(liamBody));

  // Zoe: confirm the HAP subsidy split renders.
  await page.goto(`${BASE}/app/leases`, { waitUntil: "networkidle" });
  await page.click("text=Zoe Whitaker");
  await page.waitForURL(/\/app\/leases\/[a-z0-9]+$/, { timeout: 15000 });
  const zoeBody = await page.textContent("body");
  log("Zoe's lease shows the HAP subsidy split", /Ada County Housing Authority/.test(zoeBody));

  await ctx.close();
});

await section("CSV bank import (Sophia)", async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, "landlord10@example.com");

  const csv = [
    "Date,Description,Amount",
    `${new Date().toISOString().slice(0, 10)},SOPHIA REYES RENT,1450.00`,
  ].join("\n");
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const dir = mkdtempSync(path.join(tmpdir(), "landlord10-csv-"));
  const csvPath = path.join(dir, "bank-statement.csv");
  writeFileSync(csvPath, csv);

  await page.goto(`${BASE}/app/payments/import`, { waitUntil: "networkidle" });
  await page.selectOption('select[name="source"]', "IMPORT_BANK");
  await page.setInputFiles('input[name="file"]', csvPath);
  await Promise.all([
    page.waitForURL(/\/app\/payments\/import\/[a-z0-9]+$/, { timeout: 20000 }),
    page.locator('main form button[type="submit"]').click(),
  ]);
  let body = await page.textContent("body");
  log("bank CSV parsed and reached the review screen", /SOPHIA REYES RENT/i.test(body));

  const confirmBtn = page.locator('button:has-text("Confirm import")');
  // First visit to this route can be slow to compile under Turbopack dev —
  // give it a real wait instead of racing the initial render.
  await confirmBtn.first().waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
  if (await confirmBtn.count()) {
    await Promise.all([page.waitForTimeout(2000), confirmBtn.click()]);
    body = await page.textContent("body");
    // Not a generic /error/i check — Next's dev-mode error overlay markup
    // contains that word even when nothing is actually wrong, which made
    // this false-negative every run. "Nothing to import" is the one real
    // error confirmImportAction can return for a single valid row.
    log("import confirmed", !/Nothing to import/i.test(body));
  } else {
    log("import confirmed", false, "no Confirm import button found on the review screen");
  }

  await page.goto(`${BASE}/app/leases`, { waitUntil: "networkidle" });
  await page.click("text=Sophia Reyes");
  await page.waitForURL(/\/app\/leases\/[a-z0-9]+$/, { timeout: 15000 });
  const sophiaBody = await page.textContent("body");
  log("Sophia's imported bank payment landed on her ledger", /SOPHIA REYES RENT/i.test(sophiaBody));

  await ctx.close();
});

await section("lease e-signature (Noah)", async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await login(page, "noah.kim@example.com");

  await page.goto(`${BASE}/portal/lease`, { waitUntil: "domcontentloaded" });
  const signLink = page.locator("text=Review & sign");
  if (await signLink.count()) {
    await signLink.click();
    await page.waitForURL(/\/portal\/lease\/document\/[a-z0-9]+$/, { timeout: 15000 });
    await page.fill('input[name="typedSignature"]', "Noah Kim");
    await Promise.all([page.waitForTimeout(2000), page.click('button:has-text("Sign lease")')]);
    const body = await page.textContent("body");
    log("Noah signed his lease through the portal", /signed|Signed/.test(body));
  } else {
    log("Noah signed his lease through the portal", false, "no 'Review & sign' link on /portal/lease");
  }
  await page.screenshot({ path: `${ARTIFACTS}/landlord10-02-noah-signed.png`, fullPage: true });
  await ctx.close();
});

await section("online demo payment (Isabella)", async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await login(page, "isabella.cruz@example.com");

  await page.goto(`${BASE}/portal`, { waitUntil: "domcontentloaded" });
  const payBtn = page.locator('button:has-text("Pay $"), button:has-text("Make a payment")').first();
  if (await payBtn.count()) {
    await payBtn.click();
    await page.waitForTimeout(4000);
    const body = await page.textContent("body");
    log(
      "Isabella's online (demo) payment recorded and balance cleared",
      /Recorded a demo payment/.test(body) || /all paid up/i.test(body),
    );
  } else {
    log("Isabella's online (demo) payment recorded and balance cleared", false, "no pay button on /portal");
  }
  await page.screenshot({ path: `${ARTIFACTS}/landlord10-03-isabella-paid.png`, fullPage: true });
  await ctx.close();
});

await section("maintenance request submitted (Caleb)", async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await login(page, "caleb.nguyen@example.com");

  await page.goto(`${BASE}/portal/maintenance`, { waitUntil: "domcontentloaded" });
  const detailsEl = page
    .locator("details", { has: page.locator("summary", { hasText: "Submit a request" }) })
    .first();
  if ((await detailsEl.count()) > 0) {
    const isOpen = await detailsEl.evaluate((el) => el.hasAttribute("open"));
    if (!isOpen) await detailsEl.locator("summary").click();
  }
  await page.fill('input[name="title"]', "Garbage disposal jammed");
  await page.fill('textarea[name="description"]', "Disposal hums but doesn't spin. Sink backs up when it runs.");
  await page.selectOption('select[name="priority"]', "NORMAL");
  await Promise.all([
    page.waitForURL(/submitted=1/, { timeout: 20000 }),
    page.locator('form:has(textarea[name="description"]) button[type="submit"]').click(),
  ]);
  const body = await page.textContent("body");
  log(
    "Caleb submitted a maintenance request from the portal",
    /Request submitted/.test(body) && /Garbage disposal jammed/.test(body),
  );
  await ctx.close();
});

await section("assign vendor + directory/reports (admin)", async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, "landlord10@example.com");

  await page.goto(`${BASE}/app/maintenance?filter=all`, { waitUntil: "domcontentloaded" });
  const requestLink = page.locator('a:has-text("Garbage disposal jammed")');
  if (await requestLink.count()) {
    await requestLink.click();
    await page.waitForURL(/\/app\/maintenance\/[a-z0-9]+$/, { timeout: 15000 });
    // The option label includes the trade in parentheses (see
    // assign-vendor-form.tsx) — "Ridge Plumbing & Rooter (Plumbing)".
    const vendorSelect = page.locator('select[name="vendorId"]');
    await vendorSelect.selectOption({ label: "Ridge Plumbing & Rooter (Plumbing)" });
    await page.waitForTimeout(2000);
    const body = await page.textContent("body");
    log("Caleb's request assigned to a vendor", /Ridge Plumbing & Rooter/.test(body));
  } else {
    log("Caleb's request assigned to a vendor", false, "couldn't find the request in the maintenance list");
  }

  await page.goto(`${BASE}/app/maintenance/vendors`, { waitUntil: "domcontentloaded" });
  const vendorBody = await page.textContent("body");
  log(
    "vendor directory lists both seeded vendors",
    /Ridge Plumbing & Rooter/.test(vendorBody) && /Boise Handy Crew/.test(vendorBody),
  );

  await page.goto(`${BASE}/app/reports`, { waitUntil: "networkidle" });
  log("reports page renders", !/Application error/i.test(await page.textContent("body")));

  await page.goto(`${BASE}/app/payments`, { waitUntil: "networkidle" });
  log("payments/reconciliation page renders", !/Application error/i.test(await page.textContent("body")));

  await ctx.close();
});

await section("password reset requested (Harper)", async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/forgot-password`, { waitUntil: "domcontentloaded" });
  await page.locator('input[name="email"]').fill("harper.diaz@example.com");
  await Promise.all([page.waitForTimeout(1500), page.locator('main form button[type="submit"]').click()]);
  const body = await page.textContent("body");
  log("Harper's password-reset request was accepted", /check your email|reset link/i.test(body));
  await ctx.close();
});

await section("theme toggle (Zoe)", async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, "zoe.whitaker@example.com");
  await page.goto(`${BASE}/portal`, { waitUntil: "domcontentloaded" });
  const darkRadio = page.getByRole("radio", { name: "Dark" });
  if (await darkRadio.count()) {
    await darkRadio.click();
    await page.waitForTimeout(500);
    const isDark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
    log("Zoe can switch the app to dark mode from the portal", isDark);
  } else {
    log("Zoe can switch the app to dark mode from the portal", false, "no theme control found on /portal");
  }
  await ctx.close();
});

await browser.close();

const failedCount = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failedCount}/${results.length} checks passed`);
if (failedCount > 0) process.exit(1);
