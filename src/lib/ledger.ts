import { db } from "@/lib/db";
import {
  addUtcMonths,
  daysBetweenUtc,
  rentDueDateFor,
  startOfUtcDay,
  startOfUtcMonth,
} from "@/lib/dates";
import { formatMonth } from "@/lib/dates";
import type { Charge, Lease, Payment, PaymentStatus } from "@prisma/client";

/**
 * The ledger is deliberately simple: a Charge is money owed, a Payment is money
 * received. Balance is the difference. There is no double-entry accounting in
 * v1 (explicitly out of scope), but keeping charges as first-class rows means
 * "what's outstanding" is a query rather than a guess, and adding real
 * accounting later doesn't require re-deriving history.
 */

/** Payment statuses that count toward a lease's paid total. */
export const CREDITING_STATUSES: PaymentStatus[] = ["SUCCEEDED", "PROCESSING"];

export type LeaseBalance = {
  chargedCents: number;
  paidCents: number;
  /** Settled money only — excludes ACH still in flight. */
  settledCents: number;
  /** In-flight ACH; shown to tenants so they don't double-pay. */
  pendingCents: number;
  balanceCents: number;
  /** Balance ignoring in-flight payments — what we'd chase if ACH failed. */
  oldestUnpaidDueDate: Date | null;
  daysPastDue: number;
  isLate: boolean;
};

type BalanceInput = {
  charges: Pick<Charge, "amountCents" | "dueDate" | "voidedAt">[];
  payments: Pick<Payment, "amountCents" | "status">[];
  graceDays: number;
  asOf?: Date;
};

/**
 * Pure balance math — no DB access — so it can be unit tested and reused for a
 * single lease or a whole portfolio.
 */
export function computeBalance({
  charges,
  payments,
  graceDays,
  asOf = new Date(),
}: BalanceInput): LeaseBalance {
  const live = charges.filter((c) => c.voidedAt === null);
  const chargedCents = live.reduce((sum, c) => sum + c.amountCents, 0);

  const settledCents = payments
    .filter((p) => p.status === "SUCCEEDED")
    .reduce((sum, p) => sum + p.amountCents, 0);
  const pendingCents = payments
    .filter((p) => p.status === "PROCESSING")
    .reduce((sum, p) => sum + p.amountCents, 0);

  const paidCents = settledCents + pendingCents;
  const balanceCents = chargedCents - paidCents;

  // Which charge is the balance actually sitting on? Walk charges oldest-first
  // and apply settled + in-flight money against them; the first one not fully
  // covered is what the tenant is behind on.
  const today = startOfUtcDay(asOf);
  let remaining = paidCents;
  let oldestUnpaidDueDate: Date | null = null;
  for (const charge of [...live].sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())) {
    if (remaining >= charge.amountCents) {
      remaining -= charge.amountCents;
      continue;
    }
    oldestUnpaidDueDate = charge.dueDate;
    break;
  }

  const daysPastDue =
    oldestUnpaidDueDate && balanceCents > 0
      ? Math.max(0, daysBetweenUtc(oldestUnpaidDueDate, today))
      : 0;

  return {
    chargedCents,
    paidCents,
    settledCents,
    pendingCents,
    balanceCents,
    oldestUnpaidDueDate,
    daysPastDue,
    isLate: balanceCents > 0 && daysPastDue > graceDays,
  };
}

/**
 * Creates the RENT charge for every active lease for each month from the lease
 * start (or `from`) through the current month. Idempotent: the
 * (leaseId, type, periodStart) unique constraint means running this twice — or
 * twice concurrently — cannot double-bill.
 *
 * Called from the cron endpoint (/api/cron/rent-run) and from the "Run rent"
 * button in the app, so a landlord is never blocked waiting for a scheduler.
 */
export async function generateRentCharges(options: {
  organizationId: string;
  asOf?: Date;
  /** Cap backfill so onboarding an old lease doesn't create 5 years of charges. */
  maxMonthsBack?: number;
}): Promise<{ created: number; leasesProcessed: number }> {
  const asOf = options.asOf ?? new Date();
  const currentPeriod = startOfUtcMonth(asOf);
  const maxMonthsBack = options.maxMonthsBack ?? 12;
  const earliestPeriod = addUtcMonths(currentPeriod, -maxMonthsBack);

  const leases = await db.lease.findMany({
    where: { organizationId: options.organizationId, status: "ACTIVE" },
    select: {
      id: true,
      startDate: true,
      endDate: true,
      rentAmountCents: true,
      rentDueDay: true,
    },
  });

  let created = 0;

  for (const lease of leases) {
    if (lease.rentAmountCents <= 0) continue;

    const leaseStartPeriod = startOfUtcMonth(lease.startDate);
    let period =
      leaseStartPeriod.getTime() > earliestPeriod.getTime() ? leaseStartPeriod : earliestPeriod;

    while (period.getTime() <= currentPeriod.getTime()) {
      // Don't bill months after the lease ended.
      if (lease.endDate && period.getTime() > startOfUtcMonth(lease.endDate).getTime()) break;

      // The charge is created as soon as its month begins, even if the due day
      // hasn't arrived — tenants should be able to pay early, and staff should
      // see the month's rent on the books from the 1st. Lateness is decided by
      // dueDate + graceDays in computeBalance, not by when the charge appeared.
      const dueDate = rentDueDateFor(period, lease.rentDueDay);

      try {
        await db.charge.create({
          data: {
            leaseId: lease.id,
            type: "RENT",
            amountCents: lease.rentAmountCents,
            dueDate,
            periodStart: period,
            description: `Rent — ${formatMonth(period)}`,
          },
        });
        created += 1;
      } catch (err) {
        // P2002 = unique violation = this period is already billed. Expected.
        if (!isUniqueViolation(err)) throw err;
      }

      period = addUtcMonths(period, 1);
    }
  }

  return { created, leasesProcessed: leases.length };
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "P2002"
  );
}

export type LeaseWithLedger = Lease & {
  charges: Charge[];
  payments: Payment[];
  balance: LeaseBalance;
};

/**
 * Loads a lease with its ledger, scoped to an organization. Returns null rather
 * than throwing so callers can decide between 404 and a redirect.
 */
export async function getLeaseLedger(leaseId: string, organizationId: string) {
  const lease = await db.lease.findFirst({
    where: { id: leaseId, organizationId },
    include: {
      charges: { orderBy: { dueDate: "desc" } },
      payments: { orderBy: { createdAt: "desc" } },
      tenant: true,
      unit: { include: { property: true } },
      organization: { select: { graceDays: true, name: true, lateFeeCents: true } },
    },
  });
  if (!lease) return null;

  return {
    ...lease,
    balance: computeBalance({
      charges: lease.charges,
      payments: lease.payments,
      graceDays: lease.organization.graceDays,
    }),
  };
}

/**
 * What a tenant still owes right now, oldest charge first. Drives the "Pay
 * rent" amount in the portal.
 */
export function amountDueNow(balance: LeaseBalance): number {
  return Math.max(0, balance.balanceCents);
}
