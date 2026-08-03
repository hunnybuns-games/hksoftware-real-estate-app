"use client";

import { ActionForm, Field, Select, SubmitButton, TextArea, TextInput } from "@/components/form";
import { PhotoInput } from "@/components/photo-input";
import type { ActionState } from "@/lib/forms";

/**
 * Mobile-first: a resident is standing in front of the problem with a phone.
 * Four fields, big tap targets, photo picker that opens the camera roll.
 */
export function TenantRequestForm({
  action,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
}) {
  return (
    <ActionForm action={action}>
      {(state) => (
        <>
          <Field label="What's wrong?" name="title" state={state} required>
            <TextInput
              name="title"
              state={state}
              required
              placeholder="Kitchen sink is leaking"
            />
          </Field>

          <Field
            label="Tell us more"
            name="description"
            state={state}
            required
            hint="When it started, how bad it is, and the best times for someone to come by."
          >
            <TextArea
              name="description"
              state={state}
              rows={5}
              required
              placeholder="Started yesterday evening. Water pools under the cabinet. I'm home after 5pm most days."
            />
          </Field>

          <Field
            label="How urgent is it?"
            name="priority"
            state={state}
            required
            hint="Pick Urgent for anything unsafe — no heat, flooding, no power, a security issue."
          >
            <Select name="priority" state={state} defaultValue="NORMAL" required>
              <option value="LOW">Low — whenever convenient</option>
              <option value="NORMAL">Normal — in the next few days</option>
              <option value="HIGH">High — soon, please</option>
              <option value="URGENT">Urgent — unsafe or unlivable</option>
            </Select>
          </Field>

          <PhotoInput state={state} />

          <SubmitButton className="w-full py-2.5" pendingLabel="Sending…">
            Submit request
          </SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
