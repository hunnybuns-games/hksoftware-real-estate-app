"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { assertAdmin, AuthorizationError } from "@/lib/rbac";
import { type ActionState, actionError, actionOk, runAction } from "@/lib/forms";
import {
  createLinkToken,
  exchangePublicToken,
  getInstitutionInfo,
  plaidEnabled,
  removeItem,
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
  if (!plaidEnabled) {
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
    if (!plaidEnabled) return actionError("Plaid isn't configured on this deployment.");

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
