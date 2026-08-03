"use client";

import { ActionForm, Field, Select, SubmitButton, TextArea } from "@/components/form";
import type { ActionState } from "@/lib/forms";

export function UpdateRequestForm({
  action,
  currentStatus,
  canNotify,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  currentStatus: "OPEN" | "IN_PROGRESS" | "RESOLVED";
  canNotify: boolean;
}) {
  return (
    <ActionForm action={action} successMessage>
      {(state) => (
        <>
          <Field label="Status" name="status" state={state} required>
            <Select name="status" state={state} defaultValue={currentStatus} required>
              <option value="OPEN">Open</option>
              <option value="IN_PROGRESS">In progress</option>
              <option value="RESOLVED">Resolved</option>
            </Select>
          </Field>

          <Field
            label="Add a note"
            name="note"
            state={state}
            hint="Optional. What you found, who's going out, when."
          >
            <TextArea
              name="note"
              state={state}
              rows={3}
              placeholder="Plumber scheduled for Thursday morning."
            />
          </Field>

          {canNotify ? (
            <label className="flex items-start gap-2.5 text-sm text-slate-700">
              <input
                type="checkbox"
                name="notifyTenant"
                className="mt-0.5 size-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500/30"
              />
              <span>
                Email the resident this update
                <span className="block text-xs text-slate-500">
                  Notes are internal unless you tick this.
                </span>
              </span>
            </label>
          ) : null}

          <SubmitButton pendingLabel="Saving…">Save update</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
