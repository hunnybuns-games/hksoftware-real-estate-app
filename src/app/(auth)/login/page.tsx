import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { LoginForm } from "./_components/login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect("/");

  const { next } = await searchParams;

  return (
    <div className="card p-7">
      <h1 className="text-xl font-semibold tracking-tight text-slate-900">Sign in</h1>
      <p className="mt-1 mb-6 text-sm text-slate-500">
        Manage your properties, or pay rent as a resident.
      </p>

      <LoginForm redirectTo={next ?? "/"} />

      <p className="mt-6 text-center text-sm text-slate-500">
        Managing properties and don&apos;t have an account?{" "}
        <Link href="/signup" className="link">
          Start free
        </Link>
      </p>
      <p className="mt-2 text-center text-xs text-slate-400">
        Residents: your manager sends you an invitation link to set up your portal.
      </p>
    </div>
  );
}
