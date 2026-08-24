import {
  Configuration,
  CountryCode,
  PlaidApi,
  PlaidEnvironments,
  Products,
  SandboxItemFireWebhookRequestWebhookCodeEnum,
} from "plaid";
import type { Transaction as PlaidRawTransaction } from "plaid";
import axios from "axios";

/**
 * Plaid Transactions — a read-only bank feed for the *owner's* receiving
 * account, distinct from Stripe (which collects from tenants). See
 * prisma/schema.prisma's BankConnection model for the stored side of this.
 *
 * Plaid is optional at runtime, same rule as Stripe in src/lib/stripe.ts:
 * with no key configured, owners just don't see the "Connect bank" option,
 * and the CSV import flow (Venmo/Cash App/bank statement upload) remains the
 * only way payments from those sources get recorded. Never let a missing key
 * crash a page.
 */

/**
 * Plaid's Node SDK makes its HTTP calls through axios, whose default Node
 * adapter reaches for node:http — the same class of problem Stripe's SDK had
 * (see the comment on Stripe.createFetchHttpClient() in src/lib/stripe.ts),
 * and the same fix: axios's fetch adapter works identically in Node and
 * inside a Cloudflare Workers isolate. This is handed to every PlaidApi call
 * below; the Node adapter is never reached.
 */
const fetchAxios = axios.create({ adapter: "fetch" });

/**
 * Read fresh on every call, deliberately — not cached in top-level `const`s.
 * On Cloudflare Workers, secrets only land in `process.env` once the first
 * request reaches this isolate (see the OpenNext adapter's `populateProcessEnv`),
 * which happens *after* the module's top-level code has already run at Worker
 * cold start. A top-level `const clientId = process.env.PLAID_CLIENT_ID` would
 * permanently capture `undefined` — plaidEnabled() and getPlaid() below are
 * only ever called from inside a request (a Server Action, a route handler, a
 * page render), so reading process.env at call time is what actually sees the
 * configured value. Same reasoning as the Proxy in src/lib/db.ts.
 */
function credentials(): { clientId: string; secret: string; env: "sandbox" | "production" } | null {
  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  if (!clientId || !secret) return null;
  return { clientId, secret, env: process.env.PLAID_ENV === "production" ? "production" : "sandbox" };
}

export function plaidEnabled(): boolean {
  return credentials() !== null;
}

/**
 * Gates the "Sandbox tools" panel in Settings (see the simulateDepositAction,
 * fireSyncWebhookAction and forceReauthAction actions in bank-connection.ts).
 * Sandbox generates no organic transaction activity and there's no UI path
 * to Plaid's own webhook or re-auth flows, so those actions call Plaid's
 * test-simulation endpoints directly — which themselves reject non-Sandbox
 * credentials, but checking here first means the failure is our own clear
 * message rather than an opaque Plaid error.
 */
export function plaidSandboxMode(): boolean {
  return credentials()?.env === "sandbox";
}

let client: PlaidApi | null = null;

export function getPlaid(): PlaidApi {
  const creds = credentials();
  if (!creds) {
    throw new Error("Plaid is not configured. Set PLAID_CLIENT_ID and PLAID_SECRET to enable the bank feed.");
  }
  client ??= new PlaidApi(
    new Configuration({
      basePath: PlaidEnvironments[creds.env],
      baseOptions: {
        headers: { "PLAID-CLIENT-ID": creds.clientId, "PLAID-SECRET": creds.secret },
      },
    }),
    undefined,
    fetchAxios,
  );
  return client;
}

/**
 * Starts Link for an org's admin. `organizationId` doubles as Plaid's
 * `client_user_id` — it's already an opaque cuid, never PII, which is exactly
 * what Plaid asks `client_user_id` to be.
 */
export async function createLinkToken(args: {
  organizationId: string;
  webhookUrl?: string;
}): Promise<string> {
  const response = await getPlaid().linkTokenCreate({
    client_name: "HK Software Property Management",
    language: "en",
    country_codes: [CountryCode.Us],
    user: { client_user_id: args.organizationId },
    products: [Products.Transactions],
    webhook: args.webhookUrl,
  });
  return response.data.link_token;
}

export async function exchangePublicToken(
  publicToken: string,
): Promise<{ accessToken: string; itemId: string }> {
  const response = await getPlaid().itemPublicTokenExchange({ public_token: publicToken });
  return { accessToken: response.data.access_token, itemId: response.data.item_id };
}

export async function getInstitutionInfo(
  accessToken: string,
): Promise<{ name: string | null; logo: string | null }> {
  const plaid = getPlaid();
  const item = await plaid.itemGet({ access_token: accessToken });
  const institutionId = item.data.item.institution_id;
  if (!institutionId) return { name: null, logo: null };

  const institution = await plaid.institutionsGetById({
    institution_id: institutionId,
    country_codes: [CountryCode.Us],
    options: { include_optional_metadata: true },
  });
  return {
    name: institution.data.institution.name ?? null,
    logo: institution.data.institution.logo ?? null,
  };
}

