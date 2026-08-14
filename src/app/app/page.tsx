import Link from "@/components/link";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/rbac";
import { getPortfolioSummary } from "@/lib/portfolio";
import { formatCents, formatCentsShort } from "@/lib/money";
import { formatDate, relativeDays } from "@/lib/dates";
import { PAYMENT_SOURCE_SHORT_LABELS } from "@/lib/payment-source";
import {
  Badge,
  Banner,
  Card,
  EmptyState,
  PageHeader,
  ReconciliationStatusBadge,
  StatTile,
  Table,
} from "@/components/ui";
import { RunRentButton } from "./_components/run-rent-button";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ welcome?: string }>;
}) {
  const ctx = await requireStaff();
  const { welcome } = await searchParams;

  const [summary, org, recentPayments, unmatchedCount] = await Promise.all([
    getPortfolioSummary({ organizationId: ctx.organizationId }),
    db.organization.findUnique({
      where: { id: ctx.organizationId },
      select: { name: true, stripeChargesEnabled: true, stripeAccountId: true },
    }),
    db.payment.findMany({
      // Queried by organizationId directly (not through `lease: {...}`) so
      // UNMATCHED payments — which have no lease — still appear here.
      where: { organizationId: ctx.organizationId },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: {
        id: true,
        amountCents: true,
        status: true,
        method: true,
        source: true,
        reconciliationStatus: true,
        paidAt: true,
        createdAt: true,
        lease: {
          select: {
            id: true,
            tenant: { select: { firstName: true, lastName: true } },
            unit: { select: { label: true, property: { select: { name: true } } } },
          },
        },
      },
    }),
    db.payment.count({
      where: { organizationId: ctx.organizationId, reconciliationStatus: "UNMATCHED" },
    }),
  ]);

  const { totals } = summary;
  const behind = summary.leases.filter((l) => l.balance.balanceCents > 0);
  const collectionRate =
    totals.chargedThisMonthCents === 0
      ? null
      : Math.min(1, totals.collectedThisMonthCents / totals.chargedThisMonthCents);

  // A brand-new account has nothing to show. Give it a path instead of four
  // zeroes and an empty table.
  if (totals.propertyCount === 0) {
    return (
      <>
        <PageHeader
          title={`Welcome${welcome ? "" : " back"}, ${ctx.name.split(" ")[0]}`}
          subtitle="Let's get your portfolio set up. It takes about five minutes."
        />
        <Card>
          <ol className="divide-y divide-slate-100">
            {[
              {
                n: 1,
                title: "Add your first property",
                body: "Start with one building or house, then add its units.",
                href: "/app/properties/new",
                cta: "Add a property",
              },
              {
                n: 2,
                title: "Add tenants and leases",
                body: "A lease links a tenant to a unit and sets the rent.",
                href: "/app/tenants/new",
                cta: "Add a tenant",
              },
              {
                n: 3,
                title: "Turn on rent collection",
                body: "Connect Stripe so residents can pay by bank transfer.",
                href: "/app/settings/payments",
                cta: "Connect Stripe",
              },
            ].map((step) => (
              <li key={step.n} className="flex flex-wrap items-center gap-4 py-4 first:pt-0 last:pb-0">
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand-50 dark:bg-brand-500/15 text-xs font-semibold text-brand-700 dark:text-brand-300">
                  {step.n}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-900">{step.title}</p>
                  <p className="text-sm text-slate-500">{step.body}</p>
                </div>
                <Link href={step.href} className="btn-secondary shrink-0">
                  {step.cta}
                </Link>
              </li>
            ))}
          </ol>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={`${totals.unitCount} unit${totals.unitCount === 1 ? "" : "s"} across ${totals.propertyCount} propert${totals.propertyCount === 1 ? "y" : "ies"}`}
        actions={<RunRentButton />}
      />

      <div className="space-y-6">
        {!org?.stripeChargesEnabled ? (
          <Banner
            tone="info"
            title="Online rent collection isn't on yet"
            action={
              <Link href="/app/settings/payments" className="btn-primary">
                {org?.stripeAccountId ? "Finish setup" : "Connect Stripe"}
              </Link>
            }
          >
            Residents can&apos;t pay through their portal until Stripe is connected. You can still
            record checks and transfers by hand.
          </Banner>
        ) : null}

        {unmatchedCount > 0 ? (
          <Banner
            tone="warning"
            title={`${unmatchedCount} payment${unmatchedCount === 1 ? "" : "s"} couldn't be matched to a lease`}
            action={
              <Link href="/app/payments" className="btn-primary">
                Review
              </Link>
            }
          >
            These came in from an import or manual entry but don&apos;t point at a tenant yet —
            they aren&apos;t counted toward anyone&apos;s balance until you assign them.
          </Banner>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Collected this month"
            value={formatCentsShort(totals.collectedThisMonthCents)}
            hint={
              collectionRate === null
                ? "No rent charged yet this month"
                : `${Math.round(collectionRate * 100)}% of ${formatCentsShort(totals.chargedThisMonthCents)} billed`
            }
            tone="positive"
          />
          <StatTile
            label="Outstanding"
            value={formatCentsShort(totals.outstandingCents)}
            hint={
              behind.length === 0
                ? "Everyone's current"
                : `${behind.length} lease${behind.length === 1 ? "" : "s"} with a balance`
            }
            tone={totals.outstandingCents > 0 ? "warning" : "default"}
          />
          <StatTile
            label="Occupancy"
            value={`${Math.round(totals.occupancyRate * 100)}%`}
            hint={`${totals.vacantCount} vacant of ${totals.unitCount}`}
          />
          <StatTile
            label="Open maintenance"
            value={String(totals.openRequests)}
            hint={totals.openRequests === 0 ? "Nothing outstanding" : "Unresolved requests"}
            tone={totals.openRequests > 0 ? "warning" : "default"}
          />
        </div>

        <Card
          title="Needs attention"
          description="Leases carrying a balance, largest first."
          padded={false}
          actions={
            <>
              <a href="/api/export/rent-roll" className="text-xs font-medium text-brand-700 dark:text-brand-300 hover:underline">
                Export CSV
              </a>
              <Link href="/app/payments" className="text-xs font-medium text-brand-700 dark:text-brand-300 hover:underline">
                All rent activity
              </Link>
            </>
          }
        >
          {behind.length === 0 ? (
            <EmptyState
              title="Nothing needs chasing"
              description="Every active lease is paid up. This is where late balances will appear."
            />
          ) : (
            <Table
              head={
                <tr>
                  <th className="th">Tenant</th>
                  <th className="th">Unit</th>
                  <th className="th text-right">Balance</th>
                  <th className="th">Due</th>
                  <th className="th"></th>
                </tr>
              }
            >
              {behind.slice(0, 8).map((lease) => (
                <tr key={lease.leaseId} className="hover:bg-slate-50/60">
                  <td className="td font-medium text-slate-900">{lease.tenantName}</td>
                  <td className="td">
                    <span className="text-slate-500">{lease.propertyName}</span> · {lease.unitLabel}
                  </td>
                  <td className="td text-right font-medium">
                    {formatCents(lease.balance.balanceCents)}
                  </td>
                  <td className="td">
                    {lease.balance.oldestUnpaidDueDate ? (
                      <span className="flex items-center gap-2">
                        <span className="text-slate-500">
                          {formatDate(lease.balance.oldestUnpaidDueDate)}
                        </span>
                        {lease.balance.isLate ? (
                          <Badge tone="red">{relativeDays(-lease.balance.daysPastDue)}</Badge>
                        ) : lease.balance.daysPastDue > 0 ? (
                          <Badge tone="amber">In grace period</Badge>
                        ) : null}
                      </span>
                    ) : (
                      "—"
                    )}
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

        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="By property" padded={false}>
            <Table
              head={
                <tr>
                  <th className="th">Property</th>
                  <th className="th text-right">Occupied</th>
                  <th className="th text-right">Monthly rent</th>
                </tr>
              }
            >
              {summary.properties.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50/60">
                  <td className="td">
                    <Link href={`/app/properties/${p.id}`} className="font-medium text-slate-900 hover:underline">
                      {p.name}
                    </Link>
                    <span className="block text-xs text-slate-500">
                      {p.city}, {p.state}
                    </span>
                  </td>
                  <td className="td text-right tabular-nums">
                    {p.occupiedCount}/{p.unitCount}
                  </td>
                  <td className="td text-right tabular-nums">
                    {formatCentsShort(p.scheduledRentCents)}
                  </td>
                </tr>
              ))}
            </Table>
          </Card>

          <Card
            title="Recent payments"
            padded={false}
            actions={
              <a href="/api/export/payments" className="text-xs font-medium text-brand-700 dark:text-brand-300 hover:underline">
                Export CSV
              </a>
            }
          >
            {recentPayments.length === 0 ? (
              <EmptyState
                title="No payments yet"
                description="Payments show up here as soon as residents pay or you record one by hand."
              />
            ) : (
              <ul className="divide-y divide-slate-100">
                {recentPayments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-4 px-5 py-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 truncate text-sm font-medium text-slate-900">
                        {p.lease ? `${p.lease.tenant.firstName} ${p.lease.tenant.lastName}` : "Unmatched"}
                        {p.reconciliationStatus !== "MATCHED" ? (
                          <ReconciliationStatusBadge status={p.reconciliationStatus} />
                        ) : null}
                      </p>
                      <p className="truncate text-xs text-slate-500">
                        {p.lease ? `${p.lease.unit.property.name} · ${p.lease.unit.label} · ` : ""}
                        {formatDate(p.paidAt ?? p.createdAt)}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-medium tabular-nums text-slate-900">
                        {formatCents(p.amountCents)}
                      </p>
                      <p className="text-xs text-slate-500">
                        {p.status === "SUCCEEDED"
                          ? PAYMENT_SOURCE_SHORT_LABELS[p.source]
                          : p.status === "PROCESSING"
                            ? "Clearing"
                            : p.status.toLowerCase()}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
