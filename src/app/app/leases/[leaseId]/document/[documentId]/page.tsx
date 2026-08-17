import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireStaff, staffOrganizationIdForMetadata } from "@/lib/rbac";
import { getLeaseDocumentForStaff } from "@/lib/lease-document-view";
import {
  sendLeaseDocumentAction,
  updateLeaseDocumentBodyAction,
  voidLeaseDocumentAction,
} from "@/actions/lease-documents";
import { formatDateTime } from "@/lib/dates";
import { Banner, Breadcrumbs, Card, LeaseDocumentStatusBadge, PageHeader } from "@/components/ui";
import { ActionButton } from "@/components/action-button";
import { Disclosure } from "@/components/disclosure";
import { PrintButton } from "@/components/print-button";
import { LeaseDocumentPaper } from "@/components/lease-document-paper";
import Link from "@/components/link";
import { EditDocumentForm } from "../_components/edit-document-form";
import { CountersignForm } from "../_components/countersign-form";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ documentId: string }>;
}): Promise<Metadata> {
  const { documentId } = await params;
  const organizationId = await staffOrganizationIdForMetadata();
  if (!organizationId) return { title: "Lease document" };
  const doc = await getLeaseDocumentForStaff(documentId, organizationId);
  return { title: doc ? doc.title : "Lease document" };
}

export default async function LeaseDocumentDetailPage({
  params,
}: {
  params: Promise<{ leaseId: string; documentId: string }>;
}) {
  const ctx = await requireStaff();
  const { leaseId, documentId } = await params;

  const doc = await getLeaseDocumentForStaff(documentId, ctx.organizationId);
  if (!doc || doc.leaseId !== leaseId) notFound();

  const tenantName = `${doc.lease.tenant.firstName} ${doc.lease.tenant.lastName}`;
  const unitLabel = doc.lease.unit.label;

  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <Breadcrumbs
          items={[
            { label: "Leases", href: "/app/leases" },
            { label: `${tenantName} — ${unitLabel}`, href: `/app/leases/${leaseId}` },
            { label: doc.title },
          ]}
        />
        <PageHeader
          title={doc.title}
          subtitle={`${tenantName} — Unit ${unitLabel}`}
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
            It&apos;s no longer available for signature. Generate a new one from the lease page if
            you need to send an updated version.
          </Banner>
        ) : doc.status === "SIGNED" ? (
          <Banner tone="info" title="Fully signed">
            Every required signature is on file{doc.completedAt ? ` as of ${formatDateTime(doc.completedAt)}` : ""}.
          </Banner>
        ) : null}

        {doc.status === "DRAFT" ? (
          <>
            <Card
              title="Edit draft"
              description="Tweak the generated text before sending it. Once sent, the document is locked."
            >
              <EditDocumentForm
                action={updateLeaseDocumentBodyAction.bind(null, doc.id)}
                defaults={{ title: doc.title, body: doc.body }}
              />
            </Card>

            <Card
              title="Sign & send"
              description="Countersign as the landlord's representative, then the tenant is notified to review and sign from their portal."
            >
              <p className="mb-4 text-sm text-slate-500">
                Make sure {tenantName} already has portal access — invite them from the{" "}
                <Link href="/app/tenants" className="link">
                  Tenants
                </Link>{" "}
                page first if they haven&apos;t signed up yet.
              </p>
              <CountersignForm
                action={sendLeaseDocumentAction.bind(null, doc.id)}
                defaultName={ctx.name}
              />
            </Card>

            <Card title="Discard this draft">
              <ActionButton
                action={voidLeaseDocumentAction.bind(null, doc.id)}
                label="Void draft"
                pendingLabel="Voiding…"
                variant="danger"
              />
            </Card>
          </>
        ) : null}

        {doc.status === "SENT" ? (
          <Card title="Waiting on signature">
            <p className="mb-4 text-sm text-slate-500">
              Sent {doc.sentAt ? formatDateTime(doc.sentAt) : ""} — see the signature panel below
              for who&apos;s signed. You can void this and start over if something needs to
              change.
            </p>
            <Disclosure label="Void this document" variant="secondary">
              <ActionButton
                action={voidLeaseDocumentAction.bind(null, doc.id)}
                label="Confirm void"
                pendingLabel="Voiding…"
                variant="danger"
              />
            </Disclosure>
          </Card>
        ) : null}
      </div>

      <LeaseDocumentPaper document={doc} />
    </div>
  );
}
