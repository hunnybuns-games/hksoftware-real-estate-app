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
Workers with a native D1 (SQLite) database — see [§11](#11-deploying-cloudflare-specifics).

## 2. Architecture at a glance

```
browser
  │
  ▼
Next.js 16 App Router  (Server Components, Server Actions, Route Handlers)
  │
  ├─ Auth.js v5          credentials login, JWT session, role + org on the token
  ├─ Prisma 6 + driver adapter   never the native query-engine binary
  ├─ Stripe Connect       Express accounts, destination charges
  └─ RBAC guards          every query scoped by organizationId
  │
  ▼
D1 (SQLite) — native Cloudflare Workers binding, no network hop
```

Nothing here is exotic. The one deliberate architectural constraint, threaded through
everything: **Prisma never uses its native query-engine binary** — it's configured with
`engineType = "client"` and always constructed with an explicit adapter (`@prisma/adapter-d1`
in production, `@prisma/adapter-better-sqlite3` everywhere else). That's not a style
preference, it's load-bearing: the native engine can't run inside a Cloudflare Workers
isolate at all, so the app would only run on Vercel/Node otherwise. See `src/lib/db.ts`.

> **This app previously ran on Postgres (via Neon) behind Cloudflare Hyperdrive.** That
> setup hit persistent, unresolved connection reliability issues in production — timeouts
> that got worse, not better, as the pool/timeout configuration was tuned, eventually
> traced to Hyperdrive itself failing to reliably reach the origin database. Rather than
> keep chasing that, the database was switched to D1, which removes the failure mode
> entirely: no external host, no pooling between two separate services, nothing to
> misconfigure pooled-vs-direct. If you're reading old comments or commit history that
> mention Postgres/Neon/Hyperdrive, that's why they're gone.

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
| `import_plaid` | Owner's connected bank feed, synced automatically — see below |

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

Stripe and the bank feed below solve different problems and are both optional
independently of each other: Stripe collects rent **from** a tenant; the bank feed reads
what's already landed in the owner's account **from anywhere** (a deposited check, a
Venmo/Cash App cash-out, a subsidy direct deposit) without anyone re-typing it.

### Plaid bank feed (owner's receiving account)

An org's admin connects the bank account they receive rent into (org settings → Rent
collection → Bank feed), via [Plaid](https://plaid.com/docs/transactions/) Transactions —
read-only, revocable, no bank credentials ever touch this app's servers. From then on,
new transactions sync automatically and get turned into `Payment` rows the same way a CSV
import row does.

- **`src/lib/plaid.ts`** — thin wrapper matching `stripe.ts`'s shape (`plaidEnabled` gate,
  lazy client, `createLinkToken`/`exchangePublicToken`/`syncTransactions`/etc.). Plaid's
  Node SDK builds its calls on axios, whose default adapter reaches for `node:http` —
  same problem Stripe's SDK had — fixed the same way, with axios's fetch adapter.
  Normalizes Plaid's inverted amount sign (positive = money **out**) to this app's
  convention (positive = money **in**) in one place.
- **`src/lib/token-encryption.ts`** — AES-256-GCM via the Web Crypto API. The stored
  access token (`BankConnection.accessTokenEncrypted`) grants ongoing read access to the
  org's real bank transactions for as long as the connection stays active, not a
  single charge — meaningfully more sensitive than anything else this app stores, so
  it's encrypted at rest with its own key (`BANK_TOKEN_ENCRYPTION_KEY`), separate from
  `AUTH_SECRET`.
- **`src/actions/bank-connection.ts`** + **`.../settings/payments/_components/bank-connect-button.tsx`**
  — connect/disconnect. Unlike Stripe Connect's redirect-based onboarding, Plaid Link is
  a client-side widget the browser has to drive directly (`react-plaid-link`), so this is
  the one payment-integration flow in the app that isn't a plain `<form action>`.
