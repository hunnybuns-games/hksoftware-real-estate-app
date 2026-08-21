import {
  configuredFrom,
  emailBinding,
  sendViaCloudflare,
  sendViaResend,
  type SendOutcome,
} from "@/lib/email";

/**
 * The other half of "errors go to Workers logs and vanish" — see
 * docs/observability.md. `console.error` (always called, first, regardless
 * of what follows) is what Cloudflare Workers Logs picks up once
 * `observability.enabled` is on in wrangler.jsonc; the email below is what
 * makes someone actually notice without having to go look.
 *
 * Deliberately does not go through src/lib/email.ts's `sendEmail()` — that
 * function does a dedupe check and then a NotificationLog write, both of
 * which are database round trips. An alert whose whole reason for existing
 * is "something broke, possibly the database" can't depend on the database
 * being reachable to send it. This calls the transport directly instead, at
 * the cost of no dedupe — a genuine outage sends one email per failed
 * request, not one email total. Acceptable for a first version; revisit if
 * that turns out to be noisy in practice.
 *
 * No-ops silently if ERROR_ALERT_EMAIL or EMAIL_FROM isn't set, same as the
 * rest of the app's email system degrading to "logged only" without either.
 */
export async function reportServerError(context: string, err: unknown): Promise<void> {
  // Always first, and unconditional: this is the one thing that works in
  // every environment (local dev, CI, production) with nothing configured.
  console.error(`[error:${context}]`, err);

  const to = process.env.ERROR_ALERT_EMAIL?.trim();
  const from = configuredFrom();
  if (!to || !from) return;

  const { subject, body } = buildAlertEmail(context, err);

  try {
    const binding = await emailBinding();
    let outcome: SendOutcome | null = null;
    if (binding) {
      outcome = await sendViaCloudflare(binding, from, { to, subject, body });
    }
    const resendKey = process.env.RESEND_API_KEY;
    if ((!outcome || outcome.status === "FAILED") && resendKey) {
      outcome = await sendViaResend(resendKey, from, { to, subject, body });
    }
  } catch {
    // Best-effort. An alert that itself throws must never take down the
    // request that triggered it — the console.error above already happened.
  }
}

/**
 * Pure — exported for tests. Kept separate from the sending logic above so
 * the formatting can be checked without a network or a Cloudflare binding.
 */
export function buildAlertEmail(context: string, err: unknown): { subject: string; body: string } {
  const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  const stack = err instanceof Error && err.stack ? err.stack.slice(0, 2000) : null;

  return {
    subject: `ComfyLease error: ${context}`,
    body: [
      `Context: ${context}`,
      `Time: ${new Date().toISOString()}`,
      "",
      message,
      stack ? `\n${stack}` : "",
    ]
      .join("\n")
      .trim(),
  };
}
