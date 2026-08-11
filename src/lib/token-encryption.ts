/**
 * Encrypts long-lived external credentials at rest — right now that's just
 * BankConnection.accessTokenEncrypted (see prisma/schema.prisma), but the name
 * is generic on purpose in case a future integration needs the same thing.
 *
 * Uses the Web Crypto API (AES-256-GCM) rather than node:crypto. Both exist
 * under Workers' nodejs_compat flag, but Web Crypto is a standard global in
 * Node 20+ *and* Workers with no compat flag or polyfill involved either
 * place — same reasoning as Stripe's fetch-based HTTP client in
 * src/lib/stripe.ts: prefer the API that's identically real everywhere over
 * the one that merely happens to be shimmed on one of the two runtimes.
 *
 * The base64 encoding of the stored value is part of this module's on-disk
 * format: anything already in BankConnection.accessTokenEncrypted has to keep
 * decrypting. src/lib/__tests__/token-encryption.test.ts pins that with a
 * fixed ciphertext vector.
 */

import { base64ToBytes, bytesToBase64 } from "@/lib/encoding";

const ALGORITHM = "AES-GCM";
const IV_BYTES = 12; // 96 bits — the size AES-GCM is defined for; don't change this independently of decrypt.

function getKeyBytes(): Uint8Array<ArrayBuffer> {
  const raw = process.env.BANK_TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "BANK_TOKEN_ENCRYPTION_KEY is not set. Generate one with `openssl rand -base64 32`.",
    );
  }
  const bytes = base64ToBytes(raw);
  if (bytes.length !== 32) {
    throw new Error(
      `BANK_TOKEN_ENCRYPTION_KEY must decode to 32 bytes for AES-256 (got ${bytes.length}). Generate one with \`openssl rand -base64 32\`.`,
    );
  }
  return bytes;
}

async function importKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", getKeyBytes(), ALGORITHM, false, ["encrypt", "decrypt"]);
}

/** Encodes as base64(iv || ciphertext) — a fresh random iv on every call, never reused. */
export async function encryptToken(plaintext: string): Promise<string> {
  const key = await importKey();
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return bytesToBase64(combined);
}

export async function decryptToken(encoded: string): Promise<string> {
  const key = await importKey();
  const combined = base64ToBytes(encoded);
  const iv = combined.slice(0, IV_BYTES);
  const ciphertext = combined.slice(IV_BYTES);
  const plaintext = await crypto.subtle.decrypt({ name: ALGORITHM, iv }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}
