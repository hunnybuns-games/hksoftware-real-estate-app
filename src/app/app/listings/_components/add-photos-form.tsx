"use client";

import { ActionForm, SubmitButton } from "@/components/form";
import type { ActionState } from "@/lib/forms";
import { PhotoInput } from "@/components/photo-input";

export function AddPhotosForm({
  action,
  maxCount,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  maxCount: number;
}) {
  return (
    <ActionForm action={action}>
      {(state) => (
        <>
          <PhotoInput state={state} maxCount={maxCount} hint={`Up to ${maxCount} more.`} />
          <SubmitButton pendingLabel="Uploading…">Upload</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
