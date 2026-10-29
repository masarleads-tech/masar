import { findIndustry } from "../../lib/industries";
import { emptyLead } from "../../lib/lead";
import { discoverPlaces } from "../../lib/places";
import type { Lead, Verdict } from "../../lib/types";
import { arr, nbool, nenum, nint, nstr, obj, str } from "../llm";
import { errMsg } from "../util";
import { searchOsm } from "./osm";
import { prov, type Collector, type CollectorContext, type LeadPatch } from "./types";
import { visitAll } from "./website";

/**
 * Agent 5, the Google & web collector.
 * Discover: Google Places API (official, needs a key), OpenStreetMap (open data, when enabled) and the
 * AI's own web search tool (Claude web search, Codex search…), which is an authorized provider.
 * Enrich: each business's own website (robots.txt respected), then the AI reads public search results
 * for contacts and for the business's social profiles. It never opens Instagram, Facebook or LinkedIn pages.
 */

const DISCOVER = obj({
  businesses: arr(obj({ name: str, category: str, address: str, phone: nstr, website: nstr, instagram_url: nstr, google_maps_url: nstr, source_url: str })),
});
type Found = { businesses: { name: string; category: string; address: string; phone: string | null; website: string | null; instagram_url: string | null; google_maps_url: string | null; source_url: string }[] };

const VERDICTS = ["pass", "warn", "fail", "not_found"];
const ENRICH = obj({
  leads: arr(obj({
    id: str, phone: nstr, whatsapp: nstr, email: nstr, website: nstr,
    instagram_url: nstr, instagram_verdict: nenum(VERDICTS), facebook_url: nstr, facebook_verdict: nenum(VERDICTS), linkedin_url: nstr,
    decision_makers: arr(obj({ name: str, title: str, profile_url: nstr })),
    active_last_30_days: nbool, legitimacy: { type: "string", enum: ["pass", "warn", "fail"] }, legitimacy_reason: str,
    instagram_followers: nint, sources: arr(str),
  })),
});
interface EnrichRow {
  id: string; phone: string | null; whatsapp: string | null; email: string | null; website: string | null;
  instagram_url: string | null; instagram_verdict: Verdict | null; facebook_url: string | null; facebook_verdict: Verdict | null;
  linkedin_url: string | null; decision_makers: { name: string; title: string; profile_url: string | null }[];
  active_last_30_days: boolean | null; legitimacy: "pass" | "warn" | "fail"; legitimacy_reason: string; instagram_followers: number | null; sources: string[];
}

function what(ctx: CollectorContext) {
  const ind = findIndustry(ctx.brief.industry);
  return [ind ? `${ind.en} (${ind.ar})` : "", ctx.brief.industryCustom].filter(Boolean).join(" / ");
}

async function webDiscover(ctx: CollectorContext, city: string, want: number): Promise<Lead[]> {
  const b = ctx.brief;
  const prompt = `Find up to ${want} real, currently operating businesses in ${city} of this type: ${what(ctx)}.
My client sells: ${b.offer || "(not given)"}. ${b.goodSignals.length ? `Prefer businesses that mention: ${b.goodSignals.join(", ")}.` : ""}
${b.exclude.length ? `Leave out: ${b.exclude.join(", ")}.` : ""}${b.size === "independent" ? " Prefer independent businesses over big chains." : b.size === "chain" ? " Prefer chains with several branches." : ""}
Search in English and Arabic. Use Google Maps listings, search results and local business directories.
List each business once, with the page you found it on (source_url) and its Google Maps link if you saw one.`;
  const out = await ctx.llm!.ask<Found>(prompt, { schema: DISCOVER, web: true, searches: Math.min(20, 4 + Math.ceil(want / 5)), city, signal: ctx.signal });
  return (out.businesses ?? []).filter((x) => x?.name).map((x, i) => {
    const l = emptyLead(`web:${city}:${i}:${x.name}`, x.name, city);
    l.category = x.category; l.address = x.address; l.phone = x.phone; l.website = x.website;
    l.instagram = x.instagram_url; l.mapsUrl = x.google_maps_url ?? ""; l.sources = [x.source_url].filter(Boolean);
    l.provenance = ["name", "address", ...(x.phone ? ["phone"] : []), ...(x.website ? ["website"] : []), ...(x.instagram_url ? ["instagram"] : [])]
      .map((f) => prov("web_search", f, x.source_url || null));
    return l;
  });
}

async function webResearch(ctx: CollectorContext, leads: Lead[]): Promise<EnrichRow[]> {
  const b = ctx.brief;
  const today = new Date().toISOString().slice(0, 10);
  const list = leads.map((l) => ({ id: l.id, name: l.name, category: l.category, city: l.city, address: l.address, phone: l.phone, website: l.website,
    known_instagram: l.instagram, known_facebook: l.facebook, known_linkedin: l.linkedin, google_maps: l.mapsUrl }));
  const prompt = `Today is ${today}. My client sells: ${b.offer || "(not given)"}
They want to reach: ${what(ctx)}.

For each business below:
1. Contacts: confirm the phone (and WhatsApp if listed), find a business email and the official website, from the business's own pages or directory listings.
2. Social profiles: from search results only, find the business's own Instagram account, Facebook page and LinkedIn company page. Give "pass" when a result clearly belongs to this business (same name and city, or the same website or phone) and looks active, "warn" when unclear or inactive, "fail" when it looks fake or closed, "not_found" when there is none. Report follower counts only if a search result shows them.
3. Decision makers: from search results only, up to 2 people (owner, founder, general manager, purchasing or marketing manager) with their public job title and profile link.
Then give an overall legitimacy (pass, warn or fail) with a one-sentence reason, and whether the business was active in the last 30 days.

Businesses (JSON):
${JSON.stringify(list, null, 1)}

Return one entry per business with the same ids.`;
  const out = await ctx.llm!.ask<{ leads: EnrichRow[] }>(prompt, { schema: ENRICH, web: true, searches: 5 * leads.length, city: leads[0]?.city, signal: ctx.signal });
  return out.leads ?? [];
}

