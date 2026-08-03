import type { Metadata } from "next";
import { requireStaff } from "@/lib/rbac";
import { createTenantAction } from "@/actions/tenants";
import { Breadcrumbs, Card, PageHeader } from "@/components/ui";
import { TenantForm } from "../_components/tenant-form";

export const metadata: Metadata = { title: "Add a tenant" };

export default async function NewTenantPage() {
  await requireStaff();

  return (
    <div className="max-w-2xl">
      <Breadcrumbs items={[{ label: "Tenants", href: "/app/tenants" }, { label: "New" }]} />
      <PageHeader
        title="Add a tenant"
        subtitle="Just their details for now — you'll create the lease next."
      />
      <Card>
        <TenantForm
          action={createTenantAction}
          submitLabel="Add tenant"
          cancelHref="/app/tenants"
        />
      </Card>
    </div>
  );
}
