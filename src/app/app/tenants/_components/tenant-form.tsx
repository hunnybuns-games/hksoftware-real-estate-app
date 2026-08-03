"use client";

import { ActionForm, Field, SubmitButton, TextArea, TextInput } from "@/components/form";
import type { ActionState } from "@/lib/forms";

export type TenantFormValues = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  notes: string;
};

const empty: TenantFormValues = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  notes: "",
};

export function TenantForm({
  action,
  defaults = empty,
  submitLabel,
  cancelHref,
  emailLocked = false,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  defaults?: TenantFormValues;
  submitLabel: string;
  cancelHref: string;
  emailLocked?: boolean;
}) {
  return (
    <ActionForm action={action} successMessage>
      {(state) => (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First name" name="firstName" state={state} required>
              <TextInput
                name="firstName"
                state={state}
                defaultValue={defaults.firstName}
                autoComplete="given-name"
                required
                autoFocus
              />
            </Field>
            <Field label="Last name" name="lastName" state={state} required>
              <TextInput
                name="lastName"
                state={state}
                defaultValue={defaults.lastName}
                autoComplete="family-name"
                required
              />
            </Field>
          </div>

          <Field
            label="Email"
            name="email"
            state={state}
            required
            hint={
              emailLocked
                ? "This resident has a portal login, so their email is managed by their account."
                : "Where their portal invitation and rent notices go."
            }
          >
            <TextInput
              name="email"
              state={state}
              type="email"
              defaultValue={defaults.email}
              autoComplete="email"
              required
              readOnly={emailLocked}
              disabled={emailLocked}
            />
          </Field>
          {/* A disabled input submits nothing, so keep the value in the payload. */}
          {emailLocked ? <input type="hidden" name="email" value={defaults.email} /> : null}

          <Field label="Phone" name="phone" state={state}>
            <TextInput
              name="phone"
              state={state}
              type="tel"
              defaultValue={defaults.phone}
              autoComplete="tel"
              placeholder="Optional"
            />
          </Field>

          <Field label="Notes" name="notes" state={state} hint="Internal only — the resident never sees this.">
            <TextArea name="notes" state={state} defaultValue={defaults.notes} rows={3} />
          </Field>

          <div className="flex items-center gap-3 pt-1">
            <SubmitButton pendingLabel="Saving…">{submitLabel}</SubmitButton>
            <a href={cancelHref} className="btn-ghost">
              Cancel
            </a>
          </div>
        </>
      )}
    </ActionForm>
  );
}
