import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/rbac";

// See ../../properties/[propertyId]/layout.tsx for why this lives here
// rather than in page.tsx.
export default async function TenantLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ tenantId: string }>;
}) {
  const ctx = await requireStaff();
  const { tenantId } = await params;

  const tenant = await db.tenant.findFirst({
    where: { id: tenantId, organizationId: ctx.organizationId },
    select: { id: true },
  });
  if (!tenant) notFound();

  return children;
}
