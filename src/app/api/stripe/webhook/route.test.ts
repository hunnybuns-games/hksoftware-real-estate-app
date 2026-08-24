import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import Stripe from "stripe";

/**
 * Exercises the actual signature-verification path (real HMAC via Stripe's
 * SDK, same as production — only the DB/reconciliation/email/cache layers
 * are mocked) plus every event type the handler switches on, mirroring how
 * plaid-webhook.test.ts round-trips real crypto instead of mocking it away.
 */

const STRIPE_SECRET_KEY = "sk_test_123";
const STRIPE_WEBHOOK_SECRET = "whsec_test_secret";

process.env.STRIPE_SECRET_KEY = STRIPE_SECRET_KEY;
process.env.STRIPE_WEBHOOK_SECRET = STRIPE_WEBHOOK_SECRET;

const paymentFindUnique = vi.fn();
const paymentUpdate = vi.fn();
const paymentUpdateMany = vi.fn();
const organizationUpdateMany = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    payment: {
      findUnique: (...args: unknown[]) => paymentFindUnique(...args),
      update: (...args: unknown[]) => paymentUpdate(...args),
      updateMany: (...args: unknown[]) => paymentUpdateMany(...args),
    },
    organization: {
      updateMany: (...args: unknown[]) => organizationUpdateMany(...args),
    },
  },
}));

const applyReconciliation = vi.fn();
vi.mock("@/lib/reconciliation", () => ({
  applyReconciliation: (...args: unknown[]) => applyReconciliation(...args),
}));

const notifyRentReceived = vi.fn();
vi.mock("@/lib/notifications", () => ({
  notifyRentReceived: (...args: unknown[]) => notifyRentReceived(...args),
}));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...args),
}));

// Imported after the mocks above so the route picks up the mocked modules.
const { POST } = await import("./route");

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

beforeAll(() => {
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_SECRET_KEY = STRIPE_SECRET_KEY;
  process.env.STRIPE_WEBHOOK_SECRET = STRIPE_WEBHOOK_SECRET;
});

function eventPayload(type: string, object: Record<string, unknown>): string {
  return JSON.stringify({
    id: "evt_test",
    object: "event",
    api_version: "2026-07-29.dahlia",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
    type,
    data: { object },
  });
}

async function signedRequest(
  payload: string,
  opts: { secret?: string; noSignature?: boolean } = {},
): Promise<Request> {
  const headers = new Headers({ "content-type": "application/json" });
  if (!opts.noSignature) {
    const header = await Stripe.webhooks.generateTestHeaderStringAsync({
      payload,
      secret: opts.secret ?? STRIPE_WEBHOOK_SECRET,
    });
    headers.set("stripe-signature", header);
  }
  return new Request("http://localhost/api/stripe/webhook", {
    method: "POST",
    headers,
    body: payload,
  });
}

const paymentRow = (overrides: Record<string, unknown> = {}) => ({
  id: "pay_1",
  leaseId: "lease_1",
  status: "PENDING",
  amountCents: 180_000,
  stripePaymentIntentId: null,
  ...overrides,
});

