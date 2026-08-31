# Data inventory — input for a retention/deletion policy

This is an engineering inventory, not a policy. It answers "what does the app
actually store, where, and for how long today" so a real retention/deletion
policy can be written against facts rather than guesses. It doesn't decide
what *should* happen — how long to keep a former tenant's screening report,
whether a deletion request has to honor a state's own record-keeping minimums
for landlords — those are legal calls, flagged as open questions below rather
than answered here.

Written alongside `docs/legal/terms-of-service.md` and
`docs/legal/privacy-policy.md`, which are the other half of Phase 1's legal
review in `docs/ROADMAP.md`.

## The short version

**Nothing in this app expires automatically.** Every table grows forever
until someone manually deletes a row. There is no scheduled purge job, no
per-record TTL, and — before 2026-08-28's Document Vault — no delete action at
all for most sensitive records. That's fine for an app with no live customers
yet; it's the first thing to fix before one shows up.

## Where the sensitive data actually is

Ranked by how bad a leak or a missed deletion request would actually be:

1. **The Document Vault (`Document` model, bytes in R2/local disk) — the
   biggest exposure, and brand new.** Two of its ten categories are
   specifically raw-identity documents: `IDENTIFICATION` (driver's license,
   passport, proof of income) and `TAX` (W-9s, which carry a real SSN or
   EIN). `docs/documents.md` calls this out directly: "a scan that happens to
   show a co-applicant's ID" is a named, accepted risk of the vault's current
   shape. A delete action exists (`deleteDocumentAction`) but nothing decides
   *when* a document should be deleted — that's a pure staff judgment call
   today, with no reminder, no auto-expiry, and no bulk "delete everything
   for this person" action.
2. **`ScreeningRequest.resultSummary`** — free text a staff member types in
   after running a credit/background/eviction check elsewhere. Whatever
   detail they choose to paste in (a credit score, "denied — eviction on
   file") lives here indefinitely once entered; no field caps what goes in,
   and there's no separate raw SSN/DOB field, but nothing stops a copy-pasted
   summary from including more than it should.
3. **`BankConnection.accessTokenEncrypted`** — a live Plaid access token,
   encrypted at rest (`src/lib/token-encryption.ts`). Not the bank data
   itself, but a live key that can pull it on demand for as long as the row
   exists. Disconnecting does revoke it properly at Plaid's end
   (`disconnectBankAction` calls `removeItem`), best-effort: if Plaid's side
   fails the local row is still deleted, so an org can't get stuck unable to
   reconnect. Nothing outstanding here.
4. **`ListingPlatformConnection`'s API key** — same encryption, lower stakes
   (a listing-syndication credential, not financial data).
5. **`Tenant`/`Application`** — name, email, phone, self-reported income,
   pet details. Moderate PII, the kind any landlord already keeps in a
   spreadsheet; not in the same tier as 1–3 above.
6. **`MaintenancePhoto`/`ListingPhoto`** — property/unit photos, capped at
   4 MB, in D1 as raw bytes. Rarely sensitive by nature (a photo of a leaky
   faucet), but no different from any other photo library in terms of what
   could incidentally appear in frame.
7. **`NotificationLog.body`** — full text of every email the app has ever
   sent or logged, including names, amounts, and (for invites/password
   resets/screening consent) live unlisted tokens. These are single-use or
   time-limited by the flows that issue them, but the *email log entry*
   itself doesn't expire even after the token inside it does.

## What already gets deleted, and what doesn't

- **Cascade deletes exist and are used correctly** for the relational shape —
  deleting an `Organization` cascades through everything owned by it
  (confirmed via the `onDelete: Cascade` / `SetNull` choices throughout
  `schema.prisma`). If a landlord's account is ever supposed to be fully
  removable, the plumbing for that mostly already exists at the database
  level.
- **Per-record deletion is inconsistent.** Documents can be deleted one at a
  time by staff. Tenants, applications, and screening requests currently
  cannot be deleted individually at all through the app — only edited or
  status-changed. A tenant who leaves and asks for their data to be removed
  has no self-service or staff-facing path to that today short of deleting
  the whole organization (not appropriate) or a direct database edit (not
  something support should be doing by hand).
- **No automatic expiry anywhere.** Consent tokens, invite tokens, and
  password-reset tokens all *functionally* expire (the app refuses an
  expired one), but the *rows* recording them are never cleaned up.

## Open questions for legal review

These are the ones worth an actual legal answer rather than an engineering
guess:

- Does a landlord's own record-keeping obligation (state-specific — some
  states require rental application/screening records be kept a minimum
  number of years) conflict with an honored deletion request? If so, which
  wins, and does the app need a "retain but restrict" state distinct from
  full deletion?
- Is a formal Data Processing/Subprocessor list needed for the providers
  this app already depends on (Stripe, Plaid, Cloudflare, whichever
  screening provider gets picked) — relevant if any tenant/applicant is a
  CCPA- or GDPR-adjacent resident.
- What's the actual retention window, if any, for: a declined/withdrawn
  rental application; a completed tenant screening result; a document filed
  against a tenant after their lease ends; emails logged in `NotificationLog`.
- Does anything here trigger a state's data-breach notification law
  differently than a "normal" SaaS app would, given SSNs/bank tokens are in
  scope (item 1 and 3 above)?

## What I'd build once the above has answers

Not started — this is what a real policy would need translated into code:

- A scheduled job (same shape as the existing rent-run/bank-sync crons) that
  purges rows past whatever retention window gets decided, starting with the
  highest-risk categories (Document Vault `IDENTIFICATION`/`TAX` files,
  `ScreeningRequest` results).
- A single "export and delete everything for this person" action, spanning
  `Tenant`, `Application`, `ScreeningRequest`, `Document`, and
  `NotificationLog` rows that reference them — the cross-table version of
  what cascade deletes already do at the organization level.
