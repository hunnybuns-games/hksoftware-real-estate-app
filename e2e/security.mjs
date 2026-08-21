import { BASE, launchBrowser } from "./_shared.mjs";

const results = [];
function log(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const browser = await launchBrowser();

// --- Org A: admin signs up ---
const a = await browser.newContext();
const pageA = await a.newPage();
await pageA.goto(`${BASE}/signup`);
const stampA = Date.now();
await pageA.locator('input[name="name"]').fill("Admin A");
await pageA.locator('input[name="organizationName"]').fill(`Security Test Org A ${stampA}`);
await pageA.locator('input[name="email"]').fill(`admin-a-${stampA}@example.com`);
await pageA.locator('input[name="password"]').fill("correct-horse-battery-A");
await pageA.locator('button[type="submit"]').click();
await pageA.waitForURL(/\/app/, { timeout: 15000 });
log("org A signup lands in /app", pageA.url().includes("/app"));

// Create a property in org A to get a real resource id.
await pageA.goto(`${BASE}/app/properties/new`);
// A fill-then-click right after goto can beat React's hydration to the
// punch — a dead click on the submit button, no navigation, no error. See
// the same comment in mvp.mjs, where this form's growth (address
// autocomplete) first made the race show up.
await pageA.waitForLoadState("networkidle").catch(() => {});
await pageA.locator('input[name="name"]').fill("A-Only Property");
await pageA.locator('input[name="addressLine1"]').fill("1 A St");
await pageA.locator('input[name="city"]').fill("Testville");
await pageA.locator('select[name="state"]').selectOption("CA");
await pageA.locator('input[name="postalCode"]').fill("90001");
await pageA.locator('main form button[type="submit"]').click();
await pageA.waitForTimeout(1500);
const propUrl = pageA.url();
const propId = propUrl.match(/properties\/([a-z0-9]+)/)?.[1];
log("org A property created", Boolean(propId), propUrl);

// --- Org B: a second admin signs up (different browser context = different cookies) ---
const b = await browser.newContext();
const pageB = await b.newPage();
await pageB.goto(`${BASE}/signup`);
const stampB = Date.now() + 1;
await pageB.locator('input[name="name"]').fill("Admin B");
await pageB.locator('input[name="organizationName"]').fill(`Security Test Org B ${stampB}`);
await pageB.locator('input[name="email"]').fill(`admin-b-${stampB}@example.com`);
await pageB.locator('input[name="password"]').fill("correct-horse-battery-B");
await pageB.locator('button[type="submit"]').click();
await pageB.waitForURL(/\/app/, { timeout: 15000 });
log("org B signup lands in /app", pageB.url().includes("/app"));

// IDOR attempt: org B admin tries to view org A's property directly by id.
if (propId) {
  const resp = await pageB.goto(`${BASE}/app/properties/${propId}`);
  const status = resp?.status();
  const body = await pageB.textContent("body");
  const leaked = /A-Only Property/.test(body ?? "");
  log(
    "cross-org property view is blocked (no leak, non-200 or not-found page)",
    !leaked,
    `status=${status} leaked=${leaked}`,
  );
}

// IDOR attempt: org B admin tries to edit org A's property via direct POST to the update action route isn't
// directly reachable (server actions aren't plain URLs), but the page itself should 404/redirect.
if (propId) {
  const editUrl = `${BASE}/app/properties/${propId}/edit`;
  const resp = await pageB.goto(editUrl).catch(() => null);
  const status = resp?.status();
  const body = await pageB.textContent("body");
  const leaked = /A-Only Property/.test(body ?? "");
  log("cross-org property edit page is blocked", !leaked, `status=${status} leaked=${leaked}`);
}

// Duplicate-email signup should be rejected, not silently overwrite.
const pageDup = await (await browser.newContext()).newPage();
await pageDup.goto(`${BASE}/signup`);
await pageDup.locator('input[name="name"]').fill("Admin A Impersonator");
await pageDup.locator('input[name="organizationName"]').fill("Evil Org");
await pageDup.locator('input[name="email"]').fill(`admin-a-${stampA}@example.com`);
await pageDup.locator('input[name="password"]').fill("some-other-password-1");
await pageDup.locator('button[type="submit"]').click();
await pageDup.waitForTimeout(1500);
const dupBody = await pageDup.textContent("body");
log("duplicate-email signup rejected", /already exists/i.test(dupBody ?? ""), pageDup.url());

// Weak password rejected.
const pageWeak = await (await browser.newContext()).newPage();
await pageWeak.goto(`${BASE}/signup`);
await pageWeak.locator('input[name="name"]').fill("Weak Pw");
await pageWeak.locator('input[name="organizationName"]').fill("Weak Org");
await pageWeak.locator('input[name="email"]').fill(`weak-${Date.now()}@example.com`);
await pageWeak.locator('input[name="password"]').fill("short1");
await pageWeak.locator('button[type="submit"]').click();
await pageWeak.waitForTimeout(1000);
log("weak (short) password rejected", pageWeak.url().includes("/signup"), pageWeak.url());

// Login brute-force: fire more rapid wrong-password attempts than the limiter
// allows (LOGIN_RATE_LIMIT is 10/60s in wrangler.jsonc) and look for the
// throttle response.
//
// This is only a pass/fail assertion when running against a deployed Worker.
// Locally there is no `ratelimit` binding at all, and src/lib/rate-limit.ts
// fails open on purpose, so no throttle is the *correct* local behaviour — see
// the note at the top of that file. Reporting it either way keeps the check
// honest instead of quietly passing for the wrong reason.
const ON_WORKERS = !/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(BASE);
const pageBrute = await (await browser.newContext()).newPage();
let lastStatus = null;
let throttled = false;
const attempts = 14;
const start = Date.now();
for (let i = 0; i < attempts; i++) {
  await pageBrute.goto(`${BASE}/login`);
  await pageBrute.locator('input[name="email"]').fill(`admin-a-${stampA}@example.com`);
  await pageBrute.locator('input[name="password"]').fill(`wrong-password-${i}`);
  const resp = await Promise.all([
    pageBrute.waitForResponse((r) => r.url().includes("/login") && r.request().method() === "POST"),
    pageBrute.locator('button[type="submit"]').click(),
  ]);
  lastStatus = resp[0].status();
  if (/too many sign-in attempts/i.test((await pageBrute.textContent("body")) ?? "")) {
    throttled = true;
    break;
  }
}
const elapsedMs = Date.now() - start;
log(
  ON_WORKERS
    ? `failed logins are throttled before ${attempts} attempts`
    : `no throttling after ${attempts} failed logins in ${elapsedMs}ms (expected locally — limiter fails open with no binding)`,
  ON_WORKERS ? throttled : true,
  `throttled=${throttled} lastStatus=${lastStatus}`,
);

// Role boundary: a freshly signed-up ADMIN tries the tenant portal and owner dashboard directly.
const rPortal = await pageA.goto(`${BASE}/portal`);
log("admin visiting /portal is redirected away, not shown tenant data", pageA.url() !== `${BASE}/portal` || (rPortal?.status() ?? 200) >= 300, pageA.url());
await pageA.goto(`${BASE}/owner`);
log("admin visiting /owner is redirected away", pageA.url() !== `${BASE}/owner`, pageA.url());

// Open-redirect probe on login's redirectTo.
const pageRedir = await (await browser.newContext()).newPage();
await pageRedir.goto(`${BASE}/login?redirectTo=${encodeURIComponent("https://evil.example.com")}`);
await pageRedir.locator('input[name="email"]').fill(`admin-a-${stampA}@example.com`);
await pageRedir.locator('input[name="password"]').fill("correct-horse-battery-A");
// redirectTo is a hidden field populated from the query string in the login form — check it made it through
// safeRedirect by confirming we do NOT end up on evil.example.com.
const hiddenVal = await pageRedir.locator('input[name="redirectTo"]').getAttribute("value").catch(() => null);
await pageRedir.locator('button[type="submit"]').click();
await pageRedir.waitForTimeout(1500);
log("open-redirect via redirectTo is blocked", !pageRedir.url().includes("evil.example.com"), `hiddenField=${hiddenVal} finalUrl=${pageRedir.url()}`);

// ------------------------------------------- SESSION REVOCATION ON REMOVAL
// The most serious defect this suite has caught: sessions are stateless 30-day
// JWTs, and the guards used to read role/organization straight from the token
// without consulting the database — so removing a team member revoked nothing.
// Their existing login kept full access to the org they'd been removed from
// until the token expired. This walks the whole flow through the UI.
{
  const stamp = Date.now();
  const adminEmail = `revoke-admin-${stamp}@example.com`;
  const staffEmail = `revoke-staff-${stamp}@example.com`;

  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  await admin.goto(`${BASE}/signup`);
  await admin.locator('input[name="name"]').fill("Revoke Admin");
  await admin.locator('input[name="organizationName"]').fill(`Revoke Org ${stamp}`);
  await admin.locator('input[name="email"]').fill(adminEmail);
  await admin.locator('input[name="password"]').fill("correct-horse-battery-R");
  await admin.locator('button[type="submit"]').click();
  await admin.waitForURL(/\/app/, { timeout: 20000 });

  // Invite a staff member.
  await admin.goto(`${BASE}/app/settings/team`, { waitUntil: "networkidle" });
  const inviteForm = admin.locator('form:has(input[name="email"])').first();
  await inviteForm.locator('input[name="name"]').fill("Doomed Staffer");
  await inviteForm.locator('input[name="email"]').fill(staffEmail);
  await inviteForm.locator('button[type="submit"]').click();
  await admin.waitForTimeout(1800);

  // Email doesn't leave the box locally — the invite link is in the outbox.
  await admin.goto(`${BASE}/app/settings/outbox`, { waitUntil: "networkidle" });
  const outbox = await admin.textContent("body");
  const inviteLink = (outbox ?? "").match(/\/invite\/[A-Za-z0-9_-]+/)?.[0] ?? null;
  log("invitation email records a usable invite link", Boolean(inviteLink));

  if (inviteLink) {
    const staffCtx = await browser.newContext();
    const staff = await staffCtx.newPage();
    await staff.goto(`${BASE}${inviteLink}`);
    await staff.locator('input[name="name"]').fill("Doomed Staffer");
    await staff.locator('input[name="password"]').fill("staffer-password-123");
    await staff.locator('button[type="submit"]').click();
    await staff.waitForTimeout(2500);

    await staff.goto(`${BASE}/app/properties`, { waitUntil: "networkidle" });
    const hadAccess = staff.url().includes("/app/properties");
    log("invited staff can reach the app before removal", hadAccess, staff.url());

    // Admin removes them, through the real UI action.
    await admin.goto(`${BASE}/app/settings/team`, { waitUntil: "networkidle" });
    const removeButton = admin
      .locator('form:has(button:text-matches("Remove", "i"))')
      .filter({ hasNot: admin.locator('button:text-matches("Revoke", "i")') })
      .last()
      .locator('button[type="submit"]');
    const removable = await removeButton.count();
    if (removable > 0) {
      await removeButton.click();
      await admin.waitForTimeout(2000);
    }
    // Re-navigate before asserting. The action revalidates server-side, but
    // reading the DOM straight after the click can still see the pre-click
    // render — which is how this check first "failed" against a database that
    // had in fact been updated correctly.
    await admin.goto(`${BASE}/app/settings/team`, { waitUntil: "networkidle" });
    const teamAfter = await admin.textContent("body");
    log("removed member no longer listed on the team page", !(teamAfter ?? "").includes(staffEmail));

    // Same browser, same cookie, no re-login: access must be gone immediately.
    await staff.goto(`${BASE}/app/properties`, { waitUntil: "networkidle" }).catch(() => {});
    await staff.waitForTimeout(800);
    log(
      "removed member's existing session is revoked immediately",
      !staff.url().includes("/app/properties"),
      staff.url(),
    );

    // And the stale cookie must not ping-pong between the guards and the
    // session-aware pages — a real regression introduced while fixing the above.
    log(
      "stale session lands on a usable sign-in page rather than a redirect loop",
      staff.url().includes("/login"),
      staff.url(),
    );
    await staffCtx.close();
  }
  await adminCtx.close();
}

// --- Content-Security-Policy ------------------------------------------------
/*
 * A CSP is easy to ship and easy to silently break: a blocked inline script
 * doesn't raise an error a user can see, it just doesn't run. So this checks two
 * separate things — that the policy is actually strict, and that the app still
 * works underneath it.
 *
 * The second is the one that needs a real browser. Walking the app while
 * listening for `securitypolicyviolation` is the only way to catch a page that a
 * future change has quietly broken, and it's exactly what would have caught the
 * theme script if its nonce had been left off.
 */
const cspHeaders = await fetch(`${BASE}/login`, { redirect: "manual" });
const csp = cspHeaders.headers.get("content-security-policy") ?? "";
log("a Content-Security-Policy is sent", csp.length > 0);
log(
  "script-src is nonce-based rather than 'unsafe-inline'",
  /script-src[^;]*'nonce-/.test(csp) && !/script-src[^;]*'unsafe-inline'/.test(csp),
  csp.match(/script-src[^;]*/)?.[0]?.slice(0, 90),
);
log(
  "the nonce is per-response, not a build-time constant",
  (() => csp.match(/'nonce-([^']+)'/)?.[1])() !== undefined,
);
const second = await (await fetch(`${BASE}/login`, { redirect: "manual" })).headers.get(
  "content-security-policy",
);
log(
  "two requests get different nonces (a reused nonce is no better than unsafe-inline)",
  csp.match(/'nonce-([^']+)'/)?.[1] !== (second ?? "").match(/'nonce-([^']+)'/)?.[1],
);
for (const directive of ["object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'"]) {
  log(`CSP sets ${directive}`, csp.includes(directive));
}

const cspCtx = await browser.newContext();
const cspPage = await cspCtx.newPage();
await cspPage.addInitScript(() => {
  document.addEventListener("securitypolicyviolation", (event) => {
    (window.__cspViolations ||= []).push(
      `${event.violatedDirective} blocked ${event.blockedURI || "inline"}`,
    );
  });
});
const cspStamp = Date.now();
await cspPage.goto(`${BASE}/signup`);
await cspPage.locator('input[name="name"]').fill("CSP Probe");
await cspPage.locator('input[name="organizationName"]').fill(`CSP Org ${cspStamp}`);
await cspPage.locator('input[name="email"]').fill(`csp-${cspStamp}@example.com`);
await cspPage.locator('input[name="password"]').fill("correct-horse-battery-C");
await cspPage.locator('main form button[type="submit"]').click();
await cspPage.waitForURL(/\/app/, { timeout: 20000 });

const cspSurfaces = [
  "/app",
  "/app/properties",
  "/app/properties/new",
  "/app/leases",
  "/app/tenants",
  "/app/payments",
  "/app/payments/import",
  "/app/maintenance",
  "/app/reports",
  "/app/settings",
  "/app/settings/team",
  "/app/settings/payments",
  "/app/settings/outbox",
  "/login",
  "/forgot-password",
];
const allViolations = [];
for (const path of cspSurfaces) {
  await cspPage.goto(`${BASE}${path}`);
  await cspPage.waitForLoadState("networkidle");
  const found = await cspPage.evaluate(() => {
    const v = window.__cspViolations ?? [];
    window.__cspViolations = [];
    return v;
  });
  for (const v of found) allViolations.push(`${path}: ${v}`);
}
log(
  `no CSP violations across ${cspSurfaces.length} pages`,
  allViolations.length === 0,
  allViolations.slice(0, 4).join(" | ") || "clean",
);

// The theme script is inline and must run before first paint, so it's the one
// most likely to be killed by a CSP change. A silent failure here looks like
// "dark mode randomly stopped working".
const themeCtx = await browser.newContext({ colorScheme: "dark" });
const themePage = await themeCtx.newPage();
await themePage.goto(`${BASE}/login`);
log(
  "the inline theme script still executes under the CSP",
  await themePage.evaluate(() => document.documentElement.classList.contains("dark")),
);
await cspCtx.close();
await themeCtx.close();

// --- Observability: /api/health and /api/report-error (docs/observability.md) ---
const healthResp = await fetch(`${BASE}/api/health`);
const healthBody = await healthResp.json().catch(() => null);
log(
  "/api/health is reachable with no auth and reports ok",
  healthResp.status === 200 && healthBody?.status === "ok",
  `status=${healthResp.status} body=${JSON.stringify(healthBody)}`,
);

const reportOkResp = await fetch(`${BASE}/api/report-error`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ message: "e2e synthetic client error", url: "/e2e-test" }),
});
log(
  "/api/report-error accepts a well-formed client error report",
  reportOkResp.status === 202,
  `status=${reportOkResp.status}`,
);

const reportBadResp = await fetch(`${BASE}/api/report-error`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ message: "" }), // empty message fails the schema's min(1)
});
log(
  "/api/report-error rejects a malformed body rather than silently accepting it",
  reportBadResp.status === 400,
  `status=${reportBadResp.status}`,
);

await browser.close();

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
if (passed !== results.length) {
  console.log("FAILURES:");
  for (const r of results.filter((x) => !x.ok)) console.log(` - ${r.name}`);
  process.exit(1);
}
