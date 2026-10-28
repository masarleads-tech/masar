"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { INDUSTRIES } from "@/lib/industries";
import type { Lang, Strings } from "@/lib/i18n";
import { AppShell, PageHead, useSite, type NavKey } from "@/components/site";
import { Badge, Landing, Score } from "@/components/Landing";
import { passesMustHave } from "@/lib/lead";
import { latestSearchId, loadSearch, saveOutcome } from "@/lib/saved";
import { keyHeaders, loadKeys, loadRun, saveKeys, saveRun, type SavedRun } from "@/lib/store";
import type { Brief, DiscoverResponse, EnrichResponse, Lead, Outcome } from "@/lib/types";

const DEFAULT_BRIEF: Brief = {
  clientName: "", offer: "", targetType: "business", industry: "cosmetics_retail", industryCustom: "",
  locations: [], size: "any", positioning: "any", channel: "phone", mustHave: ["phone"],
  goodSignals: [], exclude: [], count: 50,
};

const BATCH = 5;
const PARALLEL = 2;
const OUTCOMES: Outcome[] = ["new", "contacted", "meeting", "won", "lost"];
const splitList = (s: string) => s.split(/[,،\n]/).map((x) => x.trim()).filter(Boolean);
const byClosing = (a: Lead, b: Lead) => b.closing - a.closing || b.fit - a.fit;
const noUsage = { inputTokens: 0, outputTokens: 0, webSearches: 0 };

type Phase = "form" | "running" | "results";

