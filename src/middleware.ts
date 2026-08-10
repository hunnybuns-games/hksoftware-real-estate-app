import { NextResponse, type NextRequest } from "next/server";

/**
 * Content-Security-Policy, nonce-based.
 *
 * Why here and not `headers()` in next.config.ts: the other hardening headers
 * there are static strings, but a useful CSP can't be. This app's pages carry
 * inline scripts — React's hydration payload, and the theme script in
 * src/app/layout.tsx that has to run before first paint — so a policy of
 * `script-src 'self'` would break every page, and `'unsafe-inline'` would make
 * the whole exercise decorative. A per-request nonce allows exactly our own
 * inline scripts and nothing else, and it has to be generated per request, which
 * means it belongs in the one place that runs before every response.
 *
 * DO NOT rename this to `proxy.ts`, even though Next 16 warns on every build that
 * `middleware` is deprecated in favour of it. Next's `proxy.ts` convention *always*
 * runs on the Node runtime — it rejects a route-segment config that tries to say
 * otherwise — and @opennextjs/cloudflare refuses to bundle a Node middleware
 * ("Node.js middleware is not currently supported"), so `npm run cf:build` exits 1
 * and the app cannot be deployed at all. `middleware.ts` still compiles to edge,
 * which is what workerd runs. Revisit when OpenNext supports Node middleware; the
 * build warning is the lesser problem by a wide margin.
 *
 * Next.js finds the nonce by reading the CSP off the *request* headers, which is
 * why it's set on both the request and the response below — that's what makes it
 * attach the nonce to the script tags it generates itself.
 */

/** Directives that don't depend on the nonce, kept here so the policy reads as one thing. */
function policy(nonce: string, isDev: boolean): string {
  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    /*
     * 'strict-dynamic' lets a script we've already trusted load further scripts.
     * That's not a loophole, it's the point: Next loads its own chunks
     * programmatically, and Plaid Link injects cdn.plaid.com from JavaScript. The
     * alternative is enumerating hashes for machinery that changes every build.
     */
    "'strict-dynamic'",
    // Next's dev server compiles and evaluates on the fly. Never in production.
    isDev ? "'unsafe-eval'" : null,
  ]
    .filter(Boolean)
    .join(" ");

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    /*
     * Styles keep 'unsafe-inline'. Next injects inline <style> during development
     * and for critical CSS, and there is no nonce plumbing for those. Worth being
     * clear that this is a real gap and an accepted one: injected CSS can restyle
     * a page or read attribute values, which is bad, but it can't execute — script
     * is where the actual account takeover lives, and script is locked down.
     */
    "style-src 'self' 'unsafe-inline'",
    // Maintenance photos come from our own route handler. data: covers the
    // base64 institution logos Plaid returns for a connected bank.
    "img-src 'self' data:",
    "font-src 'self'",
    // Plaid Link is the only third party the browser talks to. Stripe isn't here
    // because Checkout is a redirect to Stripe's own origin, not an embed.
    "connect-src 'self' https://*.plaid.com",
    "frame-src https://*.plaid.com",
    // No page in this app has any business being framed. Same intent as the
    // X-Frame-Options header in next.config.ts, which is kept for older browsers
    // that don't honour frame-ancestors.
    "frame-ancestors 'none'",
    // Blocks <base href> hijacking, which would silently repoint every relative
    // URL on the page — including form actions.
    "base-uri 'self'",
    // This app is all Server Actions; a form posting anywhere else is an attack.
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

export function middleware(request: NextRequest) {
  const nonce = crypto.randomUUID();
  const csp = policy(nonce, process.env.NODE_ENV === "development");

  // On the request so Next can read the nonce back out and stamp its own scripts.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  /*
   * Everything except Next's own build output and static files. Those are served
   * straight from the assets binding and don't execute anything, so running this
   * for each one would be pure per-request cost on every page load.
   */
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|woff2?)$).*)",
  ],
};
