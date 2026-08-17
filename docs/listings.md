# Listings & syndication

Why there's a `ListingPlatformConnection` model with an encrypted API-key
field that nothing reads, and what "syndication" actually means in this app
today versus what a landlord might expect from Zillow/Realtor.com/Zumper/
Apartments.com.

**Not legal or business advice.** The URLs and process description below
reflect ordinary public information about how these platforms work as of
this writing; none of it is confirmed by a relationship with any of them.

## Why there's no live push to Zillow, Realtor.com, Zumper, or Apartments.com

None of these platforms hand out a public API key the way Stripe or Plaid
do. Programmatic listing syndication — what a tool like Innago does — runs
through each platform's own **listing-software partner program**: a real
business application, a vetting process, and (for some) a data-sharing
agreement, not something a piece of software can self-serve into. That's a
business relationship the organization using this app has to pursue
directly with each platform; it isn't something this codebase can create on
someone's behalf.

Zillow does offer **Zillow Rental Manager**, where any individual landlord
can manually post one listing on their own site (syndicated from there to
Trulia and HotPads too) — no partnership required, just a web form. That's
the "Open Zillow ↗" link on each listing's syndication row: it goes to
Rental Manager, not to anything this app operates.

## What's actually built

- **Listing** (`src/actions/listings.ts`, `/app/listings`) — per-unit
  marketing copy: title, description, amenities, asking rent, availability,
  photos. Independent of `Application` (the intake form a prospect fills
  out) and `Lease`.
- **The copy-paste export** (`buildListingExportText` in
  `src/lib/listing.ts`) — one well-formatted plain-text block combining
  everything above, put on the clipboard by the "Copy for X" buttons. Not
  tuned per platform (character limits, required fields) — those specifics
  change without notice and this app has no way to verify them, so one
  honest, complete block beats guessing at four slightly different formats.
- **ListingSyndication** — a manual tracker, one row per platform per
  listing, created automatically alongside the listing. Staff record
  status (Not posted / Posted / Needs refresh) and paste in the live URL
  once they've posted by hand. This is bookkeeping, not automation: nothing
  here talks to Zillow, Realtor.com, Zumper, or Apartments.com over the
  network.
- **ListingPlatformConnection** (`/app/settings/listing-syndication`,
  admin-only to edit) — one row per organization per platform, holding a
  free-text account label, notes, and an **encrypted** feed ID/API key
  field (reusing `src/lib/token-encryption.ts`, the same AES-256-GCM helper
  BankConnection's Plaid token uses). Nothing in this codebase reads
  `apiKeyEncrypted` today. It exists purely so that if an organization is
  approved as a partner by one of these platforms, there's already
  somewhere for that credential to live — recording it isn't also a schema
  migration when a real push feature ships. The settings form never
  displays a saved key back to the browser (see
  `ListingConnectionForm`/`updateListingPlatformConnectionAction`): a blank
  submission leaves it untouched, and clearing it requires an explicit
  checkbox, so saving an unrelated field can't silently wipe a stored key.

## What a real integration would need later

Wiring up an actual push for any one of these platforms, once approved,
would mean: an API client for that platform (mirroring `src/lib/plaid.ts`'s
shape — a thin wrapper plus an `xEnabled()` check gating it), a job that
reads the org's `ListingPlatformConnection.apiKeyEncrypted`
(`decryptToken`) and the `Listing` record, and a status callback updating
the matching `ListingSyndication` row instead of staff doing it by hand.
Because the data model already separates "the listing," "the org's
credential," and "the per-platform tracking row," that's additive — it
doesn't require restructuring anything built now.
