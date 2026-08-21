"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import clsx from "clsx";
import { respondToScreeningConsentAction } from "@/actions/screening";
import { FormError } from "@/components/form";

function DecisionButton({
  value,
  variant,
  children,
}: {
  value: "consent" | "decline";
  variant: "primary" | "secondary";
  children: React.ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name="decision"
      value={value}
      disabled={pending}
      className={clsx(variant === "primary" ? "btn-primary" : "btn-secondary", "flex-1 justify-center")}
    >
      {children}
    </button>
  );
}

export function ConsentForm({ token }: { token: string }) {
  const [state, formAction] = useActionState(
    respondToScreeningConsentAction.bind(null, token),
    null,
  );

  if (state?.ok) {
    return (
      <div role="status" className="mt-2 text-center">
        <p className="text-sm font-medium text-slate-900">Thanks — your response has been recorded.</p>
        <p className="mt-1 text-sm text-slate-500">
          You can close this page. If your application is decided partly because of a report,
          you&apos;ll be notified separately with the reporting agency&apos;s contact information.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <FormError state={state} />
      <div className="flex gap-3">
        <DecisionButton value="decline" variant="secondary">
          I do not consent
        </DecisionButton>
        <DecisionButton value="consent" variant="primary">
          I consent
        </DecisionButton>
      </div>
    </form>
  );
}
