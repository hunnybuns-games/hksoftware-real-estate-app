import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/rbac";
import { getLeaseDocumentForTenant } from "@/lib/lease-document-view";
import { signLeaseDocumentAction } from "@/actions/lease-documents";
import { Banner, Card, LeaseDocumentStatusBadge, PageHeader } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { LeaseDocumentPaper } from "@/components/lease-document-paper";
import { SignForm } from "../_components/sign-form";

export const metadata: Metadata = { title: "Lease document" };

export default async function PortalLeaseDocumentPage({
  params,
}: {
  params: Promise<{ documentId: string }>;
}) {
  const ctx = await requireTenant();
  const { documentId } = await params;

  const doc = await getLeaseDocumentForTenant(documentId, ctx.tenantId);
  // A draft hasn't been sent yet — treat it the same as not existing, rather
  // than letting a guessed id preview a document staff hasn't finished.
  if (!doc || doc.status === "DRAFT") notFound();

  const mySignature = doc.signatures.find((s) => s.role === "TENANT");
  const needsMySignature = doc.status === "SENT" && mySignature && !mySignature.signedAt;

  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <PageHeader
          title={doc.title}
          subtitle={`${doc.lease.unit.property.name} — Unit ${doc.lease.unit.label}`}
          actions={
            <>
              <LeaseDocumentStatusBadge status={doc.status} />
              <PrintButton />
            </>
          }
        />
      </div>

      <div className="print:hidden space-y-6">
        {doc.status === "VOIDED" ? (
          <Banner tone="danger" title="This document was voided">
            Your property manager has withdrawn this document. Contact them if you were expecting
            to sign something.
          </Banner>
        ) : doc.status === "SIGNED" ? (
          <Banner tone="success" title="Signed">
            This lease is fully executed. You can print or save a copy below.
          </Banner>
        ) : null}

        {needsMySignature ? (
          <Card title="Review and sign" description="Read the full document below, then sign here.">
            <SignForm action={signLeaseDocumentAction.bind(null, doc.id)} defaultName={ctx.name} />
          </Card>
        ) : null}
      </div>

      <LeaseDocumentPaper document={doc} />
    </div>
  );
}
