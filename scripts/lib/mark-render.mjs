/**
 * Hand-rolled rasterizer for the ComfyLease mark (see src/app/icon.svg) —
 * shared by every script that needs a raster copy of it at some size. PNG is
 * written by hand and there's no image library dependency (zlib is in Node;
 * an image library is not, and none of these call sites warrant adding one).
 *
 * The mark is defined once, in the same 32-unit space as icon.svg's
 * viewBox, and every consumer asks for it at a `size` and a `contentScale`
 * — the fraction of `size` the native 32-unit artwork should occupy, centred,
 * with the rest as brand-colour padding. `contentScale: 1` (the default)
 * reproduces the original tight-cropped framing icon.svg and apple-icon.png
 * both use; a smaller value is what a maskable manifest icon needs, so the
 * artwork survives Android's adaptive-icon safe-zone crop instead of having
 * its ground line clipped off. See generate-manifest-icons.mjs for the math.
 */

import { deflateSync } from "node:zlib";

// --color-brand-600 from globals.css, resolved out of oklch() — PNG has no
// concept of the CSS colour space this app authors in.
export const BRAND = [0x1f, 0x6f, 0x8b];
export const WHITE = [0xff, 0xff, 0xff];

/**
 * The mark, as line segments in the native 32-unit space: a peaked roof, a
 * chimney rising off its left slope (open at the bottom — it reads as
 * growing out of the roofline), a door, and the ground line beneath.
 */
const SEGMENTS = [
  [16, 7, 6, 19],
  [16, 7, 26, 19],
  [5, 26, 27, 26],
  [9, 17, 9, 9],
  [9, 9, 13, 9],
  [13, 9, 13, 17],
  [13, 20, 19, 20],
  [19, 20, 19, 26],
  [19, 26, 13, 26],
  [13, 26, 13, 20],
];

// Matches icon.svg's stroke-width="2.4" in the same 32-unit space.
const STROKE_HALF_WIDTH = 2.4 / 2;

function distanceToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function inLetter(xUnit, yUnit) {
  return SEGMENTS.some(([x1, y1, x2, y2]) => distanceToSegment(xUnit, yUnit, x1, y1, x2, y2) < STROKE_HALF_WIDTH);
}

const SUPERSAMPLE = 4;

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

/**
 * Renders the mark to a truecolour RGB PNG buffer.
 *
 * @param {number} size - output width/height in pixels (square).
 * @param {number} [contentScale] - fraction of `size` the 32-unit artwork
 *   occupies, centred. 1 (default) fills the canvas edge-to-edge, same
 *   framing as icon.svg/apple-icon.png.
 */
export function renderMarkPng({ size, contentScale = 1 }) {
  const pixelsPerUnit = (size * contentScale) / 32;
  const offset = (size - 32 * pixelsPerUnit) / 2;

  function coverage(px, py) {
    let hits = 0;
    for (let sy = 0; sy < SUPERSAMPLE; sy++) {
      for (let sx = 0; sx < SUPERSAMPLE; sx++) {
        const xUnit = (px + (sx + 0.5) / SUPERSAMPLE - offset) / pixelsPerUnit;
        const yUnit = (py + (sy + 0.5) / SUPERSAMPLE - offset) / pixelsPerUnit;
        if (inLetter(xUnit, yUnit)) hits++;
      }
    }
    return hits / (SUPERSAMPLE * SUPERSAMPLE);
  }

  // Raw RGB scanlines, each prefixed with filter byte 0 (PNG "None").
  const raw = Buffer.alloc(size * (1 + size * 3));
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0;
    for (let x = 0; x < size; x++) {
      const a = coverage(x, y);
      for (let c = 0; c < 3; c++) {
        raw[o++] = Math.round(BRAND[c] * (1 - a) + WHITE[c] * a);
      }
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type 2 = truecolour RGB
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // non-interlaced

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
