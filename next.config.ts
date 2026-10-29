import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";

// PostHog Cloud region ("us" or "eu"), for the /ingest forwarding below.
const posthogRegion = (process.env.POSTHOG_REGION || process.env.NEXT_PUBLIC_POSTHOG_REGION)?.trim().toLowerCase() === "eu" ? "eu" : "us";

const nextConfig: NextConfig = {
  // Sentry's DSN and environment, built into the browser code too (see src/lib/monitoring.ts).
  env: {
    SENTRY_DSN: process.env.SENTRY_DSN?.trim() ?? "",
    SENTRY_ENVIRONMENT: process.env.SENTRY_ENVIRONMENT || process.env.VERCEL_ENV || "development",
  },
  // The tour, dashboard and download pages are plain HTML read from src/html at request time.
  outputFileTracingIncludes: {
    "/dashboard": ["./src/html/**"],
    "/welcome": ["./src/html/**"],
    "/cli": ["./src/html/**"],
    "/cli/connect": ["./src/html/**"],
    "/home": ["./src/html/**"],
  },
  // Analytics go to /ingest on our own domain and are forwarded to PostHog, so ad blockers don't drop them.
  async rewrites() {
    return [
      { source: "/ingest/static/:path*", destination: `https://${posthogRegion}-assets.i.posthog.com/static/:path*` },
      { source: "/ingest/:path*", destination: `https://${posthogRegion}.i.posthog.com/:path*` },
    ];
  },
  // PostHog's API paths end in a slash; keep them as they are.
  skipTrailingSlashRedirect: true,
};

// Sentry: readable error locations (source maps) are uploaded at build time when SENTRY_AUTH_TOKEN,
// SENTRY_ORG and SENTRY_PROJECT are set; without them the build still works.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  // Browser errors go to /monitoring on our own domain and are forwarded to Sentry.
  tunnelRoute: "/monitoring",
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
});
