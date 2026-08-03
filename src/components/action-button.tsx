"use client";

import { useActionState } from "react";
import type { ActionState } from "@/lib/forms";
import { FormError, FormSuccess, SubmitButton } from "@/components/form";

/**
 * A one-click server action with inline result feedback. For anything with
 * inputs use ActionForm; for anything destructive use DangerAction.
 */
export function ActionButton({
  action,
  label,
  pendingLabel,
  variant = "secondary",
  className,
}: {
  action: (state: ActionState) => Promise<ActionState>;
  label: string;
  pendingLabel?: string;
  variant?: "primary" | "secondary" | "danger";
  className?: string;
}) {
  const [state, formAction] = useActionState(action, null);

  return (
    <form action={formAction} className={className ?? "space-y-3"}>
      <FormError state={state} />
      <FormSuccess state={state} />
      <SubmitButton variant={variant} pendingLabel={pendingLabel ?? "Working…"}>
        {label}
      </SubmitButton>
    </form>
  );
}
