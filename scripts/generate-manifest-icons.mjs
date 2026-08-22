#!/usr/bin/env node
/**
 * Regenerates the raster icons src/app/manifest.ts lists for `purpose: "any"`
 * and `purpose: "maskable"` — public/icons/icon-192.png, icon-512.png (both
 * edge-to-edge, same framing as apple-icon.png), and icon-maskable-512.png
 * (padded, for Android's adaptive-icon safe zone — see the comment below).
 *
 * Same reasoning as generate-apple-icon.mjs, and it shares that script's
 * rasterizer (scripts/lib/mark-render.mjs) rather than a second copy: the
 * icon is derived from the brand colour and the mark, and re-running these
 * generators is how both stay in sync with a real brand landing later.
 *
 * icon.svg alone (`purpose: "any", sizes: "any"`, already in the manifest)
 * covers most installs — Chrome and Safari both take an SVG manifest icon
 * fine. These PNGs exist for the two things an SVG doesn't cover: Android's
 * adaptive-icon system, which needs a raster `maskable` icon it can safely
 * crop to a circle/squircle/rounded-square, and older/other install
 * surfaces that expect a concrete raster size (192 and 512 are the sizes
 * every PWA checklist — Lighthouse included — actually checks for).
 *
 * Run: node scripts/generate-manifest-icons.mjs
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { renderMarkPng } from "./lib/mark-render.mjs";

const OUT_DIR = new URL("../public/icons/", import.meta.url);
mkdirSync(OUT_DIR, { recursive: true });

function write(name, size, contentScale) {
  const png = renderMarkPng({ size, contentScale });
  const out = new URL(name, OUT_DIR);
  writeFileSync(out, png);
  console.log(`wrote ${out.pathname} — ${size}×${size}, contentScale=${contentScale}, ${png.length} bytes`);
}

// Edge-to-edge, same framing as icon.svg/apple-icon.png — for `purpose: "any"`,
// where the OS applies no crop of its own and the tight framing matches the
// rest of the brand.
write("icon-192.png", 192, 1);
write("icon-512.png", 512, 1);

/**
 * `purpose: "maskable"`: Android crops this to whatever shape its launcher
 * uses (circle, squircle, rounded square...), and only guarantees an inner
 * safe zone survives — a centred circle covering 80% of the icon's diameter
 * (a 0.4×size radius from centre). icon.svg's own framing doesn't fit that:
 * its ground line reaches ~0.93×(half-width) from centre, comfortably
 * outside the safe zone, so a maskable icon built from it edge-to-edge would
 * get its ground line clipped off on real devices.
 *
 * contentScale 0.64 draws the artwork at 64% of the canvas width, centred,
 * with brand-colour fill (no transparency — required for maskable) filling
 * the rest. That puts the artwork's own farthest point at roughly
 * 0.93 × 0.32×size ≈ 0.30×size from centre — inside the 0.4×size safe
 * zone with real margin, not just barely passing.
 */
write("icon-maskable-512.png", 512, 0.64);
