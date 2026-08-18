import { BASE, launchBrowser } from "./_shared.mjs";

/**
 * Address autocomplete on the property form: typing triggers a debounced
 * lookup, picking a suggestion fills city/state/ZIP, and the plain fields
 * stay editable afterward. The Mapbox API itself is mocked via Playwright
 * route interception — see docs/address-autocomplete.md for what that does
 * and doesn't prove (the mock is shaped like Mapbox's *documented* v6
 * response, not a response this suite has confirmed live).
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

function mapboxFeature({ full_address, name, addressName, place, region, postcode }) {
  return {
    properties: {
      full_address,
      name,
      context: {
        address: addressName ? { name: addressName } : undefined,
        place: place ? { name: place } : undefined,
        region: region ? { region_code: region } : undefined,
        postcode: postcode ? { name: postcode } : undefined,
      },
    },
  };
}

const browser = await launchBrowser();

// ------------------------------------------------------------- picking a suggestion fills the form
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  let requestedQuery = null;
  await page.route("https://api.mapbox.com/**", async (route) => {
    const url = new URL(route.request().url());
    requestedQuery = url.searchParams.get("q");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        features: [
          mapboxFeature({
            full_address: "123 Main Street, Springfield, Illinois 62704, United States",
            name: "123 Main Street",
            addressName: "123 Main Street",
            place: "Springfield",
            region: "IL",
            postcode: "62704",
          }),
          mapboxFeature({
            full_address: "123 Main Street North, Springfield, Illinois 62702, United States",
            name: "123 Main Street North",
            addressName: "123 Main Street North",
            place: "Springfield",
            region: "IL",
            postcode: "62702",
          }),
        ],
      }),
    });
  });

  await login(page, "admin@example.com");
  await page.goto(`${BASE}/app/properties/new`, { waitUntil: "load" });
  // First request after a nav can race Turbopack's on-demand compile in dev;
  // give it a moment rather than flake on a slow first hit.
  await page.waitForTimeout(1000);

  await page.fill('input[name="addressLine1"]', "123 Main");
  await page.waitForSelector('ul[role="listbox"]', { timeout: 10000 });
  check("the query reached the mocked endpoint", requestedQuery === "123 Main");

  const body = await page.textContent("body");
  check("both suggestions are listed", body.includes("123 Main Street North"));

  await page.click('ul[role="listbox"] button:has-text("123 Main Street, Springfield")');
  await page.waitForTimeout(150);

  check(
    "picking a suggestion fills the street address",
    (await page.locator('input[name="addressLine1"]').inputValue()) === "123 Main Street",
  );
  check(
    "picking a suggestion fills the city",
    (await page.locator('input[name="city"]').inputValue()) === "Springfield",
  );
  check(
    "picking a suggestion fills the state",
    (await page.locator('select[name="state"]').inputValue()) === "IL",
  );
  check(
    "picking a suggestion fills the ZIP",
    (await page.locator('input[name="postalCode"]').inputValue()) === "62704",
  );
  check("the dropdown closes after picking", (await page.locator('ul[role="listbox"]').count()) === 0);

  // Autofill is a convenience, not a lock — every field stays editable.
  await page.fill('input[name="city"]', "Springfield Township");
  check(
    "the filled city field can still be hand-edited",
    (await page.locator('input[name="city"]').inputValue()) === "Springfield Township",
  );

  await ctx.close();
}

// ------------------------------------------------------------- graceful with no results / short queries
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  await page.route("https://api.mapbox.com/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ features: [] }) });
  });

  await login(page, "admin@example.com");
  await page.goto(`${BASE}/app/properties/new`, { waitUntil: "load" });
  await page.waitForTimeout(1000);

  await page.fill('input[name="addressLine1"]', "1");
  await page.waitForTimeout(500);
  check("a one-character query never opens a dropdown", (await page.locator('ul[role="listbox"]').count()) === 0);

  await page.fill('input[name="addressLine1"]', "zzz no such place");
  await page.waitForTimeout(600);
  check(
    "zero results closes the dropdown instead of showing an empty one",
    (await page.locator('ul[role="listbox"]').count()) === 0,
  );
  check(
    "the typed text is preserved either way",
    (await page.locator('input[name="addressLine1"]').inputValue()) === "zzz no such place",
  );

  await ctx.close();
}

// ------------------------------------------------------------- CSP actually allows the request
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const cspViolations = [];
  page.on("console", (msg) => {
    if (msg.text().toLowerCase().includes("content security policy")) cspViolations.push(msg.text());
  });

  await page.route("https://api.mapbox.com/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ features: [] }) });
  });

  await login(page, "admin@example.com");
  await page.goto(`${BASE}/app/properties/new`, { waitUntil: "load" });
  await page.waitForTimeout(1000);
  await page.fill('input[name="addressLine1"]', "456 Oak");
  await page.waitForTimeout(600);

  check("no CSP violation logged for the Mapbox request", cspViolations.length === 0, cspViolations.join(" | "));

  await ctx.close();
}

await browser.close();

console.log(`\n${passed}/${passed + failed} checks passed`);
if (failed > 0) process.exit(1);
