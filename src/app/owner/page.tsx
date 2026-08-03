import type { Metadata } from "next";
import { requireOwner } from "@/lib/rbac";
import { getPortfolioSummary } from "@/lib/portfolio";
import { formatCents, formatCentsShort } from "@/lib/money";
import { formatMonth } from "@/lib/dates";
import { Card, EmptyState, PageHeader, StatTile, Table } from "@/components/ui";

export const metadata: Metadata = { title: "Owner overview" };

/**
 * Read-only owner view. Deliberately financial-only: an owner sees what their
 * properties earned and what's outstanding, never tenant names, contact details
 * or maintenance content. If an owner needs that, they should be staff.
 */
export default async function OwnerDashboardPage() {
  const ctx = await requireOwner();

  if (ctx.propertyIds.length === 0) {
    return (
      <Card>
        <EmptyState
          title="No properties shared with you yet"
          description="Your property manager hasn't granted access to any properties. Once they do, you'll see income and occupancy here."
        />
      </Card>
    );
  }

  const summary = await getPortfolioSummary({
    organizationId: ctx.organizationId,
    propertyIds: ctx.propertyIds,
  });
  const { totals } = summary;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Your properties"
        subtitle={`${totals.unitCount} unit${totals.unitCount === 1 ? "" : "s"} · ${formatMonth(new Date())}`}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <StatTile
          label="Collected this month"
          value={formatCentsShort(totals.collectedThisMonthCents)}
          hint={`of ${formatCentsShort(totals.chargedThisMonthCents)} billed`}
          tone="positive"
        />
        <StatTile
          label="Outstanding"
          value={formatCentsShort(totals.outstandingCents)}
          hint="Unpaid across all time"
          tone={totals.outstandingCents > 0 ? "warning" : "default"}
        />
        <StatTile
          label="Occupancy"
          value={`${Math.round(totals.occupancyRate * 100)}%`}
          hint={`${totals.vacantCount} vacant of ${totals.unitCount}`}
        />
        <StatTile
          label="Monthly rent roll"
          value={formatCentsShort(totals.scheduledRentCents)}
          hint="Contracted across active leases"
        />
      </div>

      <Card title="By property" padded={false}>
        <Table
          head={
            <tr>
              <th className="th">Property</th>
              <th className="th text-right">Occupied</th>
              <th className="th text-right">Rent roll</th>
              <th className="th text-right">Collected</th>
              <th className="th text-right">Outstanding</th>
            </tr>
          }
        >
          {summary.properties.map((p) => (
            <tr key={p.id}>
              <td className="td">
                <span className="font-medium text-slate-900">{p.name}</span>
                <span className="block text-xs text-slate-500">
                  {p.city}, {p.state}
                </span>
              </td>
              <td className="td text-right tabular-nums">
                {p.occupiedCount}/{p.unitCount}
              </td>
              <td className="td text-right tabular-nums">
                {formatCents(p.scheduledRentCents)}
              </td>
              <td className="td text-right tabular-nums">{formatCents(p.collectedCents)}</td>
              <td className="td text-right tabular-nums">
                {p.outstandingCents > 0 ? (
                  <span className="font-medium text-amber-700">
                    {formatCents(p.outstandingCents)}
                  </span>
                ) : (
                  <span className="text-slate-400">—</span>
                )}
              </td>
            </tr>
          ))}
        </Table>
      </Card>

      <p className="px-1 text-xs text-slate-500">
        Collected and outstanding figures cover the full history of each property, not just this
        month. Bank transfers still clearing are counted as collected.
      </p>
    </div>
  );
}
