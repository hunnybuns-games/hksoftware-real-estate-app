import { fromDateInputValue } from "@/lib/dates";
import { parseDollarsToCents } from "@/lib/money";

/**
 * Turning a rent roll into real records.
 *
 * The other importer in this app (src/lib/import-mapping.ts) reads a bank
 * statement into Payment rows — one flat kind of thing, already-happened
 * money. This one reads the spreadsheet a landlord is *migrating in on*: one
 * row per occupied unit, carrying a property, a unit, a tenant and a lease
 * all at once, which have to be created in dependency order and deduplicated
 * against whatever already exists.
 *
 * Everything here is pure. Nothing touches the database, and the plan is
 * computed from an explicit snapshot of what already exists (see
 * `planImport`), so every rule below is unit-testable — the same split
 * reconciliation.ts makes between computeReconciliation and
 * applyReconciliation, and for the same reason: this is the code that decides
 * whether a landlord ends up with 40 leases or 80.
 *
 * What it deliberately does not do: create Charge or Payment rows. Billing
 * history is generateRentCharges()'s job (src/lib/ledger.ts), which already
 * knows the rules — one charge per calendar month from the lease start,
 * capped so onboarding an old lease does not post five years of history.
 * Duplicating that here would give two answers to the same question. Import
 * the leases, then run rent.
 */

export const PORTFOLIO_COLUMNS = [
  "propertyName",
  "addressLine1",
  "city",
  "state",
  "postalCode",
  "unitLabel",
  "bedrooms",
  "bathrooms",
  "tenantName",
  "tenantEmail",
  "tenantPhone",
  "rentAmount",
  "depositAmount",
  "leaseStart",
  "leaseEnd",
] as const;

export type PortfolioColumn = (typeof PORTFOLIO_COLUMNS)[number];
export type PortfolioMapping = Record<PortfolioColumn, string | null>;

/**
 * Header spellings seen across Innago/Buildium/AppFolio/RentManager exports
 * and hand-kept spreadsheets. Ordered most- to least-specific: the first
 * exact match wins, and only then is a loose "contains" pass tried, so
 * "Property Address" cannot be claimed by the bare "address" candidate before
 * "property address" has had its chance.
 */
const CANDIDATES: Record<PortfolioColumn, string[]> = {
  propertyName: ["property name", "property", "building", "building name", "community"],
  addressLine1: ["address line 1", "street address", "property address", "address", "street"],
  city: ["city", "town"],
  state: ["state", "province", "st"],
  postalCode: ["postal code", "zip code", "zip", "postcode"],
  unitLabel: ["unit number", "unit label", "unit id", "unit", "apt", "apartment", "suite", "space"],
  bedrooms: ["bedrooms", "beds", "br", "bed"],
  bathrooms: ["bathrooms", "baths", "ba", "bath"],
  tenantName: ["tenant name", "resident name", "tenant", "resident", "name", "occupant"],
  tenantEmail: ["tenant email", "resident email", "email address", "email", "e-mail"],
  tenantPhone: ["tenant phone", "phone number", "phone", "mobile", "cell", "telephone"],
  rentAmount: ["monthly rent", "rent amount", "market rent", "lease rent", "rent"],
  depositAmount: ["security deposit", "deposit amount", "deposit"],
  leaseStart: ["lease start", "start date", "lease from", "move in", "move-in date", "begin date"],
  leaseEnd: ["lease end", "end date", "lease to", "expiration", "expires", "move out"],
};

