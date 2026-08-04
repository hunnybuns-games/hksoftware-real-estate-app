"use client";

import { ActionForm, Field, MoneyInput, Select, SubmitButton, TextInput } from "@/components/form";
import type { ActionState } from "@/lib/forms";
import { toDateInputValue } from "@/lib/dates";

/**
 * Records money that arrived outside Stripe — the fast path for a single
 * payment. Defaults to the outstanding balance and today's date, because
 * that's the overwhelmingly common case: a landlord standing at their desk
 * with a check (or their phone, after a Venmo notification) in hand.
 *
 * A whole statement's worth of payments goes through CSV import instead
 * (Import statement, on the Rent page) — this form and that flow both tag
 * payments with the same PaymentSource and land in the same ledger.
 */
export function RecordPaymentForm({
  action,
  suggestedAmount,
  hasSubsidySplit,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  suggestedAmount: string;
  hasSubsidySplit?: boolean;
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
            <Field
              label="Source"
              name="source"
              state={state}
              required
              hint={
                hasSubsidySplit
                  ? "Housing authority payments count toward the subsidy portion automatically."
                  : undefined
              }
            >
              <Select name="source" state={state} defaultValue="MANUAL_CASH" required>
                <option value="MANUAL_CASH">Cash / check / other</option>
                <option value="IMPORT_BANK">Bank transfer</option>
                <option value="IMPORT_VENMO">Venmo</option>
                <option value="IMPORT_CASHAPP">Cash App</option>
                <option value="IMPORT_HAP">Housing authority (HAP)</option>
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
