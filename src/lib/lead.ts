import type { Brief, Lead } from "./types";
import { findIndustry } from "./industries";

export function emptyLead(id: string, name: string, city: string): Lead {
  return {
    id, name, city, category: "", address: "", mapsUrl: "", phone: null, whatsapp: null, email: null,
    website: null, rating: null, reviews: null, instagram: null, instagramFollowers: null,
    instagramLastPost: null, instagramVerdict: null, facebook: null, facebookVerdict: null, linkedin: null,
    decisionMakers: [], activeLast30Days: null, legitimacy: null, legitimacyReason: "", isChain: false,
    sources: [], enriched: false, fit: 0, fitReasons: [], closing: 0, closingReasons: [],
  };
}

const PREMIUM = ["luxury", "premium", "exclusive", "boutique", "royal", "فاخر", "فخم", "راقي", "حصري"];
const BUDGET = ["wholesale", "discount", "outlet", "offers", "جملة", "تخفيضات", "عروض", "خصم"];

export function normName(name: string): string {
  return name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\b(branch|store|shop|فرع|محل)\b/g, " ").replace(/\s+/g, " ").trim();
}

function words(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []).filter(
    (w) => !["with", "from", "that", "this", "your", "sell", "products", "minimum", "order", "units"].includes(w),
  );
}

/** Fit %: category 30, relevance 20, reachability 25, online presence 10, profile 15. */
export function scoreFit(lead: Lead, brief: Brief): { fit: number; reasons: string[] } {
  const reasons: string[] = [];
  const ind = findIndustry(brief.industry);
  const kw = [...(ind?.keywords ?? []), ...brief.industryCustom.split(/[,،]/).map((s) => s.trim().toLowerCase()).filter(Boolean)];
  const hay = `${lead.name} ${lead.category} ${lead.website ?? ""} ${lead.instagram ?? ""}`.toLowerCase();

  const catHit = kw.find((k) => hay.includes(k.toLowerCase()));
  const category = catHit ? 30 : 18;
  if (catHit) reasons.push(`Matches "${catHit}"`);

  const good = brief.goodSignals.filter((w) => hay.includes(w.toLowerCase()));
  const offerHits = [...new Set(words(brief.offer).filter((w) => hay.includes(w)))];
  const relevance = Math.min(20, 7 * good.length + 3 * offerHits.length + (catHit ? 6 : 0));
  if (good.length) reasons.push(`Mentions ${good.slice(0, 3).join(", ")}`);

  const hasPhone = !!(lead.phone || lead.whatsapp);
  const hasEmail = !!lead.email;
  const hasSocial = !!(lead.instagram || lead.facebook);
  const byChannel: Record<Brief["channel"], number> = {
    phone: 15 * +hasPhone + 4 * +!!lead.whatsapp + 3 * +hasEmail + 3 * +hasSocial,
    email: 16 * +hasEmail + 5 * +hasPhone + 4 * +hasSocial,
    social: 16 * +hasSocial + 5 * +hasPhone + 4 * +hasEmail,
    visit: 12 * +!!lead.address + 8 * +hasPhone + 5 * +(hasEmail || hasSocial),
    any: 9 * +hasPhone + 8 * +hasEmail + 6 * +hasSocial + 2 * +!!lead.address,
  };
  const reach = Math.min(25, byChannel[brief.channel]);
  const bits = [hasPhone && "phone", lead.whatsapp && "WhatsApp", hasEmail && "email", hasSocial && "social media"].filter(Boolean);
  reasons.push(bits.length ? `Reachable by ${bits.join(", ")}` : "No public contact yet");

  let online = 4 * +!!lead.website + 3 * +!!lead.instagram + 1 * +!!lead.facebook + 2 * +!!lead.linkedin;
  if ((lead.rating ?? 0) >= 4 && (lead.reviews ?? 0) >= 20) {
    online += 3;
    reasons.push(`Rated ${lead.rating} from ${lead.reviews} reviews`);
  }
  online = Math.min(10, online);

  const size = brief.size === "any" ? 7 : (brief.size === "chain") === lead.isChain ? 10 : 2;
  if (lead.isChain) reasons.push("Chain with several branches");
  const prem = PREMIUM.some((w) => hay.includes(w));
  const budg = BUDGET.some((w) => hay.includes(w));
  const pos = brief.positioning === "any" ? 3 : brief.positioning === "premium" ? (prem ? 5 : budg ? 0 : 2)
    : brief.positioning === "budget" ? (budg ? 5 : prem ? 0 : 2) : 4;

  const fit = Math.round(Math.max(0, Math.min(100, category + relevance + reach + online + size + pos)));
  return { fit, reasons };
}

/** Closing %: a starting estimate, to be tuned from real won/lost results. */
export function scoreClosing(lead: Lead): { closing: number; reasons: string[] } {
  let c = 0.5 * lead.fit;
  const reasons: string[] = [];
  if (lead.decisionMakers.length) { c += 15; reasons.push("Decision maker named"); }
  if (lead.activeLast30Days) { c += 10; reasons.push("Active in the last 30 days"); }
  if (lead.phone || lead.whatsapp) { c += 10; reasons.push("Direct phone or WhatsApp"); }
  if ((lead.rating ?? 0) >= 4 && (lead.reviews ?? 0) >= 20) { c += 5; reasons.push("Well reviewed"); }
  if (lead.legitimacy === "fail") { c -= 20; reasons.push("Failed the legitimacy check"); }
  return { closing: Math.round(Math.max(0, Math.min(90, c))), reasons };
}

export function rescore(lead: Lead, brief: Brief): Lead {
  const { fit, reasons } = scoreFit(lead, brief);
  const next = { ...lead, fit, fitReasons: reasons };
  const cl = scoreClosing(next);
  return { ...next, closing: cl.closing, closingReasons: cl.reasons };
}

export function markChains(leads: Lead[]): Lead[] {
  const counts = new Map<string, number>();
  for (const l of leads) counts.set(normName(l.name), (counts.get(normName(l.name)) ?? 0) + 1);
  return leads.map((l) => ({ ...l, isChain: (counts.get(normName(l.name)) ?? 0) >= 2 }));
}

export function isExcluded(lead: Lead, words: string[]): boolean {
  const hay = `${lead.name} ${lead.website ?? ""}`.toLowerCase();
  return words.some((w) => w.trim() && hay.includes(w.trim().toLowerCase()));
}

export function passesMustHave(lead: Lead, mustHave: Brief["mustHave"]): boolean {
  const checks = {
    phone: !!(lead.phone || lead.whatsapp),
    email: !!lead.email,
    website: !!lead.website,
    social: !!(lead.instagram || lead.facebook || lead.linkedin),
  };
  return mustHave.every((m) => checks[m]);
}

/** One row per business: the same name in the same city is merged. */
export function dedupe(leads: Lead[]): Lead[] {
  const seen = new Map<string, Lead>();
  for (const l of leads) {
    const key = l.phone ? `p:${l.phone.replace(/\D/g, "").slice(-9)}` : `n:${normName(l.name)}|${l.address}`;
    if (!seen.has(key)) seen.set(key, l);
  }
  return [...seen.values()];
}
