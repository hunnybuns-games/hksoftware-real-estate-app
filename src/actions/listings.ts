"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertStaff } from "@/lib/rbac";
import {
  type ActionState,
  actionError,
  actionOk,
  centsField,
  optionalDateField,
  optionalText,
  parseForm,
  runAction,
} from "@/lib/forms";
import { readPhotos } from "@/lib/photos";
import { deleteObject } from "@/lib/object-storage";
import { MAX_LISTING_PHOTOS } from "@/lib/constants";
import { SYNDICATION_PLATFORMS } from "@/lib/listing";
import { auth } from "@/lib/auth";

const listingSchema = z.object({
  unitId: z.string().min(1, "Pick a unit."),
  title: z.string().trim().min(1, "Give the listing a title.").max(200),
  description: z.string().trim().min(1, "Add a description.").max(4000),
  amenities: optionalText(1000),
  askingRentCents: centsField("Asking rent"),
  availableDate: optionalDateField,
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]),
});

export async function createListingAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let newId: string | null = null;

  const state = await runAction(async () => {
    const ctx = await assertStaff();
    const parsed = parseForm(listingSchema, formData);
    if (!parsed.ok) return parsed.state;

    const unit = await db.unit.findFirst({
      where: { id: parsed.data.unitId, property: { organizationId: ctx.organizationId } },
      select: { id: true },
    });
    if (!unit) return actionError("Please fix the highlighted fields.", { unitId: "Pick a unit." });

    const photos = await readPhotos(formData, {
      organizationId: ctx.organizationId,
      maxCount: MAX_LISTING_PHOTOS,
    });
    if (!photos.ok) return photos.state;

    const listing = await db.listing.create({
      data: {
        ...parsed.data,
        organizationId: ctx.organizationId,
        createdById: ctx.id,
        photos: photos.data.length ? { create: photos.data } : undefined,
        // One row per platform from the start, so the tracker always shows
        // all four — see the schema comment on ListingSyndication.
        syndications: { create: SYNDICATION_PLATFORMS.map((platform) => ({ platform })) },
      },
      select: { id: true },
    });

    newId = listing.id;
    revalidatePath("/app/listings");
    revalidatePath("/app/properties");
    return actionOk();
  });

  if (newId) redirect(`/app/listings/${newId}`);
  return state;
}

const updateSchema = listingSchema.omit({ unitId: true });

export async function updateListingAction(
  listingId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await assertStaff();
    const parsed = parseForm(updateSchema, formData);
    if (!parsed.ok) return parsed.state;

    const existing = await db.listing.findFirst({
      where: { id: listingId, organizationId: ctx.organizationId },
      select: { id: true },
    });
    if (!existing) return actionError("That listing no longer exists.");

    await db.listing.update({ where: { id: existing.id }, data: parsed.data });

    revalidatePath("/app/listings");
    revalidatePath(`/app/listings/${listingId}`);
    return actionOk("Listing saved.");
  });
}

/** One click for the common case: the unit got leased, pull the ad down. */
export async function archiveListingAction(listingId: string, _prev: ActionState): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await assertStaff();

    const existing = await db.listing.findFirst({
      where: { id: listingId, organizationId: ctx.organizationId },
      select: { id: true },
    });
    if (!existing) return actionError("That listing no longer exists.");

    await db.listing.update({ where: { id: existing.id }, data: { status: "ARCHIVED" } });

    revalidatePath("/app/listings");
    revalidatePath(`/app/listings/${listingId}`);
    return actionOk("Listing archived.");
  });
}

