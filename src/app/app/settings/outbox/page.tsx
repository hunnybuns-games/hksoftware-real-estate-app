import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/rbac";
import { formatDateTime } from "@/lib/dates";
import { Badge, Banner, Card, EmptyState } from "@/components/ui";

export const metadata: Metadata = { title: "Email log" };

const typeLabels: Record<string, string> = {
  RENT_DUE: "Rent due",
  RENT_RECEIVED: "Payment received",
  RENT_LATE: "Rent late",
  MAINTENANCE_CREATED: "New maintenance request",
  MAINTENANCE_UPDATED: "Maintenance update",
  STAFF_INVITE: "Team invitation",
  TENANT_INVITE: "Resident invitation",
};

/**
 * Every notification the app has sent, in order. Two jobs: it's the audit trail
 * for "I never got a rent notice", and in logged mode (no email provider) it's
 * the only way to read what the app would have sent.
 */
export default async function OutboxPage() {
  const ctx = await requireStaff();

  const logs = await db.notificationLog.findMany({
    where: { organizationId: ctx.organizationId },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const loggedOnly = !process.env.RESEND_API_KEY;

  return (
    <div className="max-w-3xl space-y-6">
      {loggedOnly ? (
        <Banner tone="warning" title="No email provider configured">
          Nothing is actually being delivered. Messages are recorded here so you can see exactly
          what would have gone out. Set <code className="rounded bg-white/60 px-1">RESEND_API_KEY</code>{" "}
          and <code className="rounded bg-white/60 px-1">EMAIL_FROM</code> to start sending.
        </Banner>
      ) : null}

      <Card
        title="Sent messages"
        description={logs.length === 100 ? "Most recent 100." : undefined}
        padded={false}
      >
        {logs.length === 0 ? (
          <EmptyState
            title="Nothing sent yet"
            description="Rent reminders, receipts, maintenance updates and invitations all show up here."
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {logs.map((log) => (
              <li key={log.id}>
                <details className="group">
                  <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-5 py-3.5 hover:bg-slate-50/60">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-900">
                        {log.subject}
                      </span>
                      <span className="block truncate text-xs text-slate-500">
                        to {log.toEmail} · {formatDateTime(log.createdAt)}
                      </span>
                    </span>
                    <Badge tone="neutral">{typeLabels[log.type] ?? log.type}</Badge>
                    {log.status === "SENT" ? (
                      <Badge tone="green">Sent</Badge>
                    ) : log.status === "FAILED" ? (
                      <Badge tone="red">Failed</Badge>
                    ) : (
                      <Badge tone="slate">Logged</Badge>
                    )}
                  </summary>
                  <div className="border-t border-slate-100 bg-slate-50/60 px-5 py-4">
                    {log.error ? (
                      <p className="mb-3 text-xs text-red-700">{log.error}</p>
                    ) : null}
                    <pre className="text-xs leading-relaxed whitespace-pre-wrap text-slate-700">
                      {log.body}
                    </pre>
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
