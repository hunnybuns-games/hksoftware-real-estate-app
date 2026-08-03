"use client";

import { ActionForm, SubmitButton, TextArea } from "@/components/form";
import type { ActionState } from "@/lib/forms";

export function TenantCommentForm({
  action,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
}) {
  return (
    <ActionForm action={action} className="space-y-2">
      {(state) => (
        <>
          <label htmlFor="note" className="sr-only">
            Add a comment
          </label>
          <TextArea
            name="note"
            state={state}
            rows={2}
            placeholder="Add an update for your manager…"
          />
          <SubmitButton variant="secondary" pendingLabel="Sending…">
            Add comment
          </SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