describe("POST /api/stripe/webhook — transport / auth", () => {
  it("503s when Stripe isn't configured", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const res = await POST(await signedRequest(eventPayload("account.updated", { id: "acct_1" })));
    expect(res.status).toBe(503);
  });

  it("500s when STRIPE_WEBHOOK_SECRET is missing", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const res = await POST(await signedRequest(eventPayload("account.updated", { id: "acct_1" })));
    expect(res.status).toBe(500);
  });

  it("400s on a missing stripe-signature header", async () => {
    const res = await POST(
      await signedRequest(eventPayload("account.updated", { id: "acct_1" }), { noSignature: true }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Missing signature." });
  });

  it("400s on a signature that doesn't verify (wrong secret)", async () => {
    const res = await POST(
      await signedRequest(eventPayload("account.updated", { id: "acct_1" }), { secret: "whsec_wrong" }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid signature." });
  });

  it("400s on a tampered payload (signature no longer matches body)", async () => {
    const payload = eventPayload("account.updated", { id: "acct_1" });
    const header = await Stripe.webhooks.generateTestHeaderStringAsync({
      payload,
      secret: STRIPE_WEBHOOK_SECRET,
    });
    const tampered = eventPayload("account.updated", { id: "acct_EVIL" });
    const req = new Request("http://localhost/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": header },
      body: tampered,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("ignores an event type it doesn't handle and returns 200", async () => {
    const res = await POST(await signedRequest(eventPayload("invoice.paid", { id: "in_1" })));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    expect(paymentUpdate).not.toHaveBeenCalled();
    expect(paymentUpdateMany).not.toHaveBeenCalled();
  });

  it("500s and lets Stripe retry when a handler throws", async () => {
    paymentFindUnique.mockRejectedValueOnce(new Error("db unavailable"));
    const res = await POST(
      await signedRequest(
        eventPayload("payment_intent.succeeded", { id: "pi_1", metadata: { paymentId: "pay_1" } }),
      ),
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Handler failed." });
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("payment_intent.succeeded"),
      expect.any(Error),
    );
  });
});

describe("checkout.session.completed", () => {
  it("marks a card payment SUCCEEDED (payment_status=paid) and sends a non-processing receipt", async () => {
    paymentFindUnique.mockResolvedValueOnce(paymentRow());
    paymentFindUnique.mockResolvedValueOnce({
      amountCents: 180_000,
      lease: {
        organizationId: "org_1",
        tenant: { firstName: "Sam", email: "sam@example.com" },
        organization: { name: "Acme Rentals" },
      },
    });

    const res = await POST(
      await signedRequest(
        eventPayload("checkout.session.completed", {
          id: "cs_1",
          payment_intent: "pi_1",
          payment_status: "paid",
          amount_total: 180_000,
          metadata: { paymentId: "pay_1" },
        }),
      ),
    );

    expect(res.status).toBe(200);
    expect(paymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "pay_1" },
        data: expect.objectContaining({ status: "SUCCEEDED", paidAt: expect.any(Date) }),
      }),
    );
    expect(notifyRentReceived).toHaveBeenCalledWith(expect.objectContaining({ processing: false }));
    expect(applyReconciliation).toHaveBeenCalledWith("lease_1");
    expect(revalidatePath).toHaveBeenCalledWith("/app/leases/lease_1");
  });

  it("marks an ACH checkout PROCESSING (payment_status=unpaid) and sends a processing receipt", async () => {
    paymentFindUnique.mockResolvedValueOnce(paymentRow());
    paymentFindUnique.mockResolvedValueOnce({
      amountCents: 180_000,
      lease: {
        organizationId: "org_1",
        tenant: { firstName: "Sam", email: "sam@example.com" },
        organization: { name: "Acme Rentals" },
      },
    });

    await POST(
      await signedRequest(
        eventPayload("checkout.session.completed", {
          id: "cs_2",
          payment_intent: "pi_2",
          payment_status: "unpaid",
          amount_total: 180_000,
          metadata: { paymentId: "pay_1" },
        }),
      ),
    );

    expect(paymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "PROCESSING", paidAt: null }) }),
    );
    expect(notifyRentReceived).toHaveBeenCalledWith(expect.objectContaining({ processing: true }));
  });

  it("no-ops (no write, no crash) when no Payment row matches", async () => {
    paymentFindUnique.mockResolvedValue(null);

    const res = await POST(
      await signedRequest(
        eventPayload("checkout.session.completed", {
          id: "cs_orphan",
          payment_intent: "pi_orphan",
          payment_status: "paid",
          metadata: {},
        }),
      ),
    );

    expect(res.status).toBe(200);
    expect(paymentUpdate).not.toHaveBeenCalled();
    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining("cs_orphan"));
  });

  it("resolves the payment_intent id whether it's a string or an expanded object", async () => {
    paymentFindUnique.mockResolvedValueOnce(paymentRow());
    paymentFindUnique.mockResolvedValueOnce({
      amountCents: 180_000,
      lease: {
        organizationId: "org_1",
        tenant: { firstName: "Sam", email: "sam@example.com" },
        organization: { name: "Acme Rentals" },
      },
    });

    await POST(
      await signedRequest(
        eventPayload("checkout.session.completed", {
          id: "cs_3",
          payment_intent: { id: "pi_expanded", object: "payment_intent" },
          payment_status: "paid",
          metadata: { paymentId: "pay_1" },
        }),
      ),
    );

    expect(paymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ stripePaymentIntentId: "pi_expanded" }) }),
    );
  });
});

