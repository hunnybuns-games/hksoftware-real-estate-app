import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/rbac";
import { refreshStripeStatusAction, startStripeOnboardingAction } from "@/actions/org";
import { stripeEnabled } from "@/lib/stripe";
import { Badge, Banner, Card, DescriptionList } from "@/components/ui";
import { ActionButton } from "@/components/action-button";

export const metadata: Metadata = { title: "Rent collection" };

export default async function PaymentSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; refresh?: string }>;
}) {
  const ctx = await requireStaff();
  const { connected } = await searchParams;

  const org = await db.organization.findUnique({
    where: { id: ctx.organizationId },
    select: {
      stripeAccountId: true,
      stripeChargesEnabled: true,
      stripePayoutsEnabled: true,
    },
  });
  if (!org) return null;

  const isAdmin = ctx.role === "ADMIN";
  const ready = org.stripeChargesEnabled;

  return (
    <div className="max-w-2xl space-y-6">
      {connected ? (
        <Banner tone="info" title="Back from Stripe">
          Stripe reviews new accounts in the background. Refresh the status below to see whether
          you&apos;re cleared to accept payments yet.
        </Banner>
      ) : null}

      {!stripeEnabled ? (
        <Banner tone="warning" title="Stripe isn't configured on this deployment">
          Set <code className="rounded bg-white/60 px-1">STRIPE_SECRET_KEY</code> and{" "}
          <code className="rounded bg-white/60 px-1">STRIPE_WEBHOOK_SECRET</code> in your
          environment, then reload. Until then you can still track rent and record payments by
          hand — you just can&apos;t collect online.
        </Banner>
      ) : null}

      <Card title="How rent collection works">
        <div className="space-y-3 text-sm leading-relaxed text-slate-600">
          <p>
            Residents pay from their portal by bank transfer (ACH). Money moves through Stripe
            straight into <strong>your</strong> Stripe account and pays out to your bank on
            Stripe&apos;s schedule.
          </p>
          <p>
            We never hold your funds — that&apos;s deliberate. It keeps your money out of our
            hands and means Stripe handles the identity checks and payment regulation.
          </p>
        </div>
      </Card>

      <Card title="Your Stripe account">
        <div className="space-y-5">
          <DescriptionList
            items={[
              {
                label: "Connection",
                value: org.stripeAccountId ? (
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge tone="green">Connected</Badge>
                    <code className="text-xs text-slate-500">{org.stripeAccountId}</code>
                  </span>
                ) : (
                  <Badge tone="slate">Not connected</Badge>
                ),
              },
              {
                label: "Accepting payments",
                value: org.stripeChargesEnabled ? (
                  <Badge tone="green">Yes</Badge>
                ) : (
                  <Badge tone="amber">Not yet</Badge>
                ),
              },
              {
                label: "Payouts to your bank",
                value: org.stripePayoutsEnabled ? (
                  <Badge tone="green">Enabled</Badge>
                ) : (
                  <Badge tone="amber">Pending</Badge>
                ),
              },
            ]}
          />

          {!isAdmin ? (
            <p className="text-sm text-slate-500">Only an admin can connect or change this.</p>
          ) : (
            <div className="flex flex-wrap items-start gap-3">
              <ActionButton
                action={startStripeOnboardingAction}
                label={
                  org.stripeAccountId
                    ? ready
                      ? "Manage on Stripe"
                      : "Finish Stripe setup"
                    : "Connect Stripe"
                }
                pendingLabel="Opening Stripe…"
                variant="primary"
              />
              {org.stripeAccountId ? (
                <ActionButton
                  action={refreshStripeStatusAction}
                  label="Refresh status"
                  pendingLabel="Checking…"
                />
              ) : null}
            </div>
          )}
        </div>
      </Card>

      {ready ? null : (
        <Card title="Meanwhile">
          <p className="text-sm leading-relaxed text-slate-600">
            You can record checks, cash and outside transfers on any lease — open the lease and use{" "}
            <strong>Record payment</strong>. Balances, late flags and the owner summary all work the
            same way whether the money came through Stripe or not.
          </p>
        </Card>
      )}
    </div>
  );
}
