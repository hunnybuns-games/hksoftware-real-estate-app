import Link from "@/components/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireStaff, staffOrganizationIdForMetadata } from "@/lib/rbac";
import { updateApplicationStatusAction, convertApplicationToLeaseAction } from "@/actions/applications";
import { formatCents } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/dates";
import { meetsIncomeGuideline, nextStatusOptions } from "@/lib/applications";
import {
  ApplicationStatusBadge,
  Badge,
  Breadcrumbs,
  Card,
  DescriptionList,
  PageHeader,
} from "@/components/ui";
import { ReviewForm } from "./_components/review-form";
import { ConvertToLeaseButton } from "./_components/convert-to-lease-button";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ applicationId: string }>;
}): Promise<Metadata> {
  const { applicationId } = await params;
  const organizationId = await staffOrganizationIdForMetadata();
  if (!organizationId) return { title: "Application" };

  const application = await db.application.findFirst({
    where: { id: applicationId, organizationId },
    select: { firstName: true, lastName: true },
  });
  return { title: application ? `${application.firstName} ${application.lastName}` : "Application" };
}

export default async function ApplicationDetailPage({
  params,
}: {
  params: Promise<{ applicationId: string }>;
}) {
  const ctx = await requireStaff();
  const { applicationId } = await params;

  const application = await db.application.findFirst({
    where: { id: applicationId, organizationId: ctx.organizationId },
    include: {
      unit: {
        select: {
          id: true,
          label: true,
          marketRentCents: true,
          property: { select: { id: true, name: true } },
        },
      },
      reviewedBy: { select: { name: true } },
      lease: { select: { id: true } },
    },
  });
  if (!application) notFound();

  const guideline = meetsIncomeGuideline({
    monthlyIncomeCents: application.monthlyIncomeCents,
    rentAmountCents: application.unit.marketRentCents,
  });

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumbs
          items={[
            { label: "Applications", href: "/app/applications" },
            { label: `${application.firstName} ${application.lastName}` },
          ]}
        />
        <PageHeader
          title={`${application.firstName} ${application.lastName}`}
          subtitle={
            <>
              <Link href={`/app/properties/${application.unit.property.id}`} className="hover:underline">
                {application.unit.property.name}
              </Link>{" "}
              · Unit {application.unit.label} · applied {formatDateTime(application.createdAt)}
            </>
          }
          actions={<ApplicationStatusBadge status={application.status} />}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <Card title="Application details">
            <DescriptionList
              items={[
                {
                  label: "Desired move-in",
                  value: application.desiredMoveInDate ? formatDate(application.desiredMoveInDate) : "—",
                },
                { label: "Occupants", value: application.occupants ?? "—" },
                {
                  label: "Monthly income",
                  value: (
                    <span className="flex items-center gap-2">
                      {application.monthlyIncomeCents != null
                        ? formatCents(application.monthlyIncomeCents)
                        : "Not reported"}
                      {guideline !== null ? (
                        <Badge tone={guideline ? "green" : "amber"}>
                          {guideline ? "Meets 3x rent guideline" : "Below 3x rent guideline"}
                        </Badge>
                      ) : null}
                    </span>
                  ),
                },
                {
                  label: "Pets",
                  value: application.hasPets ? application.petDetails || "Yes" : "None",
                },
              ]}
            />
            {application.message ? (
              <div className="mt-4 border-t border-slate-100 pt-4">
                <p className="mb-1 text-xs font-medium tracking-wide text-slate-500 uppercase">
                  Message
                </p>
                <p className="text-sm whitespace-pre-wrap text-slate-700">{application.message}</p>
              </div>
            ) : null}
          </Card>

          <Card title="Review">
            {application.leaseId ? (
              <p className="text-sm text-slate-500">
                This application became a lease and can no longer be changed. See its lease on the
                right.
              </p>
            ) : (
              <ReviewForm
                action={updateApplicationStatusAction.bind(null, application.id)}
                currentStatus={application.status}
                statusOptions={nextStatusOptions(application.status)}
                defaultNotes={application.reviewNotes ?? ""}
              />
            )}
            {application.reviewedBy ? (
              <p className="mt-4 text-xs text-slate-500">
                Last reviewed by {application.reviewedBy.name}
                {application.reviewedAt ? ` · ${formatDateTime(application.reviewedAt)}` : ""}
              </p>
            ) : null}
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Applicant">
            <DescriptionList
              items={[
                {
                  label: "Email",
                  value: (
                    <a href={`mailto:${application.email}`} className="link">
                      {application.email}
                    </a>
                  ),
                },
                { label: "Phone", value: application.phone || "—" },
              ]}
            />
          </Card>

          <Card title="Unit">
            <DescriptionList
              items={[
                {
                  label: "Property",
                  value: (
                    <Link href={`/app/properties/${application.unit.property.id}`} className="link">
                      {application.unit.property.name}
                    </Link>
                  ),
                },
                { label: "Unit", value: application.unit.label },
                { label: "Market rent", value: formatCents(application.unit.marketRentCents) },
              ]}
            />
          </Card>

          {application.leaseId ? (
            <Link href={`/app/leases/${application.leaseId}`} className="btn-primary w-full justify-center">
              View lease
            </Link>
          ) : application.status === "APPROVED" ? (
            <Card title="Next step">
              <p className="mb-3 text-sm text-slate-500">
                Approved applications can be turned straight into a lease, with the unit and tenant
                already filled in.
              </p>
              <ConvertToLeaseButton action={convertApplicationToLeaseAction.bind(null, application.id)} />
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
