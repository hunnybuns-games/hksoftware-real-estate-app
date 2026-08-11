/**
 * Encoding bytes as text — base64, base64url, and hex — in one place.
 *
 * Built on btoa/atob rather than node:crypto's Buffer. Both exist under
 * Workers' nodejs_compat flag, but btoa/atob are real standard globals in
 * Node 20+ *and* Workers with no compat flag or polyfill involved either
 * place — same reasoning as Stripe's fetch-based HTTP client in
 * src/lib/stripe.ts: prefer the API that's identically real everywhere over
 * the one that merely happens to be shimmed on one of the two runtimes.
 *
 * btoa/atob work on binary strings, not byte arrays, so each function below
 * makes the char-code round trip that bridges the two. That is the portable
 * way to do this, and the reason these live here rather than being rewritten
 * at each call site — three modules had their own copy before, two of them in
 * credential-handling paths.
 *
 * The `Url` variants use base64url (RFC 4648 §5): `-`/`_` instead of `+`/`/`,
 * and no `=` padding — safe to put in a URL path or query string, which is
 * what password-reset links and Plaid's JWT headers need.
 */

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlToBytes(input: string): Uint8Array<ArrayBuffer> {
  const unreserved = input.replace(/-/g, "+").replace(/_/g, "/");
  // Padding is optional in base64url but required by atob.
  const padded = unreserved + "=".repeat((4 - (unreserved.length % 4)) % 4);
  return base64ToBytes(padded);
}

export function base64UrlToString(input: string): string {
  return new TextDecoder().decode(base64UrlToBytes(input));
}

export function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * SHA-256 of a string, lowercase hex. Web Crypto for the same portability
 * reason as the base64 helpers above.
 *
 * Two callers hash with this, and neither is hashing a password: password
 * reset tokens (256 bits of CSPRNG output — no dictionary to attack, so a slow
 * hash buys nothing) and Plaid's webhook body. Passwords go through bcrypt in
 * src/lib/auth.ts instead, and must never come here.
 */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return bytesToHex(new Uint8Array(digest));
}
