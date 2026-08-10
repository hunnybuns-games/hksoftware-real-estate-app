import { timingSafeEqual } from "node:crypto";

/**
 * Shared bearer-token check for the scheduled routes.
 *
 * Without a configured secret the endpoint is refused outright rather than
 * left open — these routes send tenant email and write payment rows, so an
 * unauthenticated caller could spam every tenant you have or churn a bank sync.
 *
 * Called by both /api/cron/rent-run and /api/cron/bank-sync, and by
 * src/worker/index.ts's scheduled() handler indirectly, since that triggers
 * them as ordinary self-requests carrying the same header.
 */
export function isCronAuthorized(req: Request, label: string): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error(`[cron:${label}] CRON_SECRET is not set; refusing to run`);
    return false;
  }

  const header = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  // Length is compared first because timingSafeEqual throws on a mismatch —
  // that leaks length, which is not sensitive here, unlike the secret itself.
  return a.length === b.length && timingSafeEqual(a, b);
}
