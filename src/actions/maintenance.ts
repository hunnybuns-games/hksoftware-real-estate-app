"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertStaff, assertTenant, AuthorizationError } from "@/lib/rbac";
import {
  type ActionState,
  actionError,
  actionOk,
  parseForm,
  runAction,
} from "@/lib/forms";
import { MAX_PHOTOS_PER_REQUEST } from "@/lib/constants";
import { notifyMaintenanceCreated, notifyMaintenanceUpdated } from "@/lib/notifications";
import { readPhotos } from "@/lib/photos";
import { auth } from "@/lib/auth";

const requestSchema = z.object({
  title: z.string().trim().min(1, "Give the request a short title.").max(140),
  description: z.string().trim().min(1, "Describe the problem.").max(4000),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]),
});

/**
 * Tenant-submitted request. The unit is derived from the tenant's active lease
 * rather than accepted from the form — a tenant must never be able to file
 * against someone else's unit.
 */
export async function createTenantRequestAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let createdId: string | null = null;

  const state = await runAction(async () => {
    const ctx = await assertTenant();
    const parsed = parseForm(requestSchema, formData);
    if (!parsed.ok) return parsed.state;

    const lease = await db.lease.findFirst({
      where: { tenantId: ctx.tenantId, status: "ACTIVE" },
      orderBy: { startDate: "desc" },
      include: {
        unit: { select: { id: true, label: true, property: { select: { name: true } } } },
        organization: { select: { id: true, name: true } },
        tenant: { select: { firstName: true, lastName: true } },
      },
    });
    if (!lease) {
      return actionError(
        "We couldn't find an active lease on your account. Please contact your property manager directly.",
      );
    }

    const photos = await readPhotos(formData, { maxCount: MAX_PHOTOS_PER_REQUEST });
    if (!photos.ok) return photos.state;

    const request = await db.maintenanceRequest.create({
      data: {
        organizationId: lease.organizationId,
        unitId: lease.unit.id,
        leaseId: lease.id,
        createdByUserId: ctx.id,
        title: parsed.data.title,
        description: parsed.data.description,
        priority: parsed.data.priority,
        photos: photos.data.length ? { create: photos.data } : undefined,
      },
      select: { id: true },
    });

    // Notify every admin/staff member in the org. At 20-200 units the team is
    // small enough that fan-out email is the right answer; add per-user
    // preferences when someone complains.
    const recipients = await db.user.findMany({
      where: { organizationId: lease.organizationId, role: { in: ["ADMIN", "STAFF"] } },
      select: { email: true, name: true },
    });
    await Promise.all(
      recipients.map((r) =>
        notifyMaintenanceCreated({
          to: { email: r.email, name: r.name },
          organizationId: lease.organizationId,
          requestId: request.id,
          title: parsed.data.title,
          unitLabel: lease.unit.label,
          propertyName: lease.unit.property.name,
          priority: parsed.data.priority,
          submittedBy: `${lease.tenant.firstName} ${lease.tenant.lastName}`,
        }),
      ),
    );

    createdId = request.id;
    revalidatePath("/portal/maintenance");
    revalidatePath("/app/maintenance");
    revalidatePath("/app");
    return actionOk();
  });

  if (createdId) redirect(`/portal/maintenance?submitted=1`);
  return state;
}

const staffRequestSchema = requestSchema.extend({
  unitId: z.string().min(1, "Pick a unit."),
});

/** Staff logging a request on a tenant's behalf (phone call, walkthrough). */
export async function createStaffRequestAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let createdId: string | null = null;

  const state = await runAction(async () => {
    const ctx = await assertStaff();
    const parsed = parseForm(staffRequestSchema, formData);
    if (!parsed.ok) return parsed.state;

    const unit = await db.unit.findFirst({
      where: { id: parsed.data.unitId, property: { organizationId: ctx.organizationId } },
      select: {
        id: true,
        leases: {
          where: { status: "ACTIVE" },
          orderBy: { startDate: "desc" },
          take: 1,
          select: { id: true },
        },
      },
    });
    if (!unit) return actionError("Please fix the highlighted fields.", { unitId: "Pick a unit." });

    const photos = await readPhotos(formData, { maxCount: MAX_PHOTOS_PER_REQUEST });
    if (!photos.ok) return photos.state;

    const request = await db.maintenanceRequest.create({
      data: {
        organizationId: ctx.organizationId,
        unitId: unit.id,
        leaseId: unit.leases[0]?.id ?? null,
        createdByUserId: ctx.id,
        title: parsed.data.title,
        description: parsed.data.description,
        priority: parsed.data.priority,
        photos: photos.data.length ? { create: photos.data } : undefined,
      },
      select: { id: true },
    });

    createdId = request.id;
    revalidatePath("/app/maintenance");
    revalidatePath("/app");
    return actionOk();
  });

  if (createdId) redirect(`/app/maintenance/${createdId}`);
  return state;
}

const updateSchema = z.object({
  status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED"]),
  note: z
    .string()
    .trim()
    .max(4000)
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
  notifyTenant: z
    .string()
    .optional()
    .transform((v) => v === "on" || v === "true"),
});

