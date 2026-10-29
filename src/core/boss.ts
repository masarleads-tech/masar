import type { Lead } from "../lib/types";
import { COLLECTORS } from "./collectors";
import type { Collector, CollectorContext, CollectorEnv, CollectorOutput, LeadPatch } from "./collectors/types";
import { applyPatches, compatibility, prepare, rank } from "./intelligence";
import type { LlmConnector } from "./llm";
import {
  AGENT_LABEL, emptyUsage, type AgentReport, type ProgressEvent, type SearchRequest, type SearchResult, type SourceId, type Usage,
} from "./schemas";
import { errMsg, TimeoutError, withTimeout } from "./util";

/**
 * Agent 1, the Boss. Coordinates a search: decides which collectors are eligible, sends them in
 * parallel with a time limit each, keeps whatever succeeded when others fail or time out, reports
 * progress, and hands the results to the Intelligence agent. It never throws for a collector failure:
 * the app and the CLI always get leads (possibly none) plus one report per agent.
 */
export interface BossDeps {
  llm: LlmConnector | null;
  env: CollectorEnv;
  fetch?: typeof fetch;
  collectors?: Collector[];
  onProgress?: (e: ProgressEvent) => void;
  signal?: AbortSignal;
}

type Phase = "discover" | "enrich";

function usageSince(llm: LlmConnector | null, before: Usage): Usage {
  if (!llm) return emptyUsage();
  return { inputTokens: llm.usage.inputTokens - before.inputTokens, outputTokens: llm.usage.outputTokens - before.outputTokens, webSearches: llm.usage.webSearches - before.webSearches };
}

function connectorReport(llm: LlmConnector | null): AgentReport {
  if (!llm) return { agent: "connector", phase: "discover", status: "disabled", message: "No AI connected: web search, web research and AI ranking are off.", found: 0, durationMs: 0 };
  const caps = [llm.capabilities.webSearch ? "web search" : "no web search", llm.capabilities.structured ? "structured answers" : "JSON in prompt",
    llm.capabilities.toolCalling === true ? "tool calling" : llm.capabilities.toolCalling === "unknown" ? "tool calling unknown" : "no tool calling"];
  return { agent: "connector", phase: "discover", status: "ok", message: `${llm.label}${llm.model ? ` (${llm.model})` : ""}: ${caps.join(", ")}`, found: 0, durationMs: 0 };
}

/** Runs one phase across the eligible collectors in parallel. */
async function runPhase<T extends Lead | LeadPatch>(phase: Phase, req: SearchRequest, deps: BossDeps, input: Lead[]): Promise<{ results: { id: SourceId; items: T[] }[]; reports: AgentReport[] }> {
  const all = deps.collectors ?? COLLECTORS;
  const wanted = req.options.sources ? all.filter((c) => req.options.sources!.includes(c.id)) : all;
  const reports: AgentReport[] = [];
  const parent = deps.signal;
  const base = { brief: req.brief, options: req.options, llm: deps.llm, env: deps.env, fetch: deps.fetch ?? fetch };

  const jobs = wanted.map(async (c) => {
    const ctxFor = (signal: AbortSignal): CollectorContext => ({ ...base, signal, log: (m) => deps.onProgress?.({ agent: c.id, phase, state: "started", message: m }) });
    const report = (status: AgentReport["status"], message: string, found = 0, durationMs = 0) => {
      const r: AgentReport = { agent: c.id, phase, status, message, found, durationMs };
      reports.push(r);
      deps.onProgress?.({ agent: c.id, phase, state: "finished", message, report: r });
      return null;
    };
    const avail = c.availability(ctxFor(parent ?? new AbortController().signal), phase);
    if (!avail.ok) return report(avail.status, avail.reason);
    const fn = phase === "discover" ? c.discover : c.enrich;
    if (!fn) return report("unsupported", `${AGENT_LABEL[c.id]} has no authorized way to ${phase === "discover" ? "search for businesses" : "check leads"}.`);
    if (phase === "enrich" && !input.length) return report("skipped", "Nothing to check.");
    deps.onProgress?.({ agent: c.id, phase, state: "started", message: `${AGENT_LABEL[c.id]} started` });
    const t0 = Date.now();
    try {
      const out = (await withTimeout<CollectorOutput<Lead | LeadPatch>>(req.options.timeoutMs, parent, (signal) =>
        phase === "discover" ? c.discover!(ctxFor(signal)) : c.enrich!(ctxFor(signal), input))) as CollectorOutput<T>;
      const items = Array.isArray(out?.items) ? out.items : [];
      const status = out.status ?? (items.length ? "ok" : "empty");
      report(status, out.message || `${items.length} ${phase === "discover" ? "businesses found" : "leads checked"}`, items.length, Date.now() - t0);
      return { id: c.id, items };
    } catch (e) {
      return report(e instanceof TimeoutError ? "timeout" : "error", errMsg(e), 0, Date.now() - t0);
    }
  });
  const settled = await Promise.all(jobs);
  const results = settled.filter((x): x is { id: SourceId; items: T[] } => !!x);
  // Keep the configured order (official APIs last) whatever order they finished in.
  results.sort((a, b) => wanted.findIndex((c) => c.id === a.id) - wanted.findIndex((c) => c.id === b.id));
  return { results, reports };
}

