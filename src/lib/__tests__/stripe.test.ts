import { afterEach, describe, expect, it } from "vitest";
import { checkoutApplicationFeeCents } from "@/lib/stripe";

/**
 * checkoutApplicationFeeCents is the whole fix for the bug docs/ROADMAP.md
 * calls out: a Checkout session can't set its application fee conditionally
 * on which payment method the tenant ends up picking, so a session that
 * offers cards must never carry a fee meant only for ACH — see the function's
 * own doc comment in src/lib/stripe.ts for why.
 */
describe("checkoutApplicationFeeCents", () => {
  afterEach(() => {
    delete process.env.STRIPE_APPLICATION_FEE_BPS;
  });

  it("is undefined whenever cards are allowed, regardless of the configured rate", () => {
    process.env.STRIPE_APPLICATION_FEE_BPS = "150";
    expect(checkoutApplicationFeeCents(100_000, true)).toBeUndefined();
  });

  it("charges the configured bps on an ACH-only session", () => {
    process.env.STRIPE_APPLICATION_FEE_BPS = "150"; // 1.5%
    expect(checkoutApplicationFeeCents(100_000, false)).toBe(1_500);
  });

  it("is undefined on an ACH-only session when no rate is configured", () => {
    expect(checkoutApplicationFeeCents(100_000, false)).toBeUndefined();
  });

  it("is undefined when the configured rate is zero", () => {
    process.env.STRIPE_APPLICATION_FEE_BPS = "0";
    expect(checkoutApplicationFeeCents(100_000, false)).toBeUndefined();
  });

  it("is undefined when the configured rate is negative or garbage", () => {
    process.env.STRIPE_APPLICATION_FEE_BPS = "-5";
    expect(checkoutApplicationFeeCents(100_000, false)).toBeUndefined();
    process.env.STRIPE_APPLICATION_FEE_BPS = "not-a-number";
    expect(checkoutApplicationFeeCents(100_000, false)).toBeUndefined();
  });

  it("rounds to the nearest cent rather than truncating", () => {
    process.env.STRIPE_APPLICATION_FEE_BPS = "33"; // 0.33%
    // 33 bps of $10.01 is 3.3033 cents, which should round to 3, not floor to 2.
    expect(checkoutApplicationFeeCents(1_001, false)).toBe(3);
  });

  it("is undefined when a nonzero rate rounds down to less than a cent", () => {
    process.env.STRIPE_APPLICATION_FEE_BPS = "1"; // 0.01%
    expect(checkoutApplicationFeeCents(10, false)).toBeUndefined();
  });
});
