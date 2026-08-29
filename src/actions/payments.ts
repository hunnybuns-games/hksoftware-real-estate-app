"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertStaff } from "@/lib/rbac";
import {
  type ActionState,
  actionError,
  actionOk,
  centsField,
  dateField,
  optionalText,
  parseForm,
  runAction,
} from "@/lib/forms";
import { generateRentCharges } from "@/lib/ledger";
import { applyReconciliation, applyReconciliationForOrganization } from "@/lib/reconciliation";
import { notifyRentReceived } from "@/lib/notifications";
import { getStripe, stripeEnabled } from "@/lib/stripe";
import { formatCents } from "@/lib/money";

// STRIPE_NATIVE is deliberately excluded — that source is only ever set by
// the Stripe integration itself (checkout + webhook), never a manual choice.
const NON_STRIPE_SOURCES = [
  "MANUAL_CASH",
  "IMPORT_BANK",
  "IMPORT_VENMO",
  "IMPORT_CASHAPP",
  "IMPORT_HAP",
] as const;

const manualPaymentSchema = z.object({
  amountCents: centsField("Amount"),
  source: z.enum(NON_STRIPE_SOURCES),
  paidAt: dateField("Date received"),
  memo: optionalText(200),
});

/**
 * Records money that arrived outside Stripe — cash, a check, a Venmo/Cash App
 * transfer, or a HAP/subsidy payment. This is the fast path for a single
 * payment; a whole statement's worth goes through CSV import instead (see
 * src/actions/import.ts), but both land in the exact same ledger tagged with
 * the same PaymentSource, so nothing downstream has to know which door a
 * payment came in through.
 */
export async function recordManualPaymentAction(
  leaseId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { organizationId } = await assertStaff();
    const parsed = parseForm(manualPaymentSchema, formData);
    if (!parsed.ok) return parsed.state;
    if (parsed.data.amountCents <= 0) {
      return actionError("Please fix the highlighted fields.", {
        amountCents: "Enter an amount greater than zero.",
      });
    }

    const lease = await db.lease.findFirst({
      where: { id: leaseId, organizationId },
      select: { id: true },
    });
    if (!lease) return actionError("That lease no longer exists.");

    await db.payment.create({
      data: {
        organizationId,
        leaseId: lease.id,
        amountCents: parsed.data.amountCents,
        source: parsed.data.source,
        // A manually-entered payment is always tied to a real lease by the
        // person recording it, so it's never UNMATCHED. applyReconciliation
        // below recomputes the real chargeId + SHORT/LATE/MATCHED call from
        // scratch against every payment and charge on this lease.
        status: "SUCCEEDED",
        paidAt: parsed.data.paidAt,
        memo: parsed.data.memo ?? sourceMemoDefault(parsed.data.source),
      },
    });

    await applyReconciliation(lease.id);

    revalidatePaymentViews(lease.id);
    return actionOk(`Recorded ${formatCents(parsed.data.amountCents)}.`);
  });
}

function sourceMemoDefault(source: (typeof NON_STRIPE_SOURCES)[number]): string {
  switch (source) {
    case "MANUAL_CASH":
      return "Recorded by staff";
    case "IMPORT_BANK":
      return "Bank transfer";
    case "IMPORT_VENMO":
      return "Venmo";
    case "IMPORT_CASHAPP":
      return "Cash App";
    case "IMPORT_HAP":
      return "Housing authority payment";
  }
}

const chargeSchema = z.object({
  type: z.enum(["RENT", "LATE_FEE", "DEPOSIT", "OTHER"]),
  amountCents: centsField("Amount"),
  dueDate: dateField("Due date"),
  description: z.string().trim().min(1, "Say what this charge is for.").max(200),
});

export async function addChargeAction(
  leaseId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { organizationId } = await assertStaff();
    const parsed = parseForm(chargeSchema, formData);
    if (!parsed.ok) return parsed.state;

    const lease = await db.lease.findFirst({
      where: { id: leaseId, organizationId },
      select: { id: true },
    });
    if (!lease) return actionError("That lease no longer exists.");

    await db.charge.create({
      data: {
        leaseId: lease.id,
        type: parsed.data.type,
        amountCents: parsed.data.amountCents,
        dueDate: parsed.data.dueDate,
        description: parsed.data.description,
        // periodStart stays null for ad-hoc charges; only generated rent uses it
        // as an idempotency key, and null values never collide under a unique
        // constraint (standard SQL semantics, true of SQLite same as Postgres).
        periodStart: null,
      },
    });

    await applyReconciliation(lease.id);

    revalidatePaymentViews(lease.id);
    return actionOk("Charge added.");
  });
}

