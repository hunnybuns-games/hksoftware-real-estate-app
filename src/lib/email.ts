import { db } from "@/lib/db";
import { absoluteUrl } from "@/lib/site";
import type { NotificationType } from "@prisma/client";

/**
 * Email transport. Three modes, tried in this order:
 *
 *  1. Cloudflare Email Service — the `EMAIL` binding declared in wrangler.jsonc.
 *     Preferred, because it keeps everything on the one account we already pay
 *     for: no third-party signup, no API key to store or rotate, 3,000 sends a
 *     month included. Two things gate it, and both are the account's, not the
 *     code's: a sending domain onboarded to Email Service (with EMAIL_FROM on
 *     it), and the Workers Paid plan. Until then it can only reach *verified
 *     destination addresses* in the account, so this module treats a missing
 *     EMAIL_FROM as "not configured" and falls through rather than burning a send
 *     on a guaranteed rejection.
 *
 *  2. Resend — if RESEND_API_KEY is set. Kept deliberately: it's the escape hatch
 *     if Cloudflare's sending is unavailable, and it has the same domain
 *     requirement, so switching providers is not a way to avoid that step.
 *
 *  3. "Logged" — nothing leaves the box. Every message is written to
 *     NotificationLog and visible at /app/settings/outbox. This keeps local dev
 *     and demos honest: you can see exactly what would have been sent, in order.
 *
 * Every send is recorded whichever mode is active, which doubles as the audit
 * trail a landlord needs when a tenant claims they never got a rent notice.
 *
 * `configuredFrom`/`emailBinding`/`sendViaCloudflare`/`sendViaResend`/
 * `htmlShell` are exported for src/lib/error-reporting.ts, which needs the
 * same transport but deliberately bypasses `sendEmail()`'s dedupe-check-then-
 * record round trip through the database — an alert about the database being
 * unreachable can't itself depend on the database being reachable.
 */

export type SendEmailInput = {
  to: string;
  subject: string;
  body: string; // plain text; we wrap it in a minimal HTML shell
  type: NotificationType;
  organizationId?: string | null;
  /** Pass a stable key to make a send idempotent (rent reminders, etc.). */
  dedupeKey?: string;
  /**
   * Set when the body contains a single-use credential — a password reset link.
   * The message is still sent in full; what changes is what gets *recorded*.
   *
   * This matters because NotificationLog is readable in the app at
   * /app/settings/outbox, scoped to the organization. Recording a live reset link
   * there would put a working account-takeover link in front of every admin in
   * the org, and would defeat the point of storing only a hash of the token
   * (src/lib/password-reset.ts) — the plaintext would be sitting in another table.
   */
  sensitive?: boolean;
};

/**
 * What to persist for a message body.
 *
 * Outside production the full body is kept, because in "logged" mode nothing is
 * delivered and the log *is* the inbox — it's how local dev and the e2e suite
 * follow a reset link, and there's no delivered email to compromise. In
 * production a sensitive body is recorded with its URLs stripped: the audit trail
 * only needs "a reset was requested, at this time, to this address".
 */
export function bodyForLog(body: string, sensitive: boolean | undefined): string {
  if (!sensitive || process.env.NODE_ENV !== "production") return body;
  return body.replace(/https?:\/\/\S+/g, "[link removed from this log]");
}

/**
 * The placeholder in .env.example. Treated as "unset": sending from
 * @example.com is rejected by any provider, and failing over to the email log is
 * a much better outcome than a log full of E_SENDER_DOMAIN_NOT_AVAILABLE.
 */
const PLACEHOLDER_FROM = "notifications@example.com";

export function configuredFrom(): string | null {
  const from = process.env.EMAIL_FROM?.trim();
  if (!from || from === PLACEHOLDER_FROM) return null;
  return from;
}

/**
 * Turns whatever a transport threw into something a landlord reading
 * /app/settings/outbox can act on.
 *
 * Cloudflare's binding throws Errors carrying a `code`, and the two codes almost
 * everyone hits first mean the same thing — "you haven't finished setting up a
 * domain" — which is a configuration step, not a bug. Saying so in the log is the
 * difference between a five-minute fix and an afternoon.
 *
 * Exported for tests: this is pure, and it's the part with the judgement in it.
 */
