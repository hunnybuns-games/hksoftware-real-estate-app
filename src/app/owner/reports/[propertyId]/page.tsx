import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requireOwner } from "@/lib/rbac";
import { getPropertyPL } from "@/lib/reports";
import { formatCents } from "@/lib/money";
import { toDateInputValue, fromDateInputValue, startOfUtcMonth, addUtcMonths } from "@/lib/dates";
import { PAYMENT_SOURCE_LABELS } from "@/lib/payment-source";
import { Breadcrumbs, Card, EmptyState, PageHeader, StatTile, Table } from "@/components/ui";

export const metadata: Metadata = { title: "Owner statement" };

/**
 * Owner-facing statement — same numbers as the staff P&L view, scoped to a
 * property this owner is actually assigned to. No tenant names anywhere in
 * the output, matching the rest of the owner dashboard's rules.
 */
export default async function OwnerStatementPage({
  params,
  searchParams,
}: {
  params: Promise<{ propertyId: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const ctx = await requireOwner();
  const { propertyId } = await params;
  if (!ctx.propertyIds.includes(propertyId)) notFound();

  const { from: fromParam, to: toParam } = await searchParams;
  const now = new Date();
  const from = fromDateInputValue(fromParam ?? "") ?? startOfUtcMonth(now);
  const to = fromDateInputValue(toParam ?? "") ?? addUtcMonths(startOfUtcMonth(now), 1);

  const pl = await getPropertyPL({ organizationId: ctx.organizationId, propertyId, from, to });
  if (!pl) notFound();

  const exportHref = `/api/export/property-pl?propertyId=${propertyId}&from=${toDateInputValue(from)}&to=${toDateInputValue(to)}`;

  return (
    <>
      <div>
        <Breadcrumbs items={[{ label: "Your properties", href: "/owner" }, { label: pl.propertyName }]} />
        <PageHeader
          title={pl.propertyName}
          subtitle={`Statement for ${toDateInputValue(from)} – ${toDateInputValue(to)}`}
          actions={
            <a href={exportHref} className="btn-secondary">
              Export CSV
            </a>
          }
        />
      </div>

      <div className="space-y-6">
        <Card padded>
          <form method="get" className="flex flex-wrap items-end gap-3">
            <label className="text-sm">
              <span className="mb-1 block text-slate-600">From</span>
              <input type="date" name="from" defaultValue={toDateInputValue(from)} className="input" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-slate-600">To</span>
              <input type="date" name="to" defaultValue={toDateInputValue(to)} className="input" />
            </label>
            <button type="submit" className="btn-secondary">
              Update range
            </button>
          </form>
        </Card>

        <div className="grid gap-4 sm:grid-cols-3">
          <StatTile label="Income" value={formatCents(pl.totalIncomeCents)} tone="positive" />
          <StatTile label="Expenses" value={formatCents(pl.totalExpensesCents)} />
          <StatTile label="Net" value={formatCents(pl.netCents)} tone={pl.netCents >= 0 ? "positive" : "danger"} />
        </div>

        <Card title="Income" description="Payments received in this range, by source." padded={false}>
          {pl.incomeLines.length === 0 ? (
            <EmptyState title="No income in this range" description="No payments were received in this date range." />
          ) : (
            <Table
              head={
                <tr>
                  <th className="th">Date</th>
                  <th className="th">Unit</th>
                  <th className="th">Source</th>
                  <th className="th text-right">Amount</th>
                </tr>
              }
            >
              {pl.incomeLines.map((line, i) => (
                <tr key={i} className="hover:bg-slate-50/60">
                  <td className="td text-slate-500">{toDateInputValue(line.date)}</td>
                  <td className="td">{line.unitLabel}</td>
                  <td className="td">{PAYMENT_SOURCE_LABELS[line.source]}</td>
                  <td className="td text-right tabular-nums">{formatCents(line.amountCents)}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card title="Expenses" description="Logged against this property in this range." padded={false}>
          {pl.expenseLines.length === 0 ? (
            <EmptyState title="No expenses logged in this range" description="Nothing was logged against this property in this range." />
          ) : (
            <Table
              head={
                <tr>
                  <th className="th">Date</th>
                  <th className="th">Category</th>
                  <th className="th">Description</th>
                  <th className="th text-right">Amount</th>
                </tr>
              }
            >
              {pl.expenseLines.map((line, i) => (
                <tr key={i} className="hover:bg-slate-50/60">
                  <td className="td text-slate-500">{toDateInputValue(line.date)}</td>
                  <td className="td">{line.category.replace(/_/g, " ").toLowerCase()}</td>
                  <td className="td">{line.description}</td>
                  <td className="td text-right tabular-nums">{formatCents(line.amountCents)}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
