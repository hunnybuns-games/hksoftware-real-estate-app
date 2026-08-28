"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { DocumentCategory } from "@prisma/client";
import { db } from "@/lib/db";
import { assertStaff, NotFoundError } from "@/lib/rbac";
import {
  type ActionState,
  actionError,
  actionOk,
  optionalText,
  parseForm,
  runAction,
} from "@/lib/forms";
import {
  MAX_DOCUMENTS_PER_UPLOAD,
  MAX_DOCUMENT_BATCH_BYTES,
  MAX_DOCUMENT_BYTES,
} from "@/lib/constants";
import { detectFile, type FileFamily } from "@/lib/file-signature";
import { deleteDocument, putDocument } from "@/lib/document-storage";
import { suggestFiling, type FilingCandidates } from "@/lib/document-filing";

/**
 * The document vault: drop any file, have it filed against the right
 * property/unit/tenant/lease.
 *
 * Deliberately echoes the CSV importer in ./import.ts — upload, then review a
 * guess before it settles — rather than inventing a second shape for the same
 * idea. The guess is filename-only (see src/lib/document-filing.ts) and will
 * sometimes be wrong, which is exactly why nothing here is presented as final.
 *
 * One structural difference from the importer is worth knowing. An import
 * batch parks raw CSV in a DRAFT row and creates nothing until confirmed,
 * because a half-imported statement would double-count money. A document
 * carries no such hazard: the file is worth keeping the moment it lands,
 * filed or not. So rows are created immediately and "unfiled" is a real,
 * visible state rather than a pending one.
 */

const uploadSchema = z.object({
  // Optional pre-set target, used when the drop zone is embedded on a
  // property or lease page rather than the standalone vault. Beats the
  // filename guess, since explicit context beats a heuristic.
  propertyId: z.string().trim().optional(),
  leaseId: z.string().trim().optional(),
  tenantId: z.string().trim().optional(),
});

export async function uploadDocumentsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await assertStaff();
    const parsed = parseForm(uploadSchema, formData);
    if (!parsed.ok) return parsed.state;

    const files = formData
      .getAll("files")
      .filter((f): f is File => f instanceof File && f.size > 0);

    if (files.length === 0) {
      return actionError("Please fix the highlighted fields.", {
        files: "Choose at least one file.",
      });
    }
    if (files.length > MAX_DOCUMENTS_PER_UPLOAD) {
      return actionError("Please fix the highlighted fields.", {
        files: `That is ${files.length} files — the limit is ${MAX_DOCUMENTS_PER_UPLOAD} per drop. Add them in smaller batches.`,
      });
    }

    const batchBytes = files.reduce((total, f) => total + f.size, 0);
    if (batchBytes > MAX_DOCUMENT_BATCH_BYTES) {
      return actionError("Please fix the highlighted fields.", {
        files: `That batch is ${mb(batchBytes)} MB — the limit is ${mb(MAX_DOCUMENT_BATCH_BYTES)} MB per drop.`,
      });
    }

    // An explicit target from the page the drop zone sits on, validated
    // against this org before use: a tampered hidden field must never attach
    // a document to another organization's records.
    const pinned = await resolvePinnedTarget(ctx.organizationId, parsed.data);
    const candidates = pinned ? null : await filingCandidatesFor(ctx.organizationId);

    const rejected: { filename: string; reason: string }[] = [];
    const duplicates: string[] = [];
    let created = 0;
    let autoFiled = 0;

    for (const file of files) {
      const filename = file.name.slice(0, 200) || "document";

      // Size checked before reading the body, so an oversized file is refused
      // without being pulled into memory first — same ordering as readPhotos.
      if (file.size > MAX_DOCUMENT_BYTES) {
        rejected.push({ filename, reason: `larger than ${mb(MAX_DOCUMENT_BYTES)} MB` });
        continue;
      }

      const bytes = new Uint8Array(await file.arrayBuffer());
      const detected = detectFile(bytes, filename);

      const stored = await putDocument({
        organizationId: ctx.organizationId,
        bytes,
        contentType: detected.contentType,
      });

      // Same bytes already in the vault? Worth flagging, never worth
      // blocking: one certificate of insurance legitimately covers two
      // properties. Contrast the importer, where a duplicate would
      // double-count money and is refused outright.
      const existing = await db.document.findFirst({
        where: { organizationId: ctx.organizationId, contentHash: stored.contentHash },
        select: { id: true },
      });
      if (existing) duplicates.push(filename);

      const filing = pinned
        ? { ...pinned, category: categoryOnly(filename, detected.family) }
        : expandFiling(filename, detected.family, candidates!);

      await db.document.create({
        data: {
          organizationId: ctx.organizationId,
          filename,
          contentType: detected.contentType,
          sizeBytes: stored.sizeBytes,
          storageKey: stored.key,
          contentHash: stored.contentHash,
          uploadedById: ctx.id,
          category: filing.category,
          propertyId: filing.propertyId,
          unitId: filing.unitId,
          tenantId: filing.tenantId,
          leaseId: filing.leaseId,
        },
      });

      created += 1;
      if (filing.propertyId || filing.leaseId || filing.tenantId) autoFiled += 1;
    }

    revalidateForFiling(parsed.data);

    if (created === 0) {
      return actionError(
        rejected.length === 1
          ? `${rejected[0].filename} could not be stored — ${rejected[0].reason}.`
          : "None of those files could be stored.",
      );
    }

    return actionOk(summarize({ created, autoFiled, duplicates, rejected }));
  });
}

