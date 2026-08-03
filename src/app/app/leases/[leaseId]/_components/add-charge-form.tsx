"use client";

import { ActionForm, Field, MoneyInput, Select, SubmitButton, TextInput } from "@/components/form";
import type { ActionState } from "@/lib/forms";
import { toDateInputValue } from "@/lib/dates";

/** Ad-hoc charges: late fees, damage, a utility passthrough, a prorated month. */
export function AddChargeForm({
  action,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
}) {
  return (
    <ActionForm action={action} successMessage>
      {(state) => (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Type" name="type" state={state} required>
              <Select name="type" state={state} defaultValue="LATE_FEE" required>
                <option value="LATE_FEE">Late fee</option>
                <option value="RENT">Rent</option>
                <option value="DEPOSIT">Deposit</option>
                <option value="OTHER">Other</option>
              </Select>
            </Field>
            <Field label="Amount" name="amountCents" state={state} required>
              <MoneyInput name="amountCents" state={state} required />
            </Field>
            <Field label="Due date" name="dueDate" state={state} required>
              <TextInput
                name="dueDate"
                state={state}
                type="date"
                defaultValue={toDateInputValue(new Date())}
                required
              />
            </Field>
          </div>
          <Field
            label="Description"
            name="description"
            state={state}
            required
            hint="The resident sees this on their portal, so write it for them."
          >
            <TextInput
              name="description"
              state={state}
              required
              placeholder="Late fee — March rent"
            />
          </Field>
          <SubmitButton pendingLabel="Adding…">Add charge</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
