"use client";

import type { DocumentCategory } from "@prisma/client";
import { ActionForm, Field, Select, SubmitButton, TextInput } from "@/components/form";
import { ActionButton } from "@/components/action-button";
import { deleteDocumentAction, refileDocumentAction } from "@/actions/documents";
import { DOCUMENT_CATEGORY_LABELS } from "@/lib/document-labels";

export type FilingOption = { value: string; label: string };

/**
 * Correcting one document: what it is, where it belongs, what to call it.
 *
 * The target is a single select over "<kind>:<id>" values rather than
 * separate property/unit/tenant/lease pickers. Choosing a lease implies its
 * unit, tenant and property, and the server re-expands it that way (see
 * refileDocumentAction) — offering four independent dropdowns would let
 * someone file a lease under a property it is not part of.
 */
export function RefileForm({
  documentId,
  current,
  options,
}: {
  documentId: string;
  current: { category: DocumentCategory; title: string | null; target: string };
  options: FilingOption[];
}) {
  const refile = refileDocumentAction.bind(null, documentId);
  const remove = deleteDocumentAction.bind(null, documentId);

  return (
    <div className="space-y-3">
      <ActionForm action={refile} successMessage>
        {(state) => (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Type" name="category" state={state}>
                <Select name="category" state={state} defaultValue={current.category}>
                  {Object.entries(DOCUMENT_CATEGORY_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Belongs to" name="target" state={state}>
                <Select name="target" state={state} defaultValue={current.target}>
                  {options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Label" name="title" state={state} hint="Optional.">
                <TextInput
                  name="title"
                  state={state}
                  defaultValue={current.title ?? ""}
                  placeholder="Defaults to the filename"
                />
              </Field>
            </div>

            <SubmitButton pendingLabel="Saving…">Save filing</SubmitButton>
          </>
        )}
      </ActionForm>

      {/*
        Deliberately a sibling of the form above, not a child of it.
        ActionButton renders its own <form>, and a nested <form> is invalid
        HTML — the parser drops the inner one, which both breaks this button
        and quietly re-points it at the filing form instead of the delete
        action.
      */}
      <ActionButton action={remove} label="Delete" pendingLabel="Deleting…" variant="danger" />
    </div>
  );
}
