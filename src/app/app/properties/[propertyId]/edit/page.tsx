import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/rbac";
import { deletePropertyAction, updatePropertyAction } from "@/actions/properties";
import { Breadcrumbs, Card, PageHeader } from "@/components/ui";
import { DangerAction } from "@/components/danger-action";
import { PropertyForm } from "../../_components/property-form";

export const metadata: Metadata = { title: "Edit property" };

export default async function EditPropertyPage({
  params,
}: {
  params: Promise<{ propertyId: string }>;
}) {
  const ctx = await requireStaff();
  const { propertyId } = await params;

  const property = await db.property.findFirst({
    where: { id: propertyId, organizationId: ctx.organizationId },
    include: { _count: { select: { units: true } } },
  });
  if (!property) notFound();

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <Breadcrumbs
          items={[
            { label: "Properties", href: "/app/properties" },
            { label: property.name, href: `/app/properties/${property.id}` },
            { label: "Edit" },
          ]}
        />
        <PageHeader title="Edit property" />
        <Card>
          <PropertyForm
            action={updatePropertyAction.bind(null, property.id)}
            defaults={{
              name: property.name,
              addressLine1: property.addressLine1,
              addressLine2: property.addressLine2 ?? "",
              city: property.city,
              state: property.state,
              postalCode: property.postalCode,
              notes: property.notes ?? "",
            }}
            submitLabel="Save changes"
            cancelHref={`/app/properties/${property.id}`}
          />
        </Card>
      </div>

      <Card title="Delete this property">
        <DangerAction
          action={deletePropertyAction.bind(null, property.id)}
          label="Delete property"
          confirmLabel="Yes, delete it"
          description={
            property._count.units > 0
              ? `This will also delete ${property._count.units} unit${property._count.units === 1 ? "" : "s"} and their history. Properties with active leases can't be deleted.`
              : "This property has no units yet, so nothing else will be affected."
          }
        />
      </Card>
    </div>
  );
}
