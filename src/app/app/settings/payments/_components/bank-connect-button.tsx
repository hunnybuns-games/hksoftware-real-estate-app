"use client";

import { useEffect, useState } from "react";
import { usePlaidLink } from "react-plaid-link";
import { createBankLinkTokenAction, exchangeBankPublicTokenAction } from "@/actions/bank-connection";

/**
 * Plaid Link is a client-side widget, not a redirect the way Stripe Connect's
 * onboarding works (see startStripeOnboardingAction in actions/org.ts) — it
 * has to open a modal inside this page, let the owner log into their bank
 * through it, and hand a public_token back to onSuccess. So this button
 * drives a small state machine instead of being a plain <form action>:
 * fetch a link_token from the server -> open Link once it's ready -> on
 * success, exchange the public_token for a stored connection.
 */
export function BankConnectButton({ label = "Connect bank" }: { label?: string }) {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "starting" | "exchanging" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: (publicToken) => {
      // Plaid's own type allows null here for a discontinued legacy flow;
      // in the token-based flow this hook uses, onSuccess is never called
      // without a real token. Guard anyway rather than pass null onward.
      if (!publicToken) return;

      setStatus("exchanging");
      exchangeBankPublicTokenAction(publicToken)
        .then((result) => {
          if (!result?.ok) {
            setStatus("error");
            setError(result?.error ?? "Something went wrong finishing the connection.");
            return;
          }
          // The server action already revalidated this page's data; a full
          // reload is the simplest way to reflect the new connection state
          // here without threading it through more client state.
          window.location.reload();
        })
        .catch(() => {
          setStatus("error");
          setError("Something went wrong finishing the connection. Please try again.");
        });
    },
  });

  // usePlaidLink only reports ready once it has a token and has finished
  // loading Plaid's script — open it the moment that happens instead of
  // requiring the owner to click twice.
  useEffect(() => {
    if (ready && status === "starting") {
      setStatus("idle");
      open();
    }
  }, [ready, status, open]);

  async function startConnect() {
    setStatus("starting");
    setError(null);
    const result = await createBankLinkTokenAction();
    if (!result.ok) {
      setStatus("error");
      setError(result.error);
      return;
    }
    setLinkToken(result.linkToken);
  }

  const busy = status === "starting" || status === "exchanging";

  return (
    <div className="space-y-2">
      <button type="button" onClick={startConnect} disabled={busy} className="btn-primary">
        {status === "exchanging" ? "Connecting…" : busy ? "Opening…" : label}
      </button>
      {error ? <p className="field-error">{error}</p> : null}
    </div>
  );
}
