# Maintainer report

A point-in-time reference for the current state of this repo — not auto-synced with
future changes. If a section here drifts from the code, the code wins.

## Contents

1. [What this app is](#1-what-this-app-is)
2. [Architecture at a glance](#2-architecture-at-a-glance)
3. [Domain model](#3-domain-model)
4. [Roles & access control](#4-roles--access-control)
5. [Rent collection, multi-source](#5-rent-collection-multi-source)
6. [The reconciliation engine](#6-the-reconciliation-engine)
7. [Reporting & export](#7-reporting--export)
8. [Maintenance, notifications, cron](#8-maintenance-notifications-cron)
9. [File map](#9-file-map)
10. [Environments & configuration](#10-environments--configuration)
11. [Deploying (Cloudflare specifics)](#11-deploying-cloudflare-specifics)
12. [Testing](#12-testing)
13. [Known gaps & deliberate non-goals](#13-known-gaps--deliberate-non-goals)
14. [Maintainer runbook](#14-maintainer-runbook)

## 1. What this app is

A property management SaaS for independent landlords and small management companies
(roughly 20–200 units) — the size that's outgrown spreadsheets but doesn't need
enterprise software. One organization per management company; each organization has its
own properties, units, tenants, leases, staff, and owners, fully isolated from every other
organization in the same database.

The core loop: add properties and units, put tenants on leases, collect rent from
whatever source it actually arrives through — bank transfer, Venmo, Cash App, cash,
Section 8/HAP, or card/ACH via Stripe — and the app tells you, per lease and at a glance,
who's paid, who's short, and who's late. Maintenance requests, an owner portal, and CSV
exports for lenders/CPAs round it out.

**Current state:** feature-complete for the scope above. Deployed target is Cloudflare
Workers with a Neon Postgres database behind Cloudflare Hyperdrive — see [§11](#11-deploying-cloudflare-specifics).

## 2. Architecture at a glance

```
browser
  │
  ▼
Next.js 16 App Router  (Server Components, Server Actions, Route Handlers)
  │
  ├─ Auth.js v5          credentials login, JWT session, role + org on the token
  ├─ Prisma 6 + pg driver adapter   never the native query-engine binary
  ├─ Stripe Connect       Express accounts, destination charges
  └─ RBAC guards          every query scoped by organizationId
  │
  ▼
Postgres 18 (Neon) — behind Cloudflare Hyperdrive in production
```

Nothing here is exotic. The one deliberate architectural constraint, threaded through
everything: **Prisma never uses its native query-engine binary** — it's configured with
`engineType = "client"` and always constructed with `@prisma/adapter-pg`. That's not a
style preference, it's load-bearing: the native engine can't run inside a Cloudflare
Workers isolate at all, so the app would only run on Vercel/Node otherwise. See
`src/lib/db.ts`.

Money is stored as integer cents everywhere, never floats — check any `amountCents`/
`rentAmountCents` field. Dates that represent a calendar day (lease start/end, charge due
dates, rent periods) are normalized to midnight UTC rather than built with
local-timezone constructors — see the comment block at the top of `src/lib/dates.ts` for
why.

## 3. Domain model

Every table below lives in `prisma/schema.prisma`. The core chain:

```
Organization
  ├─ User            (ADMIN / STAFF / OWNER / TENANT — see §4)
  ├─ Property
  │    └─ Unit
  │         └─ Lease ── Tenant
  │              ├─ Charge    (what's billed: rent, late fee, deposit, other)
  │              └─ Payment   (what's received — see §5, §6)
  ├─ PropertyOwner   (join: which User(OWNER) sees which Property)
  ├─ PaymentImportBatch   (a CSV upload; see §5)
  ├─ Expense         (property-level, feeds P&L — see §7)
  ├─ MaintenanceRequest ── MaintenancePhoto, MaintenanceNote
  └─ Invitation      (staff/owner signup flow)
```

A `Lease` optionally carries a **rent split** — `subsidyOwedCents` and
`subsidyPayerName` — for subsidized arrangements like Section 8/HAP, where part of the
rent comes from the tenant and part from a housing authority. `src/lib/rent-split.ts`
derives the tenant's actual owed portion from the total rent and the subsidy amount,
clamping the subsidy so it can never exceed the rent. Most leases leave this null and
it's a no-op.

## 4. Roles & access control

| Role | Sees | Lands on |
|---|---|---|
| `ADMIN` | Everything in their org, plus billing/team settings | `/app` |
| `STAFF` | Everything in their org except admin-only settings | `/app` |
| `OWNER` | Financials only, for their assigned properties — never tenant names or contact info | `/owner` |
| `TENANT` | Their own lease, ledger, and maintenance requests | `/portal` |

`src/lib/rbac.ts` has two families of guard, and the distinction matters:

- `requireStaff()` / `requireOwner()` / `requireTenant()` — for Server Components and
  pages. On failure they `redirect()`.
- `assertStaff()` / `assertOwner()` / `assertTenant()` — for Server Actions and Route
  Handlers, which must not throw a redirect mid-mutation. On failure they throw
  `AuthorizationError`, which callers turn into a form error or a JSON 403.

> **Gotcha — every export from a `"use server"` file is a public endpoint.** A non-async
> helper accidentally exported from an action file once corrupted that file's entire
> Server Actions manifest (actions started 404ing with no obvious cause). While fixing
> it, a second issue turned up in the same file: an async helper that queried by a
> caller-supplied `organizationId` with no auth check — since *every* export from a
> `"use server"` file is a callable action reference, that was a real cross-org data leak
> waiting to be hit directly. Keep action files to only the actions themselves; put shared
> logic in `src/lib`.

## 5. Rent collection, multi-source

This is the part of the app that isn't a standard rent-collection tool: Stripe is **one**
payment source among several, not the assumed default. Every `Payment` row carries a
`source`:

| Value | How it gets there |
|---|---|
| `stripe_native` | Tenant portal Checkout, or staff-simulated in dev |
| `manual_cash` | Staff records a check/cash payment by hand |
| `import_bank` | CSV import — bank statement export |
| `import_venmo` | CSV import — Venmo export |
| `import_cashapp` | CSV import — Cash App export |
| `import_hap` | CSV import — housing-authority payment report |

### Manual entry & CSV import

Manual entry (`recordManualPaymentAction` in `src/actions/payments.ts`) is a form on the
lease ledger page — date, amount, source, optional note. The CSV path
(`src/app/app/payments/import/`, backed by `src/actions/import.ts`) is a three-step flow:

1. **Upload.** `src/lib/csv.ts` parses the file (hand-rolled, RFC 4180 compliant — quoted
   fields, embedded commas/newlines, no dependency). A SHA-256 content hash on the raw
   file rejects re-uploading the same export twice.
2. **Map columns.** `src/lib/import-mapping.ts` guesses which column is
   date/amount/description from common header names; the review page lets staff correct
   the guess if the format isn't recognized. Bad rows (unparseable amount/date, negative
   or zero amounts) are flagged with a reason and excluded from the count that actually
   imports.
3. **Confirm.** `src/lib/lease-matching.ts` suggests which lease a row belongs to via
   token-overlap scoring against tenant name/unit label — no dependency, and it
   deliberately returns no match rather than guessing on a tie. Confirming creates real
   `Payment` rows tagged with the batch's source and immediately runs reconciliation.

### Stripe Connect

Destination-charge model: each organization onboards its own Express account, and tenant
payments are created on the platform with `transfer_data.destination` pointing at that
account — funds settle directly into the landlord's Stripe balance, Stripe handles
KYC/payouts, and the platform never takes custody of rent money. See
`src/lib/stripe.ts`. Stripe is fully optional — with no `STRIPE_SECRET_KEY` set, the app
works end-to-end and the tenant portal just says online payment isn't enabled yet.

## 6. The reconciliation engine

This is the actual differentiator, and the thing most worth understanding before
touching billing logic. `src/lib/reconciliation.ts` replaces "did everyone pay"
spreadsheet-checking: for every lease, it matches incoming payments — from any source —
against what's owed for the period, using the same charge-generation logic the ledger
already uses.

**Recomputed from scratch, not incrementally**, every time it's triggered (after a
payment is recorded, a lease is edited, a charge is added/voided, or an import is
confirmed). Payments allocate to charges FIFO by due date. Each payment lands on one of
four statuses, and it's the engine that sets this — never a manual field:

| Status | Meaning |
|---|---|
| `matched` | Fully covers what it was applied against |
| `short` | The period's charges aren't fully covered |
| `late` | Past due, outside the grace period |
| `unmatched` | No lease it can be attributed to — surfaced everywhere, not buried |

### The rule that actually matters: combined-total, not per-portion

For a lease with a subsidy split, a HAP-sourced payment is attributed to the subsidy
portion and a tenant-sourced payment to the tenant portion — but a shortfall is only
flagged if the **combined total** for the period is short. A tenant paying their $600 on
time while the housing authority's $900 hasn't landed yet is not short; it's an
incomplete picture until both arrive, and the engine treats it that way. This exact rule
has dedicated unit tests (see `reconciliation.test.ts`) because it's the easiest thing to
get subtly wrong.

## 7. Reporting & export

`src/lib/reports.ts` is the single source of truth for both the on-screen reports and
their CSV exports — the report page and its "Export CSV" link can never disagree about
what a number means, because they call the same function.

- **Rent roll** — every active lease, portfolio-wide or scoped to an owner's properties,
  with the same `includeTenantNames` flag the owner dashboard already used to strip
  identity. `/app/reports`, `/api/export/rent-roll`.
- **Property P&L** — income by source plus logged expenses by category, for a date
  range. `/app/reports/[propertyId]`, `/api/export/property-pl`.
- **Owner statement** — the exact same P&L function, scoped to a property the owner is
  actually assigned to. No tenant name appears anywhere in the output (income lines are
  attributed to a unit, never a person), so it's safe for that audience as-is.
  `/owner/reports/[propertyId]`.

Per the original brief, **every** table of financial data has an "Export CSV" link next
to it, not just a dedicated reports page — the lease ledger's charges and payments
tables, the Rent page, the dashboard, and the owner dashboard all export through
`src/app/api/export/*`.

## 8. Maintenance, notifications, cron

Maintenance requests carry a status (`OPEN → IN_PROGRESS → RESOLVED`), priority, staff
notes, and photos. **Photos are stored as blobs directly in Postgres**
(`MaintenancePhoto.data`), not on disk or in object storage — a deliberate
simplification that also happened to make the Cloudflare move easier, since there was no
filesystem dependency to migrate. Every photo request re-checks authorization
(`canViewPhoto`) rather than trusting an unguessable URL as access control.

`src/app/api/cron/rent-run/route.ts` is the daily job: post this month's rent charges,
then send due/late notices. It's idempotent — charges are keyed on `(lease, type,
period)` and every notification carries a dedupe key, so running it five times in a day
sends nothing extra. It checks a bearer token against `CRON_SECRET`. On Cloudflare this
is triggered by a native Cron Trigger (see `src/worker/index.ts`); it used to be Vercel
Cron (`vercel.json`, no longer wired up but left in the repo).

## 9. File map

| Path | What's there |
|---|---|
| `prisma/schema.prisma` | The whole data model, 29 models/enums |
| `prisma/migrations/` | Hand-reviewed SQL migrations — see [§14](#14-maintainer-runbook) before writing one by hand |
| `prisma/seed.ts` | Demo data generator — one realistic 34-unit portfolio |
| `src/lib/` | Framework-free domain logic: `ledger.ts` (balance/lateness math), `reconciliation.ts`, `rent-split.ts`, `reports.ts`, `csv.ts`, `import-mapping.ts`, `lease-matching.ts`, `rbac.ts`, `db.ts`, `stripe.ts`, `auth.ts` |
| `src/actions/` | Server Actions, one file per domain area (leases, payments, tenants, properties, maintenance, import, expenses, team, org) |
| `src/app/app/` | Staff-facing app (`requireStaff`-gated): dashboard, properties, leases, payments/import, reports, maintenance, tenants, settings |
| `src/app/owner/` | Owner portal (`requireOwner`-gated): financials-only dashboard + statements |
| `src/app/portal/` | Tenant portal (`requireTenant`-gated): lease, payments, maintenance |
| `src/app/api/export/` | CSV export Route Handlers: rent-roll, property-pl, payments, charges |
| `src/app/api/cron/rent-run/` | The daily job (§8) |
| `src/worker/index.ts` | Cloudflare Worker wrapper — adds the cron `scheduled()` handler around the generated OpenNext worker |
| `src/lib/__tests__/` | vitest unit tests — csv, import, ledger, reconciliation |

## 10. Environments & configuration

Local development never touches Cloudflare at all — `npm run dev` is plain `next dev`
against whatever Postgres `DATABASE_URL` points to. That's a deliberate choice (see
[§11](#11-deploying-cloudflare-specifics)), not an oversight: everyday development stays
exactly as fast and simple as a normal Next.js app.

| Name | Required | Where it's set |
|---|---|---|
| `DATABASE_URL` | Always | `.env` locally; not used in production (Hyperdrive takes over — see §11) |
| `AUTH_SECRET` | Always | `.env` locally; `wrangler secret put` in production |
| `AUTH_URL` / `APP_URL` | Always | `.env` locally; `wrangler.jsonc` `vars` in production (your real origin) |
| `CRON_SECRET` | For the rent-run job | `wrangler secret put` |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Only if using Stripe | `wrangler secret put` |
| `USE_HYPERDRIVE` | Production only | `wrangler.jsonc` `vars` — not a secret, just a switch (see §11) |

## 11. Deploying (Cloudflare specifics)

Production target is **Cloudflare Workers**, via the
[OpenNext adapter](https://opennext.js.org/cloudflare) — the full App Router app (Server
Actions included), not a static export. Database is **Postgres 18 on Neon**, reached
through **Cloudflare Hyperdrive**, which pools/caches the connection at Cloudflare's edge
instead of from inside the Worker isolate.

```
wrangler.jsonc          Worker config: assets, Hyperdrive binding, cron trigger
open-next.config.ts     OpenNext build config (defaults — no extra cache bindings)
src/worker/index.ts     Wraps the generated worker to add the cron scheduled() handler
cloudflare-env.d.ts     Generated types for the Worker's env bindings — committed,
                        regenerate with `npm run cf:typegen` after changing bindings
```

`npm run cf:build` / `cf:preview` / `cf:deploy` are the three you'll actually use —
build-only, local workerd preview, and build-then-deploy.

> **Gotcha — Prisma's native engine can't run in a Worker at all.** `engineType =
> "client"` in `schema.prisma`, plus `@prisma/adapter-pg` everywhere a `PrismaClient`
> gets constructed (`src/lib/db.ts` and `prisma/seed.ts` both). This isn't optional under
> this setup — without an adapter, construction throws, because there's no embedded
> engine to fall back to. It also happens to be why the native query-engine binary
> (17MB, dead weight) is gone from the deployed bundle.

> **Gotcha — pg-cloudflare's real file goes missing from the bundle.** `pg`'s
> Cloudflare-specific socket implementation (`pg-cloudflare`) is resolved differently by
> Next's build-time file tracer (plain Node conditions → the empty stub) than by
> OpenNext's Workers bundler (the `workerd` condition → the real implementation) — so
> without intervention, the build silently ships a stub and fails at bundle time with
> `Could not resolve "pg-cloudflare"`. Fixed via `outputFileTracingIncludes` in
> `next.config.ts`, forcing the tracer to carry the real files along regardless of which
> condition it resolved.

> **Gotcha — the free plan's 3 MiB Worker size limit.** Even with the native engine
> gone, Prisma still needs its WASM query *compiler* (~1.9MB) to turn queries into SQL,
> and that's before Auth.js, Stripe, and the app's own code. The measured deployed
> bundle is comfortably under 10MB but over the free tier's 3MB. **This app requires the
> Workers Paid plan ($5/month)** — not a bug to keep chasing, a real requirement of
> running a full Next.js app with Prisma on Workers at all.

> **Gotcha — Hyperdrive needs a local-connection-string build var.**
> `opennextjs-cloudflare deploy` resolves the Hyperdrive binding locally as part of
> packaging even in CI, which needs a real reachable Postgres string. Set
> `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` as a **build environment
> variable** (Cloudflare dashboard → Settings → Environment variables for the build,
> distinct from the Worker's own runtime secrets) to your real Postgres connection
> string.

**Prefer not to deal with any of this?** The app runs as a completely ordinary Next.js
server with none of the above — `npm run build && npm run start` against any reachable
`DATABASE_URL`, no OpenNext/Hyperdrive/wrangler involved at all. The repo also still has
a `vercel.json` from before this Cloudflare work — Vercel hosts Next.js natively with no
bundle-size fight. Worth considering if "Cloudflare specifically" isn't a hard
requirement.

## 12. Testing

Two layers, and both are meant to be re-run after any change that touches billing, auth,
or reconciliation — not just before a release.

### Unit — `npm test` (vitest)

- `ledger.test.ts` — balance and lateness math
- `reconciliation.test.ts` — the FIFO engine, including the combined-total HAP rule from
  §6, hand-traced
- `import.test.ts` — column-mapping guesses, bad-row detection, lease matching
- `csv.test.ts` — the parser/writer itself

### End-to-end (Playwright)

Three scripts, not checked into the repo as of this report — they were written and run
from the build session's scratchpad and are worth committing to `e2e/` or similar if you
want them to survive. Covers: the original MVP flows (auth, properties, leases, Stripe
simulation, maintenance — 48 checks), the reconciliation/import flows (16 checks), and
the reporting/export flows (19 checks). Run against a seeded local Postgres with `npm run
dev` already running.

## 13. Known gaps & deliberate non-goals

- **No R2/KV/D1 cache bindings.** Next's cache falls back to in-isolate memory. Fine for
  this app's traffic; revisit only if ISR/full-route caching across isolates becomes
  worth the extra binding.
- **D1 was considered and rejected** for the primary database — see §11. Postgres
  semantics matter for the reconciliation engine's correctness, and D1/SQLite would have
  meant re-verifying all of it.
- **`docs/payments.md` is referenced but doesn't exist.** A comment in
  `src/lib/stripe.ts` points to it ("see docs/payments.md") from early in the project;
  the file was never actually written. Worth creating or removing the reference.
- **No custom domain configured** — production currently lives at the default
  `*.workers.dev` URL.
- **Stripe is optional**, by design, not an oversight — see §5.

## 14. Maintainer runbook

### Add a schema change

```
# edit prisma/schema.prisma, then:
npx prisma migrate dev --name describe_the_change
# review the generated SQL in prisma/migrations/ before committing —
# data backfills for existing rows are not automatic
```

### Reseed local demo data

```
npx prisma db seed   # destructive — wipes and rebuilds the demo org only
```

### Deploy a change

```
git push origin claude/property-management-mvp-gjlizb
# Cloudflare Workers Builds picks it up automatically (watches this branch directly)
# Build command: npm run cf:build · Deploy command: npx wrangler deploy
```

### Run migrations against production

From a machine with real internet access:

```
$env:DATABASE_URL="<production connection string>"
npx prisma migrate deploy
```

### Add a new secret

```
npx wrangler secret put SOME_NEW_SECRET
```

### Changed a Cloudflare binding?

```
npm run cf:typegen   # regenerates cloudflare-env.d.ts — commit the result
```

### Rotate `AUTH_SECRET`

```
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
npx wrangler secret put AUTH_SECRET   # invalidates all existing sessions
```
