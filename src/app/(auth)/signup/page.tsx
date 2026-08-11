import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { SITE } from "@/lib/site";
import { SignupForm } from "./_components/signup-form";

/**
 * The highest-intent public page: someone reading this has already decided to
 * try the product, so it's the one worth ranking for "<product> sign up" and for
 * comparison searches that end in a trial.
 */
export const metadata: Metadata = {
  title: "Create your account",
  description: `Start managing your rentals with ${SITE.name}. Add your properties, units and leases, invite residents, and collect rent by bank transfer — no setup call required.`,
  alternates: { canonical: "/signup" },
  openGraph: {
    title: `Create your ${SITE.name} account`,
    description: `Start managing your rentals with ${SITE.name} — properties, leases, rent collection and maintenance in one place.`,
    url: "/signup",
  },
};

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
