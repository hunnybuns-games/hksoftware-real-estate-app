import { detectImageType } from "@/lib/image-signature";

/**
 * Identifies an uploaded document by its actual leading bytes, extending the
 * same reasoning src/lib/image-signature.ts applies to photos: the browser's
 * declared `file.type` is attacker-controlled, so anything we store and later
 * serve back has to be identified from the bytes themselves.
 *
 * Broader than the photo case in one way that matters. A photo upload has a
 * closed allowlist of four formats; a document drop is explicitly "whatever a
 * real estate agent has", so the goal here isn't to reject everything
 * unrecognized — it's to *classify* what we can and fall back to a safe,
 * inert content type for the rest. An unrecognized file is still worth
 * keeping; it just gets served as a download rather than rendered inline.
 *
 * Three tiers, in order of trustworthiness:
 *
 *  1. Unambiguous magic bytes (PDF, images, legacy OLE) — trusted outright.
 *  2. Container formats needing a second look. DOCX and XLSX are both ZIP
 *     archives with identical magic; they're told apart by the entry names
 *     inside, not the header.
 *  3. Formats with no signature at all (CSV, plain text). Confirmed by
 *     checking the bytes are actually decodable text, then narrowed by
 *     filename extension — the only tier where the filename gets any say.
 */

/** Coarse routing family — what kind of thing this is, for the UI and for filing. */
export type FileFamily = "image" | "pdf" | "spreadsheet" | "word" | "text" | "unknown";

export type DetectedFile = {
  /** The media type the bytes actually are. Safe to store and serve. */
  contentType: string;
  family: FileFamily;
  /**
   * Whether a browser may render this inline. False for anything we didn't
   * positively identify, and for the office formats — those download rather
   * than render regardless, and forcing an attachment disposition on an
   * unidentified blob is the conservative call.
   */
  inlineSafe: boolean;
};

const UNKNOWN: DetectedFile = {
  // Deliberately the generic binary type, never the client's claim: an
  // unidentified file must not be able to talk a browser into treating it as
  // HTML or SVG (both of which execute script in a document context).
  contentType: "application/octet-stream",
  family: "unknown",
  inlineSafe: false,
};

function startsWith(bytes: Uint8Array, magic: number[], offset = 0): boolean {
  if (bytes.length < offset + magic.length) return false;
  return magic.every((expected, i) => bytes[offset + i] === expected);
}

/** Searches a bounded prefix for an ASCII marker — used for ZIP entry names. */
function containsAscii(bytes: Uint8Array, marker: string, searchBytes: number): boolean {
  const haystack = new TextDecoder("latin1").decode(bytes.slice(0, searchBytes));
  return haystack.includes(marker);
}

/**
 * True when the bytes look like real text rather than binary. A NUL byte is
 * the giveaway for binary — no valid UTF-8 text file contains one — and a
 * strict UTF-8 decode catches the rest.
 */
function looksLikeText(bytes: Uint8Array): boolean {
  const sample = bytes.slice(0, 8192);
  if (sample.includes(0x00)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(sample);
    return true;
  } catch {
    return false;
  }
}

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot + 1).toLowerCase();
}

export function detectFile(bytes: Uint8Array, filename: string): DetectedFile {
  // --- Tier 1: unambiguous signatures ---------------------------------------

  // Photos reuse the existing detector rather than duplicating its signature
  // table (and its HEIC brand check, which is subtler than it looks).
  const image = detectImageType(bytes);
  if (image) return { contentType: image, family: "image", inlineSafe: true };

  // PDF: "%PDF-". The spec allows leading junk before this, but every file
  // produced by real software puts it at offset 0.
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    return { contentType: "application/pdf", family: "pdf", inlineSafe: true };
  }

  // RTF: "{\rtf" — still turns up from older word processors.
  if (startsWith(bytes, [0x7b, 0x5c, 0x72, 0x74, 0x66])) {
    return { contentType: "application/rtf", family: "word", inlineSafe: false };
  }

  // --- Tier 2: ZIP containers (OOXML) ---------------------------------------
  //
  // DOCX, XLSX and PPTX are all ZIP archives — identical magic, told apart
  // only by what's inside. The distinguishing entry ("word/", "xl/") appears
  // in a local file header near the start, so a bounded prefix scan finds it
  // without unzipping anything. 4 KB is comfortably past the first few
  // entries in every real file of these formats.
  const isZip =
    startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || // normal archive
    startsWith(bytes, [0x50, 0x4b, 0x05, 0x06]) || // empty archive
    startsWith(bytes, [0x50, 0x4b, 0x07, 0x08]); // spanned archive

  if (isZip) {
    if (containsAscii(bytes, "word/", 4096)) {
      return {
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        family: "word",
        inlineSafe: false,
      };
    }
    if (containsAscii(bytes, "xl/", 4096)) {
      return {
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        family: "spreadsheet",
        inlineSafe: false,
      };
    }
    // A ZIP that isn't OOXML is just a ZIP — keep it, don't try to be clever.
    return { contentType: "application/zip", family: "unknown", inlineSafe: false };
  }

  // Legacy OLE compound file: .doc and .xls share one signature with no
  // cheap way to tell them apart (the distinction lives in a directory
  // structure well into the file). The extension is the tiebreak here
  // precisely because the bytes genuinely cannot settle it.
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    const ext = extensionOf(filename);
    if (ext === "xls") {
      return { contentType: "application/vnd.ms-excel", family: "spreadsheet", inlineSafe: false };
    }
    return { contentType: "application/msword", family: "word", inlineSafe: false };
  }

  // --- Tier 3: signature-less text formats ----------------------------------
  if (looksLikeText(bytes)) {
    const ext = extensionOf(filename);
    if (ext === "csv") return { contentType: "text/csv", family: "spreadsheet", inlineSafe: false };
    if (ext === "tsv") {
      return { contentType: "text/tab-separated-values", family: "spreadsheet", inlineSafe: false };
    }
    // Everything else textual is served as plain text, never as its claimed
    // type: an .html or .svg upload rendered inline would execute script on
    // this origin. Downgrading to text/plain defuses that without refusing
    // the file.
    return { contentType: "text/plain", family: "text", inlineSafe: false };
  }

  return UNKNOWN;
}
