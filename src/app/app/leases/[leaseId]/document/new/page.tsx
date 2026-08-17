import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/rbac";
import { createLeaseDocumentAction } from "@/actions/lease-documents";
import { defaultDocumentTitle } from "@/lib/lease-document";
import { Breadcrumbs, Card, PageHeader } from "@/components/ui";
import { DocumentBuilderForm } from "../_components/document-builder-form";

export const metadata: Metadata = { title: "Generate lease document" };

export default async function NewLeaseDocumentPage({
  params,
}: {
  params: Promise<{ leaseId: string }>;
}) {
  const ctx = await requireStaff();
  const { leaseId } = await params;

  const lease = await db.lease.findFirst({
    where: { id: leaseId, organizationId: ctx.organizationId },
    select: {
      id: true,
      tenant: { select: { firstName: true, lastName: true } },
      unit: { select: { label: true, property: { select: { id: true, name: true } } } },
    },
  });
  if (!lease) notFound();

  const tenantName = `${lease.tenant.firstName} ${lease.tenant.lastName}`;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <Breadcrumbs
          items={[
            { label: "Leases", href: "/app/leases" },
            { label: `${tenantName} — ${lease.unit.label}`, href: `/app/leases/${lease.id}` },
            { label: "New document" },
          ]}
        />
        <PageHeader
          title="Generate lease document"
          subtitle={`${lease.unit.property.name} — Unit ${lease.unit.label} · ${tenantName}`}
        />
      </div>

      <Card
        title="Build the document"
        description="Starts from your organization's standard template, filled in with this lease's terms."
      >
        <DocumentBuilderForm
          action={createLeaseDocumentAction.bind(null, lease.id)}
          suggestedTitle={defaultDocumentTitle(lease)}
        />
      </Card>
    </div>
  );
}
