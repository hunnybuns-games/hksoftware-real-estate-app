import { describe, expect, it } from "vitest";
import {
  DEFAULT_TEMPLATE_BODY,
  LEASE_CLAUSES,
  defaultSelectedClauseIds,
  leaseDocumentStatusLabel,
  leaseDocumentStatusTone,
  mergeTokens,
  renderLeaseDocument,
  type LeaseForDocument,
} from "@/lib/lease-document";
import { utcDate } from "@/lib/dates";

const lease: LeaseForDocument = {
  rentAmountCents: 185000,
  depositCents: 185000,
  startDate: utcDate(2026, 9, 1),
  endDate: utcDate(2027, 8, 31),
  rentDueDay: 1,
  tenant: { firstName: "Jordan", lastName: "Reyes", email: "jordan@example.com" },
  unit: {
    label: "2B",
    property: {
      name: "Maple Court",
      addressLine1: "123 Maple St",
      addressLine2: null,
      city: "Springfield",
      state: "IL",
      postalCode: "62704",
    },
  },
  organization: { name: "Hunny Buns Rentals", graceDays: 5, lateFeeCents: 5000 },
};

describe("mergeTokens", () => {
  it("substitutes every occurrence of a known token", () => {
    expect(mergeTokens("Hi {{name}}, welcome {{name}}.", { name: "Sam" })).toBe(
      "Hi Sam, welcome Sam.",
    );
  });

  it("leaves an unrecognized token in place rather than dropping it", () => {
    expect(mergeTokens("Value: {{missing}}", {})).toBe("Value: {{missing}}");
  });
});

describe("renderLeaseDocument", () => {
  it("fills in party, property, and money details", () => {
    const body = renderLeaseDocument({
      templateBody: DEFAULT_TEMPLATE_BODY,
      lease,
      selectedClauseIds: [],
    });
    expect(body).toContain("Hunny Buns Rentals");
    expect(body).toContain("Jordan Reyes");
    expect(body).toContain("123 Maple St, Springfield, IL 62704");
    expect(body).toContain("Unit: 2B");
    expect(body).toContain("$1,850.00");
    expect(body).toContain("and ends on");
  });

  it("describes an open-ended lease as month-to-month", () => {
    const body = renderLeaseDocument({
      templateBody: DEFAULT_TEMPLATE_BODY,
      lease: { ...lease, endDate: null },
      selectedClauseIds: [],
    });
    expect(body).toContain("month-to-month basis");
  });

  it("includes only the selected clauses, in catalog order", () => {
    const body = renderLeaseDocument({
      templateBody: DEFAULT_TEMPLATE_BODY,
      lease,
      selectedClauseIds: ["smoking", "pets"],
    });
    expect(body).toContain("PETS");
    expect(body).toContain("SMOKE-FREE PROPERTY");
    expect(body).not.toContain("PARKING");
    // Catalog order (pets before smoking), not selection order.
    expect(body.indexOf("PETS")).toBeLessThan(body.indexOf("SMOKE-FREE PROPERTY"));
  });

  it("ignores a stale/unknown clause id instead of erroring", () => {
    const body = renderLeaseDocument({
      templateBody: DEFAULT_TEMPLATE_BODY,
      lease,
      selectedClauseIds: ["pets", "not-a-real-clause"],
    });
    expect(body).toContain("PETS");
  });

  it("merges tokens inside clause bodies, not just the outer template", () => {
    const body = renderLeaseDocument({
      templateBody: DEFAULT_TEMPLATE_BODY,
      lease,
      selectedClauseIds: ["late_fee", "governing_law"],
    });
    expect(body).toContain("5 day(s)");
    expect(body).toContain("$50.00");
    expect(body).toContain("State of IL");
  });

  it("appends free-text extra terms after the selected clauses", () => {
    const body = renderLeaseDocument({
      templateBody: DEFAULT_TEMPLATE_BODY,
      lease,
      selectedClauseIds: ["pets"],
      extraTerms: "Tenant may keep one goldfish.",
    });
    expect(body).toContain("ADDITIONAL TERMS");
    expect(body).toContain("Tenant may keep one goldfish.");
    expect(body.indexOf("PETS")).toBeLessThan(body.indexOf("ADDITIONAL TERMS"));
  });

  it("says 'None.' when no clauses and no extra terms are selected", () => {
    const body = renderLeaseDocument({
      templateBody: DEFAULT_TEMPLATE_BODY,
      lease,
      selectedClauseIds: [],
    });
    expect(body).toContain("None.");
  });

  it("is idempotent about whitespace at the edges", () => {
    const body = renderLeaseDocument({
      templateBody: DEFAULT_TEMPLATE_BODY,
      lease,
      selectedClauseIds: [],
    });
    expect(body).toBe(body.trim());
  });
});

describe("defaultSelectedClauseIds", () => {
  it("matches the clauses flagged defaultOn in the catalog", () => {
    const expected = LEASE_CLAUSES.filter((c) => c.defaultOn).map((c) => c.id);
    expect(defaultSelectedClauseIds()).toEqual(expected);
  });
});

describe("lease document status display", () => {
  it("labels and tones every status", () => {
    expect(leaseDocumentStatusLabel("DRAFT")).toBe("Draft");
    expect(leaseDocumentStatusTone("SENT")).toBe("amber");
    expect(leaseDocumentStatusLabel("SIGNED")).toBe("Signed");
    expect(leaseDocumentStatusTone("VOIDED")).toBe("red");
  });
});
