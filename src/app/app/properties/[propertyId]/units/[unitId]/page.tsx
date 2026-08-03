import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/rbac";
import { deleteUnitAction, updateUnitAction } from "@/actions/units";
import { centsToInputValue } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { Breadcrumbs, Card, LeaseStatusBadge, PageHeader } from "@/components/ui";
import { DangerAction } from "@/components/danger-action";
import { UnitForm } from "../../../_components/unit-form";

export const metadata: Metadata = { title: "Edit unit" };

export default async function EditUnitPage({
  params,
}: {
  params: Promise<{ propertyId: string; unitId: string }>;
}) {
  const ctx = await requireStaff();
  const { propertyId, unitId } = await params;

  const unit = await db.unit.findFirst({
    where: {
      id: unitId,
      propertyId,
      property: { organizationId: ctx.organizationId },
    },
    include: {
      property: { select: { id: true, name: true } },
      leases: {
        orderBy: { startDate: "desc" },
        include: { tenant: { select: { firstName: true, lastName: true } } },
      },
    },
  });
  if (!unit) notFound();

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <Breadcrumbs
          items={[
            { label: "Properties", href: "/app/properties" },
            { label: unit.property.name, href: `/app/properties/${unit.property.id}` },
            { label: `Unit ${unit.label}` },
          ]}
        />
        <PageHeader title={`Unit ${unit.label}`} subtitle={unit.property.name} />
        <Card>
          <UnitForm
            action={updateUnitAction.bind(null, unit.id)}
            defaults={{
              label: unit.label,
              bedrooms: String(unit.bedrooms),
              bathrooms: String(unit.bathrooms),
              sqft: unit.sqft ? String(unit.sqft) : "",
              marketRent: centsToInputValue(unit.marketRentCents),
              status: unit.status,
            }}
            submitLabel="Save changes"
            onCancelHref={`/app/properties/${unit.property.id}`}
          />
        </Card>
      </div>

      {unit.leases.length > 0 ? (
        <Card title="Lease history" padded={false}>
          <ul className="divide-y divide-slate-100">
            {unit.leases.map((lease) => (
              <li key={lease.id} className="flex items-center justify-between gap-4 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900">
                    {lease.tenant.firstName} {lease.tenant.lastName}
                  </p>
                  <p className="text-xs text-slate-500">
                    {formatDate(lease.startDate)} – {lease.endDate ? formatDate(lease.endDate) : "open-ended"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <LeaseStatusBadge status={lease.status} />
                  <Link href={`/app/leases/${lease.id}`} className="link text-sm">
                    Open
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card title="Delete this unit">
        <DangerAction
          action={deleteUnitAction.bind(null, unit.id)}
          label="Delete unit"
          confirmLabel="Yes, delete it"
          description={
            unit.leases.length > 0
              ? "This unit has lease history attached, so it can't be deleted. Mark it off-market instead."
              : "This unit has no leases, so nothing else will be affected."
          }
        />
      </Card>
    </div>
  );
}
