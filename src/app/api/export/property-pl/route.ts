import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getPropertyPL } from "@/lib/reports";
import { toCsv, csvResponse } from "@/lib/csv";
import { centsToInputValue } from "@/lib/money";
import { toDateInputValue, fromDateInputValue, startOfUtcMonth, addUtcMonths } from "@/lib/dates";
import { PAYMENT_SOURCE_LABELS } from "@/lib/payment-source";

/**
 * Per-property profit & loss for a date range. Doubles as the "owner
 * statement" — an OWNER hitting this for a property they're assigned to gets
 * exactly the same numbers a staff member would see for it; the only
 * difference is which propertyId values each role is allowed to ask for.
 * There's no tenant name anywhere in this output (income lines are
 * attributed to a unit, never a person), so it's safe for both audiences
 * as-is.
 */
export async function GET(req: Request): Promise<Response> {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) return Response.json({ error: "Sign in required." }, { status: 401 });
  if (!user.organizationId) return Response.json({ error: "No organization." }, { status: 403 });

  const url = new URL(req.url);
  const propertyId = url.searchParams.get("propertyId");
  if (!propertyId) return Response.json({ error: "propertyId is required." }, { status: 400 });

  if (user.role === "OWNER") {
    const owns = await db.propertyOwner.findFirst({
      where: { userId: user.id, propertyId },
      select: { id: true },
    });
    if (!owns) return Response.json({ error: "Not permitted." }, { status: 403 });
  } else if (user.role !== "ADMIN" && user.role !== "STAFF") {
    return Response.json({ error: "Not permitted." }, { status: 403 });
  }

  const now = new Date();
  const from = fromDateInputValue(url.searchParams.get("from") ?? "") ?? startOfUtcMonth(now);
  const to = fromDateInputValue(url.searchParams.get("to") ?? "") ?? addUtcMonths(startOfUtcMonth(now), 1);

  const pl = await getPropertyPL({ organizationId: user.organizationId, propertyId, from, to });
  if (!pl) return Response.json({ error: "Property not found." }, { status: 404 });

  const lines: { date: string; type: string; category: string; description: string; amount: string }[] = [
    ...pl.incomeLines.map((l) => ({
      date: toDateInputValue(l.date),
      type: "Income",
      category: PAYMENT_SOURCE_LABELS[l.source],
      description: `Unit ${l.unitLabel}${l.memo ? ` — ${l.memo}` : ""}`,
      amount: centsToInputValue(l.amountCents),
    })),
    ...pl.expenseLines.map((l) => ({
      date: toDateInputValue(l.date),
      type: "Expense",
      category: l.category.replace(/_/g, " "),
      description: l.description,
      amount: centsToInputValue(-l.amountCents),
    })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  lines.push(
    { date: "", type: "", category: "", description: "Total income", amount: centsToInputValue(pl.totalIncomeCents) },
    { date: "", type: "", category: "", description: "Total expenses", amount: centsToInputValue(-pl.totalExpensesCents) },
    { date: "", type: "", category: "", description: "Net", amount: centsToInputValue(pl.netCents) },
  );

  const csv = toCsv(lines, [
    { header: "Date", value: (r) => r.date },
    { header: "Type", value: (r) => r.type },
    { header: "Category", value: (r) => r.category },
    { header: "Description", value: (r) => r.description },
    { header: "Amount", value: (r) => r.amount },
  ]);

  const filename = `${pl.propertyName.replace(/[^a-z0-9]+/gi, "-")}-pl-${toDateInputValue(from)}-to-${toDateInputValue(to)}.csv`;
  return csvResponse(csv, filename);
}