- **`src/lib/plaid-sync.ts`** — `syncBankConnection()` does the actual work: pulls new
  transactions since the connection's last cursor, decides what to do with each one (skip
  debits/zero-amounts/already-synced, match against a lease via the same
  `suggestLeaseMatch()` CSV import uses, create/update/delete the corresponding
  `Payment`), then recomputes reconciliation for every lease touched. The decision logic
  (`decideAddedTransaction`, `decideModifiedTransaction`) is split out as pure functions
  from the DB-touching orchestration — same split as `computeReconciliation` /
  `applyReconciliation` — specifically so it's unit-testable without a database.
- **`src/lib/plaid-webhook.ts`** + **`src/app/api/plaid/webhook/route.ts`** — Plaid signs
  webhooks with a rotating-key JWT (ES256), not a static secret like Stripe's, so
  verification means fetching Plaid's JWK by the JWT's `kid`, checking the signature,
  checking `iat` freshness, and checking the JWT's body-hash claim against the actual
  raw request body — implemented directly against Web Crypto rather than a JWT library.
  `SYNC_UPDATES_AVAILABLE` triggers a sync; `ITEM_LOGIN_REQUIRED` flips the connection to
  needing reconnect (a bank forcing periodic re-auth is normal, expected behavior, not an
  error state to alarm anyone over).

**A gap worth knowing about:** this feature was built and unit-tested (matching/filtering
logic, and the webhook's cryptographic verification — both with real, non-mocked
crypto/logic, just no live network) without ever completing a live connect-and-sync
against Plaid's actual Sandbox — the build session's sandbox blocked outbound access to
Plaid's API and CDN hosts entirely. Everything that could be verified without a live
Plaid connection was; the actual "click Connect, log into Plaid's fake Sandbox bank, see
a transaction land on the Rent page" walkthrough still needs to happen once, by a human,
somewhere with real internet access, before trusting this in production.

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
notes, and photos. **Photos are stored as blobs directly in the database**
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

### Outbound email

`src/lib/email.ts` picks one of three transports, in order:

1. **Cloudflare Email Service**, via the `EMAIL` `send_email` binding in
   `wrangler.jsonc`. The default, because it keeps everything on the account we already
   pay for — no third-party signup, no API key to store or rotate, 3,000 sends a month
   included and $0.35 per 1,000 after. It takes `text` and `html` directly, so there's no
   MIME construction and no `mimetext` dependency.
2. **Resend**, if `RESEND_API_KEY` is set. Kept as an escape hatch, not a recommendation.
3. **Logged** — nothing is delivered; every message lands in `NotificationLog` and is
   visible at `/app/settings/outbox`. This is the local-dev and demo default, and it's
   what the e2e suites read invitation links out of.

**`EMAIL_FROM` is the real switch, not the provider.** Unset (or left as the
`notifications@example.com` placeholder) the transport goes straight to logging, because
without a verified sending address there is nothing any provider will accept — trying
anyway would just fill the log with `E_SENDER_DOMAIN_NOT_AVAILABLE`.

Two account-level things gate real delivery, and switching providers avoids neither:

- **A sending domain onboarded to Email Service.** Until then Cloudflare delivers only to
  *verified destination addresses* in the account — your own inbox. Enough to test the
  flow, not enough to mail a resident. Resend imposes the same requirement.
- **The Workers Paid plan.** Sending to arbitrary recipients isn't available on Free at
  all. Sends to verified destination addresses are free on any plan.

`describeEmailError` translates Cloudflare's error codes into a next step before they're
recorded, since the two anyone hits first (`E_SENDER_NOT_VERIFIED`,
`E_SENDER_DOMAIN_NOT_AVAILABLE`) mean "finish setting up the domain" and read as a broken
app otherwise. Unit-tested in `src/lib/__tests__/email.test.ts`.

One trap worth knowing: mail sent through the binding appears as **dropped** in the Email
Routing summary even when it was delivered fine. Outbound sends are tracked under Email
Sending metrics instead.

## 9. File map

