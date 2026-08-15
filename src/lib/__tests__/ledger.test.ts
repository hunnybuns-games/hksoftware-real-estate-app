import { describe, expect, it } from "vitest";
import {
  type BillableLease,
  billedPeriodKey,
  computeBalance,
  nextScheduledCharge,
  pendingRentCharges,
} from "@/lib/ledger";
import { utcDate } from "@/lib/dates";
import { parseDollarsToCents, formatCents } from "@/lib/money";

/**
 * The balance/lateness math decides who gets a late notice and whose door gets
 * knocked on, so it gets tested directly rather than through the UI.
 */

const charge = (amountCents: number, dueDate: Date, voidedAt: Date | null = null) => ({
  amountCents,
  dueDate,
  voidedAt,
});

const payment = (
  amountCents: number,
  status: "SUCCEEDED" | "PROCESSING" | "PENDING" | "FAILED" | "REFUNDED",
) => ({ amountCents, status } as const);

describe("computeBalance", () => {
  it("is zero for a lease with nothing on it", () => {
    const b = computeBalance({ charges: [], payments: [], graceDays: 5 });
    expect(b.balanceCents).toBe(0);
    expect(b.isLate).toBe(false);
    expect(b.oldestUnpaidDueDate).toBeNull();
  });

  it("subtracts settled payments from charges", () => {
    const b = computeBalance({
      charges: [charge(180_000, utcDate(2026, 6, 1)), charge(180_000, utcDate(2026, 7, 1))],
      payments: [payment(180_000, "SUCCEEDED")],
      graceDays: 5,
      asOf: utcDate(2026, 7, 3),
    });
    expect(b.chargedCents).toBe(360_000);
    expect(b.settledCents).toBe(180_000);
    expect(b.balanceCents).toBe(180_000);
    // First charge is covered, so the balance sits on July.
    expect(b.oldestUnpaidDueDate).toEqual(utcDate(2026, 7, 1));
  });

  it("counts in-flight ACH toward the balance but not toward settled money", () => {
    const b = computeBalance({
      charges: [charge(180_000, utcDate(2026, 7, 1))],
      payments: [payment(180_000, "PROCESSING")],
      graceDays: 5,
      asOf: utcDate(2026, 7, 20),
    });
    expect(b.settledCents).toBe(0);
    expect(b.pendingCents).toBe(180_000);
    expect(b.balanceCents).toBe(0);
    // Critically: a tenant whose transfer is clearing must not be chased.
    expect(b.isLate).toBe(false);
  });

  it("ignores failed, pending and refunded payments", () => {
    const b = computeBalance({
      charges: [charge(100_000, utcDate(2026, 7, 1))],
      payments: [
        payment(100_000, "FAILED"),
        payment(100_000, "PENDING"),
        payment(100_000, "REFUNDED"),
      ],
      graceDays: 5,
      asOf: utcDate(2026, 7, 2),
    });
    expect(b.balanceCents).toBe(100_000);
    expect(b.paidCents).toBe(0);
  });

  it("excludes voided charges", () => {
    const b = computeBalance({
      charges: [
        charge(180_000, utcDate(2026, 7, 1)),
        charge(7_500, utcDate(2026, 7, 6), utcDate(2026, 7, 8)),
      ],
      payments: [payment(180_000, "SUCCEEDED")],
      graceDays: 5,
      asOf: utcDate(2026, 7, 20),
    });
    expect(b.chargedCents).toBe(180_000);
    expect(b.balanceCents).toBe(0);
  });

  it("stays within the grace period on the last allowed day", () => {
    const b = computeBalance({
      charges: [charge(180_000, utcDate(2026, 7, 1))],
      payments: [],
      graceDays: 5,
      asOf: utcDate(2026, 7, 6),
    });
    expect(b.daysPastDue).toBe(5);
    expect(b.isLate).toBe(false);
  });

  it("goes late the day after the grace period ends", () => {
    const b = computeBalance({
      charges: [charge(180_000, utcDate(2026, 7, 1))],
      payments: [],
      graceDays: 5,
      asOf: utcDate(2026, 7, 7),
    });
    expect(b.daysPastDue).toBe(6);
    expect(b.isLate).toBe(true);
  });

  it("is not late when rent is owed but not yet due", () => {
    const b = computeBalance({
      charges: [charge(180_000, utcDate(2026, 8, 1))],
      payments: [],
      graceDays: 5,
      asOf: utcDate(2026, 7, 25),
    });
    expect(b.balanceCents).toBe(180_000);
    expect(b.daysPastDue).toBe(0);
    expect(b.isLate).toBe(false);
  });

  it("dates lateness from the oldest unpaid charge, not the newest", () => {
    // Three months owed, one month paid: the balance sits on the second month,
    // and lateness must be measured from there.
    const b = computeBalance({
      charges: [
        charge(100_000, utcDate(2026, 5, 1)),
        charge(100_000, utcDate(2026, 6, 1)),
        charge(100_000, utcDate(2026, 7, 1)),
      ],
      payments: [payment(100_000, "SUCCEEDED")],
      graceDays: 5,
      asOf: utcDate(2026, 7, 10),
    });
    expect(b.balanceCents).toBe(200_000);
    expect(b.oldestUnpaidDueDate).toEqual(utcDate(2026, 6, 1));
    expect(b.daysPastDue).toBe(39);
    expect(b.isLate).toBe(true);
  });

  it("reports a credit as a negative balance and never as late", () => {
    const b = computeBalance({
      charges: [charge(100_000, utcDate(2026, 7, 1))],
      payments: [payment(150_000, "SUCCEEDED")],
      graceDays: 5,
      asOf: utcDate(2026, 7, 30),
    });
    expect(b.balanceCents).toBe(-50_000);
    expect(b.isLate).toBe(false);
  });

  it("treats a partial payment as leaving the charge unpaid", () => {
    const b = computeBalance({
      charges: [charge(180_000, utcDate(2026, 7, 1))],
      payments: [payment(50_000, "SUCCEEDED")],
      graceDays: 5,
      asOf: utcDate(2026, 7, 20),
    });
    expect(b.balanceCents).toBe(130_000);
    expect(b.oldestUnpaidDueDate).toEqual(utcDate(2026, 7, 1));
    expect(b.isLate).toBe(true);
  });

  it("handles a zero grace period", () => {
    const b = computeBalance({
      charges: [charge(180_000, utcDate(2026, 7, 1))],
      payments: [],
      graceDays: 0,
      asOf: utcDate(2026, 7, 2),
    });
    expect(b.isLate).toBe(true);
  });
});

