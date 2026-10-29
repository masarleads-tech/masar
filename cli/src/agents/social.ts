import type { Brief, Lead, Verdict } from "../../../src/lib/types";
import type { AI } from "../ai/base";
import { arr, nenum, nint, nstr, obj, str } from "./schema";

/**
 * Instagram, Facebook and LinkedIn agents. Each one checks a small batch of businesses on its own
 * platform using public search results and public pages only, through the AI's own web search.
 * They never sign in, never use the platforms' private APIs and never collect personal contact details.
 * Without a web-capable AI they keep only the links the business published on its own website or map listing.
 */
export type SocialAgent = "instagram" | "facebook" | "linkedin";

const VERDICTS = ["pass", "warn", "fail", "not_found"];
const brief1 = (leads: Lead[]) => JSON.stringify(leads.map((l) => ({
  id: l.id, name: l.name, city: l.city, category: l.category, address: l.address, phone: l.phone, website: l.website,
  known_instagram: l.instagram, known_facebook: l.facebook, known_linkedin: l.linkedin,
})), null, 1);

const SPEC: Record<SocialAgent, { schema: ReturnType<typeof obj>; task: string; searchesPer: number }> = {
  instagram: {
    searchesPer: 3,
    schema: obj({ results: arr(obj({
      id: str, instagram_url: nstr, followers: nint, last_post: nstr, verdict: nenum(VERDICTS), evidence: str, sources: arr(str),
    })) }),
    task: `For each business, find its own public Instagram account (start from known_instagram if given).
Use search results and the public profile preview only. Report the profile URL, the follower count and the date of the latest post (YYYY-MM-DD) if you can see them.
verdict: "pass" if the account clearly belongs to this business (same name and city, or links to the same website or phone) and posted in the last 90 days; "warn" if it is inactive or you are not sure it is theirs; "fail" if it looks fake, closed or belongs to a different business; "not_found" if there is none.
evidence: one short sentence on how you decided.`,
  },
  facebook: {
    searchesPer: 2,
    schema: obj({ results: arr(obj({
      id: str, facebook_url: nstr, verdict: nenum(VERDICTS), phone: nstr, email: nstr, evidence: str, sources: arr(str),
    })) }),
    task: `For each business, find its own public Facebook page (start from known_facebook if given), using search results and the public page only.
Report the page URL and any business phone or email the page shows publicly.
verdict: "pass" if the page clearly belongs to this business and shows recent activity; "warn" if inactive or unclear; "fail" if fake, closed or a different business; "not_found" if there is none.
evidence: one short sentence on how you decided.`,
  },
  linkedin: {
    searchesPer: 3,
    schema: obj({ results: arr(obj({
      id: str, linkedin_url: nstr, company_size: nstr,
      decision_makers: arr(obj({ name: str, title: str, profile_url: nstr })),
      evidence: str, sources: arr(str),
    })) }),
    task: `For each business, find its LinkedIn company page, and up to 2 decision makers (owner, founder, CEO, general manager, purchasing, procurement or marketing manager) from public search results only.
Report each person's name, job title and public profile link exactly as shown in the search result. Do not open profiles that need a login. Report company_size as LinkedIn shows it (for example "11-50 employees") or null.
evidence: one short sentence on how you matched the page to the business.`,
  },
};

type Row = Record<string, unknown> & { id: string; sources?: string[] };

export async function runSocialAgent(agent: SocialAgent, ai: AI, brief: Brief, batch: Lead[]): Promise<Map<string, Row>> {
  const spec = SPEC[agent];
  const prompt = `${spec.task}

My client sells: ${brief.offer || "(not given)"}. They want to reach businesses like these in ${brief.locations.join(", ")}.
Businesses (JSON):
${brief1(batch)}

Return one entry per business with the same id.`;
  const out = await ai.ask<{ results: Row[] }>(prompt, { schema: spec.schema, web: true, searches: spec.searchesPer * batch.length, city: batch[0]?.city });
  return new Map((out.results ?? []).filter((r) => r && typeof r.id === "string").map((r) => [r.id, r]));
}

/** Folds an agent's findings into the lead. Only fields the agent is responsible for change. */
export function applySocial(agent: SocialAgent, lead: Lead, r: Row | undefined): Lead {
  if (!r) return lead;
  const l: Lead = { ...lead, sources: [...new Set([...lead.sources, ...((r.sources ?? []) as string[]).filter((s) => typeof s === "string")])].slice(0, 20) };
  const v = (x: unknown) => (VERDICTS.includes(x as string) ? (x as Verdict) : null);
  if (agent === "instagram") {
    l.instagram = (r.instagram_url as string | null) ?? l.instagram;
    l.instagramFollowers = (r.followers as number | null) ?? l.instagramFollowers;
    l.instagramLastPost = (r.last_post as string | null) ?? l.instagramLastPost;
    l.instagramVerdict = v(r.verdict);
    if (l.instagramLastPost && Date.now() - Date.parse(l.instagramLastPost) < 30 * 864e5) l.activeLast30Days = true;
  } else if (agent === "facebook") {
    l.facebook = (r.facebook_url as string | null) ?? l.facebook;
    l.facebookVerdict = v(r.verdict);
    l.phone = l.phone ?? (r.phone as string | null);
    l.email = l.email ?? (r.email as string | null);
  } else {
    l.linkedin = (r.linkedin_url as string | null) ?? l.linkedin;
    const dms = ((r.decision_makers ?? []) as { name: string; title: string; profile_url: string | null }[])
      .filter((d) => d?.name).slice(0, 2).map((d) => ({ name: d.name, title: d.title, profileUrl: d.profile_url }));
    if (dms.length) l.decisionMakers = dms;
  }
  return l;
}

export const AGENT_LABEL: Record<SocialAgent, string> = { instagram: "Instagram", facebook: "Facebook", linkedin: "LinkedIn" };
