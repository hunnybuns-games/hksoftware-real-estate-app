"use client";

import { useActionState } from "react";
import { runRentAction } from "@/actions/payments";
import { SubmitButton } from "@/components/form";

/**
 * Posts this month's rent charges on demand. The cron job does the same thing
 * nightly; this is here so a landlord who just added a lease sees it on the
 * books immediately instead of wondering whether it worked.
 */
export function RunRentButton() {
  const [state, action] = useActionState(runRentAction, null);

  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      {state?.ok && state.message ? (
        <span className="text-xs text-slate-500">{state.message}</span>
      ) : null}
      {state && !state.ok ? <span className="text-xs text-red-600">{state.error}</span> : null}
      <SubmitButton variant="secondary" pendingLabel="Posting rent…">
        Post rent charges
      </SubmitButton>
    </form>
  );
}
