import path from "node:path";
import { BASE, launchBrowser } from "./_shared.mjs";

/**
 * Tenant screening end to end: staff requests it, the applicant consents (or
 * declines, or staff cancels before they respond) through the public
 * /screening/[token] link, and staff records what came back. See
 * docs/tenant-screening.md for what this feature actually is.
 *
 * Nothing is delivered locally, so /app/settings/outbox is the inbox — same
 * trick e2e/password-reset.mjs and e2e/security.mjs use.
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

/** Reads the newest /screening/[token] link out of the outbox. */
async function latestScreeningLink(page) {
  await page.goto(`${BASE}/app/settings/outbox`, { waitUntil: "networkidle" });
  const body = (await page.textContent("body")) ?? "";
  const matches = body.match(/\/screening\/[A-Za-z0-9_-]+/g) ?? [];
  return matches[0] ?? null; // outbox lists newest first
}

const { PrismaClient } = await import("@prisma/client");
const { PrismaBetterSQLite3 } = await import("@prisma/adapter-better-sqlite3");
const dbUrl = `file:${path.join(process.cwd(), "prisma", "dev.db")}`;
const db = new PrismaClient({ adapter: new PrismaBetterSQLite3({ url: dbUrl }) });

const unit = await db.unit.findFirst({
  where: { status: "VACANT", property: { organization: { users: { some: { email: "admin@example.com" } } } } },
  select: { id: true, label: true },
});
await db.$disconnect();

if (!unit) {
  console.log("FAIL  no vacant unit found in the seeded database — can't run this suite");
  process.exit(1);
}

const applicantEmail = `screening-applicant-${Date.now()}@example.com`;
const browser = await launchBrowser();
let applicationId;

