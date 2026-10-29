import { errMsg, fetchWithBackoff } from "../util";
import { domain } from "./meta";
import { prov, type Collector, type LeadPatch } from "./types";

/**
 * Agent 2, the LinkedIn collector. LinkedIn has no public API to search companies or people. Its
 * Organization Lookup API (Community Management API) can look up one company by its exact vanity name,
 * with a 3-legged token from an app LinkedIn has approved. So:
 * - discover: always unsupported.
 * - enrich: with LINKEDIN_ACCESS_TOKEN, confirms company pages the other collectors found
 *   (name and website match); without it, disabled. It never visits linkedin.com pages.
 */
export function vanityFrom(url: string | null | undefined): string | null {
  const m = url?.match(/linkedin\.com\/(?:company|school)\/([^/?#]+)/i);
  return m ? decodeURIComponent(m[1]) : null;
}

export const linkedin: Collector = {
  id: "linkedin",
  availability(ctx, phase) {
    if (phase === "discover") return { ok: false, status: "unsupported", reason: "LinkedIn offers no API to search companies or people. LinkedIn pages found in public search results are kept by the Google & web collector." };
    if (!ctx.env.linkedinToken) return { ok: false, status: "unsupported", reason: "LinkedIn lookups need an app approved for LinkedIn's Community Management API (LINKEDIN_ACCESS_TOKEN). Not configured, so LinkedIn is not checked." };
    return { ok: true };
  },

  async enrich(ctx, leads) {
    const out: LeadPatch[] = [];
    const todo = leads.map((l) => ({ l, v: vanityFrom(l.linkedin) })).filter((x) => x.v);
    if (!todo.length) return { items: [], status: "empty", message: "No LinkedIn company pages to check yet." };
    for (const { l, v } of todo) {
      if (ctx.signal.aborted) break;
      let res: Response;
      try {
        res = await fetchWithBackoff(ctx.fetch, `https://api.linkedin.com/rest/organizations?q=vanityName&vanityName=${encodeURIComponent(v!)}`, {
          headers: { authorization: `Bearer ${ctx.env.linkedinToken}`, "LinkedIn-Version": ctx.env.linkedinVersion ?? "202510", "X-Restli-Protocol-Version": "2.0.0" },
          signal: ctx.signal,
        });
      } catch (e) {
        if (!out.length) throw e;
        return { items: out, status: "partial", message: `Stopped early: ${errMsg(e)}` };
      }
      if (res.status === 401 || res.status === 403) return { items: out, status: "unsupported", message: `LinkedIn refused the lookup (${res.status}): the token or app lacks Community Management API access.` };
      if (res.status === 429) return { items: out, status: "partial", message: "LinkedIn rate limit reached; stopped early." };
      if (!res.ok) continue;
      const body = (await res.json().catch(() => ({}))) as { elements?: { localizedName?: string; localizedWebsite?: string; vanityName?: string }[] };
      const org = body.elements?.[0];
      const url = `https://www.linkedin.com/company/${v}/`;
      if (!org) continue;
      const sameSite = !!org.localizedWebsite && !!l.website && domain(org.localizedWebsite) === domain(l.website);
      out.push({ id: l.id, fields: { linkedin: url, ...(l.website ? {} : org.localizedWebsite ? { website: org.localizedWebsite } : {}) }, sources: [url],
        provenance: [prov("linkedin", sameSite ? "linkedin_verified" : "linkedin", url)] });
    }
    return { items: out, status: "ok" };
  },
};
