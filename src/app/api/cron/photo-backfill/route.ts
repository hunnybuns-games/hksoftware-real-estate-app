import { db } from "@/lib/db";
import { isCronAuthorized } from "@/lib/cron-auth";
import { putObject } from "@/lib/object-storage";
import { reportServerError } from "@/lib/error-reporting";

/**
 * Moves photo bytes out of D1 and into R2, a batch at a time.
 *
 * Why an endpoint rather than a script: the bytes are in D1 and the
 * destination is an R2 bucket, and the only place both of those exist as
 * bindings is inside a running Worker. A plain Node script (the pattern
 * scripts/d1-*.mjs uses) can reach production D1 through the Prisma D1
 * adapter, but it cannot reach R2 without provisioning S3-compatible
 * credentials — a new long-lived secret to create, store and eventually
 * rotate, for a job that runs a handful of times and is then finished.
 * Reusing the machinery that already exists costs nothing by comparison.
 *
 * Not on a schedule (see wrangler.jsonc's crons — this route is deliberately
 * absent from them). It's a migration, not an ongoing job: call it by hand
 * until `remaining` reaches zero, then leave it alone. It stays in the tree
 * afterwards because the same endpoint is what a restore-from-old-backup
 * would need.
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *     https://comfylease.com/api/cron/photo-backfill
 *
 * Idempotent and interruption-safe: it only ever selects rows that still have
 * `data` and no `storageKey`, and each row is committed on its own. A run that
 * dies halfway leaves the rows it finished done and the rest untouched.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Rows per run, per table. Each one reads up to 4 MB out of D1 and writes it
 * to R2, so this is bounded by wall-clock time rather than query count —
 * modest on purpose, since the cost of a too-small batch is another curl and
 * the cost of a too-large one is a timeout halfway through.
 */
const BATCH = 25;

type Outcome = { moved: number; failed: number; remaining: number };

export async function GET(req: Request): Promise<Response> {
  if (!isCronAuthorized(req, "photo-backfill")) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const maintenance = await backfillMaintenance();
  const listings = await backfillListings();

  return Response.json({
    ranAt: new Date().toISOString(),
    maintenance,
    listings,
    done: maintenance.remaining === 0 && listings.remaining === 0,
  });
}

async function backfillMaintenance(): Promise<Outcome> {
  const rows = await db.maintenancePhoto.findMany({
    where: { storageKey: null, data: { not: null } },
    take: BATCH,
    select: {
      id: true,
      data: true,
      contentType: true,
      request: { select: { organizationId: true } },
    },
  });

  let moved = 0;
  let failed = 0;

  for (const row of rows) {
    if (!row.data) continue;
    try {
      const stored = await putObject({
        organizationId: row.request.organizationId,
        bytes: new Uint8Array(row.data),
        contentType: row.contentType,
      });
      // storageKey and data are both set for an instant here. photoBytes()
      // prefers storageKey, so the row is already being served out of R2
      // before the column is cleared — which is the safe order: a crash
      // between these two writes costs disk, not a broken image.
      await db.maintenancePhoto.update({
        where: { id: row.id },
        data: { storageKey: stored.key, data: null },
      });
      moved += 1;
    } catch (err) {
      failed += 1;
      console.error(`[cron:photo-backfill] maintenance photo ${row.id} failed`, err);
      await reportServerError(`cron:photo-backfill:maintenance:${row.id}`, err);
    }
  }

  const remaining = await db.maintenancePhoto.count({
    where: { storageKey: null, data: { not: null } },
  });
  return { moved, failed, remaining };
}

async function backfillListings(): Promise<Outcome> {
  const rows = await db.listingPhoto.findMany({
    where: { storageKey: null, data: { not: null } },
    take: BATCH,
    select: {
      id: true,
      data: true,
      contentType: true,
      listing: { select: { organizationId: true } },
    },
  });

  let moved = 0;
  let failed = 0;

  for (const row of rows) {
    if (!row.data) continue;
    try {
      const stored = await putObject({
        organizationId: row.listing.organizationId,
        bytes: new Uint8Array(row.data),
        contentType: row.contentType,
      });
      await db.listingPhoto.update({
        where: { id: row.id },
        data: { storageKey: stored.key, data: null },
      });
      moved += 1;
    } catch (err) {
      failed += 1;
      console.error(`[cron:photo-backfill] listing photo ${row.id} failed`, err);
      await reportServerError(`cron:photo-backfill:listing:${row.id}`, err);
    }
  }

  const remaining = await db.listingPhoto.count({
    where: { storageKey: null, data: { not: null } },
  });
  return { moved, failed, remaining };
}
