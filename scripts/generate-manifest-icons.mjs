#!/usr/bin/env node
/**
 * Regenerates the raster icons src/app/manifest.ts lists for `purpose: "any"`
 * and `purpose: "maskable"` — public/icons/icon-192.png, icon-512.png (both
 * edge-to-edge, same framing as apple-icon.png), and icon-maskable-512.png
 * (padded, for Android's adaptive-icon safe zone — see the comment below).
 *
 * Same reasoning as generate-apple-icon.mjs, and it shares that script's
 * rasterizer (scripts/lib/mark-render.mjs) rather than a second copy: every
 * PNG is rendered from src/app/icon.svg, and re-running these generators is
 * how they stay in step with it.
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

async function write(name, size, contentScale) {
  const png = await renderMarkPng({ size, contentScale });
  const out = new URL(name, OUT_DIR);
  writeFileSync(out, png);
  console.log(`wrote ${out.pathname} — ${size}×${size}, contentScale=${contentScale}, ${png.length} bytes`);
}

// Edge-to-edge, same framing as icon.svg/apple-icon.png — for `purpose: "any"`,
// where the OS applies no crop of its own.
await write("icon-192.png", 192, 1);
await write("icon-512.png", 512, 1);

/**
 * `purpose: "maskable"`: Android crops this to whatever shape its launcher
 * uses (circle, squircle, rounded square...), and only guarantees an inner
 * safe zone survives — a centred circle covering 80% of the icon's diameter
 * (a 0.4×size radius from centre). icon.svg's own framing doesn't fit that:
 * the cushion runs from x=1 to x=31 of the 32-unit grid, so its edges sit
 * ~0.94×(half-width) from centre, well outside the safe zone, and a maskable
 * icon built from it edge-to-edge would lose both ends of the cushion on
 * real devices.
 *
 * contentScale 0.7 draws the artwork at 70% of the canvas width, centred,
 * with the background colour (opaque — required for maskable) filling the
 * rest. That puts the cushion's farthest point at roughly
 * 0.94 × 0.35×size ≈ 0.33×size from centre — inside the 0.4×size safe zone
 * with real margin, not just barely passing.
 */
await write("icon-maskable-512.png", 512, 0.7);
