import type { Brief, Lead } from "../../lib/types";
import type { LlmConnector } from "../llm";
import type { CollectorStatus, Provenance, SearchOptions, SourceId } from "../schemas";

/**
 * Credentials and settings the collectors may use. Read from the environment on the server or the
 * member's computer; never sent to the browser and never logged.
 */
export interface CollectorEnv {
  /** Google Places API (New) key. */
  googleMapsKey?: string;
  /** Meta Graph API version, e.g. "v26.0". */
  graphVersion?: string;
  /** Instagram user access token of the Instagram professional account that runs Business Discovery. */
  instagramToken?: string;
  /** That account's Instagram user id. */
  instagramUserId?: string;
  /** Meta app access token whose app has the Page Public Metadata Access feature (for Page search). */
  facebookAppToken?: string;
  /** LinkedIn 3-legged OAuth token from an app approved for the Community Management API. */
  linkedinToken?: string;
  /** LinkedIn-Version header, YYYYMM. */
  linkedinVersion?: string;
  /** Sent on every request we make ourselves (websites, OpenStreetMap). */
  userAgent: string;
}

export function envFromProcess(env: Record<string, string | undefined>, userAgent: string): CollectorEnv {
  const v = (k: string) => env[k]?.trim() || undefined;
  return {
    googleMapsKey: v("GOOGLE_MAPS_API_KEY"),
    graphVersion: v("META_GRAPH_VERSION") ?? "v26.0",
    instagramToken: v("INSTAGRAM_ACCESS_TOKEN"),
    instagramUserId: v("INSTAGRAM_BUSINESS_ACCOUNT_ID"),
    facebookAppToken: v("FACEBOOK_APP_ACCESS_TOKEN"),
    linkedinToken: v("LINKEDIN_ACCESS_TOKEN"),
    linkedinVersion: v("LINKEDIN_API_VERSION") ?? "202510",
    userAgent,
  };
}

export interface CollectorContext {
  brief: Brief;
  options: SearchOptions;
  /** The AI, when one is available. Collectors must work (or say why not) without it. */
  llm: LlmConnector | null;
  env: CollectorEnv;
  /** Injected so tests never reach the network. */
  fetch: typeof fetch;
  signal: AbortSignal;
  log: (message: string) => void;
}

/** A collector's findings for one existing lead: only the fields it is responsible for. */
export interface LeadPatch {
  id: string;
  fields: Partial<Pick<Lead, "phone" | "whatsapp" | "email" | "website" | "instagram" | "instagramFollowers" | "instagramLastPost"
    | "instagramVerdict" | "facebook" | "facebookVerdict" | "linkedin" | "decisionMakers" | "activeLast30Days" | "legitimacy" | "legitimacyReason">>;
  sources: string[];
  provenance: NonNullable<Lead["provenance"]>;
}

export interface CollectorOutput<T> {
  items: T[];
  /** Set when only part of the work succeeded (one city failed, a rate limit stopped it early…). */
  status?: Extract<CollectorStatus, "ok" | "partial" | "empty" | "unsupported">;
  message?: string;
}

export type Availability = { ok: true } | { ok: false; status: "disabled" | "unsupported"; reason: string };

export interface Collector {
  id: SourceId;
  /** Checked before any call: missing credentials → disabled; no authorized API → unsupported. */
  availability(ctx: CollectorContext, phase: "discover" | "enrich"): Availability;
  /** Find new businesses. Absent when the platform offers no authorized search. */
  discover?(ctx: CollectorContext): Promise<CollectorOutput<Lead>>;
  /** Check and complete leads other collectors found. */
  enrich?(ctx: CollectorContext, leads: Lead[]): Promise<CollectorOutput<LeadPatch>>;
}

export const prov = (source: Provenance["source"], field: string, url: string | null): Provenance =>
  ({ source, field, url, at: new Date().toISOString() });

export class ProviderError extends Error {
  constructor(message: string, public kind: "auth" | "permission" | "rate_limit" | "not_found" | "other") { super(message); }
}
