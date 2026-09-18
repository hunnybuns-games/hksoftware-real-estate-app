/**
 * Rasterizes src/app/icon.svg — shared by every script that needs a PNG copy
 * of the mark at some size (apple-icon.png, the manifest icons).
 *
 * The SVG is the single source of truth. This used to be a hand-rolled
 * renderer with the old roofline mark re-described as line segments, which
 * meant every change to the icon had to be made twice and could drift. The
 * cat replaced that mark, and a filled illustration isn't something you
 * want to re-describe by hand, so the PNGs are now rendered from the SVG
 * itself through sharp — already in node_modules as a dependency of Next,
 * pinned in package.json so it stays there.
 *
 * Every consumer asks for the mark at a `size` and a `contentScale`: the
 * fraction of `size` the 32-unit artwork occupies, centred, with the rest as
 * background. `contentScale: 1` fills the canvas edge-to-edge; a smaller
 * value is what a maskable manifest icon needs so the artwork survives
 * Android's adaptive-icon crop — see generate-manifest-icons.mjs.
 *
 * Output is always opaque. icon.svg itself has no background (the cushion is
 * the ground, and the tab strip shows through around it), but iOS composites
 * a transparent touch icon onto black and Android requires maskable icons to
 * be opaque, so the raster copies sit on the manifest's background_color.
 */

import { readFileSync } from "node:fs";
import sharp from "sharp";

const ICON_SVG = new URL("../../src/app/icon.svg", import.meta.url);

/** Matches `background_color` in src/app/manifest.ts. */
export const BACKGROUND = "#ffffff";

/**
 * Renders the mark to a PNG buffer.
 *
 * @param {object} opts
 * @param {number} opts.size - output width/height in pixels (square).
 * @param {number} [opts.contentScale] - fraction of `size` the artwork
 *   occupies, centred. 1 (default) fills the canvas edge-to-edge.
 * @returns {Promise<Buffer>}
 */
export async function renderMarkPng({ size, contentScale = 1 }) {
  const svg = readFileSync(ICON_SVG);
  const inner = Math.round(size * contentScale);

  // librsvg rasterizes at a DPI, not a pixel size: the 32-unit viewBox comes
  // out at 32px at the default 72 DPI. Ask for the density that yields
  // `inner` pixels directly so nothing is rendered small and scaled up.
  const art = await sharp(svg, { density: Math.ceil((72 * inner) / 32) })
    .resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  return sharp({
    create: { width: size, height: size, channels: 4, background: BACKGROUND },
  })
    .composite([{ input: art, gravity: "centre" }])
    .flatten({ background: BACKGROUND })
    .png()
    .toBuffer();
}
