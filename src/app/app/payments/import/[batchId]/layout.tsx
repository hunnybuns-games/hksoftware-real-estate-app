import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/rbac";

// See ../../../properties/[propertyId]/layout.tsx for why this lives here
// rather than in page.tsx.
export default async function ImportBatchLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ batchId: string }>;
}) {
  const ctx = await requireStaff();
  const { batchId } = await params;

  const batch = await db.paymentImportBatch.findFirst({
    where: { id: batchId, organizationId: ctx.organizationId },
    select: { id: true },
  });
  if (!batch) notFound();

  return children;
}
