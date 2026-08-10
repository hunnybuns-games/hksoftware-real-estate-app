# HK Software Property Management

See [`docs/MAINTAINER.md`](docs/MAINTAINER.md) for the full architecture, domain model,
and maintainer runbook.

## Local development

```
cp .env.example .env
npm install
npm run db:migrate      # or db:push for a throwaway schema
npm run db:seed         # optional demo data
npm run dev
```

No local database server to start — `DATABASE_URL` points at a local SQLite file
(`prisma/dev.db`, git-ignored, created automatically by the commands above).

Required env vars (`.env`/`.env.local`): `DATABASE_URL`, `AUTH_SECRET`, `AUTH_URL`,
`APP_URL`. Optional: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
`STRIPE_APPLICATION_FEE_BPS`, `CRON_SECRET` (needed once you wire up the rent-run
cron somewhere — see below), `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV`
(`sandbox` or `production`, defaults to `sandbox`), `BANK_TOKEN_ENCRYPTION_KEY`
(`openssl rand -base64 32` — encrypts a connected bank's access token at rest;
see docs/MAINTAINER.md for the owner bank-feed feature this powers).

```
npm run typecheck
npm test          # vitest
```

## Deploying to Cloudflare

This app runs on Cloudflare Workers via the [OpenNext Cloudflare
adapter](https://opennext.js.org/cloudflare) — full Next.js App Router support
(Server Actions, Route Handlers, etc.), not the static-only Pages path. The database is
[D1](https://developers.cloudflare.com/d1/) — Cloudflare's own SQLite, accessed through a
native Workers binding (`env.DB`). No connection string, no network hop, no connection
pool to manage. See `src/lib/db.ts` for how that's wired.

### One-time setup

1. **Create the D1 database:**
   ```
   npx wrangler d1 create hksoftware-real-estate-db
   ```
   Paste the returned `database_id` into `wrangler.jsonc`'s `d1_databases[0].database_id`
   (it ships with a placeholder).

2. **Apply the schema to it:**
   ```
   npm run cf:migrate
   ```
   This syncs `prisma/migrations/` into the flat layout Wrangler wants and applies
   anything outstanding. Wrangler records what it has run in a `d1_migrations` table
   inside the database, so it's safe to re-run — and it's the same command any time you
   add a schema change, or to rebuild the schema after a bad restore. `npm run
   cf:migrations:status` shows applied vs outstanding.

3. **Secrets** (never committed — set once per environment):
   ```
   npx wrangler secret put AUTH_SECRET
   npx wrangler secret put STRIPE_SECRET_KEY            # optional, if using Stripe
   npx wrangler secret put STRIPE_WEBHOOK_SECRET        # optional
   npx wrangler secret put CRON_SECRET
   npx wrangler secret put PLAID_CLIENT_ID              # optional, if using the owner bank feed
   npx wrangler secret put PLAID_SECRET                 # optional
   npx wrangler secret put BANK_TOKEN_ENCRYPTION_KEY    # required alongside the two above
   ```

4. **Vars.** `wrangler.jsonc` already sets `USE_D1=true` (that's what tells
   `src/lib/db.ts` to use the D1 binding instead of a local SQLite file). Once you have a
   real domain, also add `AUTH_URL` / `APP_URL` under `vars`. If you're using the Plaid
   bank feed, add `PLAID_ENV="production"` under `vars` once you're off Sandbox (defaults
   to `sandbox` if unset), and register a webhook endpoint in the Plaid dashboard pointed
   at `https://<your-domain>/api/plaid/webhook` subscribed to Item and Transactions
   events.

### Build & deploy

```
npm run cf:build     # prisma generate + next build + opennextjs-cloudflare build
npm run cf:deploy     # builds, then deploys via wrangler
npm run cf:preview    # builds, then runs it locally under workerd (closest thing to prod)
```

If you change `wrangler.jsonc`'s bindings, regenerate the committed type
definitions with `npm run cf:typegen` (writes `cloudflare-env.d.ts`).

### The cron job

The daily rent run (`/api/cron/rent-run` — posts this month's charges, sends
due/late notices) used to be triggered by Vercel Cron (`vercel.json`). On
Cloudflare it's a native [Cron Trigger](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
(see `wrangler.jsonc`'s `triggers.crons`), handled by `src/worker/index.ts` — a
thin wrapper around the OpenNext-generated worker that adds a `scheduled()`
handler calling the same route internally, with the same `CRON_SECRET` check
the route already had. Everything else passes straight through to Next.js
unchanged.

### Notes / things intentionally not done

- **Local dev doesn't go through Wrangler.** `npm run dev` is plain `next dev`
  against a local SQLite file — no Cloudflare bindings involved, by design, so
  day-to-day development stays exactly as fast and simple as before. `npm run
  cf:preview` is there for when you want to sanity-check the actual Workers
  build before deploying.
- **Photos are stored in the database**, not R2 — no filesystem or object
  storage dependency to manage.
- **No incremental cache bindings** (KV/R2) are configured yet; Next's cache
  falls back to in-isolate memory. Fine for this app's traffic; revisit if
  ISR/full-route caching across isolates becomes worth it.
- **Why D1 and not an external Postgres.** This app briefly ran on Postgres
  (via Neon) behind Cloudflare Hyperdrive. That setup hit persistent,
  unresolved connection reliability issues in production — see git history
  around the Hyperdrive/Postgres commits, and `docs/MAINTAINER.md`, for the
  full account. D1 removes the entire class of problem: no external host, no
  pooling between two separate services, nothing to misconfigure.
