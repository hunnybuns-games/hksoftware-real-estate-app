import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/rbac";

// Runs above the loading.tsx Suspense boundaries below it (this segment's
// own page, plus edit/ and units/[unitId]/), so this notFound() still
// commits a real 404 instead of the 200 a check inside a Suspense boundary
// would produce. Kept to an id-only lookup — each page's own query does the
// real fetch behind its skeleton.
export default async function PropertyLayout({
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
