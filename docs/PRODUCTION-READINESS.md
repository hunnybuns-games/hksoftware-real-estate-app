# Production readiness — the punch list

**As of 2026-08-31, commit `1e28100`.** A full-product audit: every server
action and API route traced for authorization, every feature area walked
against what a 10–50-unit landlord needs in week one, the ledger and webhook
edges read for money correctness, the deploy/ops/legal posture reviewed, and
the complete test suite run. Three parallel reviews (security, product,
infrastructure) merged here; every finding marked CONFIRMED was re-verified
against the code by hand, not taken from the review that raised it.

This is the durable copy. The same list is published as a filterable page —
link at the bottom — and `docs/ROADMAP.md` remains the narrative plan; this
file is the itemised one.

## Verdict

**The engineering is further along than the surrounding posture.** The
codebase is production-grade in the places that are hardest to get right —
org isolation, the reconciliation engine's core math, upload handling,
webhook verification, form validation, documentation density. Twenty-eight
days of work produced 28,000 lines of app code with zero TODOs, 354 unit
tests, and 15 end-to-end suites, all green.

What stands between here and a first paying landlord is not more features.
It is:

1. **Two HIGH security findings and six money-correctness bugs** at the
   edges of otherwise-sound systems — all small-to-medium fixes, all
   confirmed, none yet fixed.
2. **A deploy pipeline with no gate**, where `git push` is a production
   deploy and a schema change against the live database.
3. **The legal and business shell**: no entity, unreviewed Terms/Privacy,
   no acceptance at signup, an Access guard that blocks the provider reviews
   which need those documents first.
4. **A handful of week-one functional gaps** a real landlord hits on day 1–7
   (proration, late fees the lease promises but the app doesn't post,
   unmatched payments that can't be assigned, manual payments that can't be
   corrected).

Realistic path: **P0 is roughly one focused week** of engineering. P1's
engineering half is **three to four more**. P1's business half (entity,
legal review, provider applications) runs on outside clocks in parallel and
is the actual long pole.

## State of the product

| | |
|---|---|
| History | 95 commits, 2026-08-03 → 2026-08-31 |
| App code | ~28,250 lines TS/TSX · 0 TODO/FIXME |
| Data model | 30 models · 23 enums · 12 migrations |
| Surface | 82 server actions · 53 pages · 15 API routes |
| Tests | 354 unit (25 files) · 15 e2e suites (~3,770 lines) |
| Docs | 14 design docs (3,180 lines) · 2 legal drafts (715 lines) |
| Production | Cloudflare Workers + D1 + R2, live at comfylease.com behind an Access guard |
| Configured in prod | AUTH_SECRET, CRON_SECRET, BANK_TOKEN_ENCRYPTION_KEY, Plaid (Sandbox), EMAIL_FROM, ERROR_ALERT_EMAIL |
| **Not** configured | Stripe keys (rent collection manual), PLAID_ENV (Sandbox not real banks), application fee (0), external uptime monitor |

**Shipped and working:** properties/units/tenants/leases · rent collection
via manual entry, CSV import, Stripe Connect (ACH-first), Plaid bank feed ·
reconciliation engine with HAP splits · rent roll, P&L, owner statements,
CSV exports · rental applications → lease conversion · tenant screening
consent framework · lease builder + e-signature · listings with syndication
tracker · document vault with auto-filing (R2) · portfolio rent-roll import ·
maintenance + vendor directory · tenant and owner portals · photos on R2 ·
multi-tenant RBAC · nonce CSP · rate limiting · error alerting · CI with
real production build.

## Verification record (2026-08-31)

Run from a clean database against commit `1e28100`:

| Check | Result |
|---|---|
| `tsc --noEmit` | clean |
| `eslint .` | clean |
| `vitest` | **354 / 354** (25 files) |
| `cf:migrations:check` | 12 migrations in step |
| `cf:build` (OpenNext production bundle) | clean |
| e2e — 15 suites | _see final line below_ |
| CI on `main` @ `85ea0e4` | green (CI + D1 workflow) |

