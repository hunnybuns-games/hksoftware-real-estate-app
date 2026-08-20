import type { Metadata } from "next";
import Link from "@/components/link";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/rbac";
import { setVendorActiveAction } from "@/actions/vendors";
import { Breadcrumbs, Card, EmptyState, PageHeader, Table } from "@/components/ui";
import { VendorRow } from "./_components/vendor-row";

export const metadata: Metadata = { title: "Vendors" };

export default async function VendorsPage() {
  const ctx = await requireStaff();

  const vendors = await db.vendor.findMany({
    where: { organizationId: ctx.organizationId },
    // Active first, then alphabetical — archived vendors are still here to
    // find, just not competing for attention at the top.
    orderBy: [{ active: "desc" }, { name: "asc" }],
    select: { id: true, name: true, trade: true, contactName: true, email: true, phone: true, active: true },
  });

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumbs items={[{ label: "Maintenance", href: "/app/maintenance" }, { label: "Vendors" }]} />
        <PageHeader
          title="Vendors"
          subtitle="Your directory of contractors — who to call, not a marketplace."
          actions={
            <Link href="/app/maintenance/vendors/new" className="btn-primary">
              Add vendor
            </Link>
          }
        />
      </div>

      <Card padded={false}>
        {vendors.length === 0 ? (
          <EmptyState
            title="No vendors yet"
            description="Add a plumber, an electrician, a handyman — anyone you'd assign a maintenance request to."
          />
        ) : (
          <Table
            head={
              <tr>
                <th className="th">Vendor</th>
                <th className="th">Trade</th>
                <th className="th">Contact</th>
                <th className="th"></th>
              </tr>
            }
          >
            {vendors.map((vendor) => (
              <VendorRow
                key={vendor.id}
                vendor={vendor}
                toggleActiveAction={setVendorActiveAction.bind(null, vendor.id, !vendor.active)}
              />
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
