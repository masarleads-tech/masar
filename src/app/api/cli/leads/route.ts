import { AgentReportSchema, AGENTS, parseBrief, parseIncomingLead } from "@/core";
import { createSearch, rank, saveCollected, saveLeads } from "@/core/intelligence";
import { cliLeadsAreFree, cliUser } from "@/lib/cli";
import { errorResponse, HttpError } from "@/lib/server";
import type { Lead } from "@/lib/types";

const int = (v: unknown, max: number) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));
const str = (v: unknown, max = 500) => (typeof v === "string" ? v.slice(0, max) : null);
const leadsFrom = (v: unknown, max: number) => (Array.isArray(v) ? v.slice(0, max) : []).map(parseIncomingLead).filter((l): l is Lead => !!l);

/**
 * The CLI saves a finished search here, through the same Intelligence agent code the website uses:
 * every business the collectors found goes to collected_leads (by category), the checked leads go to
 * the member's list (one credit each, none on Premium), and the run is logged as CLI usage.
 */
export async function POST(req: Request) {
  try {
    const me = await cliUser(req);
    const text = await req.text();
    if (text.length > 8_000_000) throw new HttpError(413, "Too many leads in one save. Save at most 500 at a time.");
    const body = JSON.parse(text) as Record<string, unknown>;
    const brief = parseBrief(body.brief);
    const incoming = leadsFrom(body.leads, 500);
    const collected = leadsFrom(body.collected, 1000);
    const ai = (body.ai ?? {}) as Record<string, unknown>;
    const usage = (body.usage ?? {}) as Record<string, unknown>;
    const reports = (Array.isArray(body.reports) ? body.reports.slice(0, 50) : [])
      .map((r) => AgentReportSchema.safeParse(r)).flatMap((r) => (r.success ? [r.data] : []));
    const agents = [...new Set(reports.filter((r) => !["disabled", "unsupported", "skipped"].includes(r.status)).map((r) => r.agent))]
      .filter((a) => (AGENTS as readonly string[]).includes(a));

    // Scores are worked out again here, so what the dashboard shows doesn't depend on the CLI's version.
    let leads = rank(brief, incoming);
    const free = cliLeadsAreFree(me.plan);
    let charged = 0;
    if (!free && leads.length) {
      const { data, error } = await me.db.rpc("charge_credits_for", { uid: me.userId, wanted: leads.length });
      if (error) throw new HttpError(500, `Could not update your balance: ${error.message}`);
      charged = Number(data) || 0;
      leads = leads.slice(0, charged);
    }

    let searchId: string | null = null;
    if (leads.length || collected.length) {
      searchId = await createSearch(me.db, me.userId, brief, ["Masar CLI", ...agents.filter((a) => a !== "boss" && a !== "intelligence")]);
      await saveCollected(me.db, me.userId, searchId, brief, collected);
      await saveLeads(me.db, me.userId, searchId, brief, leads);
    }

    await me.db.from("cli_usage").insert({
      user_id: me.userId, token_id: me.tokenId, search_id: searchId,
      ai_provider: str(ai.provider, 40) ?? "", ai_model: str(ai.model, 80) ?? "", agents,
      leads_found: Math.max(collected.length, incoming.length), leads_saved: leads.length, credits_used: charged,
      input_tokens: int(usage.inputTokens, 1e12), output_tokens: int(usage.outputTokens, 1e12),
      web_searches: int(usage.webSearches, 1e6), duration_ms: int(body.durationMs, 2e9),
    });

    const site = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || new URL(req.url).origin;
    return Response.json({
      searchId, saved: leads.length, skipped: incoming.length - leads.length, charged, free,
      creditsLeft: free ? me.credits : me.credits - charged, plan: me.plan,
      leads, dashboardUrl: `${site}/dashboard`,
    });
  } catch (e) {
    if (e instanceof SyntaxError) return Response.json({ error: "The request was not valid JSON." }, { status: 400 });
    return errorResponse(e);
  }
}