function normalize(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Short candidates are matched exactly and never loosely. The two-letter
 * abbreviations real exports use — "st" for state, "ba" for bathrooms — are
 * substrings of half the English language: left in the loose pass, "st"
 * claims "Lease Start" and "ba" claims "Balance", and because a header can
 * only be taken once, the field that genuinely wanted that column is left
 * unmapped. Four characters is the shortest length that is meaningfully
 * distinctive here ("rent", "unit", "city", "beds").
 */
const MIN_LOOSE_MATCH = 4;

function findHeader(headers: string[], candidates: string[], taken: Set<string>): string | null {
  const normalized = headers.map(normalize);

  for (const candidate of candidates) {
    const idx = normalized.indexOf(candidate);
    if (idx !== -1 && !taken.has(headers[idx])) return headers[idx];
  }
  for (const candidate of candidates) {
    if (candidate.length < MIN_LOOSE_MATCH) continue;
    const idx = normalized.findIndex((h, i) => h.includes(candidate) && !taken.has(headers[i]));
    if (idx !== -1) return headers[idx];
  }
  return null;
}

/**
 * One header can only fill one role. Without that rule a sheet with both
 * "Rent" and "Market Rent" quietly maps the same column twice, and — worse —
 * a "Tenant Email" column gets claimed by `tenantName` first (it contains
 * "tenant"), leaving names blank and emails duplicated into the name field.
 * Fields are resolved in decreasing order of how distinctive their headers
 * are, so the specific ones claim their column before the greedy ones look.
 */
const RESOLUTION_ORDER: PortfolioColumn[] = [
  "tenantEmail",
  "tenantPhone",
  "propertyName",
  "addressLine1",
  "postalCode",
  "city",
  "state",
  "unitLabel",
  "bedrooms",
  "bathrooms",
  "depositAmount",
  "rentAmount",
  "leaseStart",
  "leaseEnd",
  "tenantName",
];

export function guessPortfolioMapping(headers: string[]): PortfolioMapping {
  const mapping = Object.fromEntries(PORTFOLIO_COLUMNS.map((c) => [c, null])) as PortfolioMapping;
  const taken = new Set<string>();

  for (const column of RESOLUTION_ORDER) {
    const header = findHeader(headers, CANDIDATES[column], taken);
    if (header) {
      mapping[column] = header;
      taken.add(header);
    }
  }
  return mapping;
}

// --- Row parsing -------------------------------------------------------------

export type ParsedPortfolioRow = {
  rowIndex: number;
  propertyName: string;
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
  unitLabel: string;
  bedrooms: number | null;
  bathrooms: number | null;
  firstName: string;
  lastName: string;
  email: string;
  /** True when `email` was synthesized because the sheet had none. */
  emailSynthesized: boolean;
  phone: string;
  rentCents: number | null;
  depositCents: number | null;
  leaseStart: Date | null;
  leaseEnd: Date | null;
  /** Blocking: the row cannot be imported at all. */
  errors: string[];
  /** Non-blocking: imported, but the landlord should know. */
  warnings: string[];
};

/**
 * Splits a single name column into first and last.
 *
 * Two conventions in the wild, and they disagree about which half comes
 * first: "Smith, John" and "John Smith". The comma is the tell. Anything
 * beyond two parts collapses into the first name ("Maria del Carmen Ruiz" →
 * first "Maria del Carmen", last "Ruiz") rather than being dropped, because
 * losing part of somebody's name is worse than an odd split.
 */
export function splitName(raw: string): { firstName: string; lastName: string } {
  const value = raw.trim().replace(/\s+/g, " ");
  if (!value) return { firstName: "", lastName: "" };

  if (value.includes(",")) {
    const [last, ...rest] = value.split(",");
    return { firstName: rest.join(" ").trim(), lastName: last.trim() };
  }

  const parts = value.split(" ");
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1] };
}

/**
 * A placeholder address for a tenant the sheet has no email for.
 *
 * Tenant.email is required and unique per organization, so a row without one
 * cannot simply be left blank — but refusing the row outright would make this
 * whole feature useless to any landlord whose spreadsheet predates collecting
 * email addresses, which is most of them.
 *
 * `.invalid` is reserved by RFC 2606 and can never resolve, so a placeholder
 * can never accidentally deliver mail to a real stranger — the failure mode
 * is a bounced send that gets logged, not a message to the wrong person. Made
 * deterministic from property and unit so re-importing the same sheet matches
 * the same tenant rather than creating a second one.
 */
export function placeholderEmail(propertyName: string, unitLabel: string): string {
  const slug = (value: string) =>
    value
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "unknown";
  return `${slug(unitLabel)}.${slug(propertyName)}@no-email.invalid`;
}

/** Accepts ISO, US slash, and US dash date shapes — same set the bank importer takes. */
export function parseImportDate(raw: string): Date | null {
  const value = raw.trim();
  if (!value) return null;

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(value);
  if (iso) {
    const [, y, m, d] = iso;
    return fromDateInputValue(`${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`);
  }

  const slash = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(value);
  if (slash) {
    const [, m, d, y] = slash;
    const year = y.length === 2 ? `20${y}` : y;
    return fromDateInputValue(`${year}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`);
  }

  return null;
}

