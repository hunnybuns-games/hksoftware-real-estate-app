"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertStaff, AuthorizationError, NotFoundError } from "@/lib/rbac";
import { type ActionState, actionError, actionOk, parseForm, runAction } from "@/lib/forms";
import { MAX_IMPORT_CSV_BYTES, MAX_IMPORT_ROWS } from "@/lib/constants";
import { parseCsvWithHeader } from "@/lib/csv";
import { detectFile } from "@/lib/file-signature";
import {
  PORTFOLIO_COLUMNS,
  guessPortfolioMapping,
  parsePortfolioRows,
  planImport,
  type ExistingPortfolio,
  type PortfolioMapping,
  type RowPlan,
} from "@/lib/portfolio-import";

/**
 * Bringing a landlord's existing portfolio in from a rent roll.
 *
 * Three steps, the same shape as the payment importer in ./import.ts — upload,
 * correct the column mapping, confirm — because they are the same problem and
 * a second shape would be gratuitous. The differences are all downstream of
 * what gets created:
 *
 *  - The preview is a *plan*, not just parsed rows. It has to say which
 *    property will be created versus reused, which unit already has a live
 *    lease, and which rows are duplicates of each other, because confirming
 *    creates four kinds of record with dependencies between them.
 *  - Nothing is created until confirm, and confirm re-plans from scratch
 *    against current data rather than trusting the preview. Between the two
 *    steps someone else may have added the very property this import was
 *    about to create.
 *
 * Charges and payments are deliberately out of scope — see the note at the
 * top of src/lib/portfolio-import.ts.
 */

export async function uploadPortfolioAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let batchId: string | null = null;

  const state = await runAction(async () => {
    const ctx = await assertStaff();

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return actionError("Please fix the highlighted fields.", { file: "Choose a CSV file." });
    }
    if (file.size > MAX_IMPORT_CSV_BYTES) {
      return actionError("Please fix the highlighted fields.", {
        file: `That file is larger than ${Math.round(MAX_IMPORT_CSV_BYTES / 1024 / 1024)} MB.`,
      });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const detected = detectFile(bytes, file.name);

    // Spreadsheets are the obvious thing to hand this, and an .xlsx dropped
    // here should say so plainly rather than failing as "no header row
    // found". Reading XLSX means unzipping and parsing sheet XML; until that
    // exists, exporting to CSV is one click in Excel or Sheets.
    if (
      detected.contentType.includes("spreadsheetml") ||
      detected.contentType === "application/vnd.ms-excel"
    ) {
      return actionError("Please fix the highlighted fields.", {
        file: "Excel files are not readable here yet — open it and use File → Save As → CSV, then upload that.",
      });
    }

    const text = new TextDecoder().decode(bytes);
    const contentHash = createHash("sha256").update(text).digest("hex");

    const existing = await db.portfolioImportBatch.findUnique({
      where: { organizationId_contentHash: { organizationId: ctx.organizationId, contentHash } },
      select: { id: true, status: true },
    });
    // Unlike a bank statement, re-importing the same rent roll is not
    // inherently destructive — the planner reuses everything it already
    // matched. So a repeat upload reopens the existing batch instead of being
    // refused outright, which is also what someone who abandoned a review
    // halfway through actually wants.
    if (existing) {
      batchId = existing.id;
      return actionOk();
    }

    const { headers, rows } = parseCsvWithHeader(text);
    if (headers.length === 0) {
      return actionError("Please fix the highlighted fields.", {
        file: "That file does not look like a CSV — no header row was found.",
      });
    }
    if (rows.length === 0) {
      return actionError("Please fix the highlighted fields.", {
        file: "That file has a header row but no data rows.",
      });
    }
    if (rows.length > MAX_IMPORT_ROWS) {
      return actionError("Please fix the highlighted fields.", {
        file: `That file has ${rows.length.toLocaleString()} rows — the limit is ${MAX_IMPORT_ROWS.toLocaleString()}. Split it and import in parts.`,
      });
    }

    const batch = await db.portfolioImportBatch.create({
      data: {
        organizationId: ctx.organizationId,
        filename: file.name.slice(0, 200) || "rent-roll.csv",
        uploadedById: ctx.id,
        rawCsv: text,
        columnMapping: guessPortfolioMapping(headers),
        rowCount: rows.length,
        contentHash,
      },
      select: { id: true },
    });

    batchId = batch.id;
    revalidatePath("/app/import");
    return actionOk();
  });

  if (batchId) redirect(`/app/import/${batchId}`);
  return state;
}

