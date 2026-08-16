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
12a. [Search visibility](#12a-search-visibility-and-keeping-private-pages-out-of-the-index)
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

**Verified against live Sandbox:** this feature was originally built and unit-tested
(matching/filtering logic, and the webhook's cryptographic verification — both with real,
non-mocked crypto/logic) without ever completing a live connect-and-sync, because the
build session's network policy blocked outbound access to Plaid's API and CDN hosts
entirely. That gap has since been closed by hand against production comfylease.com: Link
opens, connects a Sandbox test bank, and the connection reaches "Connected" in Settings.
Production (real institutions, not Sandbox test banks) is still unverified.

**Settings → Rent collection → "Sandbox tools"** (rendered only when `plaidSandboxMode()`
— i.e. never on a deployment pointed at production Plaid) exists because Sandbox produces
no organic transaction activity and there's no other UI path to Plaid's webhook or
re-auth flows. Three buttons, backed by `simulateDepositAction` / `fireSyncWebhookAction` /
`forceReauthAction` in `bank-connection.ts`, which call Plaid's own `sandbox/*`
simulation endpoints (`simulateDeposit` / `fireSyncWebhook` / `resetItemLogin` in
`plaid.ts`) from the Worker rather than requiring anyone to script curl against Plaid by
hand: inject a fake transaction, fire a real signed `SYNC_UPDATES_AVAILABLE` webhook at
our own route, or force `ITEM_LOGIN_REQUIRED` to test the reconnect flow.

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

### Security headers and the CSP

Three static hardening headers live in `next.config.ts` (nosniff, frame-deny,
referrer-policy). The Content-Security-Policy can't be static because it carries a
per-request nonce, so it lives in **`src/middleware.ts`**, which also stamps the nonce onto
the request headers — that's how Next finds it and applies it to the script tags it
generates itself. The one inline script we write by hand (the theme script in
`src/app/layout.tsx`) reads the nonce out of `headers()` and sets it explicitly.

Three things to know before touching it:

- **Do not rename the file to `proxy.ts`.** Every build warns that `middleware` is
  deprecated in favour of it, and following that advice breaks the deploy outright: Next's
  `proxy.ts` always runs on the Node runtime, and `@opennextjs/cloudflare` refuses to bundle
  Node middleware, so `npm run cf:build` exits 1. `middleware.ts` still compiles to edge,
  which is what workerd runs.
- **`script-src` is nonce + `strict-dynamic`, with no `'unsafe-inline'`.** `strict-dynamic`
  is load-bearing rather than a loophole — Next loads its own chunks programmatically and
  Plaid Link injects `cdn.plaid.com` from JavaScript, and enumerating hashes for machinery
  that changes every build isn't maintainable.
- **A CSP failure is silent.** A blocked inline script doesn't surface an error to the user,
  it just doesn't run — dark mode would simply stop working. That's why `e2e:security` walks
  15 pages in a real browser listening for `securitypolicyviolation` and separately asserts
  the theme script still executes, rather than only checking the header's text.

Stripe needs nothing here: Checkout is a redirect to Stripe's own origin, not an embed.

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

Six suites in `e2e/`, 156 checks, run with `npm run e2e` (or one at a time — see
`e2e/README.md` for prerequisites and the non-obvious traps): the MVP flows (auth,
properties, leases, Stripe simulation, maintenance — 48), reconciliation and import (16),
reporting and exports (19), cross-org/security probes (26), password reset (14), and theming (33). They need a
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
migrates and seeds a fresh database, and runs all six e2e suites. Building through
OpenNext rather than plain `next build` is the point of that first job — the failures
unique to this deployment (a Node-only API reaching into a workerd isolate) only surface
in the bundling step.

## 12a. Search visibility (and keeping private pages out of the index)

Almost every page in this app renders somebody's private records, so the first job of the
SEO setup is **exclusion**, not promotion. Only four routes are ever meant to be indexed —
`/`, `/signup`, `/login`, `/forgot-password` — and they're listed in `PUBLIC_ROUTES` in
`src/lib/site.ts`.

**Three independent layers keep everything else out**, because a rent ledger or a live
password-reset link in a search result is a breach, not a ranking problem:

| Layer | File | Covers |
|---|---|---|
| `robots.txt` | `src/app/robots.ts` | Asks well-behaved crawlers not to fetch. Cannot stop indexing of a URL someone else links to. |
| `robots: noindex` metadata | `src/app/{app,portal,owner}/layout.tsx`, the two `[token]` pages | HTML pages. Set on the *layouts*, so a page added later is private by default. |
| `X-Robots-Tag` header | `next.config.ts` | Everything, including non-HTML — notably the CSV exports under `/api/export/*`, which have nowhere to put a meta tag. |

All three read `PRIVATE_PATH_PREFIXES` from `src/lib/site.ts`, so they can't drift apart.
Underneath all of them, every one of those routes also requires a session.

The `/invite/[token]` and `/reset-password/[token]` pages get the strictest treatment
(`noindex, nofollow, noarchive, nosnippet`) plus `Referrer-Policy: no-referrer`, because
the token in the URL *is* a credential — the default `strict-origin-when-cross-origin`
would put a working reset token in our own access logs on every asset request.

### The domain move (in progress)

`comfylease.com` is registered at Namecheap. Until it is serving the app, this section's
work is capped by the same thing that caps outbound email: `*.workers.dev` is a shared
platform domain, and no amount of on-page work makes a subdomain of someone else's domain
rank like your own.

The canonical host is the **apex**, `comfylease.com`; `www` 301s to it via a Cloudflare
Redirect Rule rather than application code, so only one host is ever indexable.

Remaining steps, in order — the first two are the long pole because nameserver propagation
is not instant:

1. Add `comfylease.com` as a zone in the Cloudflare account that holds this Worker.
2. At Namecheap, switch **Nameservers** from `Namecheap BasicDNS` to the two Cloudflare
   nameservers the zone setup gives you. The existing Namecheap "Redirect Domain" rule
   (apex → www) stops applying at that point, which is intended — it's replaced by the
   Redirect Rule in step 5, pointing the other way.
3. Workers → this Worker → Settings → Domains & Routes → add `comfylease.com` as a custom
   domain.
4. **Add `comfylease.com` to the existing Cloudflare Access application.** Access policies
   are bound per hostname: the app protecting `*.workers.dev` does *not* cover a new
   custom domain, so skipping this publishes the whole app.
5. Add a Redirect Rule: `www.comfylease.com/*` → `https://comfylease.com/$1`, 301.
6. Set `APP_URL` in `wrangler.jsonc` `vars` to `https://comfylease.com` — **only once the
   domain actually serves the app.** It is not just cosmetic: it builds Stripe Connect's
   return URLs and the webhook URL registered with Plaid, so pointing it at a host that
   doesn't resolve breaks both.

Then email becomes possible — see §8 and the transport notes in `src/lib/email.ts`.

### Why robots.txt and sitemap.xml are `force-dynamic`

They contain absolute URLs built from `APP_URL`, which reaches production as a **runtime**
`vars` binding in `wrangler.jsonc` and is therefore *absent during the build*. Prerendered,
they shipped a sitemap advertising `http://localhost:3000/` — verified, not theoretical.
Rendering per request costs one trivial render on a URL that's requested a few times a day
and stays correct through a domain move with no build configuration to remember. The root
layout's `generateMetadata()` is a function for the same reason.

**On a domain move, change `APP_URL` in `wrangler.jsonc` and nothing else.** Canonicals,
`og:url`, the sitemap, `robots.txt` and the JSON-LD `@id`s are all derived from it.

### What's deliberately absent

- **No Open Graph image.** `next/og` renders one at runtime but pulls Satori + a resvg WASM
  binary into the Worker bundle, and the bundle-size headroom here isn't measurable from
  outside a deploy. It buys nothing for ranking (og:image is not a ranking signal, only a
  link-preview one), so it wasn't worth risking deployability. Worth adding as a designed
  static asset when the real brand lands.
- **No `aggregateRating`, `review` or `offers` in the JSON-LD.** There are no ratings and
  pricing isn't settled; inventing either to win a rich result is how sites lose rich
  results.
- **No blog or content marketing surface.** That's a content decision, not a code one.

## 13. Known gaps & deliberate non-goals

- **No R2/KV cache bindings.** Next's cache falls back to in-isolate memory. Fine for
  this app's traffic; revisit only if ISR/full-route caching across isolates becomes
  worth the extra binding.
- **Postgres (Neon) + Hyperdrive was tried first and abandoned** — see §2 and §11. The
  reconciliation engine doesn't lean on any Postgres-only semantics (confirmed before the
  switch: no raw SQL, no Postgres-native column types), so moving to D1/SQLite didn't
  require re-verifying its correctness — only re-running the existing test suites, which
  passed unchanged.
