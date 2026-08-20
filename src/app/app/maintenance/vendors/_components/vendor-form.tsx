"use client";

import { ActionForm, Field, SubmitButton, TextArea, TextInput } from "@/components/form";
import type { ActionState } from "@/lib/forms";

export type VendorFormValues = {
  name: string;
  trade: string;
  contactName: string;
  email: string;
  phone: string;
  notes: string;
};

const empty: VendorFormValues = {
  name: "",
  trade: "",
  contactName: "",
  email: "",
  phone: "",
  notes: "",
};

export function VendorForm({
  action,
  defaults = empty,
  submitLabel,
  cancelHref,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  defaults?: VendorFormValues;
  submitLabel: string;
  cancelHref: string;
}) {
  return (
    <ActionForm action={action} successMessage>
      {(state) => (
        <>
          <Field
            label="Name"
            name="name"
            state={state}
            required
            hint="A company or a person — “Riverside Plumbing”, “Joe (handyman)”."
          >
            <TextInput name="name" state={state} defaultValue={defaults.name} required autoFocus />
          </Field>

          <Field label="Trade" name="trade" state={state} hint="Plumbing, electrical, HVAC — whatever you'd call it.">
            <TextInput name="trade" state={state} defaultValue={defaults.trade} />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Contact name" name="contactName" state={state} hint="If different from the name above.">
              <TextInput name="contactName" state={state} defaultValue={defaults.contactName} />
            </Field>
            <Field label="Phone" name="phone" state={state}>
              <TextInput name="phone" state={state} defaultValue={defaults.phone} type="tel" />
            </Field>
          </div>

          <Field label="Email" name="email" state={state}>
            <TextInput name="email" state={state} defaultValue={defaults.email} type="email" />
          </Field>

          <Field
            label="Notes"
            name="notes"
            state={state}
            hint="License/insurance info, service area, anything worth remembering."
          >
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
