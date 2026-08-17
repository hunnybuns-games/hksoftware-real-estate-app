"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertStaff, assertTenant } from "@/lib/rbac";
import {
  type ActionState,
  actionError,
  actionOk,
  optionalText,
  parseForm,
  runAction,
} from "@/lib/forms";
import {
  LEASE_CLAUSES,
  type LeaseForDocument,
  defaultDocumentTitle,
  renderLeaseDocument,
} from "@/lib/lease-document";
import { ensureDefaultTemplate } from "@/actions/lease-templates";
import { base64ToBytes } from "@/lib/encoding";
import { detectImageType } from "@/lib/image-signature";
import { MAX_SIGNATURE_IMAGE_BYTES } from "@/lib/constants";
import { notifyLeaseReadyToSign, notifyLeaseSigned } from "@/lib/notifications";

/** Same header Cloudflare hands the rate limiter — see src/lib/rate-limit.ts. */
async function clientIp(): Promise<string | null> {
  const h = await headers();
  return h.get("cf-connecting-ip");
}

async function clientUserAgent(): Promise<string | null> {
  const h = await headers();
  return h.get("user-agent");
}

const leaseSelect = {
  id: true,
  organizationId: true,
  rentAmountCents: true,
  depositCents: true,
  startDate: true,
  endDate: true,
  rentDueDay: true,
  tenant: { select: { id: true, firstName: true, lastName: true, email: true } },
  unit: {
    select: {
      label: true,
      property: {
        select: {
          name: true,
          addressLine1: true,
          addressLine2: true,
          city: true,
          state: true,
          postalCode: true,
        },
      },
    },
  },
  organization: { select: { name: true, graceDays: true, lateFeeCents: true } },
} as const;

async function loadLeaseForDocument(leaseId: string, organizationId: string) {
  return db.lease.findFirst({ where: { id: leaseId, organizationId }, select: leaseSelect });
}

/**
 * Decodes and validates a signature pad's `data:image/png;base64,...` output.
 * Returns null for an empty/untouched pad (drawing is optional — see
 * SignaturePad) and an error for anything present but invalid, so a caller
 * can't smuggle an oversized or non-image payload in through this field.
 */
function decodeSignatureImage(
  dataUrl: string,
): { ok: true; bytes: Uint8Array<ArrayBuffer> | null } | { ok: false; message: string } {
  const trimmed = dataUrl.trim();
  if (!trimmed) return { ok: true, bytes: null };

  const match = /^data:image\/png;base64,([a-zA-Z0-9+/]+=*)$/.exec(trimmed);
  if (!match) return { ok: false, message: "That signature didn't come through correctly. Please redraw it." };

  const bytes = base64ToBytes(match[1]);
  if (bytes.byteLength > MAX_SIGNATURE_IMAGE_BYTES) {
    return { ok: false, message: "That signature is too large. Please redraw it." };
  }
  if (detectImageType(bytes) !== "image/png") {
    return { ok: false, message: "That signature didn't come through correctly. Please redraw it." };
  }
  return { ok: true, bytes };
}

const clauseIds = new Set(LEASE_CLAUSES.map((c) => c.id));

const buildSchema = z.object({
  title: optionalText(200),
  extraTerms: optionalText(4000),
});

export async function createLeaseDocumentAction(
  leaseId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let newId: string | null = null;

  const state = await runAction(async () => {
    const { organizationId } = await assertStaff();
    const parsed = parseForm(buildSchema, formData);
    if (!parsed.ok) return parsed.state;

    const lease = await loadLeaseForDocument(leaseId, organizationId);
    if (!lease) return actionError("That lease no longer exists.");

    const selectedClauseIds = formData.getAll("clauses").map(String).filter((id) => clauseIds.has(id));
    const template = await ensureDefaultTemplate(organizationId);

    const body = renderLeaseDocument({
      templateBody: template.body,
      lease: lease satisfies LeaseForDocument,
      selectedClauseIds,
      extraTerms: parsed.data.extraTerms,
    });

    const title = parsed.data.title ?? defaultDocumentTitle(lease);

    const doc = await db.leaseDocument.create({
      data: { organizationId, leaseId: lease.id, templateId: template.id, title, body },
      select: { id: true },
    });

    newId = doc.id;
    revalidatePath(`/app/leases/${leaseId}`);
    return actionOk();
  });

  if (newId) redirect(`/app/leases/${leaseId}/document/${newId}`);
  return state;
}