function mb(bytes: number): number {
  return Math.round(bytes / 1024 / 1024);
}

/**
 * The vault list always changes; the record a document was pinned to only
 * changes when the drop zone was embedded on that record's page (see
 * DocumentsCard). Revalidating that page too is what makes an upload appear
 * immediately instead of after a manual refresh.
 */
function revalidateForFiling(input: { propertyId?: string; leaseId?: string; tenantId?: string }): void {
  revalidatePath("/app/documents");
  if (input.leaseId) revalidatePath(`/app/leases/${input.leaseId}`);
  if (input.propertyId) revalidatePath(`/app/properties/${input.propertyId}`);
  if (input.tenantId) revalidatePath(`/app/tenants/${input.tenantId}`);
}

function summarize(s: {
  created: number;
  autoFiled: number;
  duplicates: string[];
  rejected: { filename: string; reason: string }[];
}): string {
  const parts = [`Added ${s.created} ${s.created === 1 ? "file" : "files"}`];
  if (s.autoFiled > 0) parts.push(`${s.autoFiled} filed automatically`);
  if (s.duplicates.length > 0) {
    parts.push(`${s.duplicates.length} already in the vault — kept anyway`);
  }
  if (s.rejected.length > 0) {
    parts.push(`${s.rejected.length} skipped (${s.rejected.map((r) => r.filename).join(", ")})`);
  }
  return `${parts.join(" · ")}.`;
}

type ResolvedFiling = {
  propertyId: string | null;
  unitId: string | null;
  tenantId: string | null;
  leaseId: string | null;
};

/** Category alone, for the case where the target is already pinned by the page. */
function categoryOnly(filename: string, family: FileFamily): DocumentCategory {
  return suggestFiling(filename, family, { leases: [], properties: [] }).category;
}

type Candidates = FilingCandidates & { leaseIndex: Map<string, ResolvedFiling> };

/**
 * A matched lease implies its unit, tenant and property. Storing all four
 * rather than the lease id alone is what lets a property page list everything
 * belonging to it with one `where: { propertyId }` instead of walking the
 * lease table to find its documents.
 */
function expandFiling(
  filename: string,
  family: FileFamily,
  candidates: Candidates,
): ResolvedFiling & { category: DocumentCategory } {
  const suggestion = suggestFiling(filename, family, candidates);

  if (suggestion.leaseId) {
    const expanded = candidates.leaseIndex.get(suggestion.leaseId);
    if (expanded) return { ...expanded, category: suggestion.category };
  }

  return {
    propertyId: suggestion.propertyId,
    unitId: null,
    tenantId: null,
    leaseId: null,
    category: suggestion.category,
  };
}

async function resolvePinnedTarget(
  organizationId: string,
  input: { propertyId?: string; leaseId?: string; tenantId?: string },
): Promise<ResolvedFiling | null> {
  if (input.leaseId) {
    const lease = await db.lease.findFirst({
      where: { id: input.leaseId, organizationId },
      select: { id: true, unitId: true, tenantId: true, unit: { select: { propertyId: true } } },
    });
    if (!lease) throw new NotFoundError("That lease no longer exists.");
    return {
      leaseId: lease.id,
      unitId: lease.unitId,
      tenantId: lease.tenantId,
      propertyId: lease.unit.propertyId,
    };
  }

  if (input.tenantId) {
    const tenant = await db.tenant.findFirst({
      where: { id: input.tenantId, organizationId },
      select: { id: true },
    });
    if (!tenant) throw new NotFoundError("That tenant no longer exists.");
    return { leaseId: null, unitId: null, tenantId: tenant.id, propertyId: null };
  }

  if (input.propertyId) {
    const property = await db.property.findFirst({
      where: { id: input.propertyId, organizationId },
      select: { id: true },
    });
    if (!property) throw new NotFoundError("That property no longer exists.");
    return { leaseId: null, unitId: null, tenantId: null, propertyId: property.id };
  }

  return null;
}

