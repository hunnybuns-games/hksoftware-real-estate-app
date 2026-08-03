"use client";

import { ActionForm, Field, Select, SubmitButton, TextArea, TextInput } from "@/components/form";
import { PhotoInput } from "@/components/photo-input";
import type { ActionState } from "@/lib/forms";

export function StaffRequestForm({
  action,
  units,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  units: { id: string; label: string; property: { name: string } }[];
}) {
  return (
    <ActionForm action={action}>
      {(state) => (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Unit" name="unitId" state={state} required>
              <Select name="unitId" state={state} required defaultValue="">
                <option value="">Choose a unit…</option>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.property.name} — {u.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Priority" name="priority" state={state} required>
              <Select name="priority" state={state} defaultValue="NORMAL" required>
                <option value="LOW">Low</option>
                <option value="NORMAL">Normal</option>
                <option value="HIGH">High</option>
                <option value="URGENT">Urgent</option>
              </Select>
            </Field>
          </div>

          <Field label="What's the issue?" name="title" state={state} required>
            <TextInput
              name="title"
              state={state}
              required
              placeholder="Kitchen faucet dripping"
            />
          </Field>

          <Field label="Details" name="description" state={state} required>
            <TextArea
              name="description"
              state={state}
              rows={4}
              required
              placeholder="What's happening, when it started, anything you've already tried."
            />
          </Field>

          <PhotoInput state={state} />

          <SubmitButton pendingLabel="Saving…">Log request</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
