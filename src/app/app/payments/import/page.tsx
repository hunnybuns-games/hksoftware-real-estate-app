import Link from "next/link";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/rbac";
import { uploadImportAction } from "@/actions/import";
import { formatDateTime } from "@/lib/dates";
import { Badge, Breadcrumbs, Card, EmptyState, PageHeader, Table } from "@/components/ui";
import { PAYMENT_SOURCE_LABELS } from "@/lib/payment-source";
import { UploadImportForm } from "./_components/upload-form";

export const metadata: Metadata = { title: "Import a statement" };

export default async function ImportPage() {
  const ctx = await requireStaff();

  const batches = await db.paymentImportBatch.findMany({
    where: { organizationId: ctx.organizationId },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      source: true,
      filename: true,
      status: true,
      rowCount: true,
      createdAt: true,
      uploadedBy: { select: { name: true } },
      _count: { select: { payments: true } },
    },
  });

  return (
    <div className="max-w-3xl space-y-6">
      <Breadcrumbs items={[{ label: "Rent", href: "/app/payments" }, { label: "Import" }]} />
      <PageHeader
        title="Import a statement"
        subtitle="Bank, Venmo, Cash App, or a housing authority payment report — upload the export and match each row to a lease."
      />

      <Card>
        <UploadImportForm action={uploadImportAction} />
      </Card>

      <Card title="Past imports" padded={false}>
        {batches.length === 0 ? (
          <EmptyState
            title="Nothing imported yet"
            description="Once you import a statement, it'll show up here with a link back to review it."
          />
        ) : (
          <Table
            head={
              <tr>
                <th className="th">File</th>
                <th className="th">Source</th>
                <th className="th">Uploaded</th>
                <th className="th text-right">Rows</th>
                <th className="th">Status</th>
              </tr>
            }
          >
            {batches.map((batch) => (
              <tr key={batch.id} className="hover:bg-slate-50/60">
                <td className="td">
                  <Link href={`/app/payments/import/${batch.id}`} className="font-medium text-slate-900 hover:underline">
                    {batch.filename}
                  </Link>
                  {batch.uploadedBy ? (
                    <span className="block text-xs text-slate-500">by {batch.uploadedBy.name}</span>
                  ) : null}
                </td>
                <td className="td text-slate-500">{PAYMENT_SOURCE_LABELS[batch.source]}</td>
                <td className="td text-slate-500">{formatDateTime(batch.createdAt)}</td>
                <td className="td text-right tabular-nums">{batch.rowCount}</td>
                <td className="td">
                  {batch.status === "CONFIRMED" ? (
                    <Badge tone="green">Imported ({batch._count.payments})</Badge>
                  ) : (
                    <Badge tone="amber">Needs review</Badge>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
