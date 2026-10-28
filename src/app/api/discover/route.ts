import { discoverPlaces } from "@/lib/places";
import { discoverWithClaude, type Usage } from "@/lib/claude";
import { dedupe, isExcluded, markChains, rescore } from "@/lib/lead";
import { cleanBrief, errorResponse, keysFrom, noCreditsError, requireUser, HttpError } from "@/lib/server";
import type { DiscoverResponse, Lead } from "@/lib/types";

export const maxDuration = 300;

/** Step 1: find candidate businesses (Google Maps when a key is set, otherwise Claude web search). */
export async function POST(req: Request) {
  try {
    const account = await requireUser();
    const brief = cleanBrief(await req.json());
    if (!brief.locations.length) throw new HttpError(400, "Add at least one city.");
    const { anthropic, googleKey, ownKey } = await keysFrom(req, account);
    if (!ownKey && account.credits !== null) {
      if (account.credits <= 0) throw noCreditsError();
      brief.count = Math.min(brief.count, account.credits);
    }
    const warnings: string[] = [];
    const sourcesUsed: string[] = [];
    let leads: Lead[] = [];
    if (googleKey) {
      try {
        leads = await discoverPlaces(googleKey, brief);
        sourcesUsed.push("Google Maps");
      } catch (e) {
        warnings.push(e instanceof Error ? e.message : "Google Maps search failed");
      }
    }
    if (leads.length < Math.min(brief.count, 20)) {
      const usage: Usage = { inputTokens: 0, outputTokens: 0, webSearches: 0 };
      const per = Math.ceil(Math.min(brief.count, 40) / brief.locations.length);
      for (const city of brief.locations) leads.push(...(await discoverWithClaude(anthropic, brief, city, per, usage)));
      sourcesUsed.push("Web search");
    }
    leads = markChains(dedupe(leads)).filter((l) => !isExcluded(l, brief.exclude)).map((l) => rescore(l, brief));
    leads.sort((a, b) => b.fit - a.fit);
    let searchId: string | null = null;
    if (account.supabase && account.userId) {
      const { data, error } = await account.supabase.from("searches")
        .insert({ user_id: account.userId, brief, sources: sourcesUsed }).select("id").single();
      if (error) warnings.push(`Could not save this search: ${error.message}`);
      searchId = data?.id ?? null;
    }
    const body: DiscoverResponse = { searchId, leads: leads.slice(0, Math.round(brief.count * 1.5)), sourcesUsed, warnings };
    return Response.json(body);
  } catch (e) {
    return errorResponse(e);
  }
}
