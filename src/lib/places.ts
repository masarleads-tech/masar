import type { Brief, Lead } from "./types";
import { findIndustry } from "./industries";
import { emptyLead } from "./lead";

const ENDPOINT = "https://places.googleapis.com/v1/places:searchText";
const FIELDS = [
  "places.id", "places.displayName", "places.formattedAddress", "places.nationalPhoneNumber",
  "places.internationalPhoneNumber", "places.websiteUri", "places.rating", "places.userRatingCount",
  "places.googleMapsUri", "places.primaryTypeDisplayName", "places.businessStatus", "nextPageToken",
].join(",");

interface Place {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  rating?: number;
  userRatingCount?: number;
  googleMapsUri?: string;
  primaryTypeDisplayName?: { text: string };
  businessStatus?: string;
}

async function searchText(fetchFn: typeof fetch, apiKey: string, textQuery: string, pageToken?: string, signal?: AbortSignal) {
  const res = await fetchFn(ENDPOINT, {
    signal,
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": FIELDS },
    body: JSON.stringify({ textQuery, pageSize: 20, ...(pageToken ? { pageToken } : {}) }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google Places error ${res.status}: ${body.slice(0, 300)}`);
  }
  return (await res.json()) as { places?: Place[]; nextPageToken?: string };
}

/** Search queries for one city: the industry's own terms plus the client's own words. */
export function queriesFor(brief: Brief, city: string): string[] {
  const ind = findIndustry(brief.industry);
  const terms = [...(ind?.queries ?? []), ...brief.industryCustom.split(/[,،]/).map((s) => s.trim()).filter(Boolean)];
  return [...new Set(terms)].slice(0, 4).map((t) => `${t} in ${city}`);
}

/** Find businesses on Google Maps. Up to 3 pages (60 results) per query. */
export async function discoverPlaces(apiKey: string, brief: Brief, maxRequests = 24, fetchFn: typeof fetch = fetch, signal?: AbortSignal): Promise<Lead[]> {
  const out = new Map<string, Lead>();
  let requests = 0;
  for (const city of brief.locations) {
    for (const q of queriesFor(brief, city)) {
      let token: string | undefined;
      for (let page = 0; page < 3 && requests < maxRequests; page++) {
        const data = await searchText(fetchFn, apiKey, q, token, signal);
        requests++;
        for (const p of data.places ?? []) {
          if (p.businessStatus && p.businessStatus !== "OPERATIONAL") continue;
          if (out.has(p.id)) continue;
          const lead = emptyLead(`gmaps:${p.id}`, p.displayName?.text ?? "", city);
          lead.category = p.primaryTypeDisplayName?.text ?? "";
          lead.address = p.formattedAddress ?? "";
          lead.mapsUrl = p.googleMapsUri ?? "";
          lead.phone = p.internationalPhoneNumber ?? p.nationalPhoneNumber ?? null;
          lead.website = p.websiteUri ?? null;
          lead.rating = p.rating ?? null;
          lead.reviews = p.userRatingCount ?? null;
          lead.sources = [p.googleMapsUri ?? `https://www.google.com/maps/place/?q=place_id:${p.id}`];
          if (lead.name) out.set(p.id, lead);
        }
        token = data.nextPageToken;
        if (!token) break;
      }
    }
  }
  return [...out.values()];
}
