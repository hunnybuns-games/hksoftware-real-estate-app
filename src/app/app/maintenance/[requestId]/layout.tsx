import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/rbac";

// See ../../properties/[propertyId]/layout.tsx for why this lives here
// rather than in page.tsx.
export default async function MaintenanceRequestLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ requestId: string }>;
}) {
  const ctx = await requireStaff();
  const { requestId } = await params;

  const request = await db.maintenanceRequest.findFirst({
    where: { id: requestId, organizationId: ctx.organizationId },
    select: { id: true },
  });
  if (!request) notFound();

  return children;
}
