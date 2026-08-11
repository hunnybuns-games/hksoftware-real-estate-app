import { db, isUniqueViolation } from "@/lib/db";
import { chunked } from "@/lib/chunk";
import {
  addUtcMonths,
  daysBetweenUtc,
  formatMonth,
  rentDueDateFor,
  startOfUtcDay,
  startOfUtcMonth,
} from "@/lib/dates";
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
 * A RENT charge writes 6 columns, so 16 rows is 96 bound parameters — just
 * under D1's ceiling of 100. Prisma emits createMany as a single multi-row
 * INSERT, so the row count is what has to stay bounded. See src/lib/chunk.ts.
 */
const CHARGE_INSERT_CHUNK = 16;

/** The minimum a lease has to tell us to decide what it owes. */
export type BillableLease = Pick<
  Lease,
  "id" | "startDate" | "endDate" | "rentAmountCents" | "rentDueDay"
>;

export type PendingRentCharge = {
  leaseId: string;
  type: "RENT";
  amountCents: number;
  dueDate: Date;
  periodStart: Date;
  description: string;
};

/** The idempotency key a Charge row occupies, as `pendingRentCharges` reads it. */
export function billedPeriodKey(leaseId: string, periodStart: Date | null): string {
  return `${leaseId}|${periodStart?.getTime() ?? ""}`;
}

/**
 * Which RENT charges are missing — the whole of the billing rulebook, and no
 * database access, so every rule below is unit testable the same way
 * computeBalance is. `generateRentCharges` is then just the I/O around it.
 *
 * The rules, in one place:
 *  - one charge per calendar month from the lease's start month through the
 *    month containing `asOf`;
 *  - never earlier than `maxMonthsBack` months before that, so onboarding a
 *    years-old lease doesn't post five years of history;
 *  - never past the month the lease ended;
 *  - nothing for a lease with no rent;
 *  - nothing for a period already in `alreadyBilled`.
 */
export function pendingRentCharges(input: {
  leases: BillableLease[];
  /** Keys from `billedPeriodKey` for periods already on the books. */
  alreadyBilled: ReadonlySet<string>;
  asOf: Date;
  maxMonthsBack: number;
}): PendingRentCharge[] {
  const currentPeriod = startOfUtcMonth(input.asOf);
  const earliestPeriod = addUtcMonths(currentPeriod, -input.maxMonthsBack);
  const out: PendingRentCharge[] = [];

  for (const lease of input.leases) {
    if (lease.rentAmountCents <= 0) continue;

    const leaseStartPeriod = startOfUtcMonth(lease.startDate);
    let period =
      leaseStartPeriod.getTime() > earliestPeriod.getTime() ? leaseStartPeriod : earliestPeriod;

    while (period.getTime() <= currentPeriod.getTime()) {
      // Don't bill months after the lease ended.
      if (lease.endDate && period.getTime() > startOfUtcMonth(lease.endDate).getTime()) break;

      if (!input.alreadyBilled.has(billedPeriodKey(lease.id, period))) {
        // The charge is created as soon as its month begins, even if the due day
        // hasn't arrived — tenants should be able to pay early, and staff should
        // see the month's rent on the books from the 1st. Lateness is decided by
        // dueDate + graceDays in computeBalance, not by when the charge appeared.
        out.push({
          leaseId: lease.id,
          type: "RENT",
          amountCents: lease.rentAmountCents,
          dueDate: rentDueDateFor(period, lease.rentDueDay),
          periodStart: period,
          description: `Rent — ${formatMonth(period)}`,
        });
      }

      period = addUtcMonths(period, 1);
    }
  }

  return out;
}

/**
 * Creates the RENT charge for every active lease for each month from the lease
 * start through the current month. Idempotent: the
 * (leaseId, type, periodStart) unique constraint means running this twice — or
 * twice concurrently — cannot double-bill.
 *
 * Called from the cron endpoint (/api/cron/rent-run) and from the "Run rent"
 * button in the app, so a landlord is never blocked waiting for a scheduler.
 *
 * Reads which periods are already billed up front rather than discovering it
 * one failed INSERT at a time. That ordering matters more than it looks: the
 * common case by far is a run where every period is already billed, and the
 * previous shape spent one round trip per (lease × month) to learn that — ~340
 * of them for a 28-lease portfolio, every one a unique-violation that was
 * caught and thrown away. Now that case costs a single read and no writes.
 */
export async function generateRentCharges(options: {
  organizationId: string;
  asOf?: Date;
  /** Cap backfill so onboarding an old lease doesn't create 5 years of charges. */
  maxMonthsBack?: number;
}): Promise<{ created: number; leasesProcessed: number }> {
  const asOf = options.asOf ?? new Date();
  const maxMonthsBack = options.maxMonthsBack ?? 12;
  const earliestPeriod = addUtcMonths(startOfUtcMonth(asOf), -maxMonthsBack);

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

  // Scoped through the lease relation rather than `leaseId: { in: [...] }`:
  // an id list would spend one bound parameter per lease and blow D1's cap of
  // 100 on a portfolio this query most needs to be fast for.
  const existing = await db.charge.findMany({
    where: {
      type: "RENT",
      periodStart: { gte: earliestPeriod },
      lease: { organizationId: options.organizationId, status: "ACTIVE" },
    },
    select: { leaseId: true, periodStart: true },
  });

  const toCreate = pendingRentCharges({
    leases,
    alreadyBilled: new Set(existing.map((c) => billedPeriodKey(c.leaseId, c.periodStart))),
    asOf,
    maxMonthsBack,
  });

  let created = 0;

  for (const chunk of chunked(toCreate, CHARGE_INSERT_CHUNK)) {
    try {
      const result = await db.charge.createMany({ data: chunk });
      created += result.count;
    } catch (err) {
      // A concurrent run billed one of these periods between our read and this
      // write. The unique constraint — not the read above — is what actually
      // prevents double-billing, and a rejected multi-row INSERT writes none of
      // its rows, so retrying the chunk one row at a time is safe and settles
      // exactly which periods were genuinely still missing.
      if (!isUniqueViolation(err)) throw err;
      for (const row of chunk) {
        try {
          await db.charge.create({ data: row });
          created += 1;
        } catch (rowErr) {
          if (!isUniqueViolation(rowErr)) throw rowErr;
        }
      }
    }
  }

  return { created, leasesProcessed: leases.length };
}

/**
 * Loads a lease with its ledger, scoped to an organization. Returns null rather
 * than throwing so callers can decide between 404 and a redirect.
 *
 * The return type is deliberately inferred: it's the `include` above plus
 * `balance`, and spelling that out by hand is how it drifts from what the query
 * actually selects.
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