/** Disconnects the Item on Plaid's side. Callers still delete the local row. */
export async function removeItem(accessToken: string): Promise<void> {
  await getPlaid().itemRemove({ access_token: accessToken });
}

export type PlaidTransaction = {
  transactionId: string;
  accountId: string;
  /**
   * Positive means money IN — flipped once, here, from Plaid's own
   * convention (positive = money OUT, negative = a deposit), so nothing
   * downstream (matching, reconciliation) has to remember that inversion.
   */
  amountCents: number;
  date: string;
  name: string;
  merchantName: string | null;
  pending: boolean;
};

export type PlaidSyncResult = {
  added: PlaidTransaction[];
  modified: PlaidTransaction[];
  removedTransactionIds: string[];
  nextCursor: string;
  hasMore: boolean;
};

function toAppTransaction(t: PlaidRawTransaction): PlaidTransaction {
  return {
    transactionId: t.transaction_id,
    accountId: t.account_id,
    amountCents: Math.round(-t.amount * 100),
    date: t.date,
    name: t.name,
    merchantName: t.merchant_name ?? null,
    pending: t.pending,
  };
}

/**
 * One page of /transactions/sync. Callers are expected to loop while
 * hasMore is true, persisting nextCursor after each page — see
 * src/lib/plaid-sync.ts, which is the only caller and owns that loop plus
 * turning these into Payment rows.
 */
export async function syncTransactions(args: {
  accessToken: string;
  cursor: string | null;
  /**
   * Transactions per page. Set this explicitly rather than taking Plaid's
   * default — the caller's whole query budget is derived from it, since every
   * transaction in a page costs database writes and D1 caps how many of those
   * one request may make (see plaid-sync.ts).
   */
  count?: number;
}): Promise<PlaidSyncResult> {
  const response = await getPlaid().transactionsSync({
    access_token: args.accessToken,
    cursor: args.cursor ?? undefined,
    count: args.count,
  });
  return {
    added: response.data.added.map(toAppTransaction),
    modified: response.data.modified.map(toAppTransaction),
    removedTransactionIds: response.data.removed.map((r) => r.transaction_id),
    nextCursor: response.data.next_cursor,
    hasMore: response.data.has_more,
  };
}

// --- Sandbox-only test tooling ----------------------------------------------
//
// Everything below drives Plaid's own `/sandbox/*` simulation endpoints, which
// 400 outside Sandbox. Callers (src/actions/bank-connection.ts) check
// plaidSandboxMode() first so that's never actually hit in production.

/**
 * Injects a fake transaction into the connected Item's history. Sandbox test
 * banks don't produce new activity on their own, so this is what stands in
 * for "a rent check gets deposited" while testing the sync path.
 */
export async function simulateDeposit(args: {
  accessToken: string;
  amountCents: number;
  description: string;
  /**
   * YYYY-MM-DD. Defaults to today — the only value the Sandbox tools panel
   * ever sends. Backdating is for seeding multiple months of history (see
   * prisma/seed-landlord10.ts) so a freshly connected Item can demonstrate a
   * real, already-populated bank feed rather than starting empty.
   */
  date?: string;
}): Promise<void> {
  const date = args.date ?? new Date().toISOString().slice(0, 10);
  await getPlaid().sandboxTransactionsCreate({
    access_token: args.accessToken,
    transactions: [
      {
        date_transacted: date,
        date_posted: date,
        // Plaid's sign convention is inverted from ours here too — see the
        // note on PlaidTransaction above. Negative means money IN.
        amount: -(args.amountCents / 100),
        description: args.description,
      },
    ],
  });
}

/**
 * Makes Plaid deliver a real, ES256-signed SYNC_UPDATES_AVAILABLE webhook to
 * our own /api/plaid/webhook route — exercises signature verification and
 * the sync job together, not just syncBankConnection() in isolation.
 */
export async function fireSyncWebhook(accessToken: string): Promise<void> {
  await getPlaid().sandboxItemFireWebhook({
    access_token: accessToken,
    webhook_code: SandboxItemFireWebhookRequestWebhookCodeEnum.SyncUpdatesAvailable,
  });
}

/**
 * Flips the Item into ITEM_LOGIN_REQUIRED, the same state a bank forcing
 * periodic re-auth produces — for testing the "needs reconnecting" banner
 * and the reconnect-via-Link recovery path.
 */
export async function resetItemLogin(accessToken: string): Promise<void> {
  await getPlaid().sandboxItemResetLogin({ access_token: accessToken });
}
