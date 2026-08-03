import type { Metadata } from "next";
import { requireTenant } from "@/lib/rbac";
import { getTenantLeases } from "@/lib/tenant-view";
import { formatCents } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { Card, DescriptionList, EmptyState, LeaseStatusBadge } from "@/components/ui";

export const metadata: Metadata = { title: "My lease" };

export default async function PortalLeasePage() {
  const ctx = await requireTenant();
  const leases = await getTenantLeases(ctx.tenantId);

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
        return (
          <Card
            key={lease.id}
            title={`${p.name} — Unit ${lease.unit.label}`}
            actions={<LeaseStatusBadge status={lease.status} />}
          >
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
                { label: "Rent due", value: `${ordinal(lease.rentDueDay)} of each month` },
                { label: "Lease starts", value: formatDate(lease.startDate) },
                {
                  label: "Lease ends",
                  value: lease.endDate ? formatDate(lease.endDate) : "Month-to-month",
                },
                { label: "Security deposit", value: formatCents(lease.depositCents) },
                { label: "Managed by", value: lease.organization.name },
              ]}
            />
          </Card>
        );
      })}

      <p className="px-1 text-xs text-slate-500">
        Something look wrong? Contact your property manager — they can correct these details.
      </p>
    </div>
  );
}

function ordinal(n: number): string {
  const suffix =
    n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th";
  return `${n}${suffix}`;
}
