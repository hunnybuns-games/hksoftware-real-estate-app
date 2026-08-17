import Link from "@/components/link";
import type { Metadata } from "next";
import type { ListingStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/rbac";
import { formatCents } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { Card, EmptyState, ListingStatusBadge, PageHeader, Table } from "@/components/ui";

export const metadata: Metadata = { title: "Listings" };

const FILTERS = [
  { key: "active", label: "Active" },
  { key: "all", label: "All" },
  { key: "draft", label: "Draft" },
  { key: "archived", label: "Archived" },
] as const;

type FilterKey = (typeof FILTERS)[number]["key"];

export default async function ListingsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const ctx = await requireStaff();
  const { filter: rawFilter } = await searchParams;
  const filter: FilterKey = FILTERS.some((f) => f.key === rawFilter) ? (rawFilter as FilterKey) : "active";

  const statusWhere: { status?: ListingStatus } =
    filter === "active"
      ? { status: "ACTIVE" }
      : filter === "draft"
        ? { status: "DRAFT" }
        : filter === "archived"
          ? { status: "ARCHIVED" }
          : {};

  const [listings, activeCount] = await Promise.all([
    db.listing.findMany({
      where: { organizationId: ctx.organizationId, ...statusWhere },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        status: true,
        askingRentCents: true,
        createdAt: true,
        unit: { select: { label: true, property: { select: { name: true } } } },
        _count: { select: { syndications: { where: { status: "POSTED" } } } },
      },
    }),
    db.listing.count({ where: { organizationId: ctx.organizationId, status: "ACTIVE" } }),
  ]);

  return (
    <>
      <PageHeader
        title="Listings"
        subtitle={
          activeCount === 0
            ? "Nothing being advertised right now"
            : `${activeCount} active listing${activeCount === 1 ? "" : "s"}`
        }
        actions={
          <Link href="/app/listings/new" className="btn-primary">
            New listing
          </Link>
        }
      />

      <div className="mb-4 flex gap-1">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={`/app/listings?filter=${f.key}`}
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
        {listings.length === 0 ? (
          <EmptyState
            title={filter === "active" ? "No active listings" : "Nothing here"}
            description={
              filter === "active"
                ? "Create a listing for a vacant unit to start tracking where it's advertised."
                : "Try a different filter."
            }
            action={
              filter === "active" ? (
                <Link href="/app/listings/new" className="btn-primary">
                  New listing
                </Link>
              ) : undefined
            }
          />
        ) : (
          <Table
            head={
              <tr>
                <th className="th">Listing</th>
                <th className="th">Unit</th>
                <th className="th text-right">Asking rent</th>
                <th className="th">Status</th>
                <th className="th">Posted on</th>
                <th className="th">Created</th>
              </tr>
            }
          >
            {listings.map((l) => (
              <tr key={l.id} className="hover:bg-slate-50/60">
                <td className="td">
                  <Link href={`/app/listings/${l.id}`} className="font-medium text-slate-900 hover:underline">
                    {l.title}
                  </Link>
                </td>
                <td className="td text-slate-500">
                  {l.unit.property.name} · {l.unit.label}
                </td>
                <td className="td text-right tabular-nums">{formatCents(l.askingRentCents)}</td>
                <td className="td">
                  <ListingStatusBadge status={l.status} />
                </td>
                <td className="td text-slate-500">
                  {l._count.syndications} of 4 platform{l._count.syndications === 1 ? "" : "s"}
                </td>
                <td className="td whitespace-nowrap text-slate-500">{formatDate(l.createdAt)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
