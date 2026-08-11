import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { requireUser } from "@/lib/rbac";
import { CreateOrgForm } from "./_components/create-org-form";
import { Logo } from "@/components/logo";

export const metadata: Metadata = {
  title: "Set up your organization",
  // Signed-in-only recovery path, and nothing a searcher could act on.
  robots: { index: false, follow: false },
};

/**
 * Recovery path for a staff account with no organization. Signup creates both
 * together, so reaching this normally means the org was deleted or the account
 * was provisioned by hand.
 */
export default async function OnboardingPage() {
  const user = await requireUser();
  if (user.organizationId) redirect("/app");
  if (user.role === "TENANT") redirect("/portal");

  return (
    <div className="flex min-h-dvh flex-col bg-slate-50">
      <header className="px-6 py-5">
        <Logo />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 pb-16">
        <div className="w-full max-w-md">
          <div className="card p-7">
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">
              Name your organization
            </h1>
            <p className="mt-1 mb-6 text-sm text-slate-500">
              Your account isn&apos;t attached to one yet. This is what residents will see on
              emails from you.
            </p>
            <CreateOrgForm />
          </div>
        </div>
      </main>
    </div>
  );
}
