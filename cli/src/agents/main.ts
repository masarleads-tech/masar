import { INDUSTRIES, findIndustry } from "../../../src/lib/industries";
import type { Brief } from "../../../src/lib/types";
import type { AI } from "../ai/base";
import type { Me } from "../api";
import * as ui from "../ui";
import { arr, bool, enm, int, nstr, obj, str } from "./schema";

/**
 * Main agent: talks with the member, one question at a time, until it understands who they sell to,
 * where, and how they like to reach people. Then it writes the brief and picks the pipeline:
 * which of the Google, website, Instagram, Facebook and LinkedIn agents to send, and what they should look for.
 */
export const FINDERS = ["google", "website", "instagram", "facebook", "linkedin"] as const;
export type Finder = (typeof FINDERS)[number];

export interface Plan { brief: Brief; agents: Finder[]; queries: string[]; reason: string; summary: string }

const BRIEF = obj({
  clientName: str, offer: str,
  targetType: enm(["business", "individual"]),
  industry: enm([...INDUSTRIES.map((i) => i.key), "custom"]),
  industryCustom: str,
  locations: arr(str),
  size: enm(["any", "independent", "chain"]),
  positioning: enm(["any", "premium", "mid", "budget"]),
  channel: enm(["phone", "email", "social", "visit", "any"]),
  mustHave: arr(enm(["phone", "email", "website", "social"])),
  goodSignals: arr(str), exclude: arr(str), count: int,
});
const TURN = obj({
  done: bool, question: nstr, choices: arr(str), summary: str, brief: BRIEF,
  plan: obj({ agents: arr(enm([...FINDERS])), queries: arr(str), reason: str }),
});
type Turn = { done: boolean; question: string | null; choices: string[]; summary: string; brief: Brief; plan: { agents: Finder[]; queries: string[]; reason: string } };

const MAX_QUESTIONS = 6;

function system(ai: AI, me: Me | null, cap: number) {
  const s = me?.setup;
  const known = s ? `From the member's Masar setup: industries they target: ${(s.industries ?? []).join(", ") || "not set"}; ideal customer: ${s.ideal_customer || "not set"}; cities: ${(s.cities ?? []).join(", ") || "not set"}; leads per week goal: ${s.leads_per_week ?? "not set"}.` : "The member has no saved setup.";
  return `You are Masar's main agent. You interview a business owner or sales person in a terminal, understand exactly who they want to sell to, and plan the search.
Talk like a sharp, friendly sales researcher. Reply in the language the member writes in (Arabic or English). Ask ONE short question per turn, with 2 to 6 short suggested answers in "choices" when helpful.
Ask only what you still need: what they sell, who buys it (type of business), which cities or countries, the kind of customer (independent vs chain, premium vs budget), how they prefer to reach people, and how many leads. Never ask more than ${MAX_QUESTIONS} questions in total; make sensible assumptions instead.
${known}
The member can save at most ${cap} leads in this run; keep "count" at or below ${cap} (default 30).

Industry keys you can use (pick the closest, or "custom" and describe it in industryCustom):
${INDUSTRIES.map((i) => `${i.key}: ${i.en}`).join("\n")}

When you know enough, set done=true, fill the brief, write a 1-2 sentence summary of what you understood, and plan the pipeline:
- "google" finds candidate businesses (OpenStreetMap${ai.web ? ", Google Maps listings and web results" : ""}). Always include it.
- "website" visits each business's own site for emails, phones and social links. Include it unless the member only wants map data.
- "instagram" checks the business's public Instagram (best for retail, beauty, food, fashion, clinics, consumer brands).
- "facebook" checks the public Facebook page (good for local services, restaurants, retail, older audiences).
- "linkedin" finds the company page and decision makers (best for B2B, offices, companies, factories, hospitals, schools, anyone selling to managers).
Pick the social agents that fit who they sell to and how they want to reach people. ${ai.web ? "" : "This AI cannot search the web, so social agents only keep links found on websites and maps; still include the ones that matter."}
"queries": up to 6 search phrases (English and Arabic) the Google agent should use. "reason": one sentence on why this pipeline.
While done=false, still fill brief and plan with your best guess so far.`;
}

function transcriptText(history: { role: "agent" | "member"; text: string }[]) {
  return history.map((h) => `${h.role === "agent" ? "Masar" : "Member"}: ${h.text}`).join("\n");
}

