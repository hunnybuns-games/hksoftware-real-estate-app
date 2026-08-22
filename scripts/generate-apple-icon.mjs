#!/usr/bin/env node
/**
 * Regenerates src/app/apple-icon.png — the 180×180 icon iOS uses when someone
 * adds this app to their home screen.
 *
 * Why a generator instead of a committed binary someone drew once: the icon is
 * derived from exactly two things, the brand colour and the mark in
 * src/components/logo.tsx, and both will change when the real brand lands. A
 * script means the next person can change SITE.themeColor and re-run this,
 * rather than opening a design tool to work out what shade of blue a stray PNG
 * happens to be.
 *
 * The actual rasterizer lives in scripts/lib/mark-render.mjs, shared with
 * generate-manifest-icons.mjs — the mark and the PNG-writing are the same
 * for both, only the size and framing differ.
 *
 * PNG is written by hand and there's no image library dependency; SVG would
 * be simpler but Safari has never supported SVG for apple-touch-icon, which
 * is the entire audience for this file.
 *
 * Run: node scripts/generate-apple-icon.mjs
 */

import { writeFileSync } from "node:fs";
import { renderMarkPng } from "./lib/mark-render.mjs";

const SIZE = 180;
// iOS applies its own rounded-rect mask, so the artwork underneath is a full
// square, edge-to-edge — contentScale: 1 is the default for exactly this.
const png = renderMarkPng({ size: SIZE });

const out = new URL("../src/app/apple-icon.png", import.meta.url);
writeFileSync(out, png);
console.log(`wrote ${out.pathname} — ${SIZE}×${SIZE}, ${png.length} bytes`);
