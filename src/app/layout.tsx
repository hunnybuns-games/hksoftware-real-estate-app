import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Rentwell — property management",
    template: "%s · Rentwell",
  },
  description:
    "Property management for independent landlords: properties, leases, rent collection and maintenance in one place.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
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
