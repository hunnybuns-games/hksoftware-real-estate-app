import Link from "next/link";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { AcceptInviteForm } from "./_components/accept-invite-form";

/**
 * Same reasoning as reset-password/[token]: the token in this URL creates an
 * account with a role attached, so the URL is a credential and must never be
 * indexed, cached or snippeted. See that file for the full note.
 */
export const metadata: Metadata = {
  title: "Accept your invitation",
  robots: { index: false, follow: false, nocache: true, noarchive: true, nosnippet: true },
};

export default async function AcceptInvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const invite = await db.invitation.findUnique({
    where: { token },
    include: {
      organization: { select: { name: true } },
      tenant: {
        select: {
          leases: {
            take: 1,
            orderBy: { startDate: "desc" },
            select: { unit: { select: { label: true, property: { select: { name: true } } } } },
          },
        },
      },
    },
  });

  if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) {
    return (
      <div className="card p-7 text-center">
        <h1 className="text-lg font-semibold text-slate-900">This link isn&apos;t usable</h1>
        <p className="mt-2 text-sm text-slate-500">
          {invite?.acceptedAt
            ? "This invitation has already been used. If that was you, just sign in."
            : "The invitation has expired or the link is wrong. Ask whoever invited you to send a new one."}
        </p>
        <Link href="/login" className="btn-primary mt-6 inline-flex">
          Go to sign in
        </Link>
      </div>
    );
  }

  const lease = invite.tenant?.leases[0];
  const isTenant = invite.role === "TENANT";

  return (
    <div className="card p-7">
      <h1 className="text-xl font-semibold tracking-tight text-slate-900">
        {isTenant ? "Set up your resident portal" : `Join ${invite.organization.name}`}
      </h1>
      <p className="mt-1 mb-6 text-sm text-slate-500">
        {isTenant
          ? lease
            ? `${invite.organization.name} · ${lease.unit.property.name} — ${lease.unit.label}`
            : invite.organization.name
          : `You've been invited as ${invite.role.toLowerCase()}. Pick a password to finish.`}
      </p>

      <AcceptInviteForm
        token={token}
        email={invite.email}
        name={invite.name}
        isTenant={isTenant}
      />
    </div>
  );
}
