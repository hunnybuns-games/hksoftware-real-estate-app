"use client";

import { ActionForm, Field, SubmitButton, TextArea, TextInput } from "@/components/form";
import type { ActionState } from "@/lib/forms";

export function ScreeningResultsForm({
  action,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
}) {
  return (
    <ActionForm action={action}>
      {(state) => (
        <>
          <Field
            label="Result summary"
            name="resultSummary"
            state={state}
            hint="Whatever came back — a score range, flags, a pass/fail call. Staff-only, never shown to the applicant."
          >
            <TextArea name="resultSummary" state={state} rows={4} />
          </Field>
          <Field
            label="Report link"
            name="reportUrl"
            state={state}
            hint="Optional — a link to the full report in whatever you ran it through."
          >
            <TextInput name="reportUrl" state={state} type="url" placeholder="https://…" />
          </Field>
          <SubmitButton pendingLabel="Saving…" className="w-full">
            Save results
          </SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
