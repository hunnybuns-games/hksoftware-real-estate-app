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
import { applyColumnMapping, guessColumnMapping, type ColumnMapping } from "@/lib/import-mapping";
import { applyReconciliation } from "@/lib/reconciliation";

const IMPORT_SOURCES = ["IMPORT_BANK", "IMPORT_VENMO", "IMPORT_CASHAPP", "IMPORT_HAP"] as const;

const uploadSchema = z.object({
  source: z.enum(IMPORT_SOURCES),
});

/**
 * Step 1: upload a statement. Parses just the header row here (full parsing
 * happens on every render of the review page, driven by the batch's current
 * column mapping) and stores the raw text so re-mapping never needs a
 * re-upload.
 */
export async function uploadImportAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let batchId: string | null = null;

  const state = await runAction(async () => {
    const ctx = await assertStaff();
    const parsed = parseForm(uploadSchema, formData);
    if (!parsed.ok) return parsed.state;

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return actionError("Please fix the highlighted fields.", { file: "Choose a CSV file." });
    }
    if (file.size > MAX_IMPORT_CSV_BYTES) {
      return actionError("Please fix the highlighted fields.", {
        file: `That file is larger than ${Math.round(MAX_IMPORT_CSV_BYTES / 1024 / 1024)} MB.`,
      });
    }

    const text = await file.text();
    const contentHash = createHash("sha256").update(text).digest("hex");

    const existing = await db.paymentImportBatch.findUnique({
      where: { organizationId_contentHash: { organizationId: ctx.organizationId, contentHash } },
      select: { id: true, filename: true, createdAt: true },
    });
    if (existing) {
      return actionError(
        `This exact file was already imported as "${existing.filename}" on ${existing.createdAt.toISOString().slice(0, 10)}. Re-uploading the same statement would double-count every payment in it.`,
      );
    }

    const { headers, rows } = parseCsvWithHeader(text);
    if (headers.length === 0) {
      return actionError("Please fix the highlighted fields.", {
        file: "That file doesn't look like a CSV — no header row was found.",
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

    const mapping = guessColumnMapping(headers);

    const batch = await db.paymentImportBatch.create({
      data: {
        organizationId: ctx.organizationId,
        source: parsed.data.source,
        filename: file.name.slice(0, 200) || "statement.csv",
        uploadedById: ctx.id,
        rawCsv: text,
        columnMapping: mapping,
        rowCount: rows.length,
        contentHash,
      },
      select: { id: true },
    });

    batchId = batch.id;
    revalidatePath("/app/payments/import");
    return actionOk();
  });

  if (batchId) redirect(`/app/payments/import/${batchId}`);
  return state;
}

const mappingSchema = z.object({
  dateColumn: z.string(),
  amountColumn: z.string(),
  descriptionColumn: z.string(),
  payerColumn: z.string(),
  refColumn: z.string(),
});

/** Column selects submit "" for "none" — normalize that to null. */
function nullIfEmpty(v: string): string | null {
  return v === "" ? null : v;
}

/**
 * Step 2: staff corrects the auto-detected column mapping. Just updates the
 * batch and re-renders the same review page with the new interpretation —
 * no re-upload, no re-parse-and-store, since rawCsv never changes.
 */
export async function updateImportMappingAction(
  batchId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await assertStaff();
    const parsed = parseForm(mappingSchema, formData);
    if (!parsed.ok) return parsed.state;

    const batch = await getDraftBatch(batchId, ctx.organizationId);

    const mapping: ColumnMapping = {
      dateColumn: nullIfEmpty(parsed.data.dateColumn),
      amountColumn: nullIfEmpty(parsed.data.amountColumn),
      descriptionColumn: nullIfEmpty(parsed.data.descriptionColumn),
      payerColumn: nullIfEmpty(parsed.data.payerColumn),
      refColumn: nullIfEmpty(parsed.data.refColumn),
    };

    await db.paymentImportBatch.update({ where: { id: batch.id }, data: { columnMapping: mapping } });
    revalidatePath(`/app/payments/import/${batchId}`);
    return actionOk("Mapping updated.");
  });
}

