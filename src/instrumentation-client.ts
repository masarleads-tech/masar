import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "@/lib/monitoring";

/** Starts Sentry in the browser. */
Sentry.init(sentryOptions);

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
