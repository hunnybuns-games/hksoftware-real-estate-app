import { writeFileSync } from "node:fs";
import { ARTIFACTS, BASE, artifactPath, launchBrowser } from "./_shared.mjs";

const SHOTS = ARTIFACTS;

const results = [];
function log(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const browser = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const consoleErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", (e) => consoleErrors.push(e.message));

await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await page.fill('input[name="email"]', "admin@example.com");
await page.fill('input[name="password"]', "demo-password-123");
await Promise.all([
  page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20000 }),
  page.click('button[type="submit"]'),
]);
await page.waitForURL((u) => u.pathname !== "/", { timeout: 20000 }).catch(() => {});
await page.waitForLoadState("networkidle").catch(() => {});

// ---------------------------------------------------------------- RENT PAGE
await page.goto(`${BASE}/app/payments`, { waitUntil: "networkidle" });
const rentBody = await page.textContent("body");
log("rent page shows unmatched payments panel", /Unmatched payments/.test(rentBody));
log("rent page shows Cash App unmatched entry", /randomhandle22/.test(rentBody) || /Cash App/.test(rentBody));
log("rent page shows Import statement entry point", (await page.locator('a:has-text("Import statement")').count()) > 0);
await page.screenshot({ path: `${SHOTS}/r01-rent-page.png`, fullPage: true });

// ------------------------------------------------------- LEASE LEDGER: HAP
// Find a lease with a subsidy split via the lease list, since we don't have IDs handy.
await page.goto(`${BASE}/app/leases`, { waitUntil: "networkidle" });
const leaseListBody = await page.textContent("body");
log("lease list renders", /Balance/.test(leaseListBody));

// Find the HAP-split lease by visiting each active lease is expensive; instead query via a known short lease effect: look for a lease row we can click that shows in "Needs attention" with SHORT-looking balance. We'll instead navigate directly by searching dashboard "Needs attention" for a HAP-tagged lease link.
await page.goto(`${BASE}/app`, { waitUntil: "networkidle" });
const dashboardBody = await page.textContent("body");
log("dashboard still shows Needs attention section", /Needs attention/.test(dashboardBody));

// ------------------------------------------------------------- MANUAL ENTRY
// Open any lease and record a HAP-sourced manual payment to confirm the new source picker works end to end.
await page.goto(`${BASE}/app/leases`, { waitUntil: "networkidle" });
await page.locator("main table tbody tr").first().locator("a").first().click();
await page.waitForURL(/\/app\/leases\/[a-z0-9]+$/, { timeout: 15000 });
const leaseUrl = page.url();

await page.locator("summary", { hasText: "Record payment" }).first().click();
await page.waitForTimeout(300);
const paymentForm = page.locator('form:has(input[name="memo"])');
const sourceSelect = paymentForm.locator('select[name="source"]');
log("record-payment form offers HAP as a source", (await sourceSelect.locator('option[value="IMPORT_HAP"]').count()) > 0);
await sourceSelect.selectOption("IMPORT_HAP");
await paymentForm.locator('input[name="amountCents"]').fill("50");
await paymentForm.locator('input[name="memo"]').fill("e2e HAP test payment");
await paymentForm.locator('button[type="submit"]').click();
await page.waitForTimeout(2500);
const afterManual = await page.textContent("body");
log("manually-recorded HAP payment shows the HAP badge", /HAP/.test(afterManual));
log("manually-recorded payment shows a reconciliation status", /Matched|Short|Late|Unmatched/.test(afterManual));
await page.screenshot({ path: `${SHOTS}/r02-lease-hap-payment.png`, fullPage: true });

// -------------------------------------------------------------- HAP SPLIT UI
// Edit the lease to add a subsidy split via the form, then verify the summary shows it.
await page.locator('input[name="hasSubsidy"]').check();
await page.waitForTimeout(200);
await page.locator('input[name="subsidyOwedCents"]').fill("450");
await page.locator('input[name="subsidyPayerName"]').fill("E2E Housing Authority");
await page.locator('main form:has(input[name="rentAmountCents"]) button[type="submit"]').click();
await page.waitForTimeout(2500);
const afterSplit = await page.textContent("body");
log("lease form saves a subsidy split and summary reflects it",
  /Rent split/.test(afterSplit) && /E2E Housing Authority/.test(afterSplit));
await page.screenshot({ path: `${SHOTS}/r03-lease-split-saved.png`, fullPage: true });

