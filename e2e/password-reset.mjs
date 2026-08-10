import { BASE, launchBrowser } from "./_shared.mjs";

/**
 * Password reset, end to end through the app's own email log.
 *
 * Nothing is delivered locally, so the log at /app/settings/outbox is the inbox —
 * the same trick e2e/security.mjs uses for invitations. That's also why the link
 * is readable here at all: in production a reset link is stripped before it's
 * recorded (see `sensitive` in src/lib/email.ts).
 *
 * The checks that matter are the negative ones. A reset flow that works is easy;
 * one that doesn't leak which addresses have accounts, doesn't let a link be
 * replayed, and doesn't leave the old password working is the actual requirement.
 */

const results = [];
function log(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const browser = await launchBrowser();
const stamp = Date.now();
const email = `reset-${stamp}@example.com`;
const OLD_PASSWORD = "original-password-A1";
const NEW_PASSWORD = "replacement-password-B2";

/**
 * Waits for a sign-in to actually finish.
 *
 * Both signing in and redeeming a reset link send you to `/`, which then bounces
 * to the right home for your role — so leaving the form's own URL isn't the end
 * of the journey. Waiting only for that lands on `/` and reads as a failure.
 * e2e/mvp.mjs's login helper does the same two-stage wait for the same reason.
 */
async function waitForRoleHome(page) {
  await page.waitForURL((u) => u.pathname !== "/", { timeout: 20000 }).catch(() => {});
  await page.waitForLoadState("networkidle").catch(() => {});
}

async function requestReset(page, address) {
  await page.goto(`${BASE}/forgot-password`);
  await page.locator('input[name="email"]').fill(address);
  await page.locator('main form button[type="submit"]').click();
  await page.waitForTimeout(1200);
  return (await page.textContent("body")) ?? "";
}

// --- An account to lock ourselves out of -----------------------------------
const admin = await (await browser.newContext()).newPage();
await admin.goto(`${BASE}/signup`);
await admin.locator('input[name="name"]').fill("Reset Tester");
await admin.locator('input[name="organizationName"]').fill(`Reset Org ${stamp}`);
await admin.locator('input[name="email"]').fill(email);
await admin.locator('input[name="password"]').fill(OLD_PASSWORD);
await admin.locator('main form button[type="submit"]').click();
await admin.waitForURL(/\/app/, { timeout: 15000 });
log("signed up an account to reset", admin.url().includes("/app"));

// --- The sign-in page has to offer a way out -------------------------------
// Discoverability is the feature. A reset flow nobody can find is the same as no
// reset flow, and a locked-out landlord can't be told the URL by anyone.
const anon = await (await browser.newContext()).newPage();
await anon.goto(`${BASE}/login`);
const forgotLink = anon.getByRole("link", { name: /forgot your password/i });
log("sign-in page links to the reset flow", (await forgotLink.count()) > 0);

// --- No account enumeration ------------------------------------------------
// The response for an address that exists and one that doesn't must be
// identical, or this form is a free "which of these people are customers" oracle.
const realResponse = await requestReset(anon, email);
const fakeResponse = await requestReset(anon, `definitely-not-a-user-${stamp}@example.com`);
const bothConfirm = /reset link is on its way/i.test(realResponse) && /reset link is on its way/i.test(fakeResponse);
log("an unknown address gets the same answer as a real one", bothConfirm);
log(
  "the response never says whether the account exists",
  !/no account|not found|doesn't exist|unknown/i.test(realResponse + fakeResponse),
);

// --- Follow the link -------------------------------------------------------
await admin.goto(`${BASE}/app/settings/outbox`, { waitUntil: "networkidle" });
const outbox = await admin.textContent("body");
const resetPath = (outbox ?? "").match(/\/reset-password\/[A-Za-z0-9_-]+/)?.[0] ?? null;
log("the reset email records a usable link", Boolean(resetPath), resetPath ?? "not found");

if (!resetPath) {
  await browser.close();
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed`);
  process.exitCode = 1;
} else {
  // A fresh context: the point of this flow is someone who cannot sign in.
  const lockedOut = await (await browser.newContext()).newPage();
  await lockedOut.goto(`${BASE}${resetPath}`);
  log(
    "the link opens a set-a-new-password form naming the account",
    (await lockedOut.locator('input[name="password"]').count()) > 0 &&
      ((await lockedOut.textContent("body")) ?? "").includes(email),
  );

  // Weak passwords are rejected here too — the reset form is a second door onto
  // the same requirement, and it would be easy to leave it unguarded.
  await lockedOut.locator('input[name="password"]').fill("short1");
  await lockedOut.locator('main form button[type="submit"]').click();
  await lockedOut.waitForTimeout(1000);
  log(
    "a weak new password is rejected",
    lockedOut.url().includes("/reset-password"),
    lockedOut.url(),
  );

  await lockedOut.locator('input[name="password"]').fill(NEW_PASSWORD);
  await lockedOut.locator('main form button[type="submit"]').click();
  await lockedOut.waitForURL((u) => !u.pathname.includes("/reset-password"), { timeout: 20000 });
  await waitForRoleHome(lockedOut);
  log("setting a new password signs you straight in", lockedOut.url().includes("/app"), lockedOut.url());

  // --- Single use ----------------------------------------------------------
  // The link lives in an inbox forever. If it stays redeemable it's a standing
  // key to the account, so replaying it must fail.
  const replay = await (await browser.newContext()).newPage();
  await replay.goto(`${BASE}${resetPath}`);
  const replayBody = (await replay.textContent("body")) ?? "";
  log(
    "the same link can't be used twice",
    /isn't usable/i.test(replayBody) && (await replay.locator('input[name="password"]').count()) === 0,
  );

  // --- The old password is really gone -------------------------------------
  const oldPw = await (await browser.newContext()).newPage();
  await oldPw.goto(`${BASE}/login`);
  await oldPw.locator('input[name="email"]').fill(email);
  await oldPw.locator('input[name="password"]').fill(OLD_PASSWORD);
  await oldPw.locator('main form button[type="submit"]').click();
  await oldPw.waitForTimeout(1500);
  log(
    "the old password no longer works",
    oldPw.url().includes("/login"),
    oldPw.url(),
  );

  const newPw = await (await browser.newContext()).newPage();
  await newPw.goto(`${BASE}/login`);
  await newPw.locator('input[name="email"]').fill(email);
  await newPw.locator('input[name="password"]').fill(NEW_PASSWORD);
  await newPw.locator('main form button[type="submit"]').click();
  await newPw.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20000 }).catch(() => {});
  await waitForRoleHome(newPw);
  log("the new password works", newPw.url().includes("/app"), newPw.url());

  // --- Requesting a second link kills the first ----------------------------
  // This is what someone does when they suspect a link went astray, so the old
  // one must stop working rather than both being live.
  await newPw.goto(`${BASE}/forgot-password`);
  await newPw.locator('input[name="email"]').fill(email);
  await newPw.locator('main form button[type="submit"]').click();
  await newPw.waitForTimeout(1200);
  await newPw.goto(`${BASE}/app/settings/outbox`, { waitUntil: "networkidle" });
  const links = [...((await newPw.textContent("body")) ?? "").matchAll(/\/reset-password\/[A-Za-z0-9_-]+/g)].map((m) => m[0]);
  const newest = links[0] ?? null;
  const superseded = links.find((l) => l !== newest) ?? null;
  log("a second request issues a different link", Boolean(newest && superseded && newest !== superseded));

  if (superseded) {
    const stale = await (await browser.newContext()).newPage();
    await stale.goto(`${BASE}${superseded}`);
    log(
      "requesting a new link invalidates the previous one",
      /isn't usable/i.test((await stale.textContent("body")) ?? ""),
    );
  }

  // --- A garbage token is indistinguishable from an expired one ------------
  const bogus = await (await browser.newContext()).newPage();
  await bogus.goto(`${BASE}/reset-password/not-a-real-token-at-all`);
  log(
    "an invented token is refused without a hint about why",
    /isn't usable/i.test((await bogus.textContent("body")) ?? ""),
  );

  await browser.close();
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
}
