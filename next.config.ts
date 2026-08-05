import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Prisma's client must not be bundled by the server compiler.
  serverExternalPackages: ["@prisma/client", "bcryptjs"],
  typedRoutes: false,
  // `pg` (via @prisma/adapter-pg) picks pg-cloudflare's real implementation
  // through a "workerd" conditional export, but Next's own build-time file
  // tracer resolves that same package using plain Node conditions and only
  // finds the empty stub — so without this, OpenNext's Cloudflare bundle step
  // fails later with "Could not resolve pg-cloudflare". This forces the
  // tracer to carry the real files along regardless of which condition it
  // resolved.
  outputFileTracingIncludes: {
    "/**": ["./node_modules/pg-cloudflare/dist/**", "./node_modules/pg-cloudflare/esm/**"],
  },
};

export default nextConfig;
