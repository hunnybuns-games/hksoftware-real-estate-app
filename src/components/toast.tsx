"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";

/**
 * A brief, self-dismissing confirmation banner — for actions whose own UI
 * disappears the moment they succeed (see EndLeaseSection), so there's still
 * something on screen telling the user it actually went through.
 *
 * Fixed-position rather than inline: it needs to survive the surrounding
 * markup being revalidated away, which an inline FormSuccess can't.
 */
export function Toast({
  message,
  tone = "success",
  durationMs = 4000,
}: {
  message: string;
  tone?: "success" | "danger";
  durationMs?: number;
}) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), durationMs);
    return () => clearTimeout(timer);
  }, [durationMs]);

  const tones = {
    success:
      "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-400/25 dark:bg-emerald-500/12 dark:text-emerald-100",
    danger:
      "border-red-200 bg-red-50 text-red-900 dark:border-red-400/25 dark:bg-red-500/12 dark:text-red-100",
  }[tone];

  return (
    <div
      role="status"
      aria-live="polite"
      className={clsx(
        "fixed bottom-6 right-6 z-50 rounded-lg border px-4 py-3 text-sm font-medium shadow-lg transition-all duration-300",
        tones,
        visible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-2 opacity-0",
      )}
    >
      {message}
    </div>
  );
}
