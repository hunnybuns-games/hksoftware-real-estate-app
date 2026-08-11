import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import { SITE, siteUrl } from "@/lib/site";
import "./globals.css";

/**
 * Defaults every route inherits. Individual pages override the parts they care
 * about — Next merges metadata field by field rather than replacing it, which is
 * what lets the private layouts set `robots: noindex` once and have it apply to
 * every page beneath them even though those pages set their own titles.
 *
 * `metadataBase` is the load-bearing line. Without it, Next has no origin to
 * resolve against, so every `alternates.canonical` and Open Graph URL in the app
 * comes out as a bare path — and a canonical that isn't absolute is ignored by
 * everything that reads it. It was missing entirely before, so the canonical and
 * social tags could not have worked regardless of what else was set.
 *
 * A function rather than a `const` because it has to be evaluated per request.
 * APP_URL arrives as a Cloudflare runtime binding, and this app already knows
 * from src/lib/db.ts that the Workers environment is not dependably readable at
 * module-evaluation time. A module-scope `const` would resolve the origin once,
 * possibly before the binding exists, and quietly publish canonical URLs
 * pointing at localhost — which is the same trap that caught robots.txt and
 * sitemap.xml (see the note in src/app/sitemap.ts).
 */
export async function generateMetadata(): Promise<Metadata> {
  return {
    metadataBase: new URL(siteUrl()),
    title: {
      default: `${SITE.name} — ${SITE.tagline}`,
      template: `%s · ${SITE.name}`,
    },
    description: SITE.description,
    applicationName: SITE.name,
    // The public site is one product page; there is no author byline to claim.
    publisher: SITE.name,
    /*
     * Deliberately NO `alternates.canonical` here. Metadata is inherited, so a
     * canonical set at the root would make every page in the app declare the
     * homepage as its canonical URL — which tells a search engine that /signup and
     * /login are duplicates of /, and is a request to drop them from the index.
     * Each public page sets its own; the private ones are noindex and don't need
     * one.
     */
    openGraph: {
      type: "website",
      siteName: SITE.name,
      title: `${SITE.name} — ${SITE.tagline}`,
      description: SITE.description,
      url: siteUrl(),
      locale: SITE.locale,
    },
    twitter: {
      // Upgrades to a large image card automatically once an opengraph-image
      // exists; harmless before that.
      card: "summary_large_image",
      title: `${SITE.name} — ${SITE.tagline}`,
      description: SITE.description,
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        // Defaults truncate both. Long snippets and a full-size image preview are
        // what make a result worth clicking, and there's nothing here worth
        // hiding: every indexable page is a public product page.
        "max-snippet": -1,
        "max-image-preview": "large",
        "max-video-preview": -1,
      },
    },
    // Stops iOS turning unit numbers and amounts into tel: links inside the app.
    formatDetection: { telephone: false, address: false, email: false },
    appleWebApp: { capable: true, title: SITE.name, statusBarStyle: "default" },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Matches the manifest, so the browser chrome doesn't change colour between
  // the installed app and a normal tab.
  themeColor: SITE.themeColor,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Set by src/middleware.ts. Without it the theme script is inline JavaScript
  // with no nonce, which the CSP will refuse to run — and the refusal is silent,
  // so dark mode would just stop working with nothing in the UI to explain why.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    /*
     * suppressHydrationWarning because the script below adds a class to this
     * element before React hydrates, so the server HTML and the live DOM
     * legitimately differ. It suppresses the warning for this element's
     * attributes only, not for the tree underneath.
     */
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Must be here, before the body, or dark-mode users see a white flash
            on every page load. See src/lib/theme.ts. */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
