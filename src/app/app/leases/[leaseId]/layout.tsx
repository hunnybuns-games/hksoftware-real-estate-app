import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/rbac";

// Runs above page.tsx's loading.tsx Suspense boundary, so this notFound()
// still commits a real 404 status instead of the 200 a check inside the
// Suspense boundary would produce. Kept to an id-only lookup — the page's
// own (heavier) query does the real fetch behind the skeleton.
export default async function LeaseLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ leaseId: string }>;
}) {
  const ctx = await requireStaff();
  const { leaseId } = await params;

  const lease = await db.lease.findFirst({
    where: { id: leaseId, organizationId: ctx.organizationId },
    select: { id: true },
  });
  if (!lease) notFound();

  return children;
}
