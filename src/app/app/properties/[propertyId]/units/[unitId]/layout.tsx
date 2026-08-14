import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/rbac";

// See ../../layout.tsx — same reasoning, one level deeper: the parent
// confirms the property, this confirms the unit actually belongs to it.
export default async function UnitLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ propertyId: string; unitId: string }>;
}) {
  const ctx = await requireStaff();
  const { propertyId, unitId } = await params;

  const unit = await db.unit.findFirst({
    where: { id: unitId, propertyId, property: { organizationId: ctx.organizationId } },
    select: { id: true },
  });
  if (!unit) notFound();

  return children;
}
