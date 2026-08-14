"use client";

import { usePathname } from "next/navigation";
import clsx from "clsx";
import type { ReactNode } from "react";
import Link from "@/components/link";

export function NavLink({
  href,
  children,
  badge,
  exact,
}: {
  href: string;
  children: ReactNode;
  badge?: number;
  /**
   * By default a link stays highlighted for its whole subtree, so
   * /app/properties/abc keeps "Properties" lit. Set `exact` for section roots
   * that sit above their own children — /app, /portal, /app/settings — where
   * prefix matching would light up two links at once.
   */
  exact?: boolean;
}) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={clsx(
        "flex shrink-0 items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-brand-50 text-brand-800 dark:bg-brand-500/15 dark:text-brand-200"
          : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
      )}
    >
      <span>{children}</span>
      {badge && badge > 0 ? (
        <span
          className={clsx(
            "rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums",
            active
              ? "bg-brand-200 text-brand-900 dark:bg-brand-400/30 dark:text-brand-50"
              : "bg-slate-200 text-slate-700",
          )}
        >
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
    </Link>
  );
}
