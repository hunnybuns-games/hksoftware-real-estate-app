"use client";

import { useEffect, useRef, useState } from "react";
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
  const [phase, setPhase] = useState<"idle" | "opening" | "exchanging">("idle");
  const [error, setError] = useState<string | null>(null);

  /**
   * Link should open exactly once per token we fetch. A ref rather than state
   * because nothing renders from it — and because checking it inside the effect
   * below is what lets that effect avoid calling setState purely to stop itself
   * re-firing, which is the cascading-render pattern React warns about.
   */
  const openedRef = useRef(false);

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: (publicToken) => {
      // Plaid's own type allows null here for a discontinued legacy flow;
      // in the token-based flow this hook uses, onSuccess is never called
      // without a real token. Guard anyway rather than pass null onward.
      if (!publicToken) return;

      setPhase("exchanging");
      exchangeBankPublicTokenAction(publicToken)
        .then((result) => {
          if (!result?.ok) {
            setPhase("idle");
            setError(result?.error ?? "Something went wrong finishing the connection.");
            return;
          }
          // The server action already revalidated this page's data; a full
          // reload is the simplest way to reflect the new connection state
          // here without threading it through more client state.
          window.location.reload();
        })
        .catch(() => {
          setPhase("idle");
          setError("Something went wrong finishing the connection. Please try again.");
        });
    },

    /**
     * Backing out of Link without connecting is an ordinary thing to do, not an
     * error — reset so the button is usable again and a second attempt fetches
     * a fresh token. The functional update guards the case where onExit arrives
     * after a successful link (Plaid shouldn't fire both, but if it does, a
     * half-finished exchange must not be reset out from under itself).
     */
    onExit: () => {
      setPhase((current) => (current === "exchanging" ? current : "idle"));
      openedRef.current = false;
      setLinkToken(null);
    },
  });

  // Open Link the moment it reports ready, so connecting is one click rather
  // than two. The ref guard above — not a setState — is what keeps this from
  // firing repeatedly as `ready` and `open` change identity across renders.
  useEffect(() => {
    if (phase !== "opening" || !ready || openedRef.current) return;
    openedRef.current = true;
    open();
  }, [phase, ready, open]);

  async function startConnect() {
    setPhase("opening");
    setError(null);
    openedRef.current = false;

    const result = await createBankLinkTokenAction();
    if (!result.ok) {
      setPhase("idle");
      setError(result.error);
      return;
    }
    setLinkToken(result.linkToken);
  }

  const busy = phase !== "idle";

  return (
    <div className="space-y-2">
      <button type="button" onClick={startConnect} disabled={busy} className="btn-primary">
        {phase === "exchanging" ? "Connecting…" : phase === "opening" ? "Opening…" : label}
      </button>
      {error ? <p className="field-error">{error}</p> : null}
    </div>
  );
}
