# Path to production

What's left between where the app is today and a landlord trusting it with real
rent money and real tenant data. Phases 1–4 are ordered where order matters; the
business track at the end runs the whole time alongside them, not after.

Each item is tagged by who acts on it:

- **Build** — code, no external dependency.
- **Configure** — dashboard/account setup, not code.
- **Decide** — needs a business decision before anyone can build it.
- **Business** — an outside process on someone else's clock (a provider's
  review, a partner application, legal sign-off).

This is a point-in-time plan, not a tracker — update or replace sections as
they're resolved rather than checking boxes in place.

> **The itemised version lives in `docs/PRODUCTION-READINESS.md`** (2026-08-31):
> a full security + product + ops audit rendered as a punch list with IDs,
> severity, owner and effort. This file stays the narrative; that one is the
> checklist. Where they disagree, the punch list is newer.

## Already shipped

For context, not action — the app is further along than "what's left" might
suggest on its own:

Properties/units/tenants/leases · rent collection (manual entry, CSV import,
Stripe Connect, Plaid bank feed) · the reconciliation engine · reports (rent
roll, P&L, owner statements) · rental applications through to lease conversion
· lease builder + e-signature · listings with a manual syndication tracker ·
renter's insurance tracking · maintenance requests + vendor directory ·
tenant and owner portals · document vault with automatic filing · rent-roll
portfolio import · address autocomplete · multi-tenant auth/RBAC/CSP
hardening · full CI and e2e coverage.

## Start here

Before anything below: confirm what's actually configured in **production**
right now — Stripe live keys, Plaid production credentials, the Mapbox
token. Every one of these is optional by design (the app degrades to manual
mode without them — see `.env.example`), which means it's entirely possible
the live site is quietly running in fully-manual mode today without either
of us having explicitly decided that. This has to be a five-minute audit
before the plan below is more than a guess.

**Done, 2026-08-23** (`wrangler secret list` + reading `wrangler.jsonc`'s
`vars`, see the comment there for the full readout): `CRON_SECRET` turned out
to already be set — the item below is stale, the nightly rent run is not
actually 401ing. `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` are unset, so
rent collection is fully manual in production right now. Plaid's secrets are
set but `PLAID_ENV` isn't, so production is still pointed at Sandbox, not a
real bank. `ERROR_ALERT_EMAIL` is unset too — alerts are log-only.

(The domain question this used to include is answered: `comfylease.com` is
live and serving — it's sitting behind a Cloudflare Access guard, which is
its own deliberate gate, not an unfinished config step. See the first item
in Phase 1.)

## 1. Blocking a real launch

Nothing past this point matters if these aren't true — this is the gap
between "the app works" and "a stranger's rent money is safe here."

