"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/lib/forms";
import Link from "@/components/link";

export function VendorRow({
  vendor,
  toggleActiveAction,
}: {
  vendor: { id: string; name: string; trade: string | null; contactName: string | null; email: string | null; phone: string | null; active: boolean };
  toggleActiveAction: (state: ActionState) => Promise<ActionState>;
}) {
  const [state, formAction] = useActionState(toggleActiveAction, null);

  return (
    <tr className={vendor.active ? undefined : "opacity-60"}>
      <td className="td">
        <Link href={`/app/maintenance/vendors/${vendor.id}/edit`} className="font-medium text-slate-900 hover:underline">
          {vendor.name}
        </Link>
        {vendor.contactName ? (
          <span className="block text-xs text-slate-500">{vendor.contactName}</span>
        ) : null}
        {state && !state.ok ? (
          <span className="mt-1 block text-xs font-medium text-red-600 dark:text-red-400">{state.error}</span>
        ) : null}
      </td>
      <td className="td text-slate-500">{vendor.trade || "—"}</td>
      <td className="td text-slate-500">
        {vendor.phone ? <span className="block">{vendor.phone}</span> : null}
        {vendor.email ? (
          <a href={`mailto:${vendor.email}`} className="link block text-xs">
            {vendor.email}
          </a>
        ) : null}
        {!vendor.phone && !vendor.email ? "—" : null}
      </td>
      <td className="td text-right">
        <form action={formAction}>
          <ToggleButton active={vendor.active} />
        </form>
      </td>
    </tr>
  );
}

function ToggleButton({ active }: { active: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="btn-text text-xs font-medium text-slate-500 hover:text-red-700 dark:hover:text-red-300 disabled:opacity-50"
    >
      {pending ? "Saving…" : active ? "Archive" : "Reactivate"}
    </button>
  );
}
