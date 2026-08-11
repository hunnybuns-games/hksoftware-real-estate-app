#!/usr/bin/env node
/**
 * Regenerates src/app/apple-icon.png — the 180×180 icon iOS uses when someone
 * adds this app to their home screen.
 *
 * Why a generator instead of a committed binary someone drew once: the icon is
 * derived from exactly two things, the brand colour and the letterform in
 * src/components/logo.tsx, and both will change when the real brand lands. A
 * script means the next person can change SITE.themeColor and re-run this,
 * rather than opening a design tool to work out what shade of blue a stray PNG
 * happens to be.
 *
 * PNG is written by hand (zlib is in Node; an image library is not, and this
 * doesn't warrant adding one). SVG would be simpler but Safari has never
 * supported SVG for apple-touch-icon, which is the entire audience for this file.
 *
 * Run: node scripts/generate-apple-icon.mjs
 */

import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const SIZE = 180;
// --color-brand-600 from globals.css, resolved out of oklch().
const BRAND = [0x1f, 0x6f, 0x8b];
const WHITE = [0xff, 0xff, 0xff];
// iOS applies its own rounded-rect mask, so the artwork underneath is a full
// square. Rounding it here too would show as a dark fringe inside Apple's mask.

/**
 * Coverage of the letter R at a point, in the unit square. Returns 0..1 so the
 * caller can supersample — a hard boolean here is what makes hand-rolled icons
 * look jagged at 180px.
 */
function inLetter(x, y) {
  // Stem.
  if (x >= 0.2 && x <= 0.37 && y >= 0.17 && y <= 0.83) return true;

  const ellipse = (cx, cy, rx, ry) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;

  // Bowl: the ring between two ellipses, upper half only, right of the stem.
  if (y >= 0.17 && y <= 0.54 && x >= 0.3) {
    if (ellipse(0.4, 0.355, 0.3, 0.19) && !ellipse(0.4, 0.355, 0.15, 0.082)) return true;
  }

  // Leg: a thick segment from under the bowl down to the baseline.
  const x0 = 0.42;
  const y0 = 0.5;
  const x1 = 0.73;
  const y1 = 0.83;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const t = ((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy);
  if (t >= 0 && t <= 1) {
    const px = x0 + t * dx;
    const py = y0 + t * dy;
    if (Math.hypot(x - px, y - py) <= 0.085) return true;
  }

  return false;
}

const SUPERSAMPLE = 4;
function coverage(px, py) {
  let hits = 0;
  for (let sy = 0; sy < SUPERSAMPLE; sy++) {
    for (let sx = 0; sx < SUPERSAMPLE; sx++) {
      const x = (px + (sx + 0.5) / SUPERSAMPLE) / SIZE;
      const y = (py + (sy + 0.5) / SUPERSAMPLE) / SIZE;
      if (inLetter(x, y)) hits++;
    }
  }
  return hits / (SUPERSAMPLE * SUPERSAMPLE);
}

// Raw RGB scanlines, each prefixed with filter byte 0 (PNG "None").
const raw = Buffer.alloc(SIZE * (1 + SIZE * 3));
let o = 0;
for (let y = 0; y < SIZE; y++) {
  raw[o++] = 0;
  for (let x = 0; x < SIZE; x++) {
    const a = coverage(x, y);
    for (let c = 0; c < 3; c++) {
      raw[o++] = Math.round(BRAND[c] * (1 - a) + WHITE[c] * a);
    }
  }
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([len, typeAndData, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 2; // colour type 2 = truecolour RGB
ihdr[10] = 0; // deflate
ihdr[11] = 0; // adaptive filtering
ihdr[12] = 0; // non-interlaced

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

const out = new URL("../src/app/apple-icon.png", import.meta.url);
writeFileSync(out, png);
console.log(`wrote ${out.pathname} — ${SIZE}×${SIZE}, ${png.length} bytes`);