const editSchema = z.object({
  title: z.string().trim().min(1, "Give the document a title.").max(200),
  body: z.string().trim().min(1, "The document can't be empty.").max(20000),
});

/** Only while a document is still a DRAFT — once sent, the body is a signed record and must not move. */
export async function updateLeaseDocumentBodyAction(
  documentId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { organizationId } = await assertStaff();
    const parsed = parseForm(editSchema, formData);
    if (!parsed.ok) return parsed.state;

    const doc = await db.leaseDocument.findFirst({
      where: { id: documentId, organizationId },
      select: { id: true, leaseId: true, status: true },
    });
    if (!doc) return actionError("That document no longer exists.");
    if (doc.status !== "DRAFT") return actionError("This document has already been sent and can't be edited.");

    await db.leaseDocument.update({ where: { id: doc.id }, data: parsed.data });

    revalidatePath(`/app/leases/${doc.leaseId}/document/${doc.id}`);
    return actionOk("Draft saved.");
  });
}

const countersignSchema = z.object({
  typedSignature: z.string().trim().min(1, "Type your name to sign.").max(200),
  signatureImage: z.string().optional().transform((v) => v ?? ""),
  consent: z
    .string()
    .optional()
    .transform((v) => v === "on" || v === "true")
    .refine((v) => v, { message: "You need to confirm this before sending." }),
});

/**
 * Staff countersign as the landlord's representative and, in the same step,
 * send the document to the tenant. Creates a placeholder signature row for
 * the tenant so "who's still outstanding" is always a query over
 * LeaseSignature, not separately tracked state — see the schema comment on
 * LeaseSignature.
 */
export async function sendLeaseDocumentAction(
  documentId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await assertStaff();
    const parsed = parseForm(countersignSchema, formData);
    if (!parsed.ok) return parsed.state;

    const image = decodeSignatureImage(parsed.data.signatureImage);
    if (!image.ok) return actionError(image.message, { signatureImage: image.message });

    const doc = await db.leaseDocument.findFirst({
      where: { id: documentId, organizationId: ctx.organizationId, status: "DRAFT" },
      select: {
        id: true,
        leaseId: true,
        title: true,
        lease: {
          select: {
            unit: { select: { label: true, property: { select: { name: true } } } },
            tenant: { select: { firstName: true, lastName: true, email: true } },
          },
        },
      },
    });
    if (!doc) return actionError("That document isn't a draft anymore — refresh and try again.");

    const ip = await clientIp();
    const userAgent = await clientUserAgent();
    const now = new Date();

    // Not wrapped in $transaction — D1 doesn't support interactive
    // transactions (see the same note throughout src/actions/leases.ts).
    await db.leaseSignature.create({
      data: {
        documentId: doc.id,
        role: "LANDLORD",
        signerName: ctx.name,
        signerEmail: ctx.email,
        signedAt: now,
        typedSignature: parsed.data.typedSignature,
        signatureImage: image.bytes,
        ipAddress: ip,
        userAgent,
      },
    });
    await db.leaseSignature.create({
      data: {
        documentId: doc.id,
        role: "TENANT",
        signerName: `${doc.lease.tenant.firstName} ${doc.lease.tenant.lastName}`,
        signerEmail: doc.lease.tenant.email,
      },
    });
    await db.leaseDocument.update({
      where: { id: doc.id },
      data: { status: "SENT", sentAt: now, createdById: ctx.id },
    });

    await notifyLeaseReadyToSign({
      to: { email: doc.lease.tenant.email, name: doc.lease.tenant.firstName },
      organizationId: ctx.organizationId,
      documentId: doc.id,
      propertyName: doc.lease.unit.property.name,
      unitLabel: doc.lease.unit.label,
      documentTitle: doc.title,
    });

    revalidatePath(`/app/leases/${doc.leaseId}`);
    revalidatePath(`/app/leases/${doc.leaseId}/document/${doc.id}`);
    revalidatePath("/portal/lease");
    return actionOk("Sent. The tenant can now review and sign it from their portal.");
  });
}