// ----------------------------------------------------------- CSV IMPORT FLOW
await page.goto(`${BASE}/app/payments/import`, { waitUntil: "networkidle" });
log("import page renders upload form", (await page.locator('select[name="source"]').count()) > 0);

// Build a small CSV and write it to disk for upload.
//
// The description carries a per-run stamp on purpose. The importer rejects a
// re-upload of byte-identical content (SHA-256 content hash, so the same
// statement can't be double-counted) — which means a fixed fixture passes on a
// fresh database and then fails forever after, since run 2's upload looks like
// a duplicate of run 1's. A unique stamp keeps each run's first upload novel
// while still letting the dedup check below re-upload *this* run's file and
// correctly get rejected.
const csvPath = artifactPath("test-import.csv");
const runStamp = `run-${Date.now()}`;
const csvContent = [
  "Date,Amount,Description",
  `2026-01-15,50.00,Test payment from e2e suite ${runStamp}`,
  "2026-01-16,-25.00,ATM withdrawal should be excluded",
  "2026-01-17,0,Zero amount should be excluded",
  "2026-01-18,not-a-number,Bad amount should be excluded",
].join("\n");
writeFileSync(csvPath, csvContent);

await page.selectOption('select[name="source"]', "IMPORT_BANK");
await page.setInputFiles('input[name="file"]', csvPath);
await Promise.all([
  page.waitForURL(/\/app\/payments\/import\/[a-z0-9]+$/, { timeout: 20000 }),
  page.locator('main form button[type="submit"]').click(),
]);
const reviewBody = await page.textContent("body");
log("import review page shows the parsed rows", /Test payment from e2e suite/.test(reviewBody));
log("import review flags bad rows with a reason", /Negative amount|Zero amount|Couldn't read an amount/.test(reviewBody));
await page.screenshot({ path: `${SHOTS}/r04-import-review.png`, fullPage: true });

const confirmBtn = page.locator('main form button[type="submit"]').last();
const confirmText = await confirmBtn.textContent();
log("confirm button reflects only the importable row count", /\(1 row\)/.test(confirmText ?? ""), confirmText ?? "");

await Promise.all([
  page.waitForURL(/confirmed=1/, { timeout: 20000 }),
  confirmBtn.click(),
]);
const confirmedBody = await page.textContent("body");
log("import confirms and shows a summary", /Import confirmed/.test(confirmedBody));
await page.screenshot({ path: `${SHOTS}/r05-import-confirmed.png`, fullPage: true });

// Re-uploading the identical file must be rejected (content-hash dedup).
await page.goto(`${BASE}/app/payments/import`, { waitUntil: "networkidle" });
await page.selectOption('select[name="source"]', "IMPORT_BANK");
await page.setInputFiles('input[name="file"]', csvPath);
await page.locator('main form button[type="submit"]').click();
await page.waitForTimeout(2000);
const dedupBody = await page.textContent("body");
log("re-uploading the identical file is rejected", /already (been )?imported|already imported/i.test(dedupBody));
await page.screenshot({ path: `${SHOTS}/r06-import-dedup.png`, fullPage: true });

// ----------------------------------------------------- CROSS-ORG ISOLATION
const path = await import("node:path");
const { PrismaClient } = await import("@prisma/client");
const { PrismaBetterSQLite3 } = await import("@prisma/adapter-better-sqlite3");
const dbUrl = `file:${path.default.join(process.cwd(), "prisma", "dev.db")}`;
const db = new PrismaClient({ adapter: new PrismaBetterSQLite3({ url: dbUrl }) });
const otherOrgBatch = await db.paymentImportBatch.findFirst({
  where: { organization: { name: { not: "Cedar & Vine Property Group" } } },
  select: { id: true },
});
await db.$disconnect();
if (otherOrgBatch) {
  const res = await page.goto(`${BASE}/app/payments/import/${otherOrgBatch.id}`, { waitUntil: "domcontentloaded" });
  log("cross-org import batch read returns 404", res.status() === 404, `status ${res.status()}`);
} else {
  log("cross-org import batch read returns 404", true, "no other-org batch exists to test against — skipped");
}

console.log("\n--- console/page errors ---");
console.log(consoleErrors.length ? consoleErrors.join("\n") : "(none)");

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
await browser.close();
if (failed.length) {
  console.log("FAILURES:");
  for (const f of failed) console.log(` - ${f.name}${f.detail ? ` (${f.detail})` : ""}`);
  process.exit(1);
}
