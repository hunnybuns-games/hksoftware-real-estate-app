import { describe, expect, it } from "vitest";
import { applyColumnMapping, guessColumnMapping } from "@/lib/import-mapping";
import { suggestLeaseMatch, type MatchableLease } from "@/lib/lease-matching";

describe("guessColumnMapping", () => {
  it("recognizes a typical bank export", () => {
    const mapping = guessColumnMapping(["Date", "Description", "Amount", "Balance"]);
    expect(mapping).toEqual({
      dateColumn: "Date",
      amountColumn: "Amount",
      descriptionColumn: "Description",
      payerColumn: null,
      refColumn: null,
    });
  });

  it("prefers a Credit column over Amount when both exist", () => {
    const mapping = guessColumnMapping(["Posted Date", "Debit", "Credit", "Description"]);
    expect(mapping.amountColumn).toBe("Credit");
  });

  it("never picks Debit as the amount column", () => {
    const mapping = guessColumnMapping(["Date", "Debit", "Description"]);
    expect(mapping.amountColumn).toBeNull();
  });

  it("recognizes a Venmo-style export with a payer column", () => {
    const mapping = guessColumnMapping(["Datetime", "Type", "From", "Amount (total)", "Note"]);
    expect(mapping.payerColumn).toBe("From");
    expect(mapping.dateColumn).toBe("Datetime");
  });

  it("returns nulls for columns it can't find", () => {
    const mapping = guessColumnMapping(["Foo", "Bar"]);
    expect(mapping).toEqual({
      dateColumn: null,
      amountColumn: null,
      descriptionColumn: null,
      payerColumn: null,
      refColumn: null,
    });
  });
});

describe("applyColumnMapping", () => {
  const headers = ["Date", "Amount", "Description", "Payer", "Ref"];
  const mapping = {
    dateColumn: "Date",
    amountColumn: "Amount",
    descriptionColumn: "Description",
    payerColumn: "Payer",
    refColumn: "Ref",
  };

  it("parses well-formed rows", () => {
    const [row] = applyColumnMapping(headers, [["2026-06-01", "1800", "Rent", "Jane Doe", "TX123"]], mapping);
    expect(row.amountCents).toBe(180_000);
    expect(row.date?.toISOString().slice(0, 10)).toBe("2026-06-01");
    expect(row.payerRaw).toBe("Jane Doe");
    expect(row.externalRef).toBe("TX123");
    expect(row.parseError).toBeNull();
  });

  it("parses US slash dates", () => {
    const [row] = applyColumnMapping(headers, [["6/1/2026", "1800", "Rent", "Jane", ""]], mapping);
    expect(row.date?.toISOString().slice(0, 10)).toBe("2026-06-01");
  });

  it("flags unparseable dates", () => {
    const [row] = applyColumnMapping(headers, [["not a date", "1800", "Rent", "Jane", ""]], mapping);
    expect(row.parseError).toMatch(/date/i);
  });

  it("flags negative amounts as not-incoming rather than importing them", () => {
    const [row] = applyColumnMapping(headers, [["2026-06-01", "-50", "ATM withdrawal", "", ""]], mapping);
    expect(row.parseError).toMatch(/negative/i);
  });

  it("flags zero amounts", () => {
    const [row] = applyColumnMapping(headers, [["2026-06-01", "0", "Memo only", "", ""]], mapping);
    expect(row.parseError).toMatch(/zero/i);
  });

  it("leaves externalRef null when no ref column is mapped", () => {
    const noRefMapping = { ...mapping, refColumn: null };
    const [row] = applyColumnMapping(headers, [["2026-06-01", "1800", "Rent", "Jane", "unused"]], noRefMapping);
    expect(row.externalRef).toBeNull();
  });
});

describe("suggestLeaseMatch", () => {
  const candidates: MatchableLease[] = [
    { leaseId: "l1", tenantFirstName: "Alicia", tenantLastName: "Fernandez", unitLabel: "1A", propertyName: "Cedar Court" },
    { leaseId: "l2", tenantFirstName: "Tom", tenantLastName: "Nakamura", unitLabel: "2B", propertyName: "Cedar Court" },
    { leaseId: "l3", tenantFirstName: "Grace", tenantLastName: "Obi", unitLabel: "3C", propertyName: "Vine Street Flats" },
  ];

  it("matches on the tenant's full name in a description", () => {
    const match = suggestLeaseMatch("VENMO PAYMENT FROM ALICIA FERNANDEZ", candidates);
    expect(match?.leaseId).toBe("l1");
  });

  it("matches on a partial name plus unit label", () => {
    const match = suggestLeaseMatch("Nakamura rent 2B", candidates);
    expect(match?.leaseId).toBe("l2");
  });

  it("returns null when nothing overlaps", () => {
    const match = suggestLeaseMatch("UNKNOWN TRANSFER XYZ123", candidates);
    expect(match).toBeNull();
  });

  it("returns null on a genuine tie rather than guessing", () => {
    const tied: MatchableLease[] = [
      { leaseId: "a", tenantFirstName: "Sam", tenantLastName: "Lee", unitLabel: "1", propertyName: "X" },
      { leaseId: "b", tenantFirstName: "Sam", tenantLastName: "Lee", unitLabel: "2", propertyName: "Y" },
    ];
    expect(suggestLeaseMatch("Sam Lee payment", tied)).toBeNull();
  });

  it("is case- and punctuation-insensitive", () => {
    const match = suggestLeaseMatch("grace-obi, rent for march!!", candidates);
    expect(match?.leaseId).toBe("l3");
  });

  it("returns null for empty text", () => {
    expect(suggestLeaseMatch("", candidates)).toBeNull();
  });
});
