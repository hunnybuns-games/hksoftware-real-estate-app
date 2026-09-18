import clsx from "clsx";

import { CatMark } from "@/components/cat-mark";

/**
 * The wordmark. The name itself lives in SITE.name (src/lib/site.ts) — this
 * file is only the arrangement: the cat mark (src/components/cat-mark.tsx,
 * the same drawing as the favicon in src/app/icon.svg) beside the name.
 */
export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={clsx("inline-flex items-center gap-2", className)}>
      <CatMark className="size-7 shrink-0" />
      {!compact ? (
        <span className="text-[15px] font-semibold tracking-tight text-slate-900">ComfyLease</span>
      ) : null}
    </span>
  );
}
