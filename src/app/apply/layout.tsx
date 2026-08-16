import Link from "next/link";
import type { Metadata } from "next";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * Same shell as the (auth) route group's layout — logo header, centered card,
 * theme toggle — but its own copy rather than a shared import: this page is
 * reached by a prospect with no account and nothing else in common with the
 * sign-in flow, and the two are free to diverge later without one dragging
 * the other along.
 */
export const metadata: Metadata = {
  // A page for a specific unit's application is only useful to whoever was
  // handed the link — nothing to gain from it showing up in search either.
  robots: { index: false, follow: false },
};

export default function ApplyLayout({ children }: { children: React.ReactNode }) {
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
