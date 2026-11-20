import type { NextConfig } from "next";
import { existsSync } from "node:fs";
import path from "node:path";

// Load the repository-root .env for `next dev/build/start` (apps/web/.env* still works too).
const rootEnv = path.join(import.meta.dirname, "../../.env");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  {
    key: "Content-Security-Policy",
    // Next.js injects inline bootstrap scripts; no third-party origins are allowed.
    value: [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self' https://us.posthog.com https://eu.posthog.com",
      "object-src 'none'",
    ].join("; "),
  },
  ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
];

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  transpilePackages: ["@hostpog/contracts", "@hostpog/analytics", "@hostpog/db", "@hostpog/native", "@hostpog/posthog", "@hostpog/ai"],
  serverExternalPackages: ["@clickhouse/client", "postgres", "ioredis", "undici"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default config;
