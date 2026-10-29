import { z } from "zod";
import type { Brief, Lead } from "../lib/types";

/**
 * The shared contract between the app, the CLI, the Boss and the collectors.
 * Everything that crosses a boundary (an HTTP request, a CLI flag, an AI answer) is parsed here,
 * so bad input becomes a clear error instead of a crash further down.
 */

const list = (max: number, len = 200) => z.array(z.string().trim().max(len)).catch([]).transform((a) => a.filter(Boolean).slice(0, max));
const oneOf = <T extends string>(values: readonly [T, ...T[]], fallback: T) => z.enum(values).catch(fallback);

export const BriefSchema = z.object({
  clientName: z.string().catch("").transform((s) => s.slice(0, 120)),
  offer: z.string().catch("").transform((s) => s.slice(0, 1000)),
  targetType: oneOf(["business", "individual"], "business"),
  industry: z.string().trim().min(1).max(80).catch("cosmetics_retail"),
  industryCustom: z.string().catch("").transform((s) => s.slice(0, 200)),
  locations: list(5, 120),
  size: oneOf(["any", "independent", "chain"], "any"),
  positioning: oneOf(["any", "premium", "mid", "budget"], "any"),
  channel: oneOf(["phone", "email", "social", "visit", "any"], "phone"),
  mustHave: z.array(z.string()).catch([]).transform((a) => a.filter((m): m is Brief["mustHave"][number] => ["phone", "email", "website", "social"].includes(m))),
  goodSignals: list(10),
  exclude: list(30),
  count: z.coerce.number().catch(50).transform((n) => Math.max(5, Math.min(200, Math.round(n) || 50))),
}).partial({ clientName: true, offer: true, targetType: true, industryCustom: true, size: true, positioning: true, channel: true, mustHave: true, goodSignals: true, exclude: true, count: true })
  .transform((b): Brief => ({
    clientName: b.clientName ?? "", offer: b.offer ?? "", targetType: b.targetType ?? "business", industry: b.industry,
    industryCustom: b.industryCustom ?? "", locations: b.locations, size: b.size ?? "any", positioning: b.positioning ?? "any",
    channel: b.channel ?? "phone", mustHave: b.mustHave ?? [], goodSignals: b.goodSignals ?? [], exclude: b.exclude ?? [], count: b.count ?? 50,
  }));

/** Parses search criteria from the app, the CLI or an AI. Never throws: bad fields fall back to defaults. */
export function parseBrief(raw: unknown): Brief {
  const r = BriefSchema.safeParse(raw ?? {});
  return r.success ? r.data : BriefSchema.parse({ industry: "cosmetics_retail", locations: [] });
}

/** The collectors the Boss can send. */
export const SOURCES = ["google_web", "instagram", "facebook", "linkedin"] as const;
export type SourceId = (typeof SOURCES)[number];
export const AGENTS = ["boss", ...SOURCES, "connector", "intelligence"] as const;
export type AgentId = (typeof AGENTS)[number];

export const AGENT_LABEL: Record<AgentId, string> = {
  boss: "Boss", google_web: "Google & web", instagram: "Instagram", facebook: "Facebook", linkedin: "LinkedIn",
  connector: "Connector", intelligence: "Intelligence",
};

/** Where one detail of a lead came from. */
export const ProvenanceSchema = z.object({
  source: z.enum([...SOURCES, "places", "osm", "website", "web_search"]),
  field: z.string().max(40),
  url: z.string().max(500).nullable(),
  at: z.string().max(40),
});
export type Provenance = z.infer<typeof ProvenanceSchema>;

/**
 * How a collector run ended. "unsupported": the platform has no authorized way to do this.
 * "disabled": it could work, but the credentials it needs are not configured.
 */
export const STATUSES = ["ok", "partial", "empty", "error", "timeout", "unsupported", "disabled", "skipped"] as const;
export type CollectorStatus = (typeof STATUSES)[number];

export const AgentReportSchema = z.object({
  agent: z.enum(AGENTS),
  phase: z.enum(["discover", "enrich", "rank"]),
  status: z.enum(STATUSES),
  message: z.string(),
  found: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
});
export type AgentReport = z.infer<typeof AgentReportSchema>;

export interface ProgressEvent { agent: AgentId; phase: AgentReport["phase"]; state: "started" | "finished"; message: string; report?: AgentReport }

