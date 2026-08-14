import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/rbac";

// See ../../properties/[propertyId]/layout.tsx for why this lives here
// rather than in page.tsx. getPropertyPL's null case is this same
// existence check, not the date range, so it's safe to hoist.
export default async function PropertyReportLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ propertyId: string }>;
}) {
  const ctx = await requireStaff();
  const { propertyId } = await params;

  const property = await db.property.findFirst({
    where: { id: propertyId, organizationId: ctx.organizationId },
    select: { id: true },
  });
  if (!property) notFound();

  return children;
}
