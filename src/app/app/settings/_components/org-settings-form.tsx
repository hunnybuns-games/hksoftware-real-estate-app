"use client";

import { ActionForm, Field, MoneyInput, SubmitButton, TextInput } from "@/components/form";
import type { ActionState } from "@/lib/forms";

export function OrgSettingsForm({
  action,
  defaults,
  readOnly,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  defaults: { name: string; graceDays: string; lateFee: string };
  readOnly: boolean;
}) {
  return (
    <ActionForm action={action} successMessage>
      {(state) => (
        <>
          <Field label="Name" name="name" state={state} required>
            <TextInput
              name="name"
              state={state}
              defaultValue={defaults.name}
              required
              disabled={readOnly}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Grace period"
              name="graceDays"
              state={state}
              required
              hint="Days after the due date before rent counts as late."
            >
              <TextInput
                name="graceDays"
                state={state}
                defaultValue={defaults.graceDays}
                inputMode="numeric"
                required
                disabled={readOnly}
              />
            </Field>

            <Field
              label="Late fee"
              name="lateFeeCents"
              state={state}
              required
              hint="Suggested amount. Late fees aren't charged automatically — you add them per lease."
            >
              <MoneyInput
                name="lateFeeCents"
                state={state}
                defaultValue={defaults.lateFee}
                required
                disabled={readOnly}
              />
            </Field>
          </div>

          {readOnly ? null : <SubmitButton pendingLabel="Saving…">Save settings</SubmitButton>}
        </>
      )}
    </ActionForm>
  );
}
