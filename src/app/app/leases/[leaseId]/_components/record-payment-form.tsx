"use client";

import { ActionForm, Field, MoneyInput, Select, SubmitButton, TextInput } from "@/components/form";
import type { ActionState } from "@/lib/forms";
import { toDateInputValue } from "@/lib/dates";

/**
 * Records money that arrived outside Stripe. Defaults to the outstanding
 * balance and today's date, because that's the overwhelmingly common case:
 * a landlord standing at their desk with a check in hand.
 */
export function RecordPaymentForm({
  action,
  suggestedAmount,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  suggestedAmount: string;
}) {
  return (
    <ActionForm action={action} successMessage>
      {(state) => (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Amount" name="amountCents" state={state} required>
              <MoneyInput
                name="amountCents"
                state={state}
                defaultValue={suggestedAmount}
                required
              />
            </Field>
            <Field label="Date received" name="paidAt" state={state} required>
              <TextInput
                name="paidAt"
                state={state}
                type="date"
                defaultValue={toDateInputValue(new Date())}
                required
              />
            </Field>
            <Field label="How" name="method" state={state} required>
              <Select name="method" state={state} defaultValue="MANUAL" required>
                <option value="MANUAL">Check / cash / other</option>
                <option value="ACH">Bank transfer</option>
                <option value="CARD">Card</option>
              </Select>
            </Field>
          </div>
          <Field label="Memo" name="memo" state={state} hint="Check number, or anything worth remembering.">
            <TextInput name="memo" state={state} placeholder="Optional" />
          </Field>
          <SubmitButton pendingLabel="Recording…">Record payment</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
