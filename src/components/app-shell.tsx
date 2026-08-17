import Link from "@/components/link";
import clsx from "clsx";
import type { ReactNode } from "react";
import { Logo } from "@/components/logo";
import { SignOutButton } from "@/components/sign-out-button";
import { NavLink } from "@/components/nav-link";
import { ThemeToggle } from "@/components/theme-toggle";

export type NavItem = { href: string; label: string; badge?: number; exact?: boolean };

/**
 * One shell for all three audiences. Staff get a sidebar (desktop-first, which
 * is where they work); tenants and owners get a top bar, because their surface
 * is small and mobile-first.
 */
export function SidebarShell({
  nav,
  secondaryNav,
  user,
  orgName,
  children,
}: {
  nav: NavItem[];
  secondaryNav?: NavItem[];
  user: { name: string; email: string; role: string };
  orgName: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[16rem_1fr]">
      <aside className="flex flex-col border-slate-200 bg-surface lg:sticky lg:top-0 lg:h-dvh lg:border-r print:hidden">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 lg:border-b-0">
          <Link href="/app">
            <Logo />
          </Link>
        </div>

        {/* Horizontally scrolling nav on mobile, vertical list on desktop. */}
        <nav className="flex gap-1 overflow-x-auto border-b border-slate-200 px-3 pb-3 lg:flex-col lg:overflow-visible lg:border-b-0 lg:px-3 lg:pb-0">
          {nav.map((item) => (
            <NavLink key={item.href} href={item.href} badge={item.badge} exact={item.exact}>
              {item.label}
            </NavLink>
          ))}
        </nav>

        {secondaryNav?.length ? (
          <nav className="mt-auto hidden gap-1 border-t border-slate-200 px-3 py-3 lg:flex lg:flex-col">
            {secondaryNav.map((item) => (
              <NavLink key={item.href} href={item.href} badge={item.badge}>
                {item.label}
              </NavLink>
            ))}
          </nav>
        ) : null}

        <div
          className={clsx(
            "hidden border-t border-slate-200 px-5 py-4 lg:block",
            !secondaryNav?.length && "mt-auto",
          )}
        >
          <p className="truncate text-sm font-medium text-slate-900">{user.name}</p>
          <p className="truncate text-xs text-slate-500">{orgName}</p>
          <ThemeToggle className="mt-3" />
          <SignOutButton className="mt-3" />
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <div className="flex items-center justify-between gap-4 px-6 py-3 lg:hidden print:hidden">
          <p className="truncate text-xs text-slate-500">{orgName}</p>
          <div className="flex shrink-0 items-center gap-2">
            <ThemeToggle />
            <SignOutButton />
          </div>
        </div>
        <main className="min-w-0 flex-1 px-5 pt-4 pb-16 sm:px-8 sm:pt-8 print:p-0">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}

export function TopbarShell({
  nav,
  user,
  orgName,
  homeHref,
  children,
}: {
  nav: NavItem[];
  user: { name: string };
  orgName: string;
  homeHref: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-surface/95 backdrop-blur print:hidden">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-5 py-3.5">
          <Link href={homeHref} className="min-w-0">
            <span className="block truncate text-sm font-semibold text-slate-900">{orgName}</span>
            <span className="block truncate text-xs text-slate-500">{user.name}</span>
          </Link>
          <div className="flex shrink-0 items-center gap-2">
            <ThemeToggle />
            <SignOutButton />
          </div>
        </div>
        <nav className="mx-auto flex w-full max-w-3xl gap-1 overflow-x-auto px-3 pb-2.5">
          {nav.map((item) => (
            <NavLink key={item.href} href={item.href} badge={item.badge} exact={item.exact}>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="mx-auto w-full max-w-3xl px-5 pt-6 pb-20 print:p-0">{children}</main>
    </div>
  );
}