export function describeEmailError(err: unknown): string {
  const code =
    typeof err === "object" && err !== null && "code" in err
      ? String((err as { code?: unknown }).code)
      : null;
  const message = err instanceof Error ? err.message : "unknown error";

  const explanations: Record<string, string> = {
    E_SENDER_NOT_VERIFIED:
      "The sending domain isn't verified in Cloudflare yet. Onboard the domain in Email Service, then set EMAIL_FROM to an address on it.",
    E_SENDER_DOMAIN_NOT_AVAILABLE:
      "EMAIL_FROM uses a domain that isn't onboarded to Cloudflare Email Service. Until it is, sending only works to verified destination addresses in your account.",
    E_RECIPIENT_NOT_ALLOWED:
      "The EMAIL binding is restricted to specific recipients. Remove allowed_destination_addresses from wrangler.jsonc to mail residents.",
    E_RECIPIENT_SUPPRESSED:
      "This address is on Cloudflare's suppression list — it previously bounced or reported mail as spam. It needs removing there before sends will reach it.",
    E_RATE_LIMIT_EXCEEDED: "Cloudflare's sending rate limit was hit. This send should be retried.",
    E_DAILY_LIMIT_EXCEEDED:
      "The account's daily sending quota is used up. New accounts start low and scale with sending history.",
    E_CONTENT_TOO_LARGE: "The message is over the 5 MiB limit.",
    E_TOO_MANY_RECIPIENTS: "Over 50 recipients across to/cc/bcc.",
    E_INTERNAL_SERVER_ERROR: "Cloudflare Email Service was temporarily unavailable.",
  };

  const explanation = code ? explanations[code] : undefined;
  if (code && explanation) return `${code}: ${explanation}`.slice(0, 500);
  if (code) return `${code}: ${message}`.slice(0, 500);
  return message.slice(0, 500);
}

/**
 * The Cloudflare `EMAIL` binding, or null when there isn't one — local `next dev`
 * has no Cloudflare bindings at all. Same lazy-inside-a-request pattern as the D1
 * binding in src/lib/db.ts, for the same reason: bindings only resolve inside an
 * active request on Workers.
 */
export async function emailBinding(): Promise<SendEmail | null> {
  if (process.env.USE_D1 !== "true") return null; // not running on Workers
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    return getCloudflareContext().env.EMAIL ?? null;
  } catch {
    return null;
  }
}

export function htmlShell(subject: string, body: string): string {
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

export type SendOutcome = { status: "SENT" | "LOGGED" } | { status: "FAILED"; error: string };

/**
 * Cloudflare Email Service. No MIME construction and no `mimetext` dependency —
 * the structured builder takes `text` and `html` directly. (The older
 * `EmailMessage` + raw-RFC-5322 API still exists; there's no reason to use it
 * for mail we compose ourselves.)
 */
export async function sendViaCloudflare(
  binding: SendEmail,
  from: string,
  input: Pick<SendEmailInput, "to" | "subject" | "body">,
): Promise<SendOutcome> {
  try {
    await binding.send({
      from,
      to: input.to,
      subject: input.subject,
      text: input.body,
      html: htmlShell(input.subject, input.body),
    });
    return { status: "SENT" };
  } catch (err) {
    return { status: "FAILED", error: describeEmailError(err) };
  }
}

/** Resend's HTTP API directly — no SDK, so nothing to bundle into the isolate. */
export async function sendViaResend(
  apiKey: string,
  from: string,
  input: Pick<SendEmailInput, "to" | "subject" | "body">,
): Promise<SendOutcome> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: input.subject,
        text: input.body,
        html: htmlShell(input.subject, input.body),
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { status: "FAILED", error: `${res.status} ${detail}`.slice(0, 500) };
    }
    return { status: "SENT" };
  } catch (err) {
    return { status: "FAILED", error: describeEmailError(err) };
  }
}

async function sendEmail(input: SendEmailInput): Promise<void> {
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
    // Note this is the *recorded* body, not the sent one — see bodyForLog.
    body: bodyForLog(input.body, input.sensitive),
    dedupeKey: input.dedupeKey ?? null,
  };

  const from = configuredFrom();
  const binding = from ? await emailBinding() : null;
  const resendKey = process.env.RESEND_API_KEY;

  let outcome: SendOutcome;
  if (from && binding) {
    outcome = await sendViaCloudflare(binding, from, input);
    // The binding object exists as soon as it's declared in wrangler.jsonc —
    // it doesn't mean the account-level gates (Email Service onboarding, the
    // Paid plan) are actually satisfied. Those show up as a thrown error at
    // send time, not as a missing binding, so "binding present" alone isn't
    // enough to skip Resend. Retry there before giving up, or the escape
    // hatch above is never actually reachable while Cloudflare is configured
    // but not yet working.
    if (outcome.status === "FAILED" && resendKey) {
      outcome = await sendViaResend(resendKey, from, input);
    }
  } else if (from && resendKey) {
    outcome = await sendViaResend(resendKey, from, input);
  } else {
    if (process.env.NODE_ENV !== "production") {
      console.info(`[email:logged] to=${input.to} subject="${input.subject}"`);
    }
    outcome = { status: "LOGGED" };
  }

  await record({ ...base, ...outcome });
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

/**
 * Kept as the name every email-building call site already uses; the origin
 * itself lives in src/lib/site.ts, so a link in an email and a canonical URL on
 * a page are built from the same value.
 */
export function appUrl(path = ""): string {
  return absoluteUrl(path);
}