export async function addListingPhotosAction(
  listingId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await assertStaff();

    const existing = await db.listing.findFirst({
      where: { id: listingId, organizationId: ctx.organizationId },
      select: { id: true, _count: { select: { photos: true } } },
    });
    if (!existing) return actionError("That listing no longer exists.");

    const remaining = MAX_LISTING_PHOTOS - existing._count.photos;
    if (remaining <= 0) {
      return actionError("Please fix the highlighted fields.", {
        photos: `This listing already has the maximum of ${MAX_LISTING_PHOTOS} photos.`,
      });
    }

    const photos = await readPhotos(formData, {
      organizationId: ctx.organizationId,
      maxCount: remaining,
    });
    if (!photos.ok) return photos.state;
    if (photos.data.length === 0) {
      return actionError("Please fix the highlighted fields.", { photos: "Pick at least one photo." });
    }

    await db.listingPhoto.createMany({
      data: photos.data.map((p) => ({ ...p, listingId: existing.id })),
    });

    revalidatePath(`/app/listings/${listingId}`);
    return actionOk("Photos added.");
  });
}

export async function deleteListingPhotoAction(photoId: string, _prev: ActionState): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await assertStaff();

    const photo = await db.listingPhoto.findFirst({
      where: { id: photoId, listing: { organizationId: ctx.organizationId } },
      select: { id: true, listingId: true, storageKey: true },
    });
    if (!photo) return actionError("That photo no longer exists.");

    // Stored bytes first, then the row — and the row goes regardless, since
    // deleteObject swallows its own failures. Orphaned bytes are wasted space;
    // an orphaned row is a photo staff can see and cannot remove. Same
    // trade-off, for the same reason, as deleteDocumentAction.
    if (photo.storageKey) await deleteObject(photo.storageKey);
    await db.listingPhoto.delete({ where: { id: photo.id } });

    revalidatePath(`/app/listings/${photo.listingId}`);
    return actionOk("Photo removed.");
  });
}

const syndicationSchema = z.object({
  status: z.enum(["NOT_POSTED", "POSTED", "NEEDS_REFRESH"]),
  listingUrl: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => (v ? v : undefined))
    .refine((v) => v === undefined || /^https?:\/\//i.test(v), {
      message: "Paste a full link, starting with https://",
    }),
});

/**
 * Staff's manual record of where a listing has actually been posted — see
 * the schema comment on ListingSyndication. `postedAt` is set the first time
 * status moves to POSTED and left alone after that (including through
 * NEEDS_REFRESH), so it always answers "when did this first go up", not
 * "when was this status last touched".
 */
export async function updateListingSyndicationAction(
  syndicationId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await assertStaff();
    const parsed = parseForm(syndicationSchema, formData);
    if (!parsed.ok) return parsed.state;

    const existing = await db.listingSyndication.findFirst({
      where: { id: syndicationId, listing: { organizationId: ctx.organizationId } },
      select: { id: true, listingId: true, postedAt: true },
    });
    if (!existing) return actionError("That listing no longer exists.");

    await db.listingSyndication.update({
      where: { id: existing.id },
      data: {
        status: parsed.data.status,
        listingUrl: parsed.data.listingUrl ?? null,
        postedAt:
          parsed.data.status === "NOT_POSTED" ? null : (existing.postedAt ?? new Date()),
      },
    });

    revalidatePath(`/app/listings/${existing.listingId}`);
    return actionOk("Updated.");
  });
}

/**
 * Authorization for listing-photo downloads, used by the image route. Same
 * shape as canViewPhoto in src/actions/maintenance.ts — staff/admin in the
 * listing's org, or an owner assigned to that property. Listings have no
 * tenant-facing view (nothing here is shown outside the app), so there's no
 * TENANT branch.
 */
export async function canViewListingPhoto(photoId: string): Promise<boolean> {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) return false;
  if (user.role === "TENANT") return false;

  const photo = await db.listingPhoto.findUnique({
    where: { id: photoId },
    select: { listing: { select: { organizationId: true, unit: { select: { propertyId: true } } } } },
  });
  if (!photo) return false;
  if (user.organizationId !== photo.listing.organizationId) return false;

  if (user.role === "OWNER") {
    const link = await db.propertyOwner.findFirst({
      where: { userId: user.id, propertyId: photo.listing.unit.propertyId },
      select: { id: true },
    });
    return Boolean(link);
  }

  return user.role === "ADMIN" || user.role === "STAFF";
}
