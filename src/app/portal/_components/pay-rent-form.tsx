"use client";

import { useActionState, useState } from "react";
import type { ActionState } from "@/lib/forms";
import { FormError, FormSuccess, MoneyInput, SubmitButton } from "@/components/form";

/**
 * Pay rent. Defaults to the full balance in one tap — that's what nearly
 * everyone wants — with partial payments behind a disclosure rather than an
 * always-visible amount box that invites second-guessing.
 */
export function PayRentForm({
  action,
  demoAction,
  stripeReady,
  defaultAmount,
  owes,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  demoAction?: (state: ActionState, formData: FormData) => Promise<ActionState>;
  stripeReady: boolean;
  defaultAmount: string;
  owes: boolean;
}) {
  const [state, formAction] = useActionState(action, null);
  const [demoState, demoFormAction] = useActionState(
    demoAction ?? (async () => null),
    null,
  );
  const [custom, setCustom] = useState(false);

  const activeAction = stripeReady ? formAction : demoFormAction;
  const activeState = stripeReady ? state : demoState;

  return (
    <div className="space-y-3">
      <FormError state={activeState} />
      <FormSuccess state={activeState} />

      <form action={activeAction} className="space-y-3">
        {custom ? (
          <div>
            <label htmlFor="amountCents" className="label">
              Amount to pay
            </label>
            <MoneyInput
              name="amountCents"
              state={activeState}
              defaultValue={defaultAmount}
              required
            />
          </div>
        ) : (
          /* No amount field: the server pays the full outstanding balance,
             recomputed server-side so a stale page can't submit a stale
             number. */
          <input type="hidden" name="amountCents" value="" />
        )}

        <SubmitButton className="w-full py-2.5" pendingLabel="Taking you to checkout…">
          {custom ? "Continue" : owes ? `Pay ${formatted(defaultAmount)}` : "Make a payment"}
        </SubmitButton>
      </form>

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setCustom((v) => !v)}
          className="text-xs font-medium text-slate-500 hover:text-slate-900"
        >
          {custom ? "Pay the full balance instead" : "Pay a different amount"}
        </button>
        {stripeReady ? (
          <span className="text-xs text-slate-400">Secured by Stripe</span>
        ) : (
          <span className="text-xs text-amber-700 dark:text-amber-300">Demo mode — no money moves</span>
        )}
      </div>
    </div>
  );
}

function formatted(dollars: string): string {
  const n = Number(dollars);
  if (!Number.isFinite(n)) return `$${dollars}`;
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}
