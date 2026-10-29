import type { SupabaseClient } from "@supabase/supabase-js";
import { isExcluded, markChains, normName, passesMustHave, rescore } from "../lib/lead";
import type { Brief, Lead } from "../lib/types";
import type { LeadPatch } from "./collectors/types";
import { domain } from "./collectors/meta";
import { arr, int, obj, str, type LlmConnector } from "./llm";

/**
 * Agent 7, the Intelligence agent: merges what the collectors found, scores and ranks it, and writes it
 * to Supabase. The app and the CLI both save through here, so the database stays consistent.
 * Rank = 40% fit (lead.ts) + 30% compatibility with the member's need + 30% verified information.
 */

// ---------- Deduplication ----------

const SOCIAL = /(^|\.)(instagram|facebook|linkedin|tiktok|twitter|x|linktr|wa)\.(com|me|ee)$/;
export function dedupeKeys(l: Lead): string[] {
  const keys: string[] = [];
  const digits = (l.phone ?? l.whatsapp ?? "").replace(/\D/g, "");
  if (digits.length >= 8) keys.push(`p:${digits.slice(-9)}`);
  const d = domain(l.website);
  if (d && !SOCIAL.test(d)) keys.push(`w:${d}`);
  const n = normName(l.name);
  if (n) keys.push(`n:${n}|${normName(l.city)}`);
  return keys;
}

/** Fills empty fields of `a` from `b` and joins their sources and provenance. `a` wins where both have a value. */
export function mergeLeads(a: Lead, b: Lead): Lead {
  const out: Lead = { ...a };
  for (const k of Object.keys(b) as (keyof Lead)[]) {
    const av = out[k], bv = b[k];
    const empty = av === null || av === undefined || av === "" || (Array.isArray(av) && av.length === 0);
    if (empty && bv !== null && bv !== undefined && bv !== "") (out as unknown as Record<string, unknown>)[k] = bv;
  }
  out.rating = Math.max(a.rating ?? 0, b.rating ?? 0) || null;
  out.reviews = Math.max(a.reviews ?? 0, b.reviews ?? 0) || null;
  out.sources = [...new Set([...a.sources, ...b.sources])].slice(0, 20);
  out.provenance = [...(a.provenance ?? []), ...(b.provenance ?? [])].slice(0, 60);
  return out;
}

/** One row per business: matched by phone, website domain, or name in the same city. Earlier leads win. */
export function dedupe(leads: Lead[]): Lead[] {
  const out: Lead[] = [];
  const index = new Map<string, number>();
  for (const l of leads) {
    const keys = dedupeKeys(l);
    const hit = keys.map((k) => index.get(k)).find((i) => i !== undefined);
    if (hit === undefined) {
      out.push(l);
      for (const k of keys) index.set(k, out.length - 1);
    } else {
      out[hit] = mergeLeads(out[hit], l);
      for (const k of dedupeKeys(out[hit])) if (!index.has(k)) index.set(k, hit);
    }
  }
  return out;
}

/** Applies collector findings in order: later patches (official APIs) overwrite earlier ones (web search). */
export function applyPatches(leads: Lead[], patches: LeadPatch[]): Lead[] {
  const byId = new Map(leads.map((l) => [l.id, { ...l, provenance: [...(l.provenance ?? [])] }]));
  for (const p of patches) {
    const l = byId.get(p.id);
    if (!l) continue;
    for (const [k, v] of Object.entries(p.fields)) if (v !== undefined) (l as unknown as Record<string, unknown>)[k] = v;
    l.sources = [...new Set([...l.sources, ...p.sources])].slice(0, 20);
    l.provenance = [...l.provenance, ...p.provenance].slice(-60);
  }
  return leads.map((l) => byId.get(l.id)!);
}

/** Candidates in the order worth checking: excluded ones out, chains marked, best fit first. */
export function prepare(brief: Brief, leads: Lead[]): Lead[] {
  return markChains(dedupe(leads)).filter((l) => !isExcluded(l, brief.exclude)).map((l) => rescore(l, brief)).sort((a, b) => b.fit - a.fit);
}

// ---------- Scoring ----------

/** How much of the lead a real source confirmed, 0-100, with the reasons. Official-API checks count most. */
export function verification(l: Lead): { score: number; reasons: string[] } {
  const by = (src: string) => (l.provenance ?? []).some((p) => p.source === src);
  let s = 0;
  const why: string[] = [];
  const add = (n: number, r: string) => { s += n; why.push(r); };
  if (by("places")) add(15, "on Google Maps"); else if (by("osm")) add(10, "on the map");
  if (by("website")) add(15, "website works");
  if (l.phone || l.whatsapp) add(15, "phone");
  if (l.email) add(10, "email");
  if (l.instagramVerdict === "pass") add(by("instagram") ? 15 : 10, by("instagram") ? "Instagram (official API)" : "Instagram");
  else if (l.instagramVerdict === "warn") add(4, "Instagram unclear");
  if (l.facebookVerdict === "pass") add(by("facebook") ? 10 : 7, by("facebook") ? "Facebook (official API)" : "Facebook");
  if ((l.provenance ?? []).some((p) => p.field === "linkedin_verified")) add(10, "LinkedIn (official API)");
  else if (l.linkedin) add(5, "LinkedIn page");
  if (l.decisionMakers.length) add(10, "decision maker named");
  return { score: Math.min(100, s), reasons: why };
}

const COMPAT = obj({ results: arr(obj({ id: str, compatibility: int, reason: str })) });

