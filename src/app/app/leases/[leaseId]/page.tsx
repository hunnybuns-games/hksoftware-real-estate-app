import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireStaff, staffOrganizationIdForMetadata } from "@/lib/rbac";
import { getLeaseLedger } from "@/lib/ledger";
import { getLeaseFormOptions } from "@/lib/lease-options";
import { endLeaseAction, updateLeaseAction } from "@/actions/leases";
import { addChargeAction, recordManualPaymentAction, voidChargeAction } from "@/actions/payments";
import { centsToInputValue, formatCents } from "@/lib/money";
import { formatDate, relativeDays, toDateInputValue } from "@/lib/dates";
import { getRentSplit } from "@/lib/rent-split";
import {
  Badge,
  Banner,
  Breadcrumbs,
  Card,
  DescriptionList,
  LeaseStatusBadge,
  PageHeader,
  PaymentSourceBadge,
  PaymentStatusBadge,
  ReconciliationStatusBadge,
  StatTile,
  Table,
} from "@/components/ui";
import { ActionButton } from "@/components/action-button";
import { Disclosure } from "@/components/disclosure";
import { LeaseForm } from "../_components/lease-form";
import { RecordPaymentForm } from "./_components/record-payment-form";
import { AddChargeForm } from "./_components/add-charge-form";
import { VoidChargeButton } from "./_components/void-charge-button";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ leaseId: string }>;
}): Promise<Metadata> {
  const { leaseId } = await params;
  const organizationId = await staffOrganizationIdForMetadata();
  if (!organizationId) return { title: "Lease" };

  // Scoped the same way the page body is — a tenant's name from another org
  // must not leak into this tab's title, even for a caller who's signed in.
  const lease = await db.lease.findFirst({
    where: { id: leaseId, organizationId },
    select: { tenant: { select: { firstName: true, lastName: true } } },
  });
  return {
    title: lease ? `Lease — ${lease.tenant.firstName} ${lease.tenant.lastName}` : "Lease",
  };
}

