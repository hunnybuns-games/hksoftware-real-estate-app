import { beforeAll, describe, expect, it } from "vitest";

/**
 * BankConnection.accessTokenEncrypted holds a live credential for a landlord's
 * bank feed, encrypted at rest. Two properties matter and neither was covered
 * before:
 *
 *  1. it round-trips, and
 *  2. **the stored format doesn't drift.** A token encrypted by an older build
 *     has to keep decrypting, or every already-connected bank account silently
 *     stops syncing and has to be re-linked. FIXED_CIPHERTEXT below was
 *     produced by the implementation as it stood before the base64 helpers were
 *     factored into src/lib/encoding.ts; if a change to the encoding or the
 *     iv||ciphertext layout breaks compatibility, this test fails rather than
 *     production doing so.
 */

// Not a real key — 32 bytes of ASCII, base64-encoded, for tests only.
const TEST_KEY = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";
const FIXED_PLAINTEXT = "access-sandbox-6f1c9d02-not-a-real-token";
const FIXED_CIPHERTEXT =
  "zbNkypfk+Tvhga+eDURy+/X+L23gxKs7HJKqQHjwyqVjKWvunIiDrDsQHEmJ+gY6B6YbLpNZQVsf/pktqGGeFih4FvU=";

let encryptToken: (plaintext: string) => Promise<string>;
let decryptToken: (encoded: string) => Promise<string>;

beforeAll(async () => {
  // The key is read at call time from the environment, so it has to be set
  // before the module under test is imported.
  process.env.BANK_TOKEN_ENCRYPTION_KEY = TEST_KEY;
  ({ encryptToken, decryptToken } = await import("@/lib/token-encryption"));
});

describe("token encryption", () => {
  it("decrypts a ciphertext written by the previous implementation", async () => {
    expect(await decryptToken(FIXED_CIPHERTEXT)).toBe(FIXED_PLAINTEXT);
  });

  it("round-trips a token", async () => {
    const encrypted = await encryptToken(FIXED_PLAINTEXT);
    expect(await decryptToken(encrypted)).toBe(FIXED_PLAINTEXT);
  });

  it("never stores the token in the clear", async () => {
    const encrypted = await encryptToken(FIXED_PLAINTEXT);
    expect(encrypted).not.toContain(FIXED_PLAINTEXT);
    expect(encrypted).not.toContain("6f1c9d02");
  });

  it("uses a fresh iv per call, so the same token encrypts differently each time", async () => {
    // Reusing an iv with the same key is the one thing that actually breaks
    // AES-GCM, so identical output for identical input would be a real defect.
    const a = await encryptToken(FIXED_PLAINTEXT);
    const b = await encryptToken(FIXED_PLAINTEXT);
    expect(a).not.toBe(b);
    expect(await decryptToken(a)).toBe(await decryptToken(b));
  });

  it("round-trips values that are awkward to encode", async () => {
    for (const value of ["", "a", "é — 🔑 non-ascii", "x".repeat(5000)]) {
      expect(await decryptToken(await encryptToken(value))).toBe(value);
    }
  });

  it("rejects a tampered ciphertext rather than returning garbage", async () => {
    // GCM is authenticated; flipping a byte has to fail, not decrypt to noise.
    const encrypted = await encryptToken(FIXED_PLAINTEXT);
    const tampered =
      encrypted.slice(0, -6) + (encrypted.at(-6) === "A" ? "B" : "A") + encrypted.slice(-5);
    await expect(decryptToken(tampered)).rejects.toThrow();
  });

  it("rejects a truncated ciphertext", async () => {
    await expect(decryptToken(FIXED_CIPHERTEXT.slice(0, 12))).rejects.toThrow();
  });
});
