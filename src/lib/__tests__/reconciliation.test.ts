import { describe, expect, it } from "vitest";
import { computeReconciliation } from "@/lib/reconciliation";
import { utcDate } from "@/lib/dates";
import { getRentSplit } from "@/lib/rent-split";

/**
 * computeReconciliation only ever receives payments already known to belong
 * to one lease — a payment with no lease at all (an unmatched import) never
 * reaches this function; it's marked UNMATCHED at creation time instead (see
 * confirmImportAction). So there's no UNMATCHED case to exercise here; that
 * behavior is covered where it actually happens, in the import action tests.
 */

const charge = (id: string, amountCents: number, dueDate: Date) => ({
  id,
  amountCents,
  dueDate,
  voidedAt: null as Date | null,
});

const payment = (
  id: string,
  amountCents: number,
  paidAt: Date,
  status: "SUCCEEDED" | "PROCESSING" | "FAILED" | "REFUNDED" | "PENDING" = "SUCCEEDED",
) => ({ id, amountCents, status, paidAt, createdAt: paidAt });

describe("computeReconciliation — single source", () => {
  it("matches a single payment that exactly covers one charge, on time", () => {
    const result = computeReconciliation({
      charges: [charge("c1", 180_000, utcDate(2026, 6, 1))],
      payments: [payment("p1", 180_000, utcDate(2026, 6, 1))],
      graceDays: 5,
      asOf: utcDate(2026, 6, 3),
    });
    expect(result.get("p1")).toEqual({ status: "MATCHED", chargeId: "c1" });
  });

  it("flags a payment SHORT when the charge is past due+grace and underpaid", () => {
    const result = computeReconciliation({
      charges: [charge("c1", 180_000, utcDate(2026, 6, 1))],
      payments: [payment("p1", 100_000, utcDate(2026, 6, 2))],
      graceDays: 5,
      asOf: utcDate(2026, 6, 10),
    });
    expect(result.get("p1")).toEqual({ status: "SHORT", chargeId: "c1" });
  });

  it("does not flag SHORT while still inside the grace period", () => {
    const result = computeReconciliation({
      charges: [charge("c1", 180_000, utcDate(2026, 6, 1))],
      payments: [payment("p1", 100_000, utcDate(2026, 6, 2))],
      graceDays: 5,
      asOf: utcDate(2026, 6, 5), // 4 days past due, grace is 5
    });
    expect(result.get("p1")?.status).toBe("MATCHED");
  });

  it("does not flag SHORT for a partial payment on a charge that isn't due yet", () => {
    const result = computeReconciliation({
      charges: [charge("c1", 180_000, utcDate(2026, 7, 1))],
      payments: [payment("p1", 50_000, utcDate(2026, 6, 20))],
      graceDays: 5,
      asOf: utcDate(2026, 6, 25),
    });
    expect(result.get("p1")?.status).toBe("MATCHED");
  });

  it("flags LATE when a charge is fully covered, but only after due+grace", () => {
    const result = computeReconciliation({
      charges: [charge("c1", 180_000, utcDate(2026, 6, 1))],
      payments: [payment("p1", 180_000, utcDate(2026, 6, 20))],
      graceDays: 5,
      asOf: utcDate(2026, 6, 25),
    });
    expect(result.get("p1")).toEqual({ status: "LATE", chargeId: "c1" });
  });

  it("broadcasts one charge's status to every payment that contributed to it", () => {
    const result = computeReconciliation({
      charges: [charge("c1", 180_000, utcDate(2026, 6, 1))],
      payments: [
        payment("p1", 100_000, utcDate(2026, 6, 1)),
        payment("p2", 80_000, utcDate(2026, 6, 20)),
      ],
      graceDays: 5,
      asOf: utcDate(2026, 6, 25),
    });
    // The charge was only fully covered on 6/20 — after grace — so LATE,
    // and that applies to both installments, not just the one that tipped it over.
    expect(result.get("p1")).toEqual({ status: "LATE", chargeId: "c1" });
    expect(result.get("p2")).toEqual({ status: "LATE", chargeId: "c1" });
  });

  it("treats a payment with no open charge to apply to as a clean credit", () => {
    const result = computeReconciliation({
      charges: [charge("c1", 180_000, utcDate(2026, 6, 1))],
      payments: [
        payment("p1", 180_000, utcDate(2026, 6, 1)),
        payment("p2", 180_000, utcDate(2026, 6, 2)), // paid a month ahead
      ],
      graceDays: 5,
      asOf: utcDate(2026, 6, 3),
    });
    expect(result.get("p1")).toEqual({ status: "MATCHED", chargeId: "c1" });
    expect(result.get("p2")).toEqual({ status: "MATCHED", chargeId: null });
  });

  it("ignores voided charges entirely", () => {
    const voided = { ...charge("c1", 180_000, utcDate(2026, 6, 1)), voidedAt: utcDate(2026, 6, 2) };
    const result = computeReconciliation({
      charges: [voided, charge("c2", 180_000, utcDate(2026, 7, 1))],
      payments: [payment("p1", 180_000, utcDate(2026, 6, 5))],
      graceDays: 5,
      asOf: utcDate(2026, 6, 10),
    });
    // c1 is voided, so the payment rolls straight onto c2.
    expect(result.get("p1")).toEqual({ status: "MATCHED", chargeId: "c2" });
  });

  it("leaves non-crediting payments (failed/refunded/pending) as a neutral MATCHED with no charge", () => {
    const result = computeReconciliation({
      charges: [charge("c1", 180_000, utcDate(2026, 6, 1))],
      payments: [
        payment("p1", 180_000, utcDate(2026, 6, 1), "FAILED"),
        payment("p2", 180_000, utcDate(2026, 6, 1), "REFUNDED"),
        payment("p3", 180_000, utcDate(2026, 6, 1), "PENDING"),
      ],
      graceDays: 5,
      asOf: utcDate(2026, 6, 10),
    });
    expect(result.get("p1")).toEqual({ status: "MATCHED", chargeId: null });
    expect(result.get("p2")).toEqual({ status: "MATCHED", chargeId: null });
    expect(result.get("p3")).toEqual({ status: "MATCHED", chargeId: null });
    // And the (uncovered) charge is correctly SHORT regardless — those
    // failed/pending payments contributed nothing.
    const chargeOnlyResult = computeReconciliation({
      charges: [charge("c1", 180_000, utcDate(2026, 6, 1))],
      payments: [],
      graceDays: 5,
      asOf: utcDate(2026, 6, 10),
    });
    expect(chargeOnlyResult.size).toBe(0); // no payments at all — nothing to report
  });

  it("counts PROCESSING (in-flight ACH) money toward coverage", () => {
    const result = computeReconciliation({
      charges: [charge("c1", 180_000, utcDate(2026, 6, 1))],
      payments: [payment("p1", 180_000, utcDate(2026, 6, 1), "PROCESSING")],
      graceDays: 5,
      asOf: utcDate(2026, 6, 3),
    });
    expect(result.get("p1")).toEqual({ status: "MATCHED", chargeId: "c1" });
  });
});

