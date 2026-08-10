"use client";

import { requestPasswordResetAction } from "../../actions";
import { ActionForm, Field, SubmitButton, TextInput } from "@/components/form";

export function ForgotPasswordForm() {
  return (
    // successMessage, because the whole point of this form is the message it
    // returns — it deliberately doesn't say whether the address matched.
    <ActionForm action={requestPasswordResetAction} successMessage>
      {(state) => (
        <>
          <Field label="Email" name="email" state={state} required>
            <TextInput
              name="email"
              state={state}
              type="email"
              autoComplete="email"
              autoFocus
              required
              placeholder="you@example.com"
            />
          </Field>
          <SubmitButton className="w-full" pendingLabel="Sending…">
            Send reset link
          </SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
