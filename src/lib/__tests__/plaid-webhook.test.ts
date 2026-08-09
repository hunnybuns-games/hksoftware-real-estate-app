import { beforeAll, describe, expect, it, vi } from "vitest";
import { verifyPlaidWebhook } from "@/lib/plaid-webhook";

/**
 * Real ES256 signing/verification round-tripped through the actual Web
 * Crypto API this module uses in production — not a mocked crypto layer.
 * Only the network call to fetch Plaid's public key is mocked, since that's
 * the one thing this test can't reach from inside this environment (see the
 * commits around the Plaid schema/lib work for why).
 */

let privateKey: CryptoKey;
let publicJwk: JsonWebKey;

vi.mock("@/lib/plaid", () => ({
  getPlaid: () => ({
    webhookVerificationKeyGet: async () => ({
      data: {
        key: {
          kty: publicJwk.kty,
          crv: publicJwk.crv,
          x: publicJwk.x,
          y: publicJwk.y,
          kid: "test-kid",
          alg: "ES256",
          use: "sig",
          created_at: Math.floor(Date.now() / 1000),
          expired_at: null,
        },
      },
    }),
  }),
}));

beforeAll(async () => {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  privateKey = keyPair.privateKey;
  publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
});

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function signWebhook(
  body: string,
  overrides: { iat?: number; alg?: string; kid?: string } = {},
  signingKey: CryptoKey = privateKey,
): Promise<string> {
  const header = { alg: overrides.alg ?? "ES256", kid: overrides.kid ?? "test-kid" };
  const payload = {
    iat: overrides.iat ?? Math.floor(Date.now() / 1000),
    request_body_sha256: await sha256Hex(body),
  };
  const headerB64 = base64Url(new TextEncoder().encode(JSON.stringify(header)));
  const payloadB64 = base64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    signingKey,
    new TextEncoder().encode(`${headerB64}.${payloadB64}`),
  );
  return `${headerB64}.${payloadB64}.${base64Url(new Uint8Array(signature))}`;
}

const sampleBody = JSON.stringify({
  webhook_type: "TRANSACTIONS",
  webhook_code: "SYNC_UPDATES_AVAILABLE",
  item_id: "item-1",
});

describe("verifyPlaidWebhook", () => {
  it("accepts a correctly signed, fresh webhook and returns the parsed body", async () => {
    const jwt = await signWebhook(sampleBody);
    await expect(verifyPlaidWebhook(sampleBody, jwt)).resolves.toEqual({
      webhook_type: "TRANSACTIONS",
      webhook_code: "SYNC_UPDATES_AVAILABLE",
      item_id: "item-1",
    });
  });

  it("rejects a missing verification header", async () => {
    await expect(verifyPlaidWebhook(sampleBody, null)).rejects.toThrow(/missing/i);
  });

  it("rejects a malformed JWT", async () => {
    await expect(verifyPlaidWebhook(sampleBody, "not-a-jwt")).rejects.toThrow(/malformed/i);
  });

  it("rejects a tampered body — the signed hash no longer matches", async () => {
    const jwt = await signWebhook(sampleBody);
    const tamperedBody = JSON.stringify({
      webhook_type: "TRANSACTIONS",
      webhook_code: "SYNC_UPDATES_AVAILABLE",
      item_id: "item-EVIL",
    });
    await expect(verifyPlaidWebhook(tamperedBody, jwt)).rejects.toThrow(/hash/i);
  });

  it("rejects a signature produced by a different key claiming the same kid", async () => {
    const forgedKeyPair = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"],
    );
    const jwt = await signWebhook(sampleBody, {}, forgedKeyPair.privateKey);
    await expect(verifyPlaidWebhook(sampleBody, jwt)).rejects.toThrow(/signature/i);
  });

  it("rejects a stale webhook (iat an hour old)", async () => {
    const staleIat = Math.floor(Date.now() / 1000) - 60 * 60;
    const jwt = await signWebhook(sampleBody, { iat: staleIat });
    await expect(verifyPlaidWebhook(sampleBody, jwt)).rejects.toThrow(/old/i);
  });

  it("rejects an unexpected signing algorithm", async () => {
    const jwt = await signWebhook(sampleBody, { alg: "HS256" });
    await expect(verifyPlaidWebhook(sampleBody, jwt)).rejects.toThrow(/header/i);
  });
});
