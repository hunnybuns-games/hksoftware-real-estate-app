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
  // Logged unconditionally, before verification even runs, specifically so a
  // Cloudflare log check can tell "Plaid never attempted delivery" apart from
  // "it arrived and something after this line went wrong" — the two look
  // identical from a client's point of view (both just mean the connection
  // never updated), but they point at completely different places to look.
  console.log("[plaid] webhook POST received");

  if (!plaidEnabled()) {
    console.warn("[plaid] webhook received but Plaid isn't configured — rejecting");
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

  console.log(
    `[plaid] webhook verified: ${payload.webhook_type}/${payload.webhook_code} for item ${payload.item_id ?? "(none)"}`,
  );

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
  if (!payload.item_id) {
    console.log(`[plaid] webhook ${payload.webhook_type}/${payload.webhook_code} carried no item_id — nothing to do`);
    return;
  }

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
    const outcome = await syncBankConnection(connection.id);
    console.log(
      `[plaid] webhook-triggered sync for connection ${connection.id}: ` +
        `${outcome.added} added, ${outcome.modified} modified, ${outcome.removed} removed` +
        (outcome.hasMore ? " (more pages pending)" : ""),
    );
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
    console.log(`[plaid] connection ${connection.id} flagged LOGIN_REQUIRED via webhook`);
    return;
  }

  // Every other webhook_code this app doesn't act on (LOGIN_REPAIRED,
  // PENDING_DISCONNECT, historical-update codes now superseded by sync,
  // etc.) — logged rather than silently dropped, so "did we get anything at
  // all" never has to be answered by guessing.
  console.log(
    `[plaid] webhook ${payload.webhook_type}/${payload.webhook_code} for connection ${connection.id} — no handler, ignored`,
  );
}
