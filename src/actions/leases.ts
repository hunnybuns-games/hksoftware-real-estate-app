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
  centsField,
  dateField,
  intField,
  optionalDateField,
  optionalText,
  parseForm,
  runAction,
} from "@/lib/forms";
import { generateRentCharges } from "@/lib/ledger";
import { applyReconciliation } from "@/lib/reconciliation";
import { startOfUtcDay } from "@/lib/dates";

const leaseSchema = z
  .object({
    unitId: z.string().min(1, "Pick a unit."),
    tenantId: z.string().min(1, "Pick a tenant."),
    status: z.enum(["DRAFT", "ACTIVE", "ENDED"]),
    startDate: dateField("Start date"),
    endDate: optionalDateField,
    rentAmountCents: centsField("Monthly rent"),
    depositCents: centsField("Deposit"),
    // Capped at 28 so the due date exists in February.
    rentDueDay: intField("Rent due day", 1, 28),
    // Subsidized (Section 8/HAP) arrangements: an empty string means no
    // split at all, matching the nullable DB column exactly.
    hasSubsidy: z
      .string()
      .optional()
      .transform((v) => v === "on" || v === "true"),
    subsidyOwedCents: z
      .string()
      .optional()
      .transform((v) => (v ?? "").trim()),
    subsidyPayerName: optionalText(200),
    notes: optionalText(2000),
  })
  .refine((v) => !v.endDate || v.endDate.getTime() > v.startDate.getTime(), {
    message: "The end date has to be after the start date.",
    path: ["endDate"],
  })
  .superRefine((v, ctx) => {
    if (!v.hasSubsidy) return;
    if (!/^\$?\s*\d+(\.\d{1,2})?$/.test(v.subsidyOwedCents)) {
      ctx.addIssue({
        code: "custom",
        path: ["subsidyOwedCents"],
        message: "Enter the subsidy amount as a dollar figure, e.g. 450.",
      });
      return;
    }
    const cents = Math.round(Number(v.subsidyOwedCents.replace(/[$,\s]/g, "")) * 100);
    if (cents > v.rentAmountCents) {
      ctx.addIssue({
        code: "custom",
        path: ["subsidyOwedCents"],
        message: "The subsidy portion can't be more than the total rent.",
      });
    }
  })
  .transform(({ hasSubsidy, subsidyOwedCents, subsidyPayerName, ...rest }) => ({
    ...rest,
    subsidyOwedCents: hasSubsidy
      ? Math.round(Number(subsidyOwedCents.replace(/[$,\s]/g, "")) * 100)
      : null,
    subsidyPayerName: hasSubsidy ? subsidyPayerName ?? null : null,
  }));

export async function createLeaseAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let newId: string | null = null;

  const state = await runAction(async () => {
    const { organizationId } = await assertStaff();
    const parsed = parseForm(leaseSchema, formData);
    if (!parsed.ok) return parsed.state;
    const data = parsed.data;

    // Both sides of the relationship must belong to the caller's org.
    const [unit, tenant] = await Promise.all([
      db.unit.findFirst({
        where: { id: data.unitId, property: { organizationId } },
        select: { id: true },
      }),
      db.tenant.findFirst({
        where: { id: data.tenantId, organizationId },
        select: { id: true },
      }),
    ]);
    if (!unit) return actionError("Please fix the highlighted fields.", { unitId: "Pick a unit." });
    if (!tenant) {
      return actionError("Please fix the highlighted fields.", { tenantId: "Pick a tenant." });
    }

    if (data.status === "ACTIVE") {
      const conflict = await findOverlappingLease({
        unitId: unit.id,
        startDate: data.startDate,
        endDate: data.endDate,
      });
      if (conflict) return conflict;
    }

    // Not wrapped in $transaction — D1 doesn't support interactive
    // transactions and throws outright if asked to. Sequential calls run
    // exactly as they always did on this database (the old wrapper's
    // commit/rollback were no-ops here anyway).
    const lease = await db.lease.create({
      data: { ...data, organizationId },
      select: { id: true },
    });
    if (data.status === "ACTIVE") {
      await db.unit.update({ where: { id: unit.id }, data: { status: "OCCUPIED" } });
    }

    // Put the rent that's already owed on the books immediately, so the lease
    // detail page isn't empty and the dashboard is accurate the moment it's
    // created.
    if (data.status === "ACTIVE") {
      await generateRentCharges({ organizationId });
      await applyReconciliation(lease.id);
    }

    newId = lease.id;
    revalidateLeaseViews();
    return actionOk();
  });

  if (newId) redirect(`/app/leases/${newId}`);
  return state;
}

