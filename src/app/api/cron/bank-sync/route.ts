import { db } from "@/lib/db";
import { isCronAuthorized } from "@/lib/cron-auth";
import { plaidEnabled } from "@/lib/plaid";
import { syncBankConnection } from "@/lib/plaid-sync";

/**
 * Nightly catch-up for connected bank feeds. Two jobs:
 *
 *  1. **Drain backlogs.** A single sync collects a bounded number of pages
 *     (see plaid-sync.ts — D1 caps queries per request), so a freshly connected
 *     account with years of history needs several runs to finish. This is what
 *     makes that cap safe: nothing stalls waiting for a human.
 *  2. **Cover missed webhooks.** Normally Plaid's SYNC_UPDATES_AVAILABLE drives
 *     syncing. Webhooks get lost. Re-syncing every connection nightly means a
 *     dropped one costs a day of latency rather than silently losing a month of
 *     rent payments.
 *
 * When there's nothing new, a sync is cheap: Plaid returns an empty page and
 * this does a handful of queries per connection.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Connections handled per run, oldest-synced first. Bounds the work one
 * invocation does when there are many organizations; because the ordering is
 * by staleness, successive runs rotate through everyone rather than starving
 * whoever sorts last.
 */
const MAX_CONNECTIONS_PER_RUN = 10;

export async function GET(req: Request): Promise<Response> {
  if (!isCronAuthorized(req, "bank-sync")) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!plaidEnabled()) {
    return Response.json({ skipped: "Plaid is not configured." });
  }

  const connections = await db.bankConnection.findMany({
    where: { status: "ACTIVE" },
    // Nulls sort first in SQLite, so never-synced connections lead — which is
    // what you want, since those are the ones with a backlog.
    orderBy: { lastSyncedAt: "asc" },
    take: MAX_CONNECTIONS_PER_RUN,
    select: { id: true, organizationId: true },
  });

  const results: {
    bankConnectionId: string;
    organizationId: string;
    added?: number;
    modified?: number;
    removed?: number;
    hasMore?: boolean;
    error?: string;
  }[] = [];

  for (const connection of connections) {
    try {
      const outcome = await syncBankConnection(connection.id);
      results.push({
        bankConnectionId: connection.id,
        organizationId: connection.organizationId,
        added: outcome.added,
        modified: outcome.modified,
        removed: outcome.removed,
        hasMore: outcome.hasMore,
      });
    } catch (err) {
      // One organization's broken connection must not stop everyone else's
      // sync. Record it and carry on.
      console.error(`[cron:bank-sync] ${connection.id} failed`, err);
      results.push({
        bankConnectionId: connection.id,
        organizationId: connection.organizationId,
        error: err instanceof Error ? err.message : "unknown error",
      });
    }
  }

  return Response.json({
    ranAt: new Date().toISOString(),
    connectionsProcessed: results.length,
    results,
  });
}
