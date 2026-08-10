"use client";

import { resetPasswordAction } from "../../../actions";
import { ActionForm, Field, SubmitButton, TextInput } from "@/components/form";

export function ResetPasswordForm({ token, email }: { token: string; email: string }) {
  return (
    <ActionForm action={resetPasswordAction}>
      {(state) => (
        <>
          <input type="hidden" name="token" value={token} />
          {/*
            Hidden and read-only, purely so password managers file the new
            credential under the right account. Nothing on the server reads it —
            the account comes from the token.
          */}
          <input type="hidden" name="username" autoComplete="username" value={email} readOnly />
          <Field
            label="New password"
            name="password"
            state={state}
            required
            hint="At least 8 characters."
          >
            <TextInput
              name="password"
              state={state}
              type="password"
              autoComplete="new-password"
              autoFocus
              required
            />
          </Field>
          <SubmitButton className="w-full" pendingLabel="Saving…">
            Save and sign in
          </SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
