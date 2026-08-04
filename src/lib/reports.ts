import { db } from "@/lib/db";
import { CREDITING_STATUSES, computeBalance } from "@/lib/ledger";
import { getRentSplit } from "@/lib/rent-split";
import type { ExpenseCategory, LeaseStatus, PaymentSource } from "@prisma/client";

/**
 * Read-only report queries, shared by the report pages and their CSV export
 * routes so the two can never disagree about what a number means. Nothing
 * here writes anything.
 */

// ---------------------------------------------------------------------------
// Rent roll — one row per lease, portfolio-wide or scoped to an owner's
// properties. `includeTenantNames: false` is what makes this safe to hand to
// an OWNER: the exact same query, just scrubbed of tenant identity, matching
// how the owner dashboard already works (see src/lib/rbac.ts's requireOwner).
// ---------------------------------------------------------------------------

export type RentRollRow = {
  leaseId: string;
  propertyName: string;
  unitLabel: string;
  tenantName: string | null;
  status: LeaseStatus;
  rentAmountCents: number;
  tenantOwedCents: number;
  subsidyOwedCents: number;
  subsidyPayerName: string | null;
  balanceCents: number;
  isLate: boolean;
  lastPaymentDate: Date | null;
  lastPaymentSource: PaymentSource | null;
};

export async function getRentRoll(args: {
  organizationId: string;
  propertyIds?: string[];
  includeTenantNames: boolean;
}): Promise<RentRollRow[]> {
  const org = await db.organization.findUnique({
    where: { id: args.organizationId },
    select: { graceDays: true },
  });
  const graceDays = org?.graceDays ?? 5;

  const leases = await db.lease.findMany({
    where: {
      organizationId: args.organizationId,
      status: { in: ["ACTIVE", "DRAFT"] },
      ...(args.propertyIds ? { unit: { propertyId: { in: args.propertyIds } } } : {}),
    },
    orderBy: [{ unit: { property: { name: "asc" } } }, { unit: { label: "asc" } }],
    include: {
      tenant: { select: { firstName: true, lastName: true } },
      unit: { select: { label: true, property: { select: { name: true } } } },
      charges: { where: { voidedAt: null } },
      payments: { orderBy: { createdAt: "desc" } },
    },
  });

  return leases.map((lease) => {
    const balance = computeBalance({ charges: lease.charges, payments: lease.payments, graceDays });
    const split = getRentSplit(lease);
    const lastPayment = lease.payments.find((p) => CREDITING_STATUSES.includes(p.status));

    return {
      leaseId: lease.id,
      propertyName: lease.unit.property.name,
      unitLabel: lease.unit.label,
      tenantName: args.includeTenantNames ? `${lease.tenant.firstName} ${lease.tenant.lastName}` : null,
      status: lease.status,
      rentAmountCents: lease.rentAmountCents,
      tenantOwedCents: split.tenantOwedCents,
      subsidyOwedCents: split.subsidyOwedCents,
      subsidyPayerName: lease.subsidyPayerName,
      balanceCents: balance.balanceCents,
      isLate: balance.isLate,
      lastPaymentDate: lastPayment ? (lastPayment.paidAt ?? lastPayment.createdAt) : null,
      lastPaymentSource: lastPayment?.source ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// Property P&L — income (payments received, by source) minus expenses (by
// category) for one property over a date range. This same function backs
// both the staff P&L view and the owner statement; the only difference
// between them is which propertyId(s) the caller is permitted to ask for,
// enforced at the page/route layer, not here.
// ---------------------------------------------------------------------------

export type PropertyPL = {
  propertyId: string;
  propertyName: string;
  from: Date;
  to: Date;
  incomeLines: {
    date: Date;
    unitLabel: string;
    source: PaymentSource;
    amountCents: number;
    memo: string | null;
  }[];
  incomeBySource: { source: PaymentSource; amountCents: number }[];
  totalIncomeCents: number;
  expenseLines: { date: Date; category: ExpenseCategory; amountCents: number; description: string }[];
  expensesByCategory: { category: ExpenseCategory; amountCents: number }[];
  totalExpensesCents: number;
  netCents: number;
};

export async function getPropertyPL(args: {
  organizationId: string;
  propertyId: string;
  from: Date;
  to: Date;
}): Promise<PropertyPL | null> {
  const property = await db.property.findFirst({
    where: { id: args.propertyId, organizationId: args.organizationId },
    select: { id: true, name: true },
  });
  if (!property) return null;

  const [payments, expenses] = await Promise.all([
    db.payment.findMany({
      where: {
        organizationId: args.organizationId,
        status: { in: CREDITING_STATUSES },
        paidAt: { gte: args.from, lt: args.to },
        lease: { unit: { propertyId: property.id } },
      },
      orderBy: { paidAt: "asc" },
      select: {
        paidAt: true,
        amountCents: true,
        source: true,
        memo: true,
        lease: { select: { unit: { select: { label: true } } } },
      },
    }),
    db.expense.findMany({
      where: { organizationId: args.organizationId, propertyId: property.id, date: { gte: args.from, lt: args.to } },
      orderBy: { date: "asc" },
    }),
  ]);

  const incomeLines = payments.map((p) => ({
    date: p.paidAt!,
    unitLabel: p.lease?.unit.label ?? "—",
    source: p.source,
    amountCents: p.amountCents,
    memo: p.memo,
  }));

  const incomeBySource = groupAmountsBySource(incomeLines);
  const totalIncomeCents = sumBy(incomeLines, (l) => l.amountCents);

  const expenseLines = expenses.map((e) => ({
    date: e.date,
    category: e.category,
    amountCents: e.amountCents,
    description: e.description,
  }));
  const expensesByCategory = groupAmountsByCategory(expenseLines);
  const totalExpensesCents = sumBy(expenseLines, (l) => l.amountCents);

  return {
    propertyId: property.id,
    propertyName: property.name,
    from: args.from,
    to: args.to,
    incomeLines,
    incomeBySource,
    totalIncomeCents,
    expenseLines,
    expensesByCategory,
    totalExpensesCents,
    netCents: totalIncomeCents - totalExpensesCents,
  };
}

function sumBy<T>(rows: T[], value: (row: T) => number): number {
  return rows.reduce((sum, row) => sum + value(row), 0);
}

function groupAmountsBySource(
  rows: { source: PaymentSource; amountCents: number }[],
): { source: PaymentSource; amountCents: number }[] {
  const totals = new Map<PaymentSource, number>();
  for (const row of rows) totals.set(row.source, (totals.get(row.source) ?? 0) + row.amountCents);
  return [...totals.entries()].map(([source, amountCents]) => ({ source, amountCents }));
}

function groupAmountsByCategory(
  rows: { category: ExpenseCategory; amountCents: number }[],
): { category: ExpenseCategory; amountCents: number }[] {
  const totals = new Map<ExpenseCategory, number>();
  for (const row of rows) totals.set(row.category, (totals.get(row.category) ?? 0) + row.amountCents);
  return [...totals.entries()].map(([category, amountCents]) => ({ category, amountCents }));
}