const warningsFrom = (reports: AgentReport[]) =>
  reports.filter((r) => r.status === "error" || r.status === "timeout" || r.status === "partial").map((r) => `${AGENT_LABEL[r.agent]}: ${r.message}`);

const SOURCE_NAME: Partial<Record<string, string>> = { places: "Google Maps", osm: "OpenStreetMap", web_search: "Web search", facebook: "Facebook" };

/** Step 1: find candidates. Returns them deduplicated and ordered by fit. */
export async function bossDiscover(req: SearchRequest, deps: BossDeps): Promise<SearchResult> {
  const before = { ...(deps.llm?.usage ?? emptyUsage()) };
  deps.onProgress?.({ agent: "boss", phase: "discover", state: "started", message: `Searching ${req.brief.locations.join(", ")}` });
  const { results, reports } = await runPhase<Lead>("discover", req, deps, []);
  const leads = prepare(req.brief, results.flatMap((r) => r.items));
  const sourcesUsed = [...new Set(leads.flatMap((l) => (l.provenance ?? []).map((p) => SOURCE_NAME[p.source]).filter((s): s is string => !!s)))];
  const all = [connectorReport(deps.llm), ...reports];
  return { leads, reports: all, sourcesUsed, warnings: warningsFrom(all), usage: usageSince(deps.llm, before) };
}

/** Step 2: check a batch of candidates with every eligible collector at once, then score and rank. */
export async function bossEnrich(req: SearchRequest, leads: Lead[], deps: BossDeps & { aiRanking?: boolean }): Promise<SearchResult> {
  const before = { ...(deps.llm?.usage ?? emptyUsage()) };
  // The Google & web collector first: its website and search findings give the social collectors handles to check.
  const order = deps.collectors ?? COLLECTORS;
  const first = order.filter((c) => c.id === "google_web"), rest = order.filter((c) => c.id !== "google_web");
  const a = await runPhase<LeadPatch>("enrich", req, { ...deps, collectors: first }, leads);
  let merged = applyPatches(leads, a.results.flatMap((r) => r.items));
  const b = await runPhase<LeadPatch>("enrich", req, { ...deps, collectors: rest }, merged);
  merged = applyPatches(merged, b.results.flatMap((r) => r.items)).map((l) => ({ ...l, enriched: true }));
  const reports = [...a.reports, ...b.reports];

  const t0 = Date.now();
  let compat: Awaited<ReturnType<typeof compatibility>> | undefined;
  let note = "Ranked by fit and verified information";
  if (deps.aiRanking && deps.llm && merged.length) {
    try { compat = await withTimeout(req.options.timeoutMs, deps.signal, (signal) => compatibility(deps.llm!, req.brief, merged, signal)); note = "Ranked by fit, AI compatibility and verified information"; }
    catch (e) { note = `AI compatibility skipped (${errMsg(e)}); ranked by fit and verified information`; }
  }
  const ranked = rank(req.brief, merged, compat);
  reports.push({ agent: "intelligence", phase: "rank", status: "ok", message: note, found: ranked.length, durationMs: Date.now() - t0 });
  deps.onProgress?.({ agent: "intelligence", phase: "rank", state: "finished", message: note, report: reports[reports.length - 1] });
  return { leads: ranked, reports, sourcesUsed: [], warnings: warningsFrom(reports), usage: usageSince(deps.llm, before) };
}

