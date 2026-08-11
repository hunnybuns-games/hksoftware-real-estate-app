import type { MetadataRoute } from "next";
import { PRIVATE_PATH_PREFIXES, absoluteUrl } from "@/lib/site";

/**
 * Per request rather than prerendered, for the same reason as sitemap.ts: the
 * `Sitemap:` and `Host:` lines below are absolute URLs built from APP_URL, which
 * is a runtime binding and is absent during the build. Prerendered, this file
 * points crawlers at a localhost sitemap. See the fuller note in sitemap.ts.
 */
export const dynamic = "force-dynamic";

/**
 * Served at /robots.txt.
 *
 * An allowlist would be wrong here and a denylist is wrong too — what's correct
 * is a denylist of the private *prefixes*, because a crawler that finds a URL we
 * didn't anticipate under /app should still be told to leave it alone. Hence
 * `disallow` by prefix rather than enumerating pages.
 *
 * This file is the polite layer, and politeness is all it is: robots.txt asks
 * well-behaved crawlers not to *fetch*, but it cannot stop a URL someone else
 * links to from being indexed, and it does nothing about a crawler that ignores
 * it. The layers that actually hold are the `robots: noindex` metadata on the
 * private layouts and the X-Robots-Tag header in next.config.ts — and behind
 * both, the fact that every one of these routes requires a session anyway.
 *
 * Deliberately not listing the private prefixes as a hint to attackers is not a
 * consideration: /app and /login are guessable in any app, and hiding them from
 * robots.txt would trade a real indexing guarantee for no security at all.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: PRIVATE_PATH_PREFIXES.map((prefix) => `${prefix}/`),
      },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
    host: absoluteUrl(),
  };
}
