> **DRAFT — not reviewed by an attorney, not live anywhere in the app yet.**
> This exists to get the actual review process moving (see `docs/ROADMAP.md`
> Phase 1), not to be pasted into production. Every `[BRACKETED]` value is a
> placeholder. Written originally for ComfyLease's actual feature set — not
> copied from any competitor's terms; a couple of provisions (the payment
> reserve/chargeback clause in particular) are shaped by what's standard for
> any software that moves rent money, the same reason a competitor like
> Innago carries similar language, not because their text was reused.
>
> **What still has to happen before this is real:**
> 1. Form the business entity this contract names as the counterparty — see
>    the note in §1.
> 2. A lawyer licensed in your state reads this and rewrites what needs
>    rewriting. Property management touches tenant screening law, security
>    deposit law, and money transmission at the state level — all three vary
>    by state and none of them are things to get wrong.
> 3. Pair it with a real Privacy Policy (`docs/ROADMAP.md` has this as a
>    companion item) — Plaid and Stripe both require one before production
>    access, and this Terms draft assumes one exists and links to it.
> 4. Wire acceptance into the signup flow — a checkbox, a stored timestamp +
>    version, and footer links. Nothing in the app today records that anyone
>    agreed to anything. See the implementation note at the bottom of this
>    file.

# Terms of Service

**Effective date:** [EFFECTIVE DATE]
**Last updated:** [EFFECTIVE DATE]

These Terms of Service ("**Terms**") are a contract between you and
[COMPANY NAME], a [STATE] [ENTITY TYPE — e.g. limited liability company]
("**ComfyLease**," "**we**," "**us**") governing your access to and use of
the ComfyLease property management platform, including our website, web
application, and any related services (collectively, the "**Service**").

By creating an account, accepting an invitation to join an organization on
ComfyLease, or otherwise using the Service, you agree to these Terms. If you
are agreeing on behalf of a company or other organization, you represent
that you have authority to bind that organization, and "you" refers to both
you and that organization.

If you do not agree to these Terms, do not use the Service.

## 1. Who we are, and who you're contracting with

The Service is operated by [COMPANY NAME] ("**ComfyLease**"), located at
[BUSINESS ADDRESS].

> **Implementation note:** this section cannot be finalized with a real
> company name until one is formed. Operating a service that collects and
> moves rent payments as an individual, with no entity in between, means
> personal assets carry the liability directly — this is worth resolving
> before, or at the very latest alongside, finalizing this document.

## 2. Who can use ComfyLease

You must be at least 18 years old and able to form a binding contract to use
the Service. By using the Service you represent that this is true and that
all information you provide is accurate.

ComfyLease is built around **organizations** — a property management
company, individual landlord, or ownership group. Everyone who uses the
Service does so through one of these roles:

- **Admin** — full control of an organization's settings, billing, team, and
  data.
- **Staff** — day-to-day property, tenant, lease, and rent management on
  behalf of an organization.
- **Owner** — read-only access to financial reporting for properties an
  organization has explicitly shared with them.
- **Tenant** — access to a resident portal for a specific lease: viewing
  charges and payments, submitting maintenance requests, and signing lease
  documents.
- **Applicant** — a prospective tenant who submits a rental application
  through a public link. Applicants do not create accounts; see §8.

Each role sees only the data the Service is designed to show it. You agree
not to attempt to access data or functionality outside your role.

## 3. Your account

You're responsible for maintaining the confidentiality of your login
credentials and for all activity that happens under your account. Tell us
immediately at [SUPPORT EMAIL] if you suspect unauthorized access.

Organizations are responsible for the accuracy of who they invite and what
role they grant. An Admin who invites someone as Staff is representing that
the person should have that level of access to the organization's tenants,
leases, and financial data.

## 4. Landlord and property-manager responsibilities

ComfyLease is a tool. It is not a lawyer, a property manager, or a
substitute for either. If you use the Service as a landlord, property
manager, or organization Admin/Staff member, you are solely responsible
for:

- Complying with all applicable landlord-tenant law, including notice
  periods, security deposit handling and limits, habitability standards,
  and eviction procedures in your jurisdiction.
- Complying with fair housing law — the federal Fair Housing Act and any
  state or local equivalent — in every decision you make using data in the
  Service, including application review, screening criteria, and pricing.
  ComfyLease does not review, approve, or vet your criteria or decisions.
- The accuracy of every lease term, charge, rent amount, and notice you
  generate or send through the Service.
- Determining whether and how to use any tenant screening results, if and
  when that feature becomes available, in compliance with the Fair Credit
  Reporting Act and any state equivalent.

ComfyLease's lease templates, generated documents, and any other content
the Service produces are **not legal advice**. Have your own attorney review
any lease template before relying on it in your jurisdiction.

## 5. Payments and rent collection

The Service supports several ways to record and collect rent: manual entry,
CSV import from a bank or spreadsheet, a connected bank feed (§6), and card
or bank payments processed through Stripe, Inc. ("**Stripe**").

