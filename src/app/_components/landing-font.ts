import localFont from "next/font/local";

/**
 * Nunito, for the marketing page only. The app itself stays on the system
 * stack (globals.css --font-sans): a rent roll wants the font the OS already
 * renders best, and nothing about a table gets cosier for being rounded. The
 * cover page is a different job — it's the one page that's read rather than
 * operated — and a rounded face is most of what makes it feel like the cat
 * belongs there.
 *
 * Self-hosted from src/fonts rather than linked from Google Fonts: the CSP in
 * src/middleware.ts allows font-src 'self' only, and next/font/local inlines
 * the @font-face and serves the file from our own origin, which is both the
 * secure choice and the fast one (no third-party DNS on first paint). Latin
 * subset only, ~39 KB; that covers every character on the page.
 */
export const nunito = localFont({
  src: "../../fonts/nunito-latin.woff2",
  weight: "200 1000",
  style: "normal",
  display: "swap",
  variable: "--font-nunito",
  fallback: ["ui-rounded", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
  adjustFontFallback: "Arial",
});