- **Custom domain registered but not yet serving.** `comfylease.com` is bought;
  production still answers on the default `*.workers.dev` URL until the steps in §12a are
  done. Three things are waiting on it: outbound email (Cloudflare Email Service can only
  send from a domain you've onboarded — §8), search visibility (a shared platform
  subdomain cannot rank like a domain you own — §12a), and zone-level Cloudflare features
  (rate limiting rules, bot protection, WAF) which need a domain in your own account.
  No code changes are needed beyond `APP_URL`.
- **Stripe is optional**, by design, not an oversight — see §5 and `docs/payments.md`.
- **Point-in-time restore takes the schema with it.** D1's Time Travel restores the whole
  database, structure included — so restoring to a bookmark from before a migration ran
  drops those tables, not just their rows. That's how a production database ended up with
  no tables at all, which reads as "login is broken and signup doesn't work". Recovery is
  `npm run cf:migrate` (§14). Never rehearse a restore against the real database; use a
  throwaway one. Recovering by pasting SQL has its own cost, since it leaves the migration
  ledger empty — see "If the ledger and the schema disagree" in §14.
- **The Plaid bank feed (§5) has now completed a live Sandbox connect-and-sync**, by hand,
  against production comfylease.com — Link opens, the phone-verification step Plaid's
  widget shows in Sandbox is expected and clears on its own, and a connected Item reaches
  "Connected" in Settings. It still hasn't been exercised against a *real* institution —
  only Sandbox test banks so far — so treat production Plaid access as unverified until
  that happens too.
