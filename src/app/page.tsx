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
 * Every feature listed on this page is one the app actually has — the copy is
 * written from src/actions and src/lib, not from a positioning document. That
 * matters beyond honesty: a landing page that promises a feature the product
 * lacks converts a search visitor into a refund request, and search engines
 * increasingly measure the bounce.
 */
const FEATURES = [
  {
    heading: "Your portfolio, not a spreadsheet",
    body: "Properties, units and occupancy in one list, so you can see what's vacant, what's leased and what rent is scheduled without maintaining a parallel workbook. Unit status stays in step with its lease automatically — ending a lease vacates the unit.",
  },
  {
    heading: "Leases with the terms you actually sign",
    body: "Rent amount, deposit, start and end dates, and the day of the month rent is due. Overlapping active leases on the same unit are refused at write time, because two of them is almost always a typo you'd find months later in a rent roll.",
  },
  {
    heading: "Housing assistance, handled",
    body: "A lease can carry a subsidy split: the housing authority's portion and the resident's portion tracked separately against the same monthly rent. Section 8 and HAP payments reconcile against the lease like any other payment, instead of living in a side note.",
  },
  {
    heading: "Rent that collects itself",
    body: "Residents pay by bank transfer from their own portal, and payments post against the lease automatically. Rent is moved by Stripe directly to your account — the money never sits with us.",
  },
  {
    heading: "Payments reconciled, not just recorded",
    body: "Connect a bank feed, or import a CSV from your bank, Venmo, Cash App or a housing authority. Payments are matched to leases, and each one is marked matched, short or late against what was actually owed for the period.",
  },
  {
    heading: "Maintenance with a paper trail",
    body: "Residents submit requests with photos from their phone. You get a queue with status, internal notes that stay internal, and an email to the resident when you choose to send one — instead of a voicemail box and a text thread.",
  },
  {
    heading: "Owners see their own numbers",
    body: "Give an owner read-only access scoped to the properties that are actually theirs. They get statements and reports for those properties and nothing else, so you stop assembling a PDF by hand every month.",
  },
  {
    heading: "The reports a lender asks for",
    body: "Rent roll, profit and loss per property, and owner statements — each exportable as CSV, so the numbers go into whatever your accountant already uses.",
  },
] as const;

/**
 * Written as the questions a landlord actually asks before signing up, because
 * those are the queries this page can realistically be found for — and because
 * the answers are the same ones they'd get from support. Rendered on the page and
 * emitted as FAQPage structured data from the same array.
 */
const FAQS = [
  {
    q: "Who is this built for?",
    a: "Independent landlords and small managers with roughly 20 to 200 units — portfolios that have outgrown a spreadsheet but don't need enterprise property management software, and shouldn't have to pay for it or sit through an onboarding call to start.",
  },
  {
    q: "How do residents pay rent?",
    a: "By bank transfer (ACH) from their resident portal. Payments are processed by Stripe and go to your own account; we never hold your money. Payments post against the resident's lease automatically, so the balance you see is the balance they see.",
  },
  {
    q: "Does it handle Section 8 and housing assistance payments?",
    a: "Yes. A lease can record a subsidy portion and the payer, so the housing authority's share and the resident's share are tracked separately against the same monthly rent. Housing authority payments can be imported and reconciled like any other payment.",
  },
  {
    q: "Can I bring in payments I collected outside the app?",
    a: "Yes, three ways: connect a bank feed so deposits sync automatically, upload a CSV exported from your bank, Venmo, Cash App or a housing authority, or record a cash or cheque payment by hand. Imported payments are matched to leases, and anything that can't be matched is surfaced rather than silently dropped.",
  },
  {
    q: "Can property owners get their own reports?",
    a: "Yes. An owner can be invited with read-only access limited to the properties assigned to them. They see statements and reports for those properties only — not the rest of your portfolio.",
  },
  {
    q: "What happens when rent is late?",
    a: "Rent charges are posted for each month automatically. A resident gets a reminder shortly before rent is due, and a notice once the grace period you configure has lapsed. Late balances surface on your dashboard, and you set the grace period and late fee per organisation.",
  },
  {
    q: "Is there a mobile app?",
    a: "There's no separate app to install from a store. The whole thing is built to be used on a phone, and both the management side and the resident portal can be added to a home screen and opened like an app.",
  },
  {
    q: "Can I invite my staff?",
    a: "Yes. Invite people as administrators or staff, with admins controlling organisation settings, payment connections and the team itself. Access is checked on every action, so removing someone revokes their access immediately rather than whenever their session happens to expire.",
  },
] as const;

