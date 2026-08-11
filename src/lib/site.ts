/**
 * Everything about how this app presents itself publicly, in one place: the
 * brand, the copy search engines and social cards quote, and the origin every
 * absolute URL is built from.
 *
 * It's centralised because two of these are placeholders that will change:
 *
 *  - **The name.** "Rentwell" is a working title (see src/components/logo.tsx).
 *    Changing SITE.name here updates the title template, the social cards, the
 *    JSON-LD organisation, and the web manifest together, so they can't drift
 *    apart or leave the old name behind in a metadata field nobody looks at.
 *  - **The origin.** APP_URL is a `*.workers.dev` subdomain today. That is a
 *    shared platform domain, and no amount of on-page work makes a subdomain of
 *    someone else's domain rank like your own — moving to a custom domain is
 *    worth more than everything else in this file combined. When it moves, set
 *    APP_URL (wrangler.jsonc `vars`) and every canonical, sitemap entry, and
 *    Open Graph URL follows.
 */

export const SITE = {
  name: "Rentwell",
  /** Used where the name alone is ambiguous — page titles, card headings. */
  tagline: "Property management software for independent landlords",
  /**
   * The one description search results and social cards quote. Written to be
   * read by a person: it leads with who it's for and what it replaces, because
   * "property management software" alone is a category with a hundred entrants.
   */
  description:
    "Property management software for independent landlords with 20–200 units. Track properties, units and leases, collect rent by bank transfer, reconcile payments automatically, and handle maintenance requests — without enterprise pricing.",
  locale: "en_US",
  /** Matches --color-brand-600 in globals.css, for the browser UI and manifest. */
  themeColor: "#1f6f8b",
} as const;

/**
 * The public origin, without a trailing slash.
 *
 * Falls back the same way src/lib/email.ts always has, so a link in an email and
 * a canonical URL on a page can never disagree about where this app lives.
 */
export function siteUrl(): string {
  const base =
    process.env.APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
  return base.replace(/\/$/, "");
}

/** An absolute URL for a root-relative path. `absoluteUrl("/login")`. */
export function absoluteUrl(path = ""): string {
  return `${siteUrl()}${path}`;
}

/**
 * The only routes that should ever appear in search results.
 *
 * Everything else in this app is either behind a login (the management app, the
 * resident portal, owner statements) or is itself a credential (invitation and
 * password-reset links). Both kinds are kept out of the index by
 * src/app/robots.ts, by `robots: noindex` on their layouts, and by an
 * X-Robots-Tag header in next.config.ts — three layers, because a rent ledger
 * or a working password-reset token turning up in a search result is not a
 * ranking problem, it's a breach.
 *
 * `changeFrequency` and `priority` are hints search engines mostly ignore, kept
 * honest rather than inflated: everything is not priority 1.0.
 */
export const PUBLIC_ROUTES = [
  { path: "/", changeFrequency: "monthly", priority: 1.0 },
  { path: "/signup", changeFrequency: "yearly", priority: 0.8 },
  { path: "/login", changeFrequency: "yearly", priority: 0.5 },
  { path: "/forgot-password", changeFrequency: "yearly", priority: 0.2 },
] as const;

/**
 * Path prefixes that must never be indexed. Shared by robots.ts and the
 * X-Robots-Tag rules in next.config.ts so the two can't fall out of step.
 */
export const PRIVATE_PATH_PREFIXES = [
  "/app",
  "/portal",
  "/owner",
  "/onboarding",
  "/api",
  "/invite",
  "/reset-password",
] as const;
