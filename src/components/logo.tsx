import clsx from "clsx";

/**
 * "Rentwell" is a placeholder name — swap the wordmark here and the metadata in
 * src/app/layout.tsx when the real brand lands.
 */
export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={clsx("inline-flex items-center gap-2", className)}>
      <span
        aria-hidden
        className="grid size-7 place-items-center rounded-lg bg-brand-600 text-[13px] font-bold text-white"
      >
        R
      </span>
      {!compact ? (
        <span className="text-[15px] font-semibold tracking-tight text-slate-900">Rentwell</span>
      ) : null}
    </span>
  );
}
