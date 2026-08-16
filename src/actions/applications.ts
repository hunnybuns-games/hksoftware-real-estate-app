"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertStaff } from "@/lib/rbac";
import {
  type ActionState,
  actionError,
  actionOk,
  emailField,
  nameField,
  optionalCentsField,
  optionalDateField,
  optionalIntField,
  optionalText,
  parseForm,
  runAction,
} from "@/lib/forms";
import { notifyApplicationDecided, notifyApplicationReceived } from "@/lib/notifications";
import { applicationAttemptAllowed } from "@/lib/rate-limit";
import { applicationStatusLabel, canTransitionApplication } from "@/lib/applications";

const applicationSchema = z.object({
  firstName: nameField,
  lastName: nameField,
  email: emailField,
  phone: optionalText(40),
  desiredMoveInDate: optionalDateField,
  occupants: optionalIntField("Number of occupants", 1, 20),
  monthlyIncomeCents: optionalCentsField("Monthly income"),
  hasPets: z
    .string()
    .optional()
    .transform((v) => v === "on" || v === "true"),
  petDetails: optionalText(500),
  message: optionalText(2000),
});

/**
 * Public, unauthenticated — reached from /apply/[unitId], a link staff shares
 * directly (the unit's own cuid is the unlisted-but-shareable token; see the
 * schema comment on Application). Nothing here trusts the caller with anything
 * beyond "create one Application row against this specific unit", and the
 * whole thing is rate-limited by IP the same way signup is.
 */
export async function submitApplicationAction(
  unitId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let submitted = false;

  const state = await runAction(async () => {
    if (!(await applicationAttemptAllowed())) {
      return actionError("Too many attempts. Please wait a minute and try again.");
    }

    const parsed = parseForm(applicationSchema, formData);
    if (!parsed.ok) return parsed.state;
    const data = parsed.data;

    const unit = await db.unit.findUnique({
      where: { id: unitId },
      select: {
        id: true,
        label: true,
        property: { select: { name: true, organizationId: true } },
      },
    });
    if (!unit) return actionError("This application link is no longer valid.");

    const application = await db.application.create({
      data: {
        organizationId: unit.property.organizationId,
        unitId: unit.id,
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        phone: data.phone ?? null,
        desiredMoveInDate: data.desiredMoveInDate,
        occupants: data.occupants,
        monthlyIncomeCents: data.monthlyIncomeCents,
        hasPets: data.hasPets,
        petDetails: data.hasPets ? (data.petDetails ?? null) : null,
        message: data.message ?? null,
      },
      select: { id: true },
    });

    // Same fan-out as a new maintenance request: at this portfolio size every
    // admin/staff member wants to know, not just whoever happens to be
    // looking at the Applications tab.
    const recipients = await db.user.findMany({
      where: { organizationId: unit.property.organizationId, role: { in: ["ADMIN", "STAFF"] } },
      select: { email: true, name: true },
    });
    await Promise.all(
      recipients.map((r) =>
        notifyApplicationReceived({
          to: { email: r.email, name: r.name },
          organizationId: unit.property.organizationId,
          applicationId: application.id,
          applicantName: `${data.firstName} ${data.lastName}`,
          unitLabel: unit.label,
          propertyName: unit.property.name,
        }),
      ),
    );

    submitted = true;
    revalidatePath("/app/applications");
    revalidatePath("/app");
    return actionOk();
  });

  if (submitted) redirect(`/apply/${unitId}?submitted=1`);
  return state;
}

const reviewSchema = z.object({
  status: z.enum(["SUBMITTED", "UNDER_REVIEW", "APPROVED", "DENIED", "WITHDRAWN"]),
  reviewNotes: optionalText(4000),
});

/** Staff review: change status and/or leave internal notes. */
export async function updateApplicationStatusAction(
  applicationId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await assertStaff();
    const parsed = parseForm(reviewSchema, formData);
    if (!parsed.ok) return parsed.state;

    const application = await db.application.findFirst({
      where: { id: applicationId, organizationId: ctx.organizationId },
      select: {
        id: true,
        status: true,
        firstName: true,
        email: true,
        leaseId: true,
        organization: { select: { name: true } },
        unit: { select: { label: true, property: { select: { name: true } } } },
      },
    });
    if (!application) return actionError("That application no longer exists.");

    if (application.leaseId) {
      return actionError("This application already became a lease and can't be changed.");
    }
    if (!canTransitionApplication(application.status, parsed.data.status)) {
      return actionError(
        `An application can't move from ${applicationStatusLabel(application.status)} to ${applicationStatusLabel(parsed.data.status)}.`,
      );
    }

    const statusChanged = application.status !== parsed.data.status;

    await db.application.update({
      where: { id: application.id },
      data: {
        status: parsed.data.status,
        reviewNotes: parsed.data.reviewNotes ?? null,
        reviewedById: ctx.id,
        reviewedAt: new Date(),
      },
    });

    // Only the two decisions an applicant is actually waiting on get an
    // email — moving to UNDER_REVIEW or WITHDRAWN says nothing they need to
    // hear right now.
    if (statusChanged && (parsed.data.status === "APPROVED" || parsed.data.status === "DENIED")) {
      await notifyApplicationDecided({
        to: { email: application.email, name: application.firstName },
        organizationId: ctx.organizationId,
        orgName: application.organization.name,
        approved: parsed.data.status === "APPROVED",
        propertyName: application.unit.property.name,
        unitLabel: application.unit.label,
      });
    }

    revalidatePath("/app/applications");
    revalidatePath(`/app/applications/${applicationId}`);
    revalidatePath("/app");
    return actionOk(statusChanged ? "Application updated." : "Notes saved.");
  });
}

/**
 * Turns an approved application into the start of a new lease. Doesn't create
 * the lease itself — rent, dates and deposit need a human's judgment — it
 * finds or creates the Tenant record and hands off to the same "New lease"
 * form the "Lease it" link on a vacant unit uses, pre-filled. See
 * createLeaseAction in src/actions/leases.ts for where Application.leaseId
 * actually gets set, once that form is submitted.
 */
export async function convertApplicationToLeaseAction(
  applicationId: string,
  _prev: ActionState,
): Promise<ActionState> {
  let redirectTo: string | null = null;

  const state = await runAction(async () => {
    const { organizationId } = await assertStaff();

    const application = await db.application.findFirst({
      where: { id: applicationId, organizationId },
      select: {
        id: true,
        status: true,
        leaseId: true,
        unitId: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
      },
    });
    if (!application) return actionError("That application no longer exists.");
    if (application.leaseId) return actionError("This application already has a lease.");
    if (application.status !== "APPROVED") {
      return actionError("Approve the application before converting it to a lease.");
    }

    // Reuse an existing tenant with this email if there is one — a returning
    // applicant, or staff who already added them by hand — rather than create
    // a duplicate that would collide with the org's unique-email constraint.
    let tenant = await db.tenant.findFirst({
      where: { organizationId, email: application.email },
      select: { id: true },
    });
    if (!tenant) {
      tenant = await db.tenant.create({
        data: {
          organizationId,
          firstName: application.firstName,
          lastName: application.lastName,
          email: application.email,
          phone: application.phone,
        },
        select: { id: true },
      });
    }

    redirectTo = `/app/leases/new?unitId=${application.unitId}&tenantId=${tenant.id}&applicationId=${application.id}`;
    return actionOk();
  });

  if (redirectTo) redirect(redirectTo);
  return state;
}
