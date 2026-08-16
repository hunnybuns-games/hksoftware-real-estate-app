"use client";

import { useState } from "react";
import {
  ActionForm,
  Field,
  MoneyInput,
  SubmitButton,
  TextArea,
  TextInput,
} from "@/components/form";
import type { ActionState } from "@/lib/forms";

export function ApplicationForm({
  action,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
}) {
  const [hasPets, setHasPets] = useState(false);

  return (
    <ActionForm action={action}>
      {(state) => (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First name" name="firstName" state={state} required>
              <TextInput name="firstName" state={state} autoComplete="given-name" autoFocus required />
            </Field>
            <Field label="Last name" name="lastName" state={state} required>
              <TextInput name="lastName" state={state} autoComplete="family-name" required />
            </Field>
            <Field label="Email" name="email" state={state} required>
              <TextInput name="email" state={state} type="email" autoComplete="email" required />
            </Field>
            <Field label="Phone" name="phone" state={state}>
              <TextInput name="phone" state={state} type="tel" autoComplete="tel" />
            </Field>
            <Field label="Desired move-in date" name="desiredMoveInDate" state={state}>
              <TextInput name="desiredMoveInDate" state={state} type="date" />
            </Field>
            <Field label="Number of occupants" name="occupants" state={state}>
              <TextInput name="occupants" state={state} type="number" min={1} max={20} />
            </Field>
            <Field
              label="Monthly income"
              name="monthlyIncomeCents"
              state={state}
              hint="Optional, but it helps get your application reviewed faster."
            >
              <MoneyInput name="monthlyIncomeCents" state={state} />
            </Field>
          </div>

          <div className="rounded-lg border border-slate-200 p-4">
            <label className="flex items-start gap-2.5 text-sm text-slate-700">
              <input
                type="checkbox"
                name="hasPets"
                checked={hasPets}
                onChange={(e) => setHasPets(e.currentTarget.checked)}
                className="mt-0.5 size-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500/30"
              />
              <span>I have a pet or pets that would live with me</span>
            </label>

            {hasPets ? (
              <div className="mt-4">
                <Field
                  label="Tell us about your pet(s)"
                  name="petDetails"
                  state={state}
                  hint="Type, breed, size — whatever's relevant."
                >
                  <TextInput name="petDetails" state={state} placeholder="One dog, ~30 lbs, friendly" />
                </Field>
              </div>
            ) : null}
          </div>

          <Field
            label="Anything else you'd like us to know?"
            name="message"
            state={state}
            hint="Optional."
          >
            <TextArea name="message" state={state} rows={4} />
          </Field>

          <SubmitButton className="w-full" pendingLabel="Submitting…">
            Submit application
          </SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
