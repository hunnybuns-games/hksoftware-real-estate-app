"use client";

import { ActionForm, Field, SubmitButton, TextInput } from "@/components/form";
import type { ActionState } from "@/lib/forms";
import { SignaturePad } from "@/components/signature-pad";

/**
 * Staff sign as the landlord's representative and send the document to the
 * tenant in one step — see sendLeaseDocumentAction. There's no separate
 * "review" screen between building the document and this: the document
 * itself is still shown above this form (see the detail page), and staff can
 * go back and edit it as long as it's still a draft.
 */
export function CountersignForm({
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
            <Field label="Your name" name="typedSignature" state={state} required>
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
              I&apos;m authorized to sign this lease on behalf of the landlord, and this is my
              legal signature.
            </label>
            {consentError ? <p className="field-error">{consentError}</p> : null}

            <SubmitButton pendingLabel="Sending…">Sign &amp; send to tenant</SubmitButton>
          </>
        );
      }}
    </ActionForm>
  );
}
