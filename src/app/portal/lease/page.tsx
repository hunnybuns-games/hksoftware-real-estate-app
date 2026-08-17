import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireTenant } from "@/lib/rbac";
import { getTenantLeases } from "@/lib/tenant-view";
import { formatCents } from "@/lib/money";
import { formatDate, ordinalDay } from "@/lib/dates";
import {
  Banner,
  Card,
  DescriptionList,
  EmptyState,
  LeaseDocumentStatusBadge,
  LeaseStatusBadge,
} from "@/components/ui";
import Link from "@/components/link";

export const metadata: Metadata = { title: "My lease" };

export default async function PortalLeasePage() {
  const ctx = await requireTenant();
  const leases = await getTenantLeases(ctx.tenantId);

  // Drafts are staff's working copy — a tenant only ever sees a document once
  // it's been sent for signature. See getLeaseDocumentForTenant for the same
  // scoping on the document page this links to.
  const documents = await db.leaseDocument.findMany({
    where: { lease: { tenantId: ctx.tenantId }, status: { not: "DRAFT" } },
    orderBy: { createdAt: "desc" },
    select: { id: true, leaseId: true, title: true, status: true, createdAt: true },
  });

  if (leases.length === 0) {
    return (
      <Card>
        <EmptyState
          title="No lease on file"
          description="Your property manager hasn't added your lease yet. Once they do, the details show up here."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {leases.map((lease) => {
        const p = lease.unit.property;
        const leaseDocs = documents.filter((d) => d.leaseId === lease.id);
        const pendingDoc = leaseDocs.find((d) => d.status === "SENT");
        return (
          <Card
            key={lease.id}
            title={`${p.name} — Unit ${lease.unit.label}`}
            actions={<LeaseStatusBadge status={lease.status} />}
          >
            {pendingDoc ? (
              <Banner
                tone="warning"
                title="A document is waiting on your signature"
                action={
                  <Link href={`/portal/lease/document/${pendingDoc.id}`} className="btn-primary">
                    Review & sign
                  </Link>
                }
              >
                {pendingDoc.title}
              </Banner>
            ) : null}

            <DescriptionList
              items={[
                {
                  label: "Address",
                  value: (
                    <>
                      {p.addressLine1}
                      {p.addressLine2 ? `, ${p.addressLine2}` : ""}
                      <br />
                      {p.city}, {p.state} {p.postalCode}
                    </>
                  ),
                },
                {
                  label: "Unit",
                  value: `${lease.unit.bedrooms} bed · ${lease.unit.bathrooms} bath`,
                },
                { label: "Monthly rent", value: formatCents(lease.rentAmountCents) },
                { label: "Rent due", value: `${ordinalDay(lease.rentDueDay)} of each month` },
                { label: "Lease starts", value: formatDate(lease.startDate) },
                {
                  label: "Lease ends",
                  value: lease.endDate ? formatDate(lease.endDate) : "Month-to-month",
                },
                { label: "Security deposit", value: formatCents(lease.depositCents) },
                { label: "Managed by", value: lease.organization.name },
              ]}
            />

            {leaseDocs.length > 0 ? (
              <div className="mt-5 border-t border-slate-100 pt-4">
                <p className="mb-2 text-xs font-medium tracking-wide text-slate-500 uppercase">
                  Lease documents
                </p>
                <ul className="divide-y divide-slate-100">
                  {leaseDocs.map((doc) => (
                    <li key={doc.id} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                      <Link
                        href={`/portal/lease/document/${doc.id}`}
                        className="min-w-0 truncate text-sm font-medium text-slate-900 hover:underline"
                      >
                        {doc.title}
                      </Link>
                      <LeaseDocumentStatusBadge status={doc.status} />
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Card>
        );
      })}

      <p className="px-1 text-xs text-slate-500">
        Something look wrong? Contact your property manager — they can correct these details.
      </p>
    </div>
  );
}
