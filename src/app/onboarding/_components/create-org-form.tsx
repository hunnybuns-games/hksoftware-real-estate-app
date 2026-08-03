"use client";

import { createOrganizationAction } from "@/actions/org";
import { ActionForm, Field, SubmitButton, TextInput } from "@/components/form";

export function CreateOrgForm() {
  return (
    <ActionForm action={createOrganizationAction}>
      {(state) => (
        <>
          <Field label="Company or portfolio name" name="name" state={state} required>
            <TextInput
              name="name"
              state={state}
              required
              autoFocus
              placeholder="Reyes Property Group"
            />
          </Field>
          <SubmitButton className="w-full" pendingLabel="Setting up…">
            Continue
          </SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