const mappingSchema = z.object(
  Object.fromEntries(PORTFOLIO_COLUMNS.map((c) => [c, z.string()])) as Record<
    (typeof PORTFOLIO_COLUMNS)[number],
    z.ZodString
  >,
);

export async function updatePortfolioMappingAction(
  batchId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await assertStaff();
    const parsed = parseForm(mappingSchema, formData);
    if (!parsed.ok) return parsed.state;

    const batch = await getDraftBatch(batchId, ctx.organizationId);

    // The selects submit "" for "not mapped" — normalize that to null so the
    // parser can tell "no column chosen" from "a column named empty string".
    const mapping = Object.fromEntries(
      PORTFOLIO_COLUMNS.map((c) => [c, parsed.data[c] === "" ? null : parsed.data[c]]),
    ) as PortfolioMapping;

    await db.portfolioImportBatch.update({
      where: { id: batch.id },
      data: { columnMapping: mapping },
    });

    revalidatePath(`/app/import/${batchId}`);
    return actionOk("Mapping updated.");
  });
}

export async function confirmPortfolioImportAction(
  batchId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await assertStaff();
    const batch = await getDraftBatch(batchId, ctx.organizationId);

    const { headers, rows } = parseCsvWithHeader(batch.rawCsv);
    const mapping = batch.columnMapping as unknown as PortfolioMapping;
    const parsedRows = parsePortfolioRows(headers, rows, mapping);

    // Ticked means "import this" — the checkbox matches its column header
    // rather than inverting it. An unticked box submits nothing at all, and
    // so does a disabled one, which is how blocked rows exclude themselves.
    const included = new Set(
      parsedRows
        .filter((r) => formData.get(`include_${r.rowIndex}`) === "on")
        .map((r) => r.rowIndex),
    );

    // Re-planned here against current data rather than trusting whatever the
    // review screen was rendered from: between preview and confirm, another
    // admin may have created the property this batch was about to create, or
    // leased one of its units.
    const existing = await loadExistingPortfolio(ctx.organizationId);
    const { plans } = planImport(parsedRows, existing);

    const toImport = plans.filter((p) => p.importable && included.has(p.rowIndex));
    if (toImport.length === 0) {
      return actionError("Nothing to import — every row was skipped or blocked.");
    }

    const created = await applyPlans(ctx.organizationId, toImport);

    await db.portfolioImportBatch.update({
      where: { id: batch.id },
      data: {
        status: "CONFIRMED",
        propertiesCreated: created.properties,
        unitsCreated: created.units,
        tenantsCreated: created.tenants,
        leasesCreated: created.leases,
      },
    });

    revalidatePath("/app/import");
    revalidatePath("/app/properties");
    revalidatePath("/app/tenants");
    revalidatePath("/app/leases");
    revalidatePath("/app");

    return actionOk(
      `Imported ${created.leases} ${created.leases === 1 ? "lease" : "leases"} — ` +
        `${created.properties} properties, ${created.units} units and ${created.tenants} tenants created. ` +
        "Post rent charges to generate their billing history.",
    );
  });
}

/**
 * Creates records in dependency order, reusing anything the plan matched.
 *
 * Sequential rather than batched, unlike the payment importer's createMany:
 * each row's unit needs its property's id and each lease needs both, so the
 * writes genuinely depend on one another. Bounded by MAX_IMPORT_ROWS, and a
 * migration is a once-per-landlord operation, so the round trips are
 * affordable in a way they would not be on a nightly job.
 */
