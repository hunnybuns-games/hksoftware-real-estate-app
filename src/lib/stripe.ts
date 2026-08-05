import Stripe from "stripe";

/**
 * Stripe Connect, destination-charge model.
 *
 * We never take custody of rent money. Each organization onboards its own
 * Express connected account; tenant payments are created on the platform with
 * `transfer_data.destination` pointing at that account, so funds settle into
 * the landlord's balance and Stripe handles payouts and KYC. This is what keeps
 * us out of money-transmitter territory — see docs/payments.md.
 *
 * Stripe is optional at runtime. With no key configured the app still works
 * end-to-end: staff record payments manually, and the tenant portal says
 * online payments aren't enabled yet. Never let a missing key crash a page.
 */

const secretKey = process.env.STRIPE_SECRET_KEY;

export const stripeEnabled = Boolean(secretKey);

let client: Stripe | null = null;

export function getStripe(): Stripe {
  if (!secretKey) {
    throw new Error(
      "Stripe is not configured. Set STRIPE_SECRET_KEY to enable online rent payments.",
    );
  }
  client ??= new Stripe(secretKey, {
    // Pinned to the version this SDK's types were generated against, so a
    // Stripe-side upgrade can't silently change payload shapes underneath us.
    // Bump this and the `stripe` dependency together, never separately.
    apiVersion: "2026-07-29.dahlia",
    appInfo: { name: "HK Software Property Management", version: "0.1.0" },
    // Stripe's default HTTP client uses Node's `http` module, which doesn't
    // exist inside a Cloudflare Workers isolate. The fetch-based client works
    // identically there and on a normal Node server, so it's used everywhere
    // rather than branching on runtime.
    httpClient: Stripe.createFetchHttpClient(),
  });
  return client;
}

/** Platform fee in basis points, e.g. 0 for none. Configurable, defaults to 0. */
function applicationFeeCents(amountCents: number): number | undefined {
  const bps = Number(process.env.STRIPE_APPLICATION_FEE_BPS ?? "0");
  if (!Number.isFinite(bps) || bps <= 0) return undefined;
  const fee = Math.round((amountCents * bps) / 10_000);
  return fee > 0 ? fee : undefined;
}

/**
 * Creates (or reuses) the org's Express account and returns an onboarding link.
 */
export async function createConnectOnboardingLink(args: {
  organizationId: string;
  organizationName: string;
  existingAccountId: string | null;
  email: string;
  returnUrl: string;
  refreshUrl: string;
}): Promise<{ accountId: string; url: string }> {
  const stripe = getStripe();

  let accountId = args.existingAccountId;
  if (!accountId) {
    const account = await stripe.accounts.create({
      type: "express",
      email: args.email,
      business_profile: { name: args.organizationName, mcc: "6513" }, // 6513 = real estate agents & managers
      capabilities: {
        transfers: { requested: true },
        us_bank_account_ach_payments: { requested: true },
        card_payments: { requested: true },
      },
      metadata: { organizationId: args.organizationId },
    });
    accountId = account.id;
  }

  const link = await stripe.accountLinks.create({
    account: accountId,
    type: "account_onboarding",
    return_url: args.returnUrl,
    refresh_url: args.refreshUrl,
  });

  return { accountId, url: link.url };
}

export async function getAccountStatus(accountId: string): Promise<{
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
}> {
  const account = await getStripe().accounts.retrieve(accountId);
  return {
    chargesEnabled: account.charges_enabled ?? false,
    payoutsEnabled: account.payouts_enabled ?? false,
    detailsSubmitted: account.details_submitted ?? false,
  };
}

/**
 * A Checkout Session for a rent payment.
 *
 * Checkout (rather than hand-rolled Elements) is a deliberate MVP call: it
 * handles the ACH mandate text, bank login via Financial Connections, and
 * microdeposit fallback — all of which are legally load-bearing and tedious to
 * rebuild. ACH is listed first because it's the cheap rail for a $1,800 rent
 * payment; cards are opt-in per org since 2.9% of rent is real money.
 */
export async function createRentCheckoutSession(args: {
  connectedAccountId: string;
  amountCents: number;
  leaseId: string;
  paymentId: string;
  tenantEmail: string;
  description: string;
  successUrl: string;
  cancelUrl: string;
  allowCards: boolean;
}): Promise<{ id: string; url: string }> {
  const stripe = getStripe();

  const methods: Stripe.Checkout.SessionCreateParams.PaymentMethodType[] = ["us_bank_account"];
  if (args.allowCards) methods.push("card");

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: methods,
    customer_email: args.tenantEmail,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: args.amountCents,
          product_data: { name: args.description },
        },
      },
    ],
    payment_intent_data: {
      description: args.description,
      // Destination charge: money lands on the platform then transfers to the
      // landlord's connected account.
      transfer_data: { destination: args.connectedAccountId },
      application_fee_amount: applicationFeeCents(args.amountCents),
      metadata: { leaseId: args.leaseId, paymentId: args.paymentId },
    },
    // Mirrored on the session so the webhook can reconcile from either object.
    metadata: { leaseId: args.leaseId, paymentId: args.paymentId },
    success_url: args.successUrl,
    cancel_url: args.cancelUrl,
  });

  if (!session.url) throw new Error("Stripe did not return a Checkout URL.");
  return { id: session.id, url: session.url };
}