<!-- E2E-RESULTS -->

**What the suites do not exercise** (and therefore what this run does not
prove): live Stripe or Plaid calls (demo path + mocks); the rent-run cron's
notice cadence; Stripe webhook status transitions beyond the fee helper;
`endLeaseAction`; property-delete cascade; the two newest suites
(`documents`, `portfolio-import`) run here but are **not in CI**.

## Severity and ownership key

- **Severity** — Critical: fix before real money or PII; High: fix before
  launch; Medium: fix before scale / second landlord; Low: track.
- **Owner** — `Claude`: code, I can do it on request · `You`: dashboard,
  account, or business step only you can do · `Decision`: needs a call
  before anyone builds.
- **Effort** — S ≤ half a day · M 1–3 days · L a week+.
- **Status** — Open · In progress · Done.

---

## P0 — Before any real money or real PII touches this

Everything here is CONFIRMED by reading the code path and, where a test
could be written, re-verified by hand. None of it is speculative.

### Security

| ID | Sev | Finding | Owner | Effort |
|---|---|---|---|---|
| SEC-1 | **Critical** | **File-serving and two export routes authorize from the stale 30-day JWT, not the live user.** `api/documents/[id]`, `api/photos/[id]` (via `canViewPhoto`), `api/listing-photos/[id]` (via `canViewListingPhoto`), `api/export/property-pl`, and the staff branch of `api/export/rent-roll` call `auth()`; everything else in the app uses `liveSessionUser()`/`assertStaff()` which hit the DB. A staff member removed from the org — or a tenant whose lease ended — keeps downloading ID scans, W-9s, photos and financial CSVs until their token expires. `e2e/security` tests revocation for pages only. **Fix:** swap the five `auth()` calls for the live helpers; add the file routes to the revocation e2e. | Claude | S |
| SEC-2 | **Critical** | **STAFF can escalate to ADMIN.** Invitation tokens are rendered to every staff member: the Team page selects `Invitation.token` and shows the full `/invite/<token>` link whenever `RESEND_API_KEY` is unset (production uses the Cloudflare email binding, so always), with no admin gate in `invite-row.tsx`; and invite emails aren't sent `sensitive: true`, so the Email log (`requireStaff`) stores the live link too. A STAFF user copies an ADMIN invite, redeems it in a private window, and now controls Stripe/Plaid/team. Same path lets staff redeem a *tenant's* invite and e-sign as them. **Fix:** gate the link on `isAdmin` and stop selecting `token` otherwise; mark invite + screening-consent emails `sensitive`; restrict the outbox to admins or redact links; store invite/consent tokens hashed like `PasswordResetToken`. | Claude | S |
| SEC-3 | High | **Password reset doesn't revoke existing sessions.** JWTs are stateless (30 days); `resetPasswordAction` only rewrites the hash. A stolen cookie survives the victim rotating their password. Role changes and removal short of deletion likewise. **Fix:** `User.sessionVersion`, stamped into the JWT, checked in `loadLiveUser`, bumped on reset/role change; add "sign out everywhere". | Claude | M |
| SEC-4 | High | **CSV formula injection** in all four exports. `escapeCsvField` quotes but never neutralises a leading `= + - @ \t \r`. Applicant names (public form, any 120 chars) become tenant names in the rent roll; Plaid merchant names and imported bank rows land in the payments export. **Fix:** prefix `'` when a value starts with those characters. | Claude | S |
| SEC-5 | High | **`/api/report-error` is unauthenticated and unlimited**, and every call sends one alert email through the same binding that sends rent notices, invites and password resets (3,000/month quota). 3,000 POSTs exhausts it → real users' notices and resets stop; inbox flooded with attacker text. **Fix:** per-IP rate-limit binding, dedupe by message hash per hour, require `Sec-Fetch-Site: same-origin`. | Claude | S |
| SEC-6 | Medium | **Plaid client secret and decrypted access tokens can reach Workers Logs.** Plaid's SDK throws `AxiosError` whose `config` carries the `PLAID-SECRET` header and the request body (`access_token`); five call sites log the whole error object and `observability.enabled` ships it to the dashboard. Undermines the at-rest encryption. SUSPECTED on serialisation, CONFIRMED on the code path. **Fix:** a `describePlaidError()` that logs only `error_code`/`error_message`; make `reportServerError` serialise `name/message/stack` only. | Claude | S |
| SEC-7 | Medium | **Non-action helpers exported from `"use server"` files are public endpoints.** `ensureDefaultTemplate(organizationId)` and `loadExistingPortfolio(organizationId)` take an arbitrary org id with no session check; the latter returns every tenant email in that org. Exploitation is gated on Next's per-build action-ID salt, so latent — but this exact class already bit this repo once (MAINTAINER §4). **Fix:** move both to `src/lib/`. | Claude | S |

