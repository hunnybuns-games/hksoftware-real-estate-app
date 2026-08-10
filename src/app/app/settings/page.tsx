import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/rbac";
import { updateOrgAction } from "@/actions/org";
import { centsToInputValue } from "@/lib/money";
import { Banner, Card } from "@/components/ui";
import { OrgSettingsForm } from "./_components/org-settings-form";

export const metadata: Metadata = { title: "Organization settings" };

export default async function OrgSettingsPage() {
  const ctx = await requireStaff();

  const org = await db.organization.findUnique({
    where: { id: ctx.organizationId },
    select: { name: true, graceDays: true, lateFeeCents: true, createdAt: true },
  });
  // requireStaff() already sends a session with no live organization to
  // onboarding, so reaching here without one means the row vanished between
  // that check and this query. Vanishingly unlikely — but `return null` renders
  // a silently empty page, which is the worst possible way to report it.
  if (!org) notFound();

  return (
    <div className="max-w-xl space-y-6">
      {ctx.role !== "ADMIN" ? (
        <Banner tone="info">
          Only admins can change these. You can see them here for reference.
        </Banner>
      ) : null}

      <Card title="Organization" description="Residents see this name on emails from you.">
        <OrgSettingsForm
          action={updateOrgAction}
          readOnly={ctx.role !== "ADMIN"}
          defaults={{
            name: org.name,
            graceDays: String(org.graceDays),
            lateFee: centsToInputValue(org.lateFeeCents),
          }}
        />
      </Card>
    </div>
  );
}
