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
import { notifyRentReceived } from "@/lib/notifications";
import { formatCents } from "@/lib/money";

const manualPaymentSchema = z.object({
  amountCents: centsField("Amount"),
  method: z.enum(["MANUAL", "ACH", "CARD"]),
  paidAt: dateField("Date received"),
  memo: optionalText(200),
});

/**
 * Records money that arrived outside Stripe — a check, cash, a Zelle transfer.
 * Landlords at this scale have plenty of these, and a rent roll that can't
 * account for them is useless.
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
      include: {
        tenant: { select: { firstName: true, email: true, userId: true } },
        organization: { select: { name: true } },
        charges: {
          where: { voidedAt: null },
          orderBy: { dueDate: "asc" },
          select: { id: true, amountCents: true },
        },
        payments: { select: { amountCents: true, status: true, chargeId: true } },
      },
    });
    if (!lease) return actionError("That lease no longer exists.");

    await db.payment.create({
      data: {
        leaseId: lease.id,
        amountCents: parsed.data.amountCents,
        method: parsed.data.method,
        status: "SUCCEEDED",
        paidAt: parsed.data.paidAt,
        memo: parsed.data.memo ?? "Recorded by staff",
        chargeId: oldestUnsettledChargeId(lease.charges, lease.payments),
      },
    });

    revalidatePaymentViews(lease.id);
    return actionOk(`Recorded ${formatCents(parsed.data.amountCents)}.`);
  });
}

/**
 * Applies a payment to the oldest charge that isn't yet covered. This is a
 * convenience link for the UI ("this payment covers June rent"), not an
 * allocation ledger — balances are always computed from totals, so a wrong
 * guess here can't make the math wrong.
 */
function oldestUnsettledChargeId(
  charges: { id: string; amountCents: number }[],
  payments: { amountCents: number; status: string }[],
): string | null {
  let credit = payments
    .filter((p) => p.status === "SUCCEEDED" || p.status === "PROCESSING")
    .reduce((sum, p) => sum + p.amountCents, 0);

  for (const charge of charges) {
    if (credit >= charge.amountCents) {
      credit -= charge.amountCents;
      continue;
    }
    return charge.id;
  }
  return null;
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
    if (!payment) return actionError("That payment no longer exists.");

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

    revalidatePaymentViews(payment.leaseId);
    return actionOk("Payment updated.");
  });
}

function revalidatePaymentViews(leaseId?: string) {
  revalidatePath("/app");
  revalidatePath("/app/payments");
  revalidatePath("/app/leases");
  revalidatePath("/owner");
  if (leaseId) revalidatePath(`/app/leases/${leaseId}`);
}
