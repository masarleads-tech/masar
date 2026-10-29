import { bossEnrich } from "@/core/boss";
import { saveLeads } from "@/core/intelligence";
import { parseIncomingLead } from "@/core/schemas";
import { chargeCredits, cleanBrief, errorResponse, noCreditsError, requireUser, searchDeps, HttpError } from "@/lib/server";
import type { EnrichResponse, Lead } from "@/lib/types";

export const maxDuration = 300;

/**
 * Step 2: the Boss checks a small batch with every eligible collector at once (website and web research,
 * then Instagram, Facebook and LinkedIn through their official APIs when set up), and the Intelligence
 * agent scores, ranks and saves them.
 */
export async function POST(req: Request) {
  try {
    const account = await requireUser();
    const body = (await req.json()) as { brief: unknown; leads: unknown[]; searchId?: string | null };
    const brief = cleanBrief(body.brief);
    if (!Array.isArray(body.leads) || body.leads.length === 0 || body.leads.length > 5) {
      throw new HttpError(400, "Send between 1 and 5 leads per batch.");
    }
    let leads = body.leads.map(parseIncomingLead).filter((l): l is Lead => !!l);
    if (!leads.length) throw new HttpError(400, "These leads are not valid.");
    const { llm, env, options, ownKey } = await searchDeps(req, account);
    // Each checked lead uses one credit, charged after the check succeeds.
    if (!ownKey && account.credits !== null) {
      if (account.credits <= 0) throw noCreditsError();
      leads = leads.slice(0, account.credits);
    }
    const result = await bossEnrich({ brief, options }, leads, { llm, env, signal: req.signal });
    let checked = result.leads;
    let creditsLeft = account.credits;
    if (!ownKey && account.credits !== null) {
      const taken = await chargeCredits(account, checked.length);
      checked = checked.slice(0, taken);
      creditsLeft = account.credits - taken;
    }
    // Keep every checked lead in the database so nothing is lost.
    if (account.supabase && account.userId && body.searchId && checked.length) {
      const saved = await saveLeads(account.supabase, account.userId, body.searchId, brief, checked);
      checked = checked.map((l) => {
        const r = saved.get(l.id);
        return r ? { ...l, rowId: r.id, outcome: r.outcome as Lead["outcome"], note: r.note } : l;
      });
    }
    const res: EnrichResponse = { leads: checked, usage: result.usage, creditsLeft, warnings: result.warnings, agents: result.reports };
    return Response.json(res);
  } catch (e) {
    return errorResponse(e);
  }
}
