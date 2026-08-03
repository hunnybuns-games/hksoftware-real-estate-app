import { db } from "@/lib/db";
import { canViewPhoto } from "@/actions/maintenance";

/**
 * Serves a maintenance photo out of Postgres. Authorization runs on every
 * request (canViewPhoto) — the id is a cuid, but an unguessable URL is not an
 * access control, and a former tenant must not keep reading photos.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ photoId: string }> },
): Promise<Response> {
  const { photoId } = await params;

  if (!(await canViewPhoto(photoId))) {
    // 404 rather than 403: don't confirm the photo exists to someone who isn't
    // allowed to see it.
    return new Response("Not found", { status: 404 });
  }

  const photo = await db.maintenancePhoto.findUnique({
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
