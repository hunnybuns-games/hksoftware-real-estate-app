import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/dates";
import { Badge, Card, EmptyState } from "@/components/ui";
import { DOCUMENT_CATEGORY_LABELS, DOCUMENT_CATEGORY_TONES } from "@/lib/document-labels";
import { DocumentDropZone } from "@/app/app/documents/_components/document-drop-zone";

/**
 * The documents belonging to one property, lease or tenant, with a drop zone
 * pinned to it.
 *
 * This is the half of the vault that makes filing worth doing: a signed lease
 * filed against a lease has to appear *on* that lease, or the landlord is
 * back to hunting through one long list. The standalone /app/documents page
 * is for triage and search; this is for context.
 *
 * A server component that runs its own query rather than taking documents as
 * a prop, so adding it to a page is one line and no page has to remember to
 * fetch and thread the data through.
 */
export async function DocumentsCard({
  organizationId,
  scope,
  title = "Documents",
}: {
  organizationId: string;
  /** Which record this card belongs to. Also pins uploads to that record. */
  scope:
    | { kind: "property"; id: string; label: string }
    | { kind: "lease"; id: string; label: string }
    | { kind: "tenant"; id: string; label: string };
  title?: string;
}) {
  const where: Prisma.DocumentWhereInput = {
    organizationId,
    ...(scope.kind === "property"
      ? { propertyId: scope.id }
      : scope.kind === "lease"
        ? { leaseId: scope.id }
        : { tenantId: scope.id }),
  };

  const documents = await db.document.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      filename: true,
      title: true,
      category: true,
      sizeBytes: true,
      createdAt: true,
    },
  });

  return (
    <Card title={title} description={documents.length > 0 ? `${documents.length} on file` : undefined}>
      <div className="space-y-4">
        {documents.length === 0 ? (
          <EmptyState
            title="Nothing on file yet"
            description="Drop leases, inspections, receipts or photos below and they will be filed here."
          />
        ) : (
          <ul className="divide-y divide-slate-200 dark:divide-slate-800">
            {documents.map((document) => (
              <li key={document.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <a
                  href={`/api/documents/${document.id}`}
                  className="link min-w-0 flex-1 truncate text-sm font-medium"
                  target="_blank"
                  rel="noreferrer"
                >
                  {document.title || document.filename}
                </a>
                <span className="flex shrink-0 items-center gap-3">
                  <Badge tone={DOCUMENT_CATEGORY_TONES[document.category]}>
                    {DOCUMENT_CATEGORY_LABELS[document.category]}
                  </Badge>
                  <span className="text-xs whitespace-nowrap text-slate-400">
                    {formatDate(document.createdAt)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}

        <details className="group">
          <summary className="cursor-pointer text-sm font-medium text-brand-700 hover:underline dark:text-brand-300">
            Add documents
          </summary>
          <div className="mt-3">
            <DocumentDropZone pinnedTo={{ kind: scope.kind, id: scope.id, label: scope.label }} />
          </div>
        </details>
      </div>
    </Card>
  );
}
