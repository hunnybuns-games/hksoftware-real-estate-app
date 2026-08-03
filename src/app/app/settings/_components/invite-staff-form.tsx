"use client";

import { ActionForm, Field, Select, SubmitButton, TextInput } from "@/components/form";
import type { ActionState } from "@/lib/forms";

export function InviteStaffForm({
  action,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
}) {
  return (
    <ActionForm action={action} successMessage>
      {(state) => (
        <>
          <div className="grid gap-4 sm:grid-cols-[1fr_1fr_9rem]">
            <Field label="Name" name="name" state={state} required>
              <TextInput name="name" state={state} required placeholder="Sam Okafor" />
            </Field>
            <Field label="Email" name="email" state={state} required>
              <TextInput
                name="email"
                state={state}
                type="email"
                required
                placeholder="sam@example.com"
              />
            </Field>
            <Field label="Role" name="role" state={state} required>
              <Select name="role" state={state} defaultValue="STAFF" required>
                <option value="STAFF">Staff</option>
                <option value="ADMIN">Admin</option>
                <option value="OWNER">Owner</option>
              </Select>
            </Field>
          </div>
          <SubmitButton pendingLabel="Sending…">Send invitation</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
