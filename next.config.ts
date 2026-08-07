import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Prisma's client must not be bundled by the server compiler.
  serverExternalPackages: ["@prisma/client", "bcryptjs"],
  typedRoutes: false,

  // Baseline hardening headers on every response. No CSP here on purpose —
  // this app has no third-party scripts today, but a CSP tight enough to be
  // worth anything needs to be built against real script/style/connect
  // sources and verified against every page, not guessed at in passing.
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
