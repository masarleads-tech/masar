import { AGENT_LABEL, bossSearch, envFromProcess, type AgentReport, type CollectorEnv, type ProgressEvent } from "../../src/core";
import type { Lead } from "../../src/lib/types";
import type { AI } from "./ai/base";
import type { Plan } from "./agents/main";
import * as ui from "./ui";
import { VERSION } from "./version";

export interface RunResult { leads: Lead[]; found: Lead[]; reports: AgentReport[]; sources: string[]; durationMs: number }

const MARK: Record<AgentReport["status"], (s: string) => void> = {
  ok: ui.ok, partial: ui.warn, empty: ui.info, error: ui.fail, timeout: ui.fail, unsupported: ui.info, disabled: ui.info, skipped: ui.info,
};

/** Prints one line per agent report; the same reports are saved with the search. */
export function printReport(r: AgentReport) {
  const what = r.agent === "connector" ? "" : r.phase === "discover" ? " search" : r.phase === "enrich" ? " checks" : " ranking";
  const tag = r.status === "ok" ? "" : ui.c.muted(` [${r.status}]`);
  MARK[r.status](`${AGENT_LABEL[r.agent]}${what}: ${r.message || `${r.found} done`}${tag}`);
}

/** Credentials for the official APIs, read from this computer's environment. Never sent to Masar. */
export const cliEnv = (): CollectorEnv => envFromProcess(process.env, `Mozilla/5.0 (compatible; masar-cli/${VERSION})`);

/**
 * The Boss's plan, carried out by the shared core: the eligible collectors run side by side, each with
 * its own time limit; a collector that fails or times out is reported and the rest of the search goes on.
 */
export async function runPipeline(ai: AI, plan: Plan, opts: { env?: CollectorEnv; fetch?: typeof fetch; timeoutMs?: number; signal?: AbortSignal } = {}): Promise<RunResult> {
  const t0 = Date.now();
  const { brief } = plan;
  ui.heading("Boss");
  const sp = ui.spinner(`Looking for ${brief.industryCustom || brief.industry.replace(/_/g, " ")} in ${brief.locations.join(", ")}`);
  const seen = new Set<string>();
  const onProgress = (e: ProgressEvent) => {
    if (e.state === "started") { sp.update(e.message); return; }
    if (!e.report) return;
    // Batches report the same agent again; print each agent's first word per phase, the summary comes at the end.
    const key = `${e.report.agent}:${e.report.phase}`;
    if (e.report.phase === "discover" && !seen.has(key)) { seen.add(key); sp.update(`${AGENT_LABEL[e.report.agent]}: ${e.report.message}`); }
  };
  const r = await bossSearch(
    { brief, options: { sources: plan.sources, websites: plan.websites, openStreetMap: true, timeoutMs: opts.timeoutMs ?? 10 * 60_000 } },
    { llm: ai, env: opts.env ?? cliEnv(), fetch: opts.fetch, onProgress, signal: opts.signal, aiRanking: true },
  );
  if (!r.found.length) sp.fail("No businesses found. Try another city or a broader kind of business.");
  else sp.done(`${r.found.length} businesses found, ${r.leads.length} checked and ranked`);
  ui.heading("Agents");
  for (const rep of r.reports) printReport(rep);
  return { leads: r.leads, found: r.found, reports: r.reports, sources: r.sourcesUsed, durationMs: Date.now() - t0 };
}
