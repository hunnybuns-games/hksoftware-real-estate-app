"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { assertTenant } from "@/lib/rbac";
import { type ActionState, actionError, actionOk, runAction } from "@/lib/forms";
import { computeBalance } from "@/lib/ledger";
import { applyReconciliation } from "@/lib/reconciliation";
import { createRentCheckoutSession, stripeEnabled } from "@/lib/stripe";
import { appUrl } from "@/lib/email";
import { formatCents, parseDollarsToCents } from "@/lib/money";
import { notifyRentReceived } from "@/lib/notifications";

/**
 * Starts a rent payment. We create our own PENDING Payment row *before* handing
 * off to Stripe so the webhook has something to reconcile against, and so a
 * tenant who abandons Checkout leaves a visible trace instead of a mystery.
 */
export async function startRentPaymentAction(
  leaseId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let checkoutUrl: string | null = null;

  const state = await runAction(async () => {
    const ctx = await assertTenant();

    const lease = await db.lease.findFirst({
      where: { id: leaseId, tenantId: ctx.tenantId },
      include: {
        charges: { where: { voidedAt: null } },
        payments: true,
        tenant: { select: { email: true, firstName: true } },
        unit: { select: { label: true, property: { select: { name: true } } } },
        organization: {
          select: {
            id: true,
            name: true,
            graceDays: true,
            stripeAccountId: true,
            stripeChargesEnabled: true,
          },
        },
      },
    });
    if (!lease) return actionError("We couldn't find that lease on your account.");

    const org = lease.organization;
    if (!stripeEnabled() || !org.stripeAccountId || !org.stripeChargesEnabled) {
      return actionError(
        `${org.name} hasn't finished setting up online payments yet. Please reach out to them to arrange payment.`,
      );
    }

    const balance = computeBalance({
      charges: lease.charges,
      payments: lease.payments,
      graceDays: org.graceDays,
    });

    const amountCents = resolveAmount(formData, balance.balanceCents);
    if (amountCents === null) {
      return actionError("Please fix the highlighted fields.", {
        amountCents: "Enter an amount like 1850 or 1850.00.",
      });
    }
    if (amountCents <= 0) {
      return actionError("Please fix the highlighted fields.", {
        amountCents: "Enter an amount greater than zero.",
      });
    }
    // Guard against a fat-fingered extra zero.
    const ceiling = Math.max(balance.balanceCents, lease.rentAmountCents) * 3 + 100_000;
    if (amountCents > ceiling) {
      return actionError("Please fix the highlighted fields.", {
        amountCents: `That's much more than you owe (${formatCents(Math.max(balance.balanceCents, 0))}). Double-check the amount.`,
      });
    }

    const payment = await db.payment.create({
      data: {
        organizationId: lease.organizationId,
        leaseId: lease.id,
        amountCents,
        method: "ACH",
        source: "STRIPE_NATIVE",
        status: "PENDING",
        memo: "Online payment",
      },
      select: { id: true },
    });

    const description = `Rent — ${lease.unit.property.name} ${lease.unit.label}`;

    try {
      const session = await createRentCheckoutSession({
        connectedAccountId: org.stripeAccountId,
        amountCents,
        leaseId: lease.id,
        paymentId: payment.id,
        tenantEmail: lease.tenant.email,
        description,
        successUrl: appUrl(`/portal?paid=${payment.id}`),
        cancelUrl: appUrl("/portal?canceled=1"),
        allowCards: process.env.STRIPE_ALLOW_CARDS === "true",
      });

      await db.payment.update({
        where: { id: payment.id },
        data: { stripeCheckoutSessionId: session.id },
      });

      checkoutUrl = session.url;
    } catch (err) {
      // Don't leave an orphan PENDING row when Stripe rejects the session.
      await db.payment.delete({ where: { id: payment.id } }).catch(() => {});
      console.error("[stripe] checkout session failed", err);
      return actionError(
        "We couldn't start the payment. Please try again in a minute, or contact your property manager.",
      );
    }

    return actionOk();
  });

  if (checkoutUrl) redirect(checkoutUrl);
  return state;
}

function resolveAmount(formData: FormData, balanceCents: number): number | null {
  const raw = formData.get("amountCents");
  // "Pay the full balance" sends no amount at all.
  if (raw === null || String(raw).trim() === "") return Math.max(0, balanceCents);
  return parseDollarsToCents(String(raw));
}

/**
 * Demo-mode payment. Marks a payment as settled without touching Stripe so the
 * whole rent flow (charge -> payment -> balance -> receipt email) can be walked
 * through on a laptop with no Stripe account. Refuses to run unless
 * DEMO_PAYMENTS=true, and never in production.
 */
export async function simulatePaymentAction(
  leaseId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    if (process.env.DEMO_PAYMENTS !== "true" || process.env.NODE_ENV === "production") {
      return actionError("Demo payments are turned off on this deployment.");
    }

    const ctx = await assertTenant();

    const lease = await db.lease.findFirst({
      where: { id: leaseId, tenantId: ctx.tenantId },
      include: {
        charges: { where: { voidedAt: null } },
        payments: true,
        tenant: { select: { email: true, firstName: true } },
        organization: { select: { id: true, name: true, graceDays: true } },
      },
    });
    if (!lease) return actionError("We couldn't find that lease on your account.");

    const balance = computeBalance({
      charges: lease.charges,
      payments: lease.payments,
      graceDays: lease.organization.graceDays,
    });

    const amountCents = resolveAmount(formData, balance.balanceCents);
    if (amountCents === null || amountCents <= 0) {
      return actionError("Please fix the highlighted fields.", {
        amountCents: "Enter an amount greater than zero.",
      });
    }

    await db.payment.create({
      data: {
        organizationId: lease.organizationId,
        leaseId: lease.id,
        amountCents,
        method: "ACH",
        source: "STRIPE_NATIVE",
        status: "SUCCEEDED",
        paidAt: new Date(),
        memo: "Demo payment (no money moved)",
      },
    });

    await applyReconciliation(lease.id);

    await notifyRentReceived({
      to: { email: lease.tenant.email, name: lease.tenant.firstName },
      organizationId: lease.organization.id,
      orgName: lease.organization.name,
      amountCents,
      processing: false,
    });

    revalidatePath("/portal");
    revalidatePath("/app");
    revalidatePath("/app/payments");
    revalidatePath(`/app/leases/${lease.id}`);
    return actionOk(`Recorded a demo payment of ${formatCents(amountCents)}.`);
  });
}
