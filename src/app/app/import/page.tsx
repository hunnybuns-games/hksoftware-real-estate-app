import type { Metadata } from "next";
import Link from "@/components/link";

import { db } from "@/lib/db";
import { requireStaff } from "@/lib/rbac";
import { formatDateTime } from "@/lib/dates";
import { Badge, Card, EmptyState, PageHeader, Table } from "@/components/ui";
import { UploadPortfolioForm } from "./_components/upload-portfolio-form";

export const metadata: Metadata = { title: "Import portfolio" };

/**
 * The migration entry point: bring an existing portfolio in from a rent roll.
 *
 * Separate from /app/payments/import, which imports money that already moved.
 * This imports the things money moves *against* — properties, units, tenants
 * and leases — and so has to run first when a landlord is onboarding.
 */
export default async function ImportPage() {
  const ctx = await requireStaff();

  const batches = await db.portfolioImportBatch.findMany({
    where: { organizationId: ctx.organizationId },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: { uploadedBy: { select: { name: true } } },
  });

  return (
    <>
      <PageHeader
        title="Import portfolio"
        subtitle="Bring properties, units, tenants and leases in from a spreadsheet"
      />

      <div className="max-w-3xl space-y-6">
        <Card title="What this does">
          <div className="space-y-3 text-sm leading-relaxed text-slate-600">
            <p>
              Upload a rent roll — one row per occupied unit — and this creates the matching{" "}
              <strong>properties, units, tenants and leases</strong>. You will see exactly what it
              intends to create before anything is saved.
            </p>
            <p>
              Anything already here is reused rather than duplicated: a property is matched by
              name, a unit by its label within that property, a tenant by email address. Running
              the same file twice is safe — the second run finds everything already there and does
              nothing.
            </p>
            <p>
              It does <strong>not</strong> create rent charges or payments. Once the leases are in,
              use <strong>Post rent charges</strong> on the Rent page to generate their billing
              history, and{" "}
              <Link href="/app/payments/import" className="link">
                Import statement
              </Link>{" "}
              for money that has already come in.
            </p>
          </div>
        </Card>

        <Card title="Upload a rent roll">
          <UploadPortfolioForm />
        </Card>

        <Card title="Previous imports" padded={false}>
          {batches.length === 0 ? (
            <EmptyState
              title="Nothing imported yet"
              description="Uploaded rent rolls show up here, whether or not you finished reviewing them."
            />
          ) : (
            <Table
              head={
                <tr>
                  <th className="th">File</th>
                  <th className="th">Status</th>
                  <th className="th">Result</th>
                  <th className="th">Uploaded</th>
                </tr>
              }
            >
              {batches.map((batch) => (
                <tr key={batch.id} className="hover:bg-slate-50/60">
                  <td className="td">
                    <Link href={`/app/import/${batch.id}`} className="link font-medium">
                      {batch.filename}
                    </Link>
                    <span className="block text-xs text-slate-400">{batch.rowCount} rows</span>
                  </td>
                  <td className="td">
                    {batch.status === "CONFIRMED" ? (
                      <Badge tone="green">Imported</Badge>
                    ) : (
                      <Badge tone="amber">Needs review</Badge>
                    )}
                  </td>
                  <td className="td text-slate-600">
                    {batch.status === "CONFIRMED"
                      ? `${batch.leasesCreated} leases · ${batch.unitsCreated} units · ${batch.tenantsCreated} tenants`
                      : "—"}
                  </td>
                  <td className="td whitespace-nowrap text-slate-500">
                    {formatDateTime(batch.createdAt)}
                    {batch.uploadedBy ? (
                      <span className="block text-xs text-slate-400">{batch.uploadedBy.name}</span>
                    ) : null}
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
