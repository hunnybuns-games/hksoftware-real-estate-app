import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireOwner } from "@/lib/rbac";
import { TopbarShell, type NavItem } from "@/components/app-shell";

/**
 * Nothing under here may ever be indexed. Every page below this layout renders
 * somebody's private records — an owner's property statements and income — so a
 * search result pointing at one is a data leak, not a ranking problem.
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
