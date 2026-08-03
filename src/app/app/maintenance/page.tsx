import Link from "next/link";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/rbac";
import { createStaffRequestAction } from "@/actions/maintenance";
import { formatDate } from "@/lib/dates";
import {
  Card,
  EmptyState,
  MaintenanceStatusBadge,
  PageHeader,
  PriorityBadge,
  Table,
} from "@/components/ui";
import { Disclosure } from "@/components/disclosure";
import { StaffRequestForm } from "./_components/staff-request-form";

export const metadata: Metadata = { title: "Maintenance" };

const FILTERS = [
  { key: "open", label: "Open" },
  { key: "all", label: "All" },
  { key: "resolved", label: "Resolved" },
] as const;

type FilterKey = (typeof FILTERS)[number]["key"];

export default async function MaintenancePage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const ctx = await requireStaff();
  const { filter: rawFilter } = await searchParams;
  const filter: FilterKey = FILTERS.some((f) => f.key === rawFilter)
    ? (rawFilter as FilterKey)
    : "open";

  const statusWhere =
    filter === "open"
      ? { status: { not: "RESOLVED" as const } }
      : filter === "resolved"
        ? { status: "RESOLVED" as const }
        : {};

  const [requests, units, counts] = await Promise.all([
    db.maintenanceRequest.findMany({
      where: { organizationId: ctx.organizationId, ...statusWhere },
      // Urgent first, then oldest — a two-week-old "normal" ticket is a real
      // problem, and sorting purely by date buries emergencies.
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
      include: {
        unit: { select: { label: true, property: { select: { name: true } } } },
        lease: { select: { tenant: { select: { firstName: true, lastName: true } } } },
        _count: { select: { photos: true, notes: true } },
      },
    }),
    db.unit.findMany({
      where: { property: { organizationId: ctx.organizationId } },
      orderBy: [{ property: { name: "asc" } }, { label: "asc" }],
      select: { id: true, label: true, property: { select: { name: true } } },
    }),
    db.maintenanceRequest.groupBy({
      by: ["status"],
      where: { organizationId: ctx.organizationId },
      _count: true,
    }),
  ]);

  const openCount = counts
    .filter((c) => c.status !== "RESOLVED")
    .reduce((sum, c) => sum + c._count, 0);

  return (
    <>
      <PageHeader
        title="Maintenance"
        subtitle={
          openCount === 0 ? "Nothing open right now" : `${openCount} open request${openCount === 1 ? "" : "s"}`
        }
        actions={
          units.length > 0 ? (
            <Disclosure label="Log a request" variant="primary">
              <div className="card max-w-2xl p-5">
                <StaffRequestForm action={createStaffRequestAction} units={units} />
              </div>
            </Disclosure>
          ) : null
        }
      />

      <div className="mb-4 flex gap-1">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={`/app/maintenance?filter=${f.key}`}
            aria-current={filter === f.key ? "page" : undefined}
            className={
              filter === f.key
                ? "rounded-lg bg-brand-50 px-3 py-1.5 text-sm font-medium text-brand-800"
                : "rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
            }
          >
            {f.label}
          </Link>
        ))}
      </div>

      <Card padded={false}>
        {requests.length === 0 ? (
          <EmptyState
            title={filter === "open" ? "No open requests" : "Nothing here"}
            description={
              filter === "open"
                ? "When a resident submits a request from their portal, it lands here and you get an email."
                : "Try a different filter."
            }
          />
        ) : (
          <Table
            head={
              <tr>
                <th className="th">Request</th>
                <th className="th">Unit</th>
                <th className="th">Resident</th>
                <th className="th">Priority</th>
                <th className="th">Status</th>
                <th className="th">Opened</th>
              </tr>
            }
          >
            {requests.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50/60">
                <td className="td">
                  <Link
                    href={`/app/maintenance/${r.id}`}
                    className="font-medium text-slate-900 hover:underline"
                  >
                    {r.title}
                  </Link>
                  {r._count.photos > 0 || r._count.notes > 0 ? (
                    <span className="block text-xs text-slate-500">
                      {[
                        r._count.photos > 0
                          ? `${r._count.photos} photo${r._count.photos === 1 ? "" : "s"}`
                          : null,
                        r._count.notes > 0
                          ? `${r._count.notes} note${r._count.notes === 1 ? "" : "s"}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  ) : null}
                </td>
                <td className="td text-slate-500">
                  {r.unit.property.name} · {r.unit.label}
                </td>
                <td className="td">
                  {r.lease
                    ? `${r.lease.tenant.firstName} ${r.lease.tenant.lastName}`
                    : <span className="text-slate-400">—</span>}
                </td>
                <td className="td">
                  <PriorityBadge priority={r.priority} />
                </td>
                <td className="td">
                  <MaintenanceStatusBadge status={r.status} />
                </td>
                <td className="td whitespace-nowrap text-slate-500">{formatDate(r.createdAt)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