async function applyPlans(
  organizationId: string,
  plans: RowPlan[],
): Promise<{ properties: number; units: number; tenants: number; leases: number }> {
  const created = { properties: 0, units: 0, tenants: 0, leases: 0 };

  // Ids resolved during this run, so later rows reuse what earlier ones made.
  const propertyIds = new Map<string, string>();
  const unitIds = new Map<string, string>();
  const tenantIds = new Map<string, string>();

  for (const plan of plans) {
    const row = plan.row;
    const propertyKey = row.propertyName.trim().toLowerCase();

    let propertyId = plan.property.action === "reuse" ? plan.property.id : propertyIds.get(propertyKey);
    if (!propertyId) {
      const property = await db.property.create({
        data: {
          organizationId,
          name: row.propertyName,
          addressLine1: row.addressLine1 || row.propertyName,
          city: row.city,
          state: row.state,
          postalCode: row.postalCode,
        },
        select: { id: true },
      });
      propertyId = property.id;
      created.properties += 1;
    }
    propertyIds.set(propertyKey, propertyId);

    const unitKey = `${propertyId}|${row.unitLabel.toLowerCase()}`;
    let unitId = plan.unit.action === "reuse" ? plan.unit.id : unitIds.get(unitKey);
    if (!unitId) {
      const unit = await db.unit.create({
        data: {
          propertyId,
          label: row.unitLabel,
          bedrooms: row.bedrooms ?? 1,
          bathrooms: row.bathrooms ?? 1,
          marketRentCents: row.rentCents ?? 0,
          status: "OCCUPIED",
        },
        select: { id: true },
      });
      unitId = unit.id;
      created.units += 1;
    } else {
      // A reused unit is being leased by this import, so its status has to
      // follow — otherwise the dashboard reports a vacancy that is not one.
      await db.unit.update({ where: { id: unitId }, data: { status: "OCCUPIED" } });
    }
    unitIds.set(unitKey, unitId);

    let tenantId = plan.tenant.action === "reuse" ? plan.tenant.id : tenantIds.get(row.email);
    if (!tenantId) {
      const tenant = await db.tenant.create({
        data: {
          organizationId,
          firstName: row.firstName || row.lastName || "Unknown",
          lastName: row.lastName,
          email: row.email,
          phone: row.phone || null,
        },
        select: { id: true },
      });
      tenantId = tenant.id;
      created.tenants += 1;
    }
    tenantIds.set(row.email, tenantId);

    await db.lease.create({
      data: {
        organizationId,
        unitId,
        tenantId,
        status: "ACTIVE",
        startDate: row.leaseStart ?? new Date(),
        endDate: row.leaseEnd,
        rentAmountCents: row.rentCents ?? 0,
        depositCents: row.depositCents ?? 0,
        // Not in any rent roll this has seen, and the 1st is what the
        // overwhelming majority of leases actually use. Editable per lease
        // afterwards.
        rentDueDay: 1,
      },
    });
    created.leases += 1;
  }

  return created;
}

export async function loadExistingPortfolio(organizationId: string): Promise<ExistingPortfolio> {
  const [properties, units, tenants, activeLeases] = await Promise.all([
    db.property.findMany({ where: { organizationId }, select: { id: true, name: true } }),
    db.unit.findMany({
      where: { property: { organizationId } },
      select: { id: true, propertyId: true, label: true },
    }),
    db.tenant.findMany({ where: { organizationId }, select: { id: true, email: true } }),
    db.lease.findMany({
      where: { organizationId, status: "ACTIVE" },
      select: { unitId: true, tenantId: true },
    }),
  ]);
  return { properties, units, tenants, activeLeases };
}

export async function deletePortfolioBatchAction(
  batchId: string,
  _prev: ActionState,
): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await assertStaff();
    const batch = await db.portfolioImportBatch.findFirst({
      where: { id: batchId, organizationId: ctx.organizationId },
      select: { id: true, status: true },
    });
    if (!batch) return actionOk();
    if (batch.status === "CONFIRMED") {
      // The records it created stay regardless — see the note on the model in
      // schema.prisma. Keeping the row is what preserves the audit trail.
      return actionError("A confirmed import is part of the record and cannot be discarded.");
    }

    await db.portfolioImportBatch.delete({ where: { id: batch.id } });
    revalidatePath("/app/import");
    return actionOk("Import discarded.");
  });
}

async function getDraftBatch(batchId: string, organizationId: string) {
  const batch = await db.portfolioImportBatch.findFirst({
    where: { id: batchId, organizationId },
  });
  if (!batch) throw new NotFoundError("That import no longer exists.");
  if (batch.status !== "DRAFT") {
    throw new AuthorizationError("This import has already been confirmed and cannot be changed.");
  }
  return batch;
}
