"use client";

import { ActionForm, Select } from "@/components/form";
import type { ActionState } from "@/lib/forms";

export function AssignVendorForm({
  action,
  vendors,
  currentVendorId,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  vendors: { id: string; name: string; trade: string | null; active: boolean }[];
  currentVendorId: string | null;
}) {
  return (
    // Keyed on the server-confirmed value: React 19 resets a form's
    // uncontrolled fields to their defaultValue once a Server Action
    // submission completes, which would otherwise snap this select back to
    // whatever it showed at first mount — not the assignment that was just
    // saved — even though the write itself succeeded. Changing the key when
    // currentVendorId changes forces a fresh mount with the new value as its
    // defaultValue instead of a reset to the old one.
    <ActionForm key={currentVendorId ?? "unassigned"} action={action} successMessage className="space-y-3">
      {(state) => (
        <>
          {/* Submits on change — a separate save button for one dropdown is
              more friction than it's worth (same idiom as the team role picker). */}
          <Select
            name="vendorId"
            state={state}
            defaultValue={currentVendorId ?? ""}
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
          >
            <option value="">Unassigned</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
                {v.trade ? ` (${v.trade})` : ""}
                {v.active ? "" : " — archived"}
              </option>
            ))}
          </Select>
        </>
      )}
    </ActionForm>
  );
}
