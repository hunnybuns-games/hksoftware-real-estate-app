# How money moves

`src/lib/stripe.ts` points here to explain why the platform never takes custody
of rent. This is that explanation, plus the reasoning behind the other payment
paths, so the next person to touch this code knows which constraints are
deliberate.

**Not legal advice.** The model below was chosen to avoid a specific regulatory
problem, but that choice is an engineering judgement and hasn't been reviewed by
a lawyer. See the caveat at the end.

## The problem being avoided

If a platform receives a tenant's rent into its own account and later pays it
out to the landlord, the platform is arguably transmitting money on someone
else's behalf. In the US that can require state-by-state money transmitter
licensing — a compliance burden far beyond what this app is built to carry.

The way out is to never hold the funds.

## Stripe Connect, destination charges

Each organization onboards its own **Stripe Express** connected account
(`createConnectOnboardingLink`). When a tenant pays, the PaymentIntent is
created on the platform with `transfer_data.destination` pointed at that
account:

```ts
payment_intent_data: {
  transfer_data: { destination: connectedAccountId },
  application_fee_amount: checkoutApplicationFeeCents(amountCents, allowCards),
}
```

Consequences, all intentional:

- **Funds settle into the landlord's Stripe balance**, and Stripe pays out to
  their bank on their schedule. The platform's balance is never the resting
  place for rent.
- **Stripe owns identity verification and payout compliance** for the connected
  account — that's what Express onboarding is doing, and why it's a hosted flow
  we redirect to rather than a form in this app.
- **The platform fee is the only money that ever accrues to us**, via
  `application_fee_amount`, controlled by `STRIPE_APPLICATION_FEE_BPS` and
  defaulting to zero — and, as of `checkoutApplicationFeeCents`, only ever
  charged on an ACH-only session. See the next section for why.

### ACH first, cards opt-in

`createRentCheckoutSession` lists `us_bank_account` before `card`, and only
includes cards when `STRIPE_ALLOW_CARDS=true`. Card processing runs about 2.9%
plus a fixed fee — on $1,800 of rent that's over $50 a month, per unit, which
is real money to hand a processor for a recurring, predictable, non-impulse
payment. ACH is the appropriate rail; cards exist as an escape hatch for a
landlord who wants to offer them anyway.

The fee decision (`STRIPE_APPLICATION_FEE_BPS`) is meant to apply to ACH
only — cards stay fee-free for now. But `application_fee_amount` is fixed on
the PaymentIntent at session creation, before the tenant has picked a method,
so a session that *offers* cards has no way to know yet which rail will
actually settle. `checkoutApplicationFeeCents` resolves that the safe way:
no fee at all on any session where `allowCards` is true, rather than risk
silently charging a card payment the ACH-only rate. The cost is a real one —
an org with cards enabled collects no platform fee even on the ACH payments
that come through it, until someone builds a way to collect the fee *after*
the webhook knows which method settled (a reversed Transfer pulling it back
from the connected account's balance is the standard Stripe pattern for
this). That's deliberately not built here: it would be new, untested Stripe
API surface, and there's no way to run it against a live Stripe test-mode
account from every environment this code gets touched in to verify it before
it ever handles real money. Build and verify it against a real test-mode
Connect account before `STRIPE_ALLOW_CARDS` is ever set to `true` anywhere.

### Why hosted Checkout rather than Elements

Checkout handles the ACH mandate text, bank login via Financial Connections,
and the microdeposit fallback. Those are legally load-bearing and tedious to
rebuild correctly. A bespoke Elements form would look nicer and would be a
worse decision.

### ACH means "submitted", not "paid"

This is the subtlety most likely to bite someone changing this code. A
`checkout.session.completed` for a bank debit does **not** mean the money
arrived — an ACH debit can fail days later. So:

- `PROCESSING` is a real, distinct payment state, surfaced in the UI as
  "Clearing" rather than collapsed into "Paid".
- `payment_intent.succeeded` is what promotes a payment to `SUCCEEDED`.
- `payment_intent.payment_failed` can arrive long after the tenant thought they
  were done, and reverses coverage the reconciliation engine had already
  credited — which is why the webhook re-runs `applyReconciliation` on failure
  as well as on success.

### The webhook is the only writer of Stripe-backed status

`src/app/api/stripe/webhook/route.ts` is the sole place that sets `status` on a
Stripe payment. `updatePaymentStatusAction` deliberately refuses to hand-edit
those rows: Stripe is the source of truth for anything it processed, and letting
staff override it locally would desync the two with no way to tell which is
right. Staff can edit manually-recorded payments freely, because for those the
app *is* the source of truth.

Every handler is written to be idempotent — Stripe redelivers, and a second
delivery must not send a second receipt or double-count a payment.

### Abandoned checkouts, and the one exception to the rule above

`startRentPaymentAction` writes a `PENDING` row *before* redirecting to Stripe,
so a tenant who bails leaves a visible trace rather than a mystery. The cost is
that closing the Checkout tab strands that row: Stripe does fire
`checkout.session.expired`, but not for ~24 hours. Until then the ledger shows
"Awaiting payment" rows nobody can clear, and a few abandoned attempts in a row
— easy on a slow bank login — read like unpaid rent.

`cancelPendingOnlinePaymentAction` is the out: a **Cancel** action on any
`PENDING` row on the lease page. It's the one place besides the webhook that
writes a Stripe-backed status, which is safe only because it never overrides
Stripe — it asks first. It reads the session's `status` and branches:

| Session | What happens |
|---|---|
| `open` | expired at Stripe, then the row is marked `FAILED` |
| `expired` | already dead; the row is marked `FAILED` |
| `complete` | **refused** — the tenant paid, the webhook just hasn't landed |

Reading `session.status` rather than pattern-matching a failed `expire()` call
is deliberate: those three values are documented API surface, error strings are
not, and being wrong in the `complete` direction loses a real payment. Same
reason it refuses outright if Stripe can't be reached, rather than assuming.
A row that already has a `stripePaymentIntentId` is refused too — at that point
Stripe has taken over and the rule above applies in full.

Locally there's no way to *get* a `PENDING` row without a Stripe key, so
`scripts/make-pending-payment.mjs` fabricates one against the seeded demo
tenant for exercising this by hand. The branch table above is pinned by
`src/actions/__tests__/cancel-pending-payment.test.ts`.

## The other payment paths

Stripe is one source among several, and the app is designed to work fully
without it. See `docs/MAINTAINER.md` §5 for the full picture.

| Path | Money movement | Who's the source of truth |
|---|---|---|
| Stripe Checkout | Tenant → landlord's connected account, platform never holds it | Stripe |
| Manual entry | Already happened offline (cash, check) | This app |
| CSV import | Already happened (bank/Venmo/Cash App/HAP statement) | The statement |
| Plaid bank feed | Already happened; read-only observation of the landlord's account | The bank |

The last three are all *recording* money that moved elsewhere, not moving it.
That distinction is why only the Stripe path has any regulatory exposure at
all, and why the bank feed uses Plaid's read-only Transactions product rather
than anything that can initiate a transfer.

## Deposits are not handled here

Security deposits are collected and returned outside this app today, and that's
deliberate — several states treat them as trust funds with their own account,
interest, itemisation, and return-deadline requirements. Adding deposit
collection is not a small feature; it's the point where the money-movement model
above stops being sufficient. Get advice first.

## Before going live

The destination-charge reasoning above is sound as far as it goes, but it is not
a legal opinion, and nobody qualified has reviewed it for this specific product.
Confirm it with counsel before charging a platform fee or touching deposits —
tracked as item 28 in the production punch list.
