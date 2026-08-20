"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertStaff } from "@/lib/rbac";
import { type ActionState, actionError, actionOk, nameField, optionalText, parseForm, runAction } from "@/lib/forms";

// Not emailField — a vendor's email is optional (plenty of landlords only
// have a phone number on file for their plumber), and it's never used to
// send anything through this app, just displayed.
const optionalEmail = optionalText(200).refine(
  (v) => v === undefined || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
  { message: "That doesn't look like an email address." },
);

const vendorSchema = z.object({
  name: nameField,
  trade: optionalText(80),
  contactName: optionalText(120),
  email: optionalEmail,
  phone: optionalText(40),
  notes: optionalText(2000),
});

export async function createVendorAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let createdId: string | null = null;

  const state = await runAction(async () => {
    const ctx = await assertStaff();
    const parsed = parseForm(vendorSchema, formData);
    if (!parsed.ok) return parsed.state;

    const vendor = await db.vendor.create({
      data: { organizationId: ctx.organizationId, ...parsed.data },
      select: { id: true },
    });

    createdId = vendor.id;
    revalidatePath("/app/maintenance/vendors");
    return actionOk();
  });

  if (createdId) redirect("/app/maintenance/vendors");
  return state;
}

export async function updateVendorAction(
  vendorId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await assertStaff();
    const parsed = parseForm(vendorSchema, formData);
    if (!parsed.ok) return parsed.state;

    const vendor = await db.vendor.findFirst({
      where: { id: vendorId, organizationId: ctx.organizationId },
      select: { id: true },
    });
    if (!vendor) return actionError("That vendor no longer exists.");

    await db.vendor.update({ where: { id: vendor.id }, data: parsed.data });

    revalidatePath("/app/maintenance/vendors");
    revalidatePath(`/app/maintenance/vendors/${vendorId}/edit`);
    return actionOk("Saved.");
  });
}

/**
 * Archiving is a soft delete — the vendor drops out of the "assign a vendor"
 * picker for new work, but every past request that named them keeps that
 * record (MaintenanceRequest.assignedVendor is onDelete: SetNull, not
 * cascade, and this never deletes the row at all). Reactivating just flips
 * it back.
 */
export async function setVendorActiveAction(
  vendorId: string,
  active: boolean,
  _prev: ActionState,
): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await assertStaff();

    const vendor = await db.vendor.findFirst({
      where: { id: vendorId, organizationId: ctx.organizationId },
      select: { id: true },
    });
    if (!vendor) return actionError("That vendor no longer exists.");

    await db.vendor.update({ where: { id: vendor.id }, data: { active } });

    revalidatePath("/app/maintenance/vendors");
    return actionOk(active ? "Vendor reactivated." : "Vendor archived.");
  });
}