- **Rate limiting fails open.** Login, signup and password reset go through the Workers
  `ratelimit` bindings in `wrangler.jsonc` (`src/lib/rate-limit.ts`), but if the limiter
  throws or the binding is absent the request is allowed. That's deliberate — a limiter
  outage must not become a login outage — with the consequence that local `next dev` has no
  throttling at all, and `e2e:security` reports that as expected rather than as a pass.
- **`style-src` still allows `'unsafe-inline'`.** The CSP (`src/middleware.ts`) is
  nonce-based for scripts, which is where account takeover lives, but Next injects inline
  `<style>` with no nonce plumbing available. Injected CSS can restyle a page and read
  attribute values; it can't execute. Accepted, not overlooked.
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
`d1_migrations` table inside the database.

**Normally you don't run anything.** `.github/workflows/d1.yml` applies outstanding
migrations whenever a commit changes `migrations/`, so a schema change ships with the code
that needs it. Ordinary commits don't touch the database — that's what the workflow's
`paths` filter is for, and it matters here because the default branch is also the working
branch.

For anything on demand — checking status, listing the tables that actually exist, forcing
an apply, taking a backup — use **Actions → D1 → Run workflow** and pick from the dropdown.
Each run writes a summary you can read on a phone, which is the point: recovering the
database shouldn't require a laptop. Anything that can modify the database exports a backup
first and attaches it to the run, kept 90 days.

That workflow needs one secret, `CLOUDFLARE_API_TOKEN`, scoped to **Account → D1 → Edit**
and nothing else — narrow enough that a leak can't deploy code or read other resources.
Add `CLOUDFLARE_ACCOUNT_ID` alongside it. Without the token the workflow fails immediately
with the setup steps in its summary rather than a wall of auth errors.

From your own machine (needs `npx wrangler login`, or `CLOUDFLARE_API_TOKEN` in the
environment):

```
npm run cf:migrations:status     # what's applied vs outstanding
npm run cf:migrate               # sync from Prisma, then apply what's missing
```

Safe to re-run — anything already applied is skipped ("No migrations to apply!").

`npm run cf:migrate:local` does the same against the local Miniflare D1, which is a good
way to rehearse a migration before it touches production.

#### If the ledger and the schema disagree

This has happened once, and the symptom is confusing enough to be worth recognising:
`migrations list` reports **every** migration as outstanding while the tables plainly
already exist. That's what applying SQL by hand leaves behind — the console creates the
tables and writes nothing to `d1_migrations`. Running `apply` in that state starts at the
first migration, hits `CREATE TABLE "Organization"` on a table that exists, and stops
without applying anything newer. It fails safely, but it fails.

The fix is to record the already-applied migrations in the ledger so `apply` skips them —
but only after establishing that the live schema really is what those migrations produce.
Table names aren't enough; a hand-pasted schema can have every table and still be missing
indexes, and the ledger is what you'd normally consult. So:

1. Run the workflow's `schema` action to dump the live schema (`--no-data`).
2. Build a reference locally from scratch — `npm run cf:migrate:local`, then
   `npx wrangler d1 export <db> --local --no-data` — and diff the two.
3. If the only differences belong to migrations you know haven't run, backfill the ledger
   for the rest. `scripts/d1-repair-ledger.sql` is the instance of this that was actually
   needed, with its reasoning; use it as a model, don't extend it.
4. Then `apply`, and confirm the table count moved.

Watch for one trap in step 2: an extraction regex over object names must allow digits, or
`d1_migrations` silently drops out of one side of the diff and looks like drift.

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
