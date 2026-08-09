import { ALLOWED_PHOTO_TYPES } from "@/lib/constants";

/**
 * Identifies an image by its actual leading bytes rather than by the
 * Content-Type the browser claimed for it.
 *
 * The declared `file.type` on an upload is attacker-controlled — anything can
 * say `image/jpeg`. This is defense in depth rather than a hole being closed:
 * the allowlist already excludes SVG and HTML (the formats that would actually
 * execute), and responses from the photo route carry
 * `X-Content-Type-Options: nosniff` so a browser won't reinterpret them. But
 * storing bytes we've never looked at and serving them back with a
 * Content-Type we took on faith is a weak link worth removing, especially
 * since the bytes are already in hand at validation time.
 *
 * Returns the media type the bytes actually are, or null if they aren't one of
 * the formats this app accepts.
 */

type Signature = {
  type: (typeof ALLOWED_PHOTO_TYPES)[number];
  /** Byte values to match, with null meaning "any byte in this position". */
  magic: (number | null)[];
  offset: number;
};

const SIGNATURES: Signature[] = [
  // JPEG: FF D8 FF — every variant (JFIF, Exif, raw) shares this.
  { type: "image/jpeg", offset: 0, magic: [0xff, 0xd8, 0xff] },

  // PNG: the 8-byte signature from the spec, including the CRLF/EOF bytes
  // deliberately chosen there to catch corrupting transfers.
  { type: "image/png", offset: 0, magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },

  // WebP is RIFF-container: "RIFF" then a 4-byte little-endian length that
  // varies per file, then "WEBP". The nulls skip the length.
  {
    type: "image/webp",
    offset: 0,
    magic: [
      0x52, 0x49, 0x46, 0x46, // R I F F
      null, null, null, null, // file size
      0x57, 0x45, 0x42, 0x50, // W E B P
    ],
  },

  // HEIC is ISO-BMFF: a 4-byte box size, then "ftyp", then a brand. iPhones
  // emit heic/heix/hevc/hevx/mif1/msf1 depending on model and whether it's a
  // still or a burst, so the brand is checked separately below.
  {
    type: "image/heic",
    offset: 0,
    magic: [null, null, null, null, 0x66, 0x74, 0x79, 0x70], // ---- f t y p
  },
];

/** ISO-BMFF brands that mean "this is a HEIF/HEIC still image". */
const HEIF_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "mif1", "msf1", "heim", "hesp"]);

function matches(bytes: Uint8Array, sig: Signature): boolean {
  if (bytes.length < sig.offset + sig.magic.length) return false;
  return sig.magic.every((expected, i) => expected === null || bytes[sig.offset + i] === expected);
}

export function detectImageType(bytes: Uint8Array): (typeof ALLOWED_PHOTO_TYPES)[number] | null {
  for (const sig of SIGNATURES) {
    if (!matches(bytes, sig)) continue;

    // An ftyp box alone isn't enough — plenty of non-image ISO-BMFF files
    // (MP4 video, notably) share it. Only HEIF brands count.
    if (sig.type === "image/heic") {
      const brand = new TextDecoder("latin1").decode(bytes.slice(8, 12));
      if (!HEIF_BRANDS.has(brand)) continue;
    }

    return sig.type;
  }
  return null;
}
