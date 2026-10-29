import type { Brief } from "../lib/types";
import { parseBrief } from "./schemas";

/**
 * The setup tour's answers (user_setup) turned into starting search criteria, so the search form and
 * the CLI's Boss start from what the member already told Masar.
 */
const SETUP_INDUSTRY: Record<string, { industry: string; custom?: string }> = {
  "Restaurants & cafés": { industry: "restaurants" },
  Clinics: { industry: "clinics" },
  "Real estate": { industry: "real_estate" },
  Contracting: { industry: "hardware_construction" },
  Retail: { industry: "custom", custom: "Retail stores" },
  "Business services": { industry: "offices_companies" },
  "Education & training": { industry: "schools" },
  "Hotels & tourism": { industry: "hotels" },
  "Salons & beauty": { industry: "beauty_salons" },
  Logistics: { industry: "custom", custom: "Logistics and shipping companies" },
};

export interface SetupAnswers { industries?: string[] | null; cities?: string[] | null; ideal_customer?: string | null; leads_per_week?: number | null }

export function briefFromSetup(s: SetupAnswers | null | undefined): Partial<Brief> {
  if (!s) return {};
  const first = (s.industries ?? []).map((x) => SETUP_INDUSTRY[x]).find(Boolean);
  const out: Partial<Brief> = {};
  if (first) { out.industry = first.industry; if (first.custom) out.industryCustom = first.custom; }
  if (s.cities?.length) out.locations = s.cities.slice(0, 5);
  if (s.leads_per_week) out.count = parseBrief({ industry: "x", locations: [], count: s.leads_per_week }).count;
  return out;
}

/** What the setup says in words, for the Boss's interview. */
export function describeSetup(s: SetupAnswers | null | undefined): string {
  if (!s) return "The member has no saved setup.";
  return `From the member's Masar setup: industries they target: ${(s.industries ?? []).join(", ") || "not set"}; ideal customer: ${s.ideal_customer || "not set"}; cities: ${(s.cities ?? []).join(", ") || "not set"}; leads per week goal: ${s.leads_per_week ?? "not set"}.`;
}