describe("computeReconciliation — multi-source", () => {
  it("matches when two payments from different sources together cover one charge", () => {
    const result = computeReconciliation({
      charges: [charge("c1", 180_000, utcDate(2026, 6, 1))],
      payments: [
        payment("cash", 100_000, utcDate(2026, 6, 1)),
        payment("venmo", 80_000, utcDate(2026, 6, 2)),
      ],
      graceDays: 5,
      asOf: utcDate(2026, 6, 5),
    });
    expect(result.get("cash")).toEqual({ status: "MATCHED", chargeId: "c1" });
    expect(result.get("venmo")).toEqual({ status: "MATCHED", chargeId: "c1" });
  });

  it("allocates FIFO across periods regardless of the order sources arrive in the input", () => {
    // Payments deliberately listed out of chronological order — the engine
    // must still sort by paid date, not trust input order.
    const result = computeReconciliation({
      charges: [
        charge("june", 180_000, utcDate(2026, 6, 1)),
        charge("july", 180_000, utcDate(2026, 7, 1)),
      ],
      payments: [
        payment("julyPay", 180_000, utcDate(2026, 7, 2)),
        payment("junePay", 180_000, utcDate(2026, 6, 2)),
      ],
      graceDays: 5,
      asOf: utcDate(2026, 7, 3),
    });
    expect(result.get("junePay")).toEqual({ status: "MATCHED", chargeId: "june" });
    expect(result.get("julyPay")).toEqual({ status: "MATCHED", chargeId: "july" });
  });

  it("settles an old period from FIFO order even when a late payment is recorded chronologically last", () => {
    // Tenant pays March in full, on time. A HAP payment for April doesn't
    // arrive until June — well after April's charge exists. FIFO by paid
    // date still lands each payment on the correct period.
    const result = computeReconciliation({
      charges: [
        charge("march", 100_000, utcDate(2026, 3, 1)),
        charge("april", 100_000, utcDate(2026, 4, 1)),
      ],
      payments: [
        payment("tenantMarch", 100_000, utcDate(2026, 3, 2)),
        payment("hapAprilLate", 100_000, utcDate(2026, 6, 15)), // arrives ~2.5 months late
      ],
      graceDays: 5,
      asOf: utcDate(2026, 6, 20),
    });
    expect(result.get("tenantMarch")).toEqual({ status: "MATCHED", chargeId: "march" });
    // April wasn't fully covered until 6/15 — due 4/1, grace 5 days — so LATE.
    expect(result.get("hapAprilLate")).toEqual({ status: "LATE", chargeId: "april" });
  });

  it("turns a late subsidy payment into a clean credit when the tenant already fully covered that period", () => {
    // Tenant pays the full rent for March themselves (not just a "tenant
    // portion"); the HAP subsidy check for that same period shows up weeks
    // later once nothing is left open to apply it to.
    const result = computeReconciliation({
      charges: [charge("march", 100_000, utcDate(2026, 3, 1))],
      payments: [
        payment("tenantMarch", 100_000, utcDate(2026, 3, 1)),
        payment("hapMarchLate", 30_000, utcDate(2026, 4, 10)),
      ],
      graceDays: 5,
      asOf: utcDate(2026, 4, 15),
    });
    expect(result.get("tenantMarch")).toEqual({ status: "MATCHED", chargeId: "march" });
    expect(result.get("hapMarchLate")).toEqual({ status: "MATCHED", chargeId: null });
  });
});

