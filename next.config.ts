import type { NextConfig } from "next";
import { PRIVATE_PATH_PREFIXES } from "./src/lib/site";

/**
 * `noindex` as a header rather than a meta tag.
 *
 * The meta tags on the private layouts cover HTML pages. They cannot cover the
 * things under /api — the CSV exports in particular (/api/export/rent-roll and
 * friends) return a text/csv file containing an entire rent roll, and a file has
 * nowhere to put a meta tag. X-Robots-Tag is the only way to mark those, and it
 * is the reason this list exists in addition to the metadata.
 */
const NOINDEX = "noindex, nofollow, noarchive, nosnippet";

const nextConfig: NextConfig = {
  // Prisma's client must not be bundled by the server compiler.
  serverExternalPackages: ["@prisma/client", "bcryptjs"],
  typedRoutes: false,

  experimental: {
    /*
     * Required for <Link unstable_dynamicOnHover> to do anything (see
     * src/components/nav-link.tsx). Without this flag the prop is silently
     * inert — Next still upgrades the prefetch's *priority* on hover, but not
     * its *kind*, so the page's actual data never gets fetched early; hovering
     * would look identical to not hovering at all. Confirmed by reading
     * node_modules/next/dist/client/components/links.js rather than assumed:
     * the upgrade to a full fetch is explicitly gated on
     * `process.env.__NEXT_DYNAMIC_ON_HOVER`, which this flag sets at build time.
     *
     * `unstable_` in the prop name is Next's own naming, not a caveat this repo
     * added — the shape (or the flag) could change in a future Next release
     * without a major version bump. If an upgrade breaks it, the fallback is
     * simply the current no-head-start behavior, not an error.
     */
    dynamicOnHover: true,
  },

  // Baseline hardening headers on every response. The Content-Security-Policy
  // is deliberately NOT here: it carries a per-request nonce, so it can't be a
  // static string. It lives in src/middleware.ts — read the comment at the top
  // of that file before touching either.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Stops a browser from ever executing an uploaded file (see the
          // maintenance-photo route) as something other than its declared
          // Content-Type, regardless of what the bytes actually look like.
          { key: "X-Content-Type-Options", value: "nosniff" },
          // No page here has any business being framed by another origin.
          { key: "X-Frame-Options", value: "DENY" },
          // Send the full URL to our own origin (useful for logs/analytics),
          // nothing at all cross-origin — leases, tenant names, and payment
          // amounts show up in plenty of URLs in this app.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },

      // Belt-and-braces noindex for every private prefix, including the ones
      // that return files rather than pages. Kept in sync with robots.txt and
      // the layout metadata through PRIVATE_PATH_PREFIXES in src/lib/site.ts.
      ...PRIVATE_PATH_PREFIXES.map((prefix) => ({
        source: `${prefix}/:path*`,
        headers: [{ key: "X-Robots-Tag", value: NOINDEX }],
      })),
      // The prefixes themselves, which the `/:path*` patterns above don't match.
      ...PRIVATE_PATH_PREFIXES.map((prefix) => ({
        source: prefix,
        headers: [{ key: "X-Robots-Tag", value: NOINDEX }],
      })),

      {
        /*
         * The token in these URLs is a working credential (see the note on
         * src/app/(auth)/reset-password/[token]/page.tsx). `no-referrer` stops it
         * being sent in a Referer header — the default policy above still sends
         * the full URL to our own origin, which is every asset request this page
         * makes, and would put a live password-reset token in access logs.
         */
        source: "/:route(reset-password|invite)/:token*",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
    ];
  },
};

export default nextConfig;
