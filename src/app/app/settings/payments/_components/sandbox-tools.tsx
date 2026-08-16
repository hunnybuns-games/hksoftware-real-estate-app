"use client";

import { ActionForm, Field, MoneyInput, SubmitButton, TextInput } from "@/components/form";
import { ActionButton } from "@/components/action-button";
import { fireSyncWebhookAction, forceReauthAction, simulateDepositAction } from "@/actions/bank-connection";

/**
 * Rendered only when plaidSandboxMode() is true (see ../page.tsx) — never
 * shows up once a deployment points at production Plaid. Sandbox generates
 * no organic transaction activity and there's no other UI path to Plaid's
 * webhook or re-auth flows, so these call Plaid's own test-simulation
 * endpoints server-side; see the three actions in actions/bank-connection.ts.
 */
export function SandboxTools() {
  return (
    <div className="space-y-6">
      <div>
        <h4 className="text-sm font-medium text-slate-700 dark:text-slate-200">Simulate a deposit</h4>
        <p className="mt-1 text-sm text-slate-500">
          Sandbox test banks don&apos;t produce new activity on their own. This injects a fake
          transaction into the connected Item — put a tenant&apos;s name or unit label in the
          description to test lease matching.
        </p>
        <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">
          Only works for Items connected with Plaid&apos;s{" "}
          <code className="rounded bg-white/60 px-1 dark:bg-white/10">user_transactions_dynamic</code>{" "}
          test username (any non-blank password) at First Platypus Bank — it silently does
          nothing for <code className="rounded bg-white/60 px-1 dark:bg-white/10">user_good</code>.
          Use &quot;Connect a different bank&quot; above to reconnect with that username if this
          doesn&apos;t seem to be doing anything.
        </p>
        <ActionForm action={simulateDepositAction} successMessage className="mt-3">
          {(state) => (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Amount" name="amountCents" state={state} required>
                  <MoneyInput name="amountCents" state={state} defaultValue="1800.00" required />
                </Field>
                <Field label="Description" name="description" state={state} required>
                  <TextInput
                    name="description"
                    state={state}
                    placeholder="e.g. a tenant's name or unit label"
                    required
                  />
                </Field>
              </div>
              <SubmitButton pendingLabel="Injecting…">Simulate deposit</SubmitButton>
            </>
          )}
        </ActionForm>
      </div>

      <div>
        <h4 className="text-sm font-medium text-slate-700 dark:text-slate-200">Fire the sync webhook</h4>
        <p className="mt-1 text-sm text-slate-500">
          Makes Plaid send a real, signed{" "}
          <code className="rounded bg-white/60 px-1 dark:bg-white/10">SYNC_UPDATES_AVAILABLE</code>{" "}
          webhook to our own{" "}
          <code className="rounded bg-white/60 px-1 dark:bg-white/10">/api/plaid/webhook</code> route —
          exercises signature verification and the sync job together, the same path a real bank
          update takes.
        </p>
        <ActionButton
          action={fireSyncWebhookAction}
          label="Fire sync webhook"
          pendingLabel="Firing…"
          className="mt-3 space-y-3"
        />
      </div>

      <div>
        <h4 className="text-sm font-medium text-slate-700 dark:text-slate-200">Force re-auth required</h4>
        <p className="mt-1 text-sm text-slate-500">
          Flips the connection into the same &quot;needs reconnecting&quot; state a bank forcing
          periodic re-auth would. Reload after this to see the banner, then use Reconnect bank to
          test recovering from it.
        </p>
        <ActionButton
          action={forceReauthAction}
          label="Force re-auth required"
          pendingLabel="Resetting…"
          variant="danger"
          className="mt-3 space-y-3"
        />
      </div>
    </div>
  );
}
