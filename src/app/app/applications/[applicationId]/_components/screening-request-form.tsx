"use client";

import { ActionForm, SubmitButton } from "@/components/form";
import type { ActionState } from "@/lib/forms";

const TYPES: { name: "wantCredit" | "wantBackground" | "wantEviction"; label: string }[] = [
  { name: "wantCredit", label: "Credit report" },
  { name: "wantBackground", label: "Criminal background check" },
  { name: "wantEviction", label: "Eviction history" },
];

export function ScreeningRequestForm({
  action,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
}) {
  return (
    <ActionForm action={action}>
      {(state) => (
        <>
          <p className="text-sm text-slate-500">
            This emails the applicant a consent disclosure — nothing is pulled until they respond.
            The disclosure text is a template; if it hasn&apos;t been reviewed for your state yet,
            see docs/tenant-screening.md before sending this to a real applicant.
          </p>
          <fieldset className="space-y-2">
            <legend className="label">Report types</legend>
            {TYPES.map((t) => (
              <label key={t.name} className="flex items-center gap-2.5 text-sm text-slate-700">
                <input
                  type="checkbox"
                  name={t.name}
                  defaultChecked
                  className="size-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500/30"
                />
                {t.label}
              </label>
            ))}
          </fieldset>
          {state && !state.ok && state.fieldErrors?.wantCredit ? (
            <p className="field-error">{state.fieldErrors.wantCredit}</p>
          ) : null}
          <SubmitButton pendingLabel="Sending…" className="w-full">
            Request screening
          </SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
