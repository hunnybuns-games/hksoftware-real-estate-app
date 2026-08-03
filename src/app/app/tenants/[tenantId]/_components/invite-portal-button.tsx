"use client";

import type { ActionState } from "@/lib/forms";
import { ActionButton } from "@/components/action-button";

export function InvitePortalButton({
  action,
  label,
}: {
  action: (state: ActionState) => Promise<ActionState>;
  label: string;
}) {
  return <ActionButton action={action} label={label} pendingLabel="Sending…" variant="primary" />;
}
