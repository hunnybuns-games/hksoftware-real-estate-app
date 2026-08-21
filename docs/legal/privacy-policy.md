> **DRAFT — not reviewed by an attorney, not live anywhere in the app yet.**
> Companion to `docs/legal/terms-of-service.md` — see that file's banner for
> the shared caveats (entity not yet formed, needs a lawyer, needs to be
> wired into signup). Every `[BRACKETED]` value is a placeholder.
>
> Written to describe what ComfyLease's code **actually does** today, not a
> generic template — checked against the codebase while drafting, not
> assumed. That cuts both ways: a couple of sections below are shorter than
> what you'd see from a bigger competitor, on purpose, because the thing
> they're disclosing doesn't exist here. See "What's deliberately different
> from a typical SaaS privacy policy" below.
>
> **What still has to happen before this is real** — same list as the Terms:
> form the entity, get a lawyer's review, wire an acceptance checkbox into
> signup, and decide the GDPR question flagged in §11 before this covers
> international users it currently doesn't.

# Privacy Policy

**Effective date:** [EFFECTIVE DATE]
**Last updated:** [EFFECTIVE DATE]

This Privacy Policy explains what personal information [COMPANY NAME]
("**ComfyLease**," "**we**," "**us**") collects through the ComfyLease
property management platform (the "**Service**"), why we collect it, who we
share it with, and the choices you have. It's a companion to our
[Terms of Service](./terms-of-service.md); terms defined there (Admin,
Staff, Owner, Tenant, Applicant, Organization) mean the same thing here.

By using the Service, you acknowledge this Privacy Policy. If you don't
agree with it, don't use the Service.

## 1. Information we collect

