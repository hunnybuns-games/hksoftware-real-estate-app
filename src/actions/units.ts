"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, isUniqueViolation } from "@/lib/db";
import { assertStaff } from "@/lib/rbac";
import {
  type ActionState,
  actionError,
  actionOk,
  centsField,
  intField,
  parseForm,
  runAction,
} from "@/lib/forms";

const unitSchema = z.object({
  label: z.string().trim().min(1, "Give the unit a name, e.g. “2B” or “House”.").max(40),
  bedrooms: intField("Bedrooms", 0, 20),
  bathrooms: z.coerce
    .number({ message: "Bathrooms must be a number." })
    .min(0, "Bathrooms can't be negative.")
    .max(20, "That's a lot of bathrooms.")
    // Half-baths are real; quarter-baths are not.
    .refine((v) => Number.isInteger(v * 2), "Use whole or half bathrooms, e.g. 1 or 1.5."),
  sqft: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? Number(v) : null))
    .refine(
      (v) => v === null || (Number.isInteger(v) && v > 0 && v < 100_000),
      "Square footage must be a whole number.",
    ),
  marketRentCents: centsField("Market rent"),
  status: z.enum(["VACANT", "OCCUPIED", "MAINTENANCE"]),
});

export async function createUnitAction(
  propertyId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { organizationId } = await assertStaff();
    const parsed = parseForm(unitSchema, formData);
    if (!parsed.ok) return parsed.state;

    const property = await db.property.findFirst({
      where: { id: propertyId, organizationId },
      select: { id: true },
    });
    if (!property) return actionError("That property no longer exists.");

    try {
      await db.unit.create({ data: { ...parsed.data, propertyId: property.id } });
    } catch (err) {
      if (isUniqueViolation(err)) {
        return actionError("Please fix the highlighted fields.", {
          label: "This property already has a unit with that name.",
        });
      }
      throw err;
    }

    revalidatePath(`/app/properties/${propertyId}`);
    revalidatePath("/app/properties");
    revalidatePath("/app");
    return actionOk("Unit added.");
  });
}

export async function updateUnitAction(
  unitId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { organizationId } = await assertStaff();
    const parsed = parseForm(unitSchema, formData);
    if (!parsed.ok) return parsed.state;

    const unit = await db.unit.findFirst({
      where: { id: unitId, property: { organizationId } },
      select: { id: true, propertyId: true },
    });
    if (!unit) return actionError("That unit no longer exists.");

    // Don't let a unit with a live lease be marked vacant — that's how
    // occupancy numbers start lying.
    if (parsed.data.status === "VACANT") {
      const activeLeases = await db.lease.count({
        where: { unitId: unit.id, status: "ACTIVE" },
      });
      if (activeLeases > 0) {
        return actionError("Please fix the highlighted fields.", {
          status: "This unit has an active lease, so it can't be marked vacant. End the lease first.",
        });
      }
    }

    try {
      await db.unit.update({ where: { id: unit.id }, data: parsed.data });
    } catch (err) {
      if (isUniqueViolation(err)) {
        return actionError("Please fix the highlighted fields.", {
          label: "This property already has a unit with that name.",
        });
      }
      throw err;
    }

    revalidatePath(`/app/properties/${unit.propertyId}`);
    revalidatePath("/app/properties");
    return actionOk("Unit saved.");
  });
}

export async function deleteUnitAction(unitId: string, _prev: ActionState): Promise<ActionState> {
  return runAction(async () => {
    const { organizationId } = await assertStaff();

    const unit = await db.unit.findFirst({
      where: { id: unitId, property: { organizationId } },
      select: {
        id: true,
        propertyId: true,
        _count: { select: { leases: true } },
      },
    });
    if (!unit) return actionError("That unit no longer exists.");

    // Deleting a unit cascades to its leases, and those carry payment history.
    // Refuse rather than quietly destroying a financial record.
    if (unit._count.leases > 0) {
      return actionError(
        "This unit has lease history, which includes payment records. Units with leases can't be deleted.",
      );
    }

    await db.unit.delete({ where: { id: unit.id } });
    revalidatePath(`/app/properties/${unit.propertyId}`);
    revalidatePath("/app/properties");
    return actionOk("Unit deleted.");
  });
}
