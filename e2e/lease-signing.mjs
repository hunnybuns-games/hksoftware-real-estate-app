import path from "node:path";
import { BASE, launchBrowser } from "./_shared.mjs";

/**
 * The lease-builder + e-signature flow end to end: staff generates a lease
 * document from the org's template, countersigns and sends it, the tenant
 * reviews and signs it from their portal, and the document ends up fully
 * executed with both signatures on record.
 *
 * Uses the seeded tenant@example.com login and their earliest lease — the
 * same lease prisma/seed.ts wires that portal account to — found via a direct
 * database query, same trick applications.mjs and mvp.mjs use.
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

/** Drags a short stroke across a canvas so a signature pad has something in it. */
async function drawOnCanvas(page) {
  const canvas = page.locator("canvas");
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + 20, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 20, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
}

const { PrismaClient } = await import("@prisma/client");
const { PrismaBetterSQLite3 } = await import("@prisma/adapter-better-sqlite3");
const dbUrl = `file:${path.join(process.cwd(), "prisma", "dev.db")}`;
const db = new PrismaClient({ adapter: new PrismaBetterSQLite3({ url: dbUrl }) });

const tenant = await db.tenant.findFirst({
  where: { email: "tenant@example.com" },
  include: {
    leases: {
      orderBy: { createdAt: "asc" },
      take: 1,
      select: { id: true, rentAmountCents: true },
    },
  },
});
await db.$disconnect();

if (!tenant || tenant.leases.length === 0) {
  console.log("FAIL  no seeded tenant/lease found — can't run this suite");
  process.exit(1);
}

const tenantName = `${tenant.firstName} ${tenant.lastName}`;
const lease = tenant.leases[0];
// Matches src/lib/money.ts's formatCents exactly, including thousands commas.
const rentFormatted = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}).format(lease.rentAmountCents / 100);

const browser = await launchBrowser();
let documentId;

// ------------------------------------------------------------- build & send
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, "admin@example.com");

  await page.goto(`${BASE}/app/leases/${lease.id}/document/new`, { waitUntil: "domcontentloaded" });
  check(
    "builder page identifies the right tenant",
    (await page.textContent("body")).includes(tenantName),
  );

  await Promise.all([
    // cuids run ~25 chars — a floor of 10 keeps this from also matching the
    // "new" the page starts on (the actual bug the first version of this
    // suite had: `[a-z0-9]+$` matches "new" too, so waitForURL resolved
    // immediately instead of waiting for the real redirect).
    page.waitForURL(new RegExp(`/app/leases/${lease.id}/document/[a-z0-9]{10,}$`), { timeout: 15000 }),
    page.click('button:has-text("Generate document")'),
  ]);
  documentId = page.url().split("/").pop();
  check("generating redirects to the new document's detail page", documentId !== "new");

  await page.waitForSelector("text=RESIDENTIAL LEASE AGREEMENT", { timeout: 10000 });
  let body = await page.textContent("body");
  check("generated document is a draft", body.includes("Draft"));
  check("generated body includes the tenant's name", body.includes(tenantName));
  check("generated body includes the rent amount", body.includes(rentFormatted));
  check("late fee clause is included by default", body.includes("LATE FEE"));

  await page.fill('input[name="typedSignature"]', "Dana Whitfield");
  await drawOnCanvas(page);
  await page.check('input[name="consent"]');
  // The countersign panel is replaced by a "waiting on signature" panel once
  // the document leaves DRAFT — that swap, not a transient success message,
  // is the real signal the send went through.
  await Promise.all([
    page.waitForSelector("text=Waiting on signature", { timeout: 10000 }),
    page.click('button:has-text("Sign & send to tenant")'),
  ]);

  body = await page.textContent("body");
  check("status flips to awaiting signature after sending", body.includes("Awaiting signature"));
  check("the landlord's typed signature appears on the document", body.includes("Dana Whitfield"));

  await ctx.close();
}

// ------------------------------------------------------------- reject an anonymous sign attempt
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/portal/lease/document/${documentId}`, { waitUntil: "domcontentloaded" });
  check(
    "signing in is required before a real document id is shown",
    page.url().includes("/login"),
  );
  await ctx.close();
}

// ------------------------------------------------------------- tenant reviews and signs
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, "tenant@example.com");

  const res = await page.goto(`${BASE}/portal/lease/document/not-a-real-id`, {
    waitUntil: "domcontentloaded",
  });
  check(
    "an unknown document id 404s for a signed-in tenant",
    res.status() === 404,
    `status ${res.status()}`,
  );

  await page.goto(`${BASE}/portal/lease`, { waitUntil: "domcontentloaded" });
  let body = await page.textContent("body");
  check("portal shows a banner for the pending signature", body.includes("waiting on your signature"));

  await Promise.all([
    page.waitForURL(`${BASE}/portal/lease/document/${documentId}`, { timeout: 15000 }),
    page.click("text=Review & sign"),
  ]);

  body = await page.textContent("body");
  check("tenant sign page shows the full document text", body.includes(rentFormatted));

  await page.fill('input[name="typedSignature"]', tenantName);
  // Deliberately left the pad blank here — drawing is optional (see
  // src/components/signature-pad.tsx) and the typed name above the countersign
  // step already exercised the drawn path.
  await page.check('input[name="consent"]');
  await Promise.all([
    page.waitForSelector("text=fully executed", { timeout: 10000 }),
    page.click('button:has-text("Sign lease")'),
  ]);

  body = await page.textContent("body");
  check("document now shows as signed to the tenant", body.includes("Signed"));
  check("the tenant's typed signature appears on the document", body.includes(tenantName));

  // Re-visiting after already signing must not offer the form again. (Not
  // asserting anything about the portal's banner here — this suite isn't
  // hermetic, see e2e/README.md, so an *older* leftover unsigned document
  // from a previous run can legitimately still have one.)
  await page.goto(`${BASE}/portal/lease/document/${documentId}`, { waitUntil: "domcontentloaded" });
  body = await page.textContent("body");
  check("re-visiting a signed document doesn't offer the sign form again", !body.includes("Sign lease"));

  await ctx.close();
}

// ------------------------------------------------------------- staff sees it fully executed
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, "admin@example.com");

  await page.goto(`${BASE}/app/leases/${lease.id}/document/${documentId}`, {
    waitUntil: "domcontentloaded",
  });
  const body = await page.textContent("body");
  check("staff view shows the document as fully signed", body.includes("Fully signed"));
  check("both signatures are visible to staff", body.includes("Dana Whitfield") && body.includes(tenantName));

  await ctx.close();
}

await browser.close();

console.log(`\n${passed}/${passed + failed} checks passed`);
if (failed > 0) process.exit(1);
