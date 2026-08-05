// @ts-nocheck -- .open-next/worker.js is a build artifact (see `npm run cf:build`)
// that doesn't exist until OpenNext has run, so this file is excluded from the
// project's tsconfig. Wrangler's own bundler transpiles it at deploy time
// without needing that check.
//
// Wraps the OpenNext-generated Cloudflare Worker to add a scheduled()
// handler for the daily rent run. Every other request (pages, API routes,
// Server Actions) passes straight through to the generated `fetch` —
// this file only exists for the cron trigger, which OpenNext doesn't
// generate on its own.
import openNextWorker from "../../.open-next/worker.js";

export default {
  fetch: openNextWorker.fetch,

  /**
   * Same job Vercel's cron used to hit over HTTP (see vercel.json from the
   * pre-Cloudflare setup): post this month's rent charges, then send
   * due/late notices. Calling it as a self-request — rather than importing
   * the route's logic directly — keeps a single code path and its existing
   * CRON_SECRET auth check, whether the trigger is this Cron Trigger or a
   * developer curling the route by hand.
   */
  async scheduled(_event, env, ctx) {
    const request = new Request("https://internal.invalid/api/cron/rent-run", {
      headers: { Authorization: `Bearer ${env.CRON_SECRET ?? ""}` },
    });
    const response = await openNextWorker.fetch(request, env, ctx);
    if (!response.ok) {
      console.error(`Rent run cron failed: ${response.status} ${await response.text()}`);
    }
  },
};
