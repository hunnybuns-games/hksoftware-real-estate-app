"use client";

import { ActionForm, Field, Select, SubmitButton } from "@/components/form";
import type { ActionState } from "@/lib/forms";
import type { ColumnMapping } from "@/lib/import-mapping";

const FIELDS: { key: keyof ColumnMapping; label: string; hint?: string }[] = [
  { key: "dateColumn", label: "Date" },
  { key: "amountColumn", label: "Amount", hint: "Should only contain money coming in." },
  { key: "descriptionColumn", label: "Description" },
  { key: "payerColumn", label: "Payer / sender name" },
  { key: "refColumn", label: "Reference / transaction ID" },
];

export function MappingForm({
  action,
  headers,
  mapping,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  headers: string[];
  mapping: ColumnMapping;
}) {
  return (
    <ActionForm action={action} successMessage>
      {(state) => (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            {FIELDS.map((field) => (
              <Field key={field.key} label={field.label} name={field.key} state={state} hint={field.hint}>
                <Select name={field.key} state={state} defaultValue={mapping[field.key] ?? ""}>
                  <option value="">— none —</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </Select>
              </Field>
            ))}
          </div>
          <SubmitButton variant="secondary" pendingLabel="Updating…">
            Update mapping
          </SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
