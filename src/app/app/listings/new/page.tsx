import { requireStaff } from "@/lib/rbac";
import { db } from "@/lib/db";
import { getListingUnitOptions } from "@/lib/listing-options";
import { createListingAction } from "@/actions/listings";
import { centsToInputValue } from "@/lib/money";
import { Breadcrumbs, Card, PageHeader } from "@/components/ui";
import { NewListingForm } from "../_components/new-listing-form";

export const metadata = { title: "New listing" };

export default async function NewListingPage({
  searchParams,
}: {
  searchParams: Promise<{ unitId?: string }>;
}) {
  const ctx = await requireStaff();
  const { unitId } = await searchParams;

  const units = await getListingUnitOptions(ctx.organizationId);

  // Prefilling the title and asking rent from the chosen unit saves retyping
  // what's already on file — the common path here is "click Listing from a
  // property's unit row", which arrives with unitId already set.
  const preselected = unitId ? await db.unit.findFirst({
    where: { id: unitId, property: { organizationId: ctx.organizationId } },
    select: {
      id: true,
      label: true,
      bedrooms: true,
      bathrooms: true,
      marketRentCents: true,
      property: { select: { name: true } },
    },
  }) : null;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <Breadcrumbs items={[{ label: "Listings", href: "/app/listings" }, { label: "New" }]} />
        <PageHeader title="New listing" />
      </div>

      <Card>
        <NewListingForm
          action={createListingAction}
          units={units}
          defaultUnitId={preselected?.id}
          defaultTitle={
            preselected
              ? `${preselected.bedrooms}BR/${preselected.bathrooms}BA at ${preselected.property.name} — Unit ${preselected.label}`
              : undefined
          }
          defaultAskingRent={preselected ? centsToInputValue(preselected.marketRentCents) : undefined}
        />
      </Card>
    </div>
  );
}
