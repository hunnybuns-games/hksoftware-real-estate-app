import { describe, expect, it } from "vitest";
import {
  RESET_TOKEN_TTL_MS,
  createResetToken,
  hashResetToken,
  isRedeemable,
} from "@/lib/password-reset";

describe("reset tokens", () => {
  it("never returns the same token twice", async () => {
    // A predictable token is a way into every account, so this is the property
    // that matters most. 200 draws won't prove a CSPRNG, but it does catch the
    // classes of mistake that actually happen: a fixed seed, a reused buffer,
    // a timestamp-derived value.
    const tokens = new Set<string>();
    for (let i = 0; i < 200; i++) tokens.add((await createResetToken()).token);
    expect(tokens.size).toBe(200);
  });

  it("produces URL-safe tokens with no padding", async () => {
    // The token goes in a path segment. `+`, `/` and `=` would need escaping and
    // would survive an email client rewriting the link only by luck.
    for (let i = 0; i < 50; i++) {
      const { token } = await createResetToken();
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it("carries the full 256 bits", async () => {
    // 32 bytes in base64url is 43 characters. A short token here would mean the
    // random buffer wasn't the size intended.
    const { token } = await createResetToken();
    expect(token).toHaveLength(43);
  });

  it("returns a hash that matches hashing the token separately", async () => {
    // The pair has to agree or a freshly issued link is dead on arrival — the
    // stored hash would never match the one computed at redemption.
    const { token, tokenHash } = await createResetToken();
    expect(await hashResetToken(token)).toBe(tokenHash);
  });

  it("hashes to fixed-length hex that isn't the token itself", async () => {
    const { token, tokenHash } = await createResetToken();
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash).not.toContain(token);
  });

  it("hashes deterministically and differs for near-identical input", async () => {
    expect(await hashResetToken("abc")).toBe(await hashResetToken("abc"));
    expect(await hashResetToken("abc")).not.toBe(await hashResetToken("abd"));
  });
});

describe("isRedeemable", () => {
  const now = new Date("2026-08-10T12:00:00Z");
  const future = new Date(now.getTime() + 60_000);
  const past = new Date(now.getTime() - 60_000);

  it("accepts an unused, unexpired token", () => {
    expect(isRedeemable({ expiresAt: future, usedAt: null }, now)).toBe(true);
  });

  it("rejects a token that has already been used", () => {
    // Single-use is the point: a link that stays live in an inbox is a standing
    // key to the account.
    expect(isRedeemable({ expiresAt: future, usedAt: past }, now)).toBe(false);
  });

  it("rejects an expired token even though it was never used", () => {
    expect(isRedeemable({ expiresAt: past, usedAt: null }, now)).toBe(false);
  });

  it("rejects a token expiring exactly now", () => {
    // Boundary chosen deliberately: the window is closed at its edge rather than
    // open, so there's no instant where an expired token still works.
    expect(isRedeemable({ expiresAt: now, usedAt: null }, now)).toBe(false);
  });

  it("rejects a missing row, so a wrong token is the same as no token", () => {
    expect(isRedeemable(null, now)).toBe(false);
  });

  it("treats a token issued now as good for the whole TTL and not beyond", () => {
    const expiresAt = new Date(now.getTime() + RESET_TOKEN_TTL_MS);
    const justInside = new Date(expiresAt.getTime() - 1000);
    const justOutside = new Date(expiresAt.getTime() + 1000);
    expect(isRedeemable({ expiresAt, usedAt: null }, justInside)).toBe(true);
    expect(isRedeemable({ expiresAt, usedAt: null }, justOutside)).toBe(false);
  });
});
