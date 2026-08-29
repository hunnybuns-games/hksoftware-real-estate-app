import { ARTIFACTS, BASE, launchBrowser } from "./_shared.mjs";

const browser = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
// Set the stored preference before any page script runs, so the inline theme
// script in layout.tsx picks dark on the very first paint.
await ctx.addInitScript(() => {
  try {
    localStorage.setItem("rentwell-theme", "dark");
  } catch {}
});
const page = await ctx.newPage();

await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await page.fill('input[name="email"]', "landlord10@example.com");
await page.fill('input[name="password"]', "demo-password-123");
await Promise.all([page.waitForURL((u) => !u.pathname.includes("/login")), page.click('button[type="submit"]')]);

await page.goto(`${BASE}/app/import`, { waitUntil: "networkidle" });
console.log("dark class present:", await page.evaluate(() => document.documentElement.classList.contains("dark")));

// Measure the actual rendered colour of the body copy that looked washed out,
// and of a heading, so the contrast is checked rather than eyeballed.
const sample = await page.evaluate(() => {
  const p = Array.from(document.querySelectorAll("p")).find((el) =>
    el.textContent?.includes("Upload a rent roll"),
  );
  const h = Array.from(document.querySelectorAll("h2,h3")).find((el) =>
    el.textContent?.includes("What this does"),
  );
  const bg = getComputedStyle(document.body).backgroundColor;
  return {
    body: p ? getComputedStyle(p).color : null,
    heading: h ? getComputedStyle(h).color : null,
    pageBg: bg,
  };
});
console.log("rendered colours:", JSON.stringify(sample));

await page.screenshot({ path: `${ARTIFACTS}/dark-import.png`, fullPage: true });

await page.goto(`${BASE}/app/documents`, { waitUntil: "networkidle" });
await page.screenshot({ path: `${ARTIFACTS}/dark-documents.png`, fullPage: true });

await page.goto(`${BASE}/app/import`, { waitUntil: "networkidle" });
const batchLink = page.locator('a[href^="/app/import/"]').first();
if (await batchLink.count()) {
  await batchLink.click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${ARTIFACTS}/dark-review.png`, fullPage: true });
}
await browser.close();