- **ComfyLease is a technology provider, not a bank, money transmitter, or
  party to any lease.** We do not hold, custody, or have access to your or
  your tenants' funds. Payments made through the Service are processed
  entirely by Stripe under its own terms and Connected Account agreement,
  which you must separately accept to enable payment collection.
- [COMPANY NAME]'s share of any transaction (the "**platform fee**") is
  disclosed to you before you enable payment collection and reflected in
  Stripe's transaction records. [PRICING — placeholder pending §14/business
  decision.]
- **Disputes and chargebacks.** If a tenant disputes a payment and the
  dispute is resolved in the tenant's favor, you authorize us and Stripe to
  reverse the corresponding transaction, and you agree not to independently
  reprocess or attempt to collect that same payment outside the Service
  without resolving the underlying dispute.
- **Reserves.** If we reasonably suspect fraud, a pattern of disputed
  transactions, or a violation of these Terms connected to your use of
  payment collection, we may, to the extent permitted by our agreement with
  Stripe, delay a payout or request that a reserve be held against future
  disputes until the matter is resolved. This is a fraud-and-risk
  protection, not a routine practice, and we'll tell you if it happens to
  your account and why.

## 6. Connected bank accounts

If you connect a bank account for automatic transaction import, that
connection is made through Plaid Inc. ("**Plaid**") under Plaid's own end
user terms, which you'll be asked to accept separately in Plaid's
connection flow. The access is **read-only** — the Service can see
transaction history to help you reconcile payments; it cannot move money
out of a connected account. You can revoke the connection at any time from
Settings, which immediately stops any further access.

## 7. Electronic signatures and records

ComfyLease lets organizations generate lease documents and collect
electronic signatures from landlords and tenants inside the Service.

By typing your name to sign a document through the Service, you agree that:

- Your electronic signature has the same legal effect as a handwritten
  signature, to the extent permitted by the U.S. Electronic Signatures in
  Global and National Commerce Act (ESIGN) and applicable state law (e.g.
  UETA).
- You consent to receive the signed document and related records
  electronically rather than on paper, and you confirm you're able to
  access, view, and retain electronic records (a working email address and
  a standard web browser).
- You may withdraw consent to electronic records for a specific transaction
  before signing by contacting the organization you're leasing from
  directly; withdrawing consent after signing does not undo a signature
  already given.

We keep a record of who signed, when, and from what account for every
document signed through the Service.

## 8. Rental applications

A prospective tenant can submit a rental application through a public link
tied to a specific vacant unit, without creating an account. Application
data — name, contact information, self-reported income, and any other
fields the organization asks for — is visible only to the organization that
owns the unit and is used solely to evaluate that application. See §4 for
the organization's fair-housing obligations in using it.

## 9. Listings

ComfyLease can help an organization prepare a listing (description,
photos, amenities, and asking rent) and track its posting status across
outside platforms (Zillow, Realtor.com, Zumper, Apartments.com, and
similar). **This is a manual tracking tool.** ComfyLease does not
automatically post, syndicate, or push a listing to any third-party
platform, and makes no guarantee about whether, when, or how any outside
platform displays a listing an organization has posted there itself.

## 10. Maintenance and vendors

The Service lets an organization log maintenance requests, keep a directory
of contractors and vendors, and assign requests to them for tracking
purposes. **ComfyLease is not a party to, and does not review, approve, or
warrant, any agreement, license, insurance, or work performed by any vendor
listed in the Service.** Vetting, hiring, and paying vendors is entirely
between the organization and the vendor.

## 11. Your content

You retain ownership of everything you or your tenants upload or enter into
the Service — property details, photos, lease text, maintenance photos,
notes, and similar content ("**Your Content**"). You grant ComfyLease a
non-exclusive, worldwide license to host, store, process, and display Your
Content solely to operate and provide the Service to you and to those you've
given access to it (e.g. a tenant seeing their own lease). We don't use Your
Content to train models or share it outside your organization except as
this section or our Privacy Policy describes.

You're responsible for having the right to upload what you upload, and for
it not violating anyone else's rights or applicable law.

## 12. Acceptable use

You agree not to:

- Use the Service to violate any law, including fair housing, fair credit
  reporting, or data privacy law.
- Access or attempt to access another organization's data, or another
  user's account, without authorization.
- Upload malicious code, attempt to interfere with the Service's operation,
  or circumvent any access control or rate limit.
- Use the Service to harass, defraud, or discriminate against a tenant or
  applicant.
- Scrape, resell, or provide third-party access to the Service outside of
  the roles and features it's designed to support.

We may suspend or terminate access for a violation of this section,
including without advance notice where necessary to protect other users or
the Service.

## 13. Intellectual property

ComfyLease, its logo, and the software underlying the Service are owned by
[COMPANY NAME] and protected by intellectual property law. These Terms
don't grant you any right to our trademarks, branding, or source code
beyond what's needed to use the Service as intended.

## 14. Fees

