"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import type { ComponentProps, ComponentType, ReactNode } from "react";

/**
 * Next's public `next/link` type export hasn't caught up to
 * `unstable_dynamicOnHover` — it's missing from LinkProps in
 * node_modules/next/dist/client/link.d.ts — even though the App Router's own
 * Link implementation reads and acts on the prop at runtime (confirmed in
 * node_modules/next/dist/client/app-dir/link.js, which destructures it by
 * name). A narrow cast, local to this one usage, so a real type error
 * anywhere else in this file still surfaces normally rather than being
 * swallowed by a broader suppression.
 */
const LinkWithHoverPrefetch = Link as ComponentType<
  ComponentProps<typeof Link> & { unstable_dynamicOnHover?: boolean }
>;

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
    <LinkWithHoverPrefetch
      href={href}
      /*
       * Every page this points at — /app/*, /portal/*, /owner/*, and their
       * settings tabs — is a dynamically rendered Server Component: the guard
       * at the top (requireStaff()/requireTenant()/requireOwner()) reads
       * cookies to check the session, which forces the whole page to be
       * per-request rather than prebuilt. Next's default prefetch only warms
       * such a page down to its nearest loading.js — and this app has none —
       * so without this prop, clicking a nav item today starts completely
       * cold: the click is the first moment any of that page's data is
       * requested.
       *
       * unstable_dynamicOnHover upgrades the prefetch to fetch the real page —
       * running the actual auth check and query — the moment the pointer
       * lands on the link, so by the time someone actually clicks, the data
       * may already be in hand. Requires experimental.dynamicOnHover in
       * next.config.ts; see the comment there for why the pairing is required.
       *
       * Deliberately scoped to this component alone. NavLink only ever renders
       * a handful of nav items or settings tabs per page, so a hover firing a
       * real authenticated database query is a bounded, human-paced cost. The
       * per-row links in every list page (properties, leases, tenants) go
       * through plain next/link without this, on purpose — a mouse sweeping
       * down a table of 40 units is not a hover a database wants to answer 40
       * times.
       */
      unstable_dynamicOnHover
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
    </LinkWithHoverPrefetch>
  );
}
