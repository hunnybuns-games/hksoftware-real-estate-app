import type { Metadata } from "next";
import { requireTenant } from "@/lib/rbac";
import { getTenantLeases, primaryLease } from "@/lib/tenant-view";
import { startRentPaymentAction, simulatePaymentAction } from "@/actions/tenant-payments";
import { centsToInputValue, formatCents } from "@/lib/money";
import { formatDate, ordinalDay, relativeDays } from "@/lib/dates";
import { Badge, Banner, Card, EmptyState, PaymentStatusBadge } from "@/components/ui";
import { PayRentForm } from "./_components/pay-rent-form";

export const metadata: Metadata = { title: "Rent" };

export default async function PortalHomePage({
  searchParams,
}: {
  searchParams: Promise<{ paid?: string; canceled?: string }>;
}) {
  const ctx = await requireTenant();
  const [leases, { paid, canceled }] = await Promise.all([
    getTenantLeases(ctx.tenantId),
    searchParams,
  ]);
  const lease = primaryLease(leases);

  if (!lease) {
    return (
      <Card>
        <EmptyState
          title="No lease on file yet"
          description="Once your property manager adds your lease, your rent and payment history will show up here."
        />
      </Card>
    );
  }

  const { balance } = lease;
  const owes = balance.balanceCents > 0;
  const canPayOnline = lease.organization.stripeChargesEnabled;
  const demoMode = process.env.DEMO_PAYMENTS === "true" && process.env.NODE_ENV !== "production";

  return (
    <div className="space-y-5">
      {paid ? (
        <Banner tone="success" title="Thanks — we've got your payment">
          Bank transfers take a few business days to clear. You&apos;ll get an email when it
          settles, and it&apos;ll show as “clearing” below until then.
        </Banner>
      ) : null}
      {canceled ? (
        <Banner tone="info" title="Payment canceled">
          Nothing was charged. You can start again whenever you&apos;re ready.
        </Banner>
      ) : null}

      {/* The one thing a resident comes here to find out. */}
      <div className="card p-6">
        <p className="text-sm text-slate-500">
          {lease.unit.property.name} · Unit {lease.unit.label}
        </p>
        <p className="mt-3 text-sm font-medium text-slate-500">
          {owes ? "Balance due" : "You're all paid up"}
        </p>
        <p
          className={`mt-1 text-4xl font-semibold tabular-nums ${
            balance.isLate ? "text-red-700 dark:text-red-300" : owes ? "text-slate-900" : "text-emerald-700 dark:text-emerald-300"
          }`}
        >
          {formatCents(Math.max(0, balance.balanceCents))}
        </p>

        {owes && balance.oldestUnpaidDueDate ? (
          <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-500">
            Due {formatDate(balance.oldestUnpaidDueDate)}
            {balance.isLate ? (
              <Badge tone="red">{relativeDays(-balance.daysPastDue)}</Badge>
            ) : balance.daysPastDue > 0 ? (
              <Badge tone="amber">Grace period ends soon</Badge>
            ) : null}
          </p>
        ) : (
          <p className="mt-2 text-sm text-slate-500">
            Next rent of {formatCents(lease.rentAmountCents)} is due on the{" "}
            {ordinalDay(lease.rentDueDay)}.
          </p>
        )}

        {balance.pendingCents > 0 ? (
          <p className="mt-3 rounded-lg bg-brand-50 dark:bg-brand-500/15 px-3 py-2 text-sm text-brand-900 dark:text-brand-100">
            {formatCents(balance.pendingCents)} is on its way — no need to pay it again.
          </p>
        ) : null}

        <div className="mt-6">
          {canPayOnline || demoMode ? (
            <PayRentForm
              action={startRentPaymentAction.bind(null, lease.id)}
              demoAction={demoMode ? simulatePaymentAction.bind(null, lease.id) : undefined}
              stripeReady={canPayOnline}
              defaultAmount={centsToInputValue(
                owes ? balance.balanceCents : lease.rentAmountCents,
              )}
              owes={owes}
            />
          ) : (
            <Banner tone="info" title="Online payments aren't set up yet">
              {`${lease.organization.name} hasn't finished connecting their payment account. Please contact them to arrange how to pay.`}
            </Banner>
          )}
        </div>
      </div>

      <Card title="Your charges" padded={false}>
        {lease.charges.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-slate-500">
            Nothing billed yet.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {lease.charges.slice(0, 12).map((charge) => (
              <li key={charge.id} className="flex items-center justify-between gap-4 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm text-slate-900">{charge.description}</p>
                  <p className="text-xs text-slate-500">Due {formatDate(charge.dueDate)}</p>
                </div>
                <span className="shrink-0 text-sm font-medium tabular-nums text-slate-900">
                  {formatCents(charge.amountCents)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Payment history" padded={false}>
        {lease.payments.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-slate-500">
            No payments yet. Once you pay, your receipts live here.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {lease.payments.map((payment) => (
              <li key={payment.id} className="flex items-center justify-between gap-4 px-5 py-3">
                <div className="min-w-0">
                  <p className="text-sm text-slate-900">
                    {formatDate(payment.paidAt ?? payment.createdAt)}
                  </p>
                  <p className="text-xs text-slate-500">
                    {payment.method === "ACH"
                      ? "Bank transfer"
                      : payment.method === "CARD"
                        ? "Card"
                        : "Recorded by your manager"}
                  </p>
                  {payment.failureMessage ? (
                    <p className="text-xs text-red-600 dark:text-red-400">{payment.failureMessage}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <PaymentStatusBadge status={payment.status} />
                  <span className="text-sm font-medium tabular-nums text-slate-900">
                    {formatCents(payment.amountCents)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
