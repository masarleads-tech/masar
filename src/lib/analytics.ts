/**
 * PostHog analytics (page views, clicks, sign-ups). Off until POSTHOG_KEY (or NEXT_PUBLIC_POSTHOG_KEY) is set.
 * Read on the server only, so either name works.
 * The browser sends events to /ingest on our own domain and Next forwards them to PostHog
 * (see next.config.ts), so ad blockers don't drop them.
 */
export const POSTHOG_KEY = (process.env.POSTHOG_KEY || process.env.NEXT_PUBLIC_POSTHOG_KEY)?.trim() ?? "";
/** "us" or "eu": the PostHog Cloud region picked at sign-up. */
export const POSTHOG_REGION = (process.env.POSTHOG_REGION || process.env.NEXT_PUBLIC_POSTHOG_REGION)?.trim().toLowerCase() === "eu" ? "eu" : "us";
export const analyticsEnabled = POSTHOG_KEY.startsWith("phc_");

export type Visitor = { id: string; email?: string | null; username?: string | null };

/**
 * PostHog's loader: a small stub that queues calls until /ingest/static/array.js has loaded.
 * Signed-in members are identified by their Clerk user id, so one person is one person across pages.
 */
export function posthogScript(who?: Visitor | null) {
  if (!analyticsEnabled) return "";
  const config = {
    api_host: "/ingest",
    ui_host: `https://${POSTHOG_REGION}.posthog.com`,
    person_profiles: "identified_only",
    capture_pageview: "history_change",
    capture_pageleave: true,
  };
  const props = who ? { email: who.email ?? undefined, name: who.username ?? undefined } : null;
  const identify = who ? `posthog.identify(${JSON.stringify(who.id)},${JSON.stringify(props)});` : "";
  const js =
    "!function(t,e){if(e.__SV)return;window.posthog=e;e._i=[];e.init=function(i,s,a){function g(t,e){var o=e.split(\".\");2==o.length&&(t=t[o[0]],e=o[1]);t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}" +
    "var p=t.createElement(\"script\");p.type=\"text/javascript\";p.crossOrigin=\"anonymous\";p.async=!0;p.src=s.api_host+\"/static/array.js\";var r=t.getElementsByTagName(\"script\")[0];r?r.parentNode.insertBefore(p,r):t.head.appendChild(p);" +
    "var u=e;void 0!==a?u=e[a]=[]:a=\"posthog\";u.people=u.people||[];" +
    "\"capture identify alias reset register register_once unregister setPersonProperties group getFeatureFlag isFeatureEnabled onFeatureFlags reloadFeatureFlags opt_in_capturing opt_out_capturing has_opted_out_capturing get_distinct_id startSessionRecording stopSessionRecording captureException\".split(\" \").forEach(function(n){g(u,n)});" +
    "e._i.push([i,s,a])};e.__SV=1}(document,window.posthog||[]);" +
    `posthog.init(${JSON.stringify(POSTHOG_KEY)},${JSON.stringify(config)});${identify}`;
  return js.replace(/</g, "\\u003c");
}
