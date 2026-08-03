import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { SignupForm } from "./_components/signup-form";

export const metadata: Metadata = { title: "Create your account" };

export default async function SignupPage() {
  const session = await auth();
  if (session?.user) redirect("/");

  return (
    <div className="card p-7">
      <h1 className="text-xl font-semibold tracking-tight text-slate-900">Create your account</h1>
      <p className="mt-1 mb-6 text-sm text-slate-500">
        Takes about a minute. You can add properties and invite your team right after.
      </p>

      <SignupForm />

      <p className="mt-6 text-center text-sm text-slate-500">
        Already have an account?{" "}
        <Link href="/login" className="link">
          Sign in
        </Link>
      </p>
    </div>
  );
}
