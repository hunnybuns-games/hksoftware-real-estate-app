import { getPlaid } from "@/lib/plaid";
import { base64UrlToBytes, base64UrlToString, sha256Hex } from "@/lib/encoding";

/**
 * Verifies a Plaid webhook's Plaid-Verification header against Plaid's
 * rotating signing keys — see
 * https://plaid.com/docs/api/webhooks/webhook-verification/. Unlike Stripe's
 * static signing secret (see app/api/stripe/webhook/route.ts), Plaid signs
 * each webhook with a JWT (ES256) whose key rotates; the key id to fetch
 * comes from the JWT's own header, not from anything this app configures.
 *
 * Verified with the Web Crypto API directly rather than a JWT library —
 * this is one signature check over one small, fixed-shape payload, not a
 * general-purpose JWT need, and it keeps this identically real in Node and
 * Workers with no extra dependency (same reasoning as token-encryption.ts).
 *
 * Throws on any verification failure; callers must treat that exactly like
 * Stripe's signature check failing — never process an unverifiable webhook.
 */

// Plaid's own recommended freshness window — an old-but-genuinely-signed JWT
// is still a replay attempt, not a legitimate late delivery.
const MAX_WEBHOOK_AGE_SECONDS = 5 * 60;

// Cached across calls within one isolate's lifetime. Plaid's signing keys
// rotate infrequently; a cache miss just costs one extra API call, never an
// incorrect verification, so no TTL/eviction logic is needed here.
const keyCache = new Map<string, JsonWebKey>();

export async function verifyPlaidWebhook(
  rawBody: string,
  verificationHeader: string | null,
): Promise<unknown> {
  if (!verificationHeader) throw new Error("Missing Plaid-Verification header.");

  const parts = verificationHeader.split(".");
  if (parts.length !== 3) throw new Error("Malformed Plaid webhook JWT.");
  const [headerB64, payloadB64, signatureB64] = parts;

  const header = JSON.parse(base64UrlToString(headerB64)) as { alg?: string; kid?: string };
  if (header.alg !== "ES256" || !header.kid) {
    throw new Error("Unexpected Plaid webhook JWT header.");
  }

  const payload = JSON.parse(base64UrlToString(payloadB64)) as {
    iat?: number;
    request_body_sha256?: string;
  };
  if (typeof payload.iat !== "number") throw new Error("Plaid webhook JWT is missing iat.");
  const ageSeconds = Date.now() / 1000 - payload.iat;
  if (ageSeconds > MAX_WEBHOOK_AGE_SECONDS || ageSeconds < -30) {
    throw new Error("Plaid webhook JWT is too old (or timestamped in the future) to trust.");
  }

  const key = await getVerificationKey(header.kid);
  const cryptoKey = await crypto.subtle.importKey(
    "jwk",
    key,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );

  const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = base64UrlToBytes(signatureB64);
  const validSignature = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    cryptoKey,
    signature,
    signingInput,
  );
  if (!validSignature) throw new Error("Plaid webhook signature did not verify.");

  const expectedHash = await sha256Hex(rawBody);
  if (payload.request_body_sha256 !== expectedHash) {
    throw new Error("Plaid webhook body hash did not match the signed value — body may have been tampered with.");
  }

  return JSON.parse(rawBody);
}

async function getVerificationKey(keyId: string): Promise<JsonWebKey> {
  const cached = keyCache.get(keyId);
  if (cached) return cached;

  const response = await getPlaid().webhookVerificationKeyGet({ key_id: keyId });
  const key = response.data.key;
  if (key.expired_at !== null) throw new Error("Plaid verification key has expired.");

  // Web Crypto's JWK import for a P-256 verify key needs exactly kty/crv/x/y
  // — passing Plaid's alg ("ES256") / use ("sig") strings through isn't
  // necessary and some runtimes are stricter than others about validating
  // them against the requested algorithm, so they're left out.
  const jwk: JsonWebKey = { kty: key.kty, crv: key.crv, x: key.x, y: key.y };
  keyCache.set(keyId, jwk);
  return jwk;
}

