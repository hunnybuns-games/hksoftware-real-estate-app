"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/lib/forms";

export function CancelScreeningButton({
  action,
}: {
  action: (state: ActionState) => Promise<ActionState>;
}) {
  const [state, formAction] = useActionState(action, null);

  return (
    <form action={formAction}>
      {state && !state.ok ? (
        <p className="mb-2 text-xs text-red-600 dark:text-red-400">{state.error}</p>
      ) : null}
      <SubmitPendingButton />
    </form>
  );
}

function SubmitPendingButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn-secondary w-full disabled:opacity-50">
      {pending ? "Canceling…" : "Cancel request"}
    </button>
  );
}
