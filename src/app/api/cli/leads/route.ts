import { cleanBrief, errorResponse, HttpError } from "@/lib/server";
import { emptyLead, rescore } from "@/lib/lead";
import { cliLeadsAreFree, cliUser } from "@/lib/cli";
import type { Lead } from "@/lib/types";

const AGENTS = ["main", "google", "website", "instagram", "facebook", "linkedin", "documenter"];
const int = (v: unknown, max: number) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));
const str = (v: unknown, max = 500) => (typeof v === "string" ? v.slice(0, max) : null);

/** Keeps only the lead fields the site knows, so a CLI can't store anything else in the account. */
function cleanLead(raw: unknown, i: number): Lead {
  const r = (raw ?? {}) as Record<string, unknown>;
  const l = emptyLead(str(r.id, 200) || `cli:${i}`, str(r.name, 200) || "Unnamed business", str(r.city, 120) || "");
  for (const k of ["category", "address", "mapsUrl", "legitimacyReason"] as const) l[k] = str(r[k]) ?? "";
  for (const k of ["phone", "whatsapp", "email", "website", "instagram", "instagramLastPost", "facebook", "linkedin"] as const) l[k] = str(r[k]);
  for (const k of ["rating", "reviews", "instagramFollowers"] as const) l[k] = typeof r[k] === "number" && Number.isFinite(r[k]) ? (r[k] as number) : null;
  const verdict = (v: unknown) => (["pass", "warn", "fail", "not_found"].includes(v as string) ? (v as Lead["instagramVerdict"]) : null);
  l.instagramVerdict = verdict(r.instagramVerdict);
  l.facebookVerdict = verdict(r.facebookVerdict);
  l.legitimacy = (["pass", "warn", "fail"].includes(r.legitimacy as string) ? r.legitimacy : null) as Lead["legitimacy"];
  l.activeLast30Days = typeof r.activeLast30Days === "boolean" ? r.activeLast30Days : null;
  l.isChain = r.isChain === true;
  l.enriched = r.enriched === true;
  for (const k of ["compatibility", "verified", "rank"] as const) if (typeof r[k] === "number" && Number.isFinite(r[k])) l[k] = Math.max(0, Math.min(100, Math.round(r[k] as number)));
  l.compatibilityReason = str(r.compatibilityReason, 300) ?? undefined;
  l.sources = Array.isArray(r.sources) ? r.sources.map((s) => str(s, 500)).filter((s): s is string => !!s).slice(0, 20) : [];
  l.decisionMakers = Array.isArray(r.decisionMakers) ? r.decisionMakers.slice(0, 5).map((d) => {
    const x = (d ?? {}) as Record<string, unknown>;
    return { name: str(x.name, 120) ?? "", title: str(x.title, 160) ?? "", profileUrl: str(x.profileUrl) };
  }).filter((d) => d.name) : [];
  return l;
}

/**
 * The CLI saves a finished search here: the leads go into the member's account (so they show on the
 * dashboard), credits are taken (one per lead, none on Premium) and the run is logged as CLI usage.
 */
export async function POST(req: Request) {
  try {
    const me = await cliUser(req);
    const text = await req.text();
    if (text.length > 4_000_000) throw new HttpError(413, "Too many leads in one save. Save at most 500 at a time.");
    const body = JSON.parse(text) as Record<string, unknown>;
    const brief = cleanBrief(body.brief);
    const raw = Array.isArray(body.leads) ? body.leads.slice(0, 500) : [];
    const ai = (body.ai ?? {}) as Record<string, unknown>;
    const usage = (body.usage ?? {}) as Record<string, unknown>;
    const agents = Array.isArray(body.agents) ? body.agents.filter((a): a is string => AGENTS.includes(a as string)) : [];

    let leads = raw.map(cleanLead).map((l) => rescore(l, brief));
    const free = cliLeadsAreFree(me.plan);
    let charged = 0;
    if (!free && leads.length) {
      const { data, error } = await me.db.rpc("charge_credits_for", { uid: me.userId, wanted: leads.length });
      if (error) throw new HttpError(500, `Could not update your balance: ${error.message}`);
      charged = Number(data) || 0;
      leads = leads.slice(0, charged);
    }

    let searchId: string | null = null;
    if (leads.length) {
      const { data: search, error } = await me.db.from("searches")
        .insert({ user_id: me.userId, brief, sources: ["Masar CLI", ...agents.filter((a) => a !== "main" && a !== "documenter")] }).select("id").single();
      if (error) throw new HttpError(500, `Could not save this search: ${error.message}`);
      searchId = search.id;
      const rows = leads.map((l) => ({ search_id: searchId, user_id: me.userId, lead_key: l.id, data: l, closing: l.closing, fit: l.fit }));
      const { error: le } = await me.db.from("leads").upsert(rows, { onConflict: "search_id,lead_key" });
      if (le) throw new HttpError(500, `Could not save the leads: ${le.message}`);
    }

    await me.db.from("cli_usage").insert({
      user_id: me.userId, token_id: me.tokenId, search_id: searchId,
      ai_provider: str(ai.provider, 40) ?? "", ai_model: str(ai.model, 80) ?? "", agents,
      leads_found: int(body.found ?? raw.length, 100000), leads_saved: leads.length, credits_used: charged,
      input_tokens: int(usage.inputTokens, 1e12), output_tokens: int(usage.outputTokens, 1e12),
      web_searches: int(usage.webSearches, 1e6), duration_ms: int(body.durationMs, 2e9),
    });

    const site = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || new URL(req.url).origin;
    return Response.json({
      searchId, saved: leads.length, skipped: raw.length - leads.length, charged, free,
      creditsLeft: free ? me.credits : me.credits - charged, plan: me.plan,
      leads, dashboardUrl: `${site}/dashboard`,
    });
  } catch (e) {
    if (e instanceof SyntaxError) return Response.json({ error: "The request was not valid JSON." }, { status: 400 });
    return errorResponse(e);
  }
}
