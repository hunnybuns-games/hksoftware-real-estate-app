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
  nameField,
  optionalText,
  parseForm,
  runAction,
} from "@/lib/forms";
import { US_STATES } from "@/lib/constants";

const propertySchema = z.object({
  name: nameField,
  addressLine1: z.string().trim().min(1, "Street address is required.").max(200),
  addressLine2: optionalText(200),
  city: z.string().trim().min(1, "City is required.").max(100),
  state: z.enum(US_STATES, { message: "Pick a state." }),
  postalCode: z
    .string()
    .trim()
    .regex(/^\d{5}(-\d{4})?$/, "Enter a 5-digit ZIP code."),
  notes: optionalText(2000),
});

export async function createPropertyAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let newId: string | null = null;

  const state = await runAction(async () => {
    const { organizationId } = await assertStaff();
    const parsed = parseForm(propertySchema, formData);
    if (!parsed.ok) return parsed.state;

    const property = await db.property.create({
      data: { ...parsed.data, organizationId },
      select: { id: true },
    });
    newId = property.id;
    revalidatePath("/app/properties");
    revalidatePath("/app");
    return actionOk();
  });

  // redirect() must happen outside runAction's try/catch-shaped helper so the
  // control-flow throw isn't swallowed by an outer handler.
  if (newId) redirect(`/app/properties/${newId}`);
  return state;
}

export async function updatePropertyAction(
  propertyId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { organizationId } = await assertStaff();
    const parsed = parseForm(propertySchema, formData);
    if (!parsed.ok) return parsed.state;

    // updateMany with the org in the filter means a forged propertyId from
    // another org silently matches nothing instead of leaking or mutating.
    const result = await db.property.updateMany({
      where: { id: propertyId, organizationId },
      data: parsed.data,
    });
    if (result.count === 0) return actionError("That property no longer exists.");

    revalidatePath("/app/properties");
    revalidatePath(`/app/properties/${propertyId}`);
    return actionOk("Property saved.");
  });
}

export async function deletePropertyAction(
  propertyId: string,
  _prev: ActionState,
): Promise<ActionState> {
  let deleted = false;

  const state = await runAction(async () => {
    const { organizationId } = await assertStaff();

    const property = await db.property.findFirst({
      where: { id: propertyId, organizationId },
      select: {
        id: true,
        _count: { select: { units: true } },
        units: {
          select: { _count: { select: { leases: { where: { status: "ACTIVE" } } } } },
        },
      },
    });
    if (!property) return actionError("That property no longer exists.");

    const activeLeases = property.units.reduce((sum, u) => sum + u._count.leases, 0);
    if (activeLeases > 0) {
      return actionError(
        `This property has ${activeLeases} active lease${activeLeases === 1 ? "" : "s"}. End those leases before deleting it.`,
      );
    }

    await db.property.delete({ where: { id: property.id } });
    deleted = true;
    revalidatePath("/app/properties");
    revalidatePath("/app");
    return actionOk();
  });

  if (deleted) redirect("/app/properties");
  return state;
}
