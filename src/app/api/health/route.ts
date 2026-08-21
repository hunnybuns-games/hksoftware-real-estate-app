import { db } from "@/lib/db";

/**
 * What an external uptime pinger hits (see docs/observability.md). No auth —
 * a monitor that needs a login is a monitor nobody sets up — and no
 * meaningful body, just a status code an uptime service can alert on.
 *
 * Checks the database, not just "did this Worker respond". A Worker can be
 * up while D1 is unreachable, and that's the failure mode this app has
 * actually hit before (see docs/MAINTAINER.md) — a health check that only
 * proves the Worker itself is running would stay green through exactly the
 * outage worth knowing about.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    // Cheapest possible real query — touches the connection/binding without
    // scanning a table. Works identically against D1 and the local
    // better-sqlite3 adapter used everywhere else in this app.
    await db.$queryRaw`SELECT 1`;
    return Response.json({ status: "ok", checkedAt: new Date().toISOString() });
  } catch (err) {
    console.error("[health] database check failed", err);
    return Response.json(
      {
        status: "error",
        checkedAt: new Date().toISOString(),
        error: err instanceof Error ? err.message : "unknown error",
      },
      { status: 503 },
    );
  }
}
