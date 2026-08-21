/**
 * Shared by `error.tsx` and `global-error.tsx` — both are error boundaries
 * that catch a render failure client-side, where `console.error` alone goes
 * nowhere anyone is watching. Forwards to /api/report-error, which puts the
 * same failure into Workers Logs and (if configured) the same email alert
 * server-side errors already get. See src/lib/error-reporting.ts.
 *
 * Fire-and-forget on purpose: an error boundary is already showing the user
 * a "something went wrong" screen, and a failed reporting call must never
 * become a second error on top of the first.
 */
export function reportClientError(error: Error & { digest?: string }): void {
  try {
    void fetch("/api/report-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: error.message || error.name || "Unknown client error",
        digest: error.digest,
        stack: error.stack,
        url: typeof window !== "undefined" ? window.location.pathname : undefined,
      }),
      // Best-effort even if the tab is closing right after this boundary
      // renders (e.g. a navigation away triggered the unmount).
      keepalive: true,
    });
  } catch {
    // Never let the reporter itself throw in an error boundary.
  }
}
