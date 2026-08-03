"use client";

import { signupAction } from "../../actions";
import { ActionForm, Field, SubmitButton, TextInput } from "@/components/form";

export function SignupForm() {
  return (
    <ActionForm action={signupAction}>
      {(state) => (
        <>
          <Field label="Your name" name="name" state={state} required>
            <TextInput
              name="name"
              state={state}
              autoComplete="name"
              autoFocus
              required
              placeholder="Jordan Reyes"
            />
          </Field>
          <Field
            label="Company or portfolio name"
            name="organizationName"
            state={state}
            required
            hint="What your residents will see on emails. You can change it later."
          >
            <TextInput
              name="organizationName"
              state={state}
              autoComplete="organization"
              required
              placeholder="Reyes Property Group"
            />
          </Field>
          <Field label="Work email" name="email" state={state} required>
            <TextInput
              name="email"
              state={state}
              type="email"
              autoComplete="email"
              required
              placeholder="you@example.com"
            />
          </Field>
          <Field
            label="Password"
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
          <SubmitButton className="w-full" pendingLabel="Creating your account…">
            Create account
          </SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
