"use client";

import { useState } from "react";
import { ActionForm, Field, Select, SubmitButton, TextArea, TextInput } from "@/components/form";
import type { ActionState } from "@/lib/forms";
import { US_STATES } from "@/lib/constants";
import { AddressAutocompleteInput } from "@/components/address-autocomplete-input";

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
  // Controlled, not defaultValue, only for the four fields an autocomplete
  // suggestion can fill in at once — see AddressAutocompleteInput. Every
  // field stays a normal editable input regardless; a suggestion just
  // pre-fills them the same way typing would.
  const [addressLine1, setAddressLine1] = useState(defaults.addressLine1);
  const [city, setCity] = useState(defaults.city);
  const [region, setRegion] = useState(defaults.state);
  const [postalCode, setPostalCode] = useState(defaults.postalCode);

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

          <Field
            label="Street address"
            name="addressLine1"
            state={state}
            required
            hint="Start typing for suggestions."
          >
            <AddressAutocompleteInput
              name="addressLine1"
              state={state}
              value={addressLine1}
              onValueChange={setAddressLine1}
              onSelect={(parsed) => {
                setAddressLine1(parsed.addressLine1);
                if (parsed.city) setCity(parsed.city);
                if (parsed.state) setRegion(parsed.state);
                if (parsed.postalCode) setPostalCode(parsed.postalCode);
              }}
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
                value={city}
                onChange={(e) => setCity(e.target.value)}
                autoComplete="address-level2"
                required
              />
            </Field>
            <Field label="State" name="state" state={state} required>
              <Select
                name="state"
                state={state}
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                required
              >
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
                value={postalCode}
                onChange={(e) => setPostalCode(e.target.value)}
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
