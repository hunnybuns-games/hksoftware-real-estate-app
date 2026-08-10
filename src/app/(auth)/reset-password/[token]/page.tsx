import Link from "next/link";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { hashResetToken, isRedeemable } from "@/lib/password-reset";
import { ResetPasswordForm } from "./_components/reset-password-form";

export const metadata: Metadata = { title: "Set a new password" };

export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  /*
   * Checked here as well as in the action, so a dead link shows an explanation
   * with a way forward instead of a password form that fails on submit. The
   * action re-checks because this render proves nothing about the moment of
   * submission — that's where the single-use guarantee has to live.
   *
   * Only the hash is looked up; the token in the URL is never stored.
   */
  const row = await db.passwordResetToken.findUnique({
    where: { tokenHash: await hashResetToken(token) },
    select: { expiresAt: true, usedAt: true, user: { select: { email: true } } },
  });

  if (!row || !isRedeemable(row)) {
    return (
      <div className="card p-7 text-center">
        <h1 className="text-lg font-semibold text-slate-900">This link isn&apos;t usable</h1>
        <p className="mt-2 text-sm text-slate-500">
          {row?.usedAt
            ? "This reset link has already been used. If you've set a new password, just sign in."
            : "Reset links expire after an hour and only work once. Request a fresh one and it'll work."}
        </p>
        <Link href="/forgot-password" className="btn-primary mt-6 inline-flex">
          Request a new link
        </Link>
      </div>
    );
  }

  return (
    <div className="card p-7">
      <h1 className="text-xl font-semibold tracking-tight text-slate-900">Set a new password</h1>
      <p className="mt-1 mb-6 text-sm text-slate-500">
        For <span className="font-medium text-slate-700">{row.user.email}</span>. You&apos;ll be
        signed in once it&apos;s saved.
      </p>

      <ResetPasswordForm token={token} email={row.user.email} />
    </div>
  );
}
