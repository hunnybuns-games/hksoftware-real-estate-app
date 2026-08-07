// Two imports, deliberately, not one. @prisma/client's default export is
// resolved through a conditional exports map keyed on platform ("node" vs
// "workerd" vs "edge-light", ...), and on Cloudflare that resolution has
// picked the Node-oriented runtime before — which tries to read the WASM
// query compiler off a real filesystem, and Workers has none. "./wasm.js" is
// built for exactly that situation, but it doesn't work under plain
// Node/tsx in this toolchain either — so neither variant works everywhere;
// each is only correct on the platform it was built for. Import both, pick
// the right one at runtime with the same USE_D1 signal that already
// distinguishes Workers from everywhere else (see createClient below).
import path from "node:path";
import { PrismaClient as PrismaClientNode } from "@prisma/client";
import { PrismaClient as PrismaClientWasm } from "@prisma/client/wasm.js";
import { PrismaD1 } from "@prisma/adapter-d1";
import { PrismaBetterSQLite3 } from "@prisma/adapter-better-sqlite3";

type PrismaClient = InstanceType<typeof PrismaClientNode>;

/**
 * The Prisma CLI resolves a relative sqlite `file:` URL against
 * prisma/schema.prisma's own directory, not the process's cwd — but
 * better-sqlite3 (what this file hands the path to) resolves it against
 * cwd, same as any normal Node file access. Left alone, `prisma migrate`/
 * `db seed` and this app's own runtime client silently end up pointing at
 * two different files. Resolving it the same way the CLI does, here, is
 * what keeps them in agreement.
 */
function localSqliteUrl(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is not set.");
  const relative = raw.replace(/^file:/, "");
  if (path.isAbsolute(relative)) return raw;
  return `file:${path.join(process.cwd(), "prisma", relative)}`;
}

/**
 * D1 is SQLite — this app talks to it through Prisma's driver-adapter
 * mechanism, same idea as the Postgres setup this replaced, but D1 itself
 * removes the whole class of problems that setup had: no connection string,
 * no network hop to manage, no pool that can go stale while idle, nothing to
 * misconfigure pooled-vs-direct. `env.DB` is a native Workers binding,
 * colocated with the Worker (see docs/MAINTAINER.md for the full story).
 *
 * Locally, in tests, and from the Prisma CLI (migrate/seed) — a plain local
 * SQLite file via @prisma/adapter-better-sqlite3, no server process at all.
 */
function createClient(): PrismaClient {
  if (process.env.USE_D1 === "true") {
    // getCloudflareContext() only resolves inside an active request on
    // Cloudflare Workers, which is exactly why this whole client has to be
    // built lazily (see the Proxy below) instead of at module-evaluation
    // time. env.DB's type comes from the global CloudflareEnv augmentation
    // in cloudflare-env.d.ts, generated to match wrangler.jsonc's binding.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getCloudflareContext } = require("@opennextjs/cloudflare") as typeof import("@opennextjs/cloudflare");
    const { env } = getCloudflareContext();
    return new PrismaClientWasm({ adapter: new PrismaD1(env.DB) });
  }

  return new PrismaClientNode({ adapter: new PrismaBetterSQLite3({ url: localSqliteUrl() }) });
}

// Cached at module scope so a warm Next.js dev reload (or a Cloudflare Worker
// isolate handling many requests) reuses one client instead of leaking a new
// one per edit/request.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * A Proxy rather than a plain client: on Cloudflare, the D1 binding isn't
 * available at module-evaluation time (Worker cold start) — only once a
 * request is actually in flight — so the real PrismaClient has to be
 * constructed lazily on first use rather than eagerly here. Every call site
 * keeps using `db.lease.findMany(...)` etc. exactly as before — only this
 * file changed.
 */
export const db: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    globalForPrisma.prisma ??= createClient();
    return Reflect.get(globalForPrisma.prisma, prop, receiver);
  },
});
