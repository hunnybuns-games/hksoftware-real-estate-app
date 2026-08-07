// Two imports, deliberately, not one. @prisma/client's default export is
// resolved through a conditional exports map keyed on platform ("node" vs
// "workerd" vs "edge-light", ...), and on Cloudflare that resolution picked
// the Node-oriented runtime — which tries to read query_compiler_bg.wasm off
// a real filesystem and crashes on the very first query ("no such file or
// directory, readAll ..."), because Workers has no filesystem at all.
// "./wasm.js" is built for exactly that situation, but it turns out to *not*
// work under plain Node/tsx in this toolchain (dynamic `import()` of the
// .wasm file resolves to something Prisma doesn't recognize) — so neither
// variant works everywhere; each is only correct on the platform it was
// built for. Import both, pick the right one at runtime with the same
// USE_HYPERDRIVE signal that already distinguishes Workers from everywhere
// else (see resolveConnectionString below).
import { PrismaClient as PrismaClientNode } from "@prisma/client";
import { PrismaClient as PrismaClientWasm } from "@prisma/client/wasm.js";
import { PrismaPg } from "@prisma/adapter-pg";

const PrismaClient = process.env.USE_HYPERDRIVE === "true" ? PrismaClientWasm : PrismaClientNode;
type PrismaClient = InstanceType<typeof PrismaClientNode>;

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
  const adapter = new PrismaPg({
    connectionString: resolveConnectionString(),
    // node-postgres has NO connection timeout by default — a stalled connect
    // attempt (or a pooled connection Hyperdrive silently closed while idle,
    // which this isolate has no way to know about until it tries to use it)
    // would otherwise hang until the Workers runtime itself kills the request
    // ~30s later with no error our code ever sees, let alone reports. Failing
    // fast here means a bad connection surfaces as a normal, retryable error
    // instead of a silent hang. `max` is kept small — Hyperdrive already
    // pools at Cloudflare's edge, so this pool only needs to cover concurrent
    // requests within one isolate, not hold many connections open itself.
    max: 5,
    connectionTimeoutMillis: 8_000,
    idleTimeoutMillis: 10_000,
  });
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