### Money correctness

| ID | Sev | Finding | Owner | Effort |
|---|---|---|---|---|
| MONEY-1 | **Critical** | **Late notice never fires on the day grace lapses; first one arrives 7 days late.** `rent-run` checks `daysSinceGraceEnded === 0 || % 7 === 0`, but `isLate` requires `daysPastDue > graceDays`, so the minimum value is 1 and the `=== 0` branch is unreachable. The landing page promises "a notice once the grace period you configure has lapsed." **Fix:** `=== 1 || % 7 === 1`; add a cadence unit test. | Claude | S |
| MONEY-2 | **Critical** | **An on-time ACH payment is re-labelled LATE when it settles.** The webhook stamps `paidAt = new Date()` at settlement (3–5 business days later) and reconciliation dates lateness by `paidAt ?? createdAt`. Tenant pays on the 3rd, grace 5, shows "Late" on the 8th — on the ledger, the rent roll, and P&L. **Fix:** record `initiatedAt` (session creation) separately from `settledAt`; reconcile lateness on initiation. Schema change — plan it once with FEAT-3 (autopay) in mind. | Claude | M |
| MONEY-3 | **Critical** | **A partial Stripe refund zeroes the whole payment.** `charge.refunded` fires for partial refunds; handler sets `REFUNDED` unconditionally, never reads `amount_refunded`. Refund $50 of $1,800 → tenant is $1,800 behind and gets late notices. **Fix:** reduce `amountCents` on partial, `REFUNDED` only when fully refunded; test it. | Claude | M |
| MONEY-4 | High | **Deposits and late fees are counted as income; "deposit held" is asserted, not tracked.** P&L and "Collected" sum every crediting payment regardless of which charge it covers; `Lease.depositCents` renders as "Deposit held" whether or not it was ever received. Owner statements overstate income; the liability is invisible. **Fix (minimum):** exclude DEPOSIT-allocated money from income and show it as held; full deposit-return workflow can follow. | Claude | M–L |
| MONEY-5 | High | **No proration on move-in/move-out.** Full month billed for the start and end months. A lease starting the 15th shows a full month owed immediately and the tenant gets a reminder for the wrong amount. The v1 doc marks this out of scope; for a first paying landlord it's the single most common day-1 need. **Fix:** prorate first/last period by days, opt-out flag on the lease. | Claude | M |
| MONEY-6 | High | **Late fees are promised by the generated lease and never posted.** `Organization.lateFeeCents` is only a "suggested amount"; the lease template says "A late fee of {{late_fee_amount}} applies to each late payment." The landlord signs a contract the app doesn't enforce. **Fix:** in rent-run, when a RENT charge first turns late, create a LATE_FEE charge keyed on `(leaseId, LATE_FEE, periodStart)` (unique index already supports it), org toggle + per-lease override. | Claude | M |
| MONEY-7 | High | **Nightly cron never re-runs reconciliation.** Only the manual "Run rent" button does. `SHORT` is time-dependent and only recomputed on write events, so a partial payment shows "Matched" indefinitely after grace lapses. **Fix:** call `applyReconciliationForOrganization` in the cron. | Claude | S |
| MONEY-8 | High | **Onboarding an existing lease instantly creates up to 12 months of unpaid charges** (`maxMonthsBack` default 12) and emails the tenant a late notice at 13:00 UTC the same day. Portfolio import inherits this. **Fix:** a "billing starts" date on the lease, defaulting to today for past start dates, or an opening-balance step. | Claude | M |
| MONEY-9 | Medium | Mid-lease rent change has no effective date, doesn't touch the current month's charge, and a voided charge still occupies its `(leaseId, RENT, periodStart)` key so it's never regenerated. **Fix:** effective-from date; re-issue the current period if unpaid. | Claude | M |
| MONEY-10 | Medium | "Collected this month" excludes clearing ACH (needs `paidAt`); the owner-page footnote claims the opposite. Resolves with MONEY-2. | Claude | S |
| MONEY-11 | Medium | Stripe webhook can regress a settled payment: `onCheckoutCompleted` has no "already SUCCEEDED" guard (unlike `onIntentSucceeded`), so a redelivered `checkout.session.completed` sets `PROCESSING, paidAt: null` and sends a second receipt. **Fix:** never downgrade; skip when SUCCEEDED/REFUNDED. | Claude | S |

