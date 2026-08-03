import type { Metadata } from "next";
import { requireStaff } from "@/lib/rbac";
import { createPropertyAction } from "@/actions/properties";
import { Breadcrumbs, Card, PageHeader } from "@/components/ui";
import { PropertyForm } from "../_components/property-form";

export const metadata: Metadata = { title: "Add a property" };

export default async function NewPropertyPage() {
  await requireStaff();

  return (
    <div className="max-w-2xl">
      <Breadcrumbs items={[{ label: "Properties", href: "/app/properties" }, { label: "New" }]} />
      <PageHeader title="Add a property" subtitle="You'll add units on the next screen." />
      <Card>
        <PropertyForm
          action={createPropertyAction}
          submitLabel="Add property"
          cancelHref="/app/properties"
        />
      </Card>
    </div>
  );
}
