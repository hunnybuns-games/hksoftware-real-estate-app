import { describe, expect, it } from "vitest";
import {
  base64ToBytes,
  base64UrlToBytes,
  base64UrlToString,
  bytesToBase64,
  bytesToBase64Url,
  bytesToHex,
  sha256Hex,
} from "@/lib/encoding";

/**
 * These sit under password reset tokens, bank-credential encryption and Plaid
 * webhook verification, so the edge cases that would corrupt a byte — padding,
 * the base64url alphabet, high bytes — are pinned here rather than discovered
 * through one of those.
 */

const bytes = (...n: number[]) => new Uint8Array(n);

describe("base64", () => {
  it("matches known vectors", () => {
    expect(bytesToBase64(new TextEncoder().encode("hello"))).toBe("aGVsbG8=");
    expect(bytesToBase64(new TextEncoder().encode("hi"))).toBe("aGk=");
    expect(bytesToBase64(new Uint8Array())).toBe("");
  });

  it("round-trips every byte value, including the high half", () => {
    // A char-code bridge that gets signedness or >127 wrong corrupts exactly
    // here, and only for binary payloads like an AES iv.
    const all = new Uint8Array(256);
    for (let i = 0; i < 256; i++) all[i] = i;
    expect([...base64ToBytes(bytesToBase64(all))]).toEqual([...all]);
  });

  it("round-trips each length mod 4, so padding is handled", () => {
    for (let len = 0; len < 9; len++) {
      const b = new Uint8Array(len);
      for (let i = 0; i < len; i++) b[i] = (i * 37 + 11) & 0xff;
      expect([...base64ToBytes(bytesToBase64(b))]).toEqual([...b]);
    }
  });
});

describe("base64url", () => {
  it("uses -/_ and drops padding", () => {
    // 0xfb 0xff encodes to "+/8=" in standard base64 — the one input that
    // exercises both substitutions and the stripped padding at once.
    expect(bytesToBase64(bytes(0xfb, 0xff))).toBe("+/8=");
    expect(bytesToBase64Url(bytes(0xfb, 0xff))).toBe("-_8");
  });

  it("is URL-safe for random tokens", () => {
    for (let i = 0; i < 50; i++) {
      const b = new Uint8Array(32);
      crypto.getRandomValues(b);
      expect(bytesToBase64Url(b)).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it("round-trips through the unpadded form", () => {
    for (let len = 1; len < 9; len++) {
      const b = new Uint8Array(len);
      crypto.getRandomValues(b);
      expect([...base64UrlToBytes(bytesToBase64Url(b))]).toEqual([...b]);
    }
  });

  it("decodes padded input too, since senders may include it", () => {
    expect([...base64UrlToBytes("-_8=")]).toEqual([0xfb, 0xff]);
    expect([...base64UrlToBytes("-_8")]).toEqual([0xfb, 0xff]);
  });

  it("decodes a JWT-style segment to text", () => {
    const json = JSON.stringify({ alg: "ES256", kid: "abc" });
    expect(base64UrlToString(bytesToBase64Url(new TextEncoder().encode(json)))).toBe(json);
  });
});

describe("hex", () => {
  it("zero-pads each byte to two digits", () => {
    expect(bytesToHex(bytes(0x00, 0x0f, 0xff, 0x7f))).toBe("000fff7f");
    expect(bytesToHex(new Uint8Array())).toBe("");
  });
});

describe("sha256Hex", () => {
  it("matches the known digest of the empty string", () => {
    // The canonical SHA-256 test vector — catches a wrong algorithm outright.
    return expect(sha256Hex("")).resolves.toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("matches the known digest of 'abc'", async () => {
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("is 64 lowercase hex chars and stable across calls", async () => {
    const a = await sha256Hex("some-reset-token");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await sha256Hex("some-reset-token")).toBe(a);
    expect(await sha256Hex("some-reset-tokeo")).not.toBe(a);
  });

  it("hashes non-ascii by its utf-8 bytes", async () => {
    expect(await sha256Hex("é")).toBe(await sha256Hex("é"));
  });
});