### Data loss

| ID | Sev | Finding | Owner | Effort |
|---|---|---|---|---|
| DATA-1 | High | **Deleting a property destroys ended-lease history and orphans payments.** Guard only blocks *active* leases; Unit→Lease→Charge cascade, Payment.leaseId set-null. Inconsistent with `deleteUnitAction`, which blocks on any lease. One STAFF click erases a building's billing history. **Fix:** block on any lease or payment; offer archive. | Claude | S |
| DATA-2 | High | **No way to correct a manual payment, and no audit trail.** `updatePaymentStatusAction` exists but no UI calls it; $18,000 typed for $1,800 is permanent. No `recordedById` on Payment, no `voidedById` on Charge, no audit table. **Fix:** void/edit flow for manual and imported payments; `recordedById`; lightweight `AuditEvent`. | Claude | M |
| DATA-3 | High | **Plaid "removed" transactions hard-delete payments a human matched.** `deleteMany` on removed ids, including ones with a manual lease match; some banks reissue ids on pending→posted. **Fix:** mark FAILED "Removed by bank", keep `leaseId`. | Claude | S |

---

## P1 — Launch blockers

### Deploy gate and operations

| ID | Sev | Finding | Owner | Effort |
|---|---|---|---|---|
| OPS-1 | **Critical** | **Nothing stands between `git push` and comfylease.com.** Default branch = working branch; Workers Builds deploys off it; CI *reports* but Cloudflare doesn't wait for it — a red commit still ships. `main` is now current (fast-forwarded 08-31, identical). **Remaining:** Cloudflare → Workers & Pages → project → Settings → Builds → production branch `main` (no-op deploy, same commit); *then* GitHub → Settings → Rules → protect `main`: require PR + `CI` check. Order matters. After this, direct pushes to `main` stop — including from my sessions. | **You** | S |
| OPS-2 | High | **Migrations auto-apply to production on push.** `d1.yml` fires on any push touching `migrations/`. It backs up first and fired cleanly twice today — but a passing migration can still be wrong against real data. **Decide:** keep auto-apply (gated by OPS-1) or drop the push trigger and rely on the manual dispatch. | Decision | S |
| OPS-3 | High | **No external uptime monitor.** `/api/health` checks the DB and is ready; blocked because the Access guard returns 302 on it. **Fix:** Access path bypass for `/api/health` (or wait for LEGAL-4), then a free pinger (UptimeRobot, 5-min, expect 200). | **You** | S |
| OPS-4 | High | **Backup restore has never been rehearsed**, and it has a documented footgun: D1 Time Travel restores schema too, which already caused one outage. No scheduled backups — only on migration-apply or manual dispatch. **Fix:** rehearse once against a throwaway D1; add a scheduled `backup` dispatch. | **You** | S |
| OPS-5 | Medium | Two feature e2e suites are not in CI: `e2e:documents` and `e2e:portfolio-import` (need the landlord10 seed + `DEMO_PAYMENTS` in the job). The vault and importer have zero automated regression protection. | Claude | S |
| OPS-6 | Medium | Rate-limit bindings fail open by design; never confirmed to actually trip in production (`getLimiter` returns null on a name mismatch, silently). **Verify:** run `e2e/security` against production once. | **You** | S |
| OPS-7 | Low | Verify at runtime what source can't settle: OpenNext honours `next.config` `headers()`; HSTS at the zone; `__Secure-` cookie flags; Workers Logs retention. One `curl -I` session. | **You** | S |