export async function updateLeaseAction(
  leaseId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { organizationId } = await assertStaff();
    const parsed = parseForm(leaseSchema, formData);
    if (!parsed.ok) return parsed.state;
    const data = parsed.data;

    const existing = await db.lease.findFirst({
      where: { id: leaseId, organizationId },
      select: { id: true, unitId: true, status: true },
    });
    if (!existing) return actionError("That lease no longer exists.");

    const [unit, tenant] = await Promise.all([
      db.unit.findFirst({
        where: { id: data.unitId, property: { organizationId } },
        select: { id: true },
      }),
      db.tenant.findFirst({
        where: { id: data.tenantId, organizationId },
        select: { id: true },
      }),
    ]);
    if (!unit) return actionError("Please fix the highlighted fields.", { unitId: "Pick a unit." });
    if (!tenant) {
      return actionError("Please fix the highlighted fields.", { tenantId: "Pick a tenant." });
    }

    if (data.status === "ACTIVE") {
      const conflict = await findOverlappingLease({
        unitId: unit.id,
        startDate: data.startDate,
        endDate: data.endDate,
        excludeLeaseId: existing.id,
      });
      if (conflict) return conflict;
    }

    // Not wrapped in $transaction — D1 doesn't support interactive
    // transactions and throws outright if asked to. Sequential calls run
    // exactly as they always did on this database (the old wrapper's
    // commit/rollback were no-ops here anyway).
    await db.lease.update({ where: { id: existing.id }, data });

    if (data.status === "ACTIVE") {
      await db.unit.update({ where: { id: unit.id }, data: { status: "OCCUPIED" } });
    }

    // If this lease is no longer active, or it moved to a different unit, the
    // unit(s) it left behind may now be vacant.
    const unitsToReconcile = new Set<string>();
    if (data.status !== "ACTIVE") unitsToReconcile.add(existing.unitId);
    if (existing.unitId !== unit.id) unitsToReconcile.add(existing.unitId);

    for (const id of unitsToReconcile) {
      const stillOccupied = await db.lease.count({
        where: { unitId: id, status: "ACTIVE" },
      });
      if (stillOccupied === 0) {
        const current = await db.unit.findUnique({ where: { id }, select: { status: true } });
        // Leave a unit that's deliberately marked MAINTENANCE alone.
        if (current?.status === "OCCUPIED") {
          await db.unit.update({ where: { id }, data: { status: "VACANT" } });
        }
      }
    }

    if (data.status === "ACTIVE") await generateRentCharges({ organizationId });

    // Rent, due day, or the subsidy split may have just changed — every
    // period's coverage math depends on those, so recompute from scratch
    // rather than leave stale statuses on existing payments.
    await applyReconciliation(existing.id);

    revalidateLeaseViews(leaseId);
    return actionOk("Lease saved.");
  });
}

/**
 * Ending a lease is the common case (renewal, move-out) and deserves to be one
 * click rather than a trip through the edit form.
 */
export async function endLeaseAction(leaseId: string, _prev: ActionState): Promise<ActionState> {
  return runAction(async () => {
    const { organizationId } = await assertStaff();

    const lease = await db.lease.findFirst({
      where: { id: leaseId, organizationId },
      select: { id: true, unitId: true, endDate: true },
    });
    if (!lease) return actionError("That lease no longer exists.");

    const today = startOfUtcDay(new Date());

    // Not wrapped in $transaction — D1 doesn't support interactive
    // transactions and throws outright if asked to. Sequential calls run
    // exactly as they always did on this database (the old wrapper's
    // commit/rollback were no-ops here anyway).
    await db.lease.update({
      where: { id: lease.id },
      data: {
        status: "ENDED",
        // Keep an end date that was already agreed; otherwise it ends today.
        endDate: lease.endDate ?? today,
      },
    });

    const stillOccupied = await db.lease.count({
      where: { unitId: lease.unitId, status: "ACTIVE" },
    });
    if (stillOccupied === 0) {
      const unit = await db.unit.findUnique({
        where: { id: lease.unitId },
        select: { status: true },
      });
      if (unit?.status === "OCCUPIED") {
        await db.unit.update({ where: { id: lease.unitId }, data: { status: "VACANT" } });
      }
    }

    revalidateLeaseViews(leaseId);
    return actionOk("Lease ended. The unit is now marked vacant.");
  });
}

/**
 * Two active leases on one unit for overlapping dates is almost always a typo,
 * and it makes occupancy and rent rolls wrong in ways that are hard to spot
 * later. Block it at write time.
 */
async function findOverlappingLease(args: {
  unitId: string;
  startDate: Date;
  endDate: Date | null;
  excludeLeaseId?: string;
}): Promise<ActionState | null> {
  const overlapping = await db.lease.findFirst({
    where: {
      unitId: args.unitId,
      status: "ACTIVE",
      id: args.excludeLeaseId ? { not: args.excludeLeaseId } : undefined,
      // Two ranges overlap when each starts before the other ends. A null
      // endDate means open-ended, which overlaps everything after its start.
      AND: [
        args.endDate ? { startDate: { lte: args.endDate } } : {},
        { OR: [{ endDate: null }, { endDate: { gte: args.startDate } }] },
      ],
    },
    select: { id: true, tenant: { select: { firstName: true, lastName: true } } },
  });

  if (!overlapping) return null;

  return actionError("Please fix the highlighted fields.", {
    unitId: `This unit already has an active lease with ${overlapping.tenant.firstName} ${overlapping.tenant.lastName} over these dates. End that lease first, or pick different dates.`,
  });
}

function revalidateLeaseViews(leaseId?: string) {
  revalidatePath("/app");
  revalidatePath("/app/leases");
  revalidatePath("/app/properties");
  revalidatePath("/app/payments");
  if (leaseId) revalidatePath(`/app/leases/${leaseId}`);
}
