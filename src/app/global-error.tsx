"use client";

import Link from "next/link";
import { useEffect } from "react";
import { reportClientError } from "@/lib/report-client-error";
import "./globals.css";

/**
 * `error.tsx` only catches failures inside `RootLayout`'s children — if
 * `layout.tsx` itself throws (its `generateMetadata`, the nonce read off
 * headers, whatever), nothing in the tree beneath it is left to render an
 * error boundary. This is what Next renders instead in that case, which is
 * also why it replaces the whole document rather than nesting inside it: it
 * needs its own `<html>`/`<body>`, and can't assume `globals.css` or the
 * theme script from layout.tsx ran.
 *
 * Kept deliberately minimal — no theme script, no nonce (there's no request
 * context left to read one from at this point), just enough to tell someone
 * something broke and to get the failure reported the same way error.tsx's
 * does.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app] unhandled root error", error);
    reportClientError(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <div className="flex min-h-dvh items-center justify-center px-4">
          <div className="max-w-md text-center">
            <h1 className="text-lg font-semibold text-slate-900">Something went wrong</h1>
            <p className="mt-2 text-sm text-slate-500">
              The app hit a problem it couldn&apos;t recover from on this page. The error has been
              logged.
            </p>
            {error.digest ? (
              <p className="mt-2 font-mono text-xs text-slate-400">Reference: {error.digest}</p>
            ) : null}
            <div className="mt-6 flex justify-center gap-3">
              <button type="button" onClick={reset} className="btn-primary">
                Try again
              </button>
              <Link href="/" className="btn-secondary">
                Start over
              </Link>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
