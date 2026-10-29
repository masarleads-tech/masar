/**
 * Sentry error tracking. Off until SENTRY_DSN is set.
 * next.config.ts copies SENTRY_DSN into the browser code at build time, so no NEXT_PUBLIC_ name is needed
 * (the DSN only lets the site send errors in; it can't read anything). Errors from the browser go to /monitoring
 * on our own domain and are forwarded to Sentry, so ad blockers don't drop them.
 */
export const SENTRY_DSN = process.env.SENTRY_DSN?.trim() ?? "";
export const monitoringEnabled = /^https:\/\/.+@.+/.test(SENTRY_DSN);

/** Settings shared by the browser, the server and the edge middleware. */
export const sentryOptions = {
  dsn: SENTRY_DSN,
  enabled: monitoringEnabled,
  // "production" or "preview" on Vercel, so test deploys don't mix with the live site.
  environment: process.env.SENTRY_ENVIRONMENT || "development",
  // Time 10% of page loads and API calls; every error is still sent.
  tracesSampleRate: 0.1,
  // No IP addresses, cookies or request bodies.
  sendDefaultPii: false,
};
