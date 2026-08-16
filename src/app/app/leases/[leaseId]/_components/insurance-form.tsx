"use client";

import { ActionForm, Field, SubmitButton, TextInput } from "@/components/form";
import type { ActionState } from "@/lib/forms";

/**
 * Renter's insurance is tracked, not enforced — see the schema comment on
 * Lease.insuranceRequired. This form edits that record; the status badge next
 * to it (../page.tsx, via src/lib/insurance.ts) is what actually surfaces
 * whether it's missing or about to lapse.
 */
export function InsuranceForm({
  action,
  defaults,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  defaults: {
    insuranceRequired: boolean;
    insuranceProvider: string;
    insurancePolicyNumber: string;
    insuranceExpiresAt: string;
  };
}) {
  return (
    <ActionForm action={action} successMessage>
      {(state) => (
        <>
          <label className="flex items-center gap-2.5 text-sm text-slate-700">
            <input
              type="checkbox"
              name="insuranceRequired"
              defaultChecked={defaults.insuranceRequired}
              className="size-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500/30"
            />
            This lease requires renter&apos;s insurance
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Provider" name="insuranceProvider" state={state}>
              <TextInput
                name="insuranceProvider"
                state={state}
                defaultValue={defaults.insuranceProvider}
                placeholder="e.g. State Farm"
              />
            </Field>
            <Field label="Policy number" name="insurancePolicyNumber" state={state}>
              <TextInput
                name="insurancePolicyNumber"
                state={state}
                defaultValue={defaults.insurancePolicyNumber}
              />
            </Field>
          </div>
          <Field label="Expires" name="insuranceExpiresAt" state={state}>
            <TextInput
              name="insuranceExpiresAt"
              state={state}
              type="date"
              defaultValue={defaults.insuranceExpiresAt}
            />
          </Field>

          <SubmitButton pendingLabel="Saving…">Save insurance details</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
