import { describe, expect, it } from "vitest";
import {
  applicationStatusLabel,
  applicationStatusTone,
  canTransitionApplication,
  incomeToRentRatio,
  isApplicationDecided,
  meetsIncomeGuideline,
  nextStatusOptions,
} from "@/lib/applications";

describe("canTransitionApplication", () => {
  it("allows SUBMITTED straight to APPROVED — a landlord who already knows the applicant", () => {
    expect(canTransitionApplication("SUBMITTED", "APPROVED")).toBe(true);
  });

  it("allows the usual review path", () => {
    expect(canTransitionApplication("SUBMITTED", "UNDER_REVIEW")).toBe(true);
    expect(canTransitionApplication("UNDER_REVIEW", "APPROVED")).toBe(true);
    expect(canTransitionApplication("UNDER_REVIEW", "DENIED")).toBe(true);
  });

  it("allows reversing a decision before it becomes a lease", () => {
    expect(canTransitionApplication("APPROVED", "DENIED")).toBe(true);
    expect(canTransitionApplication("DENIED", "UNDER_REVIEW")).toBe(true);
  });

  it("treats a same-status save (notes only) as always allowed", () => {
    expect(canTransitionApplication("WITHDRAWN", "WITHDRAWN")).toBe(true);
    expect(canTransitionApplication("APPROVED", "APPROVED")).toBe(true);
  });

  it("refuses to resurrect a withdrawn application", () => {
    expect(canTransitionApplication("WITHDRAWN", "UNDER_REVIEW")).toBe(false);
    expect(canTransitionApplication("WITHDRAWN", "APPROVED")).toBe(false);
  });

  it("refuses to jump straight from DENIED to APPROVED — must pass through review", () => {
    expect(canTransitionApplication("DENIED", "APPROVED")).toBe(false);
  });
});

describe("nextStatusOptions", () => {
  it("always includes the current status, for a no-op save", () => {
    expect(nextStatusOptions("SUBMITTED")).toContain("SUBMITTED");
    expect(nextStatusOptions("WITHDRAWN")).toEqual(["WITHDRAWN"]);
  });

  it("matches what canTransitionApplication allows", () => {
    for (const to of nextStatusOptions("UNDER_REVIEW")) {
      expect(canTransitionApplication("UNDER_REVIEW", to)).toBe(true);
    }
  });
});

describe("isApplicationDecided", () => {
  it("is true for the three final statuses", () => {
    expect(isApplicationDecided("APPROVED")).toBe(true);
    expect(isApplicationDecided("DENIED")).toBe(true);
    expect(isApplicationDecided("WITHDRAWN")).toBe(true);
  });

  it("is false while still in progress", () => {
    expect(isApplicationDecided("SUBMITTED")).toBe(false);
    expect(isApplicationDecided("UNDER_REVIEW")).toBe(false);
  });
});

describe("applicationStatusLabel / applicationStatusTone", () => {
  it("has a label and tone for every status", () => {
    const statuses = ["SUBMITTED", "UNDER_REVIEW", "APPROVED", "DENIED", "WITHDRAWN"] as const;
    for (const status of statuses) {
      expect(applicationStatusLabel(status)).toBeTruthy();
      expect(applicationStatusTone(status)).toBeTruthy();
    }
  });
});

describe("incomeToRentRatio", () => {
  it("is null when income wasn't reported", () => {
    expect(incomeToRentRatio({ monthlyIncomeCents: null, rentAmountCents: 150_000 })).toBeNull();
  });

  it("divides income by rent", () => {
    expect(incomeToRentRatio({ monthlyIncomeCents: 450_000, rentAmountCents: 150_000 })).toBe(3);
  });

  it("is null against a zero or negative rent, rather than dividing by zero", () => {
    expect(incomeToRentRatio({ monthlyIncomeCents: 100_000, rentAmountCents: 0 })).toBeNull();
  });
});

describe("meetsIncomeGuideline", () => {
  it("is null (unknown) when no income was reported", () => {
    expect(meetsIncomeGuideline({ monthlyIncomeCents: null, rentAmountCents: 150_000 })).toBeNull();
  });

  it("passes at exactly 3x rent", () => {
    expect(
      meetsIncomeGuideline({ monthlyIncomeCents: 450_000, rentAmountCents: 150_000 }),
    ).toBe(true);
  });

  it("fails just under 3x rent", () => {
    expect(
      meetsIncomeGuideline({ monthlyIncomeCents: 449_999, rentAmountCents: 150_000 }),
    ).toBe(false);
  });

  it("honors a custom ratio", () => {
    expect(
      meetsIncomeGuideline({ monthlyIncomeCents: 300_000, rentAmountCents: 150_000, ratio: 2 }),
    ).toBe(true);
  });
});
