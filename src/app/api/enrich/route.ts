import { enrichBatch, type Usage } from "@/lib/claude";
import { rescore } from "@/lib/lead";
import { chargeCredits, cleanBrief, errorResponse, keysFrom, noCreditsError, requireUser, HttpError } from "@/lib/server";
import type { EnrichResponse, Lead } from "@/lib/types";

export const maxDuration = 300;

/** Step 2: Claude checks a small batch of leads (contacts, Instagram, Facebook, LinkedIn, legitimacy). */
export async function POST(req: Request) {
  try {
    const account = await requireUser();
    const body = (await req.json()) as { brief: unknown; leads: Lead[]; searchId?: string | null };
    const brief = cleanBrief(body.brief);
    if (!Array.isArray(body.leads) || body.leads.length === 0 || body.leads.length > 5) {
      throw new HttpError(400, "Send between 1 and 5 leads per batch.");
    }
    const { anthropic, ownKey } = await keysFrom(req, account);
    // Each checked lead uses one credit, charged after the check succeeds.
    let leads = body.leads;
    if (!ownKey && account.credits !== null) {
      if (account.credits <= 0) throw noCreditsError();
      leads = leads.slice(0, account.credits);
    }
    const usage: Usage = { inputTokens: 0, outputTokens: 0, webSearches: 0 };
    let checked = await enrichBatch(anthropic, brief, leads, usage);
    let creditsLeft = account.credits;
    if (!ownKey && account.credits !== null) {
      const taken = await chargeCredits(account, checked.length);
      checked = checked.slice(0, taken);
      creditsLeft = account.credits - taken;
    }
    let scored = checked.map((l) => rescore(l, brief));
    // Keep every checked lead in the database so nothing is lost.
    if (account.supabase && account.userId && body.searchId && scored.length) {
      const rows = scored.map((l) => ({
        search_id: body.searchId, user_id: account.userId, lead_key: l.id,
        data: l, closing: l.closing, fit: l.fit, updated_at: new Date().toISOString(),
      }));
      const { data } = await account.supabase.from("leads")
        .upsert(rows, { onConflict: "search_id,lead_key" }).select("id, lead_key, outcome, note");
      const saved = new Map((data ?? []).map((r) => [r.lead_key as string, r]));
      scored = scored.map((l) => {
        const r = saved.get(l.id);
        return r ? { ...l, rowId: r.id, outcome: r.outcome, note: r.note } : l;
      });
    }
    const res: EnrichResponse = { leads: scored, usage, creditsLeft };
    return Response.json(res);
  } catch (e) {
    return errorResponse(e);
  }
}
