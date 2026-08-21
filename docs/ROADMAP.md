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

## Already shipped

For context, not action — the app is further along than "what's left" might
suggest on its own:

Properties/units/tenants/leases · rent collection (manual entry, CSV import,
Stripe Connect, Plaid bank feed) · the reconciliation engine · reports (rent
roll, P&L, owner statements) · rental applications through to lease conversion
· lease builder + e-signature · listings with a manual syndication tracker ·
renter's insurance tracking · maintenance requests + vendor directory ·
tenant and owner portals · address autocomplete · multi-tenant auth/RBAC/CSP
hardening · full CI and e2e coverage.

## Start here

Before anything below: confirm what's actually configured in **production**
right now — Stripe live keys, Plaid production credentials, the email domain,
the Mapbox token. Every one of these is optional by design (the app degrades
to manual mode without them — see `.env.example`), which means it's entirely
possible the live site is quietly running in fully-manual mode today without
either of us having explicitly decided that. This has to be a five-minute
audit before the plan below is more than a guess.

## 1. Blocking a real launch

Nothing past this point matters if these aren't true — this is the gap
between "the app works" and "a stranger's rent money is safe here."

- **Put comfylease.com live** — *Configure*. Registered but not serving;
  production still answers on the default `workers.dev` URL. Blocks outbound
  email, real SEO, and zone-level Cloudflare protections (WAF, bot
  protection, rate-limiting rules). Blocks → outbound email, Plaid/screening
  production access, search visibility.
- **Terms of Service + Privacy Policy** — *Business*. Don't exist yet.
  Required before Plaid or Stripe will approve production access, and before
  a paying landlord should be handing over tenant SSNs and bank data. A
  drafted starting point isn't a substitute for a lawyer actually signing
  off, given what this app touches. Blocks → Plaid production, Stripe
  production, tenant screening.
- **Error tracking + uptime monitoring** — *Build*. Today errors go to
  Workers logs and vanish (see MAINTAINER.md §13). Our own docs call this the
  most likely way the app quietly hurts someone — rent stops recording and
  nobody notices for weeks. Sentry (or similar) plus a dead-simple uptime
  ping is the whole ask.
- **Decide how ComfyLease actually makes money** — *Decide*. The Stripe
  application fee (`STRIPE_APPLICATION_FEE_BPS`) is 0% by default and there's
  no subscription or per-org billing at all — landlords use the app for free
  today, however that got decided. Per-transaction fee on rent, flat monthly
  per org, per-unit pricing — pick one before Phase 2 has a number to
  configure.

## 2. Financial & compliance readiness

The money-movement pieces that need a real institution's sign-off, not just
working code.

- **Verify Plaid against a real bank** — *Configure*. Connect-and-sync has
  only been proven against Plaid's Sandbox test banks. Treat production
  Plaid access as unverified until one real institution has actually
  connected and synced.
- **Apply for Plaid + Stripe production access** — *Business*. Both are a
  real review process on their end — needs the legal pages from Phase 1 in
  place first, plus the actual application fee set once pricing is decided.
- **FCRA consent flow, if screening ships** — *Decide*. Pulling a credit or
  background report requires a "permissible purpose" under the Fair Credit
  Reporting Act. The landlord org, not ComfyLease, has to be the one
  accepting those terms — worth deciding the shape of that before Phase 3's
  screening item gets built.

## 3. Closing the gap on Innago

Feature parity with the competitor a prospective landlord is comparing this
against.

- **Tenant screening — credit, background, eviction** — *Build*. The single
  biggest thing missing versus Innago: applications can be reviewed today but
  not screened. Plugs directly into the existing `Application` review flow
  once a provider (Certn, Checkr, SmartMove) and the FCRA consent piece are
  settled.
- **Real listing syndication** — *Business*. Zillow, Realtor.com, Zumper, and
  Apartments.com each require their own listing-software partner
  application — a real business relationship, not an API key (see
  `docs/listings.md`). The manual tracker already in the app is the right
  interim shape; this item is pursuing those applications directly.
- **Installable on a phone** — *Build*. A web-app manifest already exists;
  worth an actual pass at "Add to Home Screen" install quality and
  touch-target sizing before calling it mobile-ready, rather than assuming
  responsive CSS is the same thing as a good phone experience.

## 4. Operational hardening

Nothing here is on fire at current scale — all deliberate, documented
trade-offs (see MAINTAINER.md §13). Revisit before they become one.

- **Move maintenance photos off D1** — *Build*. Photos live as blobs in the
  database today — fine at current volume, but D1 has a real per-database
  ceiling. R2 is the documented destination; the authorization check
  (`canViewPhoto`) carries over unchanged.
- **Rehearse a real backup + restore** — *Configure*. The safe workflow
  already exists (Actions → D1 → Run workflow) and takes a backup
  automatically before anything destructive — it just hasn't been rehearsed
  end-to-end against a throwaway database. Do that once, not against the
  real one.
- **Revisit rate limiting once there's real traffic** — *Decide*.
  Login/signup/reset throttling fails open by design — a limiter outage must
  never become a login outage. Right for a small user base; worth a second
  look if abuse ever becomes a real pattern instead of a theoretical one.

## Runs alongside all of the above

Not sequential, not code — decisions and outside relationships that can move
on their own clock while the phases above happen.

- **Pricing strategy** — *Decide*. Feeds directly into Phase 1's
  monetization item and Phase 2's Stripe application-fee configuration.
- **Legal review of Terms & Privacy Policy** — *Business*. See Phase 1.
- **Listing-platform partner applications** — *Business*. See Phase 3. Worth
  starting now since these review processes can take a while.

---

*Also published as a formatted artifact:
https://claude.ai/code/artifact/88a4a13c-aa43-4ec6-98ce-52f9f32c7ae8 — this
file is the durable copy; update this one first if the two ever disagree.*