/**
 * Step 3: confirm. Re-parses rawCsv with the batch's current mapping (the
 * single source of truth — never trusts a stale client-side copy), reads the
 * lease each row was assigned to on the review screen, and creates one
 * Payment per non-skipped row. Rows left unassigned become UNMATCHED, not
 * silently dropped — an imported payment that doesn't map to a lease is
 * exactly the kind of thing this feature exists to surface, not hide.
 */
export async function confirmImportAction(
  batchId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let confirmedId: string | null = null;

  const state = await runAction(async () => {
    const ctx = await assertStaff();
    const batch = await getDraftBatch(batchId, ctx.organizationId);

    const { headers, rows } = parseCsvWithHeader(batch.rawCsv);
    const mapping = batch.columnMapping as unknown as ColumnMapping;
    const parsedRows = applyColumnMapping(headers, rows, mapping);

    const leaseIds = new Set<string>();
    const skippedIndexes = new Set<number>();
    for (const row of parsedRows) {
      if (formData.get(`skip_${row.rowIndex}`) === "on") {
        skippedIndexes.add(row.rowIndex);
        continue;
      }
      const chosen = formData.get(`lease_${row.rowIndex}`);
      if (typeof chosen === "string" && chosen !== "") leaseIds.add(chosen);
    }

    // Re-validate every chosen lease belongs to this org — a tampered form
    // value must never let a payment attach to someone else's lease.
    const validLeases = await db.lease.findMany({
      where: { id: { in: [...leaseIds] }, organizationId: ctx.organizationId },
      select: { id: true },
    });
    const validLeaseIds = new Set(validLeases.map((l) => l.id));

    const importableRows = parsedRows.filter(
      (row) => !row.parseError && !skippedIndexes.has(row.rowIndex),
    );

    if (importableRows.length === 0) {
      return actionError("Nothing to import — every row was skipped or unreadable.");
    }

    const affectedLeaseIds = new Set<string>();

    await db.$transaction(async (tx) => {
      for (const row of importableRows) {
        const chosen = formData.get(`lease_${row.rowIndex}`);
        const leaseId =
          typeof chosen === "string" && chosen !== "" && validLeaseIds.has(chosen) ? chosen : null;
        if (leaseId) affectedLeaseIds.add(leaseId);

        await tx.payment.create({
          data: {
            organizationId: ctx.organizationId,
            leaseId,
            amountCents: row.amountCents!,
            status: "SUCCEEDED",
            source: batch.source,
            reconciliationStatus: leaseId ? "MATCHED" : "UNMATCHED",
            paidAt: row.date!,
            memo: row.description || null,
            payerNameRaw: row.payerRaw || null,
            externalRef: row.externalRef,
            importBatchId: batch.id,
          },
        });
      }

      await tx.paymentImportBatch.update({
        where: { id: batch.id },
        data: { status: "CONFIRMED" },
      });
    });

    // Recompute real MATCHED/SHORT/LATE status (not just the "has a lease"
    // placeholder above) for every lease this import touched.
    for (const leaseId of affectedLeaseIds) {
      await applyReconciliation(leaseId);
    }

    confirmedId = batch.id;
    revalidatePath("/app/payments");
    revalidatePath("/app");
    revalidatePath("/app/payments/import");
    return actionOk();
  });

  if (confirmedId) redirect(`/app/payments/import/${confirmedId}?confirmed=1`);
  return state;
}

async function getDraftBatch(batchId: string, organizationId: string) {
  const batch = await db.paymentImportBatch.findFirst({
    where: { id: batchId, organizationId },
  });
  if (!batch) throw new NotFoundError("That import no longer exists.");
  if (batch.status !== "DRAFT") {
    throw new AuthorizationError("This import has already been confirmed and can't be changed.");
  }
  return batch;
}

