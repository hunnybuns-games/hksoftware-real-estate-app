import { db } from "@/lib/db";
import { daysBetweenUtc, startOfUtcDay } from "@/lib/dates";
import type { PaymentReconciliationStatus, PaymentStatus } from "@prisma/client";

/**
 * The reconciliation engine: given a lease's charges and every payment ever
 * applied to it — regardless of source — decides which period each payment
 * belongs to, and whether that period ended up fully covered, short, or paid
 * late. This is what replaces manually cross-checking a bank statement
 * against a spreadsheet, so it has to be right regardless of *how* money
 * arrived: Stripe, a CSV import, or a number typed in by hand.
 *
 * Design notes that matter for correctness:
 *
 * - Allocation is recomputed from scratch every time, not accumulated
 *   incrementally. A HAP payment for March can arrive in June, well after
 *   later charges already exist and other payments were already recorded —
 *   incremental allocation would get this wrong; a full FIFO recompute over
 *   every live charge and every crediting payment, oldest first, always
 *   lands on the same correct answer regardless of arrival order.
 *
 * - A charge's status is *combined-total* based: every payment that
 *   contributes to a charge shares that charge's status. There is no
 *   per-source (tenant vs. subsidy) pass/fail check — a HAP split only
 *   changes how a period's money is *attributed* for display (see
 *   src/lib/rent-split.ts), never whether it counts as covered. Paying $400
 *   HAP + $800 tenant against a $1,200 charge is fully MATCHED even if
 *   neither figure matches some expected 50/50 split.
 *
 * - chargeId is a single FK, so a payment that overshoots one charge and
 *   spills into the next is recorded against the *first* charge it touched.
 *   That mirrors the pre-existing manual-payment allocator's philosophy:
 *   it's a convenience pointer for the UI ("this payment was for June
 *   rent"), not an allocation ledger — statuses and totals are always
 *   computed from the full payment/charge sets, so an imprecise pointer here
 *   can never make the money math wrong.
 */

export type ReconciliationChargeInput = {
  id: string;
  amountCents: number;
  dueDate: Date;
  voidedAt: Date | null;
};

export type ReconciliationPaymentInput = {
  id: string;
  amountCents: number;
  status: PaymentStatus;
  paidAt: Date | null;
  createdAt: Date;
};

export type PaymentReconciliation = {
  status: PaymentReconciliationStatus;
  chargeId: string | null;
};

/** Mirrors ledger.ts's CREDITING_STATUSES — the statuses that count as real money. */
const CREDITING: PaymentStatus[] = ["SUCCEEDED", "PROCESSING"];

/**
 * Pure — no DB access — so every scenario (multi-source, HAP split, arrival
 * order, grace period edges) is directly unit-testable. Returns a map keyed
 * by payment id; callers persist it (see applyReconciliation below).
 */
