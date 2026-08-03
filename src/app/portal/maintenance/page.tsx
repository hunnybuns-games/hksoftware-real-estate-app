import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireTenant } from "@/lib/rbac";
import { addTenantCommentAction, createTenantRequestAction } from "@/actions/maintenance";
import { formatDate, formatDateTime } from "@/lib/dates";
import {
  Badge,
  Banner,
  Card,
  EmptyState,
  MaintenanceStatusBadge,
  PriorityBadge,
} from "@/components/ui";
import { Disclosure } from "@/components/disclosure";
import { TenantRequestForm } from "../_components/tenant-request-form";
import { TenantCommentForm } from "../_components/tenant-comment-form";

export const metadata: Metadata = { title: "Maintenance" };

export default async function PortalMaintenancePage({
  searchParams,
}: {
  searchParams: Promise<{ submitted?: string }>;
}) {
  const ctx = await requireTenant();
  const [{ submitted }, requests, activeLease] = await Promise.all([
    searchParams,
    db.maintenanceRequest.findMany({
      where: { lease: { tenantId: ctx.tenantId } },
      orderBy: { createdAt: "desc" },
      include: {
        unit: { select: { label: true, property: { select: { name: true } } } },
        photos: { select: { id: true, filename: true } },
        // Internal staff notes stay internal.
        notes: {
          where: { internal: false },
          orderBy: { createdAt: "asc" },
          include: { author: { select: { name: true, role: true } } },
        },
      },
    }),
    db.lease.findFirst({
      where: { tenantId: ctx.tenantId, status: "ACTIVE" },
      select: { id: true },
    }),
  ]);

  return (
    <div className="space-y-5">
      {submitted ? (
        <Banner tone="success" title="Request submitted">
          Your property manager has been notified. You&apos;ll get an email when the status changes.
        </Banner>
      ) : null}

      {activeLease ? (
        <Disclosure label="Submit a request" variant="primary" open={requests.length === 0}>
          <Card>
            <TenantRequestForm action={createTenantRequestAction} />
          </Card>
        </Disclosure>
      ) : (
        <Banner tone="info">
          You don&apos;t have an active lease, so you can&apos;t open a new request here. Please
          contact your property manager directly.
        </Banner>
      )}

      {requests.length === 0 ? (
        <Card>
          <EmptyState
            title="No requests yet"
            description="Something broken? Submit a request above — a photo helps a lot."
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {requests.map((request) => (
            <Card key={request.id} padded={false}>
              <div className="border-b border-slate-100 px-5 py-4">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <MaintenanceStatusBadge status={request.status} />
                  <PriorityBadge priority={request.priority} />
                  <span className="text-xs text-slate-500">
                    Opened {formatDate(request.createdAt)}
                  </span>
                </div>
                <h3 className="text-sm font-semibold text-slate-900">{request.title}</h3>
                <p className="mt-1 text-sm whitespace-pre-wrap text-slate-600">
                  {request.description}
                </p>

                {request.photos.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {request.photos.map((photo) => (
                      <a
                        key={photo.id}
                        href={`/api/photos/${photo.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="overflow-hidden rounded-lg border border-slate-200"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={`/api/photos/${photo.id}`}
                          alt={photo.filename}
                          className="size-20 object-cover"
                          loading="lazy"
                        />
                      </a>
                    ))}
                  </div>
                ) : null}
              </div>

              {request.notes.length > 0 ? (
                <ul className="divide-y divide-slate-100">
                  {request.notes.map((note) => (
                    <li key={note.id} className="px-5 py-3">
                      <div className="mb-0.5 flex flex-wrap items-center gap-2">
                        <span className="text-xs font-medium text-slate-700">
                          {note.author?.role === "TENANT" ? "You" : note.author?.name ?? "Your manager"}
                        </span>
                        {note.author?.role !== "TENANT" ? <Badge tone="blue">Manager</Badge> : null}
                        <span className="text-xs text-slate-400">
                          {formatDateTime(note.createdAt)}
                        </span>
                      </div>
                      <p className="text-sm whitespace-pre-wrap text-slate-700">{note.body}</p>
                    </li>
                  ))}
                </ul>
              ) : null}

              {request.status !== "RESOLVED" ? (
                <div className="border-t border-slate-100 bg-slate-50/60 px-5 py-4">
                  <TenantCommentForm action={addTenantCommentAction.bind(null, request.id)} />
                </div>
              ) : null}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
