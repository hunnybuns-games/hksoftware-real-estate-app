import { BASE, artifactPath, launchBrowser } from "./_shared.mjs";

/**
 * Dark mode.
 *
 * The interesting half of this suite isn't the toggle, it's `auditDarkSurfaces`:
 * it walks every rendered element and flags anything still painting a light
 * background or near-black text while the page is in dark mode. That's the check
 * that catches a screen someone forgot — which matters here because the app has
 * ~50 files touching colour, and "looks fine on the two pages I opened" is how
 * dark mode ships half-done.
 */

const results = [];
function log(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

/**
 * Returns the elements that look like light-mode leftovers.
 *
 * Only opaque backgrounds count. Translucent washes (`bg-white/10` on a tinted
 * banner, for instance) are how the accent panels are built in dark mode and
 * they composite correctly, so alpha < 1 is skipped rather than guessed at.
 *
 * The helpers are declared inside the callback rather than shared with the module
 * above: this body is serialised and run in the browser, so it can't close over
 * anything on the Node side.
 */
async function auditDarkSurfaces(page) {
  return page.evaluate(() => {
    function parse(value) {
      const m = value.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
      const [r, g, b] = parts;
      const a = parts.length > 3 ? parts[3] : 1;
      return { r, g, b, a };
    }
    function lum(r, g, b) {
      const ch = (v) => {
        const c = v / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
    }

    const problems = [];
    for (const el of document.body.querySelectorAll("*")) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none") continue;

      const describe = () =>
        `<${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? ` class="${el.className.slice(0, 90)}"` : ""}>`;

      const bg = parse(style.backgroundColor);
      if (bg && bg.a === 1 && lum(bg.r, bg.g, bg.b) > 0.7) {
        problems.push({ kind: "light-background", color: style.backgroundColor, el: describe() });
        continue;
      }

      // Near-black text only matters where it sits on something dark. If the
      // element painted its own light background it's a deliberate light island
      // (a brand button, an image) and the background check above already ruled.
      const fg = parse(style.color);
      const hasOwnLightBg = bg && bg.a > 0.5 && lum(bg.r, bg.g, bg.b) > 0.4;
      if (fg && fg.a > 0.5 && lum(fg.r, fg.g, fg.b) < 0.06 && !hasOwnLightBg && el.textContent?.trim()) {
        problems.push({ kind: "near-black-text", color: style.color, el: describe() });
      }
    }
    return problems;
  });
}

/**
 * Navigates, audits, and reports one surface.
 *
 * The rendered-content guard matters more than it looks: a 404 or an error
 * boundary is a nearly empty page and passes the colour audit trivially, so
 * without it a typo in a path would read as a clean PASS. Ask me how I know —
 * `/portal/payments`, which doesn't exist, passed on the first run.
 */
async function auditSurface(page, name, path) {
  await page.goto(`${BASE}${path}`);
  await page.waitForLoadState("networkidle");

  const body = (await page.textContent("body")) ?? "";
  const rendered =
    body.length > 200 &&
    !/This page could not be found|Something went wrong|404/.test(body) &&
    (await page.locator("main *").count()) > 10;
  if (!rendered) {
    log(`${name} renders at all`, false, `${path} — ${body.slice(0, 80).replace(/\s+/g, " ")}`);
    return false;
  }

  const problems = await auditDarkSurfaces(page);
  const ok = problems.length === 0;
  if (!ok) {
    await page.screenshot({
      path: artifactPath(`theme-dark-${path.replace(/\W+/g, "-")}.png`),
      fullPage: true,
    });
    for (const p of problems.slice(0, 6)) console.log(`        ${p.kind} ${p.color} ${p.el}`);
    if (problems.length > 6) console.log(`        …and ${problems.length - 6} more`);
  }
  log(`${name} has no light-mode leftovers in dark mode`, ok, `${problems.length} problem(s)`);
  return ok;
}

const browser = await launchBrowser();

// --- OS default, no stored preference -------------------------------------
// An OS set to dark has to give a dark app on the very first visit, before
// anyone has touched the toggle. This is the case a class-only implementation
// gets wrong.
const darkOs = await browser.newContext({ colorScheme: "dark" });
const pageDark = await darkOs.newPage();
await pageDark.goto(`${BASE}/`);
log(
  "OS dark preference alone puts the app in dark mode",
  await pageDark.evaluate(() => document.documentElement.classList.contains("dark")),
);
log(
  "dark mode sets color-scheme so native controls and scrollbars follow",
  (await pageDark.evaluate(() => getComputedStyle(document.documentElement).colorScheme)) === "dark",
);

const lightOs = await browser.newContext({ colorScheme: "light" });
const pageLight = await lightOs.newPage();
await pageLight.goto(`${BASE}/`);
log(
  "OS light preference alone leaves the app in light mode",
  await pageLight.evaluate(() => !document.documentElement.classList.contains("dark")),
);

// --- Explicit choice beats the OS, and survives a reload ------------------
await pageLight.getByRole("radio", { name: "Dark" }).click();
log(
  "picking Dark on a light OS switches immediately",
  await pageLight.evaluate(() => document.documentElement.classList.contains("dark")),
);
await pageLight.reload();
log(
  "the choice is remembered across a reload",
  await pageLight.evaluate(() => document.documentElement.classList.contains("dark")),
);
log(
  "the remembered choice is reflected in the control, not just the colours",
  (await pageLight.getByRole("radio", { name: "Dark" }).getAttribute("aria-checked")) === "true",
);

await pageDark.getByRole("radio", { name: "Light" }).click();
await pageDark.reload();
log(
  "picking Light on a dark OS is remembered too (a boolean couldn't express this)",
  await pageDark.evaluate(() => !document.documentElement.classList.contains("dark")),
);
await pageDark.getByRole("radio", { name: "System" }).click();
log(
  "System hands control back to the OS",
  await pageDark.evaluate(() => document.documentElement.classList.contains("dark")),
);

// --- No flash of light -----------------------------------------------------
// The theme has to be decided before the browser paints anything, which means
// the deciding script must be in the server's HTML *ahead of the body*. Asserted
// against the raw markup rather than by sampling the live page: by the time
// Playwright can evaluate anything the script has already run either way, so a
// runtime check would pass even if the script had been moved into an effect —
// and a component effect is exactly the mistake that causes the white flash.
const html = await (await fetch(`${BASE}/login`)).text();
const scriptAt = html.indexOf("prefers-color-scheme");
const bodyAt = html.indexOf("<body");
log(
  "the theme script is in the document head, ahead of the body (no white flash)",
  scriptAt !== -1 && bodyAt !== -1 && scriptAt < bodyAt,
  `script@${scriptAt} body@${bodyAt}`,
);

// --- Every signed-in surface, audited in dark mode -------------------------
const app = await browser.newContext({ colorScheme: "dark" });
const page = await app.newPage();
const stamp = Date.now();
await page.goto(`${BASE}/signup`);
await page.locator('input[name="name"]').fill("Theme Admin");
await page.locator('input[name="organizationName"]').fill(`Theme Org ${stamp}`);
await page.locator('input[name="email"]').fill(`theme-${stamp}@example.com`);
await page.locator('input[name="password"]').fill("correct-horse-battery-T");
await page.locator('button[type="submit"]').click();
await page.waitForURL(/\/app/, { timeout: 15000 });

// A property and a unit, so the list and detail screens have something to paint
// other than empty states.
await page.goto(`${BASE}/app/properties/new`);
await page.locator('input[name="name"]').fill("Dark Mode Manor");
await page.locator('input[name="addressLine1"]').fill("1 Night St");
await page.locator('input[name="city"]').fill("Testville");
await page.locator('select[name="state"]').selectOption("CA");
await page.locator('input[name="postalCode"]').fill("90001");
// Scoped to the form: the shell renders two Sign out submit buttons of its own.
await page.locator('main form button[type="submit"]').click();
await page.waitForURL(/\/app\/properties\/[^/]+$/, { timeout: 15000 });
const propertyUrl = page.url();

const surfaces = [
  ["dashboard", "/app"],
  ["properties list", "/app/properties"],
  ["property detail", new URL(propertyUrl).pathname],
  ["new property form", "/app/properties/new"],
  ["leases", "/app/leases"],
  ["tenants", "/app/tenants"],
  ["payments", "/app/payments"],
  ["payment import", "/app/payments/import"],
  ["maintenance", "/app/maintenance"],
  ["reports", "/app/reports"],
  ["settings — organization", "/app/settings"],
  ["settings — team", "/app/settings/team"],
  ["settings — rent collection", "/app/settings/payments"],
  ["settings — email outbox", "/app/settings/outbox"],
];

/*
 * Self-test for the audit, before trusting a run of clean results.
 *
 * "0 problems on every page" is also what a broken audit reports, and a check
 * that can only pass is worse than no check. So: point the same function at the
 * dashboard in *light* mode, where white cards and near-black headings are
 * correct and plentiful. If that doesn't light up, the audit is a no-op and every
 * PASS below is meaningless.
 */
await page.goto(`${BASE}/app`);
await page.getByRole("radio", { name: "Light" }).first().click();
await page.waitForLoadState("networkidle");
const lightModeProblems = await auditDarkSurfaces(page);
log(
  "the audit itself works — it flags the light theme it's designed to catch",
  lightModeProblems.length > 5,
  `${lightModeProblems.length} problem(s) found in light mode`,
);
await page.getByRole("radio", { name: "Dark" }).first().click();

let auditFailures = 0;
for (const [name, path] of surfaces) {
  if (!(await auditSurface(page, name, path))) auditFailures++;
}

// --- The surfaces outside the staff app ------------------------------------
// Signed-out pages first: no setup, and the sign-in page is the one a dark-mode
// user meets before anything else.
const anon = await (await browser.newContext({ colorScheme: "dark" })).newPage();
for (const [name, path] of [
  ["landing page", "/"],
  ["sign-in page", "/login"],
  ["sign-up page", "/signup"],
]) {
  if (!(await auditSurface(anon, name, path))) auditFailures++;
}

/*
 * The tenant portal and owner dashboard use the seeded demo accounts, the same
 * way e2e/mvp.mjs does — building a tenant with a lease and an accepted portal
 * invitation from scratch would be most of that suite over again. Run
 * `npm run db:seed` if these fail to sign in.
 */
async function auditAs(role, email, paths) {
  const ctx = await browser.newContext({ colorScheme: "dark" });
  const rolePage = await ctx.newPage();
  await rolePage.goto(`${BASE}/login`);
  await rolePage.fill('input[name="email"]', email);
  await rolePage.fill('input[name="password"]', "demo-password-123");
  await rolePage.click('main form button[type="submit"]');
  const signedIn = await rolePage
    .waitForURL((u) => !u.pathname.includes("/login") && u.pathname !== "/", { timeout: 20000 })
    .then(() => true)
    .catch(() => false);
  log(`signed in as the seeded ${role} (needs npm run db:seed)`, signedIn, rolePage.url());
  if (!signedIn) return;

  for (const [name, path] of paths) {
    if (!(await auditSurface(rolePage, name, path))) auditFailures++;
  }
  await rolePage.goto(`${BASE}${paths[0][1]}`);
  await rolePage.screenshot({ path: artifactPath(`theme-${role}-dark.png`), fullPage: true });
  await ctx.close();
}

await auditAs("tenant", "tenant@example.com", [
  ["portal home", "/portal"],
  ["portal lease", "/portal/lease"],
  ["portal maintenance", "/portal/maintenance"],
]);

await auditAs("owner", "owner@example.com", [["owner dashboard", "/owner"]]);

// Keep a reference shot of the densest screen in each theme, for eyeballing.
await page.goto(`${BASE}/app`);
await page.screenshot({ path: artifactPath("theme-dashboard-dark.png"), fullPage: true });
await page.getByRole("radio", { name: "Light" }).first().click();
await page.screenshot({ path: artifactPath("theme-dashboard-light.png"), fullPage: true });

await browser.close();

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
if (auditFailures > 0) {
  console.log(`screenshots of the failing surfaces are in e2e/.artifacts/`);
}
process.exitCode = passed === results.length ? 0 : 1;
