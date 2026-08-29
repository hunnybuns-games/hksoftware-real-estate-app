import Link from "@/components/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireStaff, staffOrganizationIdForMetadata } from "@/lib/rbac";
import {
  deleteTenantAction,
  inviteTenantAction,
  updateTenantAction,
} from "@/actions/tenants";
import { formatCents } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/dates";
import { Breadcrumbs, Card, LeaseStatusBadge, PageHeader } from "@/components/ui";
import { DangerAction } from "@/components/danger-action";
import { DocumentsCard } from "@/components/documents-card";
import { TenantForm } from "../_components/tenant-form";
import { InvitePortalButton } from "./_components/invite-portal-button";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}): Promise<Metadata> {
  const { tenantId } = await params;
  const organizationId = await staffOrganizationIdForMetadata();
  if (!organizationId) return { title: "Tenant" };

  // Scoped the same way the page body is — a tenant's name from another org
  // must not leak into this tab's title, even for a caller who's signed in.
  const tenant = await db.tenant.findFirst({
    where: { id: tenantId, organizationId },
    select: { firstName: true, lastName: true },
  });
  return { title: tenant ? `${tenant.firstName} ${tenant.lastName}` : "Tenant" };
}

export default async function TenantDetailPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const ctx = await requireStaff();
  const { tenantId } = await params;

  const tenant = await db.tenant.findFirst({
    where: { id: tenantId, organizationId: ctx.organizationId },
    include: {
      user: { select: { lastLoginAt: true, createdAt: true } },
      invitation: { select: { acceptedAt: true, expiresAt: true, createdAt: true } },
      leases: {
        orderBy: { startDate: "desc" },
        include: {
          unit: { select: { label: true, property: { select: { id: true, name: true } } } },
        },
      },
    },
  });
  if (!tenant) notFound();

  const activeLease = tenant.leases.find((l) => l.status === "ACTIVE");
  const pendingInvite =
    !tenant.userId &&
    tenant.invitation &&
    !tenant.invitation.acceptedAt &&
    tenant.invitation.expiresAt > new Date();

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumbs
          items={[
            { label: "Tenants", href: "/app/tenants" },
            { label: `${tenant.firstName} ${tenant.lastName}` },
          ]}
        />
        <PageHeader
          title={`${tenant.firstName} ${tenant.lastName}`}
          subtitle={tenant.email}
          actions={
            activeLease ? (
              <Link href={`/app/leases/${activeLease.id}`} className="btn-secondary">
                Open lease
              </Link>
            ) : (
              <Link href={`/app/leases/new?tenantId=${tenant.id}`} className="btn-primary">
                Create a lease
              </Link>
            )
          }
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <Card title="Details">
            <TenantForm
              action={updateTenantAction.bind(null, tenant.id)}
              defaults={{
                firstName: tenant.firstName,
                lastName: tenant.lastName,
                email: tenant.email,
                phone: tenant.phone ?? "",
                notes: tenant.notes ?? "",
              }}
              submitLabel="Save changes"
              cancelHref="/app/tenants"
              emailLocked={Boolean(tenant.userId)}
            />
          </Card>

          <Card title="Leases" padded={false}>
            {tenant.leases.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-slate-500">
                No leases yet.{" "}
                <Link href={`/app/leases/new?tenantId=${tenant.id}`} className="link">
                  Create one
                </Link>
                .
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {tenant.leases.map((lease) => (
                  <li key={lease.id} className="flex items-center justify-between gap-4 px-5 py-3.5">
                    <div className="min-w-0">
                      <Link
                        href={`/app/leases/${lease.id}`}
                        className="truncate text-sm font-medium text-slate-900 hover:underline"
                      >
                        {lease.unit.property.name} — {lease.unit.label}
                      </Link>
                      <p className="text-xs text-slate-500">
                        {formatDate(lease.startDate)} –{" "}
                        {lease.endDate ? formatDate(lease.endDate) : "open-ended"} ·{" "}
                        {formatCents(lease.rentAmountCents)}/mo
                      </p>
                    </div>
                    <LeaseStatusBadge status={lease.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Resident portal">
            {tenant.userId ? (
              <div className="space-y-2 text-sm">
                <p className="font-medium text-emerald-700 dark:text-emerald-300">Portal is active</p>
                <p className="text-slate-500">
                  Last signed in {tenant.user?.lastLoginAt ? formatDateTime(tenant.user.lastLoginAt) : "never"}.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-slate-600">
                  {pendingInvite
                    ? `Invitation sent ${formatDate(tenant.invitation?.createdAt)}. It expires ${formatDate(tenant.invitation?.expiresAt)}.`
                    : "Invite this resident so they can pay rent and file maintenance requests themselves."}
                </p>
                <InvitePortalButton
                  action={inviteTenantAction.bind(null, tenant.id)}
                  label={pendingInvite ? "Resend invitation" : "Send portal invitation"}
                />
              </div>
            )}
          </Card>

          {tenant.notes ? (
            <Card title="Notes">
              <p className="text-sm whitespace-pre-wrap text-slate-700">{tenant.notes}</p>
            </Card>
          ) : null}

          <DocumentsCard
            organizationId={ctx.organizationId}
            scope={{
              kind: "tenant",
              id: tenant.id,
              label: `${tenant.firstName} ${tenant.lastName}`,
            }}
          />

          <Card title="Remove tenant">
            <DangerAction
              action={deleteTenantAction.bind(null, tenant.id)}
              label="Delete tenant"
              confirmLabel="Yes, delete"
              description={
                tenant.leases.length > 0
                  ? "This tenant has leases with payment history, so they can't be deleted."
                  : "This tenant has no leases, so nothing else will be affected."
              }
            />
          </Card>
        </div>
      </div>
    </div>
  );
}
