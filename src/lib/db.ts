import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Connection string resolution:
 *  - Locally, in tests, and from the Prisma CLI (migrate/seed) — DATABASE_URL,
 *    a direct Postgres connection string.
 *  - Deployed to Cloudflare Workers — routed through Hyperdrive, which pools
 *    and caches connections at Cloudflare's edge instead of from inside the
 *    Worker isolate. wrangler.jsonc sets USE_HYPERDRIVE only there.
 *
 * Either way Prisma talks to Postgres through the `pg` driver adapter, not
 * its native query-engine binary — that binary can't run inside a Workers
 * isolate at all, Hyperdrive or not.
 */
function resolveConnectionString(): string {
  if (process.env.USE_HYPERDRIVE === "true") {
    // getCloudflareContext() only resolves inside an active request on
    // Cloudflare Workers, which is exactly why this whole client has to be
    // built lazily (see the Proxy below) instead of at module-evaluation time.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getCloudflareContext } = require("@opennextjs/cloudflare") as typeof import("@opennextjs/cloudflare");
    // env's HYPERDRIVE field comes from the global CloudflareEnv augmentation
    // in cloudflare-env.d.ts, generated to match wrangler.jsonc's binding.
    const { env } = getCloudflareContext();
    return env.HYPERDRIVE.connectionString;
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  return url;
}

function createClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: resolveConnectionString() });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

// Cached at module scope so a warm Next.js dev reload (or a Cloudflare Worker
// isolate handling many requests) reuses one pool instead of leaking a new
// one per edit/request until Postgres refuses connections.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * A Proxy rather than a plain client: on Cloudflare, resolveConnectionString()
 * can only run inside a request (Hyperdrive's binding isn't available at
 * module-evaluation time, i.e. Worker cold start), so the real PrismaClient
 * has to be constructed lazily on first use rather than eagerly here. Every
 * call site keeps using `db.lease.findMany(...)` etc. exactly as before —
 * only this file changed.
 */
export const db: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    globalForPrisma.prisma ??= createClient();
    return Reflect.get(globalForPrisma.prisma, prop, receiver);
  },
});