**Directly from you.** Name, email address, phone number, and password (we
store a hashed version, never the password itself) when you create an
account or are invited to one. If you're a rental applicant, whatever your
prospective landlord's application form asks for — typically name, contact
information, desired move-in date, number of occupants, and self-reported
income. **We do not currently collect Social Security numbers, driver's
license numbers, or similar government ID numbers anywhere in the Service.**
(If tenant screening ships as a feature in the future, that will change for
that specific flow, and this policy will be updated before it does — see
§11's placeholder and `docs/ROADMAP.md`.)

**Content you upload.** Property and lease details, maintenance request
photos and descriptions, vendor contact information, lease document text,
and typed signatures on documents you sign through the Service.

**Payment and bank information — mostly not by us.** If your organization
enables online rent collection, card and bank account details are entered
directly into Stripe, Inc.'s ("**Stripe**") own hosted forms — they don't
pass through our servers. If you connect a bank account for transaction
import, that connection and your banking credentials go directly to Plaid
Inc. ("**Plaid**"); we never see your bank login, only the read-only
transaction and account data Plaid shares with us afterward, which we store
with an encrypted access token, not raw credentials. See §5.

**Automatically, from using the Service.** Standard request metadata our
hosting provider (Cloudflare) sees to operate and secure the Service — IP
address, browser type, timestamps — the same information any web server
sees when a browser makes a request. We use this for security purposes
(for example, rate-limiting repeated failed login attempts) and basic
operational logging, not for advertising or behavioral tracking. See §6 for
what this does and doesn't include.

## 2. How we use information

- To operate the Service: authenticate you, show you the data your role is
  allowed to see, process rent payments and reconcile them, generate and
  route lease documents for signature, and send the emails the Service is
  built around (an invitation, a payment receipt, a maintenance update).
- To secure the Service: detect and block suspicious login activity,
  encrypt sensitive credentials at rest, and investigate abuse reported
  under our Terms of Service.
- To provide support when you contact us.
- To meet legal and financial record-keeping obligations — some of the data
  the Service handles (rent payment history, lease terms) has retention
  requirements that vary by state, which your organization is responsible
  for understanding; see the Terms of Service §5.

**We do not use your information to train AI models, and we do not sell,
rent, or trade it to anyone for their own marketing purposes.** See §9 for
the one narrow, opt-in exception (case studies).

## 3. How we share information

- **If you're a Tenant or Applicant, your information is shared with the
  Organization** (landlord or property manager) whose unit or lease you're
  connected to — that's the entire purpose of the Service. It is not shared
  with any other Organization on ComfyLease.
- **With the service providers who make the Service work** — see §5 for
  exactly who, and what each one sees.
- **If required by law** — in response to a subpoena, court order, or
  similar legal process, or where we believe in good faith it's necessary
  to prevent harm or fraud.
- **In a merger, acquisition, or sale of assets** — your information may
  transfer as part of that transaction, subject to this Policy continuing
  to apply to it (or you being notified of a replacement policy first).

We do not share your information for cross-site advertising, and we don't
participate in ad networks or third-party ad exchanges — the Service
doesn't run advertising of any kind.

## 4. Cookies and similar technology

Unlike a lot of software you'll compare us to, ComfyLease **does not use
advertising or cross-site tracking cookies, and does not run analytics
scripts like Google Analytics or session-replay tools.** There's no
marketing pixel and no remarketing to worry about opting out of, because
none of it is there.

What the Service does use:

- **A session cookie**, set by our authentication system, that keeps you
  signed in. It's required for the Service to function and can't be turned
  off without signing out.
- **Local browser storage** (not a cookie) for your light/dark theme
  preference — it stays on your device and is never sent to us.

[PLACEHOLDER — if a cookie-consent banner is legally required in your
jurisdiction once this goes live with real users, the strictly-functional
cookie above likely qualifies for the "strictly necessary, no consent
required" exception most cookie laws carve out — confirm with counsel
before relying on that, especially if EU/UK users are ever in scope; see
§11.]

## 5. Who we share data with, and why

These are the outside companies the Service relies on. Each one only
receives the data it needs to do its specific job:

| Who | What they receive | Why |
|---|---|---|
| **Stripe** | Payment card/bank details entered at checkout, transaction amounts | Processes rent and fee payments; we never see or store full card or bank account numbers |
| **Plaid** | Bank login (directly, not through us), then read-only transaction history | Powers the optional connected bank feed for automatic payment matching |
| **Mapbox** | The address you type into a property's address field | Live address suggestions; only sent if your organization has this feature enabled |
| **Cloudflare** | Everything, as our hosting/CDN and database provider | Runs the Service itself — the database, the web servers, outbound email |
| **[EMAIL PROVIDER — Resend, if used]** | Recipient email address and message content | Delivers transactional email (invitations, receipts, notifications) when Cloudflare's own email service isn't configured |

Each of these providers has its own privacy policy governing data it
collects directly from you (most relevantly, Stripe's and Plaid's — you'll
be shown and asked to accept those separately when you use either).

## 6. What we don't collect

Worth being specific, not just reassuring: the Service does not collect
your precise geolocation, does not access your device's camera, microphone,
or contacts beyond a file you deliberately choose to upload (a maintenance
photo), and does not read the content of any device outside the browser tab
the Service is open in.

## 7. Data retention

While your account or your organization's account is active, we keep your
information to provide the Service. After an account is closed:

- [RETENTION PERIOD — PLACEHOLDER, e.g. 1 year] for most account data,
  after which it's deleted or anonymized.
- Financial records (payment and charge history) may be kept longer where
  your organization has its own legal obligation to retain them — that
  retention is the organization's responsibility, not a default we impose
  on your behalf.
- Backups may retain deleted data for a limited additional period before
  they themselves are rotated out.

## 8. Security

Specific to what's actually built, not a generic promise:

- Passwords are hashed (bcrypt), never stored in plain text.
- Sensitive credentials — your organization's Plaid access token and any
  listing-platform API keys — are encrypted at rest (AES-256-GCM) and never
  displayed back to you once saved.
- Every permission check (who can see which property, tenant, or payment)
  is verified live against the database on each request, not trusted from a
  session token alone — so revoking someone's access takes effect
  immediately, not after their session expires.
- Login, signup, and password-reset attempts are rate-limited to slow down
  automated abuse.
- All traffic to the Service is encrypted in transit (HTTPS).

No system is perfectly secure, and we can't guarantee that information you
transmit to us will never be intercepted or accessed without authorization.
If we experience a breach involving your personal information, we'll notify
you and any legal authority required, consistent with applicable law.

## 9. Case studies and testimonials (opt-in only)

If we ever ask to feature your organization's story publicly, we'll ask you
directly and use only what you agree to share. Nothing about your account,
your tenants, or your data is used this way without that separate,
affirmative agreement.

## 10. Children's privacy

The Service isn't directed to, and we don't knowingly collect information
from, anyone under 18. If you believe a child has provided us information,
contact us at [SUPPORT EMAIL] and we'll delete it.

## 11. International users and GDPR

[PLACEHOLDER — this Policy is currently written for a U.S. audience and
doesn't include a GDPR-specific rights section (access, erasure, data
portability, an EU representative, legal basis for processing, etc.). If
ComfyLease has, or expects to have, users located in the EU/EEA/UK, that
section needs to be added — and more importantly, the actual mechanics
behind it (a documented process for fulfilling a deletion or export
request) need to exist before the policy promises them. Don't add the
language before the process exists.]

