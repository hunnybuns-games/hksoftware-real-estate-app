# Lease builder & e-signature

How a lease document gets generated, sent, and signed — and the reasoning
behind a few choices that aren't obvious from the code alone.

**Not legal advice.** The template text, the clause catalog, and the
signature-audit-trail design below were chosen to be a reasonable starting
point for a small US landlord, not reviewed by a lawyer for any specific
state. See the caveat at the end.

## The three models

`prisma/schema.prisma` — `LeaseTemplate`, `LeaseDocument`, `LeaseSignature`:

- **LeaseTemplate** is the org's reusable base wording — one per
  organization today, lazily created on first use
  (`ensureDefaultTemplate` in `src/actions/lease-templates.ts`) and editable
  at **Settings → Lease template**. It's plain text with `{{token}}` merge
  fields, not HTML or markdown — the merged output is shown with
  `white-space: pre-wrap`, so there's no markup layer to sanitize or keep in
  sync with a renderer.
- **LeaseDocument** is a generated, *immutable snapshot* — once a document
  moves past `DRAFT`, its `body` never changes even if the template it came
  from is edited afterward. A tenant's signature has to apply to text that
  can't move out from under them.
- **LeaseSignature** is one row per required signer, created as an unsigned
  placeholder when the document is sent (`sendLeaseDocumentAction`) and
  filled in when that person actually signs. "Who's still outstanding" is
  always a query over this table (`signedAt IS NULL`), never separately
  tracked state.

## The merge engine

`src/lib/lease-document.ts` is deliberately simple and framework-free (see
its unit tests): `{{token}}` substitution, plus a fixed catalog of ~8
optional clauses (`LEASE_CLAUSES`) staff toggle per document — pets,
parking, smoking, subletting, utilities, maintenance responsibilities, right
of entry, late fee, governing law. Clauses are appended into a single
`{{additional_provisions}}` token rather than living inline in the
per-org-editable template text, so "which clauses does this org's lease
include" stays a fixed, auditable list instead of prose that can drift.

## What makes this an "electronic signature"

The US ESIGN Act (and state UETA statutes) don't require a notarized wet
signature — they require **intent to sign**, **consent to do business
electronically**, and a signature **attributable** to the signer, kept with
enough context to prove that later. The design maps directly onto that:

- **Intent & consent**: an explicit checkbox ("I have read this lease and
  intend the name above as my legal signature") is required before the
  submit button does anything — see `signSchema`/`countersignSchema` in
  `src/actions/lease-documents.ts`.
- **Attribution**: a typed legal name is always captured. A freehand drawing
  (`src/components/signature-pad.tsx`, a small dependency-free canvas — no
  signature-pad library) is optional on top of it, not instead of it.
- **Audit trail**: `LeaseSignature` records the signer's name/email, the
  timestamp, IP address (`CF-Connecting-IP`, same header
  `src/lib/rate-limit.ts` trusts — see its comment on why that header can't
  be spoofed), and user agent. `LeaseDocumentPaper`
  (`src/components/lease-document-paper.tsx`) renders that trail inline
  under each signature, so it travels with the printed/saved document, not
  just the database.

Staff countersign as the landlord's representative in the same step as
sending (`sendLeaseDocumentAction`) — there's no separate "landlord" user
account, so whoever clicks **Sign & send** is the landlord's signer of
record for that document.

## Why "print to PDF" instead of generating one

The download path is the browser's own Print → Save as PDF, not a
server-generated file. `src/components/app-shell.tsx` hides the app chrome
(sidebar/topbar) under `print:hidden` / `print:p-0` so the paper prints
cleanly; `LeaseDocumentPaper` always renders in light colors regardless of
the viewer's theme, since a legal document shouldn't come out on dark paper
because someone had dark mode on.

This was a deliberate trade-off, not a limitation: generating a real PDF
means either a native rendering dependency (fragile on Cloudflare Workers,
which is where this app actually runs — see `docs/MAINTAINER.md`) or a
pure-JS PDF library and its own layout engine to maintain. A styled print
view needs neither, and gets a tenant or landlord to the same PDF a laptop
or phone already knows how to produce.

## What this doesn't do

- **No delivery/certified-mail requirements** some states impose for lease
  termination or specific notices — this is a lease-signing flow, not a
  notices system.
- **No identity verification** beyond "logged into the resident portal" —
  the same trust level the rest of the portal (rent payment, maintenance
  requests) already runs on.
- **No state-specific clause review.** `DEFAULT_TEMPLATE_BODY` and
  `LEASE_CLAUSES` in `src/lib/lease-document.ts` are ordinary residential
  boilerplate, meant to be a starting point a landlord edits at
  **Settings → Lease template** for their state and situation — not
  something to hand a tenant unread.
