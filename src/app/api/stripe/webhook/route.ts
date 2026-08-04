import { revalidatePath } from "next/cache";
import type Stripe from "stripe";
import { db } from "@/lib/db";
import { getStripe, stripeEnabled } from "@/lib/stripe";
import { notifyRentReceived } from "@/lib/notifications";
import { applyReconciliation } from "@/lib/reconciliation";

/**
 * Stripe is the source of truth for anything it processed. This handler is the
 * only writer of Stripe-backed Payment status — staff can't hand-edit those
 * (see updatePaymentStatusAction), which keeps us from desyncing.
 *
 * ACH matters here: a `checkout.session.completed` for a bank debit means
 * "submitted", not "paid". Money can still fail days later, so PROCESSING is a
 * real state that the UI shows distinctly rather than collapsing into "paid".
 */

// Stripe needs the raw, unparsed body to verify the signature.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  if (!stripeEnabled) {
    return Response.json({ error: "Stripe is not configured." }, { status: 503 });
  }

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[stripe] STRIPE_WEBHOOK_SECRET is not set; refusing unverified webhooks");
    return Response.json({ error: "Webhook secret not configured." }, { status: 500 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) return Response.json({ error: "Missing signature." }, { status: 400 });

  const payload = await req.text();

  let event: Stripe.Event;
  try {
    event = await getStripe().webhooks.constructEventAsync(payload, signature, secret);
  } catch (err) {
    // An unverifiable payload is either a misconfiguration or an attack. Never
    // process it.
    console.error("[stripe] signature verification failed", err);
    return Response.json({ error: "Invalid signature." }, { status: 400 });
  }

  try {
    await handleEvent(event);
  } catch (err) {
    // 500 tells Stripe to retry with backoff, which is what we want for a
    // transient DB failure. Handlers below are written to be idempotent.
    console.error(`[stripe] handler failed for ${event.type}`, err);
    return Response.json({ error: "Handler failed." }, { status: 500 });
  }

  return Response.json({ received: true });
}

async function handleEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      await onCheckoutCompleted(session);
      break;
    }
    case "checkout.session.expired": {
      const session = event.data.object as Stripe.Checkout.Session;
      await db.payment.updateMany({
        where: { stripeCheckoutSessionId: session.id, status: "PENDING" },
        data: { status: "FAILED", failedAt: new Date(), failureMessage: "Checkout expired" },
      });
      break;
    }
    case "payment_intent.processing": {
      const intent = event.data.object as Stripe.PaymentIntent;
      await setStatusByIntent(intent, "PROCESSING");
      break;
    }
    case "payment_intent.succeeded": {
      const intent = event.data.object as Stripe.PaymentIntent;
      await onIntentSucceeded(intent);
      break;
    }
    case "payment_intent.payment_failed": {
      const intent = event.data.object as Stripe.PaymentIntent;
      await onIntentFailed(intent);
      break;
    }
    case "charge.refunded": {
      const charge = event.data.object as Stripe.Charge;
      if (typeof charge.payment_intent === "string") {
        const refunded = await db.payment.findUnique({
          where: { stripePaymentIntentId: charge.payment_intent },
          select: { id: true, leaseId: true },
        });
        await db.payment.updateMany({
          where: { stripePaymentIntentId: charge.payment_intent },
          data: { status: "REFUNDED" },
        });
        // A refund pulls money back out of what covered a period — always
        // recompute rather than leave the old MATCHED/LATE call stale.
        if (refunded?.leaseId) await applyReconciliation(refunded.leaseId);
        revalidateAll(refunded?.leaseId);
      }
      break;
    }
    case "account.updated": {
      const account = event.data.object as Stripe.Account;
      await db.organization.updateMany({
        where: { stripeAccountId: account.id },
        data: {
          stripeChargesEnabled: account.charges_enabled ?? false,
          stripePayoutsEnabled: account.payouts_enabled ?? false,
        },
      });
      revalidatePath("/app/settings/payments");
      break;
    }
    default:
      // Everything else is noise for our purposes. Returning 200 stops Stripe
      // from retrying events we deliberately ignore.
      break;
  }
}

async function onCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const paymentId = session.metadata?.paymentId;
  const intentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id;

  const payment = await findPayment({ paymentId, sessionId: session.id, intentId });
  if (!payment) {
    console.warn(`[stripe] checkout ${session.id} has no matching payment row`);
    return;
  }

  // `paid` means the money is settled (cards). ACH lands here as `unpaid` /
  // `processing` and settles later via payment_intent.succeeded.
  const settled = session.payment_status === "paid";

  await db.payment.update({
    where: { id: payment.id },
    data: {
      stripePaymentIntentId: intentId ?? payment.stripePaymentIntentId,
      stripeCheckoutSessionId: session.id,
      status: settled ? "SUCCEEDED" : "PROCESSING",
      paidAt: settled ? new Date() : null,
      amountCents: session.amount_total ?? payment.amountCents,
    },
  });

  await sendReceipt(payment.id, !settled);
  if (payment.leaseId) await applyReconciliation(payment.leaseId);
  revalidateAll(payment.leaseId);
}

