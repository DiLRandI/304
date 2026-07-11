import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const configDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(configDirectory, "../..");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), geolocation=(), microphone=()",
  },
];

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: workspaceRoot,
  poweredByHeader: false,
  reactStrictMode: true,
  turbopack: {
    root: workspaceRoot,
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
