import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "@/components/link";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/rbac";
import { parseCsvWithHeader } from "@/lib/csv";
import { formatCents } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import {
  parsePortfolioRows,
  planImport,
  type PortfolioMapping,
  type EntityPlan,
} from "@/lib/portfolio-import";
import { loadExistingPortfolio } from "@/actions/portfolio-import";
import { Badge, Banner, Breadcrumbs, Card, PageHeader, StatTile, Table } from "@/components/ui";
import { MappingForm } from "./_components/mapping-form";
import { ConfirmImportForm } from "./_components/confirm-import-form";

export const metadata: Metadata = { title: "Review import" };

/**
 * The review screen — the whole safety mechanism of this feature.
 *
 * Everything shown is recomputed from `rawCsv` and the batch's current
 * mapping on every render, never cached and never taken from the client. The
 * confirm step re-plans the same way, so what is promised here and what gets
 * written cannot diverge.
 */
export default async function ReviewImportPage({
  params,
}: {
  params: Promise<{ batchId: string }>;
}) {
  const ctx = await requireStaff();
  const { batchId } = await params;

  const batch = await db.portfolioImportBatch.findFirst({
    where: { id: batchId, organizationId: ctx.organizationId },
  });
  if (!batch) notFound();

  const { headers, rows } = parseCsvWithHeader(batch.rawCsv);
  const mapping = batch.columnMapping as unknown as PortfolioMapping;
  const parsedRows = parsePortfolioRows(headers, rows, mapping);
  const existing = await loadExistingPortfolio(ctx.organizationId);
  const { plans, summary } = planImport(parsedRows, existing);

  const confirmed = batch.status === "CONFIRMED";
  const blocked = plans.filter((p) => !p.importable);

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Import portfolio", href: "/app/import" }, { label: batch.filename }]} />

      <PageHeader
        title={batch.filename}
        subtitle={`${batch.rowCount} rows · uploaded ${formatDate(batch.createdAt)}`}
      />

      {confirmed ? (
        <Banner tone="success" title="Already imported">
          This file created {batch.leasesCreated} leases, {batch.unitsCreated} units and{" "}
          {batch.tenantsCreated} tenants. It is kept as a record and cannot be run again — re-upload
          the file if you need to bring in rows you skipped.
        </Banner>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Leases to create" value={String(summary.leasesToCreate)} tone="positive" />
        <StatTile
          label="New properties"
          value={String(summary.propertiesToCreate)}
          hint={`${summary.unitsToCreate} new units`}
        />
        <StatTile label="New tenants" value={String(summary.tenantsToCreate)} />
        <StatTile
          label="Blocked rows"
          value={String(summary.blocked)}
          tone={summary.blocked > 0 ? "warning" : "default"}
          hint={summary.blocked > 0 ? "Skipped unless fixed" : "Nothing to fix"}
        />
      </div>

      {summary.placeholderEmails > 0 && !confirmed ? (
        <Banner
          tone="warning"
          title={`${summary.placeholderEmails} ${summary.placeholderEmails === 1 ? "tenant has" : "tenants have"} no email address`}
        >
          A placeholder was generated for each so the import can go ahead. They cannot be invited to
          the resident portal and will not receive any notices until you give them a real address —
          the placeholders end in <code>@no-email.invalid</code> so they are easy to find later.
        </Banner>
      ) : null}

      {blocked.length > 0 && !confirmed ? (
        <Banner tone="warning" title={`${blocked.length} rows cannot be imported`}>
          These are listed below with the reason. They will be left out; everything else still comes
          in. Fix the spreadsheet and re-upload if you need them.
        </Banner>
      ) : null}

      {!confirmed && mapping.addressLine1 === null && summary.propertiesToCreate > 0 ? (
        <Banner tone="info" title="No street address column">
          A property needs an address, so the property name will be used as a stand-in for the{" "}
          {summary.propertiesToCreate === 1 ? "one" : summary.propertiesToCreate} being created.
          Worth correcting on the property afterwards — the address is what appears on listings and
          generated lease documents. Shown once here rather than against every row.
        </Banner>
      ) : null}

      {!confirmed ? (
        <Card
          title="Which column is which?"
          description="Auto-detected from the header row. Correct anything that looks wrong — the preview below updates to match."
        >
          <MappingForm batchId={batch.id} headers={headers} mapping={mapping} />
        </Card>
      ) : null}

      <Card
        title="What will be created"
        description={
          confirmed
            ? "As imported."
            : "One row per lease. Untick anything you would rather leave out."
        }
        padded={false}
      >
        <ConfirmImportForm batchId={batch.id} disabled={confirmed} canImport={summary.importable > 0}>
          <Table
            head={
              <tr>
                {!confirmed ? <th className="th w-10">Import</th> : null}
                <th className="th">Property</th>
                <th className="th">Unit</th>
                <th className="th">Tenant</th>
                <th className="th text-right">Rent</th>
                <th className="th">Lease dates</th>
                <th className="th">Notes</th>
              </tr>
            }
          >
            {plans.map((plan) => {
              const row = plan.row;
              return (
                <tr
                  key={plan.rowIndex}
                  className={plan.importable ? "hover:bg-slate-50/60" : "bg-amber-50/40 dark:bg-amber-950/10"}
                >
                  {!confirmed ? (
                    <td className="td">
                      {/*
                        Ticked means "import this", matching the column
                        header. A blocked row is rendered unticked and
                        disabled, so it submits nothing and is excluded
                        without the landlord having to do anything.
                      */}
                      <input
                        type="checkbox"
                        name={`include_${plan.rowIndex}`}
                        defaultChecked={plan.importable}
                        disabled={!plan.importable}
                        aria-label={`Import row ${plan.rowIndex + 1}`}
                        className="size-4 rounded border-slate-300"
                      />
                    </td>
                  ) : null}
                  <td className="td">
                    <span className="font-medium text-slate-900 dark:text-slate-100">
                      {row.propertyName || "—"}
                    </span>
                    <PlanBadge plan={plan.property} />
                  </td>
                  <td className="td">
                    {row.unitLabel}
                    <PlanBadge plan={plan.unit} />
                  </td>
                  <td className="td">
                    {[row.firstName, row.lastName].filter(Boolean).join(" ") || "—"}
                    <span className="block text-xs text-slate-400">
                      {row.emailSynthesized ? "no email" : row.email}
                    </span>
                    <PlanBadge plan={plan.tenant} />
                  </td>
                  <td className="td text-right tabular-nums">
                    {row.rentCents === null ? "—" : formatCents(row.rentCents)}
                  </td>
                  <td className="td whitespace-nowrap text-slate-500">
                    {row.leaseStart ? formatDate(row.leaseStart) : "today"}
                    {row.leaseEnd ? ` – ${formatDate(row.leaseEnd)}` : ""}
                  </td>
                  <td className="td">
                    {row.errors.map((error) => (
                      <span key={error} className="block text-xs text-red-700 dark:text-red-400">
                        {error}
                      </span>
                    ))}
                    {plan.lease.action === "conflict" ? (
                      <span className="block text-xs text-red-700 dark:text-red-400">
                        {plan.lease.reason}
                      </span>
                    ) : null}
                    {row.warnings.map((warning) => (
                      <span key={warning} className="block text-xs text-amber-700 dark:text-amber-400">
                        {warning}
                      </span>
                    ))}
                  </td>
                </tr>
              );
            })}
          </Table>
        </ConfirmImportForm>
      </Card>

      {confirmed ? (
        <Card title="What next">
          <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            The leases are in but have no billing history yet. Open{" "}
            <Link href="/app/payments" className="link">
              Rent
            </Link>{" "}
            and use <strong>Post rent charges</strong> to generate charges from each lease start
            date, then{" "}
            <Link href="/app/payments/import" className="link">
              import a statement
            </Link>{" "}
            to match up the payments already received.
          </p>
        </Card>
      ) : null}
    </div>
  );
}

/** "New" or "Existing", so it is obvious at a glance what an import will add versus reuse. */
function PlanBadge({ plan }: { plan: EntityPlan }) {
  if (plan.action === "reuse") {
    return (
      <span className="ml-2 align-middle">
        <Badge tone="slate">Existing</Badge>
      </span>
    );
  }
  if (plan.action === "conflict") return null;
  return (
    <span className="ml-2 align-middle">
      <Badge tone="green">New</Badge>
    </span>
  );
}
