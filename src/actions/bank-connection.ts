"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { assertAdmin, AuthorizationError } from "@/lib/rbac";
import { type ActionState, actionError, actionOk, centsField, parseForm, runAction } from "@/lib/forms";
import {
  createLinkToken,
  exchangePublicToken,
  fireSyncWebhook,
  getInstitutionInfo,
  plaidEnabled,
  plaidSandboxMode,
  removeItem,
  resetItemLogin,
  simulateDeposit,
} from "@/lib/plaid";
import { decryptToken, encryptToken } from "@/lib/token-encryption";
import { syncBankConnection } from "@/lib/plaid-sync";
import { appUrl } from "@/lib/email";

/**
 * Returns a fresh Link token for the org's admin to open Plaid Link with.
 * Called directly from a client component's event handler, not a <form
 * action={...}> — Link is an interactive widget the browser has to drive
 * (open a modal, let the owner log into their bank, get a public_token back),
 * unlike Stripe Connect's redirect-based onboarding elsewhere in org.ts. So
 * this returns a plain result object rather than ActionState, and callers
 * handle the error case themselves instead of going through runAction.
 */
export async function createBankLinkTokenAction(): Promise<
  { ok: true; linkToken: string } | { ok: false; error: string }
> {
  if (!plaidEnabled()) {
    return { ok: false, error: "Plaid isn't configured on this deployment yet." };
  }

  let organizationId: string;
  try {
    organizationId = (await assertAdmin()).organizationId;
  } catch (err) {
    if (err instanceof AuthorizationError) return { ok: false, error: err.message };
    throw err;
  }

  try {
    const linkToken = await createLinkToken({
      organizationId,
      webhookUrl: appUrl("/api/plaid/webhook"),
    });
    return { ok: true, linkToken };
  } catch (err) {
    console.error("[plaid] link token creation failed", err);
    return { ok: false, error: "Couldn't start the bank connection. Please try again in a minute." };
  }
}

/**
 * Completes the connection after Plaid Link's onSuccess callback hands back a
 * public_token. One connection per org (BankConnection.organizationId is
 * unique) — running Link again (e.g. reconnecting after LOGIN_REQUIRED)
 * replaces the existing row rather than creating a second one, and resets
 * the sync cursor since a new Item has no relationship to the old one's.
 */
export async function exchangeBankPublicTokenAction(publicToken: string): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await assertAdmin();
    if (!plaidEnabled()) return actionError("Plaid isn't configured on this deployment.");

    const { accessToken, itemId } = await exchangePublicToken(publicToken);
    const institution = await getInstitutionInfo(accessToken).catch(() => ({
      name: null,
      logo: null,
    }));
    const accessTokenEncrypted = await encryptToken(accessToken);

    await db.bankConnection.upsert({
      where: { organizationId: ctx.organizationId },
      create: {
        organizationId: ctx.organizationId,
        plaidItemId: itemId,
        accessTokenEncrypted,
        institutionName: institution.name,
        institutionLogo: institution.logo,
        status: "ACTIVE",
      },
      update: {
        plaidItemId: itemId,
        accessTokenEncrypted,
        institutionName: institution.name,
        institutionLogo: institution.logo,
        status: "ACTIVE",
        cursor: null,
      },
    });

    revalidatePath("/app/settings/payments");
    return actionOk("Bank account connected.");
  });
}

/**
 * Sync on demand. Two reasons this exists rather than leaving everything to
 * Plaid's webhook: it's the only practical way to trigger a sync in Sandbox
 * (which doesn't generate transactions on its own), and a sync collects a
 * bounded number of pages, so a freshly connected account with a long history
 * needs more than one run. The nightly cron drains backlogs too — this is for
 * when someone doesn't want to wait until tomorrow.
 */
export async function syncBankNowAction(_prev: ActionState): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await assertAdmin();

    const connection = await db.bankConnection.findUnique({
      where: { organizationId: ctx.organizationId },
      select: { id: true, status: true },
    });
    if (!connection) return actionError("No bank account is connected yet.");
    if (connection.status === "LOGIN_REQUIRED") {
      return actionError("Your bank needs you to sign in again before it will share new transactions.");
    }

    const outcome = await syncBankConnection(connection.id);

    revalidatePath("/app/settings/payments");
    revalidatePath("/app/payments");
    revalidatePath("/app");

    if (outcome.added === 0 && outcome.modified === 0 && outcome.removed === 0) {
      return actionOk(
        outcome.hasMore
          ? "Checked — nothing new in what we've read so far, and there's more history still to collect. Run it again."
          : "Checked — no new transactions.",
      );
    }

    const parts = [
      outcome.added > 0 ? `${outcome.added} new` : null,
      outcome.modified > 0 ? `${outcome.modified} updated` : null,
      outcome.removed > 0 ? `${outcome.removed} removed` : null,
    ].filter(Boolean);

    return actionOk(
      `${parts.join(", ")}.${outcome.hasMore ? " There's more history to collect — run it again to continue." : ""}`,
    );
  });
}

