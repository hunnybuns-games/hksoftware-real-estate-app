import type { Metadata } from "next";
import type { DocumentCategory, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/rbac";
import { formatDate } from "@/lib/dates";
import { Badge, Banner, Card, EmptyState, PageHeader, Table } from "@/components/ui";
import { DOCUMENT_CATEGORY_LABELS, DOCUMENT_CATEGORY_TONES } from "@/lib/document-labels";
import { DocumentDropZone } from "./_components/document-drop-zone";
import { RefileForm, type FilingOption } from "./_components/refile-form";

export const metadata: Metadata = { title: "Documents" };

/**
 * The document vault.
 *
 * Two lists, deliberately, rather than one filterable table: everything that
 * arrived but could not be filed sits at the top with its filing controls
 * already open, and everything settled sits below. The unfiled pile is the
 * only part that needs a human, so it is the part the page leads with — the
 * same reasoning behind the "Unmatched payments" banner on /app/payments.
 */
export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; q?: string }>;
}) {
  const ctx = await requireStaff();
  const { category, q } = await searchParams;

  const categoryFilter = isCategory(category) ? category : null;
  const search = (q ?? "").trim();

  const where: Prisma.DocumentWhereInput = {
    organizationId: ctx.organizationId,
    ...(categoryFilter ? { category: categoryFilter } : {}),
    ...(search
      ? {
          OR: [
            { filename: { contains: search } },
            { title: { contains: search } },
            { notes: { contains: search } },
          ],
        }
      : {}),
  };

  const [documents, properties, leases, tenants, totalCount] = await Promise.all([
    db.document.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        property: { select: { name: true } },
        unit: { select: { label: true } },
        tenant: { select: { firstName: true, lastName: true } },
        uploadedBy: { select: { name: true } },
      },
    }),
    db.property.findMany({
      where: { organizationId: ctx.organizationId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.lease.findMany({
      where: { organizationId: ctx.organizationId, status: { in: ["ACTIVE", "DRAFT", "ENDED"] } },
      orderBy: { startDate: "desc" },
      select: {
        id: true,
        status: true,
        tenant: { select: { firstName: true, lastName: true } },
        unit: { select: { label: true, property: { select: { name: true } } } },
      },
    }),
    db.tenant.findMany({
      where: { organizationId: ctx.organizationId },
      orderBy: { lastName: "asc" },
      select: { id: true, firstName: true, lastName: true },
    }),
    db.document.count({ where: { organizationId: ctx.organizationId } }),
  ]);

  // One flat option list shared by every refile form on the page — built once
  // here rather than per row, since it is identical for all of them.
  const filingOptions: FilingOption[] = [
    { value: "none", label: "Not filed yet" },
    ...leases.map((lease) => ({
      value: `lease:${lease.id}`,
      label: `${lease.tenant.firstName} ${lease.tenant.lastName} — ${lease.unit.property.name} ${lease.unit.label}${
        lease.status === "ENDED" ? " (past)" : ""
      }`,
    })),
    ...properties.map((property) => ({
      value: `property:${property.id}`,
      label: `Property — ${property.name}`,
    })),
    ...tenants.map((tenant) => ({
      value: `tenant:${tenant.id}`,
      label: `Tenant — ${tenant.firstName} ${tenant.lastName}`,
    })),
  ];

  const unfiled = documents.filter((d) => !d.leaseId && !d.propertyId && !d.tenantId);
  const filed = documents.filter((d) => d.leaseId || d.propertyId || d.tenantId);
  const filtering = Boolean(categoryFilter || search);

  return (
    <>
      <PageHeader
        title="Documents"
        subtitle={totalCount === 0 ? undefined : `${totalCount} in the vault`}
      />

      <div className="space-y-6">
        <Card title="Add documents">
          <DocumentDropZone />
        </Card>

        {unfiled.length > 0 ? (
          <Banner
            tone="warning"
            title={`${unfiled.length} ${unfiled.length === 1 ? "document needs" : "documents need"} filing`}
          >
            We could not tell from the filename who these belong to. Set each one below and it will
            show up on that property, lease or tenant.
          </Banner>
        ) : null}

        {unfiled.length > 0 ? (
          <Card title="Needs filing" padded={false}>
            <ul className="divide-y divide-slate-200">
              {unfiled.map((document) => (
                <li key={document.id} className="space-y-3 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <a
                      href={`/api/documents/${document.id}`}
                      className="link font-medium"
                      target="_blank"
                      rel="noreferrer"
                    >
                      {document.title || document.filename}
                    </a>
                    <span className="text-xs text-slate-400">
                      {formatSize(document.sizeBytes)} · {formatDate(document.createdAt)}
                    </span>
                  </div>
                  <RefileForm
                    documentId={document.id}
                    current={{ category: document.category, title: document.title, target: "none" }}
                    options={filingOptions}
                  />
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        <Card
          title={filtering ? "Matching documents" : "Filed"}
          description={
            documents.length === 200 ? "Showing the 200 most recent." : undefined
          }
          padded={false}
          actions={<CategoryFilter active={categoryFilter} search={search} />}
        >
          {filed.length === 0 ? (
            <EmptyState
              title={filtering ? "Nothing matches" : "No documents filed yet"}
              description={
                filtering
                  ? "Try a different type, or clear the filter."
                  : "Drop files above and they will be filed against the right property, lease or tenant."
              }
            />
          ) : (
            <Table
              head={
                <tr>
                  <th className="th">Document</th>
                  <th className="th">Type</th>
                  <th className="th">Filed under</th>
                  <th className="th">Added</th>
                  <th className="th text-right">Size</th>
                </tr>
              }
            >
              {filed.map((document) => (
                <tr key={document.id} className="hover:bg-slate-50/60">
                  <td className="td">
                    <a
                      href={`/api/documents/${document.id}`}
                      className="link font-medium"
                      target="_blank"
                      rel="noreferrer"
                    >
                      {document.title || document.filename}
                    </a>
                    {document.title ? (
                      <span className="block text-xs text-slate-400">{document.filename}</span>
                    ) : null}
                  </td>
                  <td className="td">
                    <Badge tone={DOCUMENT_CATEGORY_TONES[document.category]}>
                      {DOCUMENT_CATEGORY_LABELS[document.category]}
                    </Badge>
                  </td>
                  <td className="td text-slate-600">{describeFiling(document)}</td>
                  <td className="td whitespace-nowrap text-slate-500">
                    {formatDate(document.createdAt)}
                    {document.uploadedBy ? (
                      <span className="block text-xs text-slate-400">
                        {document.uploadedBy.name}
                      </span>
                    ) : null}
                  </td>
                  <td className="td text-right tabular-nums text-slate-500">
                    {formatSize(document.sizeBytes)}
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}

function CategoryFilter({ active, search }: { active: DocumentCategory | null; search: string }) {
  return (
    <form className="flex flex-wrap items-center gap-2">
      {search ? <input type="hidden" name="q" value={search} /> : null}
      <select
        name="category"
        defaultValue={active ?? ""}
        className="input"
        aria-label="Filter by type"
      >
        <option value="">All types</option>
        {Object.entries(DOCUMENT_CATEGORY_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <button type="submit" className="btn-secondary">
        Filter
      </button>
    </form>
  );
}

function describeFiling(document: {
  property: { name: string } | null;
  unit: { label: string } | null;
  tenant: { firstName: string; lastName: string } | null;
}): string {
  const parts: string[] = [];
  if (document.tenant) parts.push(`${document.tenant.firstName} ${document.tenant.lastName}`);
  if (document.property) {
    parts.push(document.unit ? `${document.property.name} ${document.unit.label}` : document.property.name);
  }
  return parts.join(" · ") || "—";
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function isCategory(value: string | undefined): value is DocumentCategory {
  return value !== undefined && value in DOCUMENT_CATEGORY_LABELS;
}
