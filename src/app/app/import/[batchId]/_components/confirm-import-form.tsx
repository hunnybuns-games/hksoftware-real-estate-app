"use client";

import type { ReactNode } from "react";
import { ActionForm, FormError, FormSuccess, SubmitButton } from "@/components/form";
import { confirmPortfolioImportAction } from "@/actions/portfolio-import";

/**
 * Wraps the preview table so the per-row skip checkboxes and the confirm
 * button are one form submission.
 *
 * The table is passed in as children from the server component rather than
 * rebuilt here: it is a large read-only render over data this component has
 * no reason to hold, and keeping it server-side keeps the plan out of the
 * client bundle entirely.
 */
export function ConfirmImportForm({
  batchId,
  children,
  disabled,
  canImport,
}: {
  batchId: string;
  children: ReactNode;
  disabled: boolean;
  canImport: boolean;
}) {
  const action = confirmPortfolioImportAction.bind(null, batchId);

  if (disabled) return <>{children}</>;

  return (
    <ActionForm action={action}>
      {(state) => (
        <>
          {children}
          <div className="space-y-3 border-t border-slate-200 p-4 dark:border-slate-800">
            <FormError state={state} />
            <FormSuccess state={state} />
            {canImport ? (
              <SubmitButton pendingLabel="Importing…">Import these rows</SubmitButton>
            ) : (
              <p className="text-sm text-slate-500">
                Nothing here can be imported yet — every row is blocked. Fix the mapping above, or
                correct the spreadsheet and upload it again.
              </p>
            )}
          </div>
        </>
      )}
    </ActionForm>
  );
}
