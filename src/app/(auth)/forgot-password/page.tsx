import Link from "next/link";
import type { Metadata } from "next";
import { ForgotPasswordForm } from "./_components/forgot-password-form";

export const metadata: Metadata = { title: "Reset your password" };

export default function ForgotPasswordPage() {
  return (
    <div className="card p-7">
      <h1 className="text-xl font-semibold tracking-tight text-slate-900">Reset your password</h1>
      <p className="mt-1 mb-6 text-sm text-slate-500">
        Enter the email you sign in with and we&apos;ll send you a link to set a new password.
      </p>

      <ForgotPasswordForm />

      <p className="mt-6 text-center text-sm text-slate-500">
        <Link href="/login" className="link">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
