"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertAdmin, assertStaff, AuthorizationError } from "@/lib/rbac";
import {
  type ActionState,
  actionError,
  actionOk,
  centsField,
  intField,
  nameField,
  parseForm,
  runAction,
} from "@/lib/forms";
import {
  createConnectOnboardingLink,
  getAccountStatus,
  stripeEnabled,
} from "@/lib/stripe";
import { appUrl } from "@/lib/email";

const orgSchema = z.object({
  name: nameField,
  graceDays: intField("Grace period", 0, 31),
  lateFeeCents: centsField("Late fee"),
});

export async function updateOrgAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await assertAdmin();
    const parsed = parseForm(orgSchema, formData);
    if (!parsed.ok) return parsed.state;

    await db.organization.update({
      where: { id: ctx.organizationId },
      data: parsed.data,
    });

    revalidatePath("/app/settings");
    revalidatePath("/app");
    return actionOk("Settings saved.");
  });
}

/** For a staff user who somehow has no organization (e.g. a manual DB fix). */
export async function createOrganizationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let created = false;

  const state = await runAction(async () => {
    const { auth } = await import("@/lib/auth");
    const session = await auth();
    if (!session?.user?.id) return actionError("You need to sign in.");
    if (session.user.organizationId) return actionOk();
    // organizationId: null should only ever happen to an ADMIN/STAFF account
    // via a manual DB fix (see the comment above) — never to a TENANT or
    // OWNER through any flow this app exposes. Guard it anyway: without this,
    // a role that somehow reached this state could hand itself a fresh org
    // and ADMIN on it.
    if (session.user.role !== "ADMIN" && session.user.role !== "STAFF") {
      throw new AuthorizationError();
    }

    const parsed = parseForm(z.object({ name: nameField }), formData);
    if (!parsed.ok) return parsed.state;

    // Not wrapped in $transaction — D1 doesn't support interactive
    // transactions and throws outright if asked to. Sequential calls run
    // exactly as they always did on this database (the old wrapper's
    // commit/rollback were no-ops here anyway).
    const org = await db.organization.create({ data: { name: parsed.data.name } });
    await db.user.update({
      where: { id: session.user.id },
      data: { organizationId: org.id, role: "ADMIN" },
    });

    created = true;
    return actionOk();
  });

  // The JWT still says organizationId: null. Bouncing through /login refreshes
  // the session; the session callback re-reads the user on `update`.
  if (created) redirect("/app");
  return state;
}

/**
 * Kicks off (or resumes) Stripe Express onboarding and sends the admin to
 * Stripe's hosted flow.
 */
export async function startStripeOnboardingAction(_prev: ActionState): Promise<ActionState> {
  let onboardingUrl: string | null = null;

  const state = await runAction(async () => {
    const ctx = await assertAdmin();
    if (!stripeEnabled) {
      return actionError(
        "Stripe isn't configured on this deployment yet. Add STRIPE_SECRET_KEY to enable online rent collection.",
      );
    }

    const org = await db.organization.findUnique({
      where: { id: ctx.organizationId },
      select: { id: true, name: true, stripeAccountId: true },
    });
    if (!org) return actionError("Your organization no longer exists.");

    const { accountId, url } = await createConnectOnboardingLink({
      organizationId: org.id,
      organizationName: org.name,
      existingAccountId: org.stripeAccountId,
      email: ctx.email,
      returnUrl: appUrl("/app/settings/payments?connected=1"),
      refreshUrl: appUrl("/app/settings/payments?refresh=1"),
    });

    if (accountId !== org.stripeAccountId) {
      await db.organization.update({
        where: { id: org.id },
        data: { stripeAccountId: accountId },
      });
    }

    onboardingUrl = url;
    return actionOk();
  });

  if (onboardingUrl) redirect(onboardingUrl);
  return state;
}

/**
 * Pulls the current capability flags from Stripe. The account.updated webhook
 * keeps these fresh in production; this exists for local dev (no webhook
 * tunnel) and as a manual "why isn't this working" escape hatch.
 */
export async function refreshStripeStatusAction(_prev: ActionState): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await assertAdmin();
    if (!stripeEnabled) return actionError("Stripe isn't configured on this deployment.");

    const org = await db.organization.findUnique({
      where: { id: ctx.organizationId },
      select: { id: true, stripeAccountId: true },
    });
    if (!org?.stripeAccountId) {
      return actionError("Connect a Stripe account first.");
    }

    const status = await getAccountStatus(org.stripeAccountId);
    await db.organization.update({
      where: { id: org.id },
      data: {
        stripeChargesEnabled: status.chargesEnabled,
        stripePayoutsEnabled: status.payoutsEnabled,
      },
    });

    revalidatePath("/app/settings/payments");
    return actionOk(
      status.chargesEnabled
        ? "Connected — you can accept rent payments."
        : "Stripe still needs more information before this account can accept payments.",
    );
  });
}

/** Belt-and-braces guard used by pages that only staff should reach. */
export async function ensureStaff(): Promise<void> {
  await assertStaff();
}
