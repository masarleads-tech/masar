import { bossDiscover } from "@/core/boss";
import { createSearch, saveCollected } from "@/core/intelligence";
import { cleanBrief, errorResponse, noCreditsError, requireUser, searchDeps, HttpError } from "@/lib/server";
import type { DiscoverResponse } from "@/lib/types";

export const maxDuration = 300;

/**
 * Step 1: the Boss sends the collectors that can search (Google & web; Facebook when its API is set up)
 * in parallel. Every business found is saved, filed by category; the best candidates go back to the page.
 */
export async function POST(req: Request) {
  try {
    const account = await requireUser();
    const brief = cleanBrief(await req.json());
    if (!brief.locations.length) throw new HttpError(400, "Add at least one city.");
    const { llm, env, options, ownKey } = await searchDeps(req, account);
    if (!ownKey && account.credits !== null) {
      if (account.credits <= 0) throw noCreditsError();
      brief.count = Math.min(brief.count, account.credits);
    }
    const result = await bossDiscover({ brief, options }, { llm, env, signal: req.signal });
    const warnings = [...result.warnings];
    let searchId: string | null = null;
    if (account.supabase && account.userId) {
      try {
        searchId = await createSearch(account.supabase, account.userId, brief, result.sourcesUsed);
        await saveCollected(account.supabase, account.userId, searchId, brief, result.leads);
      } catch (e) {
        warnings.push(e instanceof Error ? e.message : "Could not save this search.");
      }
    }
    const body: DiscoverResponse = {
      searchId, leads: result.leads.slice(0, Math.round(brief.count * 1.5)), sourcesUsed: result.sourcesUsed, warnings, agents: result.reports,
    };
    return Response.json(body);
  } catch (e) {
    return errorResponse(e);
  }
}
