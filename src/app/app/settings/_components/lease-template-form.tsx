"use client";

import { ActionForm, Field, SubmitButton, TextArea, TextInput } from "@/components/form";
import type { ActionState } from "@/lib/forms";

export function LeaseTemplateForm({
  action,
  defaults,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  defaults: { name: string; body: string };
}) {
  return (
    <ActionForm action={action} successMessage>
      {(state) => (
        <>
          <Field label="Template name" name="name" state={state} required>
            <TextInput name="name" state={state} defaultValue={defaults.name} required />
          </Field>

          <Field
            label="Lease text"
            name="body"
            state={state}
            required
            hint="Use {{tenant_name}}, {{property_address}}, {{rent_amount}} etc. to pull in lease details, and keep {{additional_provisions}} where the optional clauses staff pick per lease should appear."
          >
            <TextArea
              name="body"
              state={state}
              defaultValue={defaults.body}
              required
              rows={24}
              className="font-mono text-xs leading-relaxed"
            />
          </Field>

          <SubmitButton pendingLabel="Saving…">Save template</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
