import Link from "@/components/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireStaff, staffOrganizationIdForMetadata } from "@/lib/rbac";
import { updateRequestAction } from "@/actions/maintenance";
import { formatDateTime } from "@/lib/dates";
import {
  Badge,
  Breadcrumbs,
  Card,
  DescriptionList,
  MaintenanceStatusBadge,
  PageHeader,
  PriorityBadge,
} from "@/components/ui";
import { UpdateRequestForm } from "./_components/update-request-form";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ requestId: string }>;
}): Promise<Metadata> {
  const { requestId } = await params;
  const organizationId = await staffOrganizationIdForMetadata();
  if (!organizationId) return { title: "Maintenance request" };

  // Scoped the same way the page body is — a request title from another org
  // must not leak into this tab's title, even for a caller who's signed in.
  const request = await db.maintenanceRequest.findFirst({
    where: { id: requestId, organizationId },
    select: { title: true },
  });
  return { title: request?.title ?? "Maintenance request" };
}

export default async function RequestDetailPage({
  params,
}: {
  params: Promise<{ requestId: string }>;
}) {
  const ctx = await requireStaff();
  const { requestId } = await params;

  const request = await db.maintenanceRequest.findFirst({
    where: { id: requestId, organizationId: ctx.organizationId },
    include: {
      unit: { select: { id: true, label: true, property: { select: { id: true, name: true } } } },
      lease: {
        select: {
          id: true,
          tenant: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
        },
      },
      createdBy: { select: { name: true, role: true } },
      photos: { select: { id: true, filename: true }, orderBy: { createdAt: "asc" } },
      notes: {
        orderBy: { createdAt: "asc" },
        include: { author: { select: { name: true, role: true } } },
      },
    },
  });
  if (!request) notFound();

  const tenant = request.lease?.tenant;

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumbs
          items={[{ label: "Maintenance", href: "/app/maintenance" }, { label: request.title }]}
        />
        <PageHeader
          title={request.title}
          subtitle={
            <>
              <Link
                href={`/app/properties/${request.unit.property.id}`}
                className="hover:underline"
              >
                {request.unit.property.name}
              </Link>{" "}
              · Unit {request.unit.label} · opened {formatDateTime(request.createdAt)}
            </>
          }
          actions={
            <>
              <PriorityBadge priority={request.priority} />
              <MaintenanceStatusBadge status={request.status} />
            </>
          }
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <Card title="What was reported">
            <p className="text-sm leading-relaxed whitespace-pre-wrap text-slate-700">
              {request.description}
            </p>
            {request.createdBy ? (
              <p className="mt-4 text-xs text-slate-500">
                Submitted by {request.createdBy.name}
                {request.createdBy.role === "TENANT" ? " (resident)" : " (staff)"}
              </p>
            ) : null}
          </Card>

          {request.photos.length > 0 ? (
            <Card title={`Photos (${request.photos.length})`}>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {request.photos.map((photo) => (
                  <a
                    key={photo.id}
                    href={`/api/photos/${photo.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="block overflow-hidden rounded-lg border border-slate-200 hover:border-brand-400"
                  >
                    {/* Plain <img>: these are user uploads served from our own
                        authorized route, so next/image optimisation would just
                        add a proxy hop and a cache we don't want. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/photos/${photo.id}`}
                      alt={photo.filename}
                      className="aspect-square w-full object-cover"
                      loading="lazy"
                    />
                  </a>
                ))}
              </div>
            </Card>
          ) : null}

          <Card title="Activity" padded={false}>
            {request.notes.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-slate-500">
                No notes yet. Add one below — tick the box to email the resident.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {request.notes.map((note) => (
                  <li key={note.id} className="px-5 py-4">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-slate-900">
                        {note.author?.name ?? "Removed user"}
                      </span>
                      {note.author?.role === "TENANT" ? (
                        <Badge tone="blue">Resident</Badge>
                      ) : null}
                      {note.internal ? <Badge tone="slate">Internal</Badge> : null}
                      <span className="text-xs text-slate-400">
                        {formatDateTime(note.createdAt)}
                      </span>
                    </div>
                    <p className="text-sm whitespace-pre-wrap text-slate-700">{note.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Update">
            <UpdateRequestForm
              action={updateRequestAction.bind(null, request.id)}
              currentStatus={request.status}
              canNotify={Boolean(tenant)}
            />
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Resident">
            {tenant ? (
              <DescriptionList
                items={[
                  {
                    label: "Name",
                    value: (
                      <Link href={`/app/tenants/${tenant.id}`} className="link">
                        {tenant.firstName} {tenant.lastName}
                      </Link>
                    ),
                  },
                  {
                    label: "Email",
                    value: (
                      <a href={`mailto:${tenant.email}`} className="link">
                        {tenant.email}
                      </a>
                    ),
                  },
                  { label: "Phone", value: tenant.phone || "—" },
                ]}
              />
            ) : (
              <p className="text-sm text-slate-500">
                This request isn&apos;t tied to a lease — the unit was vacant when it was logged.
              </p>
            )}
          </Card>

          <Card title="Timeline">
            <DescriptionList
              items={[
                { label: "Opened", value: formatDateTime(request.createdAt) },
                { label: "Last updated", value: formatDateTime(request.updatedAt) },
                {
                  label: "Resolved",
                  value: request.resolvedAt ? formatDateTime(request.resolvedAt) : "—",
                },
              ]}
            />
          </Card>
        </div>
      </div>
    </div>
  );
}
