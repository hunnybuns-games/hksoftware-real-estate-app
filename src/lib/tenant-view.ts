import { db } from "@/lib/db";
import { computeBalance, type LeaseBalance } from "@/lib/ledger";

/**
 * Everything the resident portal needs about a tenant's tenancy, scoped to that
 * tenant. A tenant can in principle hold more than one lease (two units, or a
 * renewal recorded as a new lease), so this returns a list and lets the caller
 * pick the current one.
 */
export async function getTenantLeases(tenantId: string) {
  const leases = await db.lease.findMany({
    where: { tenantId },
    orderBy: [{ status: "asc" }, { startDate: "desc" }],
    include: {
      charges: { where: { voidedAt: null }, orderBy: { dueDate: "desc" } },
      payments: { orderBy: { createdAt: "desc" } },
      unit: {
        select: {
          label: true,
          bedrooms: true,
          bathrooms: true,
          property: {
            select: { name: true, addressLine1: true, addressLine2: true, city: true, state: true, postalCode: true },
          },
        },
      },
      organization: {
        select: {
          id: true,
          name: true,
          graceDays: true,
          stripeChargesEnabled: true,
          stripeAccountId: true,
        },
      },
    },
  });

  return leases.map((lease) => ({
    ...lease,
    balance: computeBalance({
      charges: lease.charges,
      payments: lease.payments,
      graceDays: lease.organization.graceDays,
    }) satisfies LeaseBalance,
  }));
}

export type TenantLease = Awaited<ReturnType<typeof getTenantLeases>>[number];

/** The lease the portal should default to: the active one, else the newest. */
export function primaryLease(leases: TenantLease[]): TenantLease | undefined {
  return leases.find((l) => l.status === "ACTIVE") ?? leases[0];
}
