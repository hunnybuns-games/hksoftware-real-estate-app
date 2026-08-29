import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * cancelPendingOnlinePaymentAction decides, from what Stripe says a Checkout
 * session's state is, whether a payment row may be written off. Getting the
 * `complete` case wrong loses a real payment, so the branches are pinned here
 * rather than left to a browser check — the same reasoning as
 * src/app/api/stripe/webhook/route.test.ts, and mocked the same way (only the
 * DB/Stripe/reconciliation edges, never the logic under test).
 */

const paymentFindFirst = vi.fn();
const paymentUpdate = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    payment: {
      findFirst: (...args: unknown[]) => paymentFindFirst(...args),
      update: (...args: unknown[]) => paymentUpdate(...args),
    },
  },
}));

vi.mock("@/lib/rbac", () => ({
  assertStaff: async () => ({ organizationId: "org_1", userId: "user_1" }),
}));

const sessionsRetrieve = vi.fn();
const sessionsExpire = vi.fn();
const stripeEnabled = vi.fn(() => true);

vi.mock("@/lib/stripe", () => ({
  stripeEnabled: () => stripeEnabled(),
  getStripe: () => ({
    checkout: {
      sessions: {
        retrieve: (...args: unknown[]) => sessionsRetrieve(...args),
        expire: (...args: unknown[]) => sessionsExpire(...args),
      },
    },
  }),
}));

const applyReconciliation = vi.fn();
vi.mock("@/lib/reconciliation", () => ({
  applyReconciliation: (...args: unknown[]) => applyReconciliation(...args),
  applyReconciliationForOrganization: vi.fn(),
}));

vi.mock("@/lib/notifications", () => ({ notifyRentReceived: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { cancelPendingOnlinePaymentAction } = await import("../payments");

/** Narrows a failed ActionState to its message, failing loudly if it succeeded. */
function errorOf(state: Awaited<ReturnType<typeof cancelPendingOnlinePaymentAction>>): string {
  if (!state || state.ok) throw new Error(`expected a failed ActionState, got ${JSON.stringify(state)}`);
  return state.error;
}

beforeAll(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.clearAllMocks();
  stripeEnabled.mockReturnValue(true);
});

/** A payment as the action's own `select` would return it. */
function pending(overrides: Record<string, unknown> = {}) {
  return {
    id: "pay_1",
    leaseId: "lease_1",
    status: "PENDING",
    stripeCheckoutSessionId: "cs_test_1",
    stripePaymentIntentId: null,
    ...overrides,
  };
}

describe("cancelPendingOnlinePaymentAction", () => {
  it("refuses when the Stripe session already completed", async () => {
    paymentFindFirst.mockResolvedValue(pending());
    sessionsRetrieve.mockResolvedValue({ status: "complete" });

    const state = await cancelPendingOnlinePaymentAction("pay_1", null);

    expect(state?.ok).toBe(false);
    expect(errorOf(state)).toMatch(/went through/i);
    // The one outcome that must never happen on a completed session.
    expect(paymentUpdate).not.toHaveBeenCalled();
    expect(sessionsExpire).not.toHaveBeenCalled();
  });

  it("expires an open session, then writes the payment off", async () => {
    paymentFindFirst.mockResolvedValue(pending());
    sessionsRetrieve.mockResolvedValue({ status: "open" });
    sessionsExpire.mockResolvedValue({});

    const state = await cancelPendingOnlinePaymentAction("pay_1", null);

    expect(state?.ok).toBe(true);
    expect(sessionsExpire).toHaveBeenCalledWith("cs_test_1");
    expect(paymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "pay_1" },
        data: expect.objectContaining({ status: "FAILED" }),
      }),
    );
    expect(applyReconciliation).toHaveBeenCalledWith("lease_1");
  });

  it("writes off an already-expired session without trying to expire it again", async () => {
    paymentFindFirst.mockResolvedValue(pending());
    sessionsRetrieve.mockResolvedValue({ status: "expired" });

    const state = await cancelPendingOnlinePaymentAction("pay_1", null);

    expect(state?.ok).toBe(true);
    expect(sessionsExpire).not.toHaveBeenCalled();
    expect(paymentUpdate).toHaveBeenCalled();
  });

  it("refuses rather than guessing when Stripe can't be reached", async () => {
    paymentFindFirst.mockResolvedValue(pending());
    sessionsRetrieve.mockRejectedValue(new Error("network down"));

    const state = await cancelPendingOnlinePaymentAction("pay_1", null);

    expect(state?.ok).toBe(false);
    expect(errorOf(state)).toMatch(/couldn't reach stripe/i);
    expect(paymentUpdate).not.toHaveBeenCalled();
  });

  it("still writes off the row when expire() loses the race", async () => {
    // expire() only fails on a session that stopped being open. If the tenant
    // completed it in that instant the webhook corrects this row, so failing
    // closed here would strand it instead.
    paymentFindFirst.mockResolvedValue(pending());
    sessionsRetrieve.mockResolvedValue({ status: "open" });
    sessionsExpire.mockRejectedValue(new Error("no longer open"));

    const state = await cancelPendingOnlinePaymentAction("pay_1", null);

    expect(state?.ok).toBe(true);
    expect(paymentUpdate).toHaveBeenCalled();
  });

  it("refuses a payment Stripe has already taken over", async () => {
    paymentFindFirst.mockResolvedValue(pending({ stripePaymentIntentId: "pi_1" }));

    const state = await cancelPendingOnlinePaymentAction("pay_1", null);

    expect(state?.ok).toBe(false);
    expect(errorOf(state)).toMatch(/already being processed/i);
    expect(sessionsRetrieve).not.toHaveBeenCalled();
    expect(paymentUpdate).not.toHaveBeenCalled();
  });

  it("refuses a payment that is no longer pending", async () => {
    paymentFindFirst.mockResolvedValue(pending({ status: "SUCCEEDED" }));

    const state = await cancelPendingOnlinePaymentAction("pay_1", null);

    expect(state?.ok).toBe(false);
    expect(errorOf(state)).toMatch(/still waiting/i);
    expect(paymentUpdate).not.toHaveBeenCalled();
  });

  it("scopes the lookup to the caller's organization", async () => {
    paymentFindFirst.mockResolvedValue(null);

    const state = await cancelPendingOnlinePaymentAction("pay_1", null);

    expect(state?.ok).toBe(false);
    expect(paymentFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "pay_1", organizationId: "org_1" } }),
    );
  });

  it("writes off a row with no Stripe session without calling Stripe", async () => {
    paymentFindFirst.mockResolvedValue(pending({ stripeCheckoutSessionId: null }));

    const state = await cancelPendingOnlinePaymentAction("pay_1", null);

    expect(state?.ok).toBe(true);
    expect(sessionsRetrieve).not.toHaveBeenCalled();
    expect(paymentUpdate).toHaveBeenCalled();
  });

  it("falls back to a local write-off when Stripe isn't configured at all", async () => {
    // Nothing can settle these rows in that state, so they are genuinely stuck.
    stripeEnabled.mockReturnValue(false);
    paymentFindFirst.mockResolvedValue(pending());

    const state = await cancelPendingOnlinePaymentAction("pay_1", null);

    expect(state?.ok).toBe(true);
    expect(sessionsRetrieve).not.toHaveBeenCalled();
    expect(paymentUpdate).toHaveBeenCalled();
  });
});
