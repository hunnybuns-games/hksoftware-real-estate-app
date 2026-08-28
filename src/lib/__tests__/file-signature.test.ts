import { describe, expect, it } from "vitest";
import { detectFile } from "@/lib/file-signature";

/**
 * The security-relevant claim these pin down: what gets stored and served is
 * decided by the bytes, never by the filename or the browser's declared type.
 * A file that lies about being a PDF must not be served as one, and an
 * unidentified blob must never come back as something a browser will execute.
 */

const bytes = (...values: number[]) => new Uint8Array(values);
const ascii = (text: string) => new TextEncoder().encode(text);

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

describe("detectFile", () => {
  it("identifies a PDF by its header", () => {
    const result = detectFile(ascii("%PDF-1.7\nrest of file"), "lease.pdf");
    expect(result.contentType).toBe("application/pdf");
    expect(result.family).toBe("pdf");
    expect(result.inlineSafe).toBe(true);
  });

  it("identifies a JPEG through the shared image detector", () => {
    const result = detectFile(bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10), "photo.jpg");
    expect(result.contentType).toBe("image/jpeg");
    expect(result.family).toBe("image");
  });

  it("tells DOCX and XLSX apart by their zip entries, not their extension", () => {
    const zip = bytes(0x50, 0x4b, 0x03, 0x04);
    const docx = detectFile(concat(zip, ascii("....word/document.xml")), "anything.bin");
    const xlsx = detectFile(concat(zip, ascii("....xl/workbook.xml")), "anything.bin");

    expect(docx.family).toBe("word");
    expect(xlsx.family).toBe("spreadsheet");
  });

  it("falls back to a plain zip when an archive is not OOXML", () => {
    const result = detectFile(concat(bytes(0x50, 0x4b, 0x03, 0x04), ascii("photos/img1.jpg")), "bundle.zip");
    expect(result.contentType).toBe("application/zip");
    expect(result.inlineSafe).toBe(false);
  });

  it("uses the extension only for legacy OLE, where the bytes genuinely cannot decide", () => {
    const ole = bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00, 0x00);
    expect(detectFile(ole, "rentroll.xls").family).toBe("spreadsheet");
    expect(detectFile(ole, "lease.doc").family).toBe("word");
  });

  it("recognises CSV as a spreadsheet so the data-import path can claim it", () => {
    const result = detectFile(ascii("Date,Amount,Description\n2026-01-01,1800.00,RENT"), "january.csv");
    expect(result.contentType).toBe("text/csv");
    expect(result.family).toBe("spreadsheet");
  });

  it("downgrades HTML to text/plain rather than serving something executable", () => {
    // An .html upload served inline as text/html would run script on this
    // origin. It is still accepted — just neutered.
    const result = detectFile(ascii("<html><script>alert(1)</script></html>"), "evil.html");
    expect(result.contentType).toBe("text/plain");
    expect(result.inlineSafe).toBe(false);
  });

  it("does not trust a PDF extension on non-PDF bytes", () => {
    const result = detectFile(bytes(0x00, 0x01, 0x02, 0x03, 0xff, 0xfe), "totally-a.pdf");
    expect(result.contentType).toBe("application/octet-stream");
    expect(result.inlineSafe).toBe(false);
  });

  it("treats binary with a NUL byte as unknown, not as text", () => {
    const result = detectFile(bytes(0x41, 0x42, 0x00, 0x43), "notes.txt");
    expect(result.family).toBe("unknown");
  });

  it("accepts an empty file without throwing", () => {
    expect(() => detectFile(new Uint8Array(0), "empty.pdf")).not.toThrow();
  });
});
