"use client";

import { ActionForm, Field, SubmitButton } from "@/components/form";
import { uploadPortfolioAction } from "@/actions/portfolio-import";

export function UploadPortfolioForm() {
  return (
    <ActionForm action={uploadPortfolioAction}>
      {(state) => (
        <>
          <Field
            label="Rent roll CSV"
            name="file"
            state={state}
            required
            hint="One row per occupied unit. Any column names work — you confirm what each one means on the next screen. Excel files need saving as CSV first."
          >
            <input
              id="file"
              name="file"
              type="file"
              accept=".csv,text/csv"
              required
              className="block w-full cursor-pointer rounded-lg border border-slate-300 bg-surface text-sm text-slate-600
                file:mr-3 file:cursor-pointer file:rounded-l-lg file:border-0 file:bg-slate-50
                file:px-3.5 file:py-2 file:text-sm file:font-medium file:text-slate-700
                hover:file:bg-slate-100"
            />
          </Field>

          <SubmitButton pendingLabel="Reading…">Continue</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
