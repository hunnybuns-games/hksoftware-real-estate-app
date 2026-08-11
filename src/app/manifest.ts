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
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
