import { db } from "@/lib/db";
import { assertStaff, AuthorizationError } from "@/lib/rbac";
import { toCsv, csvResponse } from "@/lib/csv";
import { centsToInputValue } from "@/lib/money";
import { toDateInputValue } from "@/lib/dates";
import { PAYMENT_SOURCE_LABELS, RECONCILIATION_STATUS_LABELS } from "@/lib/payment-source";
import type { PaymentReconciliationStatus, PaymentStatus } from "@prisma/client";

/**
 * Payment activity export — the same rows shown on the Rent page's "Payment
 * activity" table and the "Unmatched payments" panel, as CSV. `leaseId`
 * narrows to one lease's payments (what the lease ledger's export link
 * uses); `status` narrows to a reconciliation status (what the unmatched
 * panel's export link uses). Staff-only: this is the org's internal ledger,
 * not something owners or tenants see a raw feed of.
 */
export async function GET(req: Request): Promise<Response> {
  let ctx;
  try {
    ctx = await assertStaff();
  } catch (err) {
    if (err instanceof AuthorizationError) return Response.json({ error: err.message }, { status: 403 });
    throw err;
  }

  const url = new URL(req.url);
  const leaseId = url.searchParams.get("leaseId");
  const status = url.searchParams.get("status") as PaymentReconciliationStatus | null;

  const payments = await db.payment.findMany({
    where: {
      organizationId: ctx.organizationId,
      ...(leaseId ? { leaseId } : {}),
      ...(status ? { reconciliationStatus: status } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: {
      lease: {
        select: {
          tenant: { select: { firstName: true, lastName: true } },
          unit: { select: { label: true, property: { select: { name: true } } } },
        },
      },
    },
  });

  const csv = toCsv(payments, [
    { header: "Date", value: (p) => toDateInputValue(p.paidAt ?? p.createdAt) },
    {
      header: "Tenant",
      value: (p) => (p.lease ? `${p.lease.tenant.firstName} ${p.lease.tenant.lastName}` : ""),
    },
    {
      header: "Property",
      value: (p) => (p.lease ? p.lease.unit.property.name : ""),
    },
    { header: "Unit", value: (p) => (p.lease ? p.lease.unit.label : "") },
    { header: "Source", value: (p) => PAYMENT_SOURCE_LABELS[p.source] },
    { header: "Status", value: (p) => paymentStatusLabel(p.status) },
    { header: "Reconciliation", value: (p) => RECONCILIATION_STATUS_LABELS[p.reconciliationStatus] },
    { header: "Amount", value: (p) => centsToInputValue(p.amountCents) },
    { header: "Payer / memo", value: (p) => p.payerNameRaw || p.memo || "" },
  ]);

  return csvResponse(csv, `payments-${toDateInputValue(new Date())}.csv`);
}

const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  SUCCEEDED: "Paid",
  PROCESSING: "Clearing",
  PENDING: "Awaiting payment",
  FAILED: "Failed",
  REFUNDED: "Refunded",
};

function paymentStatusLabel(status: PaymentStatus): string {
  return PAYMENT_STATUS_LABELS[status];
}
