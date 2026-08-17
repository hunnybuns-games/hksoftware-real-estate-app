"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/lib/forms";

export function DeletePhotoButton({ action }: { action: (state: ActionState) => Promise<ActionState> }) {
  const [state, formAction] = useActionState(action, null);

  return (
    <form action={formAction} className="absolute top-1.5 right-1.5">
      {state && !state.ok ? (
        <span className="sr-only" role="alert">
          {state.error}
        </span>
      ) : null}
      <RemoveButton />
    </form>
  );
}

function RemoveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-label="Remove photo"
      title="Remove photo"
      className="flex size-6 items-center justify-center rounded-full bg-black/60 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50"
    >
      {pending ? "…" : "✕"}
    </button>
  );
}
