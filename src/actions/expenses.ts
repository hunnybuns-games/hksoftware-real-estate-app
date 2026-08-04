"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertStaff } from "@/lib/rbac";
import {
  type ActionState,
  actionError,
  actionOk,
  centsField,
  dateField,
  parseForm,
  runAction,
} from "@/lib/forms";

const CATEGORIES = [
  "REPAIRS_MAINTENANCE",
  "UTILITIES",
  "INSURANCE",
  "TAXES",
  "MANAGEMENT_FEES",
  "MORTGAGE",
  "OTHER",
] as const;

const expenseSchema = z.object({
  category: z.enum(CATEGORIES),
  amountCents: centsField("Amount"),
  date: dateField("Date"),
  description: z.string().trim().min(1, "Say what this was for.").max(200),
});

/**
 * Expenses are deliberately minimal — no vendor/bill workflow, just what was
 * spent, when, and why. That's enough to turn the property P&L from an
 * income report wearing a fancier name into something that actually nets
 * out to a bottom line.
 */
export async function createExpenseAction(
  propertyId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { organizationId } = await assertStaff();
    const parsed = parseForm(expenseSchema, formData);
    if (!parsed.ok) return parsed.state;

    const property = await db.property.findFirst({
      where: { id: propertyId, organizationId },
      select: { id: true },
    });
    if (!property) return actionError("That property no longer exists.");

    await db.expense.create({
      data: { ...parsed.data, organizationId, propertyId: property.id },
    });

    revalidatePath(`/app/properties/${propertyId}`);
    revalidatePath("/app/reports");
    return actionOk("Expense added.");
  });
}

export async function deleteExpenseAction(expenseId: string, _prev: ActionState): Promise<ActionState> {
  return runAction(async () => {
    const { organizationId } = await assertStaff();

    const expense = await db.expense.findFirst({
      where: { id: expenseId, organizationId },
      select: { id: true, propertyId: true },
    });
    if (!expense) return actionError("That expense no longer exists.");

    await db.expense.delete({ where: { id: expense.id } });

    revalidatePath(`/app/properties/${expense.propertyId}`);
    revalidatePath("/app/reports");
    return actionOk("Expense removed.");
  });
}
