"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/lib/forms";
import { Badge } from "@/components/ui";

const roleTone = {
  ADMIN: "blue",
  STAFF: "neutral",
  OWNER: "slate",
  TENANT: "slate",
} as const;

export function MemberRow({
  member,
  isSelf,
  canManage,
  updateRoleAction,
  removeAction,
}: {
  member: {
    id: string;
    name: string;
    email: string;
    role: "ADMIN" | "STAFF" | "OWNER" | "TENANT";
    lastLoginAt: string | null;
  };
  isSelf: boolean;
  canManage: boolean;
  updateRoleAction: (state: ActionState, formData: FormData) => Promise<ActionState>;
  removeAction: (state: ActionState) => Promise<ActionState>;
}) {
  const [roleState, roleFormAction] = useActionState(updateRoleAction, null);
  const [removeState, removeFormAction] = useActionState(removeAction, null);
  const error = (roleState && !roleState.ok && roleState.error) ||
    (removeState && !removeState.ok && removeState.error) ||
    null;

  return (
    <tr>
      <td className="td">
        <span className="font-medium text-slate-900">{member.name}</span>
        {isSelf ? <span className="ml-1.5 text-xs text-slate-400">(you)</span> : null}
        <span className="block text-xs text-slate-500">{member.email}</span>
        {error ? <span className="mt-1 block text-xs font-medium text-red-600">{error}</span> : null}
      </td>
      <td className="td">
        {canManage && !isSelf ? (
          /* Submits on change — a separate "save" button for one dropdown is
             more friction than it's worth. */
          <form action={roleFormAction}>
            <select
              name="role"
              defaultValue={member.role}
              onChange={(e) => e.currentTarget.form?.requestSubmit()}
              className="input py-1.5 text-xs"
            >
              <option value="STAFF">Staff</option>
              <option value="ADMIN">Admin</option>
              <option value="OWNER">Owner</option>
            </select>
          </form>
        ) : (
          <Badge tone={roleTone[member.role]}>{titleCase(member.role)}</Badge>
        )}
      </td>
      <td className="td text-slate-500">{member.lastLoginAt ?? "Never signed in"}</td>
      {canManage ? (
        <td className="td text-right">
          {isSelf ? null : (
            <form action={removeFormAction}>
              <RemoveButton />
            </form>
          )}
        </td>
      ) : null}
    </tr>
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

function titleCase(s: string): string {
  return s.charAt(0) + s.slice(1).toLowerCase();
}
