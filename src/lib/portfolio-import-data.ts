import { db } from "@/lib/db";
import type { ExistingPortfolio } from "@/lib/portfolio-import";

/**
 * Loads the snapshot of what an organization already has, for planImport().
 *
 * Its own file for two reasons, one per neighbour it must not live in:
 *
 * - Not in src/actions/portfolio-import.ts: every export from a "use server"
 *   module is a callable Server Action endpoint, and this takes an
 *   organizationId with no session check of its own — the callers (a page
 *   and an action) have already established theirs. See docs/MAINTAINER.md §4.
 * - Not in src/lib/portfolio-import.ts: that module is imported by the
 *   mapping form, a client component, so anything in it is bundled for the
 *   browser — and `db` pulls in better-sqlite3, which needs `fs`. Moving this
 *   function there broke the import page (caught by e2e:portfolio-import).
 */
export async function loadExistingPortfolio(organizationId: string): Promise<ExistingPortfolio> {
  const [properties, units, tenants, activeLeases] = await Promise.all([
    db.property.findMany({ where: { organizationId }, select: { id: true, name: true } }),
    db.unit.findMany({
      where: { property: { organizationId } },
      select: { id: true, propertyId: true, label: true },
    }),
    db.tenant.findMany({ where: { organizationId }, select: { id: true, email: true } }),
    db.lease.findMany({
      where: { organizationId, status: "ACTIVE" },
      select: { unitId: true, tenantId: true },
    }),
  ]);
  return { properties, units, tenants, activeLeases };
}
