import { describe, expect, it } from "vitest";
import { guessDocumentCategory, suggestFiling, type FilingCandidates } from "@/lib/document-filing";

const CANDIDATES: FilingCandidates = {
  leases: [
    {
      leaseId: "lease-caleb",
      tenantFirstName: "Caleb",
      tenantLastName: "Nguyen",
      unitLabel: "107",
      propertyName: "Sunrise Ridge Apartments",
    },
    {
      leaseId: "lease-harper",
      tenantFirstName: "Harper",
      tenantLastName: "Diaz",
      unitLabel: "108",
      propertyName: "Sunrise Ridge Apartments",
    },
  ],
  properties: [
    { propertyId: "prop-sunrise", name: "Sunrise Ridge Apartments" },
    { propertyId: "prop-cedar", name: "Cedar Court Duplex" },
  ],
};

describe("guessDocumentCategory", () => {
  it.each([
    ["Signed Lease Agreement 2026.pdf", "LEASE"],
    ["certificate-of-insurance.pdf", "INSURANCE"],
    ["W-9 Jordan Reyes.pdf", "TAX"],
    ["unit107_move_out_inspection.pdf", "INSPECTION"],
    ["plumbing invoice 4471.pdf", "RECEIPT"],
    ["notice to vacate - 105.pdf", "NOTICE"],
    ["2026 rent roll.xlsx", "STATEMENT"],
    ["drivers license scan.jpg", "IDENTIFICATION"],
  ])("reads %s as %s", (filename, expected) => {
    expect(guessDocumentCategory(filename, "pdf")).toBe(expected);
  });

  it("prefers the more specific multi-word phrase over a bare keyword", () => {
    // "policy" alone is weak; "certificate of insurance" is decisive.
    expect(guessDocumentCategory("insurance policy.pdf", "pdf")).toBe("INSURANCE");
  });

  it("refuses to guess when two categories tie", () => {
    // "lease application" is genuinely both — a wrong silent pick would file
    // an applicant's paperwork under a signed lease.
    expect(guessDocumentCategory("lease application.pdf", "pdf")).toBe("OTHER");
  });

  it("falls back on the file family when no keyword matches", () => {
    expect(guessDocumentCategory("IMG_4471.jpg", "image")).toBe("PHOTO");
    expect(guessDocumentCategory("book1.xlsx", "spreadsheet")).toBe("STATEMENT");
    expect(guessDocumentCategory("scan0001.pdf", "pdf")).toBe("OTHER");
  });

  it("ignores the extension as a content signal", () => {
    // ".lease" as an extension must not make this a LEASE.
    expect(guessDocumentCategory("scan0001.lease", "pdf")).toBe("OTHER");
  });
});

describe("suggestFiling", () => {
  it("matches a lease by tenant surname", () => {
    const result = suggestFiling("Nguyen signed lease.pdf", "pdf", CANDIDATES);
    expect(result.leaseId).toBe("lease-caleb");
    expect(result.category).toBe("LEASE");
  });

  it("matches a lease by unit label", () => {
    const result = suggestFiling("unit 108 move out inspection.pdf", "pdf", CANDIDATES);
    expect(result.leaseId).toBe("lease-harper");
    expect(result.category).toBe("INSPECTION");
  });

  it("falls back to a property when no single lease is identifiable", () => {
    // Names the property but no tenant or unit — every lease there scores the
    // same on the property name, so the lease matcher rejects it as a tie and
    // this files at the property instead.
    const result = suggestFiling("Cedar Court Duplex property tax bill.pdf", "pdf", CANDIDATES);
    expect(result.leaseId).toBeNull();
    expect(result.propertyId).toBe("prop-cedar");
    expect(result.category).toBe("TAX");
  });

  it("leaves an unidentifiable file entirely unfiled", () => {
    const result = suggestFiling("scan0001.pdf", "pdf", CANDIDATES);
    expect(result.leaseId).toBeNull();
    expect(result.propertyId).toBeNull();
    expect(result.category).toBe("OTHER");
  });

  it("does not guess a lease when two tenants match equally well", () => {
    const result = suggestFiling("Sunrise Ridge Apartments lease.pdf", "pdf", CANDIDATES);
    expect(result.leaseId).toBeNull();
  });
});
