import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Prisma's client must not be bundled by the server compiler.
  serverExternalPackages: ["@prisma/client", "bcryptjs"],
  typedRoutes: false,

  // Baseline hardening headers on every response. The Content-Security-Policy
  // is deliberately NOT here: it carries a per-request nonce, so it can't be a
  // static string. It lives in src/middleware.ts — read the comment at the top
  // of that file before touching either.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Stops a browser from ever executing an uploaded file (see the
          // maintenance-photo route) as something other than its declared
          // Content-Type, regardless of what the bytes actually look like.
          { key: "X-Content-Type-Options", value: "nosniff" },
          // No page here has any business being framed by another origin.
          { key: "X-Frame-Options", value: "DENY" },
          // Send the full URL to our own origin (useful for logs/analytics),
          // nothing at all cross-origin — leases, tenant names, and payment
          // amounts show up in plenty of URLs in this app.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
