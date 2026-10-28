import Anthropic from "@anthropic-ai/sdk";
import type { Brief, Lead, Verdict } from "./types";
import { emptyLead } from "./lead";
import { findIndustry } from "./industries";

const MODEL = "claude-opus-5-5";

export interface Usage { inputTokens: number; outputTokens: number; webSearches: number }

const RULES = `You research businesses as sales leads for a client in the Middle East and Europe.
Rules you always follow:
- Use only public pages and public search results. Never log in anywhere, never use fake accounts, never try to get past a captcha or login wall.
- Every value you report must come from a page you actually saw. If you did not find it, use null. Never guess a phone number, email, follower count or name.
- For people, report only their public business role: name, job title and a public profile link. Do not report personal mobile numbers or personal emails unless the person published them for business on the company's own pages.
- Phone numbers in international format when the country is clear (for Saudi Arabia: +966...).
- Keep the source URL of every page you relied on.`;

/** Call Claude with web search and fetch, and return the input of the submit tool it calls at the end. */
async function runResearch<T>(
  client: Anthropic,
  user: string,
  submitTool: Anthropic.Beta.Messages.BetaTool,
  opts: { searches: number; fetches: number; city?: string },
  usage: Usage,
): Promise<T> {
  const tools: Anthropic.Beta.Messages.BetaToolUnion[] = [
    { type: "web_search_20260209", name: "web_search", max_uses: opts.searches, ...(opts.city ? { user_location: { type: "approximate" as const, city: opts.city } } : {}) },
    { type: "web_fetch_20260209", name: "web_fetch", max_uses: opts.fetches },
    submitTool,
  ];
  const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [{ role: "user", content: user }];
  let nudged = false;
  for (let turn = 0; turn < 8; turn++) {
    const res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: RULES,
      tools,
      messages,
      output_config: { effort: "medium" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    usage.inputTokens += res.usage.input_tokens;
    usage.outputTokens += res.usage.output_tokens;
    usage.webSearches += res.usage.server_tool_use?.web_search_requests ?? 0;
    if (res.stop_reason === "refusal") throw new Error("Claude declined this request.");
    const submit = res.content.find((b) => b.type === "tool_use" && b.name === submitTool.name);
    if (submit && submit.type === "tool_use") return submit.input as T;
    messages.push({ role: "assistant", content: res.content });
    if (res.stop_reason === "pause_turn") continue;
    if (nudged) break;
    nudged = true;
    messages.push({ role: "user", content: `Call ${submitTool.name} now with what you found so far.` });
  }
  throw new Error("Claude did not return results.");
}

const nullableString = { type: ["string", "null"] } as const;
const verdict = { type: ["string", "null"], enum: ["pass", "warn", "fail", "not_found", null] } as const;

const ENRICH_TOOL: Anthropic.Beta.Messages.BetaTool = {
  name: "submit_results",
  description: "Submit the checked details for every lead in the batch. Call this once, at the end.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["leads"],
    properties: {
      leads: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "phone", "whatsapp", "email", "website", "instagram_url", "instagram_followers",
            "instagram_last_post", "instagram_verdict", "facebook_url", "facebook_verdict", "linkedin_url",
            "decision_makers", "active_last_30_days", "legitimacy", "legitimacy_reason", "sources"],
          properties: {
            id: { type: "string" },
            phone: nullableString,
            whatsapp: nullableString,
            email: nullableString,
            website: nullableString,
            instagram_url: nullableString,
            instagram_followers: { type: ["integer", "null"] },
            instagram_last_post: { type: ["string", "null"], description: "YYYY-MM-DD" },
            instagram_verdict: verdict,
            facebook_url: nullableString,
            facebook_verdict: verdict,
            linkedin_url: nullableString,
            decision_makers: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["name", "title", "profile_url"],
                properties: { name: { type: "string" }, title: { type: "string" }, profile_url: nullableString },
              },
            },
            active_last_30_days: { type: ["boolean", "null"] },
            legitimacy: { type: "string", enum: ["pass", "warn", "fail"] },
            legitimacy_reason: { type: "string" },
            sources: { type: "array", items: { type: "string" } },
          },
        },
      },
    },
  },
};

interface EnrichRow {
  id: string; phone: string | null; whatsapp: string | null; email: string | null; website: string | null;
  instagram_url: string | null; instagram_followers: number | null; instagram_last_post: string | null;
  instagram_verdict: Verdict | null; facebook_url: string | null; facebook_verdict: Verdict | null;
  linkedin_url: string | null; decision_makers: { name: string; title: string; profile_url: string | null }[];
  active_last_30_days: boolean | null; legitimacy: "pass" | "warn" | "fail"; legitimacy_reason: string; sources: string[];
}

