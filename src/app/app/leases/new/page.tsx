import Link from "@/components/link";
import type { Metadata } from "next";
import { requireStaff } from "@/lib/rbac";
import { createLeaseAction } from "@/actions/leases";
import { getLeaseFormOptions } from "@/lib/lease-options";
import { toDateInputValue, startOfUtcMonth, addUtcMonths } from "@/lib/dates";
import { Banner, Breadcrumbs, Card, EmptyState, PageHeader } from "@/components/ui";
import { LeaseForm } from "../_components/lease-form";

export const metadata: Metadata = { title: "New lease" };

export default async function NewLeasePage({
  searchParams,
}: {
  searchParams: Promise<{ unitId?: string; tenantId?: string; applicationId?: string }>;
}) {
  const ctx = await requireStaff();
  const [{ units, tenants }, { unitId, tenantId, applicationId }] = await Promise.all([
    getLeaseFormOptions(ctx.organizationId),
    searchParams,
  ]);

  // Can't create a lease without both sides of it. Say which one is missing
  // rather than showing two empty dropdowns.
  if (units.length === 0 || tenants.length === 0) {
    return (
      <div className="max-w-2xl">
        <Breadcrumbs items={[{ label: "Leases", href: "/app/leases" }, { label: "New" }]} />
        <PageHeader title="New lease" />
        <Card>
          <EmptyState
            title={units.length === 0 ? "Add a unit first" : "Add a tenant first"}
            description={
              units.length === 0
                ? "A lease needs a unit to attach to. Add a property and at least one unit, then come back."
                : "A lease needs a tenant. Add the person renting the unit, then come back."
            }
            action={
              units.length === 0 ? (
                <Link href="/app/properties/new" className="btn-primary">
                  Add a property
                </Link>
              ) : (
                <Link href="/app/tenants/new" className="btn-primary">
                  Add a tenant
                </Link>
              )
            }
          />
        </Card>
      </div>
    );
  }

  const selectedUnit = unitId ? units.find((u) => u.id === unitId) : undefined;
  // Default to the 1st of next month: leases signed mid-month almost always
  // start then, and prorating a partial first month is out of scope for v1.
  const nextMonth = addUtcMonths(startOfUtcMonth(new Date()), 1);

  return (
    <div className="max-w-3xl">
      <Breadcrumbs items={[{ label: "Leases", href: "/app/leases" }, { label: "New" }]} />
      <PageHeader
        title="New lease"
        subtitle="Creating an active lease marks the unit occupied and starts billing rent."
      />
      {applicationId ? (
        <div className="mb-6">
          <Banner tone="info" title="Creating this lease from an approved application">
            Unit and tenant are filled in from the application. Everything else — dates, rent,
            deposit — is still yours to set.
          </Banner>
        </div>
      ) : null}
      <Card>
        <LeaseForm
          action={createLeaseAction}
          units={units}
          tenants={tenants}
          hiddenFields={applicationId ? { applicationId } : undefined}
          defaults={{
            unitId: selectedUnit?.id ?? "",
            tenantId: tenantId ?? "",
            status: "ACTIVE",
            startDate: toDateInputValue(nextMonth),
            endDate: toDateInputValue(addUtcMonths(nextMonth, 12)),
            rent: selectedUnit?.marketRent ?? "",
            deposit: selectedUnit?.marketRent ?? "",
            rentDueDay: "1",
            notes: "",
            subsidyOwedCents: "",
            subsidyPayerName: "",
          }}
          submitLabel="Create lease"
          cancelHref="/app/leases"
        />
      </Card>
    </div>
  );
}