export function computeReconciliation({
  charges,
  payments,
  graceDays,
  asOf = new Date(),
}: {
  charges: ReconciliationChargeInput[];
  payments: ReconciliationPaymentInput[];
  graceDays: number;
  asOf?: Date;
}): Map<string, PaymentReconciliation> {
  const result = new Map<string, PaymentReconciliation>();
  const today = startOfUtcDay(asOf);

  const liveCharges = [...charges]
    .filter((c) => c.voidedAt === null)
    .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());

  const crediting = payments
    .filter((p) => CREDITING.includes(p.status))
    .sort((a, b) => paymentDate(a).getTime() - paymentDate(b).getTime());

  // Non-crediting payments (FAILED, REFUNDED, still PENDING) never covered
  // anything. Their own `status` field already communicates the problem —
  // reconciliationStatus for these just means "nothing to reconcile", so
  // default to MATCHED rather than inventing a fifth status value.
  for (const p of payments) {
    if (!CREDITING.includes(p.status)) result.set(p.id, { status: "MATCHED", chargeId: null });
  }

  const coveredCents = new Map<string, number>();
  const coveredAt = new Map<string, Date>();
  const paymentPrimaryCharge = new Map<string, string | null>();

  let chargeIndex = 0;
  for (const payment of crediting) {
    let amountLeft = payment.amountCents;
    let primaryChargeId: string | null = null;

    while (amountLeft > 0 && chargeIndex < liveCharges.length) {
      const charge = liveCharges[chargeIndex];
      const already = coveredCents.get(charge.id) ?? 0;
      const remaining = charge.amountCents - already;

      if (remaining <= 0) {
        chargeIndex += 1;
        continue;
      }

      const contribution = Math.min(amountLeft, remaining);
      const newTotal = already + contribution;
      coveredCents.set(charge.id, newTotal);
      primaryChargeId ??= charge.id;
      amountLeft -= contribution;

      if (newTotal >= charge.amountCents) {
        coveredAt.set(charge.id, paymentDate(payment));
        chargeIndex += 1;
      } else {
        break; // this payment is exhausted before fully covering the charge
      }
    }

    paymentPrimaryCharge.set(payment.id, primaryChargeId);
  }

  // Charge-level verdict, then broadcast to every payment that touched it.
  const chargeStatus = new Map<string, PaymentReconciliationStatus>();
  for (const charge of liveCharges) {
    const covered = coveredCents.get(charge.id) ?? 0;
    if (covered >= charge.amountCents) {
      const at = coveredAt.get(charge.id)!;
      const late = daysBetweenUtc(charge.dueDate, at) > graceDays;
      chargeStatus.set(charge.id, late ? "LATE" : "MATCHED");
    } else {
      const daysPastDue = daysBetweenUtc(charge.dueDate, today);
      chargeStatus.set(charge.id, daysPastDue > graceDays ? "SHORT" : "MATCHED");
    }
  }

  for (const payment of crediting) {
    const chargeId = paymentPrimaryCharge.get(payment.id) ?? null;
    // No open charge existed for this money at all (paid ahead) — that's a
    // clean credit, not a problem.
    const status = chargeId ? chargeStatus.get(chargeId)! : "MATCHED";
    result.set(payment.id, { status, chargeId });
  }

  return result;
}

function paymentDate(p: { paidAt: Date | null; createdAt: Date }): Date {
  return p.paidAt ?? p.createdAt;
}

/**
 * DB-touching wrapper: recomputes and persists every payment's chargeId +
 * reconciliationStatus for one lease. Called after anything that changes
 * what a lease owes or what's been paid toward it — recording a payment
 * (any source), confirming a CSV import, a Stripe webhook settling or
 * failing a payment, voiding a charge, running the monthly rent charge
 * generator, or editing the lease's rent/subsidy split.
 *
 * Safe to call repeatedly and from concurrent code paths: it always
 * recomputes from the full current state rather than adjusting incrementally,
 * so calling it twice in a row is a no-op the second time.
 */
export async function applyReconciliation(leaseId: string): Promise<void> {
  const lease = await db.lease.findUnique({
    where: { id: leaseId },
    select: {
      organization: { select: { graceDays: true } },
      charges: { select: { id: true, amountCents: true, dueDate: true, voidedAt: true } },
      payments: {
        select: { id: true, amountCents: true, status: true, paidAt: true, createdAt: true },
      },
    },
  });
  if (!lease) return;

  const result = computeReconciliation({
    charges: lease.charges,
    payments: lease.payments,
    graceDays: lease.organization.graceDays,
  });

  const updates = lease.payments
    .map((p) => {
      const r = result.get(p.id);
      if (!r) return null;
      return db.payment.update({
        where: { id: p.id },
        data: { chargeId: r.chargeId, reconciliationStatus: r.status },
      });
    })
    .filter((u): u is NonNullable<typeof u> => u !== null);

  if (updates.length > 0) await db.$transaction(updates);
}

/**
 * Re-runs reconciliation for every lease in an organization. Used by the
 * "Reconcile now" action alongside the monthly rent run, and available as a
 * manual fix-up after a bulk change (e.g. changing the org's grace period).
 */
export async function applyReconciliationForOrganization(
  organizationId: string,
): Promise<{ leasesProcessed: number }> {
  const leases = await db.lease.findMany({
    where: { organizationId },
    select: { id: true },
  });
  for (const lease of leases) {
    await applyReconciliation(lease.id);
  }
  return { leasesProcessed: leases.length };
}
