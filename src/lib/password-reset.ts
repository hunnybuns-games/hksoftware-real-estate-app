/**
 * Password reset tokens.
 *
 * Web Crypto rather than node:crypto throughout, so the same code runs in a
 * workerd isolate and under `next dev` — same reason as src/lib/token-encryption.ts.
 *
 * Two decisions worth stating, because they're the ones that make this safe:
 *
 *  - **The token is stored hashed.** What goes in the email is the only copy of
 *    the secret; the database holds SHA-256 of it. A leaked snapshot therefore
 *    can't be replayed into account access. Plain SHA-256 is the right primitive
 *    here, unlike for passwords: this is 256 bits of CSPRNG output, so there is
 *    no dictionary to attack and nothing for a slow hash to buy.
 *  - **Comparison is by lookup, not by string compare.** We hash the incoming
 *    token and look up that hash, so there is no secret-dependent comparison in
 *    our code to leak timing, and the index does the work.
 */

import { bytesToBase64Url, sha256Hex } from "@/lib/encoding";

/** One hour. Long enough to find the email, short enough that a stale inbox isn't a standing key. */
export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

const TOKEN_BYTES = 32; // 256 bits

/**
 * A fresh token and the hash to store against it. The caller emails `token` and
 * persists `tokenHash` — returning both together is deliberate, so it's hard to
 * accidentally store the wrong one.
 */
export async function createResetToken(): Promise<{ token: string; tokenHash: string }> {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  // base64url, not base64: the token goes in a path segment, so `+`, `/` and
  // `=` would all need escaping and would survive an email client only by luck.
  const token = bytesToBase64Url(bytes);
  return { token, tokenHash: await hashResetToken(token) };
}

export async function hashResetToken(token: string): Promise<string> {
  return sha256Hex(token);
}

/** True when a token row can still be redeemed. Pure, so the rules are testable. */
export function isRedeemable(
  row: { expiresAt: Date; usedAt: Date | null } | null,
  now: Date = new Date(),
): boolean {
  if (!row) return false;
  if (row.usedAt) return false;
  return row.expiresAt > now;
}