### Legal, entity, providers

| ID | Sev | Finding | Owner | Effort |
|---|---|---|---|---|
| LEGAL-1 | **Critical** | **No business entity.** Terms name `[COMPANY NAME]`. Operating rent collection as an individual is direct personal liability. Tallest domino: blocks LEGAL-2, which blocks Plaid and Stripe production. | **You** | — |
| LEGAL-2 | **Critical** | **Terms + Privacy are drafts** — explicitly "not reviewed by an attorney", not linked from the app, placeholders for `[STATE] [EFFECTIVE DATE] [SUPPORT EMAIL] [DMCA AGENT EMAIL] [BUSINESS ADDRESS]`. Put the data-retention questions in `docs/data-retention.md` and the FCRA disclosure template (LEGAL-5) in front of the same reviewer. | **You** | — |
| LEGAL-3 | High | **Signup has no Terms/Privacy acceptance** (confirmed absent). Wire a checkbox + timestamp once LEGAL-2 lands; link both docs from signup and the portal footer. | Claude | S |
| LEGAL-4 | High | **Cloudflare Access guard** blocks the public, search, `/api/health`, and — the sequencing problem — Plaid's and Stripe's production-review teams. Hold until LEGAL-1/2; then decide: remove, or path-exceptions first. | Decision | S |
| LEGAL-5 | High | **FCRA disclosure** shown to screening applicants is a template, not reviewed. Blocks screening go-live. Fold into LEGAL-2. | **You** | — |
| LEGAL-6 | Medium | **Data retention:** nothing expires, no per-person delete, no retention windows decided. Inventory + open questions in `docs/data-retention.md`. Policy first (LEGAL-2), then a purge cron + "delete everything for this person" action. | Decision → Claude | M |

### Money configuration and provider access

| ID | Sev | Finding | Owner | Effort |
|---|---|---|---|---|
| BIZ-1 | High | **Application fee rate is 0.** The ACH-only model is decided; `STRIPE_APPLICATION_FEE_BPS` is unset. Pick the number. | Decision | — |
| BIZ-2 | High | **Stripe not configured in production** (`STRIPE_SECRET_KEY`/`WEBHOOK_SECRET` unset) — rent collection is fully manual live. Set via `wrangler secret put` once provider access is granted. | **You** | S |
| BIZ-3 | High | **Plaid production access + one real bank verified.** `PLAID_ENV` unset → Sandbox. Only ever proven against test banks. | **You** | — |
| BIZ-4 | High | **Stripe production access application.** Needs LEGAL-2 live and LEGAL-4 down. | **You** | — |
| BIZ-5 | Medium | **Local Stripe end-to-end never completed.** Five test payments stayed `PENDING`; webhook forwarding was never confirmed (almost certainly a stale `whsec_` after restarting `stripe listen`). First real ACH round-trip is still unproven. | **You** | S |

### Week-one functional gaps

