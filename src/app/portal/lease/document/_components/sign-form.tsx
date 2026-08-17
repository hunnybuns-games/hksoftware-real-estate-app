"use client";

import { ActionForm, Field, SubmitButton, TextInput } from "@/components/form";
import type { ActionState } from "@/lib/forms";
import { SignaturePad } from "@/components/signature-pad";

export function SignForm({
  action,
  defaultName,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  defaultName: string;
}) {
  return (
    <ActionForm action={action}>
      {(state) => {
        const consentError = state && !state.ok ? state.fieldErrors?.consent : undefined;
        return (
          <>
            <Field label="Type your full legal name" name="typedSignature" state={state} required>
              <TextInput name="typedSignature" state={state} defaultValue={defaultName} required />
            </Field>

            <div>
              <label className="label mb-1.5 block">Your signature</label>
              <SignaturePad name="signatureImage" />
            </div>

            <label className="flex items-start gap-2.5 text-sm text-slate-700">
              <input
                type="checkbox"
                name="consent"
                className="mt-0.5 size-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500/30"
              />
              I have read this lease and intend the name above as my legal signature.
            </label>
            {consentError ? <p className="field-error">{consentError}</p> : null}

            <SubmitButton pendingLabel="Signing…">Sign lease</SubmitButton>
          </>
        );
      }}
    </ActionForm>
  );
}
