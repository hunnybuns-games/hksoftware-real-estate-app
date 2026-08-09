import { requireStaff } from "@/lib/rbac";
import { PageHeader } from "@/components/ui";
import { NavLink } from "@/components/nav-link";

const tabs: { href: string; label: string; exact?: boolean }[] = [
  { href: "/app/settings", label: "Organization", exact: true },
  { href: "/app/settings/team", label: "Team" },
  { href: "/app/settings/payments", label: "Rent collection" },
  { href: "/app/settings/outbox", label: "Email log" },
];

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  await requireStaff();

  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid gap-6 lg:grid-cols-[13rem_1fr]">
        <nav className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
          {tabs.map((tab) => (
            <NavLink key={tab.href} href={tab.href} exact={tab.exact}>
              {tab.label}
            </NavLink>
          ))}
        </nav>
        <div className="min-w-0">{children}</div>
      </div>
    </>
  );
}
