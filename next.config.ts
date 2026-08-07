import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Prisma's client must not be bundled by the server compiler.
  serverExternalPackages: ["@prisma/client", "bcryptjs"],
  typedRoutes: false,
};

export default nextConfig;
