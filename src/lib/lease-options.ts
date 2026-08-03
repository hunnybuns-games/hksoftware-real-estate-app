import { db } from "@/lib/db";
import { centsToInputValue } from "@/lib/money";
import type { TenantOption, UnitOption } from "@/app/app/leases/_components/lease-form";

/** Shared by the lease create and edit screens. */
export async function getLeaseFormOptions(organizationId: string): Promise<{
  units: UnitOption[];
  tenants: TenantOption[];
}> {
  const [units, tenants] = await Promise.all([
    db.unit.findMany({
      where: { property: { organizationId } },
      orderBy: [{ property: { name: "asc" } }, { label: "asc" }],
      select: {
        id: true,
        label: true,
        status: true,
        marketRentCents: true,
        property: { select: { name: true } },
        _count: { select: { leases: { where: { status: "ACTIVE" } } } },
      },
    }),
    db.tenant.findMany({
      where: { organizationId },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      select: { id: true, firstName: true, lastName: true, email: true },
    }),
  ]);

  return {
    units: units.map((u) => ({
      id: u.id,
      label: u.label,
      propertyName: u.property.name,
      status: u.status,
      marketRent: centsToInputValue(u.marketRentCents),
      hasActiveLease: u._count.leases > 0,
    })),
    tenants: tenants.map((t) => ({
      id: t.id,
      name: `${t.firstName} ${t.lastName}`,
      email: t.email,
    })),
  };
}
