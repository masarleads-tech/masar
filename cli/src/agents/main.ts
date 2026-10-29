import { describeSetup } from "../../../src/core/brief";
import { arr, bool, enm, int, nstr, obj, parseBrief, SOURCES, str, type SourceId } from "../../../src/core";
import { findIndustry, INDUSTRIES } from "../../../src/lib/industries";
import type { Brief } from "../../../src/lib/types";
import type { AI } from "../ai/base";
import type { Me } from "../api";
import * as ui from "../ui";

/**
 * The Boss's interview: talks with the member, one question at a time, until it understands who they
 * sell to, where, and how they like to reach people. Then it writes the brief and picks the collectors
 * to send. The search itself runs in the shared core (bossSearch), the same code the website uses.
 */
export interface Plan { brief: Brief; sources: SourceId[]; websites: boolean; reason: string; summary: string }

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
  plan: obj({ sources: arr(enm([...SOURCES])), websites: bool, reason: str }),
});
type Turn = { done: boolean; question: string | null; choices: string[]; summary: string; brief: Brief; plan: { sources: SourceId[]; websites: boolean; reason: string } };

const MAX_QUESTIONS = 6;

function system(ai: AI, me: Me | null, cap: number) {
  const web = ai.capabilities.webSearch;
  return `You are Masar's Boss agent. You interview a business owner or sales person in a terminal, understand exactly who they want to sell to, and plan the search.
Talk like a sharp, friendly sales researcher. Reply in the language the member writes in (Arabic or English). Ask ONE short question per turn, with 2 to 6 short suggested answers in "choices" when helpful.
Ask only what you still need: what they sell, who buys it (type of business), which cities or countries, the kind of customer (independent vs chain, premium vs budget), how they prefer to reach people, and how many leads. Never ask more than ${MAX_QUESTIONS} questions in total; make sensible assumptions instead.
${describeSetup(me?.setup)}
The member can save at most ${cap} leads in this run; keep "count" at or below ${cap} (default 30).

Industry keys you can use (pick the closest, or "custom" and describe it in industryCustom):
${INDUSTRIES.map((i) => `${i.key}: ${i.en}`).join("\n")}

When you know enough, set done=true, fill the brief, write a 1-2 sentence summary of what you understood, and plan which collectors to send:
- "google_web" finds the businesses (Google Maps, OpenStreetMap${web ? ", web search" : ""}) and checks their contacts and public profiles${web ? " from search results" : ""}. Always include it.
- "instagram" checks Instagram business accounts through Instagram's official API (best for retail, beauty, food, fashion, clinics, consumer brands).
- "facebook" checks Facebook Pages through Meta's official API (good for local services, restaurants, retail).
- "linkedin" checks LinkedIn company pages through LinkedIn's official API (best for B2B, offices, factories, hospitals, schools).
The social collectors only run where the member has connected those APIs; pick the ones that fit anyway.
"websites": true to read each business's own website for emails, phones and social links (recommended).
"reason": one sentence on why this plan.
While done=false, still fill brief and plan with your best guess so far.`;
}

function transcriptText(history: { role: "agent" | "member"; text: string }[]) {
  return history.map((h) => `${h.role === "agent" ? "Masar" : "Member"}: ${h.text}`).join("\n");
}

export function normalizeBrief(b: Partial<Brief>, cap: number): Brief {
  const brief = parseBrief({ industry: "custom", locations: [], ...b });
  if (brief.industry !== "custom" && !findIndustry(brief.industry)) { brief.industryCustom ||= brief.industry.replace(/_/g, " "); brief.industry = "custom"; }
  brief.count = Math.max(1, Math.min(cap, brief.count));
  return brief;
}

export const cleanSources = (x: unknown): SourceId[] =>
  [...new Set<SourceId>(["google_web", ...(Array.isArray(x) ? x : []).filter((a): a is SourceId => (SOURCES as readonly string[]).includes(a))])];

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
    const sp = ui.spinner("Boss is thinking");
    let turn: Turn;
    try {
      turn = await ai.ask<Turn>(`${system(ai, me, cap)}\n\nConversation so far:\n${transcriptText(history)}\n\n${forceDone ? "You must finish now: set done=true." : "Your turn."}`, { schema: TURN });
      sp.done(turn.done ? "Boss understood your need" : "Boss has a question");
    } catch (e) {
      sp.fail(`Boss could not think it through: ${e instanceof Error ? e.message : e}`);
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
    return { brief, sources: cleanSources(turn.plan?.sources), websites: turn.plan?.websites !== false, reason: turn.plan?.reason ?? "", summary: turn.summary ?? "" };
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
    sources: cleanSources(b2b ? ["linkedin", "facebook"] : ["instagram", "facebook"]), websites: true,
    reason: b2b ? "Selling to companies, so LinkedIn decision makers matter most." : "Consumer-facing businesses are most active on Instagram and Facebook.",
    summary: `${ind?.en ?? pick} in ${cities}, ${count} leads.`,
  };
}