// ------------------------------------------------------------- submit an application
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/apply/${unit.id}`, { waitUntil: "domcontentloaded" });
  await page.fill('input[name="firstName"]', "Skyler");
  await page.fill('input[name="lastName"]', "Chen");
  await page.fill('input[name="email"]', applicantEmail);
  await Promise.all([
    page.waitForURL((u) => u.searchParams.get("submitted") === "1", { timeout: 15000 }),
    page.click('button[type="submit"]'),
  ]);
  await ctx.close();
}

// ------------------------------------------------------------- find the application
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, "admin@example.com");
  await page.goto(`${BASE}/app/applications`, { waitUntil: "domcontentloaded" });
  await page.click("text=Skyler Chen");
  await page.waitForURL(/\/app\/applications\/[a-z0-9]+$/, { timeout: 15000 });
  applicationId = new URL(page.url()).pathname.split("/").pop();

  const body = await page.textContent("body");
  check("Screening card is present on the application page", body.includes("Screening"));
  check(
    "all three report types are offered and checked by default",
    (await page.locator('input[name="wantCredit"]:checked').count()) === 1 &&
      (await page.locator('input[name="wantBackground"]:checked').count()) === 1 &&
      (await page.locator('input[name="wantEviction"]:checked').count()) === 1,
  );
  await ctx.close();
}

// ------------------------------------------------------------- round 1: request -> consent -> record results
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, "admin@example.com");
  await page.goto(`${BASE}/app/applications/${applicationId}`, { waitUntil: "domcontentloaded" });

  await Promise.all([
    page.waitForSelector("text=Waiting on the applicant", { timeout: 10000 }),
    page.click('button:has-text("Request screening")'),
  ]);
  let body = await page.textContent("body");
  check("status flips to Awaiting consent after requesting", body.includes("Awaiting consent"));
  check("a cancel option is offered while awaiting consent", body.includes("Cancel request"));

  const link = await latestScreeningLink(page);
  check("the consent email records a usable link", Boolean(link));
  await ctx.close();

  if (link) {
    const applicantCtx = await browser.newContext();
    const applicantPage = await applicantCtx.newPage();
    await applicantPage.goto(`${BASE}${link}`, { waitUntil: "domcontentloaded" });
    // Same hydration race the other suites hit on a freshly compiled dev-mode
    // route: clicking before React finishes hydrating the button's handler
    // silently no-ops the click. See mvp.mjs/security.mjs/theme.mjs.
    await applicantPage.waitForLoadState("networkidle").catch(() => {});
    const consentBody = await applicantPage.textContent("body");
    check("consent page names the applicant and mentions the report types", consentBody.includes("Skyler"));
    check("consent page includes an FCRA-style disclosure", /Fair Credit Reporting Act|consumer report/i.test(consentBody));

    await Promise.all([
      applicantPage.waitForSelector("text=Thanks", { timeout: 10000 }),
      applicantPage.click('button:has-text("I consent")'),
    ]);
    check(
      "consenting shows a confirmation, not another form",
      (await applicantPage.locator('button:has-text("I consent")').count()) === 0,
    );

    // Revisiting the same link afterward must not let it be replayed.
    await applicantPage.goto(`${BASE}${link}`, { waitUntil: "domcontentloaded" });
    check(
      "revisiting a used consent link shows it's already been handled, not the form again",
      (await applicantPage.locator('button:has-text("I consent")').count()) === 0,
    );
    await applicantCtx.close();
  }

  const staffCtx = await browser.newContext();
  const staffPage = await staffCtx.newPage();
  await login(staffPage, "admin@example.com");
  await staffPage.goto(`${BASE}/app/applications/${applicationId}`, { waitUntil: "domcontentloaded" });
  body = await staffPage.textContent("body");
  check("status flips to In progress once the applicant consents", body.includes("In progress"));

  await staffPage.fill('textarea[name="resultSummary"]', "Credit 720, no evictions on file.");
  await Promise.all([
    staffPage.waitForSelector("text=Completed", { timeout: 10000 }),
    staffPage.click('button:has-text("Save results")'),
  ]);
  body = await staffPage.textContent("body");
  check("recorded results are shown once completed", body.includes("Credit 720, no evictions on file."));
  check("a new-request form reappears once a screening is completed", body.includes("Request screening"));
  await staffCtx.close();
}

// ------------------------------------------------------------- round 2: request -> cancel
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, "admin@example.com");
  await page.goto(`${BASE}/app/applications/${applicationId}`, { waitUntil: "domcontentloaded" });

  await Promise.all([
    page.waitForSelector("text=Cancel request", { timeout: 10000 }),
    page.click('button:has-text("Request screening")'),
  ]);
  await Promise.all([
    page.waitForSelector("text=Request screening", { timeout: 10000 }),
    page.click('button:has-text("Cancel request")'),
  ]);
  const body = await page.textContent("body");
  check("canceling clears the awaiting-consent state and offers a new request", body.includes("Request screening"));
  await ctx.close();
}

// ------------------------------------------------------------- round 3: request -> decline
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, "admin@example.com");
  await page.goto(`${BASE}/app/applications/${applicationId}`, { waitUntil: "domcontentloaded" });
  await Promise.all([
    page.waitForSelector("text=Waiting on the applicant", { timeout: 10000 }),
    page.click('button:has-text("Request screening")'),
  ]);
  const link = await latestScreeningLink(page);
  await ctx.close();

  if (link) {
    const applicantCtx = await browser.newContext();
    const applicantPage = await applicantCtx.newPage();
    await applicantPage.goto(`${BASE}${link}`, { waitUntil: "domcontentloaded" });
    await applicantPage.waitForLoadState("networkidle").catch(() => {});
    await Promise.all([
      applicantPage.waitForSelector("text=Thanks", { timeout: 10000 }),
      applicantPage.click('button:has-text("I do not consent")'),
    ]);
    await applicantCtx.close();
  }

  const staffCtx = await browser.newContext();
  const staffPage = await staffCtx.newPage();
  await login(staffPage, "admin@example.com");
  await staffPage.goto(`${BASE}/app/applications/${applicationId}`, { waitUntil: "domcontentloaded" });
  const body = await staffPage.textContent("body");
  check("status shows Declined after the applicant declines", body.includes("Declined"));
  check("declining still leaves the application open for review", !body.includes("became a lease"));
  await staffCtx.close();
}

// ------------------------------------------------------------- an unknown token 404s
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const res = await page.goto(`${BASE}/screening/not-a-real-token`, { waitUntil: "domcontentloaded" });
  check("an unknown consent token 404s", res.status() === 404, `status ${res.status()}`);
  await ctx.close();
}

await browser.close();

console.log(`\n${passed}/${passed + failed} checks passed`);
if (failed > 0) process.exit(1);
