import path from "node:path";
import { BASE, launchBrowser } from "./_shared.mjs";

/**
 * The listings flow end to end: staff build a listing for a vacant unit,
 * upload a photo, work the manual syndication tracker (status + copy-paste
 * export), and archive it once the unit is leased. Also checks that the
 * per-org platform-connection settings are admin-only and never echo a
 * saved key back to the browser.
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

async function login(page, email, password = "demo-password-123") {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 }),
    page.click('button[type="submit"]'),
  ]);
}

// The exact 8-byte PNG signature (see src/lib/image-signature.ts) followed by
// junk — detectImageType only checks the leading magic bytes, so this is
// enough to pass validation without shipping a real image fixture.
const FAKE_PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("not a real image body, just needs the right header"),
]);

const { PrismaClient } = await import("@prisma/client");
const { PrismaBetterSQLite3 } = await import("@prisma/adapter-better-sqlite3");
const dbUrl = `file:${path.join(process.cwd(), "prisma", "dev.db")}`;
const db = new PrismaClient({ adapter: new PrismaBetterSQLite3({ url: dbUrl }) });

const unit = await db.unit.findFirst({
  where: { property: { organizationId: (await db.user.findFirstOrThrow({ where: { email: "admin@example.com" } })).organizationId } },
  select: { id: true, label: true, marketRentCents: true, property: { select: { name: true } } },
});
await db.$disconnect();

if (!unit) {
  console.log("FAIL  no unit found in the seeded database — can't run this suite");
  process.exit(1);
}

const browser = await launchBrowser();
let listingId;

// ------------------------------------------------------------- build a listing
{
  const ctx = await browser.newContext();
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
  const page = await ctx.newPage();
  await login(page, "admin@example.com");

  await page.goto(`${BASE}/app/listings/new?unitId=${unit.id}`, { waitUntil: "domcontentloaded" });
  check(
    "the unit is preselected in the picker",
    await page.locator('select[name="unitId"]').inputValue() === unit.id,
  );
  check(
    "asking rent is prefilled from the unit's market rent",
    (await page.locator('input[name="askingRentCents"]').inputValue()) ===
      (unit.marketRentCents / 100).toFixed(2),
  );

  await page.fill('textarea[name="description"]', "A bright, freshly painted unit with great light.");
  await page.fill('input[name="amenities"]', "In-unit laundry, Pet friendly");
  await page.setInputFiles('input[name="photos"]', {
    name: "listing.png",
    mimeType: "image/png",
    buffer: FAKE_PNG,
  });

  await Promise.all([
    page.waitForURL(new RegExp(`/app/listings/[a-z0-9]{10,}$`), { timeout: 15000 }),
    page.click('button:has-text("Create listing")'),
  ]);
  listingId = page.url().split("/").pop();
  check("creating redirects to the new listing's detail page", listingId !== "new");

  const body = await page.textContent("body");
  check("detail page shows the description", body.includes("A bright, freshly painted unit"));
  check("detail page shows the amenities in the export text", body.includes("In-unit laundry"));
  check("all four platforms appear in the tracker", ["Zillow", "Realtor.com", "Zumper", "Apartments.com"].every((p) => body.includes(p)));
  // Badges render as <span>, unlike the identical option text inside each
  // row's <select> — scoping to span avoids double-counting those.
  check("every platform starts out Not posted", (await page.locator('span:has-text("Not posted")').count()) === 4);
  check("the uploaded photo is shown", (await page.locator('img[alt="listing.png"]').count()) === 1);

  await ctx.close();
}

// ------------------------------------------------------------- work the syndication tracker
{
  const ctx = await browser.newContext();
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
  const page = await ctx.newPage();
  await login(page, "admin@example.com");

  await page.goto(`${BASE}/app/listings/${listingId}`, { waitUntil: "domcontentloaded" });

  const zillowRow = page.locator('[data-testid="syndication-ZILLOW"]');
  await zillowRow.locator('select[name="status"]').selectOption("POSTED");
  await zillowRow.locator('input[name="listingUrl"]').fill("https://www.zillow.com/homedetails/fake-listing");
  await zillowRow.locator('button:has-text("Save")').click();
  // Scoped to <span> (the status badge) and an exact match — the row also
  // contains a hidden <option value="POSTED">Posted</option> in the select,
  // and "Not posted" contains "posted" as a substring either way.
  const zillowBadge = zillowRow.locator("span").filter({ hasText: /^Posted$/ });
  await zillowBadge.waitFor({ timeout: 10000 });

  check("Zillow's row now reads Posted", (await zillowBadge.count()) === 1);
  // The Save click revalidates the page, which can swap the row's DOM in
  // (replacing "Copy for Zillow" with a fresh button node) slightly after the
  // badge text itself updates. Clicking too early can land in that gap — a
  // dead click, no writeText call, no "Copied!". Give the revalidation time
  // to fully settle before clicking again.
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(300);

  await zillowRow.locator('button:has-text("Copy for Zillow")').click();
  // writeText() is async (see CopyButton) — its own "Copied!" label only
  // shows once that promise resolves, so wait for it rather than reading the
  // clipboard immediately and racing the write.
  await zillowRow.locator('button:has-text("Copied!")').waitFor({ timeout: 5000 });
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  check("the copy button puts the formatted listing text on the clipboard", clipboard.includes("In-unit laundry"));
  check("the copied text includes the asking rent", clipboard.includes("month"));

  await ctx.close();
}

// ------------------------------------------------------------- index page + filters
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, "admin@example.com");

  // Matched by this run's listing id, not the property name — this suite
  // isn't hermetic (see e2e/README.md) and an earlier run's listing on the
  // same seeded unit would otherwise still be sitting there under Archived.
  const listingLink = `a[href="/app/listings/${listingId}"]`;

  await page.goto(`${BASE}/app/listings`, { waitUntil: "domcontentloaded" });
  check("the new listing appears under Active", (await page.locator(listingLink).count()) === 1);

  await page.goto(`${BASE}/app/listings?filter=archived`, { waitUntil: "domcontentloaded" });
  check("the listing doesn't show under Archived yet", (await page.locator(listingLink).count()) === 0);

  await ctx.close();
}

// ------------------------------------------------------------- archive it
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, "admin@example.com");

  await page.goto(`${BASE}/app/listings/${listingId}`, { waitUntil: "domcontentloaded" });
  await Promise.all([
    page.waitForSelector("text=Archived", { timeout: 10000 }),
    page.click('button:has-text("Archive")'),
  ]);
  let body = await page.textContent("body");
  check("status flips to Archived", body.includes("Archived"));
  check("the Archive button is gone once archived", (await page.locator('button:has-text("Archive")').count()) === 0);

  await page.goto(`${BASE}/app/listings?filter=archived`, { waitUntil: "domcontentloaded" });
  check(
    "the listing now shows under Archived",
    (await page.locator(`a[href="/app/listings/${listingId}"]`).count()) === 1,
  );

  await ctx.close();
}

// ------------------------------------------------------------- platform connections settings
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, "admin@example.com");

  await page.goto(`${BASE}/app/settings/listing-syndication`, { waitUntil: "domcontentloaded" });
  let body = await page.textContent("body");
  check("the settings page explains nothing posts automatically", body.includes("posts automatically"));

  const zillowCard = page.locator('[data-testid="connection-ZILLOW"]');
  await zillowCard.locator('input[name="apiKey"]').fill("fake-partner-feed-id-123");
  await Promise.all([
    page.waitForSelector("text=Saved.", { timeout: 10000 }),
    zillowCard.locator('button:has-text("Save")').click(),
  ]);

  await page.reload({ waitUntil: "domcontentloaded" });
  const zillowCardAfter = page.locator('[data-testid="connection-ZILLOW"]');
  check(
    "the saved key is never echoed back into the input",
    (await zillowCardAfter.locator('input[name="apiKey"]').inputValue()) === "",
  );
  check(
    "the hint confirms a key is on file instead",
    (await zillowCardAfter.textContent()).includes("A key is saved"),
  );

  await ctx.close();
}

// ------------------------------------------------------------- non-admin staff can't change connections
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, "staff@example.com");

  await page.goto(`${BASE}/app/settings/listing-syndication`, { waitUntil: "domcontentloaded" });
  const zillowCard = page.locator('[data-testid="connection-ZILLOW"]');
  check(
    "staff (non-admin) sees no Save button on the connections form",
    (await zillowCard.locator('button:has-text("Save")').count()) === 0,
  );
  check(
    "staff sees the api key field disabled",
    await zillowCard.locator('input[name="apiKey"]').isDisabled(),
  );

  await ctx.close();
}

await browser.close();

console.log(`\n${passed}/${passed + failed} checks passed`);
if (failed > 0) process.exit(1);
