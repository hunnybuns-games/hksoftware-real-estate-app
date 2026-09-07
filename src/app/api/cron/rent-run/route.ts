import { db } from "@/lib/db";
import { isCronAuthorized } from "@/lib/cron-auth";
import { computeBalance, generateRentCharges, shouldSendLateNotice } from "@/lib/ledger";
import { applyReconciliationForOrganization } from "@/lib/reconciliation";
import { notifyRentDue, notifyRentLate } from "@/lib/notifications";
import { daysBetweenUtc, startOfUtcDay } from "@/lib/dates";
import { reportServerError } from "@/lib/error-reporting";

/**
 * Nightly rent run: post this month's rent charges, then send due/late notices.
 *
 * Idempotency is what makes this safe to run on a schedule *and* by hand:
 * charges are keyed on (lease, type, period), and each email carries a
 * dedupeKey, so running it five times in a day sends nothing extra.
 *
 * Schedule it with Vercel Cron (see vercel.json) or any external scheduler:
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://…/api/cron/rent-run
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Days before the due date to send a heads-up. */
const REMINDER_LEAD_DAYS = 3;

export async function GET(req: Request): Promise<Response> {
  if (!isCronAuthorized(req, "rent-run")) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = startOfUtcDay(new Date());
  const organizations = await db.organization.findMany({
    select: { id: true, name: true, graceDays: true },
  });

  const results: {
    organizationId: string;
    chargesCreated: number;
    remindersSent: number;
    lateNoticesSent: number;
    error?: string;
  }[] = [];

  // One organization's bad data (a malformed lease, a DB hiccup mid-loop)
  // must not take down every other organization's rent run — same isolation
  // bank-sync already has per connection. Record and move on.
  for (const org of organizations) {
    try {
      await runForOrganization(org, today, results);
    } catch (err) {
      console.error(`[cron:rent-run] ${org.id} failed`, err);
      await reportServerError(`cron:rent-run:${org.id}`, err);
      results.push({ organizationId: org.id, chargesCreated: 0, remindersSent: 0, lateNoticesSent: 0, error: err instanceof Error ? err.message : "unknown error" });
    }
  }

  return Response.json({ ranAt: today.toISOString(), organizations: results.length, results });
}

async function runForOrganization(
  org: { id: string; name: string; graceDays: number },
  today: Date,
  results: {
    organizationId: string;
    chargesCreated: number;
    remindersSent: number;
    lateNoticesSent: number;
    error?: string;
  }[],
): Promise<void> {
  const { created } = await generateRentCharges({ organizationId: org.id, asOf: today });

  // Reconciliation is otherwise only recomputed when something is written —
  // a payment recorded, a charge posted. But SHORT is a function of *today*
  // (a partial payment turns short once grace lapses, with no write to
  // trigger it), so the nightly run is the one place that keeps those
  // statuses honest. Unconditional, unlike the manual "Run rent" button's
  // charges-only trigger, and cheap: one pass over the org's leases.
  await applyReconciliationForOrganization(org.id);

  let remindersSent = 0;
  let lateNoticesSent = 0;

  const leases = await db.lease.findMany({
    where: { organizationId: org.id, status: "ACTIVE" },
    include: {
      charges: { where: { voidedAt: null } },
      payments: { select: { amountCents: true, status: true } },
      tenant: { select: { firstName: true, email: true } },
      unit: { select: { label: true, property: { select: { name: true } } } },
    },
  });

  for (const lease of leases) {
    const balance = computeBalance({
      charges: lease.charges,
      payments: lease.payments,
      graceDays: org.graceDays,
      asOf: today,
    });

    if (balance.balanceCents <= 0 || !balance.oldestUnpaidDueDate) continue;

    const daysUntilDue = daysBetweenUtc(today, balance.oldestUnpaidDueDate);
    const dueKey = balance.oldestUnpaidDueDate.toISOString().slice(0, 10);

    if (daysUntilDue >= 0 && daysUntilDue <= REMINDER_LEAD_DAYS) {
      await notifyRentDue({
        to: { email: lease.tenant.email, name: lease.tenant.firstName },
        organizationId: org.id,
        orgName: org.name,
        amountCents: balance.balanceCents,
        dueDate: balance.oldestUnpaidDueDate,
        unitLabel: lease.unit.label,
        propertyName: lease.unit.property.name,
        dedupeKey: `rent-due:${lease.id}:${dueKey}`,
      });
      remindersSent += 1;
      continue;
    }

    // Chase on the first day the balance is late, then weekly. The cadence
    // lives in shouldSendLateNotice so it's unit-tested — an off-by-one here
    // once meant the first notice went out a week after grace lapsed.
    if (balance.isLate) {
      if (shouldSendLateNotice({ daysPastDue: balance.daysPastDue, graceDays: org.graceDays })) {
        await notifyRentLate({
          to: { email: lease.tenant.email, name: lease.tenant.firstName },
          organizationId: org.id,
          orgName: org.name,
          amountCents: balance.balanceCents,
          dueDate: balance.oldestUnpaidDueDate,
          daysLate: balance.daysPastDue,
          dedupeKey: `rent-late:${lease.id}:${dueKey}:${balance.daysPastDue}`,
        });
        lateNoticesSent += 1;
      }
    }
  }

  results.push({
    organizationId: org.id,
    chargesCreated: created,
    remindersSent,
    lateNoticesSent,
  });
}
