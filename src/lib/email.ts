import { db } from "@/lib/db";
import type { NotificationType } from "@prisma/client";

/**
 * Email transport. Two modes:
 *
 *  - RESEND_API_KEY set  -> send for real over Resend's HTTP API (no SDK, no
 *                           SMTP, works on serverless without extra deps).
 *  - unset               -> "logged" mode. Nothing leaves the box; every
 *                           message is written to NotificationLog and visible
 *                           at /app/settings/outbox. This keeps local dev and
 *                           demos honest — you can see exactly what would have
 *                           been sent, in order.
 *
 * Every send is recorded either way, which doubles as the audit trail a
 * landlord needs when a tenant claims they never got a rent notice.
 */

export type SendEmailInput = {
  to: string;
  subject: string;
  body: string; // plain text; we wrap it in a minimal HTML shell
  type: NotificationType;
  organizationId?: string | null;
  /** Pass a stable key to make a send idempotent (rent reminders, etc.). */
  dedupeKey?: string;
};

const FROM = process.env.EMAIL_FROM || "notifications@example.com";

function htmlShell(subject: string, body: string): string {
  const paragraphs = body
    .trim()
    .split(/\n{2,}/)
    .map(
      (p) =>
        `<p style="margin:0 0 16px;line-height:1.6;color:#1f2937">${escapeHtml(p).replace(/\n/g, "<br/>")}</p>`,
    )
    .join("");
  return `<!doctype html><html><body style="margin:0;background:#f9fafb;padding:32px 16px;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif">
<div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:32px">
<h1 style="margin:0 0 20px;font-size:18px;font-weight:600;color:#111827">${escapeHtml(subject)}</h1>
${paragraphs}
</div></body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function sendEmail(input: SendEmailInput): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;

  // Idempotency: if this exact message was already handled, do nothing.
  if (input.dedupeKey) {
    const existing = await db.notificationLog.findUnique({
      where: { dedupeKey: input.dedupeKey },
      select: { id: true },
    });
    if (existing) return;
  }

  const base = {
    organizationId: input.organizationId ?? null,
    type: input.type,
    toEmail: input.to,
    subject: input.subject,
    body: input.body,
    dedupeKey: input.dedupeKey ?? null,
  };

  if (!apiKey) {
    if (process.env.NODE_ENV !== "production") {
      console.info(`[email:logged] to=${input.to} subject="${input.subject}"`);
    }
    await record({ ...base, status: "LOGGED" });
    return;
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM,
        to: [input.to],
        subject: input.subject,
        text: input.body,
        html: htmlShell(input.subject, input.body),
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      await record({
        ...base,
        status: "FAILED",
        error: `${res.status} ${detail}`.slice(0, 500),
      });
      return;
    }
    await record({ ...base, status: "SENT" });
  } catch (err) {
    await record({
      ...base,
      status: "FAILED",
      error: err instanceof Error ? err.message.slice(0, 500) : "unknown error",
    });
  }
}

async function record(data: Parameters<typeof db.notificationLog.create>[0]["data"]) {
  try {
    await db.notificationLog.create({ data });
  } catch {
    // A duplicate dedupeKey from a concurrent run is the expected failure here,
    // and it means the message is already accounted for. Never let logging
    // break the caller's flow.
  }
}

/**
 * Notifications are fired from inside request handlers. A failing email must
 * never fail the user's action (paying rent, filing a ticket), so callers wrap
 * sends in this.
 */
export function sendEmailSafely(input: SendEmailInput): Promise<void> {
  return sendEmail(input).catch((err) => {
    console.error("[email] send failed", err);
  });
}

export function appUrl(path = ""): string {
  const base =
    process.env.APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
  return `${base.replace(/\/$/, "")}${path}`;
}
