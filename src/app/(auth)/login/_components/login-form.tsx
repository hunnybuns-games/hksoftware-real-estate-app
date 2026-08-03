"use client";

import { loginAction } from "../../actions";
import { ActionForm, Field, SubmitButton, TextInput } from "@/components/form";

export function LoginForm({ redirectTo }: { redirectTo: string }) {
  return (
    <ActionForm action={loginAction}>
      {(state) => (
        <>
          <input type="hidden" name="redirectTo" value={redirectTo} />
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
          <Field label="Password" name="password" state={state} required>
            <TextInput
              name="password"
              state={state}
              type="password"
              autoComplete="current-password"
              required
            />
          </Field>
          <SubmitButton className="w-full" pendingLabel="Signing in…">
            Sign in
          </SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
