"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/lib/forms";

/**
 * Destructive action with a confirmation step. Deliberately not a `window.confirm`
 * — the actions behind this refuse when there's financial history attached, and
 * the resulting explanation needs somewhere to render.
 */
export function DangerAction({
  action,
  label,
  confirmLabel,
  description,
}: {
  action: (state: ActionState) => Promise<ActionState>;
  label: string;
  confirmLabel: string;
  description?: string;
}) {
  const [state, formAction] = useActionState(action, null);

  return (
    <div className="space-y-3">
      {state && !state.ok ? (
        <p role="alert" className="rounded-lg border border-red-200 dark:border-red-400/25 bg-red-50 dark:bg-red-500/12 px-3.5 py-2.5 text-sm text-red-800 dark:text-red-200">
          {state.error}
        </p>
      ) : null}
      {description ? <p className="text-sm text-slate-500">{description}</p> : null}
      <details className="group">
        <summary className="btn-danger cursor-pointer list-none">{label}</summary>
        <form action={formAction} className="mt-3 flex items-center gap-3">
          <ConfirmButton>{confirmLabel}</ConfirmButton>
          <span className="text-xs text-slate-500">This can&apos;t be undone.</span>
        </form>
      </details>
    </div>
  );
}

function ConfirmButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="btn bg-red-600 text-white hover:bg-red-700 disabled:opacity-60"
    >
      {pending ? "Working…" : children}
    </button>
  );
}
