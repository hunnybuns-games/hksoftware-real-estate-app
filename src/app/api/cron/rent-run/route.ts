import { timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { computeBalance, generateRentCharges } from "@/lib/ledger";
import { notifyRentDue, notifyRentLate } from "@/lib/notifications";
import { daysBetweenUtc, startOfUtcDay } from "@/lib/dates";

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
  if (!isAuthorized(req)) {
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
  }[] = [];

  for (const org of organizations) {
    const { created } = await generateRentCharges({ organizationId: org.id, asOf: today });

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

      // Chase on the day the grace period lapses, then weekly — enough to be
      // useful, not enough to be harassment.
      if (balance.isLate) {
        const daysSinceGraceEnded = balance.daysPastDue - org.graceDays;
        if (daysSinceGraceEnded === 0 || daysSinceGraceEnded % 7 === 0) {
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

  return Response.json({ ranAt: today.toISOString(), organizations: results.length, results });
}

/**
 * Accepts either a bearer CRON_SECRET or Vercel's own cron header. Without a
 * configured secret the endpoint is refused outright rather than left open —
 * an unauthenticated rent run could be used to spam every tenant you have.
 */
function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[cron] CRON_SECRET is not set; refusing to run");
    return false;
  }

  const header = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
