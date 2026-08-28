"use client";

import { useEffect, useRef, useState } from "react";
import { ActionForm, FormError, SubmitButton } from "@/components/form";
import { uploadDocumentsAction } from "@/actions/documents";
import {
  MAX_DOCUMENTS_PER_UPLOAD,
  MAX_DOCUMENT_BATCH_BYTES,
  MAX_DOCUMENT_BYTES,
} from "@/lib/constants";

/**
 * The drop target itself. A real drag-and-drop surface rather than a bare
 * file input, because the job this feature exists for is "I have a folder of
 * paperwork" — dragging a selection in is the whole point, and a click-only
 * picker would make the common case the awkward one.
 *
 * `<input type="file">` cannot be assigned a plain array of files, so dropped
 * files are moved into the real input through a DataTransfer. That keeps this
 * an ordinary form post: no fetch, no manual multipart assembly, and the
 * Server Action receives exactly what a picked selection would have produced.
 *
 * Every limit checked here is re-checked server-side (see
 * uploadDocumentsAction). This copy exists so someone does not wait through a
 * 60 MB upload to be told it was too big, which is the same reason
 * PhotoInput duplicates its own limits.
 */
export function DocumentDropZone({
  /** Pins every file in this drop to one record, when embedded on that record's page. */
  pinnedTo,
}: {
  pinnedTo?: { kind: "property" | "lease" | "tenant"; id: string; label: string };
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [localError, setLocalError] = useState<string | null>(null);

  const maxMb = Math.round(MAX_DOCUMENT_BYTES / 1024 / 1024);
  const maxBatchMb = Math.round(MAX_DOCUMENT_BATCH_BYTES / 1024 / 1024);

  function accept(incoming: File[]) {
    setLocalError(null);

    if (incoming.length > MAX_DOCUMENTS_PER_UPLOAD) {
      setLocalError(
        `That is ${incoming.length} files — up to ${MAX_DOCUMENTS_PER_UPLOAD} at a time. Try a smaller batch.`,
      );
      return;
    }

    const oversized = incoming.find((f) => f.size > MAX_DOCUMENT_BYTES);
    if (oversized) {
      setLocalError(`"${oversized.name}" is larger than ${maxMb} MB.`);
      return;
    }

    const total = incoming.reduce((sum, f) => sum + f.size, 0);
    if (total > MAX_DOCUMENT_BATCH_BYTES) {
      setLocalError(`That batch is ${Math.round(total / 1024 / 1024)} MB — the limit is ${maxBatchMb} MB.`);
      return;
    }

    // The input is the thing that actually gets submitted, so it has to hold
    // the same list the preview below shows.
    const transfer = new DataTransfer();
    for (const file of incoming) transfer.items.add(file);
    if (inputRef.current) inputRef.current.files = transfer.files;

    setFiles(incoming);
  }

  function clear() {
    setFiles([]);
    setLocalError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <ActionForm action={uploadDocumentsAction} successMessage>
      {(state) => (
        <>
          <ClearOnSuccess state={state} onClear={clear} />
          {pinnedTo ? <input type="hidden" name={`${pinnedTo.kind}Id`} value={pinnedTo.id} /> : null}

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              accept(Array.from(e.dataTransfer.files));
            }}
            className={[
              "rounded-xl border-2 border-dashed p-8 text-center transition-colors",
              dragging
                ? "border-brand-500 bg-brand-50 dark:bg-brand-950/30"
                : "border-slate-300 bg-slate-50/50 dark:border-slate-700 dark:bg-slate-900/30",
            ].join(" ")}
          >
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
              Drop files here
            </p>
            <p className="mt-1 text-sm text-slate-500">
              Leases, W-9s, insurance certificates, inspection reports, receipts, photos — anything.
              We will try to work out what each one is and who it belongs to.
            </p>

            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="btn-secondary mt-4"
            >
              Choose files
            </button>

            <p className="mt-3 text-xs text-slate-400">
              Up to {MAX_DOCUMENTS_PER_UPLOAD} files, {maxMb} MB each, {maxBatchMb} MB per drop.
            </p>

            <input
              ref={inputRef}
              id="files"
              name="files"
              type="file"
              multiple
              className="sr-only"
              onChange={(e) => accept(Array.from(e.target.files ?? []))}
            />
          </div>

          {localError ? <p className="field-error">{localError}</p> : null}
          <FormError state={state} />

          {files.length > 0 ? (
            <div className="space-y-3">
              <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                {files.map((file) => (
                  <li
                    key={`${file.name}-${file.size}`}
                    className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                  >
                    <span className="truncate text-slate-700 dark:text-slate-200">{file.name}</span>
                    <span className="shrink-0 tabular-nums text-slate-400">
                      {formatSize(file.size)}
                    </span>
                  </li>
                ))}
              </ul>

              <div className="flex flex-wrap items-center gap-3">
                <SubmitButton pendingLabel="Uploading…">
                  {pinnedTo
                    ? `Add ${files.length === 1 ? "file" : `${files.length} files`} to ${pinnedTo.label}`
                    : `Upload ${files.length === 1 ? "1 file" : `${files.length} files`}`}
                </SubmitButton>
                <button type="button" onClick={clear} className="btn-text">
                  Clear
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </ActionForm>
  );
}

/**
 * Empties the staged selection once an upload succeeds.
 *
 * Without this the list of just-uploaded files stays on screen with a live
 * "Upload 5 files" button underneath it, which reads as though nothing
 * happened — and pressing it again really does upload the whole batch a
 * second time. The duplicate detector would flag them, but flagging is not
 * preventing, and the vault would still end up holding two of everything.
 *
 * Split into its own component purely so the effect can key off `state`,
 * which only exists inside ActionForm's render prop.
 */
function ClearOnSuccess({
  state,
  onClear,
}: {
  state: { ok: boolean } | null;
  onClear: () => void;
}) {
  const succeeded = state?.ok === true;
  useEffect(() => {
    if (succeeded) onClear();
    // onClear is stable enough for this: it only closes over setState setters
    // and a ref, none of which change identity in a way that matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [succeeded]);
  return null;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
