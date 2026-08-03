import { db } from "@/lib/db";
import { requireOwner } from "@/lib/rbac";
import { TopbarShell, type NavItem } from "@/components/app-shell";

export default async function OwnerLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireOwner();

  const org = await db.organization.findUnique({
    where: { id: ctx.organizationId },
    select: { name: true },
  });

  const nav: NavItem[] = [{ href: "/owner", label: "Overview", exact: true }];

  return (
    <TopbarShell
      nav={nav}
      user={{ name: ctx.name }}
      orgName={org?.name ?? "Owner portal"}
      homeHref="/owner"
    >
      {children}
    </TopbarShell>
  );
}
