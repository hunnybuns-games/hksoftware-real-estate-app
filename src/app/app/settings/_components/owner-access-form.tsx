"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/form";
import type { ActionState } from "@/lib/forms";

/**
 * Checkbox group for owner property access. The selection is mirrored into a
 * hidden comma-joined field because an all-unchecked group sends no key at all,
 * which the server can't distinguish from "field omitted" — and "no access" has
 * to be an expressible choice.
 */
export function OwnerAccessForm({
  action,
  properties,
  selectedIds,
  readOnly,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  properties: { id: string; name: string }[];
  selectedIds: string[];
  readOnly: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(selectedIds));

  function toggle(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  return (
    <ActionForm action={action} successMessage>
      {() => (
        <>
          <input type="hidden" name="propertyIds" value={[...selected].join(",")} />
          <div className="grid gap-2 sm:grid-cols-2">
            {properties.map((property) => (
              <label
                key={property.id}
                className="flex items-center gap-2.5 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  checked={selected.has(property.id)}
                  disabled={readOnly}
                  onChange={(e) => toggle(property.id, e.currentTarget.checked)}
                  className="size-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500/30"
                />
                {property.name}
              </label>
            ))}
          </div>
          {readOnly ? null : <SubmitButton pendingLabel="Saving…">Save access</SubmitButton>}
        </>
      )}
    </ActionForm>
  );
}