## 12. California privacy rights

This section applies to California residents, under the California
Consumer Privacy Act ("**CCPA**").

**We do not sell or share personal information**, as those terms are
defined under the CCPA — there is no advertising business here for that
data to feed. California residents have the right to request:

- What categories of personal information we've collected about them and
  why.
- A copy of the specific personal information we hold about them.
- Deletion of their personal information, subject to exceptions (for
  example, records your organization is legally required to retain).

To exercise any of these rights, contact us at [SUPPORT EMAIL]. We won't
discriminate against you for exercising them.

## 13. Your choices

- **Access and correction.** Most of your information is visible and
  editable directly in the Service (your profile, your organization's
  property and tenant records). For anything that isn't, contact us.
- **Account deletion.** Contact [SUPPORT EMAIL] to close your account. See
  §7 for what happens to data afterward.
- **Email preferences.** Transactional email (a payment receipt, a lease
  ready to sign) can't be turned off while your account is active — it's
  how the Service tells you things you need to know. [If/when any
  optional marketing email exists, an unsubscribe link goes here —
  PLACEHOLDER, not built today.]

## 14. Changes to this Policy

We'll post any changes here with an updated "Last updated" date, and email
you if a change is material. Continuing to use the Service after a change
takes effect means you accept the updated Policy.

## 15. Contact

Questions about this Policy, or to exercise any right described above:
[SUPPORT EMAIL] or [BUSINESS ADDRESS].

---

## What's deliberately different from a typical SaaS privacy policy

Read against a bigger competitor's privacy policy while drafting this one,
specifically to check for gaps — same approach as the Terms of Service, and
the same rule: nothing here is copied or reworded from theirs. A few things
in a document like that don't appear here, on purpose, because they'd be
false for this app:

- **No analytics, no ad tech, no cookie table.** A larger competitor's
  policy can run to a dozen named cookies across Google Analytics, Heap,
  and Microsoft Clarity, plus a remarketing/advertising disclosure. This
  app has none of that integrated — §4 says so directly rather than
  including an empty table.
- **No AI-processing disclosure.** Some competitors run lease documents
  through a third-party AI service for extraction and disclose that
  explicitly. ComfyLease doesn't have an AI-powered feature that sends your
  documents to a model provider — nothing to disclose, so nothing is
  disclosed.
- **No GDPR section, deliberately flagged rather than assumed.** Writing a
  full EU-rights section for a product that hasn't decided whether it
  serves EU users, and hasn't built the process to actually honor those
  rights, would be a promise with nothing behind it — worse than not
  addressing it. §11 flags this as an open decision instead.

## Implementation notes (not part of the Policy — delete before publishing)

1. Same entity/lawyer/signup-checkbox dependencies as the Terms of Service
   — see that file.
2. **§5's provider table needs a final pass once EMAIL_FROM/RESEND_API_KEY
   are actually configured in production** — right now it hedges with
   "if used" because `.env.example` documents both as optional and this
   doc can't assume which is live. Same audit as `docs/ROADMAP.md`'s
   "Start here" callout would resolve this.
3. **§7's retention period is a placeholder guess (1 year)** — pick a real
   number, ideally after checking what retention your state's
   landlord-tenant and financial record-keeping laws actually require as a
   floor.
4. **If tenant screening ships**, this Policy needs a real update before
   that feature goes live, not after — it will be the first time the
   Service collects government ID numbers, and §1's current "we don't
   collect these" statement needs to change at the same time the feature
   does, not weeks later.