/*
 * Section headings share one treatment: Nunito at 800, tight tracking, sized
 * for reading rather than shouting. Defined once so the four sections below
 * can't drift apart.
 */
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
          <a href="#features" className="btn-ghost hidden sm:inline-flex">
            What it does
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
          <div className="grid items-center gap-10 lg:grid-cols-[1.05fr_1fr] lg:gap-8">
            <div>
              <p className="text-sm font-bold tracking-wide text-brand-700 uppercase dark:text-brand-300">
                For 20–200 unit portfolios
              </p>
              {/*
               * One h1 on the page, and it leads with the category a searcher
               * types ("property management") rather than the brand — nobody is
               * searching for a product they haven't heard of by name yet.
               */}
              <h1 className="mt-4 max-w-xl text-4xl leading-[1.08] font-extrabold tracking-tight text-slate-900 text-balance sm:text-5xl lg:text-[50px]">
                Property management software you can relax with.
              </h1>
              <p className="mt-5 max-w-lg text-lg leading-relaxed text-slate-600">
                Units and leases in one place, rent collected by bank transfer, payments matched
                to what was owed, and repairs with a paper trail. Built for the landlord who
                outgrew a spreadsheet and doesn&apos;t want an enterprise tool.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link href="/signup" className="btn-primary rounded-full px-6 py-3 text-[15px]">
                  Start free
                </Link>
                <a
                  href="#features"
                  className="btn rounded-full border border-slate-300 bg-surface px-6 py-3 text-[15px] text-slate-700 hover:bg-slate-50 dark:hover:bg-slate-100"
                >
                  See what it does
                </a>
              </div>
              <p className="mt-4 text-sm text-slate-500">
                No setup call. No credit card. A property and a lease on the books in ten minutes.
              </p>
            </div>
            <HeroScene className="mx-auto w-full max-w-[420px] lg:max-w-none" />
          </div>
        </section>

        <section aria-labelledby="features" className="scroll-mt-24 py-20" id="features">
          <div className="max-w-2xl">
            <h2 className={h2Class}>Everything a small landlord needs. Nothing you don&apos;t.</h2>
            <p className="mt-3 text-base leading-relaxed text-slate-600">
              Eight things it does, each written from what&apos;s actually in the app.
            </p>
          </div>
          <div className="mt-10 grid gap-x-12 gap-y-9 sm:grid-cols-2">
            {FEATURES.map((f) => (
              <article key={f.heading} className="border-t border-slate-200 pt-5">
                <h3 className="text-[15px] font-bold text-slate-900">{f.heading}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-slate-600">{f.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section aria-labelledby="who" className="border-t border-slate-200 py-20">
          <h2 id="who" className={h2Class}>
            Who it&apos;s for
          </h2>
          <div className="mt-6 max-w-3xl space-y-4 text-[15px] leading-relaxed text-slate-600 sm:text-base">
            <p>
              If you own or manage a few buildings — a duplex and a triplex, a small apartment
              block, a scattered-site portfolio of single-family rentals — the tools available to
              you tend to come in two sizes. Spreadsheets, which are free and stop working the
              moment you need to know who paid and who didn&apos;t without reading every row. Or
              enterprise platforms priced per unit with a minimum that assumes a thousand of them.
            </p>
            <p>
              This is the middle. It knows what a lease is, what a rent charge is, and what happens
              when a housing authority pays part of the rent on the 3rd and the resident pays the
              rest on the 11th. It gives residents somewhere to pay and somewhere to report a
              leaking tap, and it gives owners their own numbers without you assembling them.
            </p>
          </div>
        </section>

        <section aria-labelledby="faq" className="scroll-mt-24 border-t border-slate-200 py-20" id="faq">
          <h2 className={h2Class}>Questions</h2>
          {/*
           * Answers are in the HTML rather than behind a click. A <details>
           * accordion would look tidier, but the answer text is the reason this
           * section exists, and content a crawler has to guess is interactive is
           * content that may not be indexed.
           */}
          <dl className="mt-10 grid gap-x-12 gap-y-8 sm:grid-cols-2">
            {FAQS.map((f) => (
              <div key={f.q}>
                <dt className="text-[15px] font-bold text-slate-900">{f.q}</dt>
                <dd className="mt-2 text-[15px] leading-relaxed text-slate-600">{f.a}</dd>
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
          <div className="max-w-xl">
            <h2 id="cta" className={h2Class}>
              Start with one property. Then put your feet up.
            </h2>
            <p className="mt-3 text-[15px] leading-relaxed text-slate-600 sm:text-base">
              Add a property, a unit and a lease, and the dashboard has something real on it.
              Invite your residents when you&apos;re ready for them.
            </p>
            <Link href="/signup" className="btn-primary mt-6 inline-flex rounded-full px-6 py-3 text-[15px]">
              Create your account
            </Link>
          </div>
          <CatMark className="hidden w-36 shrink-0 sm:block" />
        </section>
      </main>

      <footer className="mx-auto w-full max-w-6xl px-6 py-8 text-xs text-slate-400">
        <p>Rent is moved by Stripe. We never hold your money.</p>
        <p className="mt-2">
          {SITE.name} — {SITE.tagline}.{" "}
          <Link href="/login" className="hover:underline">
            Sign in
          </Link>{" "}
          ·{" "}
          <Link href="/signup" className="hover:underline">
            Create an account
          </Link>
        </p>
      </footer>
    </div>
  );
}
