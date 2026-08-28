import { describe, expect, it } from "vitest";
import {
  guessPortfolioMapping,
  parsePortfolioRows,
  placeholderEmail,
  planImport,
  splitName,
  type ExistingPortfolio,
  type PortfolioMapping,
} from "@/lib/portfolio-import";

const EMPTY: ExistingPortfolio = { properties: [], units: [], tenants: [], activeLeases: [] };

function mappingFor(headers: string[]): PortfolioMapping {
  return guessPortfolioMapping(headers);
}

function parse(headers: string[], rows: string[][]) {
  return parsePortfolioRows(headers, rows, mappingFor(headers));
}

describe("guessPortfolioMapping", () => {
  it("maps a typical rent roll export", () => {
    const mapping = mappingFor([
      "Property Name",
      "Unit",
      "Tenant Name",
      "Email",
      "Phone",
      "Monthly Rent",
      "Security Deposit",
      "Lease Start",
      "Lease End",
    ]);

    expect(mapping.propertyName).toBe("Property Name");
    expect(mapping.unitLabel).toBe("Unit");
    expect(mapping.tenantName).toBe("Tenant Name");
    expect(mapping.tenantEmail).toBe("Email");
    expect(mapping.rentAmount).toBe("Monthly Rent");
    expect(mapping.depositAmount).toBe("Security Deposit");
    expect(mapping.leaseStart).toBe("Lease Start");
    expect(mapping.leaseEnd).toBe("Lease End");
  });

  it("never assigns one header to two fields", () => {
    // "Tenant Email" contains "tenant", so a greedy tenantName pass would
    // swallow it and leave names blank.
    const mapping = mappingFor(["Tenant Email", "Tenant", "Unit", "Rent"]);
    expect(mapping.tenantEmail).toBe("Tenant Email");
    expect(mapping.tenantName).toBe("Tenant");

    const headers = Object.values(mapping).filter((h): h is string => h !== null);
    expect(new Set(headers).size).toBe(headers.length);
  });

  it("prefers a specific deposit header over the generic rent one", () => {
    const mapping = mappingFor(["Rent", "Security Deposit"]);
    expect(mapping.rentAmount).toBe("Rent");
    expect(mapping.depositAmount).toBe("Security Deposit");
  });

  it("leaves unmatched fields null rather than guessing", () => {
    const mapping = mappingFor(["Unit", "Tenant Name"]);
    expect(mapping.leaseStart).toBeNull();
    expect(mapping.depositAmount).toBeNull();
  });
});

describe("splitName", () => {
  it.each([
    ["John Smith", "John", "Smith"],
    ["Smith, John", "John", "Smith"],
    ["  Smith ,  John  ", "John", "Smith"],
    ["Maria del Carmen Ruiz", "Maria del Carmen", "Ruiz"],
    ["Cher", "Cher", ""],
    ["", "", ""],
  ])("splits %s", (input, first, last) => {
    expect(splitName(input)).toEqual({ firstName: first, lastName: last });
  });
});

describe("placeholderEmail", () => {
  it("is deterministic, so re-importing matches instead of duplicating", () => {
    expect(placeholderEmail("Sunrise Ridge Apartments", "107")).toBe(
      placeholderEmail("Sunrise Ridge Apartments", "107"),
    );
  });

  it("uses the reserved .invalid TLD so it can never reach a real inbox", () => {
    expect(placeholderEmail("Sunrise Ridge", "107")).toMatch(/@no-email\.invalid$/);
  });

  it("distinguishes units within a property", () => {
    expect(placeholderEmail("Sunrise Ridge", "107")).not.toBe(placeholderEmail("Sunrise Ridge", "108"));
  });
});

