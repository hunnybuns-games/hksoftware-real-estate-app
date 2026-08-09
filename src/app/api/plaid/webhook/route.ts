import { db } from "@/lib/db";
import { plaidEnabled } from "@/lib/plaid";
import { verifyPlaidWebhook } from "@/lib/plaid-webhook";
import { syncBankConnection } from "@/lib/plaid-sync";

/**
 * SYNC_UPDATES_AVAILABLE is the only webhook this app actually needs to act
 * on — it's Plaid's signal that new transaction data is ready, and
 * syncBankConnection() (src/lib/plaid-sync.ts) does the actual work of
 * pulling and applying it. ITEM/ERROR with ITEM_LOGIN_REQUIRED is handled
 * too, purely so the settings page can show "needs reconnecting" right away
 * instead of waiting for the next sync attempt to discover the same thing.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PlaidWebhookPayload = {
  webhook_type?: string;
  webhook_code?: string;
  item_id?: string;
  error?: { error_code?: string } | null;
};

export async function POST(req: Request): Promise<Response> {
  if (!plaidEnabled) {
    return Response.json({ error: "Plaid is not configured." }, { status: 503 });
  }

  const rawBody = await req.text();
  const verificationHeader = req.headers.get("plaid-verification");

  let payload: PlaidWebhookPayload;
  try {
    payload = (await verifyPlaidWebhook(rawBody, verificationHeader)) as PlaidWebhookPayload;
  } catch (err) {
    // An unverifiable payload is either a misconfiguration or an attack.
    // Never process it — same rule as the Stripe webhook route.
    console.error("[plaid] webhook verification failed", err);
    return Response.json({ error: "Invalid signature." }, { status: 400 });
  }

  try {
    await handleWebhook(payload);
  } catch (err) {
    // 500 tells Plaid to retry with backoff, which is what we want for a
    // transient DB/network failure. handleWebhook is written to be safe to
    // run again (syncBankConnection resumes from its persisted cursor).
    console.error(`[plaid] handler failed for ${payload.webhook_type}/${payload.webhook_code}`, err);
    return Response.json({ error: "Handler failed." }, { status: 500 });
  }

  return Response.json({ received: true });
}

async function handleWebhook(payload: PlaidWebhookPayload): Promise<void> {
  if (!payload.item_id) return;

  const connection = await db.bankConnection.findUnique({
    where: { plaidItemId: payload.item_id },
    select: { id: true },
  });
  if (!connection) {
    // A webhook for an Item this app no longer has a record of — the owner
    // disconnected it, most likely. Nothing to do.
    console.warn(`[plaid] webhook for unknown item ${payload.item_id}`);
    return;
  }

  if (payload.webhook_type === "TRANSACTIONS" && payload.webhook_code === "SYNC_UPDATES_AVAILABLE") {
    await syncBankConnection(connection.id);
    return;
  }

  if (
    payload.webhook_type === "ITEM" &&
    payload.webhook_code === "ERROR" &&
    payload.error?.error_code === "ITEM_LOGIN_REQUIRED"
  ) {
    await db.bankConnection.update({
      where: { id: connection.id },
      data: { status: "LOGIN_REQUIRED" },
    });
  }
}