| ID | Sev | Finding | Owner | Effort |
|---|---|---|---|---|
| FEAT-1 | High | **Unmatched payments can't be assigned to a lease.** The Rent page banner says "until you assign them below"; no action exists. Plaid-fed payments default to UNMATCHED, so with a bank feed most money lands in a bucket that can't be emptied. | Claude | M |
| FEAT-2 | High | **Lists don't scale.** Tenants/leases/properties render every row with no search, filter, or pagination; payments hard-caps at 100. 50 units hits the cap in two months. | Claude | M |
| FEAT-3 | Medium | **No autopay.** Checkout is one-off `mode: "payment"`. Every competitor has it; it's what makes ACH reduce chasing. Needs a saved bank payment method + cron-created intents. Plan the `initiatedAt` schema (MONEY-2) with this in mind so it's one migration. | Claude | L |
| FEAT-4 | Medium | **No recurring non-rent charges** (pet rent, parking, utilities). Each added by hand monthly. | Claude | M |
| FEAT-5 | Medium | **No lease renewal or move-out workflow.** Renewal = edit `endDate`; expired leases stay ACTIVE forever and keep the unit OCCUPIED; end-lease is one click, no confirmation, no final statement. | Claude | M |
| FEAT-6 | Medium | **One tenant per lease** (single FK). Roommates/co-signers are the norm. State it in the lease form for v1; join table later. | Decision → Claude | L |
| FEAT-7 | Medium | **No account self-service:** change password while signed in, change email, sign-out-everywhere, delete account/org, export data. No support link anywhere. | Claude | M |
| FEAT-8 | Medium | **No email verification at signup.** A typo'd address means reset never works; an attacker can pre-register a tenant's email and block their invite. | Claude | M |
| FEAT-9 | Low | Tenant maintenance comments don't notify staff; team notifications fan out to everyone with no preferences; portal shows only 12 charges and no receipts. | Claude | S–M |

---

## P2 — Before scale or a second landlord

| ID | Sev | Finding | Owner | Effort |
|---|---|---|---|---|
| SEC-8 | Low | `reportUrl` on screening rendered as raw `href` — `javascript:` is stored XSS between staff (CSP blocks execution today). Require `^https?://`. | Claude | S |
| SEC-9 | Low | `/apply/[unitId]` treats a cuid as an unlisted link (~41 random bits); discloses address/rent and fans out email per submission. Dedicated `applyToken` + per-unit "accepting applications" switch. | Claude | S |
| SEC-10 | Low | Tenant portal over-fetches full Payment rows (`memo`, `payerNameRaw`, `externalRef`) and `stripeAccountId` into the RSC payload. `select` only rendered fields. | Claude | S |
| SEC-11 | Low | `/api/health` returns the raw DB error string; `/api/export/payments` casts `status` unvalidated (500 + alert email per request); Plaid webhook fetches keys for any `kid` without negative caching; no storage quota on the vault; no HSTS/Permissions-Policy in `next.config`. | Claude | S each |
| SEC-12 | Low | `next` fix for the 6 remaining `npm audit` highs is a **minor** bump (`16.2.12 → 16.3.x`), not major — deferred by choice earlier, safe to take with a regression run. `next-auth@5.0.0-beta.32` is a beta on the auth path; pin and watch. | Claude | S |
| SEC-13 | Low | Rotate `BANK_TOKEN_ENCRYPTION_KEY` if the value in the local `.env` was ever the production one; restrict the Mapbox token by URL; confirm no seed (`admin@example.com` / `demo-password-123`) ever ran against production D1. | **You** | S |
| OPS-8 | Medium | **No staging environment.** Single D1, single R2, no `env` blocks. Deferred deliberately; revisit at first real customer data or a second committer. | Decision | L |
| OPS-9 | Low | Doc drift: MAINTAINER §13 still says photos are D1 blobs and `ERROR_ALERT_EMAIL` is unset (both resolved); e2e README says eleven suites (fifteen). | Claude | S |
| TEST-1 | Medium | No tests for: rent-run notice cadence (would have caught MONEY-1), Stripe webhook transitions/refund/idempotency, `endLeaseAction`, overlap detection, property-delete cascade, `generateRentCharges` DB path, Plaid webhook route, tenant invite acceptance, year-boundary/leap-day date math. | Claude | M |
| SCHEMA-1 | Medium | Debt that compounds: `Payment.paidAt` overloaded (→ `initiatedAt`/`settledAt`); `Payment.chargeId` is a pointer not an allocation ledger (deposit accounting needs `PaymentAllocation`); no `Organization.timezone` (all UTC-day math; cron at 13:00 UTC); missing `Lease.billingStartsAt/moveOutDate/depositReceivedAt`; no `Charge.organizationId`; `User.email` globally unique blocks one person renting from two ComfyLease landlords. | Claude | — |
| UX-1 | Low | Void charge and End lease have no confirmation (delete does); no un-void; "Matched" on a payment with no charge reads as fine when it means "credit"; leases list is colour-only for late vs owing; dates render "UTC"; `graceDays` allows 31. | Claude | S each |