async function onIntentSucceeded(intent: Stripe.PaymentIntent): Promise<void> {
  const payment = await findPayment({
    paymentId: intent.metadata?.paymentId,
    intentId: intent.id,
  });
  if (!payment) return;

  // Idempotency: Stripe redelivers, and we don't want a second receipt email.
  if (payment.status === "SUCCEEDED") return;

  await db.payment.update({
    where: { id: payment.id },
    data: {
      status: "SUCCEEDED",
      stripePaymentIntentId: intent.id,
      paidAt: new Date(),
      amountCents: intent.amount_received || intent.amount || payment.amountCents,
      failureMessage: null,
      failedAt: null,
    },
  });

  await sendReceipt(payment.id, false);
  if (payment.leaseId) await applyReconciliation(payment.leaseId);
  revalidateAll(payment.leaseId);
}

async function onIntentFailed(intent: Stripe.PaymentIntent): Promise<void> {
  const payment = await findPayment({
    paymentId: intent.metadata?.paymentId,
    intentId: intent.id,
  });
  if (!payment) return;

  await db.payment.update({
    where: { id: payment.id },
    data: {
      status: "FAILED",
      stripePaymentIntentId: intent.id,
      failedAt: new Date(),
      failureMessage:
        intent.last_payment_error?.message?.slice(0, 500) ??
        "The bank declined the transfer.",
    },
  });
  // The failed attempt was PROCESSING (crediting) money that just stopped
  // counting — periods it looked like it covered may now be short.
  if (payment.leaseId) await applyReconciliation(payment.leaseId);
  revalidateAll(payment.leaseId);
}

async function setStatusByIntent(
  intent: Stripe.PaymentIntent,
  status: "PROCESSING",
): Promise<void> {
  const payment = await findPayment({
    paymentId: intent.metadata?.paymentId,
    intentId: intent.id,
  });
  if (!payment || payment.status === "SUCCEEDED") return;

  await db.payment.update({
    where: { id: payment.id },
    data: { status, stripePaymentIntentId: intent.id },
  });
  if (payment.leaseId) await applyReconciliation(payment.leaseId);
  revalidateAll(payment.leaseId);
}

/**
 * Resolves our Payment row from whichever identifier the event carries. We
 * prefer our own metadata id, then the Stripe ids, so a dropped metadata field
 * doesn't strand a payment.
 */
async function findPayment(keys: {
  paymentId?: string | null;
  sessionId?: string | null;
  intentId?: string | null;
}) {
  const select = {
    id: true,
    leaseId: true,
    status: true,
    amountCents: true,
    stripePaymentIntentId: true,
  } as const;

  if (keys.paymentId) {
    const byId = await db.payment.findUnique({ where: { id: keys.paymentId }, select });
    if (byId) return byId;
  }
  if (keys.intentId) {
    const byIntent = await db.payment.findUnique({
      where: { stripePaymentIntentId: keys.intentId },
      select,
    });
    if (byIntent) return byIntent;
  }
  if (keys.sessionId) {
    const bySession = await db.payment.findUnique({
      where: { stripeCheckoutSessionId: keys.sessionId },
      select,
    });
    if (bySession) return bySession;
  }
  return null;
}

async function sendReceipt(paymentId: string, processing: boolean): Promise<void> {
  const payment = await db.payment.findUnique({
    where: { id: paymentId },
    select: {
      amountCents: true,
      lease: {
        select: {
          organizationId: true,
          tenant: { select: { firstName: true, email: true } },
          organization: { select: { name: true } },
        },
      },
    },
  });
  // A Stripe-collected payment is always initiated from a specific tenant's
  // lease (see startRentPaymentAction) — it should never be leaseless. If it
  // somehow is, there's no tenant to email; log and move on rather than crash
  // the webhook handler over a receipt.
  if (!payment?.lease) {
    console.warn(`[stripe] payment ${paymentId} has no lease; skipping receipt`);
    return;
  }

  await notifyRentReceived({
    to: {
      email: payment.lease.tenant.email,
      name: payment.lease.tenant.firstName,
    },
    organizationId: payment.lease.organizationId,
    orgName: payment.lease.organization.name,
    amountCents: payment.amountCents,
    processing,
  });
}

function revalidateAll(leaseId?: string | null) {
  revalidatePath("/app");
  revalidatePath("/app/payments");
  revalidatePath("/portal");
  revalidatePath("/owner");
  if (leaseId) revalidatePath(`/app/leases/${leaseId}`);
}
