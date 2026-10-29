import { dedupe, isExcluded, markChains, rescore } from "../../src/lib/lead";
import type { Lead } from "../../src/lib/types";
import type { AI } from "./ai/base";
import { document } from "./agents/documenter";
import { discover } from "./agents/google";
import type { Finder, Plan } from "./agents/main";
import { AGENT_LABEL, applySocial, runSocialAgent, type SocialAgent } from "./agents/social";
import { visitAll, type SiteFacts } from "./agents/website";
import * as ui from "./ui";

export interface RunResult { leads: Lead[]; found: number; agentsRan: string[]; sources: string[]; durationMs: number }

/**
 * The main agent's plan, carried out: Google agent → website agent → Instagram, Facebook and LinkedIn
 * agents (side by side, a few businesses at a time) → documenter.
 */
export async function runPipeline(ai: AI, plan: Plan): Promise<RunResult> {
  const t0 = Date.now();
  const { brief } = plan;
  const has = (a: Finder) => plan.agents.includes(a);
  const ran = new Set<string>(["main"]);

  // 1. Google agent
  ui.heading("Google agent");
  const sp = ui.spinner(`Looking for ${brief.industryCustom || brief.industry.replace(/_/g, " ")} in ${brief.locations.join(", ")}`);
  const found = await discover(ai, brief, { useWeb: ai.web, queries: plan.queries, log: (s) => sp.update(s) });
  ran.add("google");
  let leads = markChains(dedupe(found.leads)).filter((l) => !isExcluded(l, brief.exclude)).map((l) => rescore(l, brief));
  leads.sort((a, b) => b.fit - a.fit);
  const total = leads.length;
  if (!total) { sp.fail("No businesses found. Try another city or a broader kind of business."); return { leads: [], found: 0, agentsRan: [...ran], sources: found.sources, durationMs: Date.now() - t0 }; }
  sp.done(`${total} businesses found (${found.sources.join(" + ") || "maps"})`);

  // 2. Website agent, on the most promising ones
  leads = leads.slice(0, Math.min(total, Math.max(brief.count * 2, 20), 120));
  let facts = new Map<string, SiteFacts>();
  if (has("website")) {
    ui.heading("Website agent");
    const withSite = leads.filter((l) => l.website).length;
    const sw = ui.spinner(`Visiting ${withSite} business websites`);
    const r = await visitAll(leads, (n) => sw.update(`Visiting websites (${n}/${leads.length})`));
    leads = r.leads; facts = r.facts;
    ran.add("website");
    const ok = [...facts.values()].filter((f) => f.reachable).length;
    sw.done(`Read ${ok} websites for emails, phones and social links`);
  }

  // 3. Social agents on the top leads
  leads = leads.map((l) => rescore(l, brief)).sort((a, b) => b.fit - a.fit).slice(0, brief.count);
  const social = (["instagram", "facebook", "linkedin"] as SocialAgent[]).filter((a) => has(a));
  if (social.length) {
    ui.heading(social.map((a) => AGENT_LABEL[a]).join(", ") + (social.length > 1 ? " agents" : " agent"));
    if (!ai.web) {
      ui.warn(`${ai.label} can't search the web, so these agents keep only the links each business published on its website or map listing.`);
      ui.info("For full Instagram, Facebook and LinkedIn checks, use Claude, Codex or an API key: masar ai");
      social.forEach((a) => ran.add(a));
    } else {
      const BATCH = 5;
      const ss = ui.spinner(`Checking ${leads.length} businesses`);
      let done = 0, failed = 0;
      for (let i = 0; i < leads.length; i += BATCH) {
        const batch = leads.slice(i, i + BATCH);
        const results = await Promise.allSettled(social.map((a) => runSocialAgent(a, ai, brief, batch)));
        results.forEach((r, k) => {
          const agent = social[k];
          if (r.status === "rejected") { failed++; return; }
          ran.add(agent);
          for (let j = 0; j < batch.length; j++) batch[j] = applySocial(agent, batch[j], r.value.get(batch[j].id));
        });
        for (let j = 0; j < batch.length; j++) leads[i + j] = { ...batch[j], enriched: true };
        done += batch.length;
        ss.update(`Checked ${done}/${leads.length} businesses on ${social.map((a) => AGENT_LABEL[a]).join(", ")}`);
        if (failed >= social.length * 2 && done < leads.length) {
          const first = results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
          ss.warn(`Stopped the social checks early: ${first?.reason instanceof Error ? first.reason.message : first?.reason ?? "errors"}`);
          break;
        }
      }
      if (failed < social.length * 2) ss.done(`Checked ${done} businesses on ${social.map((a) => AGENT_LABEL[a]).join(", ")}${failed ? ` (${failed} batches failed)` : ""}`);
    }
  }

  // 4. Documenter
  ui.heading("Documenter");
  const ranked = await document(ai, brief, leads, facts, { useAi: true });
  ran.add("documenter");
  return { leads: ranked, found: total, agentsRan: [...ran], sources: found.sources, durationMs: Date.now() - t0 };
}
