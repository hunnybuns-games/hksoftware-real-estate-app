"use client";

import { useState } from "react";
import { Field } from "@/components/form";
import type { ActionState } from "@/lib/forms";
import {
  ALLOWED_PHOTO_TYPES,
  MAX_PHOTOS_PER_REQUEST,
  MAX_PHOTO_BYTES,
} from "@/lib/constants";

/**
 * Photo picker with a client-side count/size check. The server re-validates
 * everything (see readPhotos) — this exists purely so a tenant on a phone
 * doesn't upload 40 MB before finding out it was rejected.
 */
export function PhotoInput({ state }: { state?: ActionState }) {
  const [names, setNames] = useState<string[]>([]);
  const [localError, setLocalError] = useState<string | null>(null);

  const maxMb = Math.round(MAX_PHOTO_BYTES / 1024 / 1024);

  return (
    <div>
      <Field
        label="Photos"
        name="photos"
        state={state}
        hint={`Optional. Up to ${MAX_PHOTOS_PER_REQUEST}, ${maxMb} MB each. A photo usually saves a phone call.`}
      >
        <input
          id="photos"
          name="photos"
          type="file"
          multiple
          accept={ALLOWED_PHOTO_TYPES.join(",")}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length > MAX_PHOTOS_PER_REQUEST) {
              setLocalError(`Please pick at most ${MAX_PHOTOS_PER_REQUEST} photos.`);
            } else {
              const tooBig = files.find((f) => f.size > MAX_PHOTO_BYTES);
              setLocalError(tooBig ? `“${tooBig.name}” is over ${maxMb} MB.` : null);
            }
            setNames(files.map((f) => f.name));
          }}
          className="block w-full cursor-pointer rounded-lg border border-slate-300 bg-white text-sm text-slate-600
            file:mr-3 file:cursor-pointer file:rounded-l-lg file:border-0 file:bg-slate-50
            file:px-3.5 file:py-2 file:text-sm file:font-medium file:text-slate-700
            hover:file:bg-slate-100"
        />
      </Field>
      {localError ? <p className="field-error">{localError}</p> : null}
      {names.length > 0 && !localError ? (
        <p className="hint">{names.join(", ")}</p>
      ) : null}
    </div>
  );
}
