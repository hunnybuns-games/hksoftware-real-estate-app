import { db } from "@/lib/db";
import { assertStaff, AuthorizationError } from "@/lib/rbac";
import { toCsv, csvResponse } from "@/lib/csv";
import { centsToInputValue } from "@/lib/money";
import { toDateInputValue } from "@/lib/dates";

/**
 * A lease's charge history as CSV — backs the "Export" link on the lease
 * ledger's Charges table. Staff-only, scoped to the caller's org.
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
  if (!leaseId) return Response.json({ error: "leaseId is required." }, { status: 400 });

  const lease = await db.lease.findFirst({
    where: { id: leaseId, organizationId: ctx.organizationId },
    select: {
      tenant: { select: { firstName: true, lastName: true } },
      unit: { select: { label: true, property: { select: { name: true } } } },
    },
  });
  if (!lease) return Response.json({ error: "Lease not found." }, { status: 404 });

  const charges = await db.charge.findMany({
    where: { leaseId },
    orderBy: { dueDate: "asc" },
  });

  const csv = toCsv(charges, [
    { header: "Due date", value: (c) => toDateInputValue(c.dueDate) },
    { header: "Type", value: (c) => c.type.replace(/_/g, " ").toLowerCase() },
    { header: "Description", value: (c) => c.description },
    { header: "Amount", value: (c) => centsToInputValue(c.amountCents) },
    { header: "Voided", value: (c) => (c.voidedAt ? "Yes" : "No") },
  ]);

  const filename = `${lease.tenant.firstName}-${lease.tenant.lastName}-${lease.unit.label}-charges`
    .replace(/[^a-z0-9-]+/gi, "-")
    .toLowerCase();
  return csvResponse(csv, `${filename}.csv`);
}