export const googleWeb: Collector = {
  id: "google_web",
  availability(ctx) {
    const hasAny = !!ctx.env.googleMapsKey || ctx.options.openStreetMap || !!ctx.llm?.capabilities.webSearch || ctx.options.websites;
    return hasAny ? { ok: true } : { ok: false, status: "disabled", reason: "No Google Maps key, no web-search AI and OpenStreetMap is off." };
  },

  async discover(ctx) {
    const b = ctx.brief;
    const leads: Lead[] = [];
    const notes: string[] = [];
    let failures = 0, tries = 0;
    if (ctx.env.googleMapsKey) {
      tries++;
      try {
        const found = await discoverPlaces(ctx.env.googleMapsKey, b, 24, ctx.fetch, ctx.signal);
        for (const l of found) l.provenance = ["name", "address", ...(l.phone ? ["phone"] : []), ...(l.website ? ["website"] : [])].map((f) => prov("places", f, l.mapsUrl || null));
        leads.push(...found);
        ctx.log(`Google Maps: ${found.length} businesses`);
      } catch (e) { failures++; notes.push(`Google Maps: ${errMsg(e)}`); }
    }
    if (ctx.options.openStreetMap) {
      for (const city of b.locations) {
        tries++;
        try {
          const r = await searchOsm(b.industry, b.industryCustom, city, { fetch: ctx.fetch, userAgent: ctx.env.userAgent, signal: ctx.signal });
          leads.push(...r.leads);
          ctx.log(`OpenStreetMap: ${r.leads.length} businesses in ${city}`);
        } catch (e) { failures++; notes.push(`OpenStreetMap (${city}): ${errMsg(e)}`); }
      }
    }
    // Web search fills in when the maps found too few (the app's behaviour before the agents).
    if (ctx.llm?.capabilities.webSearch && leads.length < Math.min(b.count, 20)) {
      const per = Math.min(40, Math.max(10, Math.ceil((b.count * 1.2) / Math.max(1, b.locations.length))));
      for (const city of b.locations) {
        tries++;
        try {
          const found = await webDiscover(ctx, city, per);
          leads.push(...found);
          ctx.log(`Web search: ${found.length} businesses in ${city}`);
        } catch (e) { failures++; notes.push(`Web search (${city}): ${errMsg(e)}`); }
      }
    }
    if (tries && failures === tries) throw new Error(notes.join("; "));
    return { items: leads, status: failures ? "partial" : leads.length ? "ok" : "empty", message: notes.join("; ") };
  },

  async enrich(ctx, input) {
    const patches = new Map<string, LeadPatch>();
    const patch = (id: string) => patches.get(id) ?? patches.set(id, { id, fields: {}, sources: [], provenance: [] }).get(id)!;
    const notes: string[] = [];
    let leads = input;
    if (ctx.options.websites) {
      const r = await visitAll({ fetch: ctx.fetch, userAgent: ctx.env.userAgent, signal: ctx.signal }, leads);
      for (let i = 0; i < r.leads.length; i++) {
        const before = leads[i], after = r.leads[i];
        const p = patch(after.id);
        for (const k of ["phone", "whatsapp", "email", "website", "instagram", "facebook", "linkedin"] as const) {
          if (after[k] && after[k] !== before[k]) p.fields[k] = after[k];
        }
        p.sources.push(...after.sources.filter((s) => !before.sources.includes(s)));
        p.provenance.push(...(after.provenance ?? []).slice((before.provenance ?? []).length));
      }
      leads = r.leads;
    }
    if (ctx.llm?.capabilities.webSearch) {
      try {
        for (const r of await webResearch(ctx, leads)) {
          const lead = leads.find((l) => l.id === r?.id);
          if (!lead) continue;
          const p = patch(r.id);
          const src = r.sources?.[0] ?? null;
          const set = <K extends keyof LeadPatch["fields"]>(k: K, v: LeadPatch["fields"][K] | null | undefined, field = String(k)) => {
            if (v === null || v === undefined) return;
            p.fields[k] = v; p.provenance.push(prov("web_search", field, src));
          };
          set("phone", lead.phone ? undefined : r.phone);
          set("whatsapp", r.whatsapp);
          set("email", lead.email ? undefined : r.email);
          set("website", lead.website ? undefined : r.website);
          set("instagram", r.instagram_url); set("instagramVerdict", r.instagram_verdict, "instagram_check");
          set("instagramFollowers", r.instagram_followers, "instagram_followers");
          set("facebook", r.facebook_url); set("facebookVerdict", r.facebook_verdict, "facebook_check");
          set("linkedin", r.linkedin_url);
          if (r.decision_makers?.length) set("decisionMakers", r.decision_makers.slice(0, 2).map((d) => ({ name: d.name, title: d.title, profileUrl: d.profile_url })), "decision_makers");
          set("activeLast30Days", r.active_last_30_days, "active");
          p.fields.legitimacy = r.legitimacy; p.fields.legitimacyReason = r.legitimacy_reason;
          p.sources.push(...(r.sources ?? []).filter((s) => typeof s === "string"));
        }
      } catch (e) {
        if (!ctx.options.websites) throw e;
        notes.push(`Web research: ${errMsg(e)}`);
      }
    } else if (!ctx.options.websites) {
      return { items: [], status: "unsupported", message: "This AI can't search the web and website reading is off." };
    }
    return { items: [...patches.values()], status: notes.length ? "partial" : "ok", message: notes.join("; ") };
  },
};