/** The whole search in one go (the CLI): discover, check the best candidates in batches, rank. */
export async function bossSearch(req: SearchRequest, deps: BossDeps & { aiRanking?: boolean; batchSize?: number }): Promise<SearchResult & { found: Lead[] }> {
  const d = await bossDiscover(req, deps);
  const queue = d.leads.slice(0, req.brief.count);
  const size = deps.batchSize ?? 5;
  const checked: Lead[] = [];
  const reports = [...d.reports];
  const usage = { ...d.usage };
  for (let i = 0; i < queue.length; i += size) {
    if (deps.signal?.aborted) break;
    deps.onProgress?.({ agent: "boss", phase: "enrich", state: "started", message: `Checking ${Math.min(i + size, queue.length)}/${queue.length}` });
    const r = await bossEnrich(req, queue.slice(i, i + size), { ...deps, aiRanking: false });
    checked.push(...r.leads);
    // Keep one report per agent: the worst status wins so a failure in any batch stays visible.
    for (const rep of r.reports.filter((x) => x.agent !== "intelligence")) {
      const j = reports.findIndex((x) => x.agent === rep.agent && x.phase === rep.phase);
      if (j < 0) reports.push(rep);
      else {
        const worse = ["error", "timeout", "partial"].includes(rep.status) && !["error", "timeout"].includes(reports[j].status);
        reports[j] = { ...(worse ? rep : reports[j]), found: reports[j].found + rep.found, durationMs: reports[j].durationMs + rep.durationMs };
      }
    }
    usage.inputTokens += r.usage.inputTokens; usage.outputTokens += r.usage.outputTokens; usage.webSearches += r.usage.webSearches;
  }
  const before = { ...(deps.llm?.usage ?? emptyUsage()) };
  let compat: Awaited<ReturnType<typeof compatibility>> | undefined;
  let note = "Ranked by fit and verified information";
  const t0 = Date.now();
  if (deps.aiRanking && deps.llm && checked.length) {
    deps.onProgress?.({ agent: "intelligence", phase: "rank", state: "started", message: "Checking how well each lead fits" });
    try { compat = await withTimeout(req.options.timeoutMs, deps.signal, (signal) => compatibility(deps.llm!, req.brief, checked, signal)); note = "Ranked by fit, AI compatibility and verified information"; }
    catch (e) { note = `AI compatibility skipped (${errMsg(e)}); ranked by fit and verified information`; }
  }
  const ranked = rank(req.brief, checked, compat);
  const after = usageSince(deps.llm, before);
  usage.inputTokens += after.inputTokens; usage.outputTokens += after.outputTokens; usage.webSearches += after.webSearches;
  const rep: AgentReport = { agent: "intelligence", phase: "rank", status: "ok", message: note, found: ranked.length, durationMs: Date.now() - t0 };
  reports.push(rep);
  deps.onProgress?.({ agent: "intelligence", phase: "rank", state: "finished", message: note, report: rep });
  return { leads: ranked, found: d.leads, reports, sourcesUsed: d.sourcesUsed, warnings: warningsFrom(reports), usage };
}
