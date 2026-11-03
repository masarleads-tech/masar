export type TargetType = "business" | "individual";
export type Size = "any" | "independent" | "chain";
export type Positioning = "any" | "premium" | "mid" | "budget";
export type Channel = "phone" | "email" | "social" | "visit" | "any";
export type MustHave = "phone" | "email" | "website" | "social";

/** The client's answers to the intake questions. */
export interface Brief {
  clientName: string;
  offer: string;
  targetType: TargetType;
  industry: string;
  industryCustom: string;
  locations: string[];
  size: Size;
  positioning: Positioning;
  channel: Channel;
  mustHave: MustHave[];
  goodSignals: string[];
  exclude: string[];
  count: number;
}

export type Verdict = "pass" | "warn" | "fail" | "not_found";

export interface DecisionMaker {
  name: string;
  title: string;
  profileUrl: string | null;
}

export interface Lead {
  id: string;
  name: string;
  category: string;
  city: string;
  address: string;
  mapsUrl: string;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  website: string | null;
  rating: number | null;
  reviews: number | null;
  instagram: string | null;
  instagramFollowers: number | null;
  instagramLastPost: string | null;
  instagramVerdict: Verdict | null;
  facebook: string | null;
  facebookVerdict: Verdict | null;
  linkedin: string | null;
  decisionMakers: DecisionMaker[];
  activeLast30Days: boolean | null;
  legitimacy: "pass" | "warn" | "fail" | null;
  legitimacyReason: string;
  isChain: boolean;
  sources: string[];
  /** Set once Claude has checked this lead. */
  enriched: boolean;
  fit: number;
  fitReasons: string[];
  closing: number;
  closingReasons: string[];
  /** From the Masar CLI's documenter agent: how well the lead matches the member's need (0-100), why, how much of it was verified (0-100), and the final rank. */
  compatibility?: number;
  /** Where each detail came from (source, field, page), filled by the collectors. */
  provenance?: { source: string; field: string; url: string | null; at: string }[];
  compatibilityReason?: string;
  verified?: number;
  rank?: number;
  /** The closest lead from the member's earlier searches that they marked Won or Meeting (Pinecone lead memory). */
  lookalike?: { name: string; outcome: "won" | "meeting"; score: number };
  /** Set when the lead is saved in the database. */
  rowId?: string;
  outcome?: Outcome;
  note?: string;
}

export type Outcome = "new" | "contacted" | "meeting" | "won" | "lost";

/** One saved search, as the history list shows it. */
export interface SearchSummary {
  id: string;
  brief: Brief;
  sources: string[];
  createdAt: string;
  leadCount: number;
}

/** One agent's report from a search (see src/core/schemas.ts). */
export type { AgentReport } from "../core/schemas";

export interface DiscoverResponse {
  /** The saved search these leads belong to; null when accounts are off. */
  searchId: string | null;
  leads: Lead[];
  sourcesUsed: string[];
  warnings: string[];
  /** What each agent did: ok, partial, error, timeout, unsupported or disabled, with a reason. */
  agents?: import("../core/schemas").AgentReport[];
}

export interface EnrichResponse {
  leads: Lead[];
  usage: { inputTokens: number; outputTokens: number; webSearches: number };
  /** Leads left on the account after this batch; null when accounts are off. */
  creditsLeft: number | null;
  warnings?: string[];
  agents?: import("../core/schemas").AgentReport[];
}

/** The signed-in user's account, as /api/config returns it. */
export interface UserInfo {
  email: string | null;
  confirmed: boolean;
  credits: number;
  plan: "free" | "weekly" | "basic" | "premium";
  planUntil: string | null;
  weekStarted: string | null;
  isAdmin: boolean;
}

export interface SiteConfig {
  accountsEnabled: boolean;
  googleLogin: boolean;
  user: UserInfo | null;
  allowUserKeys: boolean;
  hasServerClaudeKey: boolean;
  hasServerGoogleKey: boolean;
  /** Starting search criteria from the member's setup tour answers. */
  defaults?: Partial<Brief>;
  /** PayPal checkout (public client id and prices), or null when PayPal is off. */
  paypal?: PaypalConfig | null;
}

export interface PaypalConfig {
  clientId: string;
  currency: string;
  live: boolean;
  plans: { plan: "basic" | "premium"; monthly: number }[];
  months: number[];
}
