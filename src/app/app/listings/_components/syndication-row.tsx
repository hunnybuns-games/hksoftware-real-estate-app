"use client";

import { ActionForm, Field, Select, SubmitButton, TextInput } from "@/components/form";
import type { ActionState } from "@/lib/forms";
import { CopyButton } from "@/components/copy-button";
import { SyndicationStatusBadge } from "@/components/ui";
import type { ListingSyndicationStatus } from "@prisma/client";

export function SyndicationRow({
  action,
  platform,
  platformLabel,
  manualPostUrl,
  copyText,
  status,
  listingUrl,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  platform: string;
  platformLabel: string;
  manualPostUrl: string;
  copyText: string;
  status: ListingSyndicationStatus;
  listingUrl: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 p-4" data-testid={`syndication-${platform}`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-slate-900">{platformLabel}</p>
          <SyndicationStatusBadge status={status} />
        </div>
        <div className="flex items-center gap-2">
          <CopyButton text={copyText} label={`Copy for ${platformLabel}`} />
          <a href={manualPostUrl} target="_blank" rel="noreferrer" className="btn-secondary">
            Open {platformLabel} ↗
          </a>
        </div>
      </div>

      <ActionForm action={action} className="grid gap-3 sm:grid-cols-[10rem_1fr_auto] sm:items-end">
        {(state) => (
          <>
            <Field label="Status" name="status" state={state}>
              <Select name="status" state={state} defaultValue={status}>
                <option value="NOT_POSTED">Not posted</option>
                <option value="POSTED">Posted</option>
                <option value="NEEDS_REFRESH">Needs refresh</option>
              </Select>
            </Field>
            <Field label="Live listing URL" name="listingUrl" state={state} hint="Paste it here once you've posted it.">
              <TextInput
                name="listingUrl"
                state={state}
                type="url"
                defaultValue={listingUrl}
                placeholder="https://…"
              />
            </Field>
            <SubmitButton pendingLabel="Saving…" className="h-fit">
              Save
            </SubmitButton>
          </>
        )}
      </ActionForm>
    </div>
  );
}