export default function Home() {
  const { lang, t, config, reload, toggleLang } = useSite();
  const [brief, setBrief] = useState<Brief>(DEFAULT_BRIEF);
  const [text, setText] = useState({ locations: "", goodSignals: "", exclude: "" });
  const [phase, setPhase] = useState<Phase>("form");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [searchId, setSearchId] = useState<string | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0, step: "" });
  const [usage, setUsage] = useState(noUsage);
  const [sourcesUsed, setSourcesUsed] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [showKeys, setShowKeys] = useState(false);
  const [welcome, setWelcome] = useState(false);
  const [view, setView] = useState<NavKey>("search");
  const abort = useRef<AbortController | null>(null);

  const user = config?.user ?? null;

  function show(b: Brief, ls: Lead[], sources: string[], id: string | null) {
    setBrief(b);
    setText({ locations: b.locations.join(", "), goodSignals: b.goodSignals.join(", "), exclude: b.exclude.join(", ") });
    setLeads(ls);
    setSourcesUsed(sources);
    setSearchId(id);
    setPhase("results");
  }

  // Open the search named in the address (from History), or the latest one.
  useEffect(() => {
    if (!config) return;
    const q = new URLSearchParams(location.search);
    setWelcome(q.has("welcome"));
    if (q.get("view") === "results") setView("results");
    const wanted = q.get("search");
    if (config.accountsEnabled) {
      if (!config.user) return;
      (async () => {
        // "?new=1" opens an empty search form instead of the latest search
        const id = wanted ?? (q.has("new") ? null : await latestSearchId());
        const found = id ? await loadSearch(id) : null;
        if (found?.leads.length) {
          show(found.search.brief, found.leads, found.search.sources, found.search.id);
          if (wanted) setView("results");
        }
      })().catch(() => {});
    } else {
      const last = loadRun();
      if (last?.leads.length) { show(last.brief, last.leads, last.sourcesUsed, null); setUsage(last.usage); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per signed-in user
  }, [config?.accountsEnabled, config?.user?.email]);

  const signedOut = !!config?.accountsEnabled && !user;
  const credits = config?.accountsEnabled ? user?.credits ?? 0 : null;
  const needsKey = config && !config.hasServerClaudeKey && !(config.allowUserKeys && loadKeys().claude);
  const disabledReason = user && !user.confirmed ? t.confirmFirst
    : credits === 0 ? t.noCredits
    : needsKey ? (config?.allowUserKeys ? `${t.keysTitle}: ${t.claudeKey}` : t.noServerKey) : "";

  async function post<T>(url: string, body: unknown, signal: AbortSignal): Promise<T> {
    const res = await fetch(url, { method: "POST", headers: keyHeaders(), body: JSON.stringify(body), signal });
    const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
    return data as T;
  }

  async function run(e: React.FormEvent) {
    e.preventDefault();
    const b: Brief = {
      ...brief,
      locations: splitList(text.locations),
      goodSignals: splitList(text.goodSignals),
      exclude: splitList(text.exclude),
      count: credits === null ? brief.count : Math.max(1, Math.min(brief.count, credits)),
    };
    setBrief(b);
    setErrors([]);
    setLeads([]);
    setSearchId(null);
    setUsage(noUsage);
    setPhase("running");
    setProgress({ done: 0, total: 0, step: t.finding });
    const ctrl = new AbortController();
    abort.current = ctrl;
    const total = { ...noUsage };
    let current: Lead[] = [];
    let found: string[] = [];
    let id: string | null = null;
    try {
      const d = await post<DiscoverResponse>("/api/discover", b, ctrl.signal);
      found = d.sourcesUsed;
      id = d.searchId ?? null;
      setSearchId(id);
      setSourcesUsed(found);
      if (d.warnings.length) setErrors(d.warnings);
      current = d.leads;
      setLeads(current);
      // Research the best candidates first, a few at a time, so results appear as they are ready.
      const queue = current.slice(0, b.count);
      const batches: Lead[][] = [];
      for (let i = 0; i < queue.length; i += BATCH) batches.push(queue.slice(i, i + BATCH));
      setProgress({ done: 0, total: queue.length, step: t.checking });
      let done = 0;
      let next = 0;
      const worker = async () => {
        while (next < batches.length && !ctrl.signal.aborted) {
          const batch = batches[next++];
          try {
            const r = await post<EnrichResponse>("/api/enrich", { brief: b, leads: batch, searchId: id }, ctrl.signal);
            const map = new Map(r.leads.map((l) => [l.id, l]));
            current = current.map((l) => map.get(l.id) ?? l);
            total.inputTokens += r.usage.inputTokens;
            total.outputTokens += r.usage.outputTokens;
            total.webSearches += r.usage.webSearches;
            if (r.creditsLeft === 0) ctrl.abort();
          } catch (err) {
            if (ctrl.signal.aborted) return;
            setErrors((x) => [...x, err instanceof Error ? err.message : String(err)]);
          }
          done += batch.length;
          setLeads([...current]);
          setUsage({ ...total });
          setProgress({ done, total: queue.length, step: t.checking });
        }
      };
      await Promise.all(Array.from({ length: PARALLEL }, worker));
    } catch (err) {
      if (!ctrl.signal.aborted) setErrors((x) => [...x, err instanceof Error ? err.message : String(err)]);
    }
    const final = current.filter((l) => l.enriched).sort(byClosing);
    const keep = (final.length ? final : current).slice(0, b.count);
    setLeads(keep);
    saveRun({ brief: b, leads: keep, usage: total, sourcesUsed: found, at: new Date().toISOString() });
    setPhase(keep.length ? "results" : "form");
    if (keep.length) setView("results");
    reload();
  }

  function setOutcome(lead: Lead, outcome: Outcome) {
    setLeads((ls) => ls.map((l) => (l.id === lead.id ? { ...l, outcome } : l)));
    if (lead.rowId) saveOutcome(lead.rowId, outcome).catch((e) => setErrors((x) => [...x, e instanceof Error ? e.message : String(e)]));
  }

  if (!config) return <div className="min-h-screen bg-paper-50" />;
  if (signedOut) return <Landing t={t} lang={lang} onLang={toggleLang} />;

  const errorBox = errors.length > 0 && (
    <div className="rounded-[10px] border border-copper-600/30 bg-copper-100 p-3 text-sm text-ink-950">
      {[...new Set(errors)].slice(0, 5).map((m) => <p key={m}>{t.errorPrefix} {m}</p>)}
    </div>
  );
  const sorted = [...leads].sort(byClosing);
  const showResults = view === "results" && phase !== "running";

  return (
    <AppShell t={t} lang={lang} config={config} active={showResults ? "results" : "search"} onLang={toggleLang}
      onNav={(k) => setView(k)} onKeys={() => setShowKeys(true)}>
      {showKeys && <KeysDialog t={t} onClose={() => setShowKeys(false)} />}
      {showResults ? (
        <Results t={t} brief={brief} leads={leads} usage={usage} sourcesUsed={sourcesUsed} searchId={searchId}
          canTrack={!!config.accountsEnabled} onOutcome={setOutcome} errorBox={errorBox}
          onNew={() => { setView("search"); setPhase("form"); setErrors([]); setWelcome(false); }} />
      ) : (
        <>
          <PageHead title={t.navSearch} sub={t.searchSub} />
          <div className="grid gap-6 p-4 sm:p-8 xl:grid-cols-[400px_1fr]">
            <div className="space-y-4">
              {welcome && user && <p className="rounded-[10px] border border-teal-700/30 bg-teal-100 p-3 text-sm text-teal-800">{t.welcome}</p>}
              <IntakeForm
                t={t} lang={lang} brief={brief} setBrief={setBrief} text={text} setText={setText} onSubmit={run}
                disabledReason={disabledReason} maxCount={credits} running={phase === "running"}
                onFixKey={() => { if (needsKey && config?.allowUserKeys) setShowKeys(true); }}
              />
            </div>
            <div className="min-w-0 space-y-4">
              {phase === "running" && <ProgressBar t={t} progress={progress} onStop={() => abort.current?.abort()} />}
              {errorBox}
              {phase === "running" || (phase === "results" && leads.length)
                ? (
                  <>
                    {phase === "results" && (
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold">{leads.length} {t.results}{brief.clientName ? ` · ${brief.clientName}` : ""}</p>
                        <button onClick={() => setView("results")} className="btn-quiet">{t.navResults} <span className="rtl:-scale-x-100">→</span></button>
                      </div>
                    )}
                    <LeadList t={t} leads={sorted} />
                  </>
                )
                : <EmptyState t={t} />}
            </div>
          </div>
        </>
      )}
      <p className="text-muted px-4 pb-8 text-xs sm:px-8">{t.privacy}</p>
    </AppShell>
  );
}

function EmptyState({ t }: { t: Strings }) {
  return (
    <div className="card flex min-h-[420px] flex-col items-center justify-center text-center">
      <svg viewBox="0 0 96 96" className="h-14 w-14" aria-hidden>
        <rect width="96" height="96" rx="20" fill="#DCECE7" />
        <path d="M25 67V34c0-5 4-9 9-9h10c5 0 9 4 9 9v12c0 5 4 9 9 9h9" fill="none" stroke="#176B64" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" pathLength={1} className="route-draw" />
        <circle cx="74" cy="55" r="7" fill="#176B64" />
      </svg>
      <h2 className="mt-5 text-lg font-semibold">{t.emptyTitle}</h2>
      <p className="text-muted mt-2 max-w-md text-sm">{t.emptyBody}</p>
      <div className="mt-8 w-full max-w-md rounded-[10px] border border-stone-300 p-4 text-start">
        <div className="label">{t.emptyTips}</div>
        <ul className="mt-2 space-y-2 text-sm">
          {[t.tip1, t.tip2, t.tip3].map((x) => <li key={x} className="flex gap-2"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-700" />{x}</li>)}
        </ul>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="text-muted mt-1 block text-xs">{hint}</span>}
    </label>
  );
}

function Choice<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(([v, label]) => (
        <button key={v} type="button" onClick={() => onChange(v)} aria-pressed={value === v} className={`chip ${value === v ? "chip-on" : ""}`}>
          {label}
        </button>
      ))}
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-4 border-t border-stone-300 px-5 py-5 first:border-t-0">
      <div className="text-xs font-semibold tracking-[0.08em] text-teal-700 uppercase">{title}</div>
      {children}
    </div>
  );
}

