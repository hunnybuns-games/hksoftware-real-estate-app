import { db } from "@/lib/db";
import { canViewListingPhoto } from "@/actions/listings";

/**
 * Serves a listing photo out of the database — same pattern as
 * /api/photos/[photoId] for maintenance photos. Authorization runs on every
 * request (canViewListingPhoto): an unguessable id is not access control on
 * its own, and staff removed from an org must not keep reading its photos.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ photoId: string }> },
): Promise<Response> {
  const { photoId } = await params;

  if (!(await canViewListingPhoto(photoId))) {
    // 404 rather than 403: don't confirm the photo exists to someone who isn't
    // allowed to see it.
    return new Response("Not found", { status: 404 });
  }

  const photo = await db.listingPhoto.findUnique({
    where: { id: photoId },
    select: { data: true, contentType: true, filename: true },
  });
  if (!photo) return new Response("Not found", { status: 404 });

  return new Response(new Uint8Array(photo.data), {
    headers: {
      "Content-Type": photo.contentType,
      "Content-Length": String(photo.data.byteLength),
      "Content-Disposition": `inline; filename="${encodeURIComponent(photo.filename)}"`,
      // Private: the response is authorized per-user, so no shared cache may
      // hold it. Immutable because photos are never edited in place.
      "Cache-Control": "private, max-age=3600, immutable",
    },
  });
}
