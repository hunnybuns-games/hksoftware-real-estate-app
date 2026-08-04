import { db } from "@/lib/db";
import { requireStaff } from "@/lib/rbac";
import { SidebarShell, type NavItem } from "@/components/app-shell";

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
