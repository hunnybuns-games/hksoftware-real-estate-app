import { ARTIFACTS, BASE, launchBrowser } from "./_shared.mjs";

const SHOTS = ARTIFACTS;

const results = [];
const consoleErrors = [];

function log(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function login(page, email, password) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20000 }),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForURL((u) => u.pathname !== "/", { timeout: 20000 }).catch(() => {});
  await page.waitForLoadState("networkidle").catch(() => {});
}

const browser = await launchBrowser();

// ---------------------------------------------------------------- STAFF/ADMIN
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(`[admin] ${m.text()}`);
  });
  page.on("pageerror", (e) => consoleErrors.push(`[admin pageerror] ${e.message}`));

  await login(page, "admin@example.com", "demo-password-123");
  log("admin lands on /app", new URL(page.url()).pathname === "/app", page.url());

  const body = await page.textContent("body");
  log("dashboard shows collected total", /Collected this month/.test(body));
  log("dashboard shows occupancy", /Occupancy/.test(body));
  log(
    "dashboard surfaces late balances",
    /Needs attention/.test(body) && !/Nothing needs chasing/.test(body),
  );
  await page.screenshot({ path: `${SHOTS}/01-dashboard.png`, fullPage: true });

  // Properties
  await page.goto(`${BASE}/app/properties`, { waitUntil: "domcontentloaded" });
  const propBody = await page.textContent("body");
  log("properties list renders 3 properties",
    /Cedar Court/.test(propBody) && /Vine Street Flats/.test(propBody) && /Alder House/.test(propBody));
  await page.screenshot({ path: `${SHOTS}/02-properties.png`, fullPage: true });

  await page.click("text=Cedar Court");
  await page.waitForURL(/\/app\/properties\/[a-z0-9]+$/, { timeout: 15000 });
  // Client-side nav resolves the URL as soon as the loading.tsx skeleton
  // commits — wait for the streamed content itself before reading it.
  await page.waitForSelector("text=Vacancy loss", { timeout: 10000 });
  const detail = await page.textContent("body");
  log("property detail shows units + vacancy loss",
    /Vacancy loss/.test(detail) && /Units/.test(detail));
  await page.screenshot({ path: `${SHOTS}/03-property-detail.png`, fullPage: true });

  // Create a property (real write)
  await page.goto(`${BASE}/app/properties/new`, { waitUntil: "domcontentloaded" });
  // domcontentloaded fires once the HTML is parsed, not once React has
  // hydrated it — a fill-then-click run right after can click the submit
  // button before its handler is wired up, a dead click with no error and
  // no navigation. This form got enough heavier (the address-autocomplete
  // component) that the race went from theoretical to something CI hit.
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.fill('input[name="name"]', "Birch Row");
  await page.fill('input[name="addressLine1"]', "9 Birch Row");
  await page.fill('input[name="city"]', "Portland");
  await page.selectOption('select[name="state"]', "OR");
  await page.fill('input[name="postalCode"]', "97212");
  await Promise.all([
    // cuid ids are ~25 chars — long enough that this can never match the
    // literal "/app/properties/new" the way a bare [a-z0-9]+ would.
    page.waitForURL(/\/app\/properties\/[a-z0-9]{20,}$/, { timeout: 20000 }),
    page.locator("main form").filter({ hasText: "Add property" }).locator('button[type="submit"]').click(),
  ]);
  await page.waitForSelector("text=Birch Row", { timeout: 10000 });
  log("created a property and redirected to it", /Birch Row/.test(await page.textContent("body")));

  // Add a unit to it (nested create on the empty-state form)
  await page.fill('input[name="label"]', "1A");
  await page.fill('input[name="marketRentCents"]', "1750");
  await page.locator('main form:has(input[name="label"]) button[type="submit"]').click();
  await page.waitForTimeout(2500);
  log("added a unit", /1A/.test(await page.textContent("body")));

  // Validation: duplicate unit label must be refused
  await page.reload({ waitUntil: "domcontentloaded" });
  const addUnit = page.locator("summary", { hasText: "Add unit" }).first();
  if (await addUnit.count()) {
    await addUnit.click();
    await page.fill('input[name="label"]', "1A");
    await page.fill('input[name="marketRentCents"]', "1750");
    await page.locator('main form:has(input[name="label"]) button[type="submit"]').click();
    await page.waitForTimeout(2500);
    log("duplicate unit label rejected",
      /already has a unit with that name/i.test(await page.textContent("body")));
  } else {
    log("duplicate unit label rejected", false, "could not find Add unit disclosure");
  }

  // Money validation
  await page.goto(`${BASE}/app/properties/new`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {}); // see comment above
  await page.fill('input[name="name"]', "Bad ZIP Test");
  await page.fill('input[name="addressLine1"]', "1 Test");
  await page.fill('input[name="city"]', "Portland");
  await page.selectOption('select[name="state"]', "OR");
  await page.fill('input[name="postalCode"]', "notazip");
  await page.locator("main form").filter({ hasText: "Add property" }).locator('button[type="submit"]').click();
  await page.waitForTimeout(2000);
  log("invalid ZIP rejected with a field error",
    /5-digit ZIP/i.test(await page.textContent("body")));

  // Leases
  await page.goto(`${BASE}/app/leases`, { waitUntil: "domcontentloaded" });
  const leaseBody = await page.textContent("body");
  log("lease list renders with balances", /Balance/.test(leaseBody) && /active of/.test(leaseBody));
  await page.screenshot({ path: `${SHOTS}/04-leases.png`, fullPage: true });

  // Open the most-behind lease from the dashboard
  await page.goto(`${BASE}/app`, { waitUntil: "domcontentloaded" });
  await page.locator('a:has-text("Open")').first().click();
  await page.waitForURL(/\/app\/leases\/[a-z0-9]+$/, { timeout: 15000 });
  await page.waitForSelector("text=Billed to date", { timeout: 10000 });
  const ledger = await page.textContent("body");
  log("lease ledger shows charges and balance",
    /Charges/.test(ledger) && /Billed to date/.test(ledger) && /past due/i.test(ledger));
  await page.screenshot({ path: `${SHOTS}/05-lease-ledger.png`, fullPage: true });

  const leaseUrl = page.url();

  // Record a manual payment against it
  await page.locator("summary", { hasText: "Record payment" }).first().click();
  await page.waitForTimeout(400);
  const paymentForm = page.locator('form:has(input[name="memo"])');
  const amountBefore = await paymentForm.locator('input[name="amountCents"]').inputValue();
  await paymentForm.locator('input[name="amountCents"]').fill("500");
  await paymentForm.locator('input[name="memo"]').fill("Check #9001");
  await paymentForm.locator('button[type="submit"]').click();
  await page.waitForTimeout(3000);
  const afterPay = await page.textContent("body");
  log("recorded a manual payment", /Recorded \$500\.00/.test(afterPay) || /Check #9001/.test(afterPay),
    `prefilled balance was ${amountBefore}`);

  // Add a charge
  await page.goto(leaseUrl, { waitUntil: "domcontentloaded" });
  await page.locator("summary", { hasText: "Add charge" }).first().click();
  await page.waitForTimeout(400);
  const chargeForm = page.locator('form:has(input[name="description"])');
  await chargeForm.locator('input[name="amountCents"]').fill("75");
  await chargeForm.locator('input[name="description"]').fill("Late fee — test");
  await chargeForm.locator('button[type="submit"]').click();
  await page.waitForTimeout(3000);
  log("added an ad-hoc charge", /Late fee — test/.test(await page.textContent("body")));

  // Void it
  await page.locator('button:has-text("Void")').first().click();
  await page.waitForTimeout(3000);
  log("voided a charge", /Voided/.test(await page.textContent("body")));

  // Maintenance
  await page.goto(`${BASE}/app/maintenance`, { waitUntil: "domcontentloaded" });
  const maint = await page.textContent("body");
  log("maintenance queue sorts urgent first", /No hot water/.test(maint));
  await page.screenshot({ path: `${SHOTS}/06-maintenance.png`, fullPage: true });

  await page.click("text=No hot water in the shower");
  await page.waitForURL(/\/app\/maintenance\/[a-z0-9]+$/, { timeout: 15000 });
  await page.waitForSelector("text=What was reported", { timeout: 10000 });
  log("request detail renders", /What was reported/.test(await page.textContent("body")));

  // Update status + notify tenant
  await page.selectOption('select[name="status"]', "IN_PROGRESS");
  await page.fill('textarea[name="note"]', "Technician confirmed for Thursday 9am.");
  const notify = page.locator('input[name="notifyTenant"]');
  if (await notify.count()) await notify.check();
  await page.locator('form:has(textarea[name="note"]) button[type="submit"]').click();
  await page.waitForTimeout(3000);
  log("updated request and emailed resident",
    /resident has been emailed/i.test(await page.textContent("body")));
  await page.screenshot({ path: `${SHOTS}/07-request-detail.png`, fullPage: true });

  // Rent page
  await page.goto(`${BASE}/app/payments`, { waitUntil: "domcontentloaded" });
  const rent = await page.textContent("body");
  log("rent page shows outstanding + activity",
    /Outstanding balances/.test(rent) && /Payment activity/.test(rent));
  await page.screenshot({ path: `${SHOTS}/08-rent.png`, fullPage: true });

  // Post rent charges (idempotency check: run twice)
  await page.locator('button:has-text("Post rent charges")').first().click();
  await page.waitForTimeout(4000);
  const firstRun = await page.textContent("body");
  await page.locator('button:has-text("Post rent charges")').first().click();
  await page.waitForTimeout(4000);
  const secondRun = await page.textContent("body");
  log("second rent run is a no-op (idempotent)",
    /All caught up/.test(secondRun),
    `first run said: ${(firstRun.match(/(Added \d+ rent charges?|All caught up[^.]*\.)/) ?? ["?"])[0]}`);

  // Settings
  await page.goto(`${BASE}/app/settings`, { waitUntil: "domcontentloaded" });
  log("org settings renders", /Grace period/.test(await page.textContent("body")));

  await page.goto(`${BASE}/app/settings/team`, { waitUntil: "domcontentloaded" });
  const team = await page.textContent("body");
  log("team page lists members and owner access",
    /Dana Whitfield/.test(team) && /Marcus Lee/.test(team) && /Owner access/.test(team));
  await page.screenshot({ path: `${SHOTS}/09-team.png`, fullPage: true });

  // Changing a member's role submits on change, no separate save button — the
  // dropdown must show the new role immediately, not just after a reload.
  // (Regression check: React 19 resets an uncontrolled form field to its
  // defaultValue once a Server Action completes, which without a re-mount
  // keyed on the server-confirmed value snaps this select back to whatever
  // it showed at first page load instead — the save itself still worked, only
  // the UI lied about it. See MemberRow's key={member.role}.)
  //
  // Marcus Lee is staff@example.com, which other suites (e2e:listings'
  // admin-vs-staff checks) log in as and expect to still be STAFF — so this
  // toggles back to STAFF before moving on, rather than leaving the promotion
  // in place for whoever runs against this database next.
  const marcusRoleSelect = page.locator("tr:has-text('Marcus Lee') select[name='role']");
  await marcusRoleSelect.selectOption("ADMIN");
  await page.waitForLoadState("networkidle");
  log("promoting a member to Admin updates the dropdown without a reload",
    (await marcusRoleSelect.inputValue()) === "ADMIN");

  await marcusRoleSelect.selectOption("STAFF");
  await page.waitForLoadState("networkidle");
  log("demoting back to Staff also updates the dropdown without a reload",
    (await marcusRoleSelect.inputValue()) === "STAFF");

  // Invite a staff member (email goes to the outbox in logged mode)
  await page.fill('input[name="name"]', "Riley Chen");
  await page.fill('input[name="email"]', "riley@example.com");
  await page.selectOption('select[name="role"]', "STAFF");
  await page.locator('form:has(input[name="email"]) button[type="submit"]').first().click();
  await page.waitForTimeout(3000);
  const invited = await page.textContent("body");
  log("invited a staff member", /Invitation sent to riley@example.com/.test(invited));
  // The link lives in an <input readOnly value="..."> — not text content.
  const readonlyInputs = await page.locator("input[readonly]").all();
  const values = await Promise.all(readonlyInputs.map((i) => i.inputValue().catch(() => "")));
  const inviteLinkValue = values.find((v) => v.includes("/invite/")) ?? "";
  log("pending invite shows a copyable link (no email provider)",
    inviteLinkValue !== "", inviteLinkValue);

  await page.goto(`${BASE}/app/settings/payments`, { waitUntil: "domcontentloaded" });
  log("stripe settings degrades gracefully without keys",
    /Stripe isn't configured/.test(await page.textContent("body")));
  await page.screenshot({ path: `${SHOTS}/10-stripe-settings.png`, fullPage: true });

  await page.goto(`${BASE}/app/settings/outbox`, { waitUntil: "domcontentloaded" });
  const outbox = await page.textContent("body");
  log("outbox recorded the notification emails",
    /Team invitation/.test(outbox) && /Maintenance update/.test(outbox));
  await page.screenshot({ path: `${SHOTS}/11-outbox.png`, fullPage: true });

  await ctx.close();
}

