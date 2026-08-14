import Link from "@/components/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireStaff, staffOrganizationIdForMetadata } from "@/lib/rbac";
import { createUnitAction } from "@/actions/units";
import { createExpenseAction, deleteExpenseAction } from "@/actions/expenses";
import { formatCents, formatCentsShort } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import {
  Badge,
  Breadcrumbs,
  Card,
  EmptyState,
  PageHeader,
  StatTile,
  Table,
  UnitStatusBadge,
} from "@/components/ui";
import { Disclosure } from "@/components/disclosure";
import { UnitForm } from "../_components/unit-form";
import { ExpenseForm } from "./_components/expense-form";
import { DeleteExpenseButton } from "./_components/delete-expense-button";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ propertyId: string }>;
}): Promise<Metadata> {
  const { propertyId } = await params;
  const organizationId = await staffOrganizationIdForMetadata();
  if (!organizationId) return { title: "Property" };

  // Scoped the same way the page body is — an id from another org must not
  // leak a name into this tab's title, even for a caller who's signed in.
  const property = await db.property.findFirst({
    where: { id: propertyId, organizationId },
    select: { name: true },
  });
  return { title: property?.name ?? "Property" };
}

export default async function PropertyDetailPage({
  params,
}: {
  params: Promise<{ propertyId: string }>;
}) {
  const ctx = await requireStaff();
  const { propertyId } = await params;

  const property = await db.property.findFirst({
    where: { id: propertyId, organizationId: ctx.organizationId },
    include: {
      units: {
        orderBy: { label: "asc" },
        include: {
          leases: {
            where: { status: "ACTIVE" },
            orderBy: { startDate: "desc" },
            take: 1,
            include: { tenant: { select: { id: true, firstName: true, lastName: true } } },
          },
          _count: { select: { maintenanceRequests: { where: { status: { not: "RESOLVED" } } } } },
        },
      },
    },
  });

  if (!property) notFound();

  const expenses = await db.expense.findMany({
    where: { propertyId: property.id },
    orderBy: { date: "desc" },
    take: 20,
  });

  const occupied = property.units.filter((u) => u.status === "OCCUPIED").length;
  const scheduledRent = property.units.reduce(
    (sum, u) => sum + (u.leases[0]?.rentAmountCents ?? 0),
    0,
  );
  const marketRent = property.units.reduce((sum, u) => sum + u.marketRentCents, 0);

  // Vacancy loss is the number that makes a landlord act, and it's not obvious
  // from a list of units: what the vacant units would bring in if leased.
  const vacancyLoss = property.units
    .filter((u) => u.status !== "OCCUPIED")
    .reduce((sum, u) => sum + u.marketRentCents, 0);

  return (
    <>
      <Breadcrumbs
        items={[{ label: "Properties", href: "/app/properties" }, { label: property.name }]}
      />
      <PageHeader
        title={property.name}
        subtitle={
          <>
            {property.addressLine1}
            {property.addressLine2 ? `, ${property.addressLine2}` : ""} · {property.city},{" "}
            {property.state} {property.postalCode}
          </>
        }
        actions={
          <>
            <Link href={`/app/reports/${property.id}`} className="btn-secondary">
              P&amp;L report
            </Link>
            <Link href={`/app/properties/${property.id}/edit`} className="btn-secondary">
              Edit property
            </Link>
          </>
        }
      />

      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Units"
            value={String(property.units.length)}
            hint={`${occupied} occupied, ${property.units.length - occupied} not`}
          />
          <StatTile label="Leased rent" value={formatCentsShort(scheduledRent)} hint="Per month, active leases" />
          <StatTile label="Market rent" value={formatCentsShort(marketRent)} hint="Per month, all units" />
          <StatTile
            label="Vacancy loss"
            value={formatCentsShort(vacancyLoss)}
            hint="Monthly market rent on unleased units"
            tone={vacancyLoss > 0 ? "warning" : "default"}
          />
        </div>

        <Card
          title="Units"
          padded={false}
          actions={
            property.units.length > 0 ? (
              <Disclosure label="Add unit">
                <div className="px-1 pb-1">
                  <UnitForm
                    action={createUnitAction.bind(null, property.id)}
                    submitLabel="Add unit"
                    compact
                  />
                </div>
              </Disclosure>
            ) : null
          }
        >
          {property.units.length === 0 ? (
            <div className="px-5 py-8">
              <EmptyState
                title="No units yet"
                description="Add each rentable space. A single-family home is one unit — call it “House”."
              />
              <div className="mx-auto mt-2 max-w-xl rounded-xl border border-slate-200 bg-slate-50/60 p-5">
                <UnitForm
                  action={createUnitAction.bind(null, property.id)}
                  submitLabel="Add first unit"
                  compact
                />
              </div>
            </div>
          ) : (
            <Table
              head={
                <tr>
                  <th className="th">Unit</th>
                  <th className="th">Status</th>
                  <th className="th">Resident</th>
                  <th className="th text-right">Rent</th>
                  <th className="th text-right">Lease ends</th>
                  <th className="th"></th>
                </tr>
              }
            >
              {property.units.map((unit) => {
                const lease = unit.leases[0];
                return (
                  <tr key={unit.id} className="hover:bg-slate-50/60">
                    <td className="td">
                      <span className="font-medium text-slate-900">{unit.label}</span>
                      <span className="block text-xs text-slate-500">
                        {unit.bedrooms} bd · {unit.bathrooms} ba
                        {unit.sqft ? ` · ${unit.sqft.toLocaleString()} sqft` : ""}
                      </span>
                    </td>
                    <td className="td">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <UnitStatusBadge status={unit.status} />
                        {unit._count.maintenanceRequests > 0 ? (
                          <Badge tone="amber">{unit._count.maintenanceRequests} open</Badge>
                        ) : null}
                      </span>
                    </td>
                    <td className="td">
                      {lease ? (
                        <Link href={`/app/tenants/${lease.tenant.id}`} className="hover:underline">
                          {lease.tenant.firstName} {lease.tenant.lastName}
                        </Link>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="td text-right tabular-nums">
                      {lease ? (
                        formatCents(lease.rentAmountCents)
                      ) : (
                        <span className="text-slate-400">
                          {formatCents(unit.marketRentCents)} mkt
                        </span>
                      )}
                    </td>
                    <td className="td text-right text-slate-500">
                      {lease ? formatDate(lease.endDate) : "—"}
                    </td>
                    <td className="td text-right whitespace-nowrap">
                      {lease ? (
                        <Link href={`/app/leases/${lease.id}`} className="link mr-3">
                          Lease
                        </Link>
                      ) : (
                        <Link
                          href={`/app/leases/new?unitId=${unit.id}`}
                          className="link mr-3"
                        >
                          Lease it
                        </Link>
                      )}
                      <Link
                        href={`/app/properties/${property.id}/units/${unit.id}`}
                        className="link"
                      >
                        Edit
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </Table>
          )}
        </Card>

        <Card
          title="Expenses"
          description="Repairs, utilities, insurance, and anything else against this property."
          padded={false}
          actions={
            <>
              <a href={`/api/export/property-pl?propertyId=${property.id}`} className="btn-secondary">
                Export CSV
              </a>
              <Disclosure label="Add expense">
                <div className="w-full min-w-0">
                  <ExpenseForm action={createExpenseAction.bind(null, property.id)} />
                </div>
              </Disclosure>
            </>
          }
        >
          {expenses.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-slate-500">
              No expenses logged yet. Add one, or track them here to see a full P&amp;L.
            </p>
          ) : (
            <Table
              head={
                <tr>
                  <th className="th">Date</th>
                  <th className="th">Category</th>
                  <th className="th">Description</th>
                  <th className="th text-right">Amount</th>
                  <th className="th"></th>
                </tr>
              }
            >
              {expenses.map((expense) => (
                <tr key={expense.id} className="hover:bg-slate-50/60">
                  <td className="td text-slate-500">{formatDate(expense.date)}</td>
                  <td className="td">{expense.category.replace(/_/g, " ").toLowerCase()}</td>
                  <td className="td">{expense.description}</td>
                  <td className="td text-right tabular-nums">{formatCents(expense.amountCents)}</td>
                  <td className="td text-right">
                    <DeleteExpenseButton action={deleteExpenseAction.bind(null, expense.id)} />
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        {property.notes ? (
          <Card title="Notes">
            <p className="text-sm whitespace-pre-wrap text-slate-700">{property.notes}</p>
          </Card>
        ) : null}
      </div>
    </>
  );
}
