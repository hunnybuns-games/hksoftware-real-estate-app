import { db } from "@/lib/db";

/**
 * The shape both the staff detail page and the tenant sign page need to
 * render a document — see LeaseDocumentPaper. Kept as one shared select so
 * the two loaders below (and any future one) can't drift apart on what a
 * "document view" includes.
 */
const documentSelect = {
  id: true,
  leaseId: true,
  title: true,
  body: true,
  status: true,
  sentAt: true,
  completedAt: true,
  voidedAt: true,
  lease: {
    select: {
      tenant: { select: { firstName: true, lastName: true } },
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
    },
  },
  signatures: {
    orderBy: { role: "asc" } as const, // LANDLORD before TENANT
    select: {
      id: true,
      role: true,
      signerName: true,
      signerEmail: true,
      signedAt: true,
      typedSignature: true,
      signatureImage: true,
      ipAddress: true,
    },
  },
} as const;

export type LeaseDocumentView = NonNullable<Awaited<ReturnType<typeof getLeaseDocumentForStaff>>>;

/** Scoped by organization — the staff-side guard on every document page/action. */
export function getLeaseDocumentForStaff(documentId: string, organizationId: string) {
  return db.leaseDocument.findFirst({
    where: { id: documentId, organizationId },
    select: documentSelect,
  });
}

/** Scoped by tenant, through the lease — a tenant only ever sees their own documents. */
export function getLeaseDocumentForTenant(documentId: string, tenantId: string) {
  return db.leaseDocument.findFirst({
    where: { id: documentId, lease: { tenantId } },
    select: documentSelect,
  });
}