/**
 * What gets billed, to whom, for which month. A bug here either double-bills a
 * resident or silently fails to bill them, and neither shows up until someone
 * reads a statement — so the rules are pinned down directly.
 */
describe("pendingRentCharges", () => {
  const lease = (over: Partial<BillableLease> = {}): BillableLease => ({
    id: "lease-1",
    startDate: utcDate(2026, 6, 1),
    endDate: null,
    rentAmountCents: 180_000,
    rentDueDay: 1,
    ...over,
  });

  const run = (
    leases: BillableLease[],
    alreadyBilled: string[] = [],
    asOf = utcDate(2026, 8, 11),
    maxMonthsBack = 12,
  ) =>
    pendingRentCharges({
      leases,
      alreadyBilled: new Set(alreadyBilled),
      asOf,
      maxMonthsBack,
    });

  const periods = (rows: { periodStart: Date }[]) =>
    rows.map((r) => r.periodStart.toISOString().slice(0, 7));

  it("bills one charge per month from the lease start through the current month", () => {
    // Starts June, asOf is mid-August: June, July, August. The current month is
    // billed on the 1st even though the month isn't over.
    expect(periods(run([lease()]))).toEqual(["2026-06", "2026-07", "2026-08"]);
  });

  it("bills the month containing asOf even before the due day arrives", () => {
    const rows = run([lease({ startDate: utcDate(2026, 8, 1), rentDueDay: 28 })]);
    expect(periods(rows)).toEqual(["2026-08"]);
    expect(rows[0].dueDate).toEqual(utcDate(2026, 8, 28));
  });

  it("skips periods already on the books", () => {
    const already = [
      billedPeriodKey("lease-1", utcDate(2026, 6, 1)),
      billedPeriodKey("lease-1", utcDate(2026, 7, 1)),
    ];
    expect(periods(run([lease()], already))).toEqual(["2026-08"]);
  });

  it("returns nothing when every period is already billed", () => {
    const already = ["2026-06", "2026-07", "2026-08"].map((_, i) =>
      billedPeriodKey("lease-1", utcDate(2026, 6 + i, 1)),
    );
    expect(run([lease()], already)).toEqual([]);
  });

  it("caps backfill at maxMonthsBack so an old lease doesn't post years of history", () => {
    // Lease started in 2020; only the last 3 months may be posted.
    const rows = run([lease({ startDate: utcDate(2020, 1, 1) })], [], utcDate(2026, 8, 11), 3);
    expect(periods(rows)).toEqual(["2026-05", "2026-06", "2026-07", "2026-08"]);
  });

  it("stops billing after the month the lease ended", () => {
    const rows = run([lease({ endDate: utcDate(2026, 7, 15) })]);
    expect(periods(rows)).toEqual(["2026-06", "2026-07"]);
  });

  it("bills the final month of a lease that ends on the 1st", () => {
    const rows = run([lease({ endDate: utcDate(2026, 7, 1) })]);
    expect(periods(rows)).toEqual(["2026-06", "2026-07"]);
  });

  it("ignores a lease with no rent", () => {
    expect(run([lease({ rentAmountCents: 0 })])).toEqual([]);
    expect(run([lease({ rentAmountCents: -1 })])).toEqual([]);
  });

  it("clamps the due day into a month every month actually has", () => {
    // rentDueDay is capped at 28 at write time; this is the guard on that
    // contract holding through to the charge's dueDate (no Mar 31 → Feb 31).
    const rows = run([lease({ startDate: utcDate(2026, 2, 1), rentDueDay: 31 })], [], utcDate(2026, 2, 15));
    expect(rows).toHaveLength(1);
    expect(rows[0].dueDate).toEqual(utcDate(2026, 2, 28));
  });

  it("carries the lease's rent and a human description onto each charge", () => {
    const rows = run([lease({ startDate: utcDate(2026, 8, 1), rentAmountCents: 195_000 })]);
    expect(rows).toEqual([
      {
        leaseId: "lease-1",
        type: "RENT",
        amountCents: 195_000,
        dueDate: utcDate(2026, 8, 1),
        periodStart: utcDate(2026, 8, 1),
        description: "Rent — August 2026",
      },
    ]);
  });

  it("bills each lease independently", () => {
    const rows = run([
      lease({ id: "a", startDate: utcDate(2026, 8, 1) }),
      lease({ id: "b", startDate: utcDate(2026, 7, 1), rentAmountCents: 120_000 }),
    ]);
    expect(rows.filter((r) => r.leaseId === "a")).toHaveLength(1);
    expect(rows.filter((r) => r.leaseId === "b")).toHaveLength(2);
  });

  it("does not let one lease's billed period suppress another's", () => {
    // Same period, different lease — the key is (lease, period), not period.
    const already = [billedPeriodKey("a", utcDate(2026, 8, 1))];
    const rows = run(
      [lease({ id: "a", startDate: utcDate(2026, 8, 1) }), lease({ id: "b", startDate: utcDate(2026, 8, 1) })],
      already,
    );
    expect(rows.map((r) => r.leaseId)).toEqual(["b"]);
  });

  it("bills nothing for a lease starting after the current month", () => {
    expect(run([lease({ startDate: utcDate(2026, 10, 1) })])).toEqual([]);
  });
});

