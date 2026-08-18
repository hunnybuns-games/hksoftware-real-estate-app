import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

/**
 * Shared setup for the end-to-end suites, so the four of them agree on where
 * the app is, which browser to drive, and where artifacts land.
 *
 * These scripts drive a real browser against a running dev server — they are
 * deliberately plain Node scripts rather than a Playwright test-runner project,
 * because they were written to be readable top-to-bottom as a description of
 * the flows they check.
 */

/** Where the app under test is. Override to point at a preview/staging deploy. */
export const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";

/**
 * Screenshots and scratch files. Gitignored — these are debugging aids for
 * whoever is watching a failure, not fixtures anything asserts against.
 */
export const ARTIFACTS = path.join(process.cwd(), "e2e", ".artifacts");

export function artifactPath(name) {
  return path.join(ARTIFACTS, name);
}

/**
 * PLAYWRIGHT_EXECUTABLE_PATH covers environments that ship a browser outside
 * Playwright's own cache (a CI image, or a sandbox with a preinstalled
 * Chromium). Unset, Playwright resolves the browser it downloaded itself,
 * which is what you want on a normal laptop after `npx playwright install`.
 */
export async function launchBrowser() {
  mkdirSync(ARTIFACTS, { recursive: true });
  const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
  const browser = await chromium.launch(executablePath ? { executablePath } : {});

  // The property form's address field (src/components/address-autocomplete-input.tsx)
  // calls out to Mapbox whenever NEXT_PUBLIC_MAPBOX_TOKEN is set, which CI does so
  // e2e:address-autocomplete can exercise it. Every *other* suite that just fills
  // that field in passing (mvp, security, theme) has no reason to make that a real
  // network call, and CI found out the hard way that letting one through is a
  // flakiness source, not a hazard to the field itself — the component degrades to
  // "no suggestions" on any error, but a genuinely slow/unreliable request can still
  // race the rest of a fast form fill. So every context gets an empty-results stub
  // by default; page-level routes (Playwright always prefers them over a context's)
  // let e2e/address-autocomplete.mjs override this with the real fixtures it tests.
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (options) => {
    const context = await newContext(options);
    await context.route("https://api.mapbox.com/**", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ features: [] }) }),
    );
    return context;
  };

  return browser;
}