describe("checkout.session.expired", () => {
  it("fails only PENDING payments tied to that session", async () => {
    await POST(
      await signedRequest(eventPayload("checkout.session.expired", { id: "cs_expired" })),
    );

    expect(paymentUpdateMany).toHaveBeenCalledWith({
      where: { stripeCheckoutSessionId: "cs_expired", status: "PENDING" },
      data: { status: "FAILED", failedAt: expect.any(Date), failureMessage: "Checkout expired" },
    });
    // Expiry doesn't touch reconciliation — nothing was ever credited.
    expect(applyReconciliation).not.toHaveBeenCalled();
  });
});

describe("payment_intent.processing", () => {
  it("sets PROCESSING", async () => {
    paymentFindUnique.mockResolvedValueOnce(paymentRow());

    await POST(
      await signedRequest(
        eventPayload("payment_intent.processing", { id: "pi_5", metadata: { paymentId: "pay_1" } }),
      ),
    );

    expect(paymentUpdate).toHaveBeenCalledWith({
      where: { id: "pay_1" },
      data: { status: "PROCESSING", stripePaymentIntentId: "pi_5" },
    });
    expect(applyReconciliation).toHaveBeenCalledWith("lease_1");
  });

  it("is a no-op once the payment already SUCCEEDED (idempotency)", async () => {
    paymentFindUnique.mockResolvedValueOnce(paymentRow({ status: "SUCCEEDED" }));

    await POST(
      await signedRequest(
        eventPayload("payment_intent.processing", { id: "pi_5", metadata: { paymentId: "pay_1" } }),
      ),
    );

    expect(paymentUpdate).not.toHaveBeenCalled();
    expect(applyReconciliation).not.toHaveBeenCalled();
  });
});

describe("payment_intent.succeeded", () => {
  it("marks SUCCEEDED, sends a receipt, and reconciles", async () => {
    paymentFindUnique.mockResolvedValueOnce(paymentRow());
    paymentFindUnique.mockResolvedValueOnce({
      amountCents: 180_000,
      lease: {
        organizationId: "org_1",
        tenant: { firstName: "Sam", email: "sam@example.com" },
        organization: { name: "Acme Rentals" },
      },
    });

    await POST(
      await signedRequest(
        eventPayload("payment_intent.succeeded", {
          id: "pi_6",
          amount_received: 180_000,
          metadata: { paymentId: "pay_1" },
        }),
      ),
    );

    expect(paymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "SUCCEEDED",
          failureMessage: null,
          failedAt: null,
        }),
      }),
    );
    expect(notifyRentReceived).toHaveBeenCalledOnce();
    expect(applyReconciliation).toHaveBeenCalledWith("lease_1");
  });

  it("skips the write and the receipt on a redelivery of an already-SUCCEEDED payment", async () => {
    paymentFindUnique.mockResolvedValueOnce(paymentRow({ status: "SUCCEEDED" }));

    await POST(
      await signedRequest(
        eventPayload("payment_intent.succeeded", { id: "pi_6", metadata: { paymentId: "pay_1" } }),
      ),
    );

    expect(paymentUpdate).not.toHaveBeenCalled();
    expect(notifyRentReceived).not.toHaveBeenCalled();
  });

  it("falls back through amount_received -> amount -> existing amountCents", async () => {
    paymentFindUnique.mockResolvedValueOnce(paymentRow({ amountCents: 999 }));
    paymentFindUnique.mockResolvedValueOnce({
      amountCents: 999,
      lease: {
        organizationId: "org_1",
        tenant: { firstName: "Sam", email: "sam@example.com" },
        organization: { name: "Acme Rentals" },
      },
    });

    await POST(
      await signedRequest(
        eventPayload("payment_intent.succeeded", {
          id: "pi_7",
          amount_received: 0,
          amount: 180_000,
          metadata: { paymentId: "pay_1" },
        }),
      ),
    );

    expect(paymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ amountCents: 180_000 }) }),
    );
  });

  it("does not throw when the payment has no lease — logs and skips the receipt", async () => {
    paymentFindUnique.mockResolvedValueOnce(paymentRow());
    paymentFindUnique.mockResolvedValueOnce({ amountCents: 180_000, lease: null });

    const res = await POST(
      await signedRequest(
        eventPayload("payment_intent.succeeded", { id: "pi_8", metadata: { paymentId: "pay_1" } }),
      ),
    );

    expect(res.status).toBe(200);
    expect(notifyRentReceived).not.toHaveBeenCalled();
    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining("pay_1"));
  });
});

