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
        // as an idempotency key, and null values don't collide in Postgres.
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

function revalidatePaymentViews(leaseId?: string | null) {
  revalidatePath("/app");
  revalidatePath("/app/payments");
  revalidatePath("/app/leases");
  revalidatePath("/owner");
  if (leaseId) revalidatePath(`/app/leases/${leaseId}`);
}
