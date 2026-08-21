import { z } from "zod";
import { reportServerError } from "@/lib/error-reporting";

/**
 * Where client-side render errors go to actually be seen. `error.tsx` and
 * `global-error.tsx` both `console.error` in the browser already, but a
 * browser console is not a place anyone is watching — this is what forwards
 * the same failure into Workers Logs and the same email alert server errors
 * already get (see reportServerError in src/lib/error-reporting.ts).
 *
 * Deliberately unauthenticated: an error boundary can fire for a signed-out
 * visitor on a public page, and there's no session to require. The blast
 * radius of that openness is bounded by what reportServerError itself does —
 * one console.error line, plus (only if ERROR_ALERT_EMAIL is configured) one
 * best-effort email with no dedupe. A determined caller could run up that
 * email count; there's no rate limiter on this route yet for the same reason
 * there wasn't one on this app's very first unauthenticated endpoints — worth
 * adding if it's ever actually abused (see docs/observability.md), not worth
 * a new Cloudflare rate-limit binding to guard a client error reporter before
 * there's any evidence it needs one.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  message: z.string().trim().min(1).max(2000),
  digest: z.string().trim().max(200).optional(),
  stack: z.string().trim().max(4000).optional(),
  url: z.string().trim().max(500).optional(),
});

export async function POST(req: Request): Promise<Response> {
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
  const err = new Error(message);
  if (stack) err.stack = stack;

  const context = ["client", url, digest].filter(Boolean).join(":") || "client";
  await reportServerError(context, err);

  // Nothing meaningful to hand back to the browser — this is fire-and-forget
  // from the caller's side (see error.tsx / global-error.tsx).
  return new Response(null, { status: 202 });
}
