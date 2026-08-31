import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getObject } from "@/lib/object-storage";
import { detectFile } from "@/lib/file-signature";

/**
 * Serves a document out of the vault. Authorization runs on every request,
 * the same rule /api/photos follows: the storage key is random and the id is
 * a cuid, but an unguessable URL is not an access control.
 *
 * Deliberately staff-and-owner only — tenants get nothing here, even for a
 * document filed against their own lease. The vault is a back-office pile: a
 * single tenant folder can hold their screening report, an eviction notice
 * drafted but never served, or a scan that happens to show a co-applicant's
 * ID. Exposing it by default and carving out exceptions would be the wrong
 * way round. A tenant-visible subset (their signed lease, their receipts) is
 * worth building deliberately, as its own feature with its own opt-in, rather
 * than falling out of this route by accident.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ documentId: string }> },
): Promise<Response> {
  const { documentId } = await params;

  // 404 rather than 403 throughout: never confirm a document exists to
  // someone who is not allowed to see it.
  const notFound = () => new Response("Not found", { status: 404 });

  const session = await auth();
  const user = session?.user;
  if (!user?.id) return notFound();
  if (user.role === "TENANT") return notFound();

  const document = await db.document.findUnique({
    where: { id: documentId },
    select: {
      organizationId: true,
      propertyId: true,
      storageKey: true,
      filename: true,
      contentType: true,
    },
  });
  if (!document) return notFound();
  if (user.organizationId !== document.organizationId) return notFound();

  if (user.role === "OWNER") {
    // An owner sees only their own properties. A document with no property
    // (an unfiled drop, or an org-level tax form) is not theirs to read.
    if (!document.propertyId) return notFound();
    const link = await db.propertyOwner.findFirst({
      where: { userId: user.id, propertyId: document.propertyId },
      select: { id: true },
    });
    if (!link) return notFound();
  }

  const bytes = await getObject(document.storageKey);
  // A row whose bytes are gone is a broken document, not a missing one, but
  // there is nothing useful to hand the browser either way.
  if (!bytes) return notFound();

  // The stored contentType was derived from the bytes at upload time, but it
  // is re-derived here rather than trusted: a row edited by any future code
  // path must not be able to turn a stored blob into an inline-rendered
  // text/html response. Same defense-in-depth reasoning as the detector
  // itself — see src/lib/file-signature.ts.
  const detected = detectFile(bytes, document.filename);
  const disposition = detected.inlineSafe ? "inline" : "attachment";

  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": detected.contentType,
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(document.filename)}`,
      // Private: authorized per-user, so no shared cache may hold it.
      // Immutable because a document is replaced, never edited in place.
      "Cache-Control": "private, max-age=3600, immutable",
    },
  });
}