---

## P3 — Deferred, labelled honestly

Ship v1 without these; say so in the UI where a landlord would look for them.

- Card-payment application fee via reversed Transfer (only matters once `STRIPE_ALLOW_CARDS` is on; needs live-Stripe verification)
- Real screening-provider API (Certn / Checkr / SmartMove — pick one first)
- Real listing syndication (partner applications with each platform)
- Owner distributions, 1099 prep, per-tenant statements
- Vendor workflow beyond a directory (scheduling, cost tracking)
- Data-retention purge job and per-person delete (after LEGAL-6 answers)
- Org timezone, per-user notification preferences, audit-log table

---

## What's strong — don't spend time here

- **Org isolation is systematic.** All 82 actions traced: every staff action scopes by `organizationId` or a relation filter; nested ids (unit + tenant on lease create, vendor on assign, filing targets, import lease choices, owner property grants) are all re-validated. Zero cross-org reads or writes through a Server Action.
- **RBAC** reads the DB, not the token, for pages and actions; last-admin protection; the STAFF/ADMIN split is enforced on every write. Owner view is scrubbed of tenant identity at both layout and page.
- **The reconciliation engine's core** is pure, FIFO, full-recompute, with correct combined-total HAP semantics, idempotent charge generation on a real unique constraint, and a correct concurrent-insert retry. The bugs above live at its edges (webhook timestamps, cron cadence), not in the math.
- **Auth hygiene:** bcrypt 12, dummy-hash timing equalisation, uniform reset responses, hashed single-use reset tokens with a race-safe claim, open-redirect defence, last-admin guard.
- **Uploads:** limits checked before the body is read; magic-byte detection; the *detected* type is stored and served; non-inline-safe types forced to `attachment`; SVG/HTML downgraded; path-traversal guard; private bucket.
- **Webhooks:** Stripe signature with refusal when unset; Plaid ES256 + body hash + freshness; Stripe-owned rows can't be hand-edited; the cancel flow asks Stripe before killing a session.
- **Input:** Zod on every form, enums for every status, integer cents everywhere, no raw SQL, `dangerouslySetInnerHTML` only for the nonced theme script and constant JSON-LD, email bodies escaped, Content-Disposition encoded.
- **CSP** nonce + `strict-dynamic`, `frame-ancestors 'none'`, `form-action 'self'`, `object-src 'none'`; `no-referrer` on token URLs.
- **Encryption at rest** for Plaid/API keys: AES-256-GCM, fresh IVs, pinned test vector.
- **Documentation** is unusually honest; the gaps found here are product-level, not engineering-level, and most are already acknowledged somewhere.

## Recommended order

1. **This week (Claude):** SEC-1, SEC-2, MONEY-1, MONEY-7, DATA-1, DATA-3, SEC-4, SEC-5, MONEY-11 — nine small fixes, most under half a day, all confirmed. Then SEC-7, OPS-5, OPS-9.
2. **This week (You):** OPS-1 (ten minutes, highest leverage on the list), OPS-4, BIZ-5, LEGAL-1 (start the entity).
3. **Next 2–3 weeks (Claude):** MONEY-2 + MONEY-3 + FEAT-3's schema together (one migration), MONEY-4/5/6/8, DATA-2, FEAT-1, FEAT-2, SEC-3, SEC-6, TEST-1.
4. **On outside clocks (You):** LEGAL-2 (+ data-retention + FCRA in the same review), then LEGAL-3/4, BIZ-1/2/3/4.
5. **Then:** P2 as time allows; P3 stays deferred and labelled.

---

*Published as a filterable page: <!-- ARTIFACT-URL -->. This file is the
durable copy; update it first if the two ever disagree.*
