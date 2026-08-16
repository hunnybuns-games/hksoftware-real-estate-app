import path from "node:path";
import { BASE, launchBrowser } from "./_shared.mjs";

/**
 * The rental-applications flow end to end: a prospect submits the public
 * form, staff reviews and approves it, then converts it into a lease — and
 * the application ends up permanently linked to that lease.
 *
 * Finds a real vacant unit by querying the seeded database directly (same
 * trick mvp.mjs uses for its cross-org check) rather than hard-coding a unit
 * id, since seed.ts generates units procedurally.
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

async function login(page, email) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "demo-password-123");
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 }),
    page.click('button[type="submit"]'),
  ]);
}

const { PrismaClient } = await import("@prisma/client");
const { PrismaBetterSQLite3 } = await import("@prisma/adapter-better-sqlite3");
const dbUrl = `file:${path.join(process.cwd(), "prisma", "dev.db")}`;
const db = new PrismaClient({ adapter: new PrismaBetterSQLite3({ url: dbUrl }) });

const unit = await db.unit.findFirst({
  where: { status: "VACANT", property: { organization: { users: { some: { email: "admin@example.com" } } } } },
  select: { id: true, label: true, marketRentCents: true, property: { select: { name: true } } },
});
await db.$disconnect();

if (!unit) {
  console.log("FAIL  no vacant unit found in the seeded database — can't run this suite");
  process.exit(1);
}

const applicantEmail = `applicant-${Date.now()}@example.com`;
// Comfortably above the 3x-rent guideline regardless of this unit's rent.
const monthlyIncomeDollars = Math.round((unit.marketRentCents / 100) * 5);

const browser = await launchBrowser();
let applicationId;

// ------------------------------------------------------------- 404 for a bad link
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const res = await page.goto(`${BASE}/apply/not-a-real-unit-id`, { waitUntil: "domcontentloaded" });
  check("an unknown unit id 404s", res.status() === 404, `status ${res.status()}`);
  await ctx.close();
}

// ------------------------------------------------------------- public submission
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  await page.goto(`${BASE}/apply/${unit.id}`, { waitUntil: "domcontentloaded" });
  const body = await page.textContent("body");
  check("apply page shows the property and unit", body.includes(unit.property.name) && body.includes(unit.label));

  await page.fill('input[name="firstName"]', "Jamie");
  await page.fill('input[name="lastName"]', "Rivera");
  await page.fill('input[name="email"]', applicantEmail);
  await page.fill('input[name="phone"]', "555-0100");
  await page.fill('input[name="occupants"]', "2");
  await page.fill('input[name="monthlyIncomeCents"]', String(monthlyIncomeDollars));
  await page.check('input[name="hasPets"]');
  await page.fill('input[name="petDetails"]', "One small dog");
  await page.fill('textarea[name="message"]', "Would love to move in as soon as possible.");

  await Promise.all([
    page.waitForURL((u) => u.searchParams.get("submitted") === "1", { timeout: 15000 }),
    page.click('button[type="submit"]'),
  ]);
  check(
    "submitting redirects to the confirmation view",
    (await page.textContent("body")).includes("Application received"),
  );

  await ctx.close();
}

// ------------------------------------------------------------- staff review
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, "admin@example.com");

  await page.goto(`${BASE}/app/applications`, { waitUntil: "domcontentloaded" });
  let body = await page.textContent("body");
  check("the new application appears under Needs review", body.includes("Jamie Rivera"));

  await page.click("text=Jamie Rivera");
  await page.waitForURL(/\/app\/applications\/[a-z0-9]+$/, { timeout: 15000 });
  applicationId = new URL(page.url()).pathname.split("/").pop();

  body = await page.textContent("body");
  check("detail page shows the applicant's email", body.includes(applicantEmail));
  check("detail page shows the pet note", body.includes("One small dog"));
  check(
    "income comfortably above 3x rent is flagged as meeting the guideline",
    body.includes("Meets 3x rent guideline"),
  );

  // Approve it.
  await page.selectOption('select[name="status"]', "APPROVED");
  await Promise.all([
    page.waitForSelector("text=Application updated.", { timeout: 10000 }),
    page.click('button:has-text("Save")'),
  ]);
  body = await page.textContent("body");
  check("status badge now reads Approved", body.includes("Approved"));
  check("a 'Convert to lease' action appears once approved", body.includes("Convert to lease"));

  await ctx.close();
}

// ------------------------------------------------------------- convert to lease
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, "admin@example.com");

  await page.goto(`${BASE}/app/applications/${applicationId}`, { waitUntil: "domcontentloaded" });
  await Promise.all([
    page.waitForURL(/\/app\/leases\/new\?/, { timeout: 15000 }),
    page.click('button:has-text("Convert to lease")'),
  ]);

  const url = new URL(page.url());
  check("lands on the new-lease form with the unit pre-selected", url.searchParams.get("unitId") === unit.id);
  const tenantId = url.searchParams.get("tenantId");
  check("a tenant id was created and passed through", Boolean(tenantId));

  const body = await page.textContent("body");
  check("banner explains this lease came from an application", body.includes("approved application"));

  const selectedUnit = await page.locator('select[name="unitId"]').inputValue();
  check("unit dropdown is pre-selected", selectedUnit === unit.id);
  const selectedTenant = await page.locator('select[name="tenantId"]').inputValue();
  check("tenant dropdown is pre-selected", selectedTenant === tenantId);

  await Promise.all([
    page.waitForURL(/\/app\/leases\/[a-z0-9]+$/, { timeout: 15000 }),
    page.click('button:has-text("Create lease")'),
  ]);
  const leaseBody = await page.textContent("body");
  check("new lease page shows the applicant as the tenant", leaseBody.includes("Jamie Rivera"));

  // The application should now point at this lease and be locked.
  await page.goto(`${BASE}/app/applications/${applicationId}`, { waitUntil: "domcontentloaded" });
  const afterBody = await page.textContent("body");
  check("application detail now links to the lease", afterBody.includes("View lease"));
  check(
    "the review form is replaced once it's become a lease",
    afterBody.includes("became a lease and can no longer be changed"),
  );

  await ctx.close();
}

await browser.close();

console.log(`\n${passed}/${passed + failed} checks passed`);
if (failed > 0) process.exit(1);