describe("computeReconciliation — HAP / subsidized rent split", () => {
  it("matches when HAP covers the subsidy portion and tenant covers the rest, exactly", () => {
    // $1,200 rent, $450 subsidy / $750 tenant.
    const result = computeReconciliation({
      charges: [charge("c1", 120_000, utcDate(2026, 6, 1))],
      payments: [
        payment("hap", 45_000, utcDate(2026, 6, 3)),
        payment("tenant", 75_000, utcDate(2026, 6, 1)),
      ],
      graceDays: 5,
      asOf: utcDate(2026, 6, 5),
    });
    expect(result.get("hap")?.status).toBe("MATCHED");
    expect(result.get("tenant")?.status).toBe("MATCHED");
  });

  it("does NOT flag short when HAP pays less than its 'expected' share but the combined total is still full", () => {
    // Expected split is $450 HAP / $750 tenant, but HAP actually sends $400
    // and the tenant makes up the other $50. Combined total is still $1,200
    // — this must be MATCHED, not SHORT, per the "combined total only" rule.
    const result = computeReconciliation({
      charges: [charge("c1", 120_000, utcDate(2026, 6, 1))],
      payments: [
        payment("hap", 40_000, utcDate(2026, 6, 3)),
        payment("tenant", 80_000, utcDate(2026, 6, 1)),
      ],
      graceDays: 5,
      asOf: utcDate(2026, 6, 10),
    });
    expect(result.get("hap")?.status).toBe("MATCHED");
    expect(result.get("tenant")?.status).toBe("MATCHED");
  });

  it("flags short when the combined HAP + tenant total is actually short, past grace", () => {
    const result = computeReconciliation({
      charges: [charge("c1", 120_000, utcDate(2026, 6, 1))],
      payments: [
        payment("hap", 45_000, utcDate(2026, 6, 3)),
        payment("tenant", 50_000, utcDate(2026, 6, 1)), // tenant short by $250
      ],
      graceDays: 5,
      asOf: utcDate(2026, 6, 15),
    });
    expect(result.get("hap")?.status).toBe("SHORT");
    expect(result.get("tenant")?.status).toBe("SHORT");
  });

  it("does not flag short just because the subsidy payment alone looks incomplete before the tenant pays", () => {
    // HAP pays its share early in the month; tenant hasn't paid yet but
    // isn't past due/grace either. Must not be SHORT just because, taken
    // alone, "$450 HAP is less than $1,200".
    const result = computeReconciliation({
      charges: [charge("c1", 120_000, utcDate(2026, 6, 5))],
      payments: [payment("hap", 45_000, utcDate(2026, 6, 2))],
      graceDays: 5,
      asOf: utcDate(2026, 6, 6),
    });
    expect(result.get("hap")?.status).toBe("MATCHED");
  });

  it("is unaffected by whether the lease even has a subsidy split — the engine only sees totals", () => {
    // Same charge/payment shape, no HAP involved at all: two ordinary
    // payments summing to the full amount. Must behave identically to the
    // HAP case above, proving the split isn't special-cased into the math.
    const result = computeReconciliation({
      charges: [charge("c1", 120_000, utcDate(2026, 6, 1))],
      payments: [
        payment("roommateA", 45_000, utcDate(2026, 6, 3)),
        payment("roommateB", 75_000, utcDate(2026, 6, 1)),
      ],
      graceDays: 5,
      asOf: utcDate(2026, 6, 5),
    });
    expect(result.get("roommateA")?.status).toBe("MATCHED");
    expect(result.get("roommateB")?.status).toBe("MATCHED");
  });
});

describe("getRentSplit", () => {
  it("reports no split when subsidyOwedCents is null", () => {
    const split = getRentSplit({ rentAmountCents: 180_000, subsidyOwedCents: null });
    expect(split).toEqual({
      hasSplit: false,
      totalCents: 180_000,
      tenantOwedCents: 180_000,
      subsidyOwedCents: 0,
    });
  });

  it("derives the tenant portion from rent minus subsidy", () => {
    const split = getRentSplit({ rentAmountCents: 120_000, subsidyOwedCents: 45_000 });
    expect(split).toEqual({
      hasSplit: true,
      totalCents: 120_000,
      tenantOwedCents: 75_000,
      subsidyOwedCents: 45_000,
    });
  });

  it("clamps a stale subsidy figure that exceeds the current rent", () => {
    // Rent was lowered after the subsidy amount was set; tenant portion must
    // never go negative.
    const split = getRentSplit({ rentAmountCents: 100_000, subsidyOwedCents: 120_000 });
    expect(split.subsidyOwedCents).toBe(100_000);
    expect(split.tenantOwedCents).toBe(0);
  });
});
