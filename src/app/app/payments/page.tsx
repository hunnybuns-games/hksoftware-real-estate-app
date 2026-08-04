import Link from "next/link";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/rbac";
import { getPortfolioSummary } from "@/lib/portfolio";
import { formatCents, formatCentsShort } from "@/lib/money";
import { formatDate, formatMonth, relativeDays } from "@/lib/dates";
import {
  Badge,
  Banner,
  Card,
  EmptyState,
  PageHeader,
  PaymentSourceBadge,
  PaymentStatusBadge,
  ReconciliationStatusBadge,
  StatTile,
  Table,
} from "@/components/ui";
import { RunRentButton } from "../_components/run-rent-button";

export const metadata: Metadata = { title: "Rent" };

export default async function PaymentsPage() {
  const ctx = await requireStaff();

  const [summary, payments, unmatched] = await Promise.all([
    getPortfolioSummary({ organizationId: ctx.organizationId }),
    // organizationId is queried directly (not through `lease: {...}`) so
    // UNMATCHED payments — which have no lease at all — still show up here
    // instead of silently vanishing from the activity feed.
    db.payment.findMany({
      where: { organizationId: ctx.organizationId },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        charge: { select: { description: true } },
        lease: {
          select: {
            id: true,
            tenant: { select: { firstName: true, lastName: true } },
            unit: { select: { label: true, property: { select: { name: true } } } },
          },
        },
      },
    }),
    db.payment.findMany({
      where: { organizationId: ctx.organizationId, reconciliationStatus: "UNMATCHED" },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: {
        id: true,
        amountCents: true,
        source: true,
        payerNameRaw: true,
        memo: true,
        paidAt: true,
        createdAt: true,
      },
    }),
  ]);

  const { totals } = summary;
  const behind = summary.leases.filter((l) => l.balance.balanceCents > 0);
  const rate =
    totals.chargedThisMonthCents === 0
      ? null
      : Math.min(1, totals.collectedThisMonthCents / totals.chargedThisMonthCents);

  return (
    <>
      <PageHeader
        title="Rent"
        subtitle={formatMonth(new Date())}
        actions={
          <>
            <Link href="/app/payments/import" className="btn-secondary">
              Import statement
            </Link>
            <RunRentButton />
          </>
        }
      />

      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Billed this month"
            value={formatCentsShort(totals.chargedThisMonthCents)}
          />
          <StatTile
            label="Collected this month"
            value={formatCentsShort(totals.collectedThisMonthCents)}
            hint={rate === null ? "Nothing billed yet" : `${Math.round(rate * 100)}% collected`}
            tone="positive"
          />
          <StatTile
            label="Outstanding, all time"
            value={formatCentsShort(totals.outstandingCents)}
            tone={totals.outstandingCents > 0 ? "warning" : "default"}
          />
          <StatTile
            label="Past due"
            value={String(totals.lateLeaseCount)}
            hint="Leases past the grace period"
            tone={totals.lateLeaseCount > 0 ? "danger" : "default"}
          />
        </div>

        {unmatched.length > 0 ? (
          <Banner
            tone="warning"
            title={`${unmatched.length} payment${unmatched.length === 1 ? "" : "s"} couldn't be matched to a lease`}
          >
            These came in from an import or manual entry but don&apos;t point at a tenant yet —
            they aren&apos;t counted toward anyone&apos;s balance until you assign them below.
          </Banner>
        ) : null}

        {unmatched.length > 0 ? (
          <Card title="Unmatched payments" padded={false}>
            <Table
              head={
                <tr>
                  <th className="th">Date</th>
                  <th className="th">Source</th>
                  <th className="th">Payer / memo</th>
                  <th className="th text-right">Amount</th>
                </tr>
              }
            >
              {unmatched.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50/60">
                  <td className="td whitespace-nowrap text-slate-500">
                    {formatDate(p.paidAt ?? p.createdAt)}
                  </td>
                  <td className="td">
                    <PaymentSourceBadge source={p.source} />
                  </td>
                  <td className="td text-slate-700">{p.payerNameRaw || p.memo || "—"}</td>
                  <td className="td text-right tabular-nums">{formatCents(p.amountCents)}</td>
                </tr>
              ))}
            </Table>
          </Card>
        ) : null}

        <Card title="Outstanding balances" padded={false}>
          {behind.length === 0 ? (
            <EmptyState
              title="Everyone's paid up"
              description="No lease is carrying a balance right now."
            />
          ) : (
            <Table
              head={
                <tr>
                  <th className="th">Tenant</th>
                  <th className="th">Unit</th>
                  <th className="th text-right">Rent</th>
                  <th className="th text-right">Balance</th>
                  <th className="th">Oldest due</th>
                  <th className="th"></th>
                </tr>
              }
            >
              {behind.map((lease) => (
                <tr key={lease.leaseId} className="hover:bg-slate-50/60">
                  <td className="td font-medium text-slate-900">{lease.tenantName}</td>
                  <td className="td">
                    <span className="text-slate-500">{lease.propertyName}</span> · {lease.unitLabel}
                  </td>
                  <td className="td text-right tabular-nums text-slate-500">
                    {formatCents(lease.rentAmountCents)}
                  </td>
                  <td className="td text-right font-medium tabular-nums">
                    {formatCents(lease.balance.balanceCents)}
                    {lease.balance.pendingCents > 0 ? (
                      <span className="block text-xs font-normal text-brand-700">
                        {formatCents(lease.balance.pendingCents)} clearing
                      </span>
                    ) : null}
                  </td>
                  <td className="td">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-slate-500">
                        {formatDate(lease.balance.oldestUnpaidDueDate)}
                      </span>
                      {lease.balance.isLate ? (
                        <Badge tone="red">{relativeDays(-lease.balance.daysPastDue)}</Badge>
                      ) : lease.balance.daysPastDue > 0 ? (
                        <Badge tone="amber">In grace</Badge>
                      ) : null}
                    </span>
                  </td>
                  <td className="td text-right">
                    <Link href={`/app/leases/${lease.leaseId}`} className="link">
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card
          title="Payment activity"
          description={payments.length === 100 ? "Most recent 100." : undefined}
          padded={false}
        >
          {payments.length === 0 ? (
            <EmptyState
              title="No payments yet"
              description="Once a resident pays through their portal, you record a payment, or you import a statement, it shows up here."
            />
          ) : (
            <Table
              head={
                <tr>
                  <th className="th">Date</th>
                  <th className="th">Tenant</th>
                  <th className="th">Unit</th>
                  <th className="th">Source</th>
                  <th className="th">Status</th>
                  <th className="th">Reconciliation</th>
                  <th className="th text-right">Amount</th>
                </tr>
              }
            >
              {payments.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50/60">
                  <td className="td whitespace-nowrap text-slate-500">
                    {formatDate(p.paidAt ?? p.createdAt)}
                  </td>
                  <td className="td">
                    {p.lease ? (
                      <Link href={`/app/leases/${p.lease.id}`} className="hover:underline">
                        {p.lease.tenant.firstName} {p.lease.tenant.lastName}
                      </Link>
                    ) : (
                      <span className="text-amber-700">Unmatched</span>
                    )}
                  </td>
                  <td className="td text-slate-500">
                    {p.lease ? `${p.lease.unit.property.name} · ${p.lease.unit.label}` : "—"}
                  </td>
                  <td className="td">
                    <PaymentSourceBadge source={p.source} />
                  </td>
                  <td className="td">
                    <PaymentStatusBadge status={p.status} />
                  </td>
                  <td className="td">
                    <ReconciliationStatusBadge status={p.reconciliationStatus} />
                  </td>
                  <td className="td text-right tabular-nums">{formatCents(p.amountCents)}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
