import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "@/lib/monitoring";

/** Starts Sentry on the server and in the middleware. */
export function register() {
  Sentry.init(sentryOptions);
}

/** Sends errors thrown while rendering pages and running API routes. */
export const onRequestError = Sentry.captureRequestError;
