"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/lib/forms";

export function DeleteExpenseButton({ action }: { action: (state: ActionState) => Promise<ActionState> }) {
  const [state, formAction] = useActionState(action, null);

  return (
    <form action={formAction}>
      {state && !state.ok ? <span className="mr-2 text-xs text-red-600">{state.error}</span> : null}
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
      className="text-xs font-medium text-slate-500 hover:text-red-700 disabled:opacity-50"
    >
      {pending ? "Removing…" : "Remove"}
    </button>
  );
}
