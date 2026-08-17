"use client";

import { useState } from "react";
import { ActionForm, Field, SubmitButton, TextArea, TextInput } from "@/components/form";
import type { ActionState } from "@/lib/forms";

export function ListingConnectionForm({
  action,
  defaults,
  hasStoredKey,
  readOnly,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  defaults: { accountLabel: string; notes: string };
  hasStoredKey: boolean;
  readOnly: boolean;
}) {
  const [clear, setClear] = useState(false);

  return (
    <ActionForm action={action} successMessage>
      {(state) => (
        <>
          <Field
            label="Account label"
            name="accountLabel"
            state={state}
            hint="For your own reference — which account this is, not verified against anything."
          >
            <TextInput
              name="accountLabel"
              state={state}
              defaultValue={defaults.accountLabel}
              placeholder="e.g. Cedar & Vine Property Group — Zillow Rental Manager"
              disabled={readOnly}
            />
          </Field>

          <Field
            label="Feed ID / API key"
            name="apiKey"
            state={state}
            hint={
              hasStoredKey
                ? "A key is saved. Leave blank to keep it, or type a new one to replace it."
                : "Not used by anything yet — see the note above. Paste one here once you have it, so it's ready."
            }
          >
            <TextInput
              name="apiKey"
              state={state}
              type="password"
              placeholder={hasStoredKey ? "•••••••••• (saved)" : ""}
              disabled={readOnly || clear}
            />
          </Field>

          {hasStoredKey && !readOnly ? (
            <label className="flex items-center gap-2.5 text-sm text-slate-700">
              <input
                type="checkbox"
                name="clearApiKey"
                checked={clear}
                onChange={(e) => setClear(e.currentTarget.checked)}
                className="size-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500/30"
              />
              Remove the saved key
            </label>
          ) : null}

          <Field label="Notes" name="notes" state={state}>
            <TextArea name="notes" state={state} defaultValue={defaults.notes} rows={2} disabled={readOnly} />
          </Field>

          {readOnly ? null : <SubmitButton pendingLabel="Saving…">Save</SubmitButton>}
        </>
      )}
    </ActionForm>
  );
}
