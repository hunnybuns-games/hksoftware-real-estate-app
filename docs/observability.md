# Error tracking & uptime monitoring

Before this, an unhandled error went to `console.error` and nowhere else —
whatever ran it (a Server Action, a cron route, the scheduled worker) tore
down its isolate right after, and the log line went with it. Nobody found
out unless a tenant or landlord happened to say something. This is the
framework that closes that gap. See "What's deliberately not here" before
assuming it's a full Sentry replacement — it isn't.

## What it is

**Logging.** `observability.enabled: true` in `wrangler.jsonc` turns on
Cloudflare Workers Logs — every `console.log`/`console.error` from every
request, kept and searchable in the dashboard (Workers & Pages → this
Worker → Logs) for the plan's retention window. No third-party account, no
code change beyond the one config line, because every error path in this
app already calls `console.error` — this just stops those lines from being
thrown away.

**Alerting.** `src/lib/error-reporting.ts` exports `reportServerError(context,
err)`: always logs via `console.error` first, then — only if
`ERROR_ALERT_EMAIL` and a configured `EMAIL_FROM` both exist — sends a
best-effort email through the same transport `src/lib/email.ts` uses
(Cloudflare Email Service, falling back to Resend). It's wired into:

- `runAction()` in `src/lib/forms.ts` — the catch-all every Server Action
  goes through, so an unhandled failure anywhere in the app (a bug, a
  Prisma error, D1 being unreachable) triggers an alert, not just a log
  line nobody's watching.
- `/api/cron/rent-run` and `/api/cron/bank-sync` — per-organization and
  per-connection, inside the loop each route already had (or, for
  rent-run, now has — see below) to keep one bad record from taking down
  everyone else's run. One alert per failure, not one for the whole night.
- `src/worker/index.ts`'s `scheduled()` handler — the outermost catch
  around each cron self-request, in case a route fails in a way that never
  reaches its own try/catch (a non-2xx response, a thrown network error).
- `/api/report-error` — see "Client-side errors" below.

**Client-side errors.** `error.tsx` and the new `global-error.tsx` (which
catches a failure in `layout.tsx` itself — `error.tsx` alone only covers
its children) both `console.error` in the browser, which was always a dead
end: nothing server-side ever saw it. Both now also call
`reportClientError()` (`src/lib/report-client-error.ts`), a fire-and-forget
`POST /api/report-error` carrying the message, stack, digest, and page
path. The route re-uses `reportServerError()`, so a client-side render
crash shows up in Workers Logs and triggers the same alert email a server
error would.

**Uptime.** `GET /api/health` — unauthenticated, runs `SELECT 1` through
Prisma, returns `200 {"status":"ok"}` or `503 {"status":"error"}`. Checks
the database deliberately, not just "did the Worker respond": a Worker can
answer while D1 is unreachable, which is the actual failure mode worth
catching, not a hypothetical one — see the CRON_SECRET issue below, which
this framework exists partly because of.

## Setting it up (nothing here happens automatically)

1. **Deploy** — `observability.enabled` takes effect on the next
   `wrangler deploy`. Nothing to turn on in the dashboard.
2. **Set `ERROR_ALERT_EMAIL`** as a Worker var in `wrangler.jsonc`'s `vars`
   block (see the comment near the bottom of that file) if you want alert
   emails, not just logs. It only reaches a *verified destination address*
   until Cloudflare Email Service's Paid-plan gating clears — same limit
   `EMAIL_FROM` already has, see `src/lib/email.ts`.
3. **Point an external uptime pinger at `/api/health`.** This app has no
   monitor of its own that checks *itself* — if the Worker is fully down,
   nothing inside it can report that. [UptimeRobot](https://uptimerobot.com)
   has a free tier that's enough for this: a 5-minute HTTP check against
   `https://comfylease.com/api/health` expecting `200`, alerting by email or
   SMS on failure. Any similar service works the same way — this app has no
   opinion on which one, it just needs something outside Cloudflare doing
   the asking.

   **Blocked as of 2026-08-23**: the Cloudflare Access guard on
   comfylease.com (see `docs/ROADMAP.md`, Phase 1) currently covers
   `/api/health` too — a plain `curl` gets a `302` to the Access login page,
   not a `200`. An uptime monitor pointed at it today would either fail
   permanently or, worse, read the login page's own status as "up" and never
   catch a real outage. Two ways forward: carve out an Access policy
   exception for `/api/health` specifically (bypass rules by path are a
   normal Access pattern; needs the dashboard or an API token scoped for
   Access, which the one this was checked with isn't), or just wait — the
   guard is coming off anyway once Phase 1's legal/entity items land, and
   this becomes moot at that point.

## A bug this work found along the way

While wiring this up: `CRON_SECRET` is unset in production. `isCronAuthorized()`
(`src/lib/cron-auth.ts`) refuses every request without it, so the nightly
rent run and bank sync have been 401ing — silently, since nothing was
watching — every night. See `docs/MAINTAINER.md` for the fix
(`npx wrangler secret put CRON_SECRET`). Worth calling out here specifically
because it's the exact kind of failure this framework is meant to catch:
until `ERROR_ALERT_EMAIL` is set and the fix above is applied, it's still
failing silently — this doc alone doesn't fix it.

## What's deliberately not here

- **No dedupe on alert emails.** `sendEmail()`'s normal dedupe-then-record
  path is a database round trip, and an alert whose entire reason for
  existing is "something broke, maybe the database" can't depend on the
  database being reachable to send it (see the comment at the top of
  `error-reporting.ts`). The cost: a real outage sends one email per failed
  request, not one email total, for as long as it lasts. Acceptable for a
  first version — revisit (an in-memory cooldown per `context`, since that
  survives one isolate's lifetime even without a database) if it turns out
  to be noisy in practice.
- **No rate limit on `/api/report-error`.** It's unauthenticated by
  necessity (an error boundary can fire for a signed-out visitor), and
  unlike login/signup/reset it has no Cloudflare rate-limit binding guarding
  it yet. The blast radius is bounded — one log line plus, only if
  configured, one email with no dedupe — so this follows the same judgment
  call the app's very first unauthenticated routes made: add a limiter once
  there's evidence of abuse, not preemptively for a route with none yet.
- **Not a real APM.** No tracing, no performance monitoring, no error
  grouping/deduplication UI, no release tracking. Workers Logs is "search
  raw log lines"; a proper tool (Sentry, or Cloudflare's own paid observability
  tier) is the upgrade path if error volume ever makes raw logs unworkable
  — nothing built here blocks adding one later, since `reportServerError`
  is already the one seam every error path goes through.
- **The alert email path is unverified beyond "the code runs".** Sending
  through Cloudflare Email Service is gated on the Paid-plan/destination-
  verification limits `src/lib/email.ts` already documents; nobody has
  confirmed an alert actually lands in an inbox in production yet. Send a
  real error and check `ERROR_ALERT_EMAIL`'s inbox once that's set, rather
  than trusting this doc that it works.
