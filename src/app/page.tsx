import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import clsx from "clsx";
import { homeFor, liveSessionUser } from "@/lib/rbac";
import { SITE } from "@/lib/site";
import { Logo } from "@/components/logo";
import { CatMark } from "@/components/cat-mark";
import { ThemeToggle } from "@/components/theme-toggle";
import { StructuredData } from "./_components/structured-data";
import { HeroScene } from "./_components/hero-scene";
import { nunito } from "./_components/landing-font";

export const metadata: Metadata = {
  // No `title` override: the root layout's default is already the fully-formed
  // "<name> — <tagline>", and running it through the "%s · <name>" template
  // would repeat the brand twice in one title.
  alternates: { canonical: "/" },
  openGraph: { url: "/" },
};

/**
 * The whole pitch is "the simplest one". So the page says little, on
 * purpose: a headline, one line under it, three things it does, five
 * questions, one closing line. Every claim is something the app actually
 * does (src/actions, src/lib) — brevity is not licence to promise.
 */
const THINGS = [
  {
    heading: "Collect rent",
    body: "Residents pay by bank transfer from their portal. Payments match themselves to the lease.",
  },
  {
    heading: "Track leases",
    body: "Every unit, lease and balance on one screen. Late rent gets a reminder without you.",
  },
  {
    heading: "Handle repairs",
    body: "Residents send a photo. You see a queue, they get an update.",
  },
] as const;

/**
 * The questions a landlord asks before signing up, answered in a sentence.
 * Rendered on the page and emitted as FAQPage structured data from the same
 * array, so search results can show the answers too.
 */
const FAQS = [
  {
    q: "Who is it for?",
    a: "Landlords with one to a hundred properties who'd rather not learn a new system.",
  },
  {
    q: "How do residents pay?",
    a: "By bank transfer from their portal. Stripe moves the money straight to your account; we never hold it.",
  },
  {
    q: "Can I bring in payments from elsewhere?",
    a: "Yes. Connect your bank, upload a CSV, or record a cash payment by hand.",
  },
  {
    q: "Does it handle Section 8?",
    a: "Yes. A lease can split the rent between the housing authority and the resident.",
  },
  {
    q: "Is there a mobile app?",
    a: "It works in the browser on any phone, and can be added to the home screen like an app.",
  },
] as const;

const h2Class = "text-[26px] font-extrabold tracking-tight text-slate-900 sm:text-3xl";

export default async function HomePage() {
  // Database-backed, not auth() — a token naming a deleted account has to land
  // on this marketing page rather than be routed into the app, or it ping-pongs
  // with the guards forever. See liveSessionUser().
  const user = await liveSessionUser();
  if (user) {
    redirect(homeFor({ role: user.role, organizationId: user.organizationId }));
  }

  // Same nonce the CSP issues for this request; see src/middleware.ts.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <div className={clsx("flex min-h-dvh flex-col", nunito.className)}>
      <StructuredData nonce={nonce} faqs={FAQS.map((f) => ({ q: f.q, a: f.a }))} />

      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
        <Logo />
        <nav className="flex items-center gap-1 sm:gap-2" aria-label="Main">
          <a href="#how" className="btn-ghost hidden sm:inline-flex">
            How it works
          </a>
          <a href="#faq" className="btn-ghost hidden sm:inline-flex">
            Questions
          </a>
          {/* Wrapped rather than given `hidden` directly: the toggle sets its own
              display, and two display utilities on one element is a coin toss. */}
          <span className="mx-1 hidden sm:inline-flex">
            <ThemeToggle />
          </span>
          <Link href="/login" className="btn-ghost whitespace-nowrap">
            Sign in
          </Link>
          <Link href="/signup" className="btn-primary rounded-full px-4 whitespace-nowrap">
            Start free
          </Link>
        </nav>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6">
        {/*
         * The hero is one warm, rounded panel — a cushion, if you like — on the
         * cool page. Copy on the left, the window scene on the right; on a
         * phone the scene sits under the copy at a size that still reads.
         */}
        <section className="mt-2 rounded-[28px] border border-cozy-edge bg-cozy px-6 py-12 sm:px-10 sm:py-14 lg:px-14 lg:py-16">
          <div className="grid items-center gap-10 lg:grid-cols-[1fr_1fr] lg:gap-8">
            <div>
              {/*
               * One h1 on the page, and it leads with the category a searcher
               * types ("property management") rather than the brand — nobody is
               * searching for a product they haven't heard of by name yet.
               */}
              <h1 className="max-w-xl text-[44px] leading-[1.05] font-extrabold tracking-tight text-slate-900 text-balance sm:text-6xl">
                Property management made easy.
              </h1>
              <p className="mt-5 max-w-md text-lg leading-relaxed text-slate-600 sm:text-xl">
                Leases, rent and repairs in one calm place. Nothing to set up, nothing to learn.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link href="/signup" className="btn-primary rounded-full px-6 py-3 text-[15px]">
                  Start free
                </Link>
                <a
                  href="#how"
                  className="btn rounded-full border border-slate-300 bg-surface px-6 py-3 text-[15px] text-slate-700 hover:bg-slate-50 dark:hover:bg-slate-100"
                >
                  See how it works
                </a>
              </div>
              <p className="mt-4 text-sm text-slate-500">Free to start. No credit card.</p>
            </div>
            <HeroScene className="mx-auto w-full max-w-[420px] lg:max-w-none" />
          </div>
        </section>

        <section aria-labelledby="how" className="scroll-mt-24 py-20" id="how">
          <h2 className={h2Class}>Three things, done simply.</h2>
          <div className="mt-10 grid gap-10 sm:grid-cols-3">
            {THINGS.map((t) => (
              <article key={t.heading} className="border-t border-slate-200 pt-5">
                <h3 className="text-lg font-bold text-slate-900">{t.heading}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-slate-600">{t.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section aria-labelledby="faq" className="scroll-mt-24 border-t border-slate-200 py-20" id="faq">
          <h2 className={h2Class}>Questions</h2>
          {/*
           * Answers are in the HTML rather than behind a click: the answer text
           * is the reason this section exists, and content a crawler has to
           * guess is interactive is content that may not be indexed.
           */}
          <dl className="mt-10 grid gap-x-12 gap-y-8 sm:grid-cols-2">
            {FAQS.map((f) => (
              <div key={f.q}>
                <dt className="text-[15px] font-bold text-slate-900">{f.q}</dt>
                <dd className="mt-1.5 text-[15px] leading-relaxed text-slate-600">{f.a}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* The closing panel echoes the hero: same warm ground, the cat small
            in the corner, one action. */}
        <section
          aria-labelledby="cta"
          className="mb-10 flex flex-col items-start gap-6 rounded-[28px] border border-cozy-edge bg-cozy px-6 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-10"
        >
          <div>
            <h2 id="cta" className={h2Class}>
              Start with one property.
            </h2>
            <p className="mt-2 text-[15px] text-slate-600 sm:text-base">
              Add it, add a lease, and you&apos;re managing.
            </p>
            <Link href="/signup" className="btn-primary mt-6 inline-flex rounded-full px-6 py-3 text-[15px]">
              Create your account
            </Link>
          </div>
          <CatMark className="hidden w-36 shrink-0 sm:block" />
        </section>
      </main>

      <footer className="mx-auto w-full max-w-6xl px-6 py-8 text-xs text-slate-400">
        <p>
          {SITE.name} · Rent is moved by Stripe; we never hold your money ·{" "}
          <Link href="/login" className="hover:underline">
            Sign in
          </Link>
        </p>
      </footer>
    </div>
  );
}
