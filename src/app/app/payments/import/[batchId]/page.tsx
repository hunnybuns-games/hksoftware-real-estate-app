import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/rbac";
import { confirmImportAction, updateImportMappingAction } from "@/actions/import";
import { parseCsvWithHeader } from "@/lib/csv";
import { applyColumnMapping, type ColumnMapping } from "@/lib/import-mapping";
import { suggestLeaseMatch } from "@/lib/lease-matching";
import { formatDate } from "@/lib/dates";
import { PAYMENT_SOURCE_LABELS } from "@/lib/payment-source";
import { Badge, Banner, Breadcrumbs, Card, PageHeader } from "@/components/ui";
import { MappingForm } from "./_components/mapping-form";
import { ConfirmImportForm } from "./_components/confirm-import-form";

export const metadata: Metadata = { title: "Review import" };

export default async function ImportReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ batchId: string }>;
  searchParams: Promise<{ confirmed?: string }>;
}) {
  const ctx = await requireStaff();
  const { batchId } = await params;
  const { confirmed } = await searchParams;

  const batch = await db.paymentImportBatch.findFirst({
    where: { id: batchId, organizationId: ctx.organizationId },
  });
  if (!batch) notFound();

  const { headers, rows } = parseCsvWithHeader(batch.rawCsv);
  const mapping = batch.columnMapping as unknown as ColumnMapping;
  const parsedRows = applyColumnMapping(headers, rows, mapping);

  if (batch.status === "CONFIRMED") {
    const stats = await db.payment.groupBy({
      by: ["reconciliationStatus"],
      where: { importBatchId: batch.id },
      _count: true,
    });
    const total = stats.reduce((sum, s) => sum + s._count, 0);
    const unmatched = stats.find((s) => s.reconciliationStatus === "UNMATCHED")?._count ?? 0;

    return (
      <div className="max-w-3xl space-y-6">
        <Breadcrumbs
          items={[
            { label: "Rent", href: "/app/payments" },
            { label: "Import", href: "/app/payments/import" },
            { label: batch.filename },
          ]}
        />
        <PageHeader title={batch.filename} subtitle="This import has already been confirmed." />
        {confirmed ? (
          <Banner tone="success" title="Import confirmed">
            {total} payment{total === 1 ? "" : "s"} added from {PAYMENT_SOURCE_LABELS[batch.source]}
            {unmatched > 0
              ? ` — ${unmatched} couldn't be matched to a lease and need attention on the Rent page.`
              : ", all matched to a lease."}
          </Banner>
        ) : null}
        <Card>
          <p className="text-sm text-slate-600">
            {total} payment{total === 1 ? "" : "s"} were created from this file on{" "}
            {formatDate(batch.createdAt)}.
          </p>
          <Link href="/app/payments" className="btn-secondary mt-4 inline-flex">
            Back to Rent
          </Link>
        </Card>
      </div>
    );
  }

  const candidateLeases = await db.lease.findMany({
    where: { organizationId: ctx.organizationId, status: { in: ["ACTIVE", "DRAFT"] } },
    select: {
      id: true,
      tenant: { select: { firstName: true, lastName: true } },
      unit: { select: { label: true, property: { select: { name: true } } } },
    },
  });
  const candidates = candidateLeases.map((l) => ({
    leaseId: l.id,
    tenantFirstName: l.tenant.firstName,
    tenantLastName: l.tenant.lastName,
    unitLabel: l.unit.label,
    propertyName: l.unit.property.name,
  }));
  const leaseOptions = candidates.map((c) => ({
    id: c.leaseId,
    label: `${c.tenantFirstName} ${c.tenantLastName} · ${c.propertyName} ${c.unitLabel}`,
  }));

  const rowsWithSuggestion = parsedRows.map((row) => ({
    ...row,
    suggestedLeaseId: row.parseError
      ? null
      : suggestLeaseMatch(`${row.payerRaw} ${row.description}`, candidates)?.leaseId ?? null,
  }));

  const importableCount = rowsWithSuggestion.filter((r) => !r.parseError).length;
  const errorCount = rowsWithSuggestion.length - importableCount;
  const suggestedCount = rowsWithSuggestion.filter((r) => r.suggestedLeaseId).length;

  return (
    <div className="max-w-5xl space-y-6">
      <Breadcrumbs
        items={[
          { label: "Rent", href: "/app/payments" },
          { label: "Import", href: "/app/payments/import" },
          { label: batch.filename },
        ]}
      />
      <PageHeader
        title={batch.filename}
        subtitle={`${PAYMENT_SOURCE_LABELS[batch.source]} · ${rowsWithSuggestion.length} row${rowsWithSuggestion.length === 1 ? "" : "s"}`}
      />

      {errorCount > 0 ? (
        <Banner tone="warning" title={`${errorCount} row${errorCount === 1 ? "" : "s"} couldn't be read`}>
          These are shown below with the reason and are skipped automatically — nothing is
          imported for them.
        </Banner>
      ) : null}

      <Card title="Columns" description="We guessed these from the file's headers — fix any that look wrong.">
        <MappingForm
          action={updateImportMappingAction.bind(null, batch.id)}
          headers={headers}
          mapping={mapping}
        />
      </Card>

      <Card
        title="Match each payment to a lease"
        description={
          suggestedCount > 0
            ? `We suggested a lease for ${suggestedCount} of ${importableCount} row${importableCount === 1 ? "" : "s"} based on the payer name — check them before confirming.`
            : "Pick a lease for each row, or leave it unmatched to deal with later."
        }
        padded={false}
      >
        <ConfirmImportForm
          action={confirmImportAction.bind(null, batch.id)}
          rows={rowsWithSuggestion}
          leaseOptions={leaseOptions}
        />
      </Card>
    </div>
  );
}