/**
 * Charges are voided, never deleted — a landlord may need to explain a
 * disappearing balance months later.
 */
export async function voidChargeAction(chargeId: string, _prev: ActionState): Promise<ActionState> {
  return runAction(async () => {
    const { organizationId } = await assertStaff();

    const charge = await db.charge.findFirst({
      where: { id: chargeId, lease: { organizationId } },
      select: { id: true, leaseId: true, voidedAt: true },
    });
    if (!charge) return actionError("That charge no longer exists.");
    if (charge.voidedAt) return actionOk("That charge was already voided.");

    await db.charge.update({ where: { id: charge.id }, data: { voidedAt: new Date() } });

    // A voided charge can free up money that was covering it to apply
    // elsewhere — always fully recompute from scratch, never patch in place.
    await applyReconciliation(charge.leaseId);

    revalidatePaymentViews(charge.leaseId);
    return actionOk("Charge voided.");
  });
}

/**
 * Manual trigger for the rent run. The cron endpoint does the same thing on a
 * schedule; this button exists so a landlord who just added a lease doesn't
 * have to wait until tomorrow to see it on the books.
 */
export async function runRentAction(_prev: ActionState): Promise<ActionState> {
  return runAction(async () => {
    const { organizationId } = await assertStaff();
    const { created, leasesProcessed } = await generateRentCharges({ organizationId });

    // A tenant who paid ahead may have a credit sitting with no charge to
    // apply to (chargeId null) — once this month's charge exists, that
    // credit should attach to it instead of hanging as an unapplied balance.
    if (created > 0) await applyReconciliationForOrganization(organizationId);

    revalidatePaymentViews();
    if (created === 0) {
      return actionOk(
        `All caught up — ${leasesProcessed} active lease${leasesProcessed === 1 ? "" : "s"} already billed through this month.`,
      );
    }
    return actionOk(`Added ${created} rent charge${created === 1 ? "" : "s"}.`);
  });
}

const statusSchema = z.object({
  status: z.enum(["PENDING", "PROCESSING", "SUCCEEDED", "FAILED", "REFUNDED"]),
});

/**
 * Manual status correction for payments we recorded ourselves. Stripe-backed
 * payments are owned by the webhook — letting staff hand-edit those would
 * desync us from the source of truth.
 */
export async function updatePaymentStatusAction(
  paymentId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { organizationId } = await assertStaff();
    const parsed = parseForm(statusSchema, formData);
    if (!parsed.ok) return parsed.state;

    const payment = await db.payment.findFirst({
      where: { id: paymentId, lease: { organizationId } },
      select: {
        id: true,
        leaseId: true,
        status: true,
        amountCents: true,
        stripePaymentIntentId: true,
        lease: {
          select: {
            tenant: { select: { firstName: true, email: true } },
            organization: { select: { name: true } },
          },
        },
      },
    });
    // The `lease: { organizationId }` filter above already excludes
    // leaseless (UNMATCHED) payments, but Prisma's types don't narrow on
    // filter values — assert what the query guarantees.
    if (!payment?.lease) return actionError("That payment no longer exists.");

    if (payment.stripePaymentIntentId) {
      return actionError(
        "This payment is managed by Stripe, so its status updates automatically. Refund it in Stripe if you need to reverse it.",
      );
    }

    const next = parsed.data.status;
    await db.payment.update({
      where: { id: payment.id },
      data: {
        status: next,
        paidAt: next === "SUCCEEDED" ? new Date() : null,
        failedAt: next === "FAILED" ? new Date() : null,
      },
    });

    if (next === "SUCCEEDED" && payment.status !== "SUCCEEDED") {
      await notifyRentReceived({
        to: {
          email: payment.lease.tenant.email,
          name: payment.lease.tenant.firstName,
        },
        organizationId,
        orgName: payment.lease.organization.name,
        amountCents: payment.amountCents,
        processing: false,
      });
    }

    if (payment.leaseId) await applyReconciliation(payment.leaseId);

    revalidatePaymentViews(payment.leaseId);
    return actionOk("Payment updated.");
  });
}

