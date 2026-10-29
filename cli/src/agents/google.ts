import { findIndustry } from "../../../src/lib/industries";
import { emptyLead } from "../../../src/lib/lead";
import type { Brief, Lead } from "../../../src/lib/types";
import type { AI } from "../ai/base";
import { searchOsm } from "./osm";
import { arr, nstr, obj, str } from "./schema";

/**
 * Google agent: finds candidate businesses. It always reads OpenStreetMap (free and open), and when the
 * AI can search the web it also looks through Google Maps listings, Google results and local directories
 * through the AI's own search tool. It does not scrape Google pages directly.
 */
const SCHEMA = obj({
  businesses: arr(obj({
    name: str, category: str, address: str, phone: nstr, website: nstr, instagram_url: nstr,
    google_maps_url: nstr, source_url: str,
  })),
});

type Found = { businesses: { name: string; category: string; address: string; phone: string | null; website: string | null;
  instagram_url: string | null; google_maps_url: string | null; source_url: string }[] };

export async function webDiscover(ai: AI, brief: Brief, city: string, want: number, queries: string[]): Promise<Lead[]> {
  const ind = findIndustry(brief.industry);
  const what = [ind ? `${ind.en} (${ind.ar})` : "", brief.industryCustom].filter(Boolean).join(" / ");
  const prompt = `Find up to ${want} real, currently operating businesses in ${city} of this type: ${what}.
My client sells: ${brief.offer || "(not given)"}. ${brief.goodSignals.length ? `Prefer businesses that mention: ${brief.goodSignals.join(", ")}.` : ""}
${brief.exclude.length ? `Leave out: ${brief.exclude.join(", ")}.` : ""}
${brief.size === "independent" ? "Prefer independent businesses over big chains." : brief.size === "chain" ? "Prefer chains with several branches." : ""}
Search in English and Arabic. Use Google Maps listings, Google search results, local business directories and Instagram results.${queries.length ? `\nUseful searches: ${queries.slice(0, 6).join(" | ")}` : ""}
List each business once, with the page you found it on (source_url) and its Google Maps link if you saw one.`;
  const out = await ai.ask<Found>(prompt, { schema: SCHEMA, web: true, searches: Math.min(20, 4 + Math.ceil(want / 5)), city });
  return (out.businesses ?? []).map((b, i) => {
    const l = emptyLead(`web:${city}:${i}:${b.name}`, b.name, city);
    l.category = b.category; l.address = b.address; l.phone = b.phone; l.website = b.website;
    l.instagram = b.instagram_url; l.mapsUrl = b.google_maps_url ?? ""; l.sources = [b.source_url].filter(Boolean);
    return l;
  });
}

export async function discover(ai: AI, brief: Brief, opts: { useWeb: boolean; queries: string[]; log: (s: string) => void }) {
  const leads: Lead[] = [];
  const sources = new Set<string>();
  for (const city of brief.locations) {
    try {
      const r = await searchOsm(brief.industry, brief.industryCustom, city);
      leads.push(...r.leads);
      if (r.leads.length) sources.add("OpenStreetMap");
      opts.log(`${r.leads.length} businesses on the map in ${city}`);
    } catch (e) {
      opts.log(`Map search in ${city} failed: ${e instanceof Error ? e.message : e}`);
    }
    if (opts.useWeb) {
      try {
        const per = Math.min(40, Math.max(10, Math.ceil((brief.count * 1.5) / brief.locations.length)));
        const found = await webDiscover(ai, brief, city, per, opts.queries);
        leads.push(...found);
        if (found.length) sources.add("Web search");
        opts.log(`${found.length} more from Google Maps and web results in ${city}`);
      } catch (e) {
        opts.log(`Web search in ${city} failed: ${e instanceof Error ? e.message : e}`);
      }
    }
  }
  return { leads, sources: [...sources] };
}
