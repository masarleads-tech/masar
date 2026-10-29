import { findIndustry } from "../../../src/lib/industries";
import { emptyLead } from "../../../src/lib/lead";
import type { Lead } from "../../../src/lib/types";
import { VERSION } from "../version";

/**
 * OpenStreetMap: free, live, open data (ODbL), no key. Nominatim turns a city into an area,
 * Overpass returns the named businesses in it that match the industry's tags or keywords.
 * Both are public services with fair-use limits, so requests are spaced out and identified.
 */
const UA = { "user-agent": `masar-cli/${VERSION} (+https://masar-umber-two.vercel.app/cli)` };
const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
const NAME_KEYS = ["shop", "amenity", "office", "craft", "leisure", "healthcare", "tourism"];

let lastNominatim = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Area { name: string; areaId: number | null; around: [number, number, number] | null; bbox: [number, number, number, number] }

async function geocode(place: string): Promise<Area> {
  const get = async (extra: Record<string, string>) => {
    const wait = 1100 - (Date.now() - lastNominatim);
    if (wait > 0) await sleep(wait);
    lastNominatim = Date.now();
    const q = new URLSearchParams({ q: place, format: "jsonv2", limit: "5", "accept-language": "en", ...extra });
    const r = await fetch(`${NOMINATIM}?${q}`, { headers: UA, signal: AbortSignal.timeout(30_000) });
    return r.ok ? ((await r.json()) as Record<string, string>[]) : [];
  };
  let results = await get({ featureType: "city" });
  if (!results.length) results = await get({});
  if (!results.length) throw new Error(`Could not find "${place}" on the map`);
  const big = new Set(["state", "region", "province", "country"]);
  const usable = results.filter((r) => !big.has(r.addresstype)).length ? results.filter((r) => !big.has(r.addresstype)) : results;
  const best = usable.find((r) => r.osm_type === "relation") ?? usable[0];
  const [s, n, w, e] = (best.boundingbox as unknown as string[]).map(Number);
  const id = Number(best.osm_id);
  return {
    name: best.display_name ?? place,
    areaId: best.osm_type === "relation" ? 3600000000 + id : best.osm_type === "way" ? 2400000000 + id : null,
    around: best.osm_type === "node" ? [20000, Number(best.lat), Number(best.lon)] : null,
    bbox: [s, w, n, e],
  };
}

const esc = (w: string) => w.replace(/[\\.^$|?*+()[\]{}"]/g, "\\$&");

function buildQuery(area: Area, filters: [string, string][], keywords: string[], limit: number) {
  const head = area.areaId ? `area(id:${area.areaId})->.a;` : "";
  const scope = area.areaId ? "(area.a)" : area.around ? `(around:${area.around.join(",")})` : `(${area.bbox.join(",")})`;
  const parts = filters.map(([k, v]) => `nwr["${k}"~"^(${v})$"]${scope};`);
  if (keywords.length) {
    const rx = keywords.map(esc).join("|");
    for (const k of NAME_KEYS) parts.push(`nwr["${k}"]["name"~"${rx}",i]${scope};`);
  }
  return `[out:json][timeout:120];${head}(${parts.join("")});out center tags ${limit};`;
}

const split = (v?: string) => (v ?? "").split(/[;,]/).map((s) => s.trim()).filter(Boolean);
function social(kind: string, value?: string) {
  if (!value) return null;
  const v = value.trim();
  if (/^https?:/.test(v)) return v;
  const handle = v.replace(/^@/, "");
  return ({ instagram: "https://www.instagram.com/", facebook: "https://www.facebook.com/", linkedin: "https://www.linkedin.com/company/" } as Record<string, string>)[kind] + handle;
}

export interface OsmResult { leads: Lead[]; area: string }

export async function searchOsm(industryKey: string, custom: string, city: string, limit = 400): Promise<OsmResult> {
  const ind = findIndustry(industryKey);
  const filters = [...(ind?.osm ?? []), ...(ind?.related ?? [])];
  const keywords = [...new Set([...(ind?.keywords ?? []), ...custom.split(/[,،]/).map((s) => s.trim()).filter((s) => s.length > 2)])];
  if (!filters.length && !keywords.length) return { leads: [], area: city };
  const area = await geocode(city);
  const query = buildQuery(area, filters, keywords, limit);
  let elements: { type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }[] | null = null;
  let lastErr = "";
  for (const url of OVERPASS) {
    try {
      const r = await fetch(url, { method: "POST", headers: { ...UA, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ data: query }), signal: AbortSignal.timeout(150_000) });
      if (!r.ok) { lastErr = `${r.status}`; continue; }
      elements = ((await r.json()) as { elements: typeof elements }).elements ?? [];
      break;
    } catch (e) { lastErr = e instanceof Error ? e.message : String(e); }
  }
  if (!elements) throw new Error(`The map servers are busy (${lastErr}). Try again in a minute.`);
  const leads: Lead[] = [];
  for (const el of elements) {
    const t = el.tags ?? {};
    const name = t.name || t["name:en"] || t["name:ar"] || t.brand;
    if (!name) continue;
    const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
    const l = emptyLead(`osm:${el.type}/${el.id}`, name, city);
    const cat = NAME_KEYS.map((k) => t[k]).find(Boolean);
    l.category = (cat ?? "").replace(/_/g, " ");
    l.address = [t["addr:housenumber"], t["addr:street"], t["addr:suburb"] || t["addr:district"], t["addr:city"]].filter(Boolean).join(", ");
    l.mapsUrl = lat ? `https://www.google.com/maps/search/?api=1&query=${lat},${lon}` : "";
    const phones = ["phone", "contact:phone", "mobile", "contact:mobile"].flatMap((k) => split(t[k]));
    l.phone = phones[0] ?? null;
    l.whatsapp = split(t["contact:whatsapp"] || t.whatsapp)[0] ?? null;
    l.email = split(t.email || t["contact:email"])[0] ?? null;
    l.website = t.website || t["contact:website"] || t.url || null;
    l.instagram = social("instagram", t["contact:instagram"] || t.instagram);
    l.facebook = social("facebook", t["contact:facebook"] || t.facebook);
    l.linkedin = social("linkedin", t["contact:linkedin"] || t.linkedin);
    l.sources = [`https://www.openstreetmap.org/${el.type}/${el.id}`];
    leads.push(l);
  }
  return { leads, area: area.name };
}
