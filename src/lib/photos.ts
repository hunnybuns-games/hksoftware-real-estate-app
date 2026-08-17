import { type ActionState, actionError } from "@/lib/forms";
import { ALLOWED_PHOTO_TYPES, MAX_PHOTO_BYTES } from "@/lib/constants";
import { detectImageType } from "@/lib/image-signature";

/**
 * Reads and validates uploaded photos into rows ready for a nested Prisma
 * create. Photos go into the database as bytes, the same call maintenance
 * requests made first — see the note on MaintenancePhoto in schema.prisma for
 * why, and when to move to object storage. Shared by maintenance requests and
 * listings rather than each keeping its own copy of this validation.
 */
export type PhotoRow = {
  filename: string;
  contentType: string;
  sizeBytes: number;
  data: Uint8Array<ArrayBuffer>;
};

export async function readPhotos(
  formData: FormData,
  opts: { field?: string; maxCount: number },
): Promise<{ ok: true; data: PhotoRow[] } | { ok: false; state: ActionState }> {
  const field = opts.field ?? "photos";

  const files = formData
    .getAll(field)
    .filter((f): f is File => f instanceof File && f.size > 0);

  if (files.length > opts.maxCount) {
    return {
      ok: false,
      state: actionError("Please fix the highlighted fields.", {
        [field]: `You can attach up to ${opts.maxCount} photos.`,
      }),
    };
  }

  const rows: PhotoRow[] = [];

  for (const file of files) {
    if (!ALLOWED_PHOTO_TYPES.includes(file.type as (typeof ALLOWED_PHOTO_TYPES)[number])) {
      return {
        ok: false,
        state: actionError("Please fix the highlighted fields.", {
          [field]: "Photos need to be JPEG, PNG, WebP or HEIC.",
        }),
      };
    }
    // Size before reading the body, so an oversized upload is rejected without
    // being pulled into memory first.
    if (file.size > MAX_PHOTO_BYTES) {
      return {
        ok: false,
        state: actionError("Please fix the highlighted fields.", {
          [field]: `“${file.name}” is larger than ${Math.round(MAX_PHOTO_BYTES / 1024 / 1024)} MB.`,
        }),
      };
    }

    // Uint8Array (not Buffer) — Prisma's Bytes input requires an
    // ArrayBuffer-backed view, and Buffer.from widens to ArrayBufferLike.
    const data = new Uint8Array(await file.arrayBuffer());

    // The declared file.type checked above is attacker-controlled; this is what
    // the bytes actually are. Store and later serve the detected type, never
    // the claimed one — see src/lib/image-signature.ts.
    const detected = detectImageType(data);
    if (!detected) {
      return {
        ok: false,
        state: actionError("Please fix the highlighted fields.", {
          [field]: `“${file.name}” doesn't look like a JPEG, PNG, WebP or HEIC image.`,
        }),
      };
    }

    rows.push({
      filename: file.name.slice(0, 200) || "photo",
      contentType: detected,
      sizeBytes: file.size,
      data,
    });
  }

  return { ok: true, data: rows };
}
