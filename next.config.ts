import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The tour, dashboard and download pages are plain HTML read from src/html at request time.
  outputFileTracingIncludes: {
    "/dashboard": ["./src/html/**"],
    "/welcome": ["./src/html/**"],
    "/cli": ["./src/html/**"],
    "/cli/connect": ["./src/html/**"],
    "/home": ["./src/html/**"],
  },
};

export default nextConfig;