export async function voidLeaseDocumentAction(documentId: string, _prev: ActionState): Promise<ActionState> {
  return runAction(async () => {
    const { organizationId } = await assertStaff();

    const doc = await db.leaseDocument.findFirst({
      where: { id: documentId, organizationId, status: { in: ["DRAFT", "SENT"] } },
      select: { id: true, leaseId: true },
    });
    if (!doc) return actionError("That document can't be voided.");

    await db.leaseDocument.update({
      where: { id: doc.id },
      data: { status: "VOIDED", voidedAt: new Date() },
    });

    revalidatePath(`/app/leases/${doc.leaseId}`);
    revalidatePath(`/app/leases/${doc.leaseId}/document/${doc.id}`);
    revalidatePath("/portal/lease");
    return actionOk("Document voided.");
  });
}

const signSchema = z.object({
  typedSignature: z.string().trim().min(1, "Type your name to sign.").max(200),
  signatureImage: z.string().optional().transform((v) => v ?? ""),
  consent: z
    .string()
    .optional()
    .transform((v) => v === "on" || v === "true")
    .refine((v) => v, { message: "You need to agree to this before signing." }),
});

/**
 * The tenant's half of the flow. Fills in whichever of their own placeholder
 * signature rows on this document is still unsigned — see
 * sendLeaseDocumentAction — and flips the document to SIGNED once every
 * required signer has one.
 */
export async function signLeaseDocumentAction(
  documentId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await assertTenant();
    const parsed = parseForm(signSchema, formData);
    if (!parsed.ok) return parsed.state;

    const image = decodeSignatureImage(parsed.data.signatureImage);
    if (!image.ok) return actionError(image.message, { signatureImage: image.message });

    const doc = await db.leaseDocument.findFirst({
      where: { id: documentId, status: "SENT", lease: { tenantId: ctx.tenantId } },
      select: {
        id: true,
        leaseId: true,
        title: true,
        organizationId: true,
        organization: { select: { name: true } },
        createdBy: { select: { email: true, name: true } },
        signatures: { select: { id: true, role: true, signedAt: true } },
      },
    });
    if (!doc) return actionError("That document isn't available to sign right now.");

    const mySignature = doc.signatures.find((s) => s.role === "TENANT" && !s.signedAt);
    if (!mySignature) return actionError("You've already signed this document.");

    const ip = await clientIp();
    const userAgent = await clientUserAgent();
    const now = new Date();

    await db.leaseSignature.update({
      where: { id: mySignature.id },
      data: {
        signerName: parsed.data.typedSignature,
        signedAt: now,
        typedSignature: parsed.data.typedSignature,
        signatureImage: image.bytes,
        ipAddress: ip,
        userAgent,
      },
    });

    const stillPending = doc.signatures.some((s) => s.id !== mySignature.id && !s.signedAt);
    if (!stillPending) {
      await db.leaseDocument.update({
        where: { id: doc.id },
        data: { status: "SIGNED", completedAt: now },
      });
      if (doc.createdBy) {
        await notifyLeaseSigned({
          to: { email: doc.createdBy.email, name: doc.createdBy.name },
          organizationId: doc.organizationId,
          orgName: doc.organization.name,
          documentId: doc.id,
          leaseId: doc.leaseId,
          documentTitle: doc.title,
          tenantName: parsed.data.typedSignature,
        });
      }
    }

    revalidatePath("/portal/lease");
    revalidatePath(`/portal/lease/document/${doc.id}`);
    revalidatePath(`/app/leases/${doc.leaseId}`);
    revalidatePath(`/app/leases/${doc.leaseId}/document/${doc.id}`);
    return actionOk(stillPending ? "Signed. Waiting on the other party." : "Signed! This lease is now fully executed.");
  });
}