export async function disconnectBankAction(_prev: ActionState): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await assertAdmin();

    const connection = await db.bankConnection.findUnique({
      where: { organizationId: ctx.organizationId },
      select: { id: true, accessTokenEncrypted: true },
    });
    if (!connection) return actionOk();

    try {
      const accessToken = await decryptToken(connection.accessTokenEncrypted);
      await removeItem(accessToken);
    } catch (err) {
      // Plaid-side cleanup failing isn't a reason to keep the local row
      // around — e.g. the bank may have already revoked the Item on its own,
      // which Plaid would report as an error here too. Disconnect locally
      // regardless so the org isn't stuck unable to reconnect.
      console.error("[plaid] item removal failed, disconnecting locally anyway", err);
    }

    await db.bankConnection.delete({ where: { id: connection.id } });
    revalidatePath("/app/settings/payments");
    return actionOk("Bank account disconnected.");
  });
}

/**
 * Everything below backs the "Sandbox tools" panel (Settings → Rent
 * collection, rendered only when plaidSandboxMode()). Sandbox never produces
 * transaction activity on its own and there's no other UI path to Plaid's
 * webhook or re-auth flows, so these call Plaid's own test-simulation
 * endpoints from here — the Worker has real internet access to Plaid even
 * where a local dev sandbox might not.
 */

const simulateDepositSchema = z.object({
  amountCents: centsField("Amount"),
  description: z
    .string()
    .trim()
    .min(1, "Enter a description.")
    .max(140, "Keep it under 140 characters."),
});

/** Puts a fake deposit in front of the connected Item — Sync now (or fireSyncWebhookAction below) picks it up from there. */
export async function simulateDepositAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await assertAdmin();
    if (!plaidSandboxMode()) return actionError("Sandbox tools only work in Plaid's Sandbox environment.");

    const parsed = parseForm(simulateDepositSchema, formData);
    if (!parsed.ok) return parsed.state;

    const connection = await db.bankConnection.findUnique({
      where: { organizationId: ctx.organizationId },
      select: { accessTokenEncrypted: true },
    });
    if (!connection) return actionError("Connect a bank account first.");

    const accessToken = await decryptToken(connection.accessTokenEncrypted);
    await simulateDeposit({
      accessToken,
      amountCents: parsed.data.amountCents,
      description: parsed.data.description,
    });

    return actionOk('Injected. Click "Sync now" above, or "Fire sync webhook" below, to pull it in.');
  });
}

/** Fires a real, Plaid-signed SYNC_UPDATES_AVAILABLE webhook at our own /api/plaid/webhook route. */
export async function fireSyncWebhookAction(_prev: ActionState): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await assertAdmin();
    if (!plaidSandboxMode()) return actionError("Sandbox tools only work in Plaid's Sandbox environment.");

    const connection = await db.bankConnection.findUnique({
      where: { organizationId: ctx.organizationId },
      select: { accessTokenEncrypted: true },
    });
    if (!connection) return actionError("Connect a bank account first.");

    const accessToken = await decryptToken(connection.accessTokenEncrypted);
    await fireSyncWebhook(accessToken);

    return actionOk("Webhook fired — it should hit /api/plaid/webhook within a few seconds.");
  });
}

/** Flips the connection into ITEM_LOGIN_REQUIRED, same as a bank forcing periodic re-auth. */
export async function forceReauthAction(_prev: ActionState): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await assertAdmin();
    if (!plaidSandboxMode()) return actionError("Sandbox tools only work in Plaid's Sandbox environment.");

    const connection = await db.bankConnection.findUnique({
      where: { organizationId: ctx.organizationId },
      select: { accessTokenEncrypted: true },
    });
    if (!connection) return actionError("Connect a bank account first.");

    const accessToken = await decryptToken(connection.accessTokenEncrypted);
    await resetItemLogin(accessToken);

    return actionOk(
      "Login reset. Plaid should send us the ITEM_LOGIN_REQUIRED webhook shortly — reload in a few seconds, or click Sync now to detect it immediately.",
    );
  });
}