describe("nextScheduledCharge", () => {
  const lease = (
    over: Partial<{
      startDate: Date;
      endDate: Date | null;
      rentAmountCents: number;
      rentDueDay: number;
      status: "DRAFT" | "ACTIVE" | "ENDED";
    }> = {},
  ) => ({
    startDate: utcDate(2026, 6, 1),
    endDate: null,
    rentAmountCents: 180_000,
    rentDueDay: 1,
    status: "ACTIVE" as const,
    ...over,
  });

  const emptyBalance = computeBalance({ charges: [], payments: [], graceDays: 5 });

  it("projects the lease's start month when nothing has been charged yet", () => {
    // The case a landlord actually asks "upcoming payments" for: a lease
    // that's active but whose term — and billing — hasn't started.
    const next = nextScheduledCharge(
      lease({ startDate: utcDate(2026, 9, 1) }),
      [],
      emptyBalance,
    );
    expect(next).toEqual({ dueDate: utcDate(2026, 9, 1), amountCents: 180_000 });
  });

  it("projects the month after the latest billed period once that's fully paid", () => {
    const charges = [charge(180_000, utcDate(2026, 6, 1))];
    const balance = computeBalance({
      charges,
      payments: [payment(180_000, "SUCCEEDED")],
      graceDays: 5,
    });
    const next = nextScheduledCharge(lease(), charges, balance);
    expect(next).toEqual({ dueDate: utcDate(2026, 7, 1), amountCents: 180_000 });
  });

  it("defers to the unpaid charge already on the books, whatever its due date", () => {
    const charges = [charge(180_000, utcDate(2026, 12, 1))];
    const balance = computeBalance({ charges, payments: [], graceDays: 5, asOf: utcDate(2026, 8, 1) });
    const next = nextScheduledCharge(lease(), charges, balance);
    expect(next).toEqual({ dueDate: utcDate(2026, 12, 1), amountCents: 180_000 });
  });

  it("ignores voided charges when finding the latest billed period", () => {
    const charges = [
      charge(180_000, utcDate(2026, 7, 1), utcDate(2026, 7, 2)),
      charge(180_000, utcDate(2026, 6, 1)),
    ];
    const balance = computeBalance({
      charges,
      payments: [payment(180_000, "SUCCEEDED")],
      graceDays: 5,
    });
    const next = nextScheduledCharge(lease(), charges, balance);
    expect(next).toEqual({ dueDate: utcDate(2026, 7, 1), amountCents: 180_000 });
  });

  it("returns null once projecting past the lease's end date", () => {
    const charges = [charge(180_000, utcDate(2026, 6, 1))];
    const balance = computeBalance({
      charges,
      payments: [payment(180_000, "SUCCEEDED")],
      graceDays: 5,
    });
    const next = nextScheduledCharge(lease({ endDate: utcDate(2026, 6, 15) }), charges, balance);
    expect(next).toBeNull();
  });

  it("returns null for a non-active lease with nothing already owed", () => {
    expect(nextScheduledCharge(lease({ status: "DRAFT" }), [], emptyBalance)).toBeNull();
    expect(nextScheduledCharge(lease({ status: "ENDED" }), [], emptyBalance)).toBeNull();
  });

  it("returns null for a lease with no rent", () => {
    expect(nextScheduledCharge(lease({ rentAmountCents: 0 }), [], emptyBalance)).toBeNull();
  });
});

describe("parseDollarsToCents", () => {
  it("accepts the shapes people actually type", () => {
    expect(parseDollarsToCents("1850")).toBe(185_000);
    expect(parseDollarsToCents("1850.00")).toBe(185_000);
    expect(parseDollarsToCents("1,850.50")).toBe(185_050);
    expect(parseDollarsToCents("$1850")).toBe(185_000);
    expect(parseDollarsToCents(" 1850.5 ")).toBe(185_050);
    expect(parseDollarsToCents("0")).toBe(0);
  });

  it("rejects anything that isn't a clean amount", () => {
    expect(parseDollarsToCents("")).toBeNull();
    expect(parseDollarsToCents("abc")).toBeNull();
    expect(parseDollarsToCents("-50")).toBeNull();
    expect(parseDollarsToCents("18.505")).toBeNull();
    expect(parseDollarsToCents("1850.00.00")).toBeNull();
  });

  it("round-trips through formatCents without drift", () => {
    // Floats are why money is stored in cents; this is the guard on that.
    const cents = parseDollarsToCents("1234.56");
    expect(cents).toBe(123_456);
    expect(formatCents(cents!)).toBe("$1,234.56");
  });
});