/** Check a small batch of leads: contacts, Instagram, Facebook, LinkedIn decision makers, legitimacy. */
export async function enrichBatch(client: Anthropic, brief: Brief, leads: Lead[], usage: Usage): Promise<Lead[]> {
  const today = new Date().toISOString().slice(0, 10);
  const list = leads.map((l) => ({ id: l.id, name: l.name, category: l.category, city: l.city, address: l.address,
    phone: l.phone, website: l.website, google_maps: l.mapsUrl }));
  const user = `Today is ${today}. My client sells: ${brief.offer}
They want to reach: ${findIndustry(brief.industry)?.en ?? brief.industryCustom}.

For each business below, do four checks:
1. Contacts: confirm the phone (and WhatsApp if listed), find a business email and the official website.
2. Instagram: find the business's own public account. "pass" if it links to the same website or phone, matches the city, and posted in the last 90 days; "warn" if inactive or unclear; "fail" if fake, closed or a different business; "not_found" if none.
3. Facebook: the same check for its public page.
4. LinkedIn: from search results only, find the company page and up to 2 decision makers (owner, founder, general manager, purchasing or marketing manager) with their titles and profile links.
Then give an overall legitimacy (pass, warn or fail) with a one-sentence reason, and whether the business was active in the last 30 days.

Businesses (JSON):
${JSON.stringify(list, null, 1)}

When done, call submit_results once with one entry per business, using the same ids.`;
  const out = await runResearch<{ leads: EnrichRow[] }>(client, user, ENRICH_TOOL,
    { searches: 5 * leads.length, fetches: 3 * leads.length, city: leads[0]?.city }, usage);
  const byId = new Map(out.leads.map((r) => [r.id, r]));
  return leads.map((l) => {
    const r = byId.get(l.id);
    if (!r) return { ...l, enriched: true, legitimacyReason: "Not checked" };
    return {
      ...l,
      phone: r.phone ?? l.phone,
      whatsapp: r.whatsapp,
      email: r.email,
      website: r.website ?? l.website,
      instagram: r.instagram_url,
      instagramFollowers: r.instagram_followers,
      instagramLastPost: r.instagram_last_post,
      instagramVerdict: r.instagram_verdict,
      facebook: r.facebook_url,
      facebookVerdict: r.facebook_verdict,
      linkedin: r.linkedin_url,
      decisionMakers: r.decision_makers.map((d) => ({ name: d.name, title: d.title, profileUrl: d.profile_url })),
      activeLast30Days: r.active_last_30_days,
      legitimacy: r.legitimacy,
      legitimacyReason: r.legitimacy_reason,
      sources: [...new Set([...l.sources, ...r.sources])],
      enriched: true,
    };
  });
}

const DISCOVER_TOOL: Anthropic.Beta.Messages.BetaTool = {
  name: "submit_candidates",
  description: "Submit the businesses you found. Call this once, at the end.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["businesses"],
    properties: {
      businesses: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "category", "address", "phone", "website", "instagram_url", "source_url"],
          properties: {
            name: { type: "string" }, category: { type: "string" }, address: { type: "string" },
            phone: nullableString, website: nullableString, instagram_url: nullableString, source_url: { type: "string" },
          },
        },
      },
    },
  },
};

/** Find candidate businesses with web search, used when no Google Maps key is set. */
export async function discoverWithClaude(client: Anthropic, brief: Brief, city: string, want: number, usage: Usage): Promise<Lead[]> {
  const ind = findIndustry(brief.industry);
  const user = `Find up to ${want} real, currently operating businesses in ${city} of this type: ${ind ? `${ind.en} (${ind.ar})` : ""} ${brief.industryCustom}.
My client sells: ${brief.offer}. ${brief.goodSignals.length ? `Prefer businesses that mention: ${brief.goodSignals.join(", ")}.` : ""}
${brief.exclude.length ? `Leave out: ${brief.exclude.join(", ")}.` : ""}
Search in English and Arabic, and use Google Maps listings, directories and Instagram results. List each business once, with the page you found it on. Then call submit_candidates.`;
  const out = await runResearch<{ businesses: { name: string; category: string; address: string; phone: string | null;
    website: string | null; instagram_url: string | null; source_url: string }[] }>(
    client, user, DISCOVER_TOOL, { searches: Math.min(20, 4 + Math.ceil(want / 5)), fetches: 6, city }, usage);
  return out.businesses.map((b, i) => {
    const l = emptyLead(`web:${city}:${i}:${b.name}`, b.name, city);
    l.category = b.category; l.address = b.address; l.phone = b.phone; l.website = b.website;
    l.instagram = b.instagram_url; l.sources = [b.source_url];
    return l;
  });
}
