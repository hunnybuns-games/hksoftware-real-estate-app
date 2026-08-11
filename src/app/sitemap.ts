import type { MetadataRoute } from "next";
import { PUBLIC_ROUTES, absoluteUrl } from "@/lib/site";

/**
 * Rendered per request, not prerendered — and this is load-bearing, not a
 * preference.
 *
 * APP_URL reaches production as a runtime `vars` binding in wrangler.jsonc, so it
 * is not set in the environment that runs the build. Prerendered, this file
 * therefore bakes in the fallback origin and ships a sitemap advertising
 * `http://localhost:3000/` to every crawler that asks — which is worse than
 * having no sitemap, because it's a positive claim about where the site lives.
 * (Verified: the first build of this file did exactly that.)
 *
 * Dynamic costs one trivial render on a URL that gets requested a handful of
 * times a day, and it stays correct through a move to a custom domain with no
 * build configuration to remember. Same reasoning as the note on AUTH_URL in
 * wrangler.jsonc.
 */
export const dynamic = "force-dynamic";

/**
 * Served at /sitemap.xml.
 *
 * Only the four routes a signed-out visitor can actually reach — see
 * PUBLIC_ROUTES in src/lib/site.ts. Nothing here is generated from the
 * database: this app's records are private by definition, and a sitemap is a
 * public document, so a sitemap built by querying tables is a way to publish a
 * list of your customers' URLs.
 *
 * `lastModified` is the deploy time rather than a hand-maintained date. It's the
 * honest answer for pages whose content only changes when the app is
 * redeployed, and it can't go stale the way a literal date does.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  return PUBLIC_ROUTES.map((route) => ({
    url: absoluteUrl(route.path),
    lastModified,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
