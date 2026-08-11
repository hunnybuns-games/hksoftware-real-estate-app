"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertAdmin } from "@/lib/rbac";
import {
  type ActionState,
  actionError,
  actionOk,
  emailField,
  nameField,
  parseForm,
  runAction,
} from "@/lib/forms";
import { notifyStaffInvite } from "@/lib/notifications";
import { addUtcDays } from "@/lib/dates";

const inviteSchema = z.object({
  name: nameField,
  email: emailField,
  // Tenants are invited from their tenant record, not here — they need a Tenant
  // row to attach to.
  role: z.enum(["ADMIN", "STAFF", "OWNER"]),
});

export async function inviteStaffAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await assertAdmin();
    const parsed = parseForm(inviteSchema, formData);
    if (!parsed.ok) return parsed.state;
    const { name, email, role } = parsed.data;

    const existingUser = await db.user.findUnique({ where: { email }, select: { id: true } });
    if (existingUser) {
      return actionError("Please fix the highlighted fields.", {
        email: "Someone with this email already has an account.",
      });
    }

    const org = await db.organization.findUnique({
      where: { id: ctx.organizationId },
      select: { name: true },
    });
    if (!org) return actionError("Your organization no longer exists.");

    const token = randomBytes(32).toString("base64url");

    // Not wrapped in $transaction — D1 doesn't support interactive
    // transactions and throws outright if asked to. Sequential calls run
    // exactly as they always did on this database (the old wrapper's
    // commit/rollback were no-ops here anyway).
    //
    // Supersede any outstanding invite for this address so the newest link is
    // the only one that works.
    await db.invitation.deleteMany({
      where: { organizationId: ctx.organizationId, email, acceptedAt: null },
    });
    await db.invitation.create({
      data: {
        organizationId: ctx.organizationId,
        email,
        name,
        role,
        token,
        expiresAt: addUtcDays(new Date(), 7),
      },
    });

    await notifyStaffInvite({
      to: { email, name },
      organizationId: ctx.organizationId,
      orgName: org.name,
      inviterName: ctx.name,
      role,
      token,
    });

    revalidatePath("/app/settings/team");
    return actionOk(`Invitation sent to ${email}.`);
  });
}

export async function revokeInviteAction(
  inviteId: string,
  _prev: ActionState,
): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await assertAdmin();
    const result = await db.invitation.deleteMany({
      where: { id: inviteId, organizationId: ctx.organizationId, acceptedAt: null },
    });
    if (result.count === 0) return actionError("That invitation is no longer pending.");

    revalidatePath("/app/settings/team");
    return actionOk("Invitation revoked.");
  });
}

const roleSchema = z.object({ role: z.enum(["ADMIN", "STAFF", "OWNER"]) });

export async function updateMemberRoleAction(
  userId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await assertAdmin();
    const parsed = parseForm(roleSchema, formData);
    if (!parsed.ok) return parsed.state;

    if (userId === ctx.id) {
      return actionError("You can't change your own role. Ask another admin to do it.");
    }

    const member = await db.user.findFirst({
      where: { id: userId, organizationId: ctx.organizationId, role: { not: "TENANT" } },
      select: { id: true, role: true },
    });
    if (!member) return actionError("That team member no longer exists.");

    // Never let the last admin be demoted — that would lock the org out of its
    // own settings, billing and team management with no recovery path.
    if (member.role === "ADMIN" && parsed.data.role !== "ADMIN") {
      const admins = await db.user.count({
        where: { organizationId: ctx.organizationId, role: "ADMIN" },
      });
      if (admins <= 1) {
        return actionError("Your organization needs at least one admin.");
      }
    }

    await db.user.update({ where: { id: member.id }, data: { role: parsed.data.role } });
    revalidatePath("/app/settings/team");
    return actionOk("Role updated.");
  });
}

export async function removeMemberAction(userId: string, _prev: ActionState): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await assertAdmin();

    if (userId === ctx.id) {
      return actionError("You can't remove yourself. Ask another admin to do it.");
    }

    const member = await db.user.findFirst({
      where: { id: userId, organizationId: ctx.organizationId, role: { not: "TENANT" } },
      select: { id: true, role: true },
    });
    if (!member) return actionError("That team member no longer exists.");

    if (member.role === "ADMIN") {
      const admins = await db.user.count({
        where: { organizationId: ctx.organizationId, role: "ADMIN" },
      });
      if (admins <= 1) return actionError("Your organization needs at least one admin.");
    }

    await db.user.delete({ where: { id: member.id } });
    revalidatePath("/app/settings/team");
    return actionOk("Team member removed.");
  });
}

const ownerAccessSchema = z.object({
  propertyIds: z.string().optional(),
});

/**
 * Sets which properties an OWNER can see. Sent as a comma-joined hidden field
 * so an empty selection is unambiguous (an unchecked checkbox group sends
 * nothing at all, which is indistinguishable from "field missing").
 */
export async function setOwnerPropertiesAction(
  userId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await assertAdmin();
    const parsed = parseForm(ownerAccessSchema, formData);
    if (!parsed.ok) return parsed.state;

    const member = await db.user.findFirst({
      where: { id: userId, organizationId: ctx.organizationId, role: "OWNER" },
      select: { id: true },
    });
    if (!member) return actionError("That owner no longer exists.");

    const requested = (parsed.data.propertyIds ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    // Only properties in this org, and only ones that actually exist.
    const valid = await db.property.findMany({
      where: { id: { in: requested }, organizationId: ctx.organizationId },
      select: { id: true },
    });

    // Not wrapped in $transaction — D1 doesn't support interactive
    // transactions and throws outright if asked to. Sequential calls run
    // exactly as they always did on this database (the old wrapper's
    // commit/rollback were no-ops here anyway).
    await db.propertyOwner.deleteMany({ where: { userId: member.id } });
    if (valid.length) {
      await db.propertyOwner.createMany({
        data: valid.map((p) => ({ userId: member.id, propertyId: p.id })),
      });
    }

    revalidatePath("/app/settings/team");
    revalidatePath("/owner");
    return actionOk(
      valid.length === 0
        ? "This owner now has access to no properties."
        : `Access updated — ${valid.length} propert${valid.length === 1 ? "y" : "ies"}.`,
    );
  });
}
