"use client";

import type { ApplicationStatus } from "@prisma/client";
import { ActionForm, Field, Select, SubmitButton, TextArea } from "@/components/form";
import type { ActionState } from "@/lib/forms";
import { applicationStatusLabel } from "@/lib/applications";

export function ReviewForm({
  action,
  currentStatus,
  statusOptions,
  defaultNotes,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  currentStatus: ApplicationStatus;
  statusOptions: ApplicationStatus[];
  defaultNotes: string;
}) {
  return (
    <ActionForm action={action} successMessage>
      {(state) => (
        <>
          <Field label="Status" name="status" state={state} required>
            <Select name="status" state={state} defaultValue={currentStatus} required>
              {statusOptions.map((s) => (
                <option key={s} value={s}>
                  {applicationStatusLabel(s)}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Internal notes"
            name="reviewNotes"
            state={state}
            hint="Never shown to the applicant."
          >
            <TextArea name="reviewNotes" state={state} rows={4} defaultValue={defaultNotes} />
          </Field>

          <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
