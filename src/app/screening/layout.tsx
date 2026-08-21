import Link from "next/link";
import type { Metadata } from "next";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * Same shell as /apply's layout — its own copy rather than a shared import,
 * same reasoning: this page has nothing in common with the sign-in flow or
 * the application form beyond "public, reached by a link, no app chrome".
 *
 * Unlike /apply, this one gets the same extra robots directives the invite
 * and password-reset token pages use: the token here is tied to one
 * applicant's consent decision on a screening report, which is a step more
 * sensitive than an application form and shouldn't be indexed, cached, or
 * snippeted anywhere.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true, noarchive: true, nosnippet: true },
};

export default function ScreeningLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-slate-50">
      <header className="flex items-center justify-between px-6 py-5">
        <Link href="/" className="inline-flex">
          <Logo />
        </Link>
        <ThemeToggle />
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pt-4 pb-16 sm:pt-8">
        <div className="w-full max-w-xl">{children}</div>
      </main>
    </div>
  );
}
