import type { Metadata } from "next";
import { requireStaff } from "@/lib/rbac";
import { createVendorAction } from "@/actions/vendors";
import { Breadcrumbs, Card, PageHeader } from "@/components/ui";
import { VendorForm } from "../_components/vendor-form";

export const metadata: Metadata = { title: "Add a vendor" };

export default async function NewVendorPage() {
  await requireStaff();

  return (
    <div className="max-w-2xl">
      <Breadcrumbs
        items={[
          { label: "Maintenance", href: "/app/maintenance" },
          { label: "Vendors", href: "/app/maintenance/vendors" },
          { label: "New" },
        ]}
      />
      <PageHeader title="Add a vendor" />
      <Card>
        <VendorForm
          action={createVendorAction}
          submitLabel="Add vendor"
          cancelHref="/app/maintenance/vendors"
        />
      </Card>
    </div>
  );
}