export async function updateRequestAction(
  requestId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await assertStaff();
    const parsed = parseForm(updateSchema, formData);
    if (!parsed.ok) return parsed.state;

    const request = await db.maintenanceRequest.findFirst({
      where: { id: requestId, organizationId: ctx.organizationId },
      select: {
        id: true,
        status: true,
        title: true,
        lease: {
          select: {
            tenant: { select: { firstName: true, email: true } },
          },
        },
        organization: { select: { name: true } },
      },
    });
    if (!request) return actionError("That request no longer exists.");

    const statusChanged = request.status !== parsed.data.status;

    // Not wrapped in $transaction — D1 doesn't support interactive
    // transactions and throws outright if asked to. Sequential calls run
    // exactly as they always did on this database (the old wrapper's
    // commit/rollback were no-ops here anyway).
    if (statusChanged) {
      await db.maintenanceRequest.update({
        where: { id: request.id },
        data: {
          status: parsed.data.status,
          resolvedAt: parsed.data.status === "RESOLVED" ? new Date() : null,
        },
      });
    }
    if (parsed.data.note) {
      await db.maintenanceNote.create({
        data: {
          requestId: request.id,
          authorId: ctx.id,
          body: parsed.data.note,
          // A note the tenant is being emailed is by definition not internal.
          internal: !parsed.data.notifyTenant,
        },
      });
    }

    if (parsed.data.notifyTenant && request.lease?.tenant) {
      await notifyMaintenanceUpdated({
        to: {
          email: request.lease.tenant.email,
          name: request.lease.tenant.firstName,
        },
        organizationId: ctx.organizationId,
        orgName: request.organization.name,
        title: request.title,
        status: parsed.data.status,
        note: parsed.data.note ?? null,
      });
    }

    revalidatePath("/app/maintenance");
    revalidatePath(`/app/maintenance/${requestId}`);
    revalidatePath("/portal/maintenance");
    revalidatePath("/app");
    return actionOk(
      parsed.data.notifyTenant ? "Updated, and the resident has been emailed." : "Updated.",
    );
  });
}

const assignVendorSchema = z.object({
  vendorId: z
    .string()
    .optional()
    .transform((v) => (v === "" ? null : (v ?? null))),
});

/**
 * Assigning or clearing a vendor. Deliberately its own action rather than a
 * field folded into updateRequestAction — status changes and vendor
 * assignment happen independently (you might assign a vendor days before
 * anything actually starts), and keeping them separate means picking a
 * vendor never has to also restate the current status.
 */
export async function assignVendorAction(
  requestId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await assertStaff();
    const parsed = parseForm(assignVendorSchema, formData);
    if (!parsed.ok) return parsed.state;

    const request = await db.maintenanceRequest.findFirst({
      where: { id: requestId, organizationId: ctx.organizationId },
      select: { id: true, assignedVendorId: true },
    });
    if (!request) return actionError("That request no longer exists.");

    let vendor: { id: string; name: string } | null = null;
    if (parsed.data.vendorId) {
      vendor = await db.vendor.findFirst({
        where: { id: parsed.data.vendorId, organizationId: ctx.organizationId },
        select: { id: true, name: true },
      });
      if (!vendor) {
        return actionError("Please fix the highlighted fields.", { vendorId: "Pick a vendor." });
      }
    }

    if (vendor?.id === request.assignedVendorId || (!vendor && !request.assignedVendorId)) {
      return actionOk();
    }

    await db.maintenanceRequest.update({
      where: { id: request.id },
      data: { assignedVendorId: vendor?.id ?? null },
    });
    // Leaves the same audit trail a status change does — anyone reading the
    // activity log later can see who was assigned and when without cross-
    // referencing the vendor directory.
    await db.maintenanceNote.create({
      data: {
        requestId: request.id,
        authorId: ctx.id,
        body: vendor ? `Assigned to ${vendor.name}.` : "Vendor unassigned.",
        internal: true,
      },
    });

    revalidatePath(`/app/maintenance/${requestId}`);
    revalidatePath("/app/maintenance");
    return actionOk(vendor ? `Assigned to ${vendor.name}.` : "Unassigned.");
  });
}

/** Tenants can add follow-up detail to their own request. */
export async function addTenantCommentAction(
  requestId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await assertTenant();
    const body = String(formData.get("note") ?? "").trim();
    if (!body) {
      return actionError("Please fix the highlighted fields.", { note: "Write something first." });
    }
    if (body.length > 4000) {
      return actionError("Please fix the highlighted fields.", { note: "That's too long." });
    }

    const request = await db.maintenanceRequest.findFirst({
      where: { id: requestId, lease: { tenantId: ctx.tenantId } },
      select: { id: true },
    });
    if (!request) throw new AuthorizationError("That request isn't on your account.");

    await db.maintenanceNote.create({
      data: { requestId: request.id, authorId: ctx.id, body, internal: false },
    });

    revalidatePath("/portal/maintenance");
    revalidatePath(`/app/maintenance/${requestId}`);
    return actionOk("Added.");
  });
}

/**
 * Authorization for photo downloads, used by the image route. Staff and owners
 * see photos in their org; a tenant sees only photos on their own requests.
 */
export async function canViewPhoto(photoId: string): Promise<boolean> {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) return false;

  const photo = await db.maintenancePhoto.findUnique({
    where: { id: photoId },
    select: {
      request: {
        select: {
          organizationId: true,
          lease: { select: { tenantId: true } },
          unit: { select: { propertyId: true } },
        },
      },
    },
  });
  if (!photo) return false;

  if (user.role === "TENANT") {
    return Boolean(user.tenantId) && photo.request.lease?.tenantId === user.tenantId;
  }

  if (user.organizationId !== photo.request.organizationId) return false;

  if (user.role === "OWNER") {
    const link = await db.propertyOwner.findFirst({
      where: { userId: user.id, propertyId: photo.request.unit.propertyId },
      select: { id: true },
    });
    return Boolean(link);
  }

  return user.role === "ADMIN" || user.role === "STAFF";
}
