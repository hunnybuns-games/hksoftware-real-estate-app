"use client";

import { ActionForm, Field, MoneyInput, Select, SubmitButton, TextInput } from "@/components/form";
import type { ActionState } from "@/lib/forms";

export type UnitFormValues = {
  label: string;
  bedrooms: string;
  bathrooms: string;
  sqft: string;
  marketRent: string;
  status: "VACANT" | "OCCUPIED" | "MAINTENANCE";
};

const empty: UnitFormValues = {
  label: "",
  bedrooms: "1",
  bathrooms: "1",
  sqft: "",
  marketRent: "",
  status: "VACANT",
};

export function UnitForm({
  action,
  defaults = empty,
  submitLabel,
  onCancelHref,
  compact = false,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  defaults?: UnitFormValues;
  submitLabel: string;
  onCancelHref?: string;
  compact?: boolean;
}) {
  return (
    <ActionForm action={action} successMessage>
      {(state) => (
        <>
          <div className={compact ? "grid gap-4 sm:grid-cols-2" : "grid gap-4 sm:grid-cols-2"}>
            <Field
              label="Unit name"
              name="label"
              state={state}
              required
              hint="“2B”, “Unit 4”, or “House” for a single-family."
            >
              <TextInput name="label" state={state} defaultValue={defaults.label} required />
            </Field>

            <Field label="Status" name="status" state={state} required>
              <Select name="status" state={state} defaultValue={defaults.status} required>
                <option value="VACANT">Vacant</option>
                <option value="OCCUPIED">Occupied</option>
                <option value="MAINTENANCE">Off-market / maintenance</option>
              </Select>
            </Field>

            <Field label="Bedrooms" name="bedrooms" state={state} required>
              <TextInput
                name="bedrooms"
                state={state}
                defaultValue={defaults.bedrooms}
                inputMode="numeric"
                required
              />
            </Field>

            <Field label="Bathrooms" name="bathrooms" state={state} required hint="Halves are fine — 1.5.">
              <TextInput
                name="bathrooms"
                state={state}
                defaultValue={defaults.bathrooms}
                inputMode="decimal"
                required
              />
            </Field>

            <Field label="Square feet" name="sqft" state={state}>
              <TextInput
                name="sqft"
                state={state}
                defaultValue={defaults.sqft}
                inputMode="numeric"
                placeholder="Optional"
              />
            </Field>

            <Field
              label="Market rent"
              name="marketRentCents"
              state={state}
              required
              hint="What you'd list it for. The lease sets what's actually charged."
            >
              <MoneyInput
                name="marketRentCents"
                state={state}
                defaultValue={defaults.marketRent}
                required
              />
            </Field>
          </div>

          <div className="flex items-center gap-3 pt-1">
            <SubmitButton pendingLabel="Saving…">{submitLabel}</SubmitButton>
            {onCancelHref ? (
              <a href={onCancelHref} className="btn-ghost">
                Cancel
              </a>
            ) : null}
          </div>
        </>
      )}
    </ActionForm>
  );
}
