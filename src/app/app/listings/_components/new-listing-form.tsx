"use client";

import { ActionForm, Field, MoneyInput, Select, SubmitButton, TextArea, TextInput } from "@/components/form";
import type { ActionState } from "@/lib/forms";
import { PhotoInput } from "@/components/photo-input";
import { MAX_LISTING_PHOTOS } from "@/lib/constants";
import type { ListingUnitOption } from "@/lib/listing-options";

export function NewListingForm({
  action,
  units,
  defaultUnitId,
  defaultTitle,
  defaultAskingRent,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  units: ListingUnitOption[];
  defaultUnitId?: string;
  defaultTitle?: string;
  defaultAskingRent?: string;
}) {
  return (
    <ActionForm action={action}>
      {(state) => (
        <>
          <Field label="Unit" name="unitId" state={state} required>
            <Select name="unitId" state={state} defaultValue={defaultUnitId ?? ""} required>
              <option value="">Choose a unit…</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.propertyName} — {u.label}
                  {u.status !== "VACANT" ? ` (${u.status.toLowerCase()})` : ""}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Title" name="title" state={state} required>
            <TextInput
              name="title"
              state={state}
              defaultValue={defaultTitle}
              placeholder="Sunny 2BR near downtown"
              required
            />
          </Field>

          <Field label="Description" name="description" state={state} required>
            <TextArea name="description" state={state} rows={5} required />
          </Field>

          <Field
            label="Amenities"
            name="amenities"
            state={state}
            hint="Comma-separated — appears as a bullet list in the copy-paste export."
          >
            <TextInput name="amenities" state={state} placeholder="In-unit laundry, Pet friendly, Off-street parking" />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Asking rent" name="askingRentCents" state={state} required>
              <MoneyInput name="askingRentCents" state={state} defaultValue={defaultAskingRent} required />
            </Field>
            <Field label="Available" name="availableDate" state={state} hint="Leave blank for now.">
              <TextInput name="availableDate" state={state} type="date" />
            </Field>
          </div>

          <Field label="Status" name="status" state={state} required>
            <Select name="status" state={state} defaultValue="ACTIVE" required>
              <option value="ACTIVE">Active — ready to advertise</option>
              <option value="DRAFT">Draft — still preparing it</option>
            </Select>
          </Field>

          <PhotoInput state={state} maxCount={MAX_LISTING_PHOTOS} hint="Optional — you can also add these after creating the listing." />

          <SubmitButton pendingLabel="Creating…">Create listing</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
