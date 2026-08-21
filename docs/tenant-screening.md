# Tenant screening

The single biggest feature gap versus Innago identified in `docs/ROADMAP.md`.
This is the framework piece — a real consent flow and a place to record what
came back — not a live credit-bureau/background-check integration. See
"What's deliberately not here" before assuming it does more than it does.

## What it is

- On an application's detail page, a "Screening" card lets staff request a
  screening (credit, background, eviction — pick any combination) with one
  click. Nothing is pulled at that point.
- The applicant gets emailed a link to `/screening/[token]` — a standalone
  FCRA-style disclosure and a consent/decline choice. This is the
  "permissible purpose" a landlord legally needs before pulling a consumer
  report on someone, and it's a real choice: declining doesn't block the
  rest of the application review.
- Consenting or declining records an ESIGN-style audit trail — timestamp, IP
  address, user agent — the same fields `LeaseSignature` already records for
  e-signatures, and for the same reason: "the applicant agreed" needs to be
  demonstrable later, not just asserted.
- Once consent is given, staff run the actual report **outside this app** —
  today, that means through a screening provider's own dashboard (Certn,
  Checkr, SmartMove, or a local screening company), or however the org
  already gets background checks done — and record the outcome: a free-text
  summary and an optional link to the full report. That flips the request to
  Completed.
- Staff can cancel a request that's still awaiting consent (picked the wrong
  report types, applicant asked to hold off), and can start a fresh request
  once one is declined, canceled, or completed.

## Before this touches a real applicant

**The FCRA disclosure text in `src/lib/screening.ts`
(`FCRA_DISCLOSURE_PARAGRAPHS`) is a template, not legal advice.** It names
the general shape the Fair Credit Reporting Act requires — a standalone
disclosure, what's being pulled, why, and the applicant's rights — but it
has not been reviewed by a lawyer, doesn't account for state-specific
requirements (several states require additional disclosures beyond federal
FCRA), and `[ORGANIZATION NAME]` is the only placeholder filled in
automatically. Get it reviewed before sending it to a real applicant, the
same way `docs/legal/terms-of-service.md` and `docs/legal/privacy-policy.md`
need review before they're live. The request form on the application page
carries a reminder of this for whoever's about to click "Request screening."

**This app is not a consumer reporting agency and doesn't act as one.** It
never pulls, stores, or transmits an actual credit report, criminal record,
or eviction record — `resultSummary` is whatever staff choose to type in,
and `reportUrl` just links out to wherever the real report lives. That's a
deliberate boundary, not a missing feature: becoming a CRA (or acting as one)
carries its own regulatory weight this app has made no attempt to take on.

## What's deliberately not here

- **No live provider integration.** `ScreeningRequest.provider` defaults to
  `"manual"` and exists so a real integration (Certn, Checkr, SmartMove all
  have APIs) has somewhere to plug in later — pulling a report
  automatically once consent is recorded, writing results back via webhook
  instead of a staff member typing them in. Nobody has picked a provider or
  written that integration yet; see the Phase 3 item in `docs/ROADMAP.md`.
- **No fee handling.** Real screening providers charge per report, usually
  passed to the applicant. Nothing here collects that fee — same
  manual-today boundary as the report itself.
- **No file upload for the report.** `reportUrl` is a link, not a stored
  PDF. Consistent with this app's own line on file storage (see
  `MAINTAINER.md` §13 on maintenance photos already living in D1) —
  screening reports are more sensitive than a maintenance photo, and
  storing them here before there's a real reason to is the wrong direction,
  not a missing convenience.
- **No screening column on the applications list page.** The status only
  shows on an application's own detail page. Worth adding once screening
  sees real use and staff want to see it at a glance across a list.
- **No re-notification / reminder if an applicant never responds to the
  consent link.** Staff can cancel and re-request, which re-sends the
  email, but nothing nudges automatically.
- **No jurisdiction-specific handling.** Some states (and NYC specifically)
  restrict criminal-history screening timing/use beyond what FCRA requires.
  This framework has no awareness of that — it's a generic US federal-FCRA
  shape, and the org running it is responsible for whatever else applies to
  where they operate.

## Access

Requesting screening, canceling a request, and recording results are all
staff-level (`assertStaff`), same as everything else on the application
review flow. The consent page itself is intentionally public and
unauthenticated — the applicant has no account — reached only by the
unlisted token in their email, same pattern as `/apply/[unitId]` and
`/invite/[token]`, and rate-limited by IP the same way (`SCREENING_CONSENT_RATE_LIMIT`
in `wrangler.jsonc`).
