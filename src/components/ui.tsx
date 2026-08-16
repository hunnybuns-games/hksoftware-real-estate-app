import Link from "@/components/link";
import clsx from "clsx";
import type { ReactNode } from "react";
import type { ApplicationStatus, PaymentSource } from "@prisma/client";
import { applicationStatusLabel, applicationStatusTone } from "@/lib/applications";

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Card({
  children,
  className,
  title,
  description,
  actions,
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  padded?: boolean;
}) {
  return (
    <section className={clsx("card", className)}>
      {title || actions ? (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
            {description ? <p className="mt-0.5 text-xs text-slate-500">{description}</p> : null}
          </div>
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className={padded ? "p-5" : undefined}>{children}</div>
    </section>
  );
}

/** A big number with a label. Used sparingly — four across, max. */
export function StatTile({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "positive" | "warning" | "danger";
}) {
  const valueTone = {
    default: "text-slate-900",
    positive: "text-emerald-700 dark:text-emerald-300",
    warning: "text-amber-700 dark:text-amber-300",
    danger: "text-red-700 dark:text-red-300",
  }[tone];

  return (
    <div className="card p-5">
      <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</p>
      <p className={clsx("mt-2 text-2xl font-semibold tabular-nums", valueTone)}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

/**
 * Placeholder building blocks for `loading.tsx` files.
 *
 * Every list→detail click in the app (a tenant row, a property, a lease…)
 * lands on a dynamically rendered page — it reads the session and queries the
 * database on every request, so it can't be prebuilt, and with no loading.tsx
 * present the browser just sits frozen until that round trip finishes. These
 * don't make the query faster; they make the click feel instant by showing
 * the shape of the page immediately, with the real content streaming in
 * behind it. Composed into each page's actual layout (a stat row here, a
 * two-column card grid there) rather than one generic spinner everywhere,
 * because a skeleton that doesn't resemble what's coming doesn't read as
 * "loading this page" — it just reads as a flash before a layout jump.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={clsx("animate-pulse rounded-md bg-slate-200", className)} />;
}

/** Matches PageHeader's shape. */
export function PageHeaderSkeleton({ withAction = true }: { withAction?: boolean }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-32" />
      </div>
      {withAction ? <Skeleton className="h-9 w-28 rounded-lg" /> : null}
    </div>
  );
}

/** Matches StatTile's shape, for the stat rows above several detail pages. */
export function StatTileSkeleton() {
  return (
    <div className="card space-y-2 p-5">
      <Skeleton className="h-3 w-16" />
      <Skeleton className="h-7 w-20" />
    </div>
  );
}

/** Matches Card's shape — a titled block with a few placeholder lines inside. */
export function CardSkeleton({ lines = 3, title = true }: { lines?: number; title?: boolean }) {
  return (
    <section className="card">
      {title ? (
        <div className="border-b border-slate-200 px-5 py-4">
          <Skeleton className="h-4 w-24" />
        </div>
      ) : null}
      <div className="space-y-3 p-5">
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton key={i} className="h-4 w-full" />
        ))}
      </div>
    </section>
  );
}

type BadgeTone = "neutral" | "green" | "amber" | "red" | "blue" | "slate";

/*
 * The two neutral tones need no `dark:` — the slate scale is theme-aware (see
 * src/app/globals.css). The coloured ones do: a `-50` tint stays a bright pastel
 * in dark mode and its `-700` text stays unreadably dark, so both ends move. The
 * dark recipe is the same every time — a translucent wash of the `-500` for the
 * fill and ring, and a `-200`/`-300` for the text — which keeps the badges
 * reading as one family rather than six unrelated colours.
 */
const badgeTones: Record<BadgeTone, string> = {
  neutral: "bg-slate-100 text-slate-700 ring-slate-200",
  slate: "bg-slate-100 text-slate-600 ring-slate-200",
  green:
    "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/12 dark:text-emerald-300 dark:ring-emerald-400/25",
  amber:
    "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-500/12 dark:text-amber-300 dark:ring-amber-400/25",
  red: "bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/12 dark:text-red-300 dark:ring-red-400/25",
  blue: "bg-brand-50 text-brand-700 ring-brand-200 dark:bg-brand-500/15 dark:text-brand-200 dark:ring-brand-400/25",
};

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: BadgeTone;
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        badgeTones[tone],
      )}
    >
      {children}
    </span>
  );
}

export function UnitStatusBadge({ status }: { status: "VACANT" | "OCCUPIED" | "MAINTENANCE" }) {
  const map = {
    OCCUPIED: { tone: "green", label: "Occupied" },
    VACANT: { tone: "amber", label: "Vacant" },
    MAINTENANCE: { tone: "slate", label: "Maintenance" },
  } as const;
  const { tone, label } = map[status];
  return <Badge tone={tone}>{label}</Badge>;
}

export function PaymentStatusBadge({
  status,
}: {
  status: "PENDING" | "PROCESSING" | "SUCCEEDED" | "FAILED" | "REFUNDED";
}) {
  const map = {
    SUCCEEDED: { tone: "green", label: "Paid" },
    PROCESSING: { tone: "blue", label: "Clearing" },
    PENDING: { tone: "amber", label: "Awaiting payment" },
    FAILED: { tone: "red", label: "Failed" },
    REFUNDED: { tone: "slate", label: "Refunded" },
  } as const;
  const { tone, label } = map[status];
  return <Badge tone={tone}>{label}</Badge>;
}

