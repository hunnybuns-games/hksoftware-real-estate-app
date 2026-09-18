#!/usr/bin/env node
/**
 * Regenerates src/app/apple-icon.png — the 180×180 icon iOS uses when someone
 * adds this app to their home screen.
 *
 * Why a generator instead of a committed binary someone drew once: the icon is
 * derived from one thing, src/app/icon.svg, and this is how the PNG copies
 * stay in step with it. Change the SVG, re-run this, done — nobody has to
 * open a design tool to reproduce the cat at 180px.
 *
 * The actual rasterizer lives in scripts/lib/mark-render.mjs, shared with
 * generate-manifest-icons.mjs — the mark and the PNG-writing are the same
 * for both, only the size and framing differ.
 *
 * PNG rather than SVG because Safari has never supported SVG for
 * apple-touch-icon, which is the entire audience for this file. It's opaque
 * (white behind the cushion) because iOS composites a transparent touch icon
 * onto black.
 *
 * Run: node scripts/generate-apple-icon.mjs
 */

import { writeFileSync } from "node:fs";
import { renderMarkPng } from "./lib/mark-render.mjs";

const SIZE = 180;
// iOS applies its own rounded-rect mask, so the artwork underneath is a full
// square, edge-to-edge — contentScale: 1 is the default for exactly this.
const png = await renderMarkPng({ size: SIZE });

const out = new URL("../src/app/apple-icon.png", import.meta.url);
writeFileSync(out, png);
console.log(`wrote ${out.pathname} — ${SIZE}×${SIZE}, ${png.length} bytes`);
