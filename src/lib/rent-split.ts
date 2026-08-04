/**
 * Subsidized (e.g. Section 8/HAP) rent arrangements. The tenant-owed portion
 * is always *derived* from rentAmountCents - subsidyOwedCents rather than
 * stored separately (see the Lease model comment in schema.prisma) — this is
 * the one place that derivation happens, so nothing else needs to repeat it.
 */

export type RentSplit = {
  hasSplit: boolean;
  totalCents: number;
  tenantOwedCents: number;
  subsidyOwedCents: number;
};

export function getRentSplit(lease: {
  rentAmountCents: number;
  subsidyOwedCents: number | null;
}): RentSplit {
  if (lease.subsidyOwedCents == null) {
    return {
      hasSplit: false,
      totalCents: lease.rentAmountCents,
      tenantOwedCents: lease.rentAmountCents,
      subsidyOwedCents: 0,
    };
  }
  // Clamp so a subsidy figure that's drifted above the current rent (e.g.
  // rent was reduced after the split was set) can never make the tenant's
  // derived portion negative.
  const subsidyOwedCents = Math.min(lease.subsidyOwedCents, lease.rentAmountCents);
  return {
    hasSplit: true,
    totalCents: lease.rentAmountCents,
    tenantOwedCents: lease.rentAmountCents - subsidyOwedCents,
    subsidyOwedCents,
  };
}
