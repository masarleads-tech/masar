import type { Lead } from "../../lib/types";
import { errMsg } from "../util";
import { domain, graphGet, sameName } from "./meta";
import { prov, ProviderError, type Collector, type LeadPatch } from "./types";

/**
 * Agent 3, the Instagram collector. Uses the Instagram Graph API's Business Discovery
 * (GET /{ig-user-id}?fields=business_discovery.username(...)), which returns public data about another
 * professional (business or creator) account when you know its exact username.
 * Requires an Instagram professional account linked to a Meta app, and a token with instagram_basic,
 * instagram_manage_insights and pages_read_engagement. Instagram offers no API to search businesses by
 * keyword or place, so this collector only checks handles the other collectors found.
 */
export function usernameFrom(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.trim().match(/^(?:https?:\/\/)?(?:www\.)?instagram\.com\/([A-Za-z0-9_.]{1,30})\/?(?:[?#].*)?$/i) ?? url.trim().match(/^@?([A-Za-z0-9_.]{1,30})$/);
  const u = m?.[1];
  return u && !["p", "reel", "reels", "explore", "accounts", "stories"].includes(u.toLowerCase()) ? u : null;
}

interface Discovery {
  username: string; name?: string; website?: string; followers_count?: number; media_count?: number;
  media?: { data?: { timestamp?: string }[] };
}

export const instagram: Collector = {
  id: "instagram",
  availability(ctx, phase) {
    if (phase === "discover") return { ok: false, status: "unsupported", reason: "Instagram's API has no way to search businesses by keyword or city. It checks handles found by the other collectors instead." };
    if (!ctx.env.instagramToken || !ctx.env.instagramUserId) return { ok: false, status: "disabled", reason: "Set INSTAGRAM_ACCESS_TOKEN and INSTAGRAM_BUSINESS_ACCOUNT_ID to check Instagram accounts through the official API." };
    return { ok: true };
  },

  async enrich(ctx, leads: Lead[]) {
    const out: LeadPatch[] = [];
    const todo = leads.map((l) => ({ l, u: usernameFrom(l.instagram) })).filter((x) => x.u);
    if (!todo.length) return { items: [], status: "empty", message: "No Instagram handles to check yet." };
    let stopped = "";
    for (const { l, u } of todo) {
      if (ctx.signal.aborted) break;
      const fields = `business_discovery.username(${u}){username,name,website,followers_count,media_count,media.limit(1){timestamp}}`;
      try {
        const body = await graphGet(ctx.fetch, ctx.env.graphVersion ?? "v26.0", ctx.env.instagramUserId!, { fields, access_token: ctx.env.instagramToken! }, ctx.signal);
        const d = body.business_discovery as Discovery | undefined;
        const url = `https://www.instagram.com/${u}/`;
        if (!d) { out.push({ id: l.id, fields: { instagramVerdict: "not_found" }, sources: [], provenance: [prov("instagram", "instagram_check", url)] }); continue; }
        const last = d.media?.data?.[0]?.timestamp?.slice(0, 10) ?? null;
        const recent = !!last && Date.now() - Date.parse(last) < 90 * 864e5;
        const matches = (!!d.website && !!l.website && domain(d.website) === domain(l.website)) || (!!d.name && sameName(d.name, l.name));
        const fieldsOut: LeadPatch["fields"] = {
          instagram: url, instagramFollowers: d.followers_count ?? null, instagramLastPost: last,
          instagramVerdict: matches && recent ? "pass" : "warn",
        };
        if (last && Date.now() - Date.parse(last) < 30 * 864e5) fieldsOut.activeLast30Days = true;
        out.push({ id: l.id, fields: fieldsOut, sources: [url], provenance: ["instagram", "instagram_followers", "instagram_check"].map((f) => prov("instagram", f, url)) });
      } catch (e) {
        if (e instanceof ProviderError && e.kind === "not_found") { out.push({ id: l.id, fields: { instagramVerdict: "not_found" }, sources: [], provenance: [] }); continue; }
        if (e instanceof ProviderError && e.kind === "permission") return { items: out, status: "unsupported", message: `${e.message}. The token needs instagram_basic, instagram_manage_insights and pages_read_engagement.` };
        if (e instanceof ProviderError && (e.kind === "auth" || e.kind === "rate_limit")) { stopped = e.message; break; }
        stopped = errMsg(e);
        break;
      }
    }
    if (stopped && !out.length) throw new Error(stopped);
    return { items: out, status: stopped ? "partial" : "ok", message: stopped ? `Stopped early: ${stopped}` : `Checked ${out.length} Instagram accounts` };
  },
};
