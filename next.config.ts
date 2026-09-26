import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // @libsql/client + drizzle-orm are ESM/CJS dual packages; keep them external-free for serverless bundling.
  serverExternalPackages: ["@libsql/client"],
  // Pin the workspace root to this repository. Without it Next infers the root
  // from whatever lockfile it finds first, which can silently break output
  // tracing on a machine that has a stray lockfile higher up.
  outputFileTracingRoot: fileURLToPath(new URL(".", import.meta.url)),
  experimental: {
    // Keep the serverless footprint predictable.
    optimizePackageImports: ["zod"],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
