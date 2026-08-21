import Link from "@/components/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireStaff, staffOrganizationIdForMetadata } from "@/lib/rbac";
import { updateApplicationStatusAction, convertApplicationToLeaseAction } from "@/actions/applications";
import {
  cancelScreeningRequestAction,
  recordScreeningResultsAction,
  requestScreeningAction,
} from "@/actions/screening";
import { formatCents } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/dates";
import { meetsIncomeGuideline, nextStatusOptions } from "@/lib/applications";
import { canRecordResults, canStartNewScreening, screeningTypesLabel } from "@/lib/screening";
import {
  ApplicationStatusBadge,
  Badge,
  Breadcrumbs,
  Card,
  DescriptionList,
  PageHeader,
  ScreeningStatusBadge,
} from "@/components/ui";
import { ReviewForm } from "./_components/review-form";
import { ConvertToLeaseButton } from "./_components/convert-to-lease-button";
import { ScreeningRequestForm } from "./_components/screening-request-form";
import { CancelScreeningButton } from "./_components/cancel-screening-button";
import { ScreeningResultsForm } from "./_components/screening-results-form";

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

  const screening = await db.screeningRequest.findFirst({
    where: { applicationId: application.id },
    orderBy: { requestedAt: "desc" },
    select: {
      id: true,
      status: true,
      wantCredit: true,
      wantBackground: true,
      wantEviction: true,
      requestedAt: true,
      requestedBy: { select: { name: true } },
      consentGivenAt: true,
      consentDeclinedAt: true,
      resultSummary: true,
      reportUrl: true,
      completedAt: true,
      completedBy: { select: { name: true } },
    },
  });

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

          <Card
            title="Screening"
            actions={screening ? <ScreeningStatusBadge status={screening.status} /> : undefined}
          >
            {application.leaseId ? (
              <p className="text-sm text-slate-500">
                This application already became a lease.
              </p>
            ) : screening?.status === "AWAITING_CONSENT" ? (
              <div className="space-y-4">
                <DescriptionList
                  items={[
                    {
                      label: "Requested",
                      value: `${screeningTypesLabel(screening)} · ${formatDateTime(screening.requestedAt)}${screening.requestedBy ? ` by ${screening.requestedBy.name}` : ""}`,
                    },
                  ]}
                />
                <p className="text-sm text-slate-500">
                  Waiting on the applicant to respond to the consent request emailed to them.
                </p>
                <CancelScreeningButton action={cancelScreeningRequestAction.bind(null, screening.id)} />
              </div>
            ) : screening && canRecordResults(screening.status) ? (
              <div className="space-y-4">
                <DescriptionList
                  items={[
                    {
                      label: "Consented",
                      value: screening.consentGivenAt ? formatDateTime(screening.consentGivenAt) : "—",
                    },
                    { label: "Report types", value: screeningTypesLabel(screening) },
                  ]}
                />
                <ScreeningResultsForm action={recordScreeningResultsAction.bind(null, screening.id)} />
              </div>
            ) : (
              <div className="space-y-4">
                {screening ? (
                  <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-sm text-slate-600">
                    {screening.status === "DECLINED" ? (
                      <p>
                        Declined by the applicant
                        {screening.consentDeclinedAt ? ` · ${formatDateTime(screening.consentDeclinedAt)}` : ""}
                        .
                      </p>
                    ) : screening.status === "CANCELED" ? (
                      <p>Canceled before the applicant responded.</p>
                    ) : (
                      <>
                        <p className="font-medium text-slate-900">
                          Completed {screening.completedAt ? formatDateTime(screening.completedAt) : ""}
                          {screening.completedBy ? ` by ${screening.completedBy.name}` : ""}
                        </p>
                        {screening.resultSummary ? (
                          <p className="mt-1 whitespace-pre-wrap">{screening.resultSummary}</p>
                        ) : null}
                        {screening.reportUrl ? (
                          <a href={screening.reportUrl} className="link mt-1 inline-block" target="_blank" rel="noreferrer">
                            View full report
                          </a>
                        ) : null}
                      </>
                    )}
                  </div>
                ) : null}
                {canStartNewScreening(screening?.status ?? null) ? (
                  <ScreeningRequestForm action={requestScreeningAction.bind(null, application.id)} />
                ) : null}
              </div>
            )}
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
