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
        className="grid size-7 place-items-center rounded-lg bg-brand-600 text-[13px] font-bold text-white"
      >
        C
      </span>
      {!compact ? (
        <span className="text-[15px] font-semibold tracking-tight text-slate-900">ComfyLease</span>
      ) : null}
    </span>
  );
}
