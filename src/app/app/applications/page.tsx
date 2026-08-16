import Link from "@/components/link";
import type { Metadata } from "next";
import type { ApplicationStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/rbac";
import { formatDate } from "@/lib/dates";
import { ApplicationStatusBadge, Card, EmptyState, PageHeader, Table } from "@/components/ui";

export const metadata: Metadata = { title: "Applications" };

const FILTERS = [
  { key: "open", label: "Needs review" },
  { key: "all", label: "All" },
  { key: "approved", label: "Approved" },
  { key: "denied", label: "Denied" },
] as const;

type FilterKey = (typeof FILTERS)[number]["key"];

export default async function ApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const ctx = await requireStaff();
  const { filter: rawFilter } = await searchParams;
  const filter: FilterKey = FILTERS.some((f) => f.key === rawFilter)
    ? (rawFilter as FilterKey)
    : "open";

  const statusWhere: { status?: ApplicationStatus | { in: ApplicationStatus[] } } =
    filter === "open"
      ? { status: { in: ["SUBMITTED", "UNDER_REVIEW"] } }
      : filter === "approved"
        ? { status: "APPROVED" }
        : filter === "denied"
          ? { status: "DENIED" }
          : {};

  const [applications, openCount] = await Promise.all([
    db.application.findMany({
      where: { organizationId: ctx.organizationId, ...statusWhere },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        status: true,
        desiredMoveInDate: true,
        createdAt: true,
        unit: { select: { label: true, property: { select: { name: true } } } },
      },
    }),
    db.application.count({
      where: { organizationId: ctx.organizationId, status: { in: ["SUBMITTED", "UNDER_REVIEW"] } },
    }),
  ]);

  return (
    <>
      <PageHeader
        title="Applications"
        subtitle={
          openCount === 0
            ? "Nothing waiting on review"
            : `${openCount} application${openCount === 1 ? "" : "s"} need review`
        }
      />

      <div className="mb-4 flex gap-1">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={`/app/applications?filter=${f.key}`}
            aria-current={filter === f.key ? "page" : undefined}
            className={
              filter === f.key
                ? "rounded-lg bg-brand-50 dark:bg-brand-500/15 px-3 py-1.5 text-sm font-medium text-brand-800 dark:text-brand-200"
                : "rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
            }
          >
            {f.label}
          </Link>
        ))}
      </div>

      <Card padded={false}>
        {applications.length === 0 ? (
          <EmptyState
            title={filter === "open" ? "No applications need review" : "Nothing here"}
            description={
              filter === "open"
                ? "Share a unit's application link — from its property page — and submissions will land here."
                : "Try a different filter."
            }
          />
        ) : (
          <Table
            head={
              <tr>
                <th className="th">Applicant</th>
                <th className="th">Unit</th>
                <th className="th">Desired move-in</th>
                <th className="th">Status</th>
                <th className="th">Submitted</th>
              </tr>
            }
          >
            {applications.map((a) => (
              <tr key={a.id} className="hover:bg-slate-50/60">
                <td className="td">
                  <Link
                    href={`/app/applications/${a.id}`}
                    className="font-medium text-slate-900 hover:underline"
                  >
                    {a.firstName} {a.lastName}
                  </Link>
                </td>
                <td className="td text-slate-500">
                  {a.unit.property.name} · {a.unit.label}
                </td>
                <td className="td text-slate-500">
                  {a.desiredMoveInDate ? formatDate(a.desiredMoveInDate) : "—"}
                </td>
                <td className="td">
                  <ApplicationStatusBadge status={a.status} />
                </td>
                <td className="td whitespace-nowrap text-slate-500">{formatDate(a.createdAt)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
