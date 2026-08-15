import clsx from "clsx";

/**
 * The wordmark. The name itself lives in SITE.name (src/lib/site.ts) — this file
 * is the artwork, and the two matching monograms are src/app/icon.svg and
 * src/app/apple-icon.png (regenerate the latter with
 * scripts/generate-apple-icon.mjs).
 */
export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={clsx("inline-flex items-center gap-2", className)}>
      <span
        aria-hidden
        className="grid size-7 place-items-center rounded-lg bg-brand-600"
      >
        <svg
          viewBox="0 0 32 32"
          className="size-4"
          fill="none"
          stroke="#fff"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 19 16 7 26 19" />
          <path d="M5 26h22" />
          <path d="M9 17V9h4v8" />
          <rect x="13" y="20" width="6" height="6" />
        </svg>
      </span>
      {!compact ? (
        <span className="text-[15px] font-semibold tracking-tight text-slate-900">ComfyLease</span>
      ) : null}
    </span>
  );
}