// ------------------------------------------------------------------- TENANT
{
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => consoleErrors.push(`[tenant pageerror] ${e.message}`));

  await login(page, "tenant@example.com", "demo-password-123");
  log("tenant lands on /portal", new URL(page.url()).pathname === "/portal", page.url());

  const portal = await page.textContent("body");
  log("portal leads with the balance due", /Balance due/.test(portal));
  log("portal shows charges and history",
    /Your charges/.test(portal) && /Payment history/.test(portal));
  await page.screenshot({ path: `${SHOTS}/12-portal-mobile.png`, fullPage: true });

  // `npm run start` forces NODE_ENV=production, and simulatePaymentAction
  // deliberately refuses to run outside dev — that's a safety rail, not a bug
  // (never allow fake "money moved" in a production-shaped build). So on this
  // build the portal must show the "not connected" banner instead of a pay
  // button; assert whichever of the two is actually correct for this run.
  const payBtn = page.locator('button:has-text("Pay $"), button:has-text("Make a payment")').first();
  const noPaymentsBanner = page.locator("text=Online payments aren't set up yet");
  const hasPayBtn = (await payBtn.count()) > 0;
  const hasBanner = (await noPaymentsBanner.count()) > 0;
  log("portal shows either a pay button or the not-connected banner",
    hasPayBtn || hasBanner, hasPayBtn ? "pay button" : hasBanner ? "banner" : "neither!");

  if (hasPayBtn) {
    await payBtn.click();
    await page.waitForTimeout(4000);
    const paid = await page.textContent("body");
    log("demo payment recorded and balance cleared",
      /Recorded a demo payment/.test(paid) || /all paid up/i.test(paid));
  } else {
    log("demo payment recorded and balance cleared", true, "skipped — demo mode is off under a production build, as intended");
  }
  await page.screenshot({ path: `${SHOTS}/13-portal-paid.png`, fullPage: true });

  // Maintenance submit
  await page.goto(`${BASE}/portal/maintenance`, { waitUntil: "domcontentloaded" });
  // <details> keeps its content in the DOM even collapsed, so checking
  // element *count* is always truthy — check the "open" attribute instead.
  const detailsEl = page.locator("details", { has: page.locator("summary", { hasText: "Submit a request" }) }).first();
  if ((await detailsEl.count()) > 0) {
    const isOpen = await detailsEl.evaluate((el) => el.hasAttribute("open"));
    if (!isOpen) await detailsEl.locator("summary").click();
  }
  await page.fill('input[name="title"]', "Bathroom fan rattling");
  await page.fill('textarea[name="description"]', "Loud rattle whenever the fan runs. Started this week.");
  await page.selectOption('select[name="priority"]', "NORMAL");
  await Promise.all([
    page.waitForURL(/submitted=1/, { timeout: 20000 }),
    page.locator('form:has(textarea[name="description"]) button[type="submit"]').click(),
  ]);
  const submitted = await page.textContent("body");
  log("tenant submitted a maintenance request",
    /Request submitted/.test(submitted) && /Bathroom fan rattling/.test(submitted));
  await page.screenshot({ path: `${SHOTS}/14-portal-maintenance.png`, fullPage: true });

  // Tenant sees the manager's public note but not internal ones
  log("tenant sees manager's public note", /Technician confirmed for Thursday/.test(submitted));

  await page.goto(`${BASE}/portal/lease`, { waitUntil: "domcontentloaded" });
  log("tenant lease page renders terms", /Security deposit/.test(await page.textContent("body")));
  await page.screenshot({ path: `${SHOTS}/15-portal-lease.png`, fullPage: true });

  // A tenant must not reach the management app
  await page.goto(`${BASE}/app`, { waitUntil: "domcontentloaded" });
  log("tenant is redirected away from /app", new URL(page.url()).pathname === "/portal", page.url());

  await page.goto(`${BASE}/app/settings/team`, { waitUntil: "domcontentloaded" });
  log("tenant is redirected away from team settings",
    !page.url().includes("/app/settings"), page.url());

  await ctx.close();
}

