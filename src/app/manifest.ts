import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site";

/**
 * Served at /manifest.webmanifest.
 *
 * `display: "standalone"` and the icons make this installable on a phone, which
 * is worth having for the resident portal in particular: a tenant paying rent
 * or filing a maintenance request from an icon on their home screen is the
 * actual usage pattern, not a desktop browser tab.
 *
 * Not a ranking factor on its own. It's here because it's the same set of facts
 * as the metadata next door, and having them disagree is how you end up with an
 * install prompt showing a stale product name.
 *
 * Four icons, three purposes:
 *  - icon.svg (`purpose: "any"`) is what most installs actually use — Chrome
 *    and Safari both take an SVG manifest icon directly, and it stays sharp
 *    at every size asked of it.
 *  - icon-192/512.png (`purpose: "any"`) back it up with concrete raster
 *    sizes for surfaces that expect one — 192 and 512 are what Lighthouse's
 *    installability audit and most PWA checklists actually look for.
 *  - icon-maskable-512.png (`purpose: "maskable"`) is a *different* image,
 *    not just a bigger one: Android crops a maskable icon to its own launcher
 *    shape and only guarantees the centred 80%-diameter safe zone survives.
 *    icon.svg's tight framing doesn't fit inside that (its ground line would
 *    get clipped), so this is the same mark redrawn with real padding — see
 *    scripts/generate-manifest-icons.mjs for the safe-zone math.
 * Regenerate the three PNGs with `node scripts/generate-manifest-icons.mjs`
 * if the mark or brand colour ever changes; nothing here reads a stale copy.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${SITE.name} — ${SITE.tagline}`,
    short_name: SITE.name,
    description: SITE.description,
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: SITE.themeColor,
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