async function filingCandidatesFor(organizationId: string): Promise<Candidates> {
  const [leases, properties] = await Promise.all([
    db.lease.findMany({
      // ENDED leases are included on purpose: most of what gets bulk-dropped
      // during onboarding is historical paperwork for tenants who have
      // already moved out, and excluding those would leave the single
      // largest pile unfiled.
      where: { organizationId, status: { in: ["ACTIVE", "DRAFT", "ENDED"] } },
      select: {
        id: true,
        unitId: true,
        tenantId: true,
        tenant: { select: { firstName: true, lastName: true } },
        unit: { select: { label: true, propertyId: true, property: { select: { name: true } } } },
      },
    }),
    db.property.findMany({ where: { organizationId }, select: { id: true, name: true } }),
  ]);

  const leaseIndex = new Map<string, ResolvedFiling>();
  for (const lease of leases) {
    leaseIndex.set(lease.id, {
      leaseId: lease.id,
      unitId: lease.unitId,
      tenantId: lease.tenantId,
      propertyId: lease.unit.propertyId,
    });
  }

  return {
    leases: leases.map((l) => ({
      leaseId: l.id,
      tenantFirstName: l.tenant.firstName,
      tenantLastName: l.tenant.lastName,
      unitLabel: l.unit.label,
      propertyName: l.unit.property.name,
    })),
    properties: properties.map((p) => ({ propertyId: p.id, name: p.name })),
    leaseIndex,
  };
}

// --- Correcting a filing after the fact -------------------------------------

const CATEGORIES = [
  "LEASE",
  "APPLICATION",
  "INSURANCE",
  "TAX",
  "INSPECTION",
  "RECEIPT",
  "IDENTIFICATION",
  "NOTICE",
  "STATEMENT",
  "PHOTO",
  "OTHER",
] as const satisfies readonly DocumentCategory[];

const refileSchema = z.object({
  category: z.enum(CATEGORIES),
  title: optionalText(200),
  notes: optionalText(2000),
  /**
   * One combined select rather than four separate ones. "Where does this
   * belong" is a single decision to a landlord, and four independent
   * dropdowns would let them build states that contradict each other — a
   * lease filed under a property it is not in. Encoded as "<kind>:<id>" and
   * re-expanded server-side through the same resolver the upload path uses.
   */
  target: z.string().trim(),
});

export async function refileDocumentAction(
  documentId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await assertStaff();
    const parsed = parseForm(refileSchema, formData);
    if (!parsed.ok) return parsed.state;

    const document = await db.document.findFirst({
      where: { id: documentId, organizationId: ctx.organizationId },
      select: { id: true },
    });
    if (!document) throw new NotFoundError("That document no longer exists.");

    const separator = parsed.data.target.indexOf(":");
    const kind = separator === -1 ? parsed.data.target : parsed.data.target.slice(0, separator);
    const id = separator === -1 ? "" : parsed.data.target.slice(separator + 1);

    let filing: ResolvedFiling = { propertyId: null, unitId: null, tenantId: null, leaseId: null };

    if (kind === "lease" || kind === "property" || kind === "tenant") {
      const resolved = await resolvePinnedTarget(ctx.organizationId, { [`${kind}Id`]: id });
      if (resolved) filing = resolved;
    } else if (kind !== "none") {
      return actionError("Please fix the highlighted fields.", {
        target: "Pick where this belongs.",
      });
    }

    await db.document.update({
      where: { id: document.id },
      data: {
        category: parsed.data.category,
        title: parsed.data.title || null,
        notes: parsed.data.notes || null,
        ...filing,
      },
    });

    revalidatePath("/app/documents");
    revalidateForFiling({
      propertyId: filing.propertyId ?? undefined,
      leaseId: filing.leaseId ?? undefined,
      tenantId: filing.tenantId ?? undefined,
    });
    return actionOk("Filing updated.");
  });
}

export async function deleteDocumentAction(
  documentId: string,
  _prev: ActionState,
): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await assertStaff();

    const document = await db.document.findFirst({
      where: { id: documentId, organizationId: ctx.organizationId },
      select: { id: true, storageKey: true },
    });
    if (!document) return actionOk();

    // Stored bytes first, then the row. A failed storage delete is logged and
    // swallowed (see deleteDocument): orphaned bytes are wasted space,
    // whereas an orphaned row is a document the landlord can see and cannot
    // get rid of. Same trade-off disconnectBankAction makes with Plaid.
    await deleteDocument(document.storageKey);
    await db.document.delete({ where: { id: document.id } });

    revalidatePath("/app/documents");
    return actionOk("Document deleted.");
  });
}
