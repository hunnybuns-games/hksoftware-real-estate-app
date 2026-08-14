import Link from "@/components/link";
import type { Metadata } from "next";
import { requireStaff } from "@/lib/rbac";
import { getRentRoll } from "@/lib/reports";
import { db } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { PAYMENT_SOURCE_SHORT_LABELS } from "@/lib/payment-source";
import { Badge, Card, EmptyState, LeaseStatusBadge, PageHeader, Table } from "@/components/ui";

export const metadata: Metadata = { title: "Reports" };

export default async function ReportsPage() {
  const ctx = await requireStaff();

  const [rentRoll, properties] = await Promise.all([
    getRentRoll({ organizationId: ctx.organizationId, includeTenantNames: true }),
    db.property.findMany({
      where: { organizationId: ctx.organizationId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, city: true, state: true },
    }),
  ]);

  return (
    <>
      <PageHeader
        title="Reports"
        subtitle="Portfolio-wide rent roll and per-property statements, ready to hand to a lender or your CPA."
      />

      <div className="space-y-6">
        <Card title="Properties" description="Open a property for its profit & loss statement.">
          {properties.length === 0 ? (
            <EmptyState title="No properties yet" description="Add a property to see it here." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {properties.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-4 px-5 py-3">
                  <div>
                    <Link href={`/app/reports/${p.id}`} className="font-medium text-slate-900 hover:underline">
                      {p.name}
                    </Link>
                    <span className="block text-xs text-slate-500">
                      {p.city}, {p.state}
                    </span>
                  </div>
                  <Link href={`/app/reports/${p.id}`} className="btn-secondary">
                    View P&amp;L
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Rent roll"
          description="Every active lease, its rent split, and where it stands."
          padded={false}
          actions={
            <a href="/api/export/rent-roll" className="btn-secondary">
              Export CSV
            </a>
          }
        >
          {rentRoll.length === 0 ? (
            <EmptyState title="No active leases yet" description="The rent roll will list every active lease once you add one." />
          ) : (
            <Table
              head={
                <tr>
                  <th className="th">Property</th>
                  <th className="th">Unit</th>
                  <th className="th">Tenant</th>
                  <th className="th">Status</th>
                  <th className="th text-right">Rent</th>
                  <th className="th text-right">Balance</th>
                  <th className="th">Last payment</th>
                </tr>
              }
            >
              {rentRoll.map((r) => (
                <tr key={r.leaseId} className="hover:bg-slate-50/60">
                  <td className="td">
                    <span className="font-medium text-slate-900">{r.propertyName}</span>
                  </td>
                  <td className="td text-slate-500">{r.unitLabel}</td>
                  <td className="td">{r.tenantName}</td>
                  <td className="td">
                    <LeaseStatusBadge status={r.status} />
                  </td>
                  <td className="td text-right tabular-nums">
                    {formatCents(r.rentAmountCents)}
                    {r.subsidyOwedCents > 0 ? (
                      <span className="block text-xs text-slate-500">
                        {formatCents(r.tenantOwedCents)} tenant + {formatCents(r.subsidyOwedCents)} subsidy
                      </span>
                    ) : null}
                  </td>
                  <td className="td text-right tabular-nums">
                    {formatCents(r.balanceCents)}
                    {r.isLate ? (
                      <span className="ml-2 inline-block align-middle">
                        <Badge tone="red">Late</Badge>
                      </span>
                    ) : null}
                  </td>
                  <td className="td text-slate-500">
                    {r.lastPaymentDate ? (
                      <>
                        {formatDate(r.lastPaymentDate)}
                        {r.lastPaymentSource ? (
                          <span className="block text-xs">{PAYMENT_SOURCE_SHORT_LABELS[r.lastPaymentSource]}</span>
                        ) : null}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