function parseNumber(raw: string): number | null {
  const value = raw.trim();
  if (!value) return null;
  const n = Number(value.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function parsePortfolioRows(
  headers: string[],
  rows: string[][],
  mapping: PortfolioMapping,
): ParsedPortfolioRow[] {
  const indexOf = (column: PortfolioColumn) => {
    const header = mapping[column];
    return header ? headers.indexOf(header) : -1;
  };
  const columnIndex = Object.fromEntries(
    PORTFOLIO_COLUMNS.map((c) => [c, indexOf(c)]),
  ) as Record<PortfolioColumn, number>;

  const cell = (row: string[], column: PortfolioColumn): string => {
    const idx = columnIndex[column];
    return idx >= 0 ? (row[idx] ?? "").trim() : "";
  };

  return rows.map((row, rowIndex) => {
    const errors: string[] = [];
    const warnings: string[] = [];

    const propertyName = cell(row, "propertyName") || cell(row, "addressLine1");
    // A single-family house often has no unit column at all. Naming that unit
    // "House" matches what the app's own seed data does and keeps the
    // (property, label) uniqueness constraint satisfiable.
    const unitLabel = cell(row, "unitLabel") || "House";

    if (!propertyName) {
      errors.push("No property name or address — every unit has to belong to a property.");
    }

    const nameCell = cell(row, "tenantName");
    const { firstName, lastName } = splitName(nameCell);
    if (!nameCell) errors.push("No tenant name.");
    else if (!lastName) warnings.push(`Only one name part ("${nameCell}") — imported as a first name.`);

    let email = cell(row, "tenantEmail").toLowerCase();
    let emailSynthesized = false;
    if (!email) {
      email = placeholderEmail(propertyName || "property", unitLabel);
      emailSynthesized = true;
      warnings.push("No email — a placeholder was generated.");
    } else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      errors.push(`"${email}" does not look like an email address.`);
    }

    const rentRaw = cell(row, "rentAmount");
    const rentCents = rentRaw ? parseDollarsToCents(rentRaw) : null;
    if (rentRaw && rentCents === null) errors.push(`Could not read a rent amount from "${rentRaw}".`);
    if (!rentRaw) warnings.push("No rent amount — the lease will be created at $0.");

    const depositRaw = cell(row, "depositAmount");
    const depositCents = depositRaw ? parseDollarsToCents(depositRaw) : null;
    if (depositRaw && depositCents === null) {
      warnings.push(`Could not read a deposit from "${depositRaw}" — left blank.`);
    }

    const startRaw = cell(row, "leaseStart");
    const leaseStart = parseImportDate(startRaw);
    if (startRaw && !leaseStart) errors.push(`Could not read a lease start date from "${startRaw}".`);
    if (!startRaw) warnings.push("No lease start date — today will be used.");

    const endRaw = cell(row, "leaseEnd");
    const leaseEnd = parseImportDate(endRaw);
    if (endRaw && !leaseEnd) warnings.push(`Could not read a lease end date from "${endRaw}" — left open.`);
    if (leaseStart && leaseEnd && leaseEnd.getTime() < leaseStart.getTime()) {
      errors.push("Lease end date is before the start date.");
    }

    return {
      rowIndex,
      propertyName,
      addressLine1: cell(row, "addressLine1"),
      city: cell(row, "city"),
      state: cell(row, "state").toUpperCase().slice(0, 2),
      postalCode: cell(row, "postalCode"),
      unitLabel,
      bedrooms: parseNumber(cell(row, "bedrooms")),
      bathrooms: parseNumber(cell(row, "bathrooms")),
      firstName,
      lastName,
      email,
      emailSynthesized,
      phone: cell(row, "tenantPhone"),
      rentCents,
      depositCents,
      leaseStart,
      leaseEnd,
      errors,
      warnings,
    };
  });
}

// --- Planning ----------------------------------------------------------------

/** A snapshot of what the organization already has, so planning stays pure. */
export type ExistingPortfolio = {
  properties: { id: string; name: string }[];
  units: { id: string; propertyId: string; label: string }[];
  tenants: { id: string; email: string }[];
  /** Only leases that are still live — an ENDED lease should not block a new one. */
  activeLeases: { unitId: string; tenantId: string }[];
};

export type EntityPlan =
  | { action: "reuse"; id: string }
  | { action: "create" }
  /** Already exists and is already leased — importing again would duplicate it. */
  | { action: "conflict"; reason: string };

export type RowPlan = {
  rowIndex: number;
  row: ParsedPortfolioRow;
  property: EntityPlan;
  unit: EntityPlan;
  tenant: EntityPlan;
  lease: EntityPlan;
  /** False when the row cannot be imported — a parse error, or a live lease already there. */
  importable: boolean;
};

export type ImportPlan = {
  plans: RowPlan[];
  summary: {
    importable: number;
    blocked: number;
    propertiesToCreate: number;
    unitsToCreate: number;
    tenantsToCreate: number;
    leasesToCreate: number;
    placeholderEmails: number;
  };
};

function keyFor(propertyName: string): string {
  return propertyName.trim().toLowerCase();
}

/**
 * Works out, for every row, what would be created and what would be reused —
 * without writing anything. This is what the preview screen renders and what
 * the commit step then executes, so the two can never disagree about what an
 * import is going to do.
 *
 * Deduplicates within the batch as well as against the database: a rent roll
 * lists a 10-unit building on ten rows, and the property must be created once,
 * not ten times. That is what the two local maps below are for.
 */
export function planImport(rows: ParsedPortfolioRow[], existing: ExistingPortfolio): ImportPlan {
  const propertyByName = new Map(existing.properties.map((p) => [keyFor(p.name), p.id]));
  const unitByKey = new Map(existing.units.map((u) => [`${u.propertyId}|${u.label.toLowerCase()}`, u.id]));
  const tenantByEmail = new Map(existing.tenants.map((t) => [t.email.toLowerCase(), t.id]));
  const leasedUnitIds = new Set(existing.activeLeases.map((l) => l.unitId));

  // Created-so-far within this same batch, so row 2 reuses what row 1 planned.
  const plannedProperties = new Set<string>();
  const plannedUnits = new Set<string>();
  const plannedTenants = new Set<string>();

  const plans: RowPlan[] = rows.map((row) => {
    const propertyKey = keyFor(row.propertyName);
    const existingPropertyId = propertyByName.get(propertyKey);

    const property: EntityPlan = existingPropertyId
      ? { action: "reuse", id: existingPropertyId }
      : { action: "create" };
    if (!existingPropertyId) plannedProperties.add(propertyKey);

    // A unit can only be matched against the database when its property
    // already exists there; for a property being created in this same batch,
    // the batch-local set is the only thing that knows about it.
    const unitKey = existingPropertyId
      ? `${existingPropertyId}|${row.unitLabel.toLowerCase()}`
      : `${propertyKey}|${row.unitLabel.toLowerCase()}`;
    const existingUnitId = existingPropertyId ? unitByKey.get(unitKey) : undefined;

    const unit: EntityPlan = existingUnitId ? { action: "reuse", id: existingUnitId } : { action: "create" };
    const unitDuplicateInBatch = plannedUnits.has(unitKey);
    if (!existingUnitId) plannedUnits.add(unitKey);

    const existingTenantId = tenantByEmail.get(row.email);
    const tenant: EntityPlan = existingTenantId
      ? { action: "reuse", id: existingTenantId }
      : { action: "create" };
    if (!existingTenantId) plannedTenants.add(row.email);

    // The one genuine conflict: this unit already has a live lease. Importing
    // would double-lease it, so the row is blocked rather than merged — the
    // landlord has to decide whether the sheet or the app is right.
    let lease: EntityPlan = { action: "create" };
    if (existingUnitId && leasedUnitIds.has(existingUnitId)) {
      lease = { action: "conflict", reason: "That unit already has an active lease." };
    } else if (unitDuplicateInBatch) {
      lease = { action: "conflict", reason: "This spreadsheet lists the same unit more than once." };
    }

    const importable = row.errors.length === 0 && lease.action !== "conflict";

    return { rowIndex: row.rowIndex, row, property, unit, tenant, lease, importable };
  });

  // Counted over importable rows only — a blocked row creates nothing, and a
  // preview that promised otherwise would be lying about the outcome.
  const live = plans.filter((p) => p.importable);
  const distinct = (predicate: (p: RowPlan) => string | null) =>
    new Set(live.map(predicate).filter((v): v is string => v !== null)).size;

  return {
    plans,
    summary: {
      importable: live.length,
      blocked: plans.length - live.length,
      propertiesToCreate: distinct((p) =>
        p.property.action === "create" ? keyFor(p.row.propertyName) : null,
      ),
      unitsToCreate: distinct((p) =>
        p.unit.action === "create" ? `${keyFor(p.row.propertyName)}|${p.row.unitLabel.toLowerCase()}` : null,
      ),
      tenantsToCreate: distinct((p) => (p.tenant.action === "create" ? p.row.email : null)),
      leasesToCreate: live.length,
      placeholderEmails: live.filter((p) => p.row.emailSynthesized).length,
    },
  };
}
