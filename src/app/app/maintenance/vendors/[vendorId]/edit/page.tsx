import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireStaff, staffOrganizationIdForMetadata } from "@/lib/rbac";
import { setVendorActiveAction, updateVendorAction } from "@/actions/vendors";
import { Breadcrumbs, Card, PageHeader } from "@/components/ui";
import { ActionButton } from "@/components/action-button";
import { VendorForm } from "../../_components/vendor-form";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ vendorId: string }>;
}): Promise<Metadata> {
  const { vendorId } = await params;
  const organizationId = await staffOrganizationIdForMetadata();
  if (!organizationId) return { title: "Edit vendor" };

  const vendor = await db.vendor.findFirst({
    where: { id: vendorId, organizationId },
    select: { name: true },
  });
  return { title: vendor ? `Edit ${vendor.name}` : "Edit vendor" };
}

export default async function EditVendorPage({
  params,
}: {
  params: Promise<{ vendorId: string }>;
}) {
  const ctx = await requireStaff();
  const { vendorId } = await params;

  const vendor = await db.vendor.findFirst({
    where: { id: vendorId, organizationId: ctx.organizationId },
  });
  if (!vendor) notFound();

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <Breadcrumbs
          items={[
            { label: "Maintenance", href: "/app/maintenance" },
            { label: "Vendors", href: "/app/maintenance/vendors" },
            { label: vendor.name },
          ]}
        />
        <PageHeader title={`Edit ${vendor.name}`} />
        <Card>
          <VendorForm
            action={updateVendorAction.bind(null, vendor.id)}
            defaults={{
              name: vendor.name,
              trade: vendor.trade ?? "",
              contactName: vendor.contactName ?? "",
              email: vendor.email ?? "",
              phone: vendor.phone ?? "",
              notes: vendor.notes ?? "",
            }}
            submitLabel="Save changes"
            cancelHref="/app/maintenance/vendors"
          />
        </Card>
      </div>

      <Card title={vendor.active ? "Archive this vendor" : "Reactivate this vendor"}>
        <p className="mb-3 text-sm text-slate-500">
          {vendor.active
            ? "Removes them from the picker on new requests. Past requests still show they were assigned."
            : "Makes them assignable to requests again."}
        </p>
        <ActionButton
          action={setVendorActiveAction.bind(null, vendor.id, !vendor.active)}
          label={vendor.active ? "Archive vendor" : "Reactivate vendor"}
          pendingLabel="Saving…"
          variant={vendor.active ? "danger" : "secondary"}
        />
      </Card>
    </div>
  );
}
