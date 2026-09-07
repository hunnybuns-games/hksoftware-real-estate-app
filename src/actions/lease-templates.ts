"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertStaff } from "@/lib/rbac";
import { type ActionState, actionError, actionOk, nameField, parseForm, runAction } from "@/lib/forms";

const templateSchema = z.object({
  name: nameField,
  body: z
    .string()
    .trim()
    .min(1, "The template can't be empty.")
    .max(20000, "That's too long for a single template."),
});

export async function updateLeaseTemplateAction(
  templateId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { organizationId } = await assertStaff();
    const parsed = parseForm(templateSchema, formData);
    if (!parsed.ok) return parsed.state;

    const existing = await db.leaseTemplate.findFirst({
      where: { id: templateId, organizationId },
      select: { id: true },
    });
    if (!existing) return actionError("That template no longer exists.");

    await db.leaseTemplate.update({ where: { id: existing.id }, data: parsed.data });

    revalidatePath("/app/settings/lease-template");
    return actionOk("Template saved. New lease documents will use this wording.");
  });
}