export default async function LeaseDetailPage({
  params,
}: {
  params: Promise<{ leaseId: string }>;
}) {
  const ctx = await requireStaff();
  const { leaseId } = await params;

  const lease = await getLeaseLedger(leaseId, ctx.organizationId);
  if (!lease) notFound();

  const { units, tenants } = await getLeaseFormOptions(ctx.organizationId);
  const { balance } = lease;
  const rentSplit = getRentSplit(lease);
  const tenantName = `${lease.tenant.firstName} ${lease.tenant.lastName}`;

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumbs
          items={[
            { label: "Leases", href: "/app/leases" },
            { label: `${tenantName} — ${lease.unit.label}` },
          ]}
        />
        <PageHeader
          title={tenantName}
          subtitle={
            <>
              <Link href={`/app/properties/${lease.unit.property.id}`} className="hover:underline">
                {lease.unit.property.name}
              </Link>{" "}
              · Unit {lease.unit.label} · {formatDate(lease.startDate)} –{" "}
              {lease.endDate ? formatDate(lease.endDate) : "month-to-month"}
            </>
          }
          actions={
            <>
              <LeaseStatusBadge status={lease.status} />
              <Link href={`/app/tenants/${lease.tenant.id}`} className="btn-secondary">
                Tenant
              </Link>
            </>
          }
        />
      </div>

      {balance.isLate ? (
        <Banner
          tone="danger"
          title={`${formatCents(balance.balanceCents)} past due`}
        >
          Rent was due {formatDate(balance.oldestUnpaidDueDate)} —{" "}
          {relativeDays(-balance.daysPastDue)}. The grace period is{" "}
          {lease.organization.graceDays} day{lease.organization.graceDays === 1 ? "" : "s"}.
        </Banner>
      ) : balance.pendingCents > 0 ? (
        <Banner tone="info" title={`${formatCents(balance.pendingCents)} is clearing`}>
          A bank transfer is in flight. ACH usually settles in 3–5 business days; we&apos;ll update
          this automatically.
        </Banner>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Monthly rent" value={formatCents(lease.rentAmountCents)} hint={`Due on the ${ordinal(lease.rentDueDay)}`} />
        <StatTile label="Billed to date" value={formatCents(balance.chargedCents)} />
        <StatTile label="Collected" value={formatCents(balance.settledCents)} tone="positive" hint={balance.pendingCents > 0 ? `+ ${formatCents(balance.pendingCents)} clearing` : undefined} />
        <StatTile
          label="Balance"
          value={
            balance.balanceCents < 0
              ? `${formatCents(-balance.balanceCents)} cr`
              : formatCents(balance.balanceCents)
          }
          tone={balance.balanceCents > 0 ? (balance.isLate ? "danger" : "warning") : "positive"}
          hint={balance.balanceCents <= 0 ? "Paid up" : undefined}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <Card
            title="Charges"
            description="What this lease has been billed."
            padded={false}
            actions={
              <>
                <a href={`/api/export/charges?leaseId=${lease.id}`} className="btn-secondary">
                  Export CSV
                </a>
                <Disclosure label="Add charge">
                  <div className="w-full min-w-0">
                    <AddChargeForm action={addChargeAction.bind(null, lease.id)} />
                  </div>
                </Disclosure>
              </>
            }
          >
            {lease.charges.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-slate-500">
                No charges yet. Use <span className="font-medium">Post rent charges</span> on the
                dashboard, or add one by hand.
              </p>
            ) : (
              <Table
                head={
                  <tr>
                    <th className="th">Charge</th>
                    <th className="th">Due</th>
                    <th className="th text-right">Amount</th>
                    <th className="th"></th>
                  </tr>
                }
              >
                {lease.charges.map((charge) => (
                  <tr key={charge.id} className={charge.voidedAt ? "opacity-50" : "hover:bg-slate-50/60"}>
                    <td className="td">
                      <span className="font-medium text-slate-900">{charge.description}</span>
                      {charge.voidedAt ? (
                        <Badge tone="slate">Voided</Badge>
                      ) : charge.type !== "RENT" ? (
                        <Badge tone="neutral">{charge.type.replace("_", " ").toLowerCase()}</Badge>
                      ) : null}
                    </td>
                    <td className="td text-slate-500">{formatDate(charge.dueDate)}</td>
                    <td className="td text-right tabular-nums">{formatCents(charge.amountCents)}</td>
                    <td className="td text-right">
                      {charge.voidedAt ? null : (
                        <VoidChargeButton action={voidChargeAction.bind(null, charge.id)} />
                      )}
                    </td>
                  </tr>
                )) }
              </Table>
            )}
          </Card>

          <Card
            title="Payments"
            description="Everything received against this lease."
            padded={false}
            actions={
              <>
                <a href={`/api/export/payments?leaseId=${lease.id}`} className="btn-secondary">
                  Export CSV
                </a>
                <Disclosure label="Record payment">
                  <div className="w-full min-w-0">
                    <RecordPaymentForm
                      action={recordManualPaymentAction.bind(null, lease.id)}
                      suggestedAmount={centsToInputValue(
                        balance.balanceCents > 0 ? balance.balanceCents : lease.rentAmountCents,
                      )}
                      hasSubsidySplit={lease.subsidyOwedCents != null}
                    />
                  </div>
                </Disclosure>
              </>
            }
          >
            {lease.payments.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-slate-500">
                Nothing received yet. Residents can pay from their portal, or you can record a
                check or transfer here.
              </p>
            ) : (
              <Table
                head={
                  <tr>
                    <th className="th">Date</th>
                    <th className="th">Source</th>
                    <th className="th">Status</th>
                    <th className="th">Reconciliation</th>
                    <th className="th text-right">Amount</th>
                  </tr>
                }
              >
                {lease.payments.map((payment) => (
                  <tr key={payment.id} className="hover:bg-slate-50/60">
                    <td className="td text-slate-500">
                      {formatDate(payment.paidAt ?? payment.createdAt)}
                    </td>
                    <td className="td">
                      <PaymentSourceBadge source={payment.source} />
                      {payment.memo ? (
                        <span className="block text-xs text-slate-500">{payment.memo}</span>
                      ) : null}
                      {payment.failureMessage ? (
                        <span className="block text-xs text-red-600 dark:text-red-400">{payment.failureMessage}</span>
                      ) : null}
                    </td>
                    <td className="td">
                      <PaymentStatusBadge status={payment.status} />
                    </td>
                    <td className="td">
                      <ReconciliationStatusBadge status={payment.reconciliationStatus} />
                    </td>
                    <td className="td text-right tabular-nums">{formatCents(payment.amountCents)}</td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>

          <Card title="Lease terms">
            <LeaseForm
              action={updateLeaseAction.bind(null, lease.id)}
              units={units}
              tenants={tenants}
              defaults={{
                unitId: lease.unitId,
                tenantId: lease.tenantId,
                status: lease.status,
                startDate: toDateInputValue(lease.startDate),
                endDate: toDateInputValue(lease.endDate),
                rent: centsToInputValue(lease.rentAmountCents),
                deposit: centsToInputValue(lease.depositCents),
                rentDueDay: String(lease.rentDueDay),
                notes: lease.notes ?? "",
                subsidyOwedCents:
                  lease.subsidyOwedCents != null ? centsToInputValue(lease.subsidyOwedCents) : "",
                subsidyPayerName: lease.subsidyPayerName ?? "",
              }}
              submitLabel="Save lease"
              cancelHref="/app/leases"
            />
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Summary">
            <DescriptionList
              items={[
                { label: "Deposit held", value: formatCents(lease.depositCents) },
                { label: "Rent due", value: `${ordinal(lease.rentDueDay)} of the month` },
                {
                  label: "Grace period",
                  value: `${lease.organization.graceDays} day${lease.organization.graceDays === 1 ? "" : "s"}`,
                },
                ...(rentSplit.hasSplit
                  ? [
                      {
                        label: "Rent split",
                        value: (
                          <>
                            {formatCents(rentSplit.tenantOwedCents)} tenant +{" "}
                            {formatCents(rentSplit.subsidyOwedCents)} subsidy
                            {lease.subsidyPayerName ? (
                              <span className="block text-xs text-slate-500">
                                {lease.subsidyPayerName}
                              </span>
                            ) : null}
                          </>
                        ),
                      },
                    ]
                  : []),
                {
                  label: "Tenant email",
                  value: (
                    <a href={`mailto:${lease.tenant.email}`} className="link">
                      {lease.tenant.email}
                    </a>
                  ),
                },
                { label: "Phone", value: lease.tenant.phone || "—" },
              ]}
            />
          </Card>

          {lease.status === "ACTIVE" ? (
            <Card title="End this lease">
              <p className="mb-3 text-sm text-slate-500">
                Marks the lease ended and the unit vacant. Charges and payments stay on the record.
              </p>
              <ActionButton
                action={endLeaseAction.bind(null, lease.id)}
                label="End lease"
                pendingLabel="Ending…"
              />
            </Card>
          ) : null}

          {lease.notes ? (
            <Card title="Notes">
              <p className="text-sm whitespace-pre-wrap text-slate-700">{lease.notes}</p>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ordinal(n: number): string {
  const suffix =
    n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th";
  return `${n}${suffix}`;
}
