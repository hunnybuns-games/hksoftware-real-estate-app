"use client";

import { ActionForm, Field, SubmitButton, TextArea, TextInput } from "@/components/form";
import type { ActionState } from "@/lib/forms";

export function EditDocumentForm({
  action,
  defaults,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  defaults: { title: string; body: string };
}) {
  return (
    <ActionForm action={action} successMessage>
      {(state) => (
        <>
          <Field label="Title" name="title" state={state} required>
            <TextInput name="title" state={state} defaultValue={defaults.title} required />
          </Field>
          <Field label="Document text" name="body" state={state} required>
            <TextArea
              name="body"
              state={state}
              defaultValue={defaults.body}
              required
              rows={20}
              className="font-mono text-xs leading-relaxed"
            />
          </Field>
          <SubmitButton pendingLabel="Saving…">Save draft</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
