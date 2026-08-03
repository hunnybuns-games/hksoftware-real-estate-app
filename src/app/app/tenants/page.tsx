import Link from "next/link";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/rbac";
import { Badge, Card, EmptyState, PageHeader, Table } from "@/components/ui";

export const metadata: Metadata = { title: "Tenants" };

export default async function TenantsPage() {
  const ctx = await requireStaff();

  const tenants = await db.tenant.findMany({
    where: { organizationId: ctx.organizationId },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      userId: true,
      invitation: { select: { acceptedAt: true, expiresAt: true } },
      leases: {
        orderBy: { startDate: "desc" },
        select: {
          id: true,
          status: true,
          unit: { select: { label: true, property: { select: { name: true } } } },
        },
      },
    },
  });

  return (
    <>
      <PageHeader
        title="Tenants"
        subtitle={tenants.length === 0 ? undefined : `${tenants.length} on file`}
        actions={
          <Link href="/app/tenants/new" className="btn-primary">
            Add tenant
          </Link>
        }
      />

      <Card padded={false}>
        {tenants.length === 0 ? (
          <EmptyState
            title="No tenants yet"
            description="Add the people renting from you. Once a tenant has a lease, you can invite them to the resident portal to pay rent online."
            action={
              <Link href="/app/tenants/new" className="btn-primary">
                Add your first tenant
              </Link>
            }
          />
        ) : (
          <Table
            head={
              <tr>
                <th className="th">Name</th>
                <th className="th">Contact</th>
                <th className="th">Unit</th>
                <th className="th">Portal</th>
              </tr>
            }
          >
            {tenants.map((tenant) => {
              const activeLease = tenant.leases.find((l) => l.status === "ACTIVE");
              const pendingInvite =
                !tenant.userId &&
                tenant.invitation &&
                !tenant.invitation.acceptedAt &&
                tenant.invitation.expiresAt > new Date();

              return (
                <tr key={tenant.id} className="hover:bg-slate-50/60">
                  <td className="td">
                    <Link
                      href={`/app/tenants/${tenant.id}`}
                      className="font-medium text-slate-900 hover:underline"
                    >
                      {tenant.firstName} {tenant.lastName}
                    </Link>
                  </td>
                  <td className="td">
                    <span className="block text-slate-700">{tenant.email}</span>
                    {tenant.phone ? (
                      <span className="block text-xs text-slate-500">{tenant.phone}</span>
                    ) : null}
                  </td>
                  <td className="td">
                    {activeLease ? (
                      <Link href={`/app/leases/${activeLease.id}`} className="hover:underline">
                        <span className="text-slate-500">{activeLease.unit.property.name}</span> ·{" "}
                        {activeLease.unit.label}
                      </Link>
                    ) : tenant.leases.length > 0 ? (
                      <span className="text-slate-400">Past resident</span>
                    ) : (
                      <span className="text-slate-400">No lease</span>
                    )}
                  </td>
                  <td className="td">
                    {tenant.userId ? (
                      <Badge tone="green">Active</Badge>
                    ) : pendingInvite ? (
                      <Badge tone="amber">Invited</Badge>
                    ) : (
                      <Badge tone="slate">Not invited</Badge>
                    )}
                  </td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>
    </>
  );
}