export const SearchOptionsSchema = z.object({
  /** Which collectors to send; default: every one that is available. */
  sources: z.array(z.enum(SOURCES)).optional(),
  /** Per-collector time limit. */
  timeoutMs: z.number().int().min(1000).max(15 * 60_000).default(240_000),
  /** Use OpenStreetMap in the Google & web collector (free, fair-use). */
  openStreetMap: z.boolean().default(false),
  /** Read each business's own website. */
  websites: z.boolean().default(true),
});
export type SearchOptions = z.infer<typeof SearchOptionsSchema>;

export const SearchRequestSchema = z.object({ brief: z.unknown().transform(parseBrief), options: SearchOptionsSchema.default({ timeoutMs: 240_000, openStreetMap: false, websites: true }) });
export type SearchRequest = { brief: Brief; options: SearchOptions };

export const UsageSchema = z.object({ inputTokens: z.number().nonnegative(), outputTokens: z.number().nonnegative(), webSearches: z.number().nonnegative() });
export type Usage = z.infer<typeof UsageSchema>;
export const emptyUsage = (): Usage => ({ inputTokens: 0, outputTokens: 0, webSearches: 0 });

/** The Boss's answer to the app and the CLI: leads plus one report per agent, even when some failed. */
export interface SearchResult { leads: Lead[]; reports: AgentReport[]; sourcesUsed: string[]; warnings: string[]; usage: Usage }

// ---------- Leads coming in from outside (the CLI, a browser) ----------

const s = (max = 500) => z.string().max(100_000).transform((v) => v.slice(0, max)).nullable().catch(null);
const n = z.number().finite().nullable().catch(null);
const verdict = z.enum(["pass", "warn", "fail", "not_found"]).nullable().catch(null);

/** Keeps only the lead fields Masar knows, with sane sizes, so a client can't store anything else. */
export const IncomingLeadSchema = z.object({
  id: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  city: z.string().max(120).catch(""),
  category: z.string().max(200).catch(""),
  address: z.string().max(500).catch(""),
  mapsUrl: z.string().max(500).catch(""),
  phone: s(60), whatsapp: s(60), email: s(200), website: s(), instagram: s(), facebook: s(), linkedin: s(),
  rating: n, reviews: n, instagramFollowers: n, instagramLastPost: s(20),
  instagramVerdict: verdict, facebookVerdict: verdict,
  legitimacy: z.enum(["pass", "warn", "fail"]).nullable().catch(null),
  legitimacyReason: z.string().max(500).catch(""),
  activeLast30Days: z.boolean().nullable().catch(null),
  isChain: z.boolean().catch(false),
  enriched: z.boolean().catch(false),
  sources: z.array(z.string().max(500)).catch([]).transform((a) => a.slice(0, 20)),
  decisionMakers: z.array(z.object({ name: z.string().min(1).max(120), title: z.string().max(160).catch(""), profileUrl: s() })).catch([]).transform((a) => a.slice(0, 5)),
  provenance: z.array(ProvenanceSchema).catch([]).transform((a) => a.slice(0, 60)),
  compatibility: z.number().min(0).max(100).optional().catch(undefined),
  compatibilityReason: z.string().max(300).optional().catch(undefined),
}).passthrough();

export function parseIncomingLead(raw: unknown): Lead | null {
  const r = IncomingLeadSchema.safeParse(raw);
  if (!r.success) return null;
  const d = r.data;
  return {
    id: d.id, name: d.name, city: d.city, category: d.category, address: d.address, mapsUrl: d.mapsUrl,
    phone: d.phone, whatsapp: d.whatsapp, email: d.email, website: d.website, rating: d.rating, reviews: d.reviews,
    instagram: d.instagram, instagramFollowers: d.instagramFollowers, instagramLastPost: d.instagramLastPost, instagramVerdict: d.instagramVerdict,
    facebook: d.facebook, facebookVerdict: d.facebookVerdict, linkedin: d.linkedin,
    decisionMakers: d.decisionMakers.map((x) => ({ name: x.name, title: x.title, profileUrl: x.profileUrl })),
    activeLast30Days: d.activeLast30Days, legitimacy: d.legitimacy, legitimacyReason: d.legitimacyReason, isChain: d.isChain,
    sources: d.sources, enriched: d.enriched, fit: 0, fitReasons: [], closing: 0, closingReasons: [],
    provenance: d.provenance, compatibility: d.compatibility, compatibilityReason: d.compatibilityReason,
  };
}
