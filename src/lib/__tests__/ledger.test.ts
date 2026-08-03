import { describe, expect, it } from "vitest";
import { computeBalance } from "@/lib/ledger";
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
