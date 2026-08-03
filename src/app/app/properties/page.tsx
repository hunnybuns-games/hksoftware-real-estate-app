import Link from "next/link";
import type { Metadata } from "next";
import { requireStaff } from "@/lib/rbac";
import { getPortfolioSummary } from "@/lib/portfolio";
import { formatCentsShort } from "@/lib/money";
import { Card, EmptyState, PageHeader, Table } from "@/components/ui";

export const metadata: Metadata = { title: "Properties" };

export default async function PropertiesPage() {
  const ctx = await requireStaff();
  const summary = await getPortfolioSummary({ organizationId: ctx.organizationId });

  return (
    <>
      <PageHeader
        title="Properties"
        subtitle={
          summary.totals.propertyCount === 0
            ? undefined
            : `${summary.totals.unitCount} unit${summary.totals.unitCount === 1 ? "" : "s"}, ${summary.totals.vacantCount} vacant`
        }
        actions={
          <Link href="/app/properties/new" className="btn-primary">
            Add property
          </Link>
        }
      />

      <Card padded={false}>
        {summary.properties.length === 0 ? (
          <EmptyState
            title="No properties yet"
            description="Add a building or a single-family home, then add its units. You can rename and edit everything later."
            action={
              <Link href="/app/properties/new" className="btn-primary">
                Add your first property
              </Link>
            }
          />
        ) : (
          <Table
            head={
              <tr>
                <th className="th">Property</th>
                <th className="th">Location</th>
                <th className="th text-right">Units</th>
                <th className="th text-right">Occupied</th>
                <th className="th text-right">Monthly rent</th>
                <th className="th text-right">Outstanding</th>
              </tr>
            }
          >
            {summary.properties.map((p) => (
              <tr key={p.id} className="hover:bg-slate-50/60">
                <td className="td">
                  <Link
                    href={`/app/properties/${p.id}`}
                    className="font-medium text-slate-900 hover:underline"
                  >
                    {p.name}
                  </Link>
                  {p.openRequests > 0 ? (
                    <span className="ml-2 text-xs text-amber-700">
                      {p.openRequests} open request{p.openRequests === 1 ? "" : "s"}
                    </span>
                  ) : null}
                </td>
                <td className="td text-slate-500">
                  {p.city}, {p.state}
                </td>
                <td className="td text-right tabular-nums">{p.unitCount}</td>
                <td className="td text-right tabular-nums">
                  {p.unitCount === 0 ? (
                    <span className="text-slate-400">—</span>
                  ) : (
                    `${p.occupiedCount}/${p.unitCount}`
                  )}
                </td>
                <td className="td text-right tabular-nums">
                  {formatCentsShort(p.scheduledRentCents)}
                </td>
                <td className="td text-right tabular-nums">
                  {p.outstandingCents > 0 ? (
                    <span className="font-medium text-amber-700">
                      {formatCentsShort(p.outstandingCents)}
                    </span>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
