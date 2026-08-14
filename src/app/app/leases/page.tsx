import Link from "@/components/link";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/rbac";
import { computeBalance } from "@/lib/ledger";
import { formatCents } from "@/lib/money";
import { formatDate, daysBetweenUtc, startOfUtcDay } from "@/lib/dates";
import { Badge, Card, EmptyState, LeaseStatusBadge, PageHeader, Table } from "@/components/ui";

export const metadata: Metadata = { title: "Leases" };

export default async function LeasesPage() {
  const ctx = await requireStaff();

  const [org, leases] = await Promise.all([
    db.organization.findUnique({
      where: { id: ctx.organizationId },
      select: { graceDays: true },
    }),
    db.lease.findMany({
      where: { organizationId: ctx.organizationId },
      orderBy: [{ status: "asc" }, { startDate: "desc" }],
      include: {
        tenant: { select: { id: true, firstName: true, lastName: true } },
        unit: { select: { label: true, property: { select: { id: true, name: true } } } },
        charges: { where: { voidedAt: null }, select: { amountCents: true, dueDate: true, voidedAt: true } },
        payments: { select: { amountCents: true, status: true } },
      },
    }),
  ]);

  const graceDays = org?.graceDays ?? 5;
  const today = startOfUtcDay(new Date());

  return (
    <>
      <PageHeader
        title="Leases"
        subtitle={
          leases.length === 0
            ? undefined
            : `${leases.filter((l) => l.status === "ACTIVE").length} active of ${leases.length}`
        }
        actions={
          <Link href="/app/leases/new" className="btn-primary">
            New lease
          </Link>
        }
      />

      <Card padded={false}>
        {leases.length === 0 ? (
          <EmptyState
            title="No leases yet"
            description="A lease links a tenant to a unit and sets the rent. Creating one starts the rent clock and lets the resident pay through their portal."
            action={
              <Link href="/app/leases/new" className="btn-primary">
                Create your first lease
              </Link>
            }
          />
        ) : (
          <Table
            head={
              <tr>
                <th className="th">Tenant</th>
                <th className="th">Unit</th>
                <th className="th">Term</th>
                <th className="th text-right">Rent</th>
                <th className="th text-right">Balance</th>
                <th className="th">Status</th>
              </tr>
            }
          >
            {leases.map((lease) => {
              const balance = computeBalance({
                charges: lease.charges,
                payments: lease.payments,
                graceDays,
              });
              // Surface renewals before they lapse — 60 days is enough notice to
              // send a renewal offer or start marketing the unit.
              const daysToEnd = lease.endDate ? daysBetweenUtc(today, lease.endDate) : null;
              const expiringSoon =
                lease.status === "ACTIVE" && daysToEnd !== null && daysToEnd >= 0 && daysToEnd <= 60;

              return (
                <tr key={lease.id} className="hover:bg-slate-50/60">
                  <td className="td">
                    <Link
                      href={`/app/leases/${lease.id}`}
                      className="font-medium text-slate-900 hover:underline"
                    >
                      {lease.tenant.firstName} {lease.tenant.lastName}
                    </Link>
                  </td>
                  <td className="td">
                    <span className="text-slate-500">{lease.unit.property.name}</span> ·{" "}
                    {lease.unit.label}
                  </td>
                  <td className="td text-slate-500">
                    {formatDate(lease.startDate)} –{" "}
                    {lease.endDate ? formatDate(lease.endDate) : "month-to-month"}
                    {expiringSoon ? (
                      <Badge tone="amber">
                        {daysToEnd === 0 ? "Ends today" : `${daysToEnd}d left`}
                      </Badge>
                    ) : null}
                  </td>
                  <td className="td text-right tabular-nums">
                    {formatCents(lease.rentAmountCents)}
                  </td>
                  <td className="td text-right tabular-nums">
                    {balance.balanceCents > 0 ? (
                      <span className={balance.isLate ? "font-medium text-red-700 dark:text-red-300" : "font-medium text-amber-700 dark:text-amber-300"}>
                        {formatCents(balance.balanceCents)}
                      </span>
                    ) : balance.balanceCents < 0 ? (
                      <span className="text-emerald-700 dark:text-emerald-300">
                        {formatCents(-balance.balanceCents)} credit
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="td">
                    <LeaseStatusBadge status={lease.status} />
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
