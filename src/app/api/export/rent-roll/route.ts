import { auth } from "@/lib/auth";
import { assertOwner } from "@/lib/rbac";
import { getRentRoll } from "@/lib/reports";
import { toCsv, csvResponse } from "@/lib/csv";
import { centsToInputValue } from "@/lib/money";
import { toDateInputValue } from "@/lib/dates";
import { PAYMENT_SOURCE_LABELS } from "@/lib/payment-source";

/**
 * Portfolio-wide rent roll. Staff get every lease with tenant names; an
 * OWNER gets the exact same query scoped to their assigned properties with
 * tenant identity stripped — matching the owner dashboard's existing rule
 * that owners never see who's renting, only the numbers.
 */
export async function GET(): Promise<Response> {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) return Response.json({ error: "Sign in required." }, { status: 401 });

  let rows;
  if (user.role === "ADMIN" || user.role === "STAFF") {
    if (!user.organizationId) return Response.json({ error: "No organization." }, { status: 403 });
    rows = await getRentRoll({ organizationId: user.organizationId, includeTenantNames: true });
  } else if (user.role === "OWNER") {
    const owner = await assertOwner();
    rows = await getRentRoll({
      organizationId: owner.organizationId,
      propertyIds: owner.propertyIds,
      includeTenantNames: false,
    });
  } else {
    return Response.json({ error: "Not permitted." }, { status: 403 });
  }

  const csv = toCsv(rows, [
    { header: "Property", value: (r) => r.propertyName },
    { header: "Unit", value: (r) => r.unitLabel },
    ...(rows.some((r) => r.tenantName !== null)
      ? [{ header: "Tenant", value: (r: typeof rows[number]) => r.tenantName ?? "" }]
      : []),
    { header: "Status", value: (r) => r.status },
    { header: "Monthly rent", value: (r) => centsToInputValue(r.rentAmountCents) },
    { header: "Tenant owed", value: (r) => centsToInputValue(r.tenantOwedCents) },
    { header: "Subsidy owed", value: (r) => centsToInputValue(r.subsidyOwedCents) },
    { header: "Subsidy payer", value: (r) => r.subsidyPayerName ?? "" },
    { header: "Balance", value: (r) => centsToInputValue(r.balanceCents) },
    { header: "Late", value: (r) => (r.isLate ? "Yes" : "No") },
    { header: "Last payment date", value: (r) => (r.lastPaymentDate ? toDateInputValue(r.lastPaymentDate) : "") },
    {
      header: "Last payment source",
      value: (r) => (r.lastPaymentSource ? PAYMENT_SOURCE_LABELS[r.lastPaymentSource] : ""),
    },
  ]);

  return csvResponse(csv, `rent-roll-${toDateInputValue(new Date())}.csv`);
}
