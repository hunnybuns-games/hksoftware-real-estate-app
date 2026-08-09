import { describe, expect, it } from "vitest";
import { detectImageType } from "@/lib/image-signature";

/** Builds a buffer starting with `head`, padded out so length checks pass. */
function bytes(head: number[], totalLength = 64): Uint8Array {
  const out = new Uint8Array(totalLength);
  out.set(head, 0);
  return out;
}

function ascii(text: string): number[] {
  return [...text].map((c) => c.charCodeAt(0));
}

const JPEG = [0xff, 0xd8, 0xff, 0xe0];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const WEBP = [...ascii("RIFF"), 0x24, 0x00, 0x00, 0x00, ...ascii("WEBP")];
const HEIC = [0x00, 0x00, 0x00, 0x18, ...ascii("ftyp"), ...ascii("heic")];

describe("detectImageType", () => {
  it("identifies JPEG", () => {
    expect(detectImageType(bytes(JPEG))).toBe("image/jpeg");
  });

  it("identifies PNG", () => {
    expect(detectImageType(bytes(PNG))).toBe("image/png");
  });

  it("identifies WebP regardless of the RIFF length field", () => {
    const other = [...ascii("RIFF"), 0xff, 0xee, 0xdd, 0xcc, ...ascii("WEBP")];
    expect(detectImageType(bytes(WEBP))).toBe("image/webp");
    expect(detectImageType(bytes(other))).toBe("image/webp");
  });

  it("identifies HEIC", () => {
    expect(detectImageType(bytes(HEIC))).toBe("image/heic");
  });

  it("identifies the other HEIF brands iPhones emit", () => {
    for (const brand of ["heix", "hevc", "hevx", "mif1", "msf1"]) {
      const buf = bytes([0x00, 0x00, 0x00, 0x18, ...ascii("ftyp"), ...ascii(brand)]);
      expect(detectImageType(buf), brand).toBe("image/heic");
    }
  });

  it("rejects an MP4 — same ftyp box as HEIC, different brand", () => {
    // The specific false positive a naive ftyp check would let through.
    const mp4 = bytes([0x00, 0x00, 0x00, 0x18, ...ascii("ftyp"), ...ascii("isom")]);
    expect(detectImageType(mp4)).toBeNull();
  });

  it("rejects SVG, which is markup a browser could execute", () => {
    expect(detectImageType(bytes(ascii("<svg xmlns=")))).toBeNull();
  });

  it("rejects HTML", () => {
    expect(detectImageType(bytes(ascii("<!DOCTYPE html>")))).toBeNull();
  });

  it("rejects a PDF", () => {
    expect(detectImageType(bytes(ascii("%PDF-1.7")))).toBeNull();
  });

  it("rejects GIF — a real image format, but not one this app accepts", () => {
    expect(detectImageType(bytes(ascii("GIF89a")))).toBeNull();
  });

  it("rejects a truncated header rather than reading past the end", () => {
    // Two of JPEG's three magic bytes, and nothing else.
    expect(detectImageType(new Uint8Array([0xff, 0xd8]))).toBeNull();
    expect(detectImageType(new Uint8Array([]))).toBeNull();
  });

  it("rejects a payload that merely claims to be an image in its body", () => {
    // What the declared-Content-Type check alone would have accepted.
    expect(detectImageType(bytes(ascii("image/jpeg\n<script>alert(1)</script>")))).toBeNull();
  });

  it("does not match a signature that appears later in the file", () => {
    // PNG magic at offset 16 is not a PNG — the signature has to lead.
    const buried = new Uint8Array(64);
    buried.set(PNG, 16);
    expect(detectImageType(buried)).toBeNull();
  });
});