describe("parsePortfolioRows", () => {
  const headers = ["Property", "Unit", "Tenant Name", "Email", "Monthly Rent", "Lease Start", "Lease End"];

  it("reads a clean row", () => {
    const [row] = parse(headers, [
      ["Sunrise Ridge", "107", "Caleb Nguyen", "caleb@example.com", "$1,800.00", "2026-04-01", "2027-04-01"],
    ]);

    expect(row.propertyName).toBe("Sunrise Ridge");
    expect(row.unitLabel).toBe("107");
    expect(row.firstName).toBe("Caleb");
    expect(row.lastName).toBe("Nguyen");
    expect(row.rentCents).toBe(180000);
    expect(row.leaseStart).toEqual(new Date(Date.UTC(2026, 3, 1)));
    expect(row.errors).toEqual([]);
  });

  it("accepts US slash dates as well as ISO", () => {
    const [row] = parse(headers, [
      ["Sunrise Ridge", "107", "A B", "a@b.com", "1800", "4/1/2026", "4/1/27"],
    ]);
    expect(row.leaseStart).toEqual(new Date(Date.UTC(2026, 3, 1)));
    expect(row.leaseEnd).toEqual(new Date(Date.UTC(2027, 3, 1)));
  });

  it("synthesizes an email and warns rather than blocking the row", () => {
    const [row] = parse(headers, [["Sunrise Ridge", "107", "Caleb Nguyen", "", "1800", "", ""]]);
    expect(row.emailSynthesized).toBe(true);
    expect(row.email).toMatch(/@no-email\.invalid$/);
    expect(row.errors).toEqual([]);
    expect(row.warnings.join(" ")).toMatch(/placeholder/i);
  });

  it("defaults a missing unit label to House, for single-family rows", () => {
    const [row] = parse(["Property", "Tenant Name", "Email"], [["12 Oak St", "A B", "a@b.com"]]);
    expect(row.unitLabel).toBe("House");
  });

  it("blocks a row with no property and no address", () => {
    const [row] = parse(headers, [["", "107", "Caleb Nguyen", "caleb@example.com", "1800", "", ""]]);
    expect(row.errors.join(" ")).toMatch(/property/i);
  });

  it("blocks a malformed email rather than importing it", () => {
    const [row] = parse(headers, [["Sunrise Ridge", "107", "A B", "not-an-email", "1800", "", ""]]);
    expect(row.errors.join(" ")).toMatch(/email/i);
  });

  it("blocks a lease that ends before it starts", () => {
    const [row] = parse(headers, [
      ["Sunrise Ridge", "107", "A B", "a@b.com", "1800", "2026-06-01", "2026-01-01"],
    ]);
    expect(row.errors.join(" ")).toMatch(/before the start/i);
  });

  it("warns but does not block when rent is missing", () => {
    const [row] = parse(headers, [["Sunrise Ridge", "107", "A B", "a@b.com", "", "", ""]]);
    expect(row.errors).toEqual([]);
    expect(row.rentCents).toBeNull();
    expect(row.warnings.join(" ")).toMatch(/rent/i);
  });
});

