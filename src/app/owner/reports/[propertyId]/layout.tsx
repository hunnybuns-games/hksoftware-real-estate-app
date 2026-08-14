import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/rbac";

// See ../../../app/properties/[propertyId]/layout.tsx for why this lives
// here rather than in page.tsx. requireOwner() already loaded the owner's
// property list, so this check is free — no extra query.
export default async function OwnerPropertyReportLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ propertyId: string }>;
}) {
  const ctx = await requireOwner();
  const { propertyId } = await params;
  if (!ctx.propertyIds.includes(propertyId)) notFound();

  return children;
}