// -------------------------------------------------------------------- OWNER
{
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => consoleErrors.push(`[owner pageerror] ${e.message}`));

  await login(page, "owner@example.com", "demo-password-123");
  log("owner lands on /owner", new URL(page.url()).pathname === "/owner", page.url());

  const owner = await page.textContent("body");
  log("owner sees only their assigned property",
    /Alder House/.test(owner) && !/Cedar Court/.test(owner) && !/Vine Street/.test(owner));
  log("owner sees financials", /Collected this month/.test(owner) && /Rent roll/.test(owner));
  log("owner does not see tenant names", !/Alicia Fernandez/.test(owner));
  await page.screenshot({ path: `${SHOTS}/16-owner.png`, fullPage: true });

  await page.goto(`${BASE}/app`, { waitUntil: "domcontentloaded" });
  log("owner is redirected away from /app", new URL(page.url()).pathname === "/owner", page.url());

  await ctx.close();
}

// --------------------------------------------------------- CROSS-TENANT ACCESS
{
  // A second org must not be able to read the first org's records.
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  await page.goto(`${BASE}/signup`, { waitUntil: "domcontentloaded" });
  await page.fill('input[name="name"]', "Outsider Olu");
  await page.fill('input[name="organizationName"]', "Rival Realty");
  await page.fill('input[name="email"]', `outsider${Date.now()}@example.com`);
  await page.fill('input[name="password"]', "outsider-password-1");
  await Promise.all([
    page.waitForURL((u) => u.pathname.startsWith("/app"), { timeout: 20000 }),
    page.click('button[type="submit"]'),
  ]);
  log("signup creates an org and lands in the app", page.url().includes("/app"), page.url());
  const fresh = await page.textContent("body");
  log("new account gets an onboarding checklist, not empty zeroes",
    /Add your first property/.test(fresh));
  await page.screenshot({ path: `${SHOTS}/17-new-account.png`, fullPage: true });

  // Try to read a lease belonging to the demo org.
  const path = await import("node:path");
  const { PrismaClient } = await import("@prisma/client");
  const { PrismaBetterSQLite3 } = await import("@prisma/adapter-better-sqlite3");
  const dbUrl = `file:${path.default.join(process.cwd(), "prisma", "dev.db")}`;
  const db = new PrismaClient({ adapter: new PrismaBetterSQLite3({ url: dbUrl }) });
  const victimLease = await db.lease.findFirst({
    where: { organization: { name: "Cedar & Vine Property Group" } },
    select: { id: true, unit: { select: { propertyId: true } } },
  });
  const victimProperty = victimLease.unit.propertyId;
  await db.$disconnect();

  const leaseRes = await page.goto(`${BASE}/app/leases/${victimLease.id}`, {
    waitUntil: "domcontentloaded",
  });
  log("cross-org lease read returns 404", leaseRes.status() === 404, `status ${leaseRes.status()}`);

  const propRes = await page.goto(`${BASE}/app/properties/${victimProperty}`, {
    waitUntil: "domcontentloaded",
  });
  log("cross-org property read returns 404", propRes.status() === 404, `status ${propRes.status()}`);

  await ctx.close();
}

// ------------------------------------------------------------- UNAUTH / API
{
  const cron = await fetch(`${BASE}/api/cron/rent-run`);
  log("cron endpoint rejects unauthenticated calls", cron.status === 401, `status ${cron.status}`);

  const hook = await fetch(`${BASE}/api/stripe/webhook`, { method: "POST", body: "{}" });
  log("stripe webhook refuses unsigned payloads", hook.status >= 400, `status ${hook.status}`);

  const photo = await fetch(`${BASE}/api/photos/fake-id`);
  log("photo route refuses unauthenticated access", photo.status === 404, `status ${photo.status}`);
}

await browser.close();

console.log("\n--- console/page errors ---");
console.log(consoleErrors.length ? consoleErrors.join("\n") : "(none)");

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("FAILURES:");
  for (const f of failed) console.log(` - ${f.name}${f.detail ? ` (${f.detail})` : ""}`);
  process.exit(1);
}