describe("payment_intent.payment_failed", () => {
  it("marks FAILED with the decline reason and re-reconciles", async () => {
    paymentFindUnique.mockResolvedValueOnce(paymentRow());

    await POST(
      await signedRequest(
        eventPayload("payment_intent.payment_failed", {
          id: "pi_9",
          metadata: { paymentId: "pay_1" },
          last_payment_error: { message: "Your bank account has insufficient funds." },
        }),
      ),
    );

    expect(paymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "FAILED",
          failureMessage: "Your bank account has insufficient funds.",
        }),
      }),
    );
    expect(applyReconciliation).toHaveBeenCalledWith("lease_1");
  });

  it("falls back to a generic message when Stripe gives no decline reason", async () => {
    paymentFindUnique.mockResolvedValueOnce(paymentRow());

    await POST(
      await signedRequest(
        eventPayload("payment_intent.payment_failed", { id: "pi_10", metadata: { paymentId: "pay_1" } }),
      ),
    );

    expect(paymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ failureMessage: "The bank declined the transfer." }),
      }),
    );
  });

  it("truncates an overlong decline message to 500 chars", async () => {
    paymentFindUnique.mockResolvedValueOnce(paymentRow());
    const longMessage = "x".repeat(600);

    await POST(
      await signedRequest(
        eventPayload("payment_intent.payment_failed", {
          id: "pi_11",
          metadata: { paymentId: "pay_1" },
          last_payment_error: { message: longMessage },
        }),
      ),
    );

    const call = paymentUpdate.mock.calls[0][0];
    expect(call.data.failureMessage).toHaveLength(500);
  });
});

describe("charge.refunded", () => {
  it("marks REFUNDED and re-runs reconciliation for the affected lease", async () => {
    paymentFindUnique.mockResolvedValueOnce({ id: "pay_1", leaseId: "lease_1" });

    await POST(
      await signedRequest(
        eventPayload("charge.refunded", { id: "ch_1", payment_intent: "pi_12" }),
      ),
    );

    expect(paymentUpdateMany).toHaveBeenCalledWith({
      where: { stripePaymentIntentId: "pi_12" },
      data: { status: "REFUNDED" },
    });
    expect(applyReconciliation).toHaveBeenCalledWith("lease_1");
  });

  it("still updates status but skips reconciliation when no local payment is found", async () => {
    paymentFindUnique.mockResolvedValueOnce(null);

    await POST(
      await signedRequest(
        eventPayload("charge.refunded", { id: "ch_2", payment_intent: "pi_orphan" }),
      ),
    );

    expect(paymentUpdateMany).toHaveBeenCalled();
    expect(applyReconciliation).not.toHaveBeenCalled();
  });

  it("ignores a refund with no payment_intent id (fully expanded object, not a string)", async () => {
    await POST(
      await signedRequest(
        eventPayload("charge.refunded", { id: "ch_3", payment_intent: { id: "pi_expanded" } }),
      ),
    );

    expect(paymentUpdateMany).not.toHaveBeenCalled();
  });
});

describe("account.updated", () => {
  it("syncs charges_enabled / payouts_enabled onto the org and revalidates settings", async () => {
    const res = await POST(
      await signedRequest(
        eventPayload("account.updated", { id: "acct_1", charges_enabled: true, payouts_enabled: false }),
      ),
    );

    expect(res.status).toBe(200);
    expect(organizationUpdateMany).toHaveBeenCalledWith({
      where: { stripeAccountId: "acct_1" },
      data: { stripeChargesEnabled: true, stripePayoutsEnabled: false },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/app/settings/payments");
  });

  it("defaults missing enabled flags to false rather than undefined", async () => {
    await POST(await signedRequest(eventPayload("account.updated", { id: "acct_2" })));

    expect(organizationUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { stripeChargesEnabled: false, stripePayoutsEnabled: false },
      }),
    );
  });
});
