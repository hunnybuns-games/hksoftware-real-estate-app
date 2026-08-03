"use server";

import { randomBytes } from "node:crypto";
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
  optionalText,
  parseForm,
  runAction,
} from "@/lib/forms";
import { notifyTenantInvite } from "@/lib/notifications";
import { addUtcDays } from "@/lib/dates";

const tenantSchema = z.object({
  firstName: nameField,
  lastName: nameField,
  email: emailField,
  phone: optionalText(40),
  notes: optionalText(2000),
});

export async function createTenantAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let newId: string | null = null;

  const state = await runAction(async () => {
    const { organizationId } = await assertStaff();
    const parsed = parseForm(tenantSchema, formData);
    if (!parsed.ok) return parsed.state;

    try {
      const tenant = await db.tenant.create({
        data: { ...parsed.data, organizationId },
        select: { id: true },
      });
      newId = tenant.id;
    } catch (err) {
      if (isUniqueViolation(err)) {
        return actionError("Please fix the highlighted fields.", {
          email: "You already have a tenant with this email address.",
        });
      }
      throw err;
    }

    revalidatePath("/app/tenants");
    return actionOk();
  });

  if (newId) redirect(`/app/tenants/${newId}`);
  return state;
}

export async function updateTenantAction(
  tenantId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { organizationId } = await assertStaff();
    const parsed = parseForm(tenantSchema, formData);
    if (!parsed.ok) return parsed.state;

    const tenant = await db.tenant.findFirst({
      where: { id: tenantId, organizationId },
      select: { id: true, userId: true, email: true },
    });
    if (!tenant) return actionError("That tenant no longer exists.");

    // The login account owns its own email. Changing the tenant record's email
    // out from under an active portal login would lock them out.
    if (tenant.userId && parsed.data.email !== tenant.email) {
      return actionError("Please fix the highlighted fields.", {
        email:
          "This tenant already has a portal login, so their email is managed by their account and can't be changed here.",
      });
    }

    try {
      await db.tenant.update({ where: { id: tenant.id }, data: parsed.data });
    } catch (err) {
      if (isUniqueViolation(err)) {
        return actionError("Please fix the highlighted fields.", {
          email: "You already have a tenant with this email address.",
        });
      }
      throw err;
    }

    revalidatePath("/app/tenants");
    revalidatePath(`/app/tenants/${tenantId}`);
    return actionOk("Tenant saved.");
  });
}

/**
 * Invites a tenant to the resident portal. Re-inviting replaces any outstanding
 * invitation, so a landlord can always just click it again if the tenant lost
 * the email.
 */
export async function inviteTenantAction(
  tenantId: string,
  _prev: ActionState,
): Promise<ActionState> {
  return runAction(async () => {
    const { organizationId } = await assertStaff();

    const tenant = await db.tenant.findFirst({
      where: { id: tenantId, organizationId },
      include: {
        organization: { select: { name: true } },
        leases: {
          orderBy: { startDate: "desc" },
          take: 1,
          select: { unit: { select: { label: true, property: { select: { name: true } } } } },
        },
      },
    });
    if (!tenant) return actionError("That tenant no longer exists.");
    if (tenant.userId) return actionError("This tenant already has a portal login.");

    const conflicting = await db.user.findUnique({
      where: { email: tenant.email },
      select: { id: true },
    });
    if (conflicting) {
      return actionError(
        "Someone already has an account with this email address. Use a different email for this tenant.",
      );
    }

    const token = randomBytes(32).toString("base64url");
    const lease = tenant.leases[0];

    await db.$transaction(async (tx) => {
      await tx.invitation.deleteMany({ where: { tenantId: tenant.id } });
      await tx.invitation.create({
        data: {
          organizationId,
          tenantId: tenant.id,
          email: tenant.email,
          name: `${tenant.firstName} ${tenant.lastName}`,
          role: "TENANT",
          token,
          expiresAt: addUtcDays(new Date(), 7),
        },
      });
    });

    await notifyTenantInvite({
      to: { email: tenant.email, name: tenant.firstName },
      organizationId,
      orgName: tenant.organization.name,
      token,
      propertyName: lease?.unit.property.name ?? tenant.organization.name,
      unitLabel: lease?.unit.label ?? "your unit",
    });

    revalidatePath(`/app/tenants/${tenantId}`);
    return actionOk(`Portal invitation sent to ${tenant.email}.`);
  });
}

export async function deleteTenantAction(
  tenantId: string,
  _prev: ActionState,
): Promise<ActionState> {
  let deleted = false;

  const state = await runAction(async () => {
    const { organizationId } = await assertStaff();

    const tenant = await db.tenant.findFirst({
      where: { id: tenantId, organizationId },
      select: { id: true, _count: { select: { leases: true } } },
    });
    if (!tenant) return actionError("That tenant no longer exists.");

    if (tenant._count.leases > 0) {
      return actionError(
        "This tenant has leases with payment history attached. Tenants with leases can't be deleted.",
      );
    }

    await db.tenant.delete({ where: { id: tenant.id } });
    deleted = true;
    revalidatePath("/app/tenants");
    return actionOk();
  });

  if (deleted) redirect("/app/tenants");
  return state;
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "P2002"
  );
}
