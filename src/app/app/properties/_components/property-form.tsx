"use client";

import { ActionForm, Field, Select, SubmitButton, TextArea, TextInput } from "@/components/form";
import type { ActionState } from "@/lib/forms";
import { US_STATES } from "@/lib/constants";

export type PropertyFormValues = {
  name: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  notes: string;
};

const empty: PropertyFormValues = {
  name: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  state: "",
  postalCode: "",
  notes: "",
};

export function PropertyForm({
  action,
  defaults = empty,
  submitLabel,
  cancelHref,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  defaults?: PropertyFormValues;
  submitLabel: string;
  cancelHref: string;
}) {
  return (
    <ActionForm action={action} successMessage>
      {(state) => (
        <>
          <Field
            label="Property name"
            name="name"
            state={state}
            required
            hint="What you call it internally — “Maple Court”, “112 Oak”."
          >
            <TextInput name="name" state={state} defaultValue={defaults.name} required autoFocus />
          </Field>

          <Field label="Street address" name="addressLine1" state={state} required>
            <TextInput
              name="addressLine1"
              state={state}
              defaultValue={defaults.addressLine1}
              autoComplete="address-line1"
              required
            />
          </Field>

          <Field label="Apt, suite, etc." name="addressLine2" state={state}>
            <TextInput
              name="addressLine2"
              state={state}
              defaultValue={defaults.addressLine2}
              autoComplete="address-line2"
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-[1fr_7rem_8rem]">
            <Field label="City" name="city" state={state} required>
              <TextInput
                name="city"
                state={state}
                defaultValue={defaults.city}
                autoComplete="address-level2"
                required
              />
            </Field>
            <Field label="State" name="state" state={state} required>
              <Select name="state" state={state} defaultValue={defaults.state} required>
                <option value="">—</option>
                {US_STATES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="ZIP" name="postalCode" state={state} required>
              <TextInput
                name="postalCode"
                state={state}
                defaultValue={defaults.postalCode}
                autoComplete="postal-code"
                inputMode="numeric"
                required
              />
            </Field>
          </div>

          <Field label="Notes" name="notes" state={state} hint="Internal only — residents never see this.">
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
