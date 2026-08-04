"use client";

import { ActionForm, Field, MoneyInput, Select, SubmitButton, TextInput } from "@/components/form";
import type { ActionState } from "@/lib/forms";
import { toDateInputValue } from "@/lib/dates";

const CATEGORIES: { value: string; label: string }[] = [
  { value: "REPAIRS_MAINTENANCE", label: "Repairs & maintenance" },
  { value: "UTILITIES", label: "Utilities" },
  { value: "INSURANCE", label: "Insurance" },
  { value: "TAXES", label: "Taxes" },
  { value: "MANAGEMENT_FEES", label: "Management fees" },
  { value: "MORTGAGE", label: "Mortgage" },
  { value: "OTHER", label: "Other" },
];

export function ExpenseForm({
  action,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
}) {
  return (
    <ActionForm action={action} successMessage>
      {(state) => (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Category" name="category" state={state} required>
              <Select name="category" state={state} defaultValue="REPAIRS_MAINTENANCE" required>
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Amount" name="amountCents" state={state} required>
              <MoneyInput name="amountCents" state={state} required />
            </Field>
            <Field label="Date" name="date" state={state} required>
              <TextInput
                name="date"
                state={state}
                type="date"
                defaultValue={toDateInputValue(new Date())}
                required
              />
            </Field>
          </div>
          <Field label="Description" name="description" state={state} required>
            <TextInput name="description" state={state} required placeholder="Roof repair, unit 3B" />
          </Field>
          <SubmitButton pendingLabel="Adding…">Add expense</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
