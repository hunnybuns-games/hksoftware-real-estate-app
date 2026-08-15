import { db } from "@/lib/db";
import { computeBalance, nextScheduledCharge, type LeaseBalance } from "@/lib/ledger";
import { startOfUtcMonth } from "@/lib/dates";

/**
 * One query pass that produces everything the dashboards show. Both the staff
 * dashboard and the owner dashboard read from here so the two can never
 * disagree about how much rent was collected.
 *
 * `propertyIds` narrows the result to a subset — that's how an OWNER is limited
 * to their own properties without a second code path.
 */

export type PropertySummary = {
  id: string;
  name: string;
  city: string;
  state: string;
  unitCount: number;
  occupiedCount: number;
  vacantCount: number;
  maintenanceCount: number;
  /** Contracted monthly rent across active leases. */
  scheduledRentCents: number;
  chargedCents: number;
  collectedCents: number;
  outstandingCents: number;
  openRequests: number;
};

export type LeaseSummary = {
  leaseId: string;
  tenantName: string;
  tenantEmail: string;
  propertyId: string;
  propertyName: string;
  unitLabel: string;
  rentAmountCents: number;
  balance: LeaseBalance;
  /** Next rent owed — from an unpaid charge already billed, or a projected future period. */
  nextDue: { dueDate: Date; amountCents: number } | null;
};

export type PortfolioSummary = {
  properties: PropertySummary[];
  leases: LeaseSummary[];
  totals: {
    propertyCount: number;
    unitCount: number;
    occupiedCount: number;
    vacantCount: number;
    occupancyRate: number;
    scheduledRentCents: number;
    /** Charged and collected across all time. */
    chargedCents: number;
    collectedCents: number;
    outstandingCents: number;
    /** This calendar month only — the number a landlord actually asks for. */
    collectedThisMonthCents: number;
    chargedThisMonthCents: number;
    openRequests: number;
    lateLeaseCount: number;
  };
};

export async function getPortfolioSummary(args: {
  organizationId: string;
  propertyIds?: string[];
}): Promise<PortfolioSummary> {
  const propertyFilter = args.propertyIds ? { id: { in: args.propertyIds } } : {};

  const [org, properties] = await Promise.all([
    db.organization.findUnique({
      where: { id: args.organizationId },
      select: { graceDays: true },
    }),
    db.property.findMany({
      where: { organizationId: args.organizationId, ...propertyFilter },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        city: true,
        state: true,
        units: {
          select: {
            id: true,
            label: true,
            status: true,
            _count: { select: { maintenanceRequests: { where: { status: { not: "RESOLVED" } } } } },
            leases: {
              select: {
                id: true,
                status: true,
                startDate: true,
                endDate: true,
                rentAmountCents: true,
                rentDueDay: true,
                tenant: { select: { firstName: true, lastName: true, email: true } },
                charges: {
                  where: { voidedAt: null },
                  select: { amountCents: true, dueDate: true, voidedAt: true },
                },
                payments: {
                  select: { amountCents: true, status: true, paidAt: true },
                },
              },
            },
          },
        },
      },
    }),
  ]);

  const graceDays = org?.graceDays ?? 5;
  const monthStart = startOfUtcMonth(new Date());

  const propertySummaries: PropertySummary[] = [];
  const leaseSummaries: LeaseSummary[] = [];

  let collectedThisMonthCents = 0;
  let chargedThisMonthCents = 0;
  let lateLeaseCount = 0;

  for (const property of properties) {
    let occupied = 0;
    let vacant = 0;
    let maintenance = 0;
    let scheduledRent = 0;
    let charged = 0;
    let collected = 0;
    let openRequests = 0;

    for (const unit of property.units) {
      if (unit.status === "OCCUPIED") occupied += 1;
      else if (unit.status === "VACANT") vacant += 1;
      else maintenance += 1;
      openRequests += unit._count.maintenanceRequests;

      for (const lease of unit.leases) {
        if (lease.status === "ACTIVE") scheduledRent += lease.rentAmountCents;

        const balance = computeBalance({
          charges: lease.charges,
          payments: lease.payments,
          graceDays,
        });

        charged += balance.chargedCents;
        collected += balance.paidCents;

        for (const charge of lease.charges) {
          if (charge.dueDate.getTime() >= monthStart.getTime()) {
            chargedThisMonthCents += charge.amountCents;
          }
        }
        for (const payment of lease.payments) {
          if (
            (payment.status === "SUCCEEDED" || payment.status === "PROCESSING") &&
            payment.paidAt &&
            payment.paidAt.getTime() >= monthStart.getTime()
          ) {
            collectedThisMonthCents += payment.amountCents;
          }
        }

        // Ended leases with a settled balance are history; don't surface them.
        if (lease.status === "ENDED" && balance.balanceCents <= 0) continue;

        if (balance.isLate) lateLeaseCount += 1;

        leaseSummaries.push({
          leaseId: lease.id,
          tenantName: `${lease.tenant.firstName} ${lease.tenant.lastName}`,
          tenantEmail: lease.tenant.email,
          propertyId: property.id,
          propertyName: property.name,
          unitLabel: unit.label,
          rentAmountCents: lease.rentAmountCents,
          balance,
          nextDue: nextScheduledCharge(lease, lease.charges, balance),
        });
      }
    }

    propertySummaries.push({
      id: property.id,
      name: property.name,
      city: property.city,
      state: property.state,
      unitCount: property.units.length,
      occupiedCount: occupied,
      vacantCount: vacant,
      maintenanceCount: maintenance,
      scheduledRentCents: scheduledRent,
      chargedCents: charged,
      collectedCents: collected,
      outstandingCents: Math.max(0, charged - collected),
      openRequests,
    });
  }

  const unitCount = propertySummaries.reduce((s, p) => s + p.unitCount, 0);
  const occupiedCount = propertySummaries.reduce((s, p) => s + p.occupiedCount, 0);
  const chargedCents = propertySummaries.reduce((s, p) => s + p.chargedCents, 0);
  const collectedCents = propertySummaries.reduce((s, p) => s + p.collectedCents, 0);

  return {
    properties: propertySummaries,
    // Worst offenders first — that's what a manager opens the dashboard to find.
    leases: leaseSummaries.sort((a, b) => b.balance.balanceCents - a.balance.balanceCents),
    totals: {
      propertyCount: propertySummaries.length,
      unitCount,
      occupiedCount,
      vacantCount: propertySummaries.reduce((s, p) => s + p.vacantCount, 0),
      occupancyRate: unitCount === 0 ? 0 : occupiedCount / unitCount,
      scheduledRentCents: propertySummaries.reduce((s, p) => s + p.scheduledRentCents, 0),
      chargedCents,
      collectedCents,
      outstandingCents: Math.max(0, chargedCents - collectedCents),
      collectedThisMonthCents,
      chargedThisMonthCents,
      openRequests: propertySummaries.reduce((s, p) => s + p.openRequests, 0),
      lateLeaseCount,
    },
  };
}
