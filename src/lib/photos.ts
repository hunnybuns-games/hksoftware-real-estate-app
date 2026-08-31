import { type ActionState, actionError } from "@/lib/forms";
import { ALLOWED_PHOTO_TYPES, MAX_PHOTO_BYTES } from "@/lib/constants";
import { detectImageType } from "@/lib/image-signature";
import { getObject, putObject } from "@/lib/object-storage";

/**
 * Reads and validates uploaded photos, stores the bytes, and returns rows
 * ready for a nested Prisma create. Shared by maintenance requests and
 * listings rather than each keeping its own copy of this validation.
 *
 * Bytes go to R2 (src/lib/object-storage.ts), not a Bytes column — see the
 * comment on MaintenancePhoto in schema.prisma. The returned row carries a
 * storageKey and no `data`, which is what makes the nested-create call sites
 * identical to what they were before the move.
 */
export type PhotoRow = {
  filename: string;
  contentType: string;
  sizeBytes: number;
  storageKey: string;
};

/**
 * The bytes for a stored photo row, from wherever that row keeps them.
 *
 * Both serving routes go through this so the storageKey-then-data precedence
 * lives in one place rather than being restated (and eventually diverging) in
 * two. storageKey wins: a backfilled row has both set for the window between
 * the object being written and the column being cleared, and R2 is the copy
 * that will still be there once `data` is dropped.
 *
 * Null means the row is dangling — a key pointing at an object that isn't
 * there. The caller's 404 is the right answer for that; there's nothing to
 * serve either way, and it should never happen outside a partly-failed
 * backfill.
 */
export async function photoBytes(photo: {
  storageKey: string | null;
  data: Uint8Array | null;
}): Promise<Uint8Array | null> {
  if (photo.storageKey) return getObject(photo.storageKey);
  return photo.data ?? null;
}

/** Validated, not yet stored. */
type PendingPhoto = {
  filename: string;
  contentType: string;
  sizeBytes: number;
  data: Uint8Array<ArrayBuffer>;
};

export async function readPhotos(
  formData: FormData,
  opts: { organizationId: string; field?: string; maxCount: number },
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

  /*
   * Two passes, deliberately. Every file is validated before any of them is
   * stored, so rejecting the fifth photo can't leave the first four as
   * unreferenced objects in the bucket — nothing would ever clean those up,
   * since the rows that would have pointed at them never get created.
   */
  const pending: PendingPhoto[] = [];

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

    pending.push({
      filename: file.name.slice(0, 200) || "photo",
      contentType: detected,
      sizeBytes: file.size,
      data,
    });
  }

  const rows: PhotoRow[] = [];
  for (const photo of pending) {
    const stored = await putObject({
      organizationId: opts.organizationId,
      bytes: photo.data,
      contentType: photo.contentType,
    });
    rows.push({
      filename: photo.filename,
      contentType: photo.contentType,
      sizeBytes: photo.sizeBytes,
      storageKey: stored.key,
    });
  }

  return { ok: true, data: rows };
}