function IntakeForm({ t, lang, brief, setBrief, text, setText, onSubmit, disabledReason, onFixKey, maxCount, running }: {
  t: Strings; lang: Lang; brief: Brief; setBrief: (b: Brief) => void;
  text: { locations: string; goodSignals: string; exclude: string };
  setText: (x: { locations: string; goodSignals: string; exclude: string }) => void;
  onSubmit: (e: React.FormEvent) => void; disabledReason: string; onFixKey: () => void; maxCount: number | null; running: boolean;
}) {
  const set = <K extends keyof Brief>(k: K, v: Brief[K]) => setBrief({ ...brief, [k]: v });
  const toggleMust = (m: Brief["mustHave"][number]) =>
    set("mustHave", brief.mustHave.includes(m) ? brief.mustHave.filter((x) => x !== m) : [...brief.mustHave, m]);
  const ready = brief.offer.trim() && text.locations.trim() && !disabledReason && !running;
  const max = maxCount === null ? 150 : Math.max(1, Math.min(150, maxCount));

  return (
    <form onSubmit={onSubmit} className="overflow-hidden rounded-[10px] border border-stone-300 bg-white">
      <Group title={t.sectionWho}>
        <Field label={t.clientName}>
          <input className="input" value={brief.clientName} placeholder={t.clientNamePh} onChange={(e) => set("clientName", e.target.value)} />
        </Field>
        <Field label={t.offer} hint={t.offerWhy}>
          <textarea className="input min-h-20" required value={brief.offer} placeholder={t.offerPh} onChange={(e) => set("offer", e.target.value)} />
        </Field>
      </Group>
      <Group title={t.sectionTarget}>
        <Field label={t.targetType}>
          <Choice value={brief.targetType} onChange={(v) => set("targetType", v)} options={[["business", t.business], ["individual", t.individual]]} />
        </Field>
        <Field label={t.industry}>
          <select className="input" value={brief.industry} onChange={(e) => set("industry", e.target.value)}>
            {INDUSTRIES.map((i) => <option key={i.key} value={i.key}>{lang === "ar" ? i.ar : i.en}</option>)}
            <option value="custom">{t.industryCustom}</option>
          </select>
        </Field>
        <Field label={t.industryCustom}>
          <input className="input" value={brief.industryCustom} placeholder={t.industryCustomPh} onChange={(e) => set("industryCustom", e.target.value)} />
        </Field>
        <Field label={t.locations} hint={t.locationsWhy}>
          <input className="input" required value={text.locations} placeholder={t.locationsPh} onChange={(e) => setText({ ...text, locations: e.target.value })} />
        </Field>
      </Group>
      <Group title={t.sectionFilters}>
        <Field label={t.size}>
          <Choice value={brief.size} onChange={(v) => set("size", v)} options={[["any", t.sizeAny], ["independent", t.sizeIndependent], ["chain", t.sizeChain]]} />
        </Field>
        <Field label={t.positioning}>
          <Choice value={brief.positioning} onChange={(v) => set("positioning", v)} options={[["any", t.posAny], ["premium", t.posPremium], ["mid", t.posMid], ["budget", t.posBudget]]} />
        </Field>
        <Field label={t.channel}>
          <Choice value={brief.channel} onChange={(v) => set("channel", v)} options={[["phone", t.chPhone], ["email", t.chEmail], ["social", t.chSocial], ["visit", t.chVisit], ["any", t.chAny]]} />
        </Field>
        <Field label={t.mustHave}>
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
            {([["phone", t.mhPhone], ["email", t.mhEmail], ["website", t.mhWebsite], ["social", t.mhSocial]] as const).map(([m, label]) => (
              <label key={m} className="flex min-h-9 items-center gap-2">
                <input type="checkbox" checked={brief.mustHave.includes(m)} onChange={() => toggleMust(m)} className="h-4 w-4 accent-teal-700" />
                {label}
              </label>
            ))}
          </div>
        </Field>
        <Field label={t.goodSignals}>
          <input className="input" value={text.goodSignals} placeholder={t.goodSignalsPh} onChange={(e) => setText({ ...text, goodSignals: e.target.value })} />
        </Field>
        <Field label={t.exclude}>
          <input className="input" value={text.exclude} placeholder={t.excludePh} onChange={(e) => setText({ ...text, exclude: e.target.value })} />
        </Field>
      </Group>
      <div className="space-y-3 border-t border-stone-300 bg-sand-100/60 px-5 py-5">
        <Field label={`${t.count}: ${Math.min(brief.count, max)}`}>
          <input type="range" min={Math.min(5, max)} max={max} step={max > 20 ? 5 : 1} value={Math.min(brief.count, max)} onChange={(e) => set("count", Number(e.target.value))} className="w-full accent-teal-700" />
        </Field>
        <button type="submit" disabled={!ready} className="btn-primary min-h-12 w-full text-[15px]">{t.start}</button>
        {disabledReason && (
          <button type="button" onClick={onFixKey} className="w-full text-start text-sm text-copper-600">{disabledReason}</button>
        )}
      </div>
    </form>
  );
}