describe("planImport", () => {
  const headers = ["Property", "Unit", "Tenant Name", "Email", "Monthly Rent"];

  it("creates one property for a ten-row building, not ten", () => {
    const rows = parse(headers, [
      ["Sunrise Ridge", "101", "A One", "a@x.com", "1800"],
      ["Sunrise Ridge", "102", "B Two", "b@x.com", "1800"],
      ["Sunrise Ridge", "103", "C Three", "c@x.com", "1800"],
    ]);

    const plan = planImport(rows, EMPTY);
    expect(plan.summary.propertiesToCreate).toBe(1);
    expect(plan.summary.unitsToCreate).toBe(3);
    expect(plan.summary.tenantsToCreate).toBe(3);
    expect(plan.summary.leasesToCreate).toBe(3);
  });

  it("reuses an existing property and unit instead of duplicating them", () => {
    const rows = parse(headers, [["Sunrise Ridge", "107", "Caleb Nguyen", "caleb@x.com", "1800"]]);

    const plan = planImport(rows, {
      properties: [{ id: "prop1", name: "Sunrise Ridge" }],
      units: [{ id: "unit1", propertyId: "prop1", label: "107" }],
      tenants: [],
      activeLeases: [],
    });

    expect(plan.plans[0].property).toEqual({ action: "reuse", id: "prop1" });
    expect(plan.plans[0].unit).toEqual({ action: "reuse", id: "unit1" });
    expect(plan.summary.propertiesToCreate).toBe(0);
    expect(plan.summary.unitsToCreate).toBe(0);
  });

  it("matches an existing property case-insensitively", () => {
    const rows = parse(headers, [["SUNRISE RIDGE", "107", "A B", "a@x.com", "1800"]]);
    const plan = planImport(rows, {
      properties: [{ id: "prop1", name: "Sunrise Ridge" }],
      units: [],
      tenants: [],
      activeLeases: [],
    });
    expect(plan.plans[0].property).toEqual({ action: "reuse", id: "prop1" });
  });

  it("reuses a tenant matched by email", () => {
    const rows = parse(headers, [["Sunrise Ridge", "107", "Caleb Nguyen", "Caleb@X.com", "1800"]]);
    const plan = planImport(rows, {
      properties: [],
      units: [],
      tenants: [{ id: "t1", email: "caleb@x.com" }],
      activeLeases: [],
    });
    expect(plan.plans[0].tenant).toEqual({ action: "reuse", id: "t1" });
    expect(plan.summary.tenantsToCreate).toBe(0);
  });

  it("blocks a unit that already has an active lease", () => {
    const rows = parse(headers, [["Sunrise Ridge", "107", "Someone Else", "new@x.com", "1800"]]);
    const plan = planImport(rows, {
      properties: [{ id: "prop1", name: "Sunrise Ridge" }],
      units: [{ id: "unit1", propertyId: "prop1", label: "107" }],
      tenants: [],
      activeLeases: [{ unitId: "unit1", tenantId: "other" }],
    });

    expect(plan.plans[0].lease.action).toBe("conflict");
    expect(plan.plans[0].importable).toBe(false);
    expect(plan.summary.blocked).toBe(1);
    expect(plan.summary.leasesToCreate).toBe(0);
  });

  it("blocks the second of two rows claiming the same unit", () => {
    const rows = parse(headers, [
      ["Sunrise Ridge", "107", "A One", "a@x.com", "1800"],
      ["Sunrise Ridge", "107", "B Two", "b@x.com", "1800"],
    ]);
    const plan = planImport(rows, EMPTY);

    expect(plan.plans[0].importable).toBe(true);
    expect(plan.plans[1].importable).toBe(false);
    expect(plan.plans[1].lease.action).toBe("conflict");
    expect(plan.summary.leasesToCreate).toBe(1);
  });

  it("importing the same sheet twice is a no-op the second time", () => {
    const rows = parse(headers, [["Sunrise Ridge", "107", "Caleb Nguyen", "caleb@x.com", "1800"]]);

    // State as it would be after the first import succeeded.
    const plan = planImport(rows, {
      properties: [{ id: "prop1", name: "Sunrise Ridge" }],
      units: [{ id: "unit1", propertyId: "prop1", label: "107" }],
      tenants: [{ id: "t1", email: "caleb@x.com" }],
      activeLeases: [{ unitId: "unit1", tenantId: "t1" }],
    });

    expect(plan.summary.importable).toBe(0);
    expect(plan.summary.propertiesToCreate).toBe(0);
    expect(plan.summary.unitsToCreate).toBe(0);
    expect(plan.summary.tenantsToCreate).toBe(0);
    expect(plan.summary.leasesToCreate).toBe(0);
  });

  it("excludes blocked rows from the create counts", () => {
    // Row 2 has no property, so it cannot be imported and must not be counted.
    const rows = parse(headers, [
      ["Sunrise Ridge", "101", "A One", "a@x.com", "1800"],
      ["", "102", "B Two", "b@x.com", "1800"],
    ]);
    const plan = planImport(rows, EMPTY);

    expect(plan.summary.importable).toBe(1);
    expect(plan.summary.blocked).toBe(1);
    expect(plan.summary.unitsToCreate).toBe(1);
  });

  it("counts placeholder emails so the preview can warn about them", () => {
    const rows = parse(headers, [
      ["Sunrise Ridge", "101", "A One", "", "1800"],
      ["Sunrise Ridge", "102", "B Two", "b@x.com", "1800"],
    ]);
    expect(planImport(rows, EMPTY).summary.placeholderEmails).toBe(1);
  });
});
