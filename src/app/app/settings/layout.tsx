import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/rbac";
import { PageHeader } from "@/components/ui";
import { NavLink } from "@/components/nav-link";

const tabs: { href: string; label: string; exact?: boolean }[] = [
  { href: "/app/settings", label: "Organization", exact: true },
  { href: "/app/settings/team", label: "Team" },
  { href: "/app/settings/payments", label: "Rent collection" },
  { href: "/app/settings/lease-template", label: "Lease template" },
  { href: "/app/settings/listing-syndication", label: "Listing syndication" },
  { href: "/app/settings/outbox", label: "Email log" },
];

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireStaff();

  // Runs above the org-settings page's loading.tsx Suspense boundary — see
  // ../properties/[propertyId]/layout.tsx for why that placement matters.
  // requireStaff() already sends a session with no live organization to
  // onboarding, so reaching here without one means the row vanished between
  // that check and this one — vanishingly unlikely, but worth a real 404
  // rather than every settings tab rendering silently empty.
  const org = await db.organization.findUnique({
    where: { id: ctx.organizationId },
    select: { id: true },
  });
  if (!org) notFound();

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
