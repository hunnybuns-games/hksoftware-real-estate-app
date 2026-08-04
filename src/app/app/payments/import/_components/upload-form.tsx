"use client";

import { ActionForm, Field, Select, SubmitButton } from "@/components/form";
import type { ActionState } from "@/lib/forms";

export function UploadImportForm({
  action,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
}) {
  return (
    <ActionForm action={action}>
      {(state) => (
        <>
          <Field
            label="Where is this statement from?"
            name="source"
            state={state}
            required
            hint="This tags every payment in the file so it shows up correctly everywhere else."
          >
            <Select name="source" state={state} defaultValue="IMPORT_BANK" required>
              <option value="IMPORT_BANK">Bank statement</option>
              <option value="IMPORT_VENMO">Venmo</option>
              <option value="IMPORT_CASHAPP">Cash App</option>
              <option value="IMPORT_HAP">Housing authority (HAP) payment report</option>
            </Select>
          </Field>

          <Field
            label="CSV file"
            name="file"
            state={state}
            required
            hint="Export a CSV from your bank or app — most “download transactions” options work. We'll ask you to confirm the columns on the next screen."
          >
            <input
              id="file"
              name="file"
              type="file"
              accept=".csv,text/csv"
              required
              className="block w-full cursor-pointer rounded-lg border border-slate-300 bg-white text-sm text-slate-600
                file:mr-3 file:cursor-pointer file:rounded-l-lg file:border-0 file:bg-slate-50
                file:px-3.5 file:py-2 file:text-sm file:font-medium file:text-slate-700
                hover:file:bg-slate-100"
            />
          </Field>

          <SubmitButton pendingLabel="Uploading…">Continue</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