| Path | What's there |
|---|---|
| `prisma/schema.prisma` | The whole data model, 29 models/enums (SQLite dialect — see §11) |
| `prisma/migrations/` | Hand-reviewed SQL migrations — see [§14](#14-maintainer-runbook) before writing one by hand |
| `prisma/seed.ts` | Demo data generator — one realistic 34-unit portfolio |
| `src/lib/` | Framework-free domain logic: `ledger.ts` (balance/lateness math), `reconciliation.ts`, `rent-split.ts`, `reports.ts`, `csv.ts`, `import-mapping.ts`, `lease-matching.ts`, `rbac.ts`, `db.ts`, `stripe.ts`, `plaid.ts`, `plaid-sync.ts`, `plaid-webhook.ts`, `token-encryption.ts`, `auth.ts` |
| `src/actions/` | Server Actions, one file per domain area (leases, payments, tenants, properties, maintenance, import, expenses, team, org, bank-connection) |
| `src/app/app/` | Staff-facing app (`requireStaff`-gated): dashboard, properties, leases, payments/import, reports, maintenance, tenants, settings |
| `src/app/owner/` | Owner portal (`requireOwner`-gated): financials-only dashboard + statements |
| `src/app/portal/` | Tenant portal (`requireTenant`-gated): lease, payments, maintenance |
| `src/app/api/export/` | CSV export Route Handlers: rent-roll, property-pl, payments, charges |
| `src/app/api/cron/rent-run/` | The daily job (§8) |
| `src/app/api/stripe/webhook/`, `src/app/api/plaid/webhook/` | Payment-provider webhook Route Handlers |
| `src/worker/index.ts` | Cloudflare Worker wrapper — adds the cron `scheduled()` handler around the generated OpenNext worker |
| `src/lib/__tests__/` | vitest unit tests — csv, import, ledger, reconciliation, plaid-sync, plaid-webhook |

### Theming (read this before adding colour to a screen)

`src/app/globals.css` is the whole design system: one accent, a dozen component classes,
and the light/dark palettes. Two things there will surprise you if you don't know them:

- **`slate-*` is this app's neutral scale, and it is theme-aware.** `--color-slate-*` is
  redefined to point at runtime variables that flip in dark mode, so `text-slate-500`,
  `border-slate-200` and `divide-slate-100` already work in both themes with no `dark:`
  variant. In light mode the values are Tailwind's slate exactly, so nothing about the
  original design changed. Use slate for neutrals and dark mode comes free; the scale is
  not simply mirrored, because `bg-slate-50` (a recessed row) and `border-slate-200` (a
  rule) have to move in *opposite* directions relative to a card.
- **Accent colours are not remapped and do need `dark:`.** Each of red/amber/emerald/brand
  is used both as a light tint behind dark text and as a saturated fill behind white text —
  `text-red-700` is body copy on a pink panel while `bg-red-700` is a destructive button —
  and one variable can't be both. The house recipe for a tinted panel in dark mode is a
  translucent `-500` wash for the fill and ring plus `-200`/`-300` text; `src/components/ui.tsx`
  has it in one place for badges and banners.
- **Raised surfaces are `bg-surface`, not `bg-white`.** Cards, inputs, the sidebar. "White"
  was never the intent — "the layer above the page" was.

`npm run e2e:theme` enforces all of this; see [§12](#12-testing).

## 10. Environments & configuration

Local development never touches Cloudflare at all — `npm run dev` is plain `next dev`
against a local SQLite file. That's a deliberate choice (see
[§11](#11-deploying-cloudflare-specifics)), not an oversight: everyday development stays
exactly as fast and simple as a normal Next.js app, and there's no database server to
start at all.

| Name | Required | Where it's set |
|---|---|---|
| `DATABASE_URL` | Always | `.env` locally (`file:./dev.db`, resolved relative to `prisma/` — see §14); not used in production (D1 takes over — see §11) |
| `AUTH_SECRET` | Always | `.env` locally; `wrangler secret put` in production |
| `AUTH_URL` / `APP_URL` | Always | `.env` locally; `wrangler.jsonc` `vars` in production (your real origin) |
| `CRON_SECRET` | For the rent-run job | `wrangler secret put` |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Only if using Stripe | `wrangler secret put` |
| `PLAID_CLIENT_ID` / `PLAID_SECRET` | Only if using the bank feed | `wrangler secret put` |
| `PLAID_ENV` | Only if using the bank feed | `.env` locally / `wrangler.jsonc` `vars` — `sandbox` (default) or `production`, not a secret |
| `BANK_TOKEN_ENCRYPTION_KEY` | Required alongside the two Plaid secrets | `wrangler secret put` — `openssl rand -base64 32` |
| `USE_D1` | Production only | `wrangler.jsonc` `vars` — not a secret, just a switch (see §11) |

## 11. Deploying (Cloudflare specifics)

Production target is **Cloudflare Workers**, via the
[OpenNext adapter](https://opennext.js.org/cloudflare) — the full App Router app (Server
Actions included), not a static export. Database is **D1** (Cloudflare's own SQLite),
accessed through a native Workers binding (`env.DB`) — no connection string, no network
hop, no connection pool to manage.

```
wrangler.jsonc          Worker config: assets, D1 binding, cron trigger
open-next.config.ts     OpenNext build config (defaults — no extra cache bindings)
src/worker/index.ts     Wraps the generated worker to add the cron scheduled() handler
cloudflare-env.d.ts     Generated types for the Worker's env bindings — committed,
                        regenerate with `npm run cf:typegen` after changing bindings
```

`npm run cf:build` / `cf:preview` / `cf:deploy` are the three you'll actually use —
build-only, local workerd preview, and build-then-deploy.

> **Gotcha — Prisma's native engine can't run in a Worker at all.** `engineType =
> "client"` in `schema.prisma`, plus an explicit adapter everywhere a `PrismaClient` gets
> constructed (`src/lib/db.ts` and `prisma/seed.ts` both — `@prisma/adapter-d1` in
> production, `@prisma/adapter-better-sqlite3` locally). This isn't optional under this
> setup — without an adapter, construction throws, because there's no embedded engine to
> fall back to.

> **Gotcha — `@prisma/client`'s bare import resolves to the wrong runtime on Workers.**
> Its default export goes through a conditional exports map keyed on platform ("node" vs
> "workerd" vs "edge-light", ...), and that resolution has picked the Node-oriented
> runtime on Cloudflare before — which tries to read the WASM query compiler off a real
> filesystem, and Workers has none. The fix isn't a build flag: `src/lib/db.ts` imports
> *both* `@prisma/client` and `@prisma/client/wasm.js` explicitly and picks between them
> at runtime with the `USE_D1` signal, rather than trusting the package's own platform
> detection. Neither variant works on both platforms in this toolchain — each is only
> correct on the one it was built for.

> **Gotcha — the Prisma CLI and this app's own runtime resolve a relative sqlite `file:`
> path differently.** The CLI (`prisma migrate`/`db seed`) resolves it against
> `prisma/schema.prisma`'s own directory; `better-sqlite3` (what the app's runtime client
> actually uses) resolves it against the process's cwd, like any normal Node file access.
> Left alone, `prisma migrate dev` and the app end up silently pointed at two different
> files. `src/lib/db.ts` and `prisma/seed.ts` both replicate the CLI's resolution rule
> explicitly (`localSqliteUrl()`) so they always agree.

**Prefer not to deal with any of this?** The app runs as a completely ordinary Next.js
server with none of the above — `npm run build && npm run start` against any reachable
`DATABASE_URL`, no OpenNext/wrangler involved at all (you'd need to point `DATABASE_URL`
at a real database again in that case, since a plain Node server can't reach a D1
binding — see the retired Postgres+Hyperdrive setup in git history if you want that
path back). The repo also still has a `vercel.json` from before this Cloudflare work —
Vercel hosts Next.js natively with no bundle-size fight. Worth considering if "Cloudflare
specifically" isn't a hard requirement.

## 12. Testing

Two layers, and both are meant to be re-run after any change that touches billing, auth,
or reconciliation — not just before a release.

### Unit — `npm test` (vitest)

- `ledger.test.ts` — balance and lateness math
- `reconciliation.test.ts` — the FIFO engine, including the combined-total HAP rule from
  §6, hand-traced
- `import.test.ts` — column-mapping guesses, bad-row detection, lease matching
- `csv.test.ts` — the parser/writer itself
- `plaid-sync.test.ts` — the pure decision functions behind the bank feed (§5): deposit
  filtering, unambiguous vs. no match, idempotency, and the modified/removed transitions
  (including the "don't silently override a human's lease correction" case)
- `plaid-webhook.test.ts` — real ES256 sign/verify through the actual Web Crypto API this
  app uses in production (only the network call to fetch Plaid's public key is mocked):
  accepts a correctly signed fresh webhook, rejects a missing header, a malformed JWT, a
  tampered body, a forged signature, a stale `iat`, and an unexpected algorithm

### End-to-end (Playwright)

Five suites in `e2e/`, 132 checks, run with `npm run e2e` (or one at a time — see
`e2e/README.md` for prerequisites and the non-obvious traps): the MVP flows (auth,
properties, leases, Stripe simulation, maintenance — 48), reconciliation and import (16),
reporting and exports (19), cross-org/security probes (16), and theming (33). They need a
seeded local database (`npm run db:migrate && npm run db:seed`) and `npm run dev` already
running.

`theme.mjs` is worth knowing about because it isn't a click-through script. Most of it is
one function, `auditDarkSurfaces`, walking every rendered element on a page and flagging
anything still painting an opaque light background or near-black text while the page is in
dark mode. That's what makes dark mode maintainable across ~50 files: adding a screen that
hardcodes a light colour fails a check instead of quietly shipping. Two details that keep
it honest —

- It **self-tests**. Before trusting a run of clean results it points the same function at
  the dashboard in *light* mode, where white cards are correct and plentiful, and requires
  it to find problems. "0 problems everywhere" is also what a broken audit reports.
- Every audited page must **prove it rendered** (real text, real element count, no 404 or
  error boundary) before its colour result counts. An empty page passes a colour audit
  trivially; the first version of this suite gave a clean PASS for `/portal/payments`,
  which doesn't exist.

### CI

`.github/workflows/ci.yml` runs on every push and pull request: one job for
typecheck/lint/unit-tests plus the real `cf:build`, and a second that installs Chromium,
migrates and seeds a fresh database, and runs all five e2e suites. Building through
OpenNext rather than plain `next build` is the point of that first job — the failures
unique to this deployment (a Node-only API reaching into a workerd isolate) only surface
in the bundling step.

## 13. Known gaps & deliberate non-goals

- **No R2/KV cache bindings.** Next's cache falls back to in-isolate memory. Fine for
  this app's traffic; revisit only if ISR/full-route caching across isolates becomes
  worth the extra binding.
- **Postgres (Neon) + Hyperdrive was tried first and abandoned** — see §2 and §11. The
  reconciliation engine doesn't lean on any Postgres-only semantics (confirmed before the
  switch: no raw SQL, no Postgres-native column types), so moving to D1/SQLite didn't
  require re-verifying its correctness — only re-running the existing test suites, which
  passed unchanged.
- **No custom domain configured** — production currently lives at the default
  `*.workers.dev` URL. This also blocks zone-level Cloudflare features (rate limiting
  rules, bot protection, WAF) which need a domain in your own account.
- **Stripe is optional**, by design, not an oversight — see §5 and `docs/payments.md`.
- **Point-in-time restore takes the schema with it.** D1's Time Travel restores the whole
  database, structure included — so restoring to a bookmark from before a migration ran
  drops those tables, not just their rows. That's how a production database ended up with
  no tables at all, which reads as "login is broken and signup doesn't work". Recovery is
  `npm run cf:migrate` (§14). Never rehearse a restore against the real database; use a
  throwaway one.
- **The Plaid bank feed (§5) has never completed a live Sandbox connect-and-sync.** It was
  built and unit-tested with real logic/crypto but no live network access to Plaid at all
  (the build session's network policy blocked Plaid's API and CDN hosts outright). Do the
  actual Link-connect-sync walkthrough by hand once, somewhere with real internet access,
  before trusting this with anyone's real bank account.
- **No rate limiting on login/signup.** Flagged during a security review; bcrypt's cost
  factor slows brute-forcing somewhat but there's no lockout. Best fixed at the Cloudflare
  edge (a Rate Limiting rule, or the Workers-native `ratelimit` binding, GA since September
  2025) rather than in application code — see the review notes in git history around
  where this was found for the fuller writeup.
- **No security headers beyond the three baseline ones in `next.config.ts`** (nosniff,
  frame-deny, referrer-policy). No CSP — one worth having needs to be built against this
  app's actual script/style/connect sources and verified page by page, not guessed at.
  Note that Plaid Link injects a script from `cdn.plaid.com` and opens an iframe, so that
  has to be accounted for.
- **Removing a team member doesn't revoke their session.** Sessions are stateless 30-day
  JWTs and the guards read role/organization straight from the token without consulting
  the database, so a deleted user's existing token keeps working — with full access to the
  organization they were removed from — until it expires. Demoting an admin has the same
  lag. The most serious open item in this file; see item 10 in the production punch list.
- **No password reset.** A locked-out landlord has no recovery path, and neither do you
  short of editing a password hash in D1 by hand. The `Invitation` model already shows the
  token pattern to copy.
- **No error tracking or uptime monitoring.** Errors go to `console.error` — i.e. Workers
  logs, unretained by default — and the reference number shown on the error page
  corresponds to nothing lookup-able. A silently failing integration is the most likely way
  this app hurts someone: rent quietly stops being recorded and nobody notices for weeks.
- **Maintenance photos are blobs in D1.** Up to 5 × 4 MB per request, against a 500 MB
  (free) or 10 GB (paid) per-database ceiling. Deliberate simplification for shipping; R2
  is the destination, and `canViewPhoto`'s authorization check carries over unchanged.
- **No legal pages.** No Terms of Service, no Privacy Policy — both are also prerequisites
  for Plaid and Stripe production access, so this blocks going live regardless.

## 14. Maintainer runbook

### Add a schema change

```
# 1. edit prisma/schema.prisma, then:
npm run db:migrate -- --name describe_the_change

# 2. project it into the layout Wrangler applies from, and commit both:
npm run cf:migrations:sync

# review the generated SQL before committing — data backfills for existing
# rows are not automatic
```

Both `prisma/migrations/<timestamp>_<name>/migration.sql` **and**
`migrations/<timestamp>_<name>.sql` are committed. Prisma is what you author with;
the flat copy is what Wrangler applies. `npm run cf:migrations:check` runs in CI and
fails if they drift, so you can't ship one without the other.

Never edit a migration that has already been applied. Wrangler identifies applied
migrations by filename, so an edit is never re-run — production keeps the old schema
with no warning. The sync script refuses this outright; add a new migration instead.

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

D1 doesn't take `prisma migrate deploy` — there's no connection string to point it at.
Wrangler applies them instead, and keeps a ledger of what it has already run in a
`d1_migrations` table inside the database:

```
npm run cf:migrations:status     # what's applied vs outstanding
npm run cf:migrate               # sync from Prisma, then apply what's missing
```

Safe to re-run — anything already applied is skipped ("No migrations to apply!").
Requires Cloudflare auth (`npx wrangler login`, or `CLOUDFLARE_API_TOKEN`).

`npm run cf:migrate:local` does the same against the local Miniflare D1, which is a
good way to rehearse a migration before it touches production.

> **This replaced applying SQL by hand**, which had no record of what had run. That
> gap cost real downtime twice: once when a deployed page queried a table that was
> never created, and once when a point-in-time restore rolled the schema away and
> recovery meant hand-writing a rescue script. With the ledger, recovery is just
> `npm run cf:migrate`.

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
