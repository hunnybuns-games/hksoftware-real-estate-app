import clsx from "clsx";

/**
 * The wordmark. The name itself lives in SITE.name (src/lib/site.ts) — this file
 * is the artwork for the header badge: a roofline on a brand-coloured tile.
 *
 * The favicon and app icons are a different mark now — the sleeping cat in
 * src/app/icon.svg, with apple-icon.png and public/icons/* rendered from it
 * by the scripts/generate-*.mjs generators. This badge hasn't been switched
 * over; if the cat becomes the brand, this is the one other place it lives.
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
