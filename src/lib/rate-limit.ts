import { headers } from "next/headers";

/**
 * Rate limiting for unauthenticated endpoints, via Cloudflare's Workers
 * `ratelimit` binding (configured in wrangler.jsonc).
 *
 * Chosen over the zone-level WAF rule because that needs a domain in your own
 * account and this deployment is still on workers.dev. The binding works
 * anywhere the Worker runs, with nothing to configure per-environment.
 *
 * Fails **open**, deliberately. If the limiter is unavailable or throws, the
 * request is allowed. Failing closed on a rate limiter's own error would turn a
 * limiter outage into a login outage — locking out every legitimate user to stop
 * a hypothetical attacker. The bcrypt work factor is still doing its job
 * underneath, so an open failure degrades to "no throttle", which is exactly
 * where this app was before this file existed.
 */

type LimiterName = "LOGIN_RATE_LIMIT" | "SIGNUP_RATE_LIMIT";

/**
 * The limiter binding, or null when there isn't one — local `next dev` has no
 * Cloudflare bindings at all, and the app has to keep working there. Same
 * lazy-inside-a-request pattern as the D1 binding in src/lib/db.ts, for the
 * same reason: bindings only resolve inside an active request on Workers.
 */
async function getLimiter(name: LimiterName): Promise<{ limit: (o: { key: string }) => Promise<{ success: boolean }> } | null> {
  if (process.env.USE_D1 !== "true") return null; // not running on Workers
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const { env } = getCloudflareContext();
    return (env as unknown as Record<string, typeof env.LOGIN_RATE_LIMIT>)[name] ?? null;
  } catch {
    return null;
  }
}

/**
 * The caller's IP as Cloudflare sees it. `CF-Connecting-IP` is set by
 * Cloudflare's edge and cannot be spoofed by the client — unlike
 * X-Forwarded-For, which anyone can send. Returns null off-Cloudflare so the
 * caller can skip IP-keyed limits rather than lump every local request under
 * one shared bucket.
 */
async function clientIp(): Promise<string | null> {
  const h = await headers();
  return h.get("cf-connecting-ip");
}

/**
 * True when the request may proceed. Every key is checked independently and any
 * one of them tripping is enough to refuse — for login that means an attacker
 * gets throttled whether they hammer one account from many addresses or many
 * accounts from one.
 */
async function allowed(name: LimiterName, keys: (string | null)[]): Promise<boolean> {
  const limiter = await getLimiter(name);
  if (!limiter) return true;

  for (const key of keys) {
    if (!key) continue;
    try {
      const { success } = await limiter.limit({ key });
      if (!success) return false;
    } catch (err) {
      // See the fail-open note at the top of this file.
      console.error(`[rate-limit] ${name} failed for a key; allowing the request`, err);
      return true;
    }
  }
  return true;
}

/**
 * Login attempts, keyed by both address and account. Email is lowercased so
 * casing variations don't each get their own budget.
 */
export async function loginAttemptAllowed(email: string): Promise<boolean> {
  const ip = await clientIp();
  return allowed("LOGIN_RATE_LIMIT", [
    ip ? `login:ip:${ip}` : null,
    `login:email:${email.trim().toLowerCase()}`,
  ]);
}

/**
 * Signups, keyed by address only — the email is by definition new, so keying on
 * it would give every attempt its own fresh budget and limit nothing.
 */
export async function signupAttemptAllowed(): Promise<boolean> {
  const ip = await clientIp();
  return allowed("SIGNUP_RATE_LIMIT", [ip ? `signup:ip:${ip}` : null]);
}