export function normalizeBrief(b: Partial<Brief>, cap: number): Brief {
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String).map((x) => x.trim()).filter(Boolean) : []);
  const industry = b.industry && (b.industry === "custom" || findIndustry(b.industry)) ? b.industry : "custom";
  return {
    clientName: String(b.clientName ?? "").slice(0, 120),
    offer: String(b.offer ?? "").slice(0, 1000),
    targetType: b.targetType === "individual" ? "individual" : "business",
    industry,
    industryCustom: String(b.industryCustom ?? "").slice(0, 200),
    locations: list(b.locations).slice(0, 5),
    size: (["any", "independent", "chain"] as const).includes(b.size as never) ? b.size! : "any",
    positioning: (["any", "premium", "mid", "budget"] as const).includes(b.positioning as never) ? b.positioning! : "any",
    channel: (["phone", "email", "social", "visit", "any"] as const).includes(b.channel as never) ? b.channel! : "phone",
    mustHave: list(b.mustHave).filter((m): m is Brief["mustHave"][number] => ["phone", "email", "website", "social"].includes(m)),
    goodSignals: list(b.goodSignals).slice(0, 10),
    exclude: list(b.exclude).slice(0, 30),
    count: Math.max(1, Math.min(cap, 200, Number(b.count) || 30)),
  };
}

/** The interview. `first` is what the member typed after `masar find`, if anything. */
export async function interview(ai: AI, me: Me | null, cap: number, first?: string): Promise<Plan> {
  const history: { role: "agent" | "member"; text: string }[] = [];
  if (first) history.push({ role: "member", text: first });
  else {
    const opener = await ui.ask("What do you sell, and who do you want to sell it to?", { hint: "For example: \"Skincare products to beauty salons and pharmacies in Riyadh\"  ·  Arabic is fine too" });
    history.push({ role: "member", text: opener });
  }
  let asked = 0;
  for (;;) {
    const forceDone = asked >= MAX_QUESTIONS;
    const sp = ui.spinner("Main agent is thinking");
    let turn: Turn;
    try {
      turn = await ai.ask<Turn>(`${system(ai, me, cap)}\n\nConversation so far:\n${transcriptText(history)}\n\n${forceDone ? "You must finish now: set done=true." : "Your turn."}`, { schema: TURN });
      sp.done(turn.done ? "Main agent understood your need" : "Main agent has a question");
    } catch (e) {
      sp.fail(`Main agent could not think it through: ${e instanceof Error ? e.message : e}`);
      return fallbackInterview(me, cap, history);
    }
    if (!turn.done && turn.question && !forceDone) {
      history.push({ role: "agent", text: turn.question });
      const a = turn.choices?.length ? await ui.choose(turn.question, turn.choices.slice(0, 6), { allowOther: true }) : await ui.ask(turn.question);
      history.push({ role: "member", text: a });
      asked++;
      continue;
    }
    const brief = normalizeBrief(turn.brief, cap);
    if (!brief.locations.length) {
      const cities = await ui.ask("Which cities should I search?", { hint: "Separate with commas, e.g. Riyadh, Jeddah" });
      brief.locations = cities.split(/[,،]/).map((s) => s.trim()).filter(Boolean).slice(0, 5);
    }
    const agents = [...new Set<Finder>(["google", ...(turn.plan?.agents ?? []).filter((a) => FINDERS.includes(a))])];
    return { brief, agents, queries: (turn.plan?.queries ?? []).slice(0, 6), reason: turn.plan?.reason ?? "", summary: turn.summary ?? "" };
  }
}

/** If the AI can't run the interview, ask the classic Masar questions instead. */
async function fallbackInterview(me: Me | null, cap: number, history: { role: string; text: string }[]): Promise<Plan> {
  ui.info("Switching to the quick questions.");
  const names = INDUSTRIES.map((i) => i.en);
  const pick = await ui.choose("Which kind of business do you want to reach?", names, { allowOther: true });
  const ind = INDUSTRIES.find((i) => i.en === pick);
  const cities = await ui.ask("Which cities?", { default: (me?.setup?.cities ?? []).slice(0, 3).join(", ") || "Riyadh" });
  const offer = await ui.ask("In one line, what do you sell them?", { default: history.find((h) => h.role === "member")?.text });
  const count = Number(await ui.ask("How many leads?", { default: String(Math.min(30, cap)) })) || 30;
  const b2b = ind ? ["offices_companies", "hardware_construction", "real_estate", "schools", "clinics", "hotels"].includes(ind.key) : true;
  return {
    brief: normalizeBrief({ industry: ind?.key ?? "custom", industryCustom: ind ? "" : pick, locations: cities.split(/[,،]/), offer, count }, cap),
    agents: ["google", "website", ...(b2b ? (["linkedin", "facebook"] as Finder[]) : (["instagram", "facebook"] as Finder[]))],
    queries: [], reason: b2b ? "Selling to companies, so LinkedIn decision makers matter most." : "Consumer-facing businesses are most active on Instagram and Facebook.",
    summary: `${ind?.en ?? pick} in ${cities}, ${count} leads.`,
  };
}
