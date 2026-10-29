import type { NextConfig } from "next";

// PostHog Cloud region ("us" or "eu"), for the /ingest forwarding below.
const posthogRegion = (process.env.POSTHOG_REGION || process.env.NEXT_PUBLIC_POSTHOG_REGION)?.trim().toLowerCase() === "eu" ? "eu" : "us";

const nextConfig: NextConfig = {
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

export default nextConfig;
