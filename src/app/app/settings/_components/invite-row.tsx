"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/lib/forms";
import { Badge } from "@/components/ui";

export function InviteRow({
  invite,
  canManage,
  revokeAction,
}: {
  invite: {
    id: string;
    name: string;
    email: string;
    role: string;
    expires: string;
    link: string | null;
  };
  canManage: boolean;
  revokeAction: (state: ActionState) => Promise<ActionState>;
}) {
  const [state, formAction] = useActionState(revokeAction, null);

  return (
    <tr>
      <td className="td">
        <span className="font-medium text-slate-900">{invite.name}</span>
        <span className="block text-xs text-slate-500">{invite.email}</span>
        {invite.link ? (
          <input
            readOnly
            value={invite.link}
            onFocus={(e) => e.currentTarget.select()}
            className="mt-1.5 w-full max-w-md rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-600"
          />
        ) : null}
        {state && !state.ok ? (
          <span className="mt-1 block text-xs font-medium text-red-600 dark:text-red-400">{state.error}</span>
        ) : null}
      </td>
      <td className="td">
        <Badge tone="neutral">{invite.role.charAt(0) + invite.role.slice(1).toLowerCase()}</Badge>
      </td>
      <td className="td text-slate-500">{invite.expires}</td>
      <td className="td text-right">
        {canManage ? (
          <form action={formAction}>
            <RevokeButton />
          </form>
        ) : null}
      </td>
    </tr>
  );
}

function RevokeButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="btn-text text-xs font-medium text-slate-500 hover:text-red-700 dark:hover:text-red-300 disabled:opacity-50"
    >
      {pending ? "Revoking…" : "Revoke"}
    </button>
  );
}
