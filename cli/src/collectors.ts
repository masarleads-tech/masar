import type { CollectorEnv } from "../../src/core";

/** What `masar doctor` says about the official-API collectors. Only says whether a credential is set, never its value. */
export function collectorStatus(env: CollectorEnv): { ok: boolean; text: string }[] {
  return [
    { ok: !!env.googleMapsKey, text: env.googleMapsKey ? "Google Maps (Places API): key set" : "Google Maps (Places API): no GOOGLE_MAPS_API_KEY, using OpenStreetMap and your AI's web search" },
    { ok: !!(env.instagramToken && env.instagramUserId), text: env.instagramToken && env.instagramUserId ? "Instagram (Business Discovery API): connected" : "Instagram: off (set INSTAGRAM_ACCESS_TOKEN and INSTAGRAM_BUSINESS_ACCOUNT_ID)" },
    { ok: !!env.facebookAppToken, text: env.facebookAppToken ? "Facebook (Pages search API): connected" : "Facebook: off (set FACEBOOK_APP_ACCESS_TOKEN from an app with Page Public Metadata Access)" },
    { ok: !!env.linkedinToken, text: env.linkedinToken ? "LinkedIn (Organization lookup API): connected" : "LinkedIn: off (set LINKEDIN_ACCESS_TOKEN from an app approved for the Community Management API)" },
  ];
}
