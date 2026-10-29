import { findIndustry } from "../../lib/industries";
import { emptyLead } from "../../lib/lead";
import type { Lead } from "../../lib/types";
import { errMsg } from "../util";
import { graphGet, norm, sameName } from "./meta";
import { prov, ProviderError, type Collector, type CollectorContext, type LeadPatch } from "./types";

/**
 * Agent 4, the Facebook collector. Uses the Pages Search API (GET /pages/search?q=…), which needs an app
 * access token whose Meta app has the Page Public Metadata Access feature. It returns a Page's id, name,
 * link, location and verification status. Without that feature, Meta refuses and this collector reports
 * "unsupported" instead of guessing.
 */
interface Page { id: string; name: string; link?: string; verification_status?: string; location?: { city?: string; country?: string; street?: string } }

async function search(ctx: CollectorContext, q: string): Promise<Page[]> {
  const body = await graphGet(ctx.fetch, ctx.env.graphVersion ?? "v26.0", "pages/search",
    { q, fields: "id,name,link,location,verification_status", limit: "25", access_token: ctx.env.facebookAppToken! }, ctx.signal);
  return ((body.data ?? []) as Page[]).filter((p) => p?.id && p.name);
}
const inCity = (p: Page, city: string) => !p.location?.city || norm(p.location.city).includes(norm(city)) || norm(city).includes(norm(p.location.city));
const pageUrl = (p: Page) => p.link ?? `https://www.facebook.com/${p.id}`;

function failure(e: unknown, partial: number) {
  if (e instanceof ProviderError && e.kind === "permission") return { status: "unsupported" as const, message: `${e.message}. Page search needs the Page Public Metadata Access feature on the Meta app.` };
  if (partial) return { status: "partial" as const, message: `Stopped early: ${errMsg(e)}` };
  throw e;
}

export const facebook: Collector = {
  id: "facebook",
  availability(ctx) {
    if (!ctx.env.facebookAppToken) return { ok: false, status: "disabled", reason: "Set FACEBOOK_APP_ACCESS_TOKEN (a Meta app with Page Public Metadata Access) to search Facebook Pages through the official API." };
    return { ok: true };
  },

  async discover(ctx) {
    const ind = findIndustry(ctx.brief.industry);
    const terms = [...new Set([...(ind?.queries ?? []).slice(0, 2), ...ctx.brief.industryCustom.split(/[,،]/).map((s) => s.trim()).filter(Boolean)])].slice(0, 3);
    const leads: Lead[] = [];
    try {
      for (const city of ctx.brief.locations) for (const t of terms) {
        for (const p of await search(ctx, `${t} ${city}`)) {
          if (!inCity(p, city)) continue;
          const l = emptyLead(`fb:${p.id}`, p.name, city);
          l.facebook = pageUrl(p);
          l.address = [p.location?.street, p.location?.city].filter(Boolean).join(", ");
          l.facebookVerdict = p.verification_status === "blue_verified" ? "pass" : null;
          l.sources = [l.facebook];
          l.provenance = ["name", "facebook"].map((f) => prov("facebook", f, l.facebook));
          leads.push(l);
        }
      }
    } catch (e) { return { items: leads, ...failure(e, leads.length) }; }
    return { items: leads, status: leads.length ? "ok" : "empty" };
  },

  async enrich(ctx, leads) {
    const out: LeadPatch[] = [];
    try {
      for (const l of leads.filter((x) => !x.facebookVerdict || x.facebookVerdict === "warn")) {
        if (ctx.signal.aborted) break;
        const hit = (await search(ctx, l.name)).find((p) => sameName(p.name, l.name) && inCity(p, l.city));
        out.push(hit
          ? { id: l.id, fields: { facebook: pageUrl(hit), facebookVerdict: "pass" }, sources: [pageUrl(hit)], provenance: ["facebook", "facebook_check"].map((f) => prov("facebook", f, pageUrl(hit))) }
          : { id: l.id, fields: l.facebook ? {} : { facebookVerdict: "not_found" }, sources: [], provenance: [] });
      }
    } catch (e) { return { items: out, ...failure(e, out.length) }; }
    return { items: out, status: "ok" };
  },
};
