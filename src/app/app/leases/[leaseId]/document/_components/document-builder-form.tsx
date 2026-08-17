"use client";

import { ActionForm, Field, SubmitButton, TextArea, TextInput } from "@/components/form";
import type { ActionState } from "@/lib/forms";
import { LEASE_CLAUSES, defaultSelectedClauseIds } from "@/lib/lease-document";

export function DocumentBuilderForm({
  action,
  suggestedTitle,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  suggestedTitle: string;
}) {
  const defaultClauses = new Set(defaultSelectedClauseIds());

  return (
    <ActionForm action={action}>
      {(state) => (
        <>
          <Field label="Title" name="title" state={state} hint="Leave blank to use the default below.">
            <TextInput name="title" state={state} placeholder={suggestedTitle} />
          </Field>

          <fieldset>
            <legend className="label mb-2">Optional clauses</legend>
            <div className="grid gap-2.5 sm:grid-cols-2">
              {LEASE_CLAUSES.map((clause) => (
                <label
                  key={clause.id}
                  className="flex items-start gap-2.5 rounded-lg border border-slate-200 p-3 text-sm hover:bg-slate-50/60"
                >
                  <input
                    type="checkbox"
                    name="clauses"
                    value={clause.id}
                    defaultChecked={defaultClauses.has(clause.id)}
                    className="mt-0.5 size-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500/30"
                  />
                  <span>
                    <span className="block font-medium text-slate-900">{clause.label}</span>
                    <span className="block text-xs text-slate-500">{clause.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <Field
            label="Additional terms"
            name="extraTerms"
            state={state}
            hint="Anything specific to this lease — appears at the end of the additional provisions section."
          >
            <TextArea name="extraTerms" state={state} rows={4} />
          </Field>

          <SubmitButton pendingLabel="Generating…">Generate document</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