/** Asks the AI how well each lead fits the member's need (0-100), 15 at a time. */
export async function compatibility(llm: LlmConnector, brief: Brief, leads: Lead[], signal?: AbortSignal) {
  const out = new Map<string, { compatibility: number; reason: string }>();
  for (let i = 0; i < leads.length; i += 15) {
    const rows = leads.slice(i, i + 15).map((l) => ({ id: l.id, name: l.name, category: l.category, city: l.city, chain: l.isChain,
      instagram_followers: l.instagramFollowers, decision_makers: l.decisionMakers.map((d) => d.title) }));
    const prompt = `Rate how compatible each business is with what my client needs, from 0 (wrong fit) to 100 (ideal buyer).
My client sells: ${brief.offer || "(not given)"}
They want: ${brief.industryCustom || brief.industry.replace(/_/g, " ")} in ${brief.locations.join(", ")}; size: ${brief.size}; positioning: ${brief.positioning}.
${brief.goodSignals.length ? `Good signs: ${brief.goodSignals.join(", ")}.` : ""}${brief.exclude.length ? ` Avoid: ${brief.exclude.join(", ")}.` : ""}
Judge only from the facts given. "reason": under 15 words, in the language of the client's offer.
Businesses (JSON):
${JSON.stringify(rows, null, 1)}`;
    const r = await llm.ask<{ results: { id: string; compatibility: number; reason: string }[] }>(prompt, { schema: COMPAT, signal });
    for (const x of r.results ?? []) if (x?.id) out.set(x.id, { compatibility: x.compatibility, reason: x.reason });
  }
  return out;
}

/** Final scores and order. Without compatibility answers, fit stands in for compatibility. */
export function rank(brief: Brief, leads: Lead[], compat = new Map<string, { compatibility: number; reason: string }>()): Lead[] {
  return leads.map((raw) => {
    const l = rescore(raw, brief);
    const v = verification(l);
    const c = compat.get(l.id);
    const compatibilityScore = Math.max(0, Math.min(100, Math.round(c?.compatibility ?? l.compatibility ?? l.fit)));
    const legitimacy = l.legitimacy ?? (l.instagramVerdict === "fail" || l.facebookVerdict === "fail" ? "fail" : v.score >= 45 ? "pass" : "warn");
    const score = 0.4 * l.fit + 0.3 * compatibilityScore + 0.3 * v.score - (passesMustHave(l, brief.mustHave) ? 0 : 25) - (legitimacy === "fail" ? 30 : 0);
    return {
      ...l, verified: v.score, compatibility: compatibilityScore, compatibilityReason: c?.reason ?? l.compatibilityReason ?? "",
      legitimacy, legitimacyReason: l.legitimacyReason || `Verified: ${v.reasons.join(", ") || "nothing yet"}`,
      rank: Math.max(0, Math.round(score)),
    };
  }).sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0) || b.closing - a.closing);
}

// ---------- Categories ----------

const slug = (s: string) => s.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_|_$/g, "").slice(0, 60);
/** The category a lead is filed under: the industry the member searched for (or their own words), and the business's own type. */
export function categoryOf(brief: Brief, lead: Lead) {
  const category = brief.industry && brief.industry !== "custom" ? brief.industry : `custom:${slug(brief.industryCustom) || "other"}`;
  return { category, businessType: slug(lead.category) || null };
}
export const sourceIds = (l: Lead) => [...new Set((l.provenance ?? []).map((p) => p.source))];

// ---------- Database (Supabase) ----------

/** Starts a saved search. Returns its id. */
export async function createSearch(db: SupabaseClient, userId: string, brief: Brief, sources: string[]): Promise<string> {
  const { data, error } = await db.from("searches").insert({ user_id: userId, brief, sources }).select("id").single();
  if (error) throw new Error(`Could not save this search: ${error.message}`);
  return data.id as string;
}

/** Every business any collector found for this search, filed by category, city and source (stage "found"). */
export async function saveCollected(db: SupabaseClient, userId: string, searchId: string, brief: Brief, leads: Lead[]) {
  if (!leads.length) return;
  const rows = leads.slice(0, 1000).map((l) => {
    const c = categoryOf(brief, l);
    return { user_id: userId, search_id: searchId, lead_key: l.id, name: l.name.slice(0, 200), category: c.category, business_type: c.businessType,
      city: l.city.slice(0, 120), sources: sourceIds(l), data: l, stage: "found", updated_at: new Date().toISOString() };
  });
  const { error } = await db.from("collected_leads").upsert(rows, { onConflict: "search_id,lead_key" });
  if (error) throw new Error(`Could not save the collected businesses: ${error.message}`);
}

/**
 * Saves checked leads to the member's list (the leads table the dashboard reads), and marks them
 * checked in collected_leads. Returns the saved rows' ids and outcomes by lead id.
 */
export async function saveLeads(db: SupabaseClient, userId: string, searchId: string, brief: Brief, leads: Lead[]) {
  if (!leads.length) return new Map<string, { id: string; outcome: string; note: string }>();
  const now = new Date().toISOString();
  const rows = leads.map((l) => {
    const c = categoryOf(brief, l);
    return { search_id: searchId, user_id: userId, lead_key: l.id, data: l, closing: l.closing, fit: l.fit,
      category: c.category, city: l.city.slice(0, 120), sources: sourceIds(l), updated_at: now };
  });
  const { data, error } = await db.from("leads").upsert(rows, { onConflict: "search_id,lead_key" }).select("id, lead_key, outcome, note");
  if (error) throw new Error(`Could not save the leads: ${error.message}`);
  await saveCollected(db, userId, searchId, brief, leads).catch(() => {});
  await db.from("collected_leads").update({ stage: "checked", updated_at: now }).eq("search_id", searchId).in("lead_key", leads.map((l) => l.id));
  return new Map((data ?? []).map((r) => [r.lead_key as string, { id: r.id as string, outcome: r.outcome as string, note: r.note as string }]));
}
