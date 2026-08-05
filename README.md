# HK Software Property Management

## Local development

```
cp .env.example .env   # then fill in DATABASE_URL for your local Postgres
npm install
npm run db:migrate      # or db:push for a throwaway schema
npm run db:seed         # optional demo data
npm run dev
```

Required env vars (`.env`/`.env.local`): `DATABASE_URL` (Postgres), `AUTH_SECRET`,
`AUTH_URL`, `APP_URL`. Optional: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
`STRIPE_APPLICATION_FEE_BPS`, `CRON_SECRET` (needed once you wire up the rent-run
cron somewhere — see below).

```
npm run typecheck
npm test          # vitest
```

## Deploying to Cloudflare

This app runs on Cloudflare Workers via the [OpenNext Cloudflare
adapter](https://opennext.js.org/cloudflare) — full Next.js App Router support
(Server Actions, Route Handlers, etc.), not the static-only Pages path. Postgres
stays Postgres; Prisma talks to it through the `pg` driver adapter
(`@prisma/adapter-pg`), routed through [Hyperdrive](https://developers.cloudflare.com/hyperdrive/)
in production. See `src/lib/db.ts` for how that's wired.

### One-time setup

1. **Hyperdrive.** Point it at your production Postgres:
   ```
   npx wrangler hyperdrive create hksoftware-real-estate-db \
     --connection-string="<your production Postgres URL>"
   ```
   Paste the returned `id` into `wrangler.jsonc`'s `hyperdrive[0].id` (it ships
   with a placeholder).

2. **Secrets** (never committed — set once per environment):
   ```
   npx wrangler secret put AUTH_SECRET
   npx wrangler secret put STRIPE_SECRET_KEY        # optional, if using Stripe
   npx wrangler secret put STRIPE_WEBHOOK_SECRET     # optional
   npx wrangler secret put CRON_SECRET
   ```

3. **Vars.** `wrangler.jsonc` already sets `USE_HYPERDRIVE=true` (that's what
   tells `src/lib/db.ts` to resolve its connection through the Hyperdrive
   binding instead of `DATABASE_URL`). Once you have a real domain, also add
   `AUTH_URL` / `APP_URL` under `vars`.

4. **Database migrations** still run directly against Postgres, from wherever
   you run `npx prisma migrate deploy` (CI, or your own machine) — Hyperdrive
   is only in the request path for the deployed Worker, not for the Prisma
   CLI.

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
  against your local Postgres via `DATABASE_URL` — no Cloudflare bindings
  involved, by design, so day-to-day development stays exactly as fast and
  simple as before. `npm run cf:preview` is there for when you want to
  sanity-check the actual Workers build before deploying.
- **Photos are stored in Postgres**, not R2 — no filesystem or object storage
  dependency to migrate.
- **No incremental cache bindings** (KV/R2/D1) are configured yet; Next's
  cache falls back to in-isolate memory. Fine for this app's traffic; revisit
  if ISR/full-route caching across isolates becomes worth it.
