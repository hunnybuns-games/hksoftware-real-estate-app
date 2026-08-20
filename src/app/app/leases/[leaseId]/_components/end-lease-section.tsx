"use client";

import { useActionState } from "react";
import { endLeaseAction } from "@/actions/leases";
import { SubmitButton } from "@/components/form";
import { Card } from "@/components/ui";
import { Toast } from "@/components/toast";

/**
 * Always mounted, regardless of lease status — the "End this lease" card
 * only shows while the lease is still active, but the component itself has
 * to stay in the tree so its action state survives the page revalidating
 * lease.status out from under it. The old inline version was wrapped in
 * `lease.status === "ACTIVE" ? ... : null`, so the whole card — including
 * any success message it might have shown — vanished the instant the action
 * succeeded. This shows a brief toast instead, which outlives that.
 */
export function EndLeaseSection({ leaseId, active }: { leaseId: string; active: boolean }) {
  const [state, formAction] = useActionState(endLeaseAction.bind(null, leaseId), null);

  if (state?.ok) {
    return <Toast message={state.message ?? "Lease ended."} />;
  }

  if (!active) return null;

  return (
    <Card title="End this lease">
      <p className="mb-3 text-sm text-slate-500">
        Marks the lease ended and the unit vacant. Charges and payments stay on the record.
      </p>
      {state && !state.ok ? (
        <p
          role="alert"
          className="mb-3 rounded-lg border border-red-200 dark:border-red-400/25 bg-red-50 dark:bg-red-500/12 px-3.5 py-2.5 text-sm text-red-800 dark:text-red-200"
        >
          {state.error}
        </p>
      ) : null}
      <form action={formAction}>
        {/* danger, not secondary — this ends the tenancy, worth a beat before clicking */}
        <SubmitButton variant="danger" pendingLabel="Ending…">
          End lease
        </SubmitButton>
      </form>
    </Card>
  );
}