function ProgressBar({ t, progress, onStop }: { t: Strings; progress: { done: number; total: number; step: string }; onStop: () => void }) {
  const pct = progress.total ? Math.round((100 * progress.done) / progress.total) : 5;
  return (
    <div className="card py-4">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="flex items-center gap-2 font-medium">
          <span className="h-2 w-2 animate-pulse rounded-full bg-teal-700" />
          {progress.step}{progress.total ? ` ${progress.done} ${t.of} ${progress.total}` : ""}
        </span>
        <button onClick={onStop} className="btn-secondary min-h-9 py-1">{t.stop}</button>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-sand-200">
        <div className={`h-full rounded-full bg-teal-700 transition-[width] duration-500 ${progress.total ? "" : "animate-pulse"}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Results({ t, brief, leads, usage, sourcesUsed, searchId, canTrack, onOutcome, errorBox, onNew }: {
  t: Strings; brief: Brief; leads: Lead[]; usage: SavedRun["usage"]; sourcesUsed: string[]; searchId: string | null;
  canTrack: boolean; onOutcome: (l: Lead, o: Outcome) => void; errorBox: React.ReactNode; onNew: () => void;
}) {
  const [filter, setFilter] = useState<"all" | "phone" | "legit">("all");
  const [mustOnly, setMustOnly] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const shown = useMemo(() => leads
    .filter((l) => !mustOnly || passesMustHave(l, brief.mustHave))
    .filter((l) => filter === "all" || (filter === "phone" ? !!(l.phone || l.whatsapp) : l.legitimacy === "pass"))
    .sort(byClosing), [leads, filter, mustOnly, brief.mustHave]);

  async function excel() {
    setDownloading(true);
    try {
      const res = await fetch("/api/export", { method: "POST", headers: keyHeaders(), body: JSON.stringify({ brief, leads: shown }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `masar-${(brief.clientName || "leads").replace(/[^\p{L}\p{N}]+/gu, "-")}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setDownloading(false);
    }
  }

  const withPhone = leads.filter((l) => l.phone || l.whatsapp).length;
  const passed = leads.filter((l) => l.legitimacy === "pass").length;
  const named = leads.filter((l) => l.decisionMakers.length).length;
  const avg = leads.length ? Math.round(leads.reduce((n, l) => n + l.closing, 0) / leads.length) : 0;

  return (
    <>
      <PageHead
        title={`${t.navResults}${brief.clientName ? ` · ${brief.clientName}` : ""}`}
        sub={t.resultsSub}
        actions={leads.length > 0 && <>
          <button onClick={excel} disabled={downloading} className="btn-primary">{t.excel}</button>
          <a href={`/report${searchId ? `?search=${searchId}` : ""}`} target="_blank" className="btn-secondary">{t.pdf}</a>
          <button onClick={onNew} className="btn-secondary">{t.newSearch}</button>
        </>}
      />
      <div className="space-y-5 p-4 sm:p-8">
        {errorBox}
        {leads.length === 0 ? <EmptyState t={t} /> : <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {([[t.results, leads.length], [t.filterPhone, withPhone], [t.filterLegit, passed], [t.decisionMakers, named]] as const).map(([k, v]) => (
              <div key={k} className="rounded-[10px] border border-stone-300 bg-white p-3 sm:p-4">
                <div className="text-muted text-xs font-semibold">{k}</div>
                <div className="mt-0.5 text-[22px] font-semibold tabular-nums sm:mt-1 sm:text-[26px]">{v}</div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <Choice value={filter} onChange={setFilter} options={[["all", t.filterAll], ["phone", t.filterPhone], ["legit", t.filterLegit]]} />
              {brief.mustHave.length > 0 && (
                <label className="flex min-h-9 items-center gap-2">
                  <input type="checkbox" checked={mustOnly} onChange={(e) => setMustOnly(e.target.checked)} className="h-4 w-4 accent-teal-700" />
                  {t.mustHave}
                </label>
              )}
            </div>
            <p className="text-muted text-xs">
              {t.closing} ⌀ {avg}% · {t.sourcesUsed}: {sourcesUsed.join(", ") || "-"}{usage.webSearches ? ` · ${usage.webSearches} ${t.searchesUsed}` : ""}
            </p>
          </div>
          <LeadList t={t} leads={shown} onOutcome={canTrack ? onOutcome : undefined} />
        </>}
      </div>
    </>
  );
}

function Link({ href, children }: { href: string | null; children: React.ReactNode }) {
  if (!href) return null;
  return <a href={href} target="_blank" rel="noopener noreferrer" className="font-medium text-teal-700 underline-offset-2 hover:text-teal-800 hover:underline">{children}</a>;
}

function OutcomeSelect({ t, lead, onOutcome }: { t: Strings; lead: Lead; onOutcome: (l: Lead, o: Outcome) => void }) {
  const v = lead.outcome ?? "new";
  const tone = v === "won" ? "border-teal-700 bg-teal-100 text-teal-800" : v === "lost" ? "text-stone-500" : v === "new" ? "" : "border-ink-800";
  return (
    <select aria-label={t.status} value={v} onChange={(e) => onOutcome(lead, e.target.value as Outcome)}
      className={`min-h-9 rounded-[6px] border border-stone-300 bg-white px-2 text-xs font-semibold outline-none focus:border-teal-700 ${tone}`}>
      {OUTCOMES.map((o) => <option key={o} value={o}>{t.outcomes[o]}</option>)}
    </select>
  );
}

/** Table on wide screens, cards on phones. */
function LeadList({ t, leads, onOutcome }: { t: Strings; leads: Lead[]; onOutcome?: (l: Lead, o: Outcome) => void }) {
  const track = onOutcome && leads.some((l) => l.rowId);
  return (
    <>
      <div className="hidden overflow-x-auto rounded-[10px] border border-stone-300 bg-white md:block">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-paper-50 text-[11px] font-semibold tracking-[0.04em] text-stone-500 uppercase">
            <tr className="border-b border-stone-300">
              <th className="w-10 px-4 py-3 text-start">#</th>
              <th className="px-4 py-3 text-start">{t.lead}</th>
              <th className="px-4 py-3 text-start">{t.closing}</th>
              <th className="px-4 py-3 text-start">{t.fit}</th>
              <th className="px-4 py-3 text-start">{t.contact}</th>
              <th className="px-4 py-3 text-start">{t.online}</th>
              <th className="px-4 py-3 text-start">{t.decisionMaker}</th>
              <th className="px-4 py-3 text-start">{t.legit}</th>
              {track && <th className="px-4 py-3 text-start">{t.status}</th>}
            </tr>
          </thead>
          <tbody>
            {leads.map((l, i) => (
              <tr key={l.id} className={`border-b border-stone-300 align-top transition-colors last:border-0 hover:bg-paper-50 ${l.enriched ? "" : "opacity-55"}`}>
                <td className="text-muted px-4 py-3 tabular-nums">{i + 1}</td>
                <td className="max-w-64 px-4 py-3">
                  <div className="flex items-start gap-3">
                    <div className="grid h-8 w-8 shrink-0 place-items-center rounded-[6px] bg-teal-100 text-[11px] font-semibold text-teal-800">{initials(l.name)}</div>
                    <div className="min-w-0">
                      <div className="font-semibold">{l.mapsUrl ? <Link href={l.mapsUrl}>{l.name}</Link> : l.name}</div>
                      <div className="text-muted text-xs">{[l.category, l.city].filter(Boolean).join(" · ")}</div>
                      {l.rating != null && <div className="text-muted text-xs">★ {l.rating} ({l.reviews ?? 0})</div>}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">{l.enriched ? <Score value={l.closing} /> : <span className="text-muted">…</span>}</td>
                <td className="px-4 py-3"><Score value={l.fit} /></td>
                <td className="px-4 py-3 text-xs leading-6"><Contacts t={t} l={l} /></td>
                <td className="px-4 py-3 text-xs leading-6"><Socials l={l} /></td>
                <td className="px-4 py-3 text-xs">
                  {l.decisionMakers.slice(0, 2).map((d) => (
                    <div key={d.name}>{d.profileUrl ? <Link href={d.profileUrl}>{d.name}</Link> : d.name}<span className="text-muted"> · {d.title}</span></div>
                  ))}
                </td>
                <td className="px-4 py-3">{l.legitimacy && <Badge v={l.legitimacy} label={t[l.legitimacy]} title={l.legitimacyReason} />}</td>
                {track && <td className="px-4 py-3">{l.rowId && <OutcomeSelect t={t} lead={l} onOutcome={onOutcome!} />}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="space-y-3 md:hidden">
        {leads.map((l, i) => (
          <li key={l.id} className={`rounded-[10px] border border-stone-300 bg-white p-4 ${l.enriched ? "" : "opacity-55"}`}>
            <div className="flex items-start gap-3">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-[6px] bg-teal-100 text-xs font-semibold text-teal-800">{initials(l.name)}</div>
              <div className="min-w-0 flex-1">
                <div className="font-semibold leading-snug">{i + 1}. {l.name}</div>
                <div className="text-muted text-xs">{[l.category, l.city].filter(Boolean).join(" · ")}</div>
              </div>
              {l.legitimacy && <Badge v={l.legitimacy} label={t[l.legitimacy]} title={l.legitimacyReason} />}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
              <div><div className="text-muted mb-0.5">{t.closing}</div>{l.enriched ? <Score value={l.closing} /> : "…"}</div>
              <div><div className="text-muted mb-0.5">{t.fit}</div><Score value={l.fit} /></div>
            </div>
            {l.decisionMakers.length > 0 && (
              <div className="mt-3 border-t border-stone-300 pt-3 text-xs">
                <div className="text-muted mb-0.5">{t.decisionMaker}</div>
                {l.decisionMakers.slice(0, 2).map((d) => (
                  <div key={d.name}>{d.profileUrl ? <Link href={d.profileUrl}>{d.name}</Link> : d.name}<span className="text-muted"> · {d.title}</span></div>
                ))}
              </div>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-stone-300 pt-3">
              {l.phone && <a href={`tel:${l.phone.replace(/\s/g, "")}`} className="btn-secondary min-h-10 px-3 text-xs">{t.call}</a>}
              {l.whatsapp && <a href={`https://wa.me/${l.whatsapp.replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer" className="btn-primary min-h-10 px-3 text-xs">WhatsApp</a>}
              {l.email && <a href={`mailto:${l.email}`} className="btn-secondary min-h-10 px-3 text-xs">{t.email}</a>}
              <span className="text-xs"><Socials l={l} /></span>
              {onOutcome && l.rowId && <span className="ms-auto"><OutcomeSelect t={t} lead={l} onOutcome={onOutcome} /></span>}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

function Contacts({ t, l }: { t: Strings; l: Lead }) {
  return (
    <>
      {l.phone && <div dir="ltr" className="text-start"><Link href={`tel:${l.phone.replace(/\s/g, "")}`}>{l.phone}</Link></div>}
      {l.whatsapp && <div><Link href={`https://wa.me/${l.whatsapp.replace(/\D/g, "")}`}>WhatsApp</Link></div>}
      {l.email && <div><Link href={`mailto:${l.email}`}>{l.email}</Link></div>}
      {!l.phone && !l.whatsapp && !l.email && <span className="text-muted">{t.noContact}</span>}
    </>
  );
}

function Socials({ l }: { l: Lead }) {
  return (
    <span className="inline-flex flex-wrap gap-x-3">
      <Link href={l.website}>Web</Link>
      <Link href={l.instagram}>Instagram{l.instagramFollowers ? ` ${compact(l.instagramFollowers)}` : ""}</Link>
      <Link href={l.facebook}>Facebook</Link>
      <Link href={l.linkedin}>LinkedIn</Link>
    </span>
  );
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => [...w][0]).join("").toUpperCase();
}

function compact(n: number) {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}

function KeysDialog({ t, onClose }: { t: Strings; onClose: () => void }) {
  const [keys, setKeys] = useState(loadKeys);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-950/50 p-4 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-md space-y-4 rounded-[16px] bg-white p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold">{t.keysTitle}</h2>
        <p className="text-muted text-sm">{t.keysHelp}</p>
        <Field label={t.claudeKey}>
          <input className="input" type="password" autoComplete="off" value={keys.claude} onChange={(e) => setKeys({ ...keys, claude: e.target.value.trim() })} />
        </Field>
        <Field label={t.googleKey}>
          <input className="input" type="password" autoComplete="off" value={keys.google} onChange={(e) => setKeys({ ...keys, google: e.target.value.trim() })} />
        </Field>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="btn-secondary">{t.close}</button>
          <button onClick={() => { saveKeys(keys); onClose(); location.reload(); }} className="btn-primary">{t.save}</button>
        </div>
      </div>
    </div>
  );
}
