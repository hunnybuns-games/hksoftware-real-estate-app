"use client";

import { acceptInviteAction } from "../../../actions";
import { ActionForm, Field, SubmitButton, TextInput } from "@/components/form";

export function AcceptInviteForm({
  token,
  email,
  name,
  isTenant,
}: {
  token: string;
  email: string;
  name: string;
  isTenant: boolean;
}) {
  return (
    <ActionForm action={acceptInviteAction}>
      {(state) => (
        <>
          <input type="hidden" name="token" value={token} />
          <Field label="Email" name="_email">
            <TextInput name="_email" value={email} readOnly disabled />
          </Field>
          <Field label="Your name" name="name" state={state} required>
            <TextInput
              name="name"
              state={state}
              defaultValue={name}
              autoComplete="name"
              required
              autoFocus
            />
          </Field>
          <Field
            label="Create a password"
            name="password"
            state={state}
            required
            hint="At least 10 characters."
          >
            <TextInput
              name="password"
              state={state}
              type="password"
              autoComplete="new-password"
              required
              minLength={10}
            />
          </Field>
          <SubmitButton className="w-full" pendingLabel="Setting up…">
            {isTenant ? "Open my portal" : "Join the team"}
          </SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
