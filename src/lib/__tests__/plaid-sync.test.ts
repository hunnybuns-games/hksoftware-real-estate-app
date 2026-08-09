import { describe, expect, it } from "vitest";
import {
  decideAddedTransaction,
  decideModifiedTransaction,
  isCandidateDeposit,
  matchText,
} from "@/lib/plaid-sync";
import type { PlaidTransaction } from "@/lib/plaid";
import type { MatchableLease } from "@/lib/lease-matching";

const candidates: MatchableLease[] = [
  {
    leaseId: "lease-fernandez",
    tenantFirstName: "Maria",
    tenantLastName: "Fernandez",
    unitLabel: "2B",
    propertyName: "Alder House",
  },
  {
    leaseId: "lease-okafor",
    tenantFirstName: "Sam",
    tenantLastName: "Okafor",
    unitLabel: "1A",
    propertyName: "Cedar Court",
  },
];

function deposit(overrides: Partial<PlaidTransaction> = {}): PlaidTransaction {
  return {
    transactionId: "tx-1",
    accountId: "acc-1",
    amountCents: 180000,
    date: "2026-08-01",
    name: "ACH CREDIT FERNANDEZ MARIA",
    merchantName: null,
    pending: false,
    ...overrides,
  };
}

describe("isCandidateDeposit", () => {
  it("is true for positive amounts (money in)", () => {
    expect(isCandidateDeposit(deposit({ amountCents: 1 }))).toBe(true);
  });

  it("is false for zero", () => {
    expect(isCandidateDeposit(deposit({ amountCents: 0 }))).toBe(false);
  });

  it("is false for negative amounts (money out)", () => {
    expect(isCandidateDeposit(deposit({ amountCents: -500 }))).toBe(false);
  });
});

describe("matchText", () => {
  it("combines merchant name and name when both are present", () => {
    expect(matchText(deposit({ name: "Zelle transfer", merchantName: "Sam Okafor" }))).toBe(
      "Sam Okafor Zelle transfer",
    );
  });

  it("falls back to just name when merchantName is null", () => {
    expect(matchText(deposit({ name: "ACH CREDIT OKAFOR", merchantName: null }))).toBe(" ACH CREDIT OKAFOR");
  });
});

describe("decideAddedTransaction", () => {
  it("creates a matched payment for an unambiguous deposit", () => {
    const t = deposit({ name: "ACH CREDIT FERNANDEZ MARIA" });
    const decision = decideAddedTransaction(t, false, candidates);
    expect(decision).toEqual({ action: "create", leaseId: "lease-fernandez" });
  });

  it("creates an unmatched payment when the text doesn't identify a lease", () => {
    const t = deposit({ name: "MOBILE DEPOSIT" });
    const decision = decideAddedTransaction(t, false, candidates);
    expect(decision).toEqual({ action: "create", leaseId: null });
  });

  it("skips a debit outright — never creates a payment for money leaving the account", () => {
    const t = deposit({ amountCents: -18000, name: "CONTRACTOR PAYMENT" });
    const decision = decideAddedTransaction(t, false, candidates);
    expect(decision).toEqual({ action: "skip" });
  });

  it("skips a zero-amount transaction", () => {
    const t = deposit({ amountCents: 0 });
    const decision = decideAddedTransaction(t, false, candidates);
    expect(decision).toEqual({ action: "skip" });
  });

  it("skips a transaction already synced, even if it would otherwise match — idempotency", () => {
    const t = deposit({ name: "ACH CREDIT FERNANDEZ MARIA" });
    const decision = decideAddedTransaction(t, true, candidates);
    expect(decision).toEqual({ action: "skip" });
  });
});

describe("decideModifiedTransaction", () => {
  it("updates an existing payment's fields but keeps its current lease assignment", () => {
    const t = deposit({ amountCents: 190000, name: "ACH CREDIT FERNANDEZ MARIA" });
    const decision = decideModifiedTransaction(t, { id: "pay-1", leaseId: "lease-okafor" }, candidates);
    // lease-okafor, not lease-fernandez the text would suggest — a human or
    // an earlier sync may have already corrected this; modifying amount must
    // never silently re-run the matcher and flip it back.
    expect(decision).toEqual({ action: "update", leaseId: "lease-okafor" });
  });

  it("updates an existing unmatched payment, staying unmatched", () => {
    const t = deposit({ amountCents: 190000 });
    const decision = decideModifiedTransaction(t, { id: "pay-1", leaseId: null }, candidates);
    expect(decision).toEqual({ action: "update", leaseId: null });
  });

  it("treats a never-stored, now-a-deposit transaction as a fresh add", () => {
    const t = deposit({ name: "ACH CREDIT FERNANDEZ MARIA" });
    const decision = decideModifiedTransaction(t, null, candidates);
    expect(decision).toEqual({ action: "create", leaseId: "lease-fernandez" });
  });

  it("skips a never-stored transaction that's still not a deposit", () => {
    const t = deposit({ amountCents: -5000 });
    const decision = decideModifiedTransaction(t, null, candidates);
    expect(decision).toEqual({ action: "skip" });
  });

  it("deletes a stored payment corrected into a debit", () => {
    const t = deposit({ amountCents: -5000 });
    const decision = decideModifiedTransaction(t, { id: "pay-1", leaseId: "lease-fernandez" }, candidates);
    expect(decision).toEqual({ action: "delete", leaseId: "lease-fernandez" });
  });
});
