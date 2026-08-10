"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/lib/forms";

/**
 * Voiding leaves the row visible but stops it counting toward the balance — a
 * landlord needs to be able to explain a balance that changed.
 */
export function VoidChargeButton({ action }: { action: (state: ActionState) => Promise<ActionState> }) {
  const [state, formAction] = useActionState(action, null);

  return (
    <form action={formAction}>
      {state && !state.ok ? (
        <span className="mr-2 text-xs text-red-600 dark:text-red-400">{state.error}</span>
      ) : null}
      <VoidButton />
    </form>
  );
}

function VoidButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="text-xs font-medium text-slate-500 hover:text-red-700 dark:hover:text-red-300 disabled:opacity-50"
    >
      {pending ? "Voiding…" : "Void"}
    </button>
  );
}