- **Take the Cloudflare Access guard off comfylease.com** — *Decide*. The
  domain itself is live and serving — that part's done, outbound email works,
  `APP_URL` is correct. What's still up is the Access application that's
  been protecting the app since before the domain move, now covering the
  custom domain too instead of just `workers.dev`. Nobody outside whoever's
  been let through it can reach the site at all right now, which blocks real
  search visibility and — this is the one that actually matters for
  sequencing — means Plaid's and Stripe's production-access review teams
  can't reach the site to verify it either. Worth holding until the other
  Phase 1 items below (legal pages live, entity formed) are actually true,
  not dropping it just to unblock this one item. Also blocks something
  smaller found 2026-08-23: it covers `/api/health` too, so no external
  uptime monitor can actually use it right now (`302` to the Access login
  page instead of `200` — see docs/observability.md's uptime section) — a
  narrow path-based exception would unblock just that piece without dropping
  the guard early, if that's wanted before the rest of Phase 1 is ready.
- **Terms of Service + Privacy Policy** — *Business*. First drafts of both
  now exist — `docs/legal/terms-of-service.md` and
  `docs/legal/privacy-policy.md` — not reviewed, not live anywhere in the
  app, and blocked on the entity in the next item. Required before Plaid or
  Stripe will approve production access, and before a paying landlord
  should be handing over tenant SSNs and bank data. A drafted starting
  point isn't a substitute for a lawyer actually signing off, given what
  this app touches. Blocks → Plaid production, Stripe production, tenant
  screening.
- **Form the business entity** — *Business*. The Terms draft names
  `[COMPANY NAME]` as the counterparty because there isn't one yet.
  Operating a rent-collection service as an individual with no entity in
  between means personal liability directly, with nothing in between —
  worth resolving alongside the Terms, not after.
- **Error tracking + uptime monitoring** — *Build, mostly done* — see
  `docs/observability.md`. Cloudflare Workers Logs is on, unhandled Server
  Action and cron failures alert by email if `ERROR_ALERT_EMAIL` is set,
  client-side render crashes now reach the server the same way, and
  `/api/health` exists for an external pinger. What's left is *Configure*:
  set `ERROR_ALERT_EMAIL` and point a free uptime service (UptimeRobot or
  similar) at `/api/health` — neither happens on its own. This work also
  found the reason the nightly rent run has been failing — see the next
  item, which was a real, live bug, not a hypothetical one this section
  was written to guard against.
- ~~**Set `CRON_SECRET` in production**~~ — **Done.** Confirmed set via
  `wrangler secret list` on 2026-08-23. The nightly rent run and bank sync
  should be authorizing correctly; if due/late notices still aren't going
  out, the cause is something else now — check Workers Logs, not this.
- **Decide how ComfyLease actually makes money** — *Decide, model chosen
  2026-08-23*. Landlords are free, no subscription or per-org billing — the
  only revenue lever is a fee on ACH rent payments, via
  `STRIPE_APPLICATION_FEE_BPS` (0 today, meaning no fee is actually charged
  yet). Deliberately narrower than Innago, which also takes card fees,
  application/screening fees, and other add-ons — ACH is the one line this
  app charges. What's still open is the actual rate. The real gap this
  decision exposed — `application_fee_amount` applying to every Checkout
  session regardless of payment method, not just ACH — is **fixed, 2026-08-27**:
  `checkoutApplicationFeeCents()` in `src/lib/stripe.ts` now returns no fee at
  all whenever a session's `allowCards` is true, so a card payment can never
  be silently charged the ACH rate. That fix is conservative, not complete —
  see `docs/payments.md`'s "ACH first, cards opt-in" section: an org with
  cards enabled currently collects *no* platform fee at all, even on the ACH
  payments that come through it, because collecting it after the fact (once
  the webhook knows which method settled) needs a reversed Transfer — new
  Stripe API surface nobody's been able to verify against a live test-mode
  account yet. Worth building once `STRIPE_ALLOW_CARDS` is actually on
  somewhere and the lost ACH revenue is worth the work; not before.

## 2. Financial & compliance readiness

The money-movement pieces that need a real institution's sign-off, not just
working code.

- **Verify Plaid against a real bank** — *Configure*. Connect-and-sync has
  only been proven against Plaid's Sandbox test banks. Treat production
  Plaid access as unverified until one real institution has actually
  connected and synced.
- **Apply for Plaid + Stripe production access** — *Business*. Both are a
  real review process on their end — needs the legal pages from Phase 1 in
  place first, the actual application fee set once pricing is decided, and
  the Access guard down (Phase 1) so their review teams can actually reach
  the site.
- **FCRA consent flow** — *Build, done* — see `docs/tenant-screening.md` and
  Phase 3's tenant-screening item below. Built ahead of the provider
  integration it was blocking, since the consent step is independent of
  which provider eventually runs the report.

## 3. Closing the gap on Innago

Feature parity with the competitor a prospective landlord is comparing this
against.

- **Tenant screening — credit, background, eviction** — *Build, framework
  done* — see `docs/tenant-screening.md`. An application's detail page can
  now request screening, which emails the applicant a real FCRA consent
  disclosure and records their response with an audit trail; once they
  consent, staff record whatever came back from wherever they actually ran
  the report. What's left is *Business*: pick a real provider (Certn,
  Checkr, SmartMove) and build the API integration that pulls a report
  automatically instead of a staff member running it by hand and typing in
  the result — and *Decide/Business*: get the disclosure text reviewed by a
  lawyer for the states this is actually used in before it goes in front of
  a real applicant, same review dependency as Phase 1's Terms/Privacy Policy.
- **Real listing syndication** — *Business*. Zillow, Realtor.com, Zumper, and
  Apartments.com each require their own listing-software partner
  application — a real business relationship, not an API key (see
  `docs/listings.md`). The manual tracker already in the app is the right
  interim shape; this item is pursuing those applications directly.
- **Installable on a phone — done for now** — *Build*. The manifest was
  missing what Android's adaptive-icon system actually needs: a `maskable`
  icon, plus concrete 192/512 raster sizes most PWA checklists check for
  (`scripts/generate-manifest-icons.mjs`, sharing the same hand-rolled PNG
  rasterizer `generate-apple-icon.mjs` already used). Also fixed the clearest
  touch-target gap — five table-row actions (Remove, Void, Delete...) were
  plain unpadded text, under any reasonable tap-target minimum; a shared
  `.btn-text` utility widens the actual hit area without changing row height
  or the visible text. Not audited: every last small control app-wide (a few
  borderline-but-passing ones, like the theme-toggle segmented control, were
  left alone deliberately rather than risk their compact look for a marginal
  gain) — revisit if real phone usage turns up a specific miss-tap complaint.

