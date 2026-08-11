import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/rbac";
import { SidebarShell, type NavItem } from "@/components/app-shell";

/**
 * Nothing under here may ever be indexed. Every page below this layout renders
 * somebody's private records — leases, tenant names, rent ledgers, payment
 * history — so a search result pointing at one is a data leak, not a ranking
 * problem.
 *
 * Set on the layout rather than page by page because Next merges metadata field
 * by field: a page beneath this one that exports only a `title` keeps this
 * `robots` value, so a page added later is private by default instead of private
 * only if its author remembered. `nocache` and `noarchive` also keep the content
 * out of cached copies and snippets, which outlive the URL itself.
 *
 * This is the layer that actually holds. /robots.txt (src/app/robots.ts) only
 * asks crawlers not to fetch, and can't stop a URL someone else links to from
 * being indexed. next.config.ts sets the same directives as an X-Robots-Tag
 * header, covering responses that aren't HTML and so have nowhere to put a meta
 * tag. Underneath all three, these routes require a session.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true, noarchive: true },
};

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireStaff();

  const [org, openRequests] = await Promise.all([
    db.organization.findUnique({
      where: { id: ctx.organizationId },
      select: { name: true },
    }),
    db.maintenanceRequest.count({
      where: { organizationId: ctx.organizationId, status: { not: "RESOLVED" } },
    }),
  ]);

  const nav: NavItem[] = [
    { href: "/app", label: "Dashboard", exact: true },
    { href: "/app/properties", label: "Properties" },
    { href: "/app/tenants", label: "Tenants" },
    { href: "/app/leases", label: "Leases" },
    { href: "/app/payments", label: "Rent" },
    { href: "/app/reports", label: "Reports" },
    { href: "/app/maintenance", label: "Maintenance", badge: openRequests },
  ];

  const secondaryNav: NavItem[] = [{ href: "/app/settings", label: "Settings" }];

  return (
    <SidebarShell
      nav={nav}
      secondaryNav={secondaryNav}
      user={{ name: ctx.name, email: ctx.email, role: ctx.role }}
      orgName={org?.name ?? "Your organization"}
    >
      {children}
    </SidebarShell>
  );
}
