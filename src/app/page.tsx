import Link from "next/link";
import { redirect } from "next/navigation";
import { homeFor, liveSessionUser } from "@/lib/rbac";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * Doubles as the post-login landing spot: signed-in users get bounced to the
 * right home for their role, so nothing else in the app needs to know the
 * mapping.
 */
export default async function HomePage() {
  // Database-backed, not auth() — a token naming a deleted account has to land
  // on this marketing page rather than be routed into the app, or it ping-pongs
  // with the guards forever. See liveSessionUser().
  const user = await liveSessionUser();
  if (user) {
    redirect(homeFor({ role: user.role, organizationId: user.organizationId }));
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-5">
        <Logo />
        <nav className="flex items-center gap-2">
          <ThemeToggle className="mr-1 hidden sm:inline-flex" />
          <Link href="/login" className="btn-ghost">
            Sign in
          </Link>
          <Link href="/signup" className="btn-primary">
            Start free
          </Link>
        </nav>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-6">
        <section className="pt-16 pb-14 sm:pt-24">
          <p className="text-sm font-semibold text-brand-700 dark:text-brand-300">For 20–200 unit portfolios</p>
          <h1 className="mt-3 max-w-2xl text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl">
            Property management without the enterprise tax.
          </h1>
          <p className="mt-5 max-w-xl text-lg text-slate-600">
            Track units and leases, collect rent by bank transfer, and handle maintenance
            requests — in software that stays out of your way. Built for the portfolio that
            outgrew a spreadsheet but doesn&apos;t need AppFolio.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href="/signup" className="btn-primary px-5 py-2.5">
              Create your account
            </Link>
            <Link href="/login" className="btn-secondary px-5 py-2.5">
              Sign in
            </Link>
          </div>
        </section>

        <section className="grid gap-5 border-t border-slate-200 py-14 sm:grid-cols-3">
          {[
            {
              title: "Your portfolio, at a glance",
              body: "Properties, units and occupancy in one list. See what's vacant and what's collected without building a pivot table.",
            },
            {
              title: "Rent that collects itself",
              body: "Residents pay by ACH from their own portal. Payments post against the lease automatically, and late balances surface on your dashboard.",
            },
            {
              title: "Maintenance with a paper trail",
              body: "Residents submit requests with photos from their phone. You get a queue, status, and notes — not a voicemail box.",
            },
          ].map((f) => (
            <div key={f.title}>
              <h2 className="text-sm font-semibold text-slate-900">{f.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{f.body}</p>
            </div>
          ))}
        </section>
      </main>

      <footer className="mx-auto w-full max-w-5xl px-6 py-8 text-xs text-slate-400">
        Rent is moved by Stripe. We never hold your money.
      </footer>
    </div>
  );
}
