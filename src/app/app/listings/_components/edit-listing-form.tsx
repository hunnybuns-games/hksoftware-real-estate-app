"use client";

import { ActionForm, Field, MoneyInput, Select, SubmitButton, TextArea, TextInput } from "@/components/form";
import type { ActionState } from "@/lib/forms";

export function EditListingForm({
  action,
  defaults,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  defaults: {
    title: string;
    description: string;
    amenities: string;
    askingRentCents: string;
    availableDate: string;
    status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  };
}) {
  return (
    <ActionForm action={action} successMessage>
      {(state) => (
        <>
          <Field label="Title" name="title" state={state} required>
            <TextInput name="title" state={state} defaultValue={defaults.title} required />
          </Field>

          <Field label="Description" name="description" state={state} required>
            <TextArea name="description" state={state} defaultValue={defaults.description} rows={5} required />
          </Field>

          <Field
            label="Amenities"
            name="amenities"
            state={state}
            hint="Comma-separated — appears as a bullet list in the copy-paste export."
          >
            <TextInput name="amenities" state={state} defaultValue={defaults.amenities} />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Asking rent" name="askingRentCents" state={state} required>
              <MoneyInput name="askingRentCents" state={state} defaultValue={defaults.askingRentCents} required />
            </Field>
            <Field label="Available" name="availableDate" state={state}>
              <TextInput name="availableDate" state={state} type="date" defaultValue={defaults.availableDate} />
            </Field>
          </div>

          <Field label="Status" name="status" state={state} required>
            <Select name="status" state={state} defaultValue={defaults.status} required>
              <option value="ACTIVE">Active — being advertised</option>
              <option value="DRAFT">Draft — still preparing it</option>
              <option value="ARCHIVED">Archived — no longer advertising</option>
            </Select>
          </Field>

          <SubmitButton pendingLabel="Saving…">Save listing</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