/**
 * Cancels a payment a tenant started online but never finished.
 *
 * startRentPaymentAction writes a PENDING row *before* redirecting to Stripe,
 * so an abandoned Checkout leaves a visible trace rather than a mystery (see
 * the comment there). The cost is that closing the Stripe tab strands that row
 * at PENDING: Stripe does eventually fire checkout.session.expired, but not for
 * ~24 hours, and until then a landlord looking at the ledger sees "Awaiting
 * payment" rows they can't do anything about. Three abandoned attempts in a row
 * — easy to do on a slow bank login — look alarmingly like three unpaid bills.
 *
 * The delicate part is not the local row, it's the Stripe session behind it. A
 * tenant can still have that Checkout tab open; marking the row dead here while
 * leaving the session payable would mean money arriving against a payment
 * staff believe they killed. So Stripe is asked what the session's actual state
 * is, and that answer decides:
 *
 *   open     -> expire it at Stripe, then mark the row failed. The stale tab
 *               stops working, which is the point.
 *   expired  -> already dead; just mark the row failed.
 *   complete -> refuse outright. The tenant did pay and the webhook simply
 *               hasn't landed yet; cancelling would be a lie the webhook is
 *               about to contradict.
 *
 * Reading `session.status` rather than pattern-matching the error text from a
 * failed expire() call is deliberate: those three values are documented API
 * surface, error strings are not, and getting this wrong in the `complete`
 * direction loses a real payment.
 */
export async function cancelPendingOnlinePaymentAction(
  paymentId: string,
  _prev: ActionState,
): Promise<ActionState> {
  return runAction(async () => {
    const { organizationId } = await assertStaff();

    const payment = await db.payment.findFirst({
      where: { id: paymentId, organizationId },
      select: {
        id: true,
        leaseId: true,
        status: true,
        stripeCheckoutSessionId: true,
        stripePaymentIntentId: true,
      },
    });
    if (!payment) return actionError("That payment no longer exists.");

    if (payment.status !== "PENDING") {
      return actionError(
        "Only a payment that's still waiting to be paid can be canceled. Refresh to see where this one ended up.",
      );
    }
    // A PaymentIntent id means Stripe has already taken the payment over, so
    // the webhook owns this row's status from here — same rule as
    // updatePaymentStatusAction above.
    if (payment.stripePaymentIntentId) {
      return actionError(
        "This payment is already being processed by Stripe. Refresh in a moment to see whether it settled.",
      );
    }

    if (payment.stripeCheckoutSessionId && stripeEnabled()) {
      let sessionStatus: string | null;
      try {
        const session = await getStripe().checkout.sessions.retrieve(
          payment.stripeCheckoutSessionId,
        );
        sessionStatus = session.status;
      } catch (err) {
        // Couldn't establish what Stripe thinks. Refusing is the conservative
        // half of the choice above: a retry costs a click, cancelling a
        // payment that turns out to have gone through costs real money.
        console.error("[stripe] could not retrieve session before cancel", err);
        return actionError(
          "We couldn't reach Stripe to confirm this payment's status. Please try again in a moment.",
        );
      }

      if (sessionStatus === "complete") {
        return actionError(
          "This payment went through on Stripe's side and is still settling. Refresh in a moment rather than canceling it.",
        );
      }

      if (sessionStatus === "open") {
        try {
          await getStripe().checkout.sessions.expire(payment.stripeCheckoutSessionId);
        } catch (err) {
          // Losing this race is survivable: expire() only fails on a session
          // that stopped being open, which either means it expired on its own
          // (fine, the row is about to be marked failed anyway) or that the
          // tenant completed it in the last instant — and that case the
          // webhook will correct, since it is the one writer that outranks
          // this action.
          console.error("[stripe] could not expire checkout session", err);
        }
      }
    }

    await db.payment.update({
      where: { id: payment.id },
      data: {
        status: "FAILED",
        failedAt: new Date(),
        failureMessage: "Canceled — this payment was never completed.",
      },
    });

    // A PENDING payment never counted toward the balance (see CREDITING in
    // src/lib/reconciliation.ts), so nothing about the money actually moves
    // here. Reconciliation still runs so the payment's own row picks up a
    // consistent status rather than keeping a stale one.
    if (payment.leaseId) await applyReconciliation(payment.leaseId);

    revalidatePaymentViews(payment.leaseId);
    revalidatePath("/portal");
    return actionOk("Payment canceled.");
  });
}

function revalidatePaymentViews(leaseId?: string | null) {
  revalidatePath("/app");
  revalidatePath("/app/payments");
  revalidatePath("/app/leases");
  revalidatePath("/owner");
  if (leaseId) revalidatePath(`/app/leases/${leaseId}`);
}
