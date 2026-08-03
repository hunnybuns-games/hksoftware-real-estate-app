import { db } from "@/lib/db";
import { requireTenant } from "@/lib/rbac";
import { TopbarShell, type NavItem } from "@/components/app-shell";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireTenant();

  const tenant = await db.tenant.findUnique({
    where: { id: ctx.tenantId },
    select: { organization: { select: { name: true } } },
  });

  const nav: NavItem[] = [
    { href: "/portal", label: "Rent", exact: true },
    { href: "/portal/maintenance", label: "Maintenance" },
    { href: "/portal/lease", label: "My lease" },
  ];

  return (
    <TopbarShell
      nav={nav}
      user={{ name: ctx.name }}
      orgName={tenant?.organization.name ?? "Resident portal"}
      homeHref="/portal"
    >
      {children}
    </TopbarShell>
  );
}