## 4. Operational hardening

Nothing here is on fire at current scale — all deliberate, documented
trade-offs (see MAINTAINER.md §13). Revisit before they become one.

- ~~**Move maintenance photos off D1**~~ — **Done, 2026-08-31** — see
  `docs/photo-storage.md`. Both photo tables now write to the same R2 store
  the document vault uses (`src/lib/object-storage.ts`, renamed from
  `document-storage.ts` now that documents aren't its only caller). A row
  carries `storageKey` *or* the legacy `data` column, and `photoBytes()` owns
  that precedence, so rows written before the move keep serving. The
  authorization checks (`canViewPhoto`/`canViewListingPhoto`) carried over
  untouched, as predicted.

  **One step is still yours**: existing production rows only move when you
  call `GET /api/cron/photo-backfill` with the `CRON_SECRET` bearer token,
  repeatedly, until it reports `"done": true`. Nothing breaks if you never do
  — those rows keep serving out of `data` — but the D1 ceiling this was meant
  to relieve isn't actually relieved until it runs. Dropping the `data`
  column afterwards is a separate migration, deliberately not done yet.
- **Rehearse a real backup + restore** — *Configure*. The safe workflow
  already exists (Actions → D1 → Run workflow) and takes a backup
  automatically before anything destructive — it just hasn't been rehearsed
  end-to-end against a throwaway database. Do that once, not against the
  real one.
- **Revisit rate limiting once there's real traffic** — *Decide*.
  Login/signup/reset throttling fails open by design — a limiter outage must
  never become a login outage. Right for a small user base; worth a second
  look if abuse ever becomes a real pattern instead of a theoretical one.
- **Put a gate in front of production** — *Configure, mostly yours* — see
  `docs/environments.md` for the full writeup. Found 2026-08-29: there is
  nothing between `git push` and `comfylease.com`. The repo's default branch
  is also the working branch, Cloudflare Workers Builds deploys off it
  directly, and CI *reports* rather than *blocks* — Cloudflare doesn't wait
  for GitHub Actions, so a commit that fails CI still ships. A push touching
  `migrations/` is additionally a schema change against the real database
  (`d1.yml`'s push trigger). The fix needs no new infrastructure: bring
  `main` current, point Workers Builds at it, and require passing CI to merge.
  Two of those three steps are dashboard settings only you can do. Fine while
  there are no customers; not fine once there are.
- **Dependency-vulnerability hygiene** — *Build/Decide*. `npm audit`'s
  findings had no owner and no process until 2026-08-29, when the
  safely-fixable half was applied (`nanoid`, `undici`/`miniflare`/`wrangler`).
  What's left is 6 high findings that all need a major-version bump to clear:
  `postcss`/`sharp` (via `next`) and `deepmerge-ts` (via `prisma`). Assessed
  rather than force-fixed — `sharp` is Next's image optimizer, which this app
  deliberately never invokes (uploaded photos use a plain `<img>` against our
  own authorized route, see the comment in the maintenance detail page), and
  `postcss` runs at build time on our own CSS, not on anything a user
  supplies. Neither is reachable by an attacker through this app today. Worth
  clearing on the next routine `next`/`prisma` upgrade rather than a forced
  bump in isolation; worth re-checking whenever that assumption about image
  optimization changes.
- **Data retention and deletion** — *Business/Build* — see
  `docs/data-retention.md` for the full inventory. Nothing in the app expires
  automatically: no scheduled purge, no per-record TTL, and no way to delete a
  single tenant's data short of deleting their whole organization. That's a
  policy question before it's a code one, and it's the same legal review the
  Terms and Privacy Policy in Phase 1 need — the doc lists what's actually
  stored (raw-identity documents and W-9s in the vault, screening results,
  live Plaid tokens) and the specific questions worth a lawyer's answer.
  Should be folded into that review rather than run as a separate one.

## Runs alongside all of the above

Not sequential, not code — decisions and outside relationships that can move
on their own clock while the phases above happen.

- **Pricing strategy** — *Decide*. Feeds directly into Phase 1's
  monetization item and Phase 2's Stripe application-fee configuration.
- **Legal review of Terms & Privacy Policy** — *Business*. See Phase 1. Worth
  putting the retention/deletion questions in `docs/data-retention.md` in front
  of the same reviewer at the same time — they're about the same data and the
  answers shape what the Privacy Policy can honestly claim.
- **Listing-platform partner applications** — *Business*. See Phase 3. Worth
  starting now since these review processes can take a while.

---

*Also published as a formatted artifact:
https://claude.ai/code/artifact/88a4a13c-aa43-4ec6-98ce-52f9f32c7ae8 — this
file is the durable copy; update this one first if the two ever disagree.*
