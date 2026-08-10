"use client";

import { ActionForm, SubmitButton } from "@/components/form";
import type { ActionState } from "@/lib/forms";
import { Table } from "@/components/ui";
import { formatCents } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import type { ParsedImportRow } from "@/lib/import-mapping";

type Row = ParsedImportRow & { suggestedLeaseId: string | null };

export function ConfirmImportForm({
  action,
  rows,
  leaseOptions,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  rows: Row[];
  leaseOptions: { id: string; label: string }[];
}) {
  const importable = rows.filter((r) => !r.parseError);

  return (
    <ActionForm action={action} className="space-y-0">
      {(state) => (
        <>
          <div className="px-5 pt-4">
            {state && !state.ok ? (
              <p className="mb-3 rounded-lg border border-red-200 dark:border-red-400/25 bg-red-50 dark:bg-red-500/12 px-3.5 py-2.5 text-sm text-red-800 dark:text-red-200">
                {state.error}
              </p>
            ) : null}
          </div>
          <Table
            head={
              <tr>
                <th className="th">Date</th>
                <th className="th text-right">Amount</th>
                <th className="th">Description</th>
                <th className="th">Lease</th>
                <th className="th">Skip</th>
              </tr>
            }
          >
            {rows.map((row) => (
              <tr key={row.rowIndex} className={row.parseError ? "opacity-50" : "hover:bg-slate-50/60"}>
                <td className="td whitespace-nowrap text-slate-500">
                  {row.date ? formatDate(row.date) : "—"}
                </td>
                <td className="td text-right tabular-nums">
                  {row.amountCents !== null ? formatCents(row.amountCents) : "—"}
                </td>
                <td className="td">
                  <span className="block max-w-xs truncate" title={`${row.payerRaw} ${row.description}`}>
                    {row.payerRaw ? <span className="font-medium">{row.payerRaw}</span> : null}
                    {row.payerRaw && row.description ? " · " : ""}
                    {row.description}
                  </span>
                  {row.parseError ? (
                    <span className="block text-xs text-red-600 dark:text-red-400">{row.parseError} — skipped</span>
                  ) : null}
                </td>
                <td className="td">
                  {row.parseError ? (
                    <span className="text-slate-400">—</span>
                  ) : (
                    <select
                      name={`lease_${row.rowIndex}`}
                      defaultValue={row.suggestedLeaseId ?? ""}
                      className="input py-1.5 text-xs"
                    >
                      <option value="">Leave unmatched</option>
                      {leaseOptions.map((opt) => (
                        <option key={opt.id} value={opt.id}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
                <td className="td">
                  {row.parseError ? null : (
                    <input
                      type="checkbox"
                      name={`skip_${row.rowIndex}`}
                      className="size-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500/30"
                    />
                  )}
                </td>
              </tr>
            ))}
          </Table>
          <div className="flex items-center gap-3 px-5 py-4">
            <SubmitButton pendingLabel="Importing…" disabled={importable.length === 0}>
              Confirm import ({importable.length} row{importable.length === 1 ? "" : "s"})
            </SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}