export function PaymentSourceBadge({ source }: { source: PaymentSource }) {
  const map = {
    MANUAL_CASH: { tone: "slate", label: "Cash / check" },
    IMPORT_BANK: { tone: "neutral", label: "Bank transfer" },
    IMPORT_VENMO: { tone: "blue", label: "Venmo" },
    IMPORT_CASHAPP: { tone: "blue", label: "Cash App" },
    IMPORT_HAP: { tone: "green", label: "HAP" },
    STRIPE_NATIVE: { tone: "blue", label: "Online" },
    IMPORT_PLAID: { tone: "green", label: "Bank feed" },
  } as const satisfies Record<PaymentSource, { tone: BadgeTone; label: string }>;
  const { tone, label } = map[source];
  return <Badge tone={tone}>{label}</Badge>;
}

/** Set by the reconciliation engine, not a user — see src/lib/reconciliation.ts. */
export function ReconciliationStatusBadge({
  status,
}: {
  status: "UNMATCHED" | "MATCHED" | "SHORT" | "LATE";
}) {
  const map = {
    MATCHED: { tone: "green", label: "Matched" },
    SHORT: { tone: "red", label: "Short" },
    LATE: { tone: "amber", label: "Late" },
    UNMATCHED: { tone: "slate", label: "Unmatched" },
  } as const;
  const { tone, label } = map[status];
  return <Badge tone={tone}>{label}</Badge>;
}

export function MaintenanceStatusBadge({
  status,
}: {
  status: "OPEN" | "IN_PROGRESS" | "RESOLVED";
}) {
  const map = {
    OPEN: { tone: "amber", label: "Open" },
    IN_PROGRESS: { tone: "blue", label: "In progress" },
    RESOLVED: { tone: "green", label: "Resolved" },
  } as const;
  const { tone, label } = map[status];
  return <Badge tone={tone}>{label}</Badge>;
}

export function PriorityBadge({
  priority,
}: {
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
}) {
  const map = {
    LOW: { tone: "slate", label: "Low" },
    NORMAL: { tone: "neutral", label: "Normal" },
    HIGH: { tone: "amber", label: "High" },
    URGENT: { tone: "red", label: "Urgent" },
  } as const;
  const { tone, label } = map[priority];
  return <Badge tone={tone}>{label}</Badge>;
}

export function LeaseStatusBadge({ status }: { status: "DRAFT" | "ACTIVE" | "ENDED" }) {
  const map = {
    ACTIVE: { tone: "green", label: "Active" },
    DRAFT: { tone: "amber", label: "Draft" },
    ENDED: { tone: "slate", label: "Ended" },
  } as const;
  const { tone, label } = map[status];
  return <Badge tone={tone}>{label}</Badge>;
}

/** Labels/tones come from src/lib/applications.ts — the framework-free source of truth. */
export function ApplicationStatusBadge({ status }: { status: ApplicationStatus }) {
  return <Badge tone={applicationStatusTone(status)}>{applicationStatusLabel(status)}</Badge>;
}

/**
 * Empty states carry real weight here: a new account is nothing *but* empty
 * states, and this is where a landlord decides whether the product is for them.
 */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="px-6 py-14 text-center">
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      <p className="mx-auto mt-1.5 max-w-md text-sm text-slate-500">{description}</p>
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function Table({
  head,
  children,
}: {
  head: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[36rem] border-collapse">
        <thead className="border-b border-slate-200 bg-slate-50/70">{head}</thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
    </div>
  );
}

export function Money({
  cents,
  className,
  formatter,
}: {
  cents: number;
  className?: string;
  formatter: (cents: number) => string;
}) {
  return <span className={clsx("tabular-nums", className)}>{formatter(cents)}</span>;
}

export function Banner({
  tone = "info",
  title,
  children,
  action,
}: {
  tone?: "info" | "warning" | "success" | "danger";
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  const tones = {
    info: "border-brand-200 bg-brand-50 text-brand-900 dark:border-brand-400/25 dark:bg-brand-500/12 dark:text-brand-100",
    warning:
      "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-400/25 dark:bg-amber-500/12 dark:text-amber-100",
    success:
      "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-400/25 dark:bg-emerald-500/12 dark:text-emerald-100",
    danger:
      "border-red-200 bg-red-50 text-red-900 dark:border-red-400/25 dark:bg-red-500/12 dark:text-red-100",
  }[tone];

  return (
    <div className={clsx("flex flex-wrap items-start justify-between gap-3 rounded-xl border px-4 py-3", tones)}>
      <div className="text-sm">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={title ? "mt-0.5" : undefined}>{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function Breadcrumbs({
  items,
}: {
  items: { label: string; href?: string }[];
}) {
  return (
    <nav aria-label="Breadcrumb" className="mb-3 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
      {items.map((item, i) => (
        <span key={`${item.label}-${i}`} className="flex items-center gap-1.5">
          {i > 0 ? <span aria-hidden className="text-slate-300">/</span> : null}
          {item.href ? (
            <Link href={item.href} className="hover:text-slate-700 hover:underline">
              {item.label}
            </Link>
          ) : (
            <span className="text-slate-700">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

export function DescriptionList({
  items,
}: {
  items: { label: string; value: ReactNode }[];
}) {
  return (
    <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label}>
          <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">
            {item.label}
          </dt>
          <dd className="mt-1 text-sm text-slate-900">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
