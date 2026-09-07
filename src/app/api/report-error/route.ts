import { z } from "zod";
import { reportServerError } from "@/lib/error-reporting";
import { clientErrorReportAllowed } from "@/lib/rate-limit";

/**
 * Where client-side render errors go to actually be seen. `error.tsx` and
 * `global-error.tsx` both `console.error` in the browser already, but a
 * browser console is not a place anyone is watching — this is what forwards
 * the same failure into Workers Logs and the same email alert server errors
 * already get (see reportServerError in src/lib/error-reporting.ts).
 *
 * Unauthenticated by necessity: an error boundary can fire for a signed-out
 * visitor on a public page, and there's no session to require. What bounds
 * the blast radius of that, in order:
 *
 *  1. `Sec-Fetch-Site` must say `same-origin`. Browsers set this header and
 *     scripts can't forge it, so a POST from another site, or from curl in a
 *     loop, is refused before anything is spent. The app's own error
 *     boundaries — the only legitimate caller — fetch same-origin.
 *  2. A per-IP rate limit (REPORT_ERROR_RATE_LIMIT in wrangler.jsonc). Each
 *     accepted report can cost an alert email, and that email goes through
 *     the same binding as rent notices and password resets, with a shared
 *     monthly quota; left unlimited, this route was a way to exhaust it.
 *  3. A short-lived, per-isolate dedupe on the message, so one browser stuck
 *     in a render loop sends one alert, not one per re-render. Isolate-local
 *     only — a best-effort volume cut, not a guarantee, and not what the
 *     rate limit is for.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  message: z.string().trim().min(1).max(2000),
  digest: z.string().trim().max(200).optional(),
  stack: z.string().trim().max(4000).optional(),
  url: z.string().trim().max(500).optional(),
});

const DEDUPE_WINDOW_MS = 60 * 60 * 1000;
const DEDUPE_MAX_KEYS = 500;
const recentlyReported = new Map<string, number>();

/** True if this (url, message) pair was already reported in the last hour. */
function seenRecently(key: string, now: number): boolean {
  const last = recentlyReported.get(key);
  if (last !== undefined && now - last < DEDUPE_WINDOW_MS) return true;
  if (recentlyReported.size >= DEDUPE_MAX_KEYS) {
    // Drop the oldest entry rather than grow without bound.
    const oldest = recentlyReported.keys().next().value;
    if (oldest !== undefined) recentlyReported.delete(oldest);
  }
  recentlyReported.set(key, now);
  return false;
}

export async function POST(req: Request): Promise<Response> {
  if (req.headers.get("sec-fetch-site") !== "same-origin") {
    return Response.json({ ok: false }, { status: 403 });
  }

  if (!(await clientErrorReportAllowed())) {
    return Response.json({ ok: false }, { status: 429 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ ok: false }, { status: 400 });
  }

  const { message, digest, stack, url } = parsed.data;

  // Accepted either way — the browser is fire-and-forget — but a repeat
  // within the window doesn't reach the log or the inbox again.
  if (seenRecently(`${url ?? ""}\n${message}`, Date.now())) {
    return new Response(null, { status: 202 });
  }

  const err = new Error(message);
  if (stack) err.stack = stack;

  const context = ["client", url, digest].filter(Boolean).join(":") || "client";
  await reportServerError(context, err);

  // Nothing meaningful to hand back to the browser — this is fire-and-forget
  // from the caller's side (see error.tsx / global-error.tsx).
  return new Response(null, { status: 202 });
}