[PLACEHOLDER — pricing model not yet finalized; see `docs/ROADMAP.md`
"Decide how ComfyLease actually makes money." This section needs the real
structure once decided: subscription, per-unit, per-transaction, or a
combination, including how changes to pricing are communicated and how
much notice is given before a change takes effect.]

## 15. Disclaimers

THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE," WITHOUT WARRANTY OF ANY
KIND, EXPRESS OR IMPLIED, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE, OR NON-INFRINGEMENT. WE DON'T WARRANT THAT THE
SERVICE WILL BE UNINTERRUPTED, ERROR-FREE, OR SECURE, OR THAT ANY LEASE
TEMPLATE, GENERATED DOCUMENT, OR SCREENING RESULT (IF APPLICABLE) IS
ACCURATE, COMPLETE, OR LEGALLY SUFFICIENT FOR YOUR JURISDICTION. NOTHING IN
THE SERVICE IS LEGAL, FINANCIAL, OR TAX ADVICE.

## 16. Limitation of liability

TO THE MAXIMUM EXTENT PERMITTED BY LAW, [COMPANY NAME] AND ITS OFFICERS,
EMPLOYEES, AND AFFILIATES WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL,
SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS, RENT,
OR DATA, ARISING OUT OF OR RELATED TO YOUR USE OF THE SERVICE, EVEN IF
ADVISED OF THE POSSIBILITY OF SUCH DAMAGES. OUR TOTAL LIABILITY FOR ANY
CLAIM ARISING FROM THE SERVICE WILL NOT EXCEED THE GREATER OF (A) THE FEES
YOU PAID US IN THE 12 MONTHS BEFORE THE CLAIM AROSE, OR (B) [$100 /
PLACEHOLDER]. SOME JURISDICTIONS DON'T ALLOW THIS KIND OF LIMITATION, SO IT
MAY NOT APPLY TO YOU IN FULL.

## 17. Indemnification

You agree to defend, indemnify, and hold harmless [COMPANY NAME] from any
claim, loss, or expense (including reasonable attorneys' fees) arising from:
your use of the Service, Your Content, your violation of these Terms, your
violation of any law (including landlord-tenant or fair housing law), or a
dispute between you and a tenant, applicant, owner, or vendor.

## 18. Term and termination

These Terms apply for as long as you use the Service. You may stop using
the Service and close your account at any time. We may suspend or
terminate your access for a material breach of these Terms, including
§12, or if required by law.

Ending your access to the Service does not delete financial records your
organization is legally required to retain; see the Privacy Policy for how
long we keep data after an account closes.

## 19. Changes to these Terms

We may update these Terms as the Service changes. If a change is material,
we'll notify you — by email or an in-app notice — before it takes effect.
Continuing to use the Service after a change takes effect means you accept
the updated Terms.

## 20. Governing law and disputes

These Terms are governed by the law of the State of [STATE], without regard
to its conflict-of-law rules.

[DISPUTE RESOLUTION MECHANISM — PLACEHOLDER. Common options here are (a)
ordinary litigation in the courts of [STATE], or (b) binding individual
arbitration with a class-action waiver. This is a real strategic choice,
not boilerplate — arbitration limits your own future ability to bring or
face a class action, and needs your lawyer's input, not a default.]

## 21. Miscellaneous

If any part of these Terms is found unenforceable, the rest remains in
effect. These Terms, together with the Privacy Policy and any
service-specific terms (Stripe's, Plaid's), are the entire agreement
between you and ComfyLease regarding the Service. You may not assign these
Terms without our consent; we may assign them in connection with a merger,
acquisition, or sale of assets. Our failure to enforce a provision isn't a
waiver of it.

## 22. Contact

Questions about these Terms: [SUPPORT EMAIL] or [BUSINESS ADDRESS].

---

## Implementation notes (not part of the Terms — delete before publishing)

What it takes to make this a real, binding document a user has actually
agreed to, not just a page that exists:

1. **A "not yet formed" entity is the actual blocker on §1, §16, and §17
   meaning anything.** Damage caps and indemnification only protect an
   entity — a sole proprietor collecting rent has no shield to point to.
2. **Acceptance needs to be recorded, not implied.** Nothing in the schema
   today stores "who agreed to which version of the Terms, when." A
   `termsAcceptedAt` / `termsVersion` pair on `User` (or a small
   `TermsAcceptance` table if you want a full audit trail across versions)
   is the right shape — checked at signup, and re-shown/re-recorded when
   §19's "material change" actually happens.
3. **The signup form has no checkbox today.** `src/app/(auth)/signup/` — a
   required, unchecked-by-default checkbox linking to this document and the
   Privacy Policy, blocking submission until checked.
4. **Nowhere in the app links to this document at all** — footer, signup,
   and probably a settings page for existing orgs to re-read it.
5. **This needs a sibling Privacy Policy before either goes live** — §5,
   §6, and §11 all promise things (Stripe processes payments, Plaid access
   is read-only, content isn't used to train models) that a real Privacy
   Policy needs to also say, in the detail Plaid/Stripe require for
   production approval.

None of the above is done yet — flagging it here so it's an explicit next
step, not a surprise later.
