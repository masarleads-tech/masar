"use client";
/* eslint-disable @next/next/no-html-link-for-pages -- plain links keep auth cookies fresh with a full page load */

import { useEffect, useState } from "react";
import { AppShell, PageHead, useSite } from "@/components/site";
import { INDUSTRIES } from "@/lib/industries";
import { fmtDate } from "@/lib/i18n";
import { deleteSearch, listSearches } from "@/lib/saved";
import type { SearchSummary } from "@/lib/types";

/** Every search the signed-in user has run, newest first. Saved in Supabase, so it follows them across devices. */
export default function History() {
  const { lang, t, config, toggleLang } = useSite();
  const [rows, setRows] = useState<SearchSummary[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!config) return;
    if (!config.user) { location.href = "/login"; return; }
    listSearches().then(setRows).catch((e) => { setError(e.message); setRows([]); });
  }, [config]);

  async function remove(id: string) {
    if (!confirm(t.confirmDelete)) return;
    try {
      await deleteSearch(id);
      setRows((r) => r?.filter((x) => x.id !== id) ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const industry = (s: SearchSummary) => {
    if (s.brief.industry === "custom" || s.brief.industryCustom) return s.brief.industryCustom;
    const i = INDUSTRIES.find((x) => x.key === s.brief.industry);
    return i ? (lang === "ar" ? i.ar : i.en) : "";
  };

  return (
    <AppShell t={t} lang={lang} config={config} active="history" onLang={toggleLang}>
      <PageHead title={t.navHistory} sub={t.historySub} actions={<a href="/" className="btn-primary">{t.newLeadsSearch}</a>} />
      <div className="space-y-3 p-4 sm:p-8">
        {error && <p className="rounded-[6px] bg-red-50 p-2.5 text-sm text-red-700">{t.errorPrefix} {error}</p>}
        {rows === null && <p className="text-muted text-sm">{t.loading}</p>}
        {rows?.length === 0 && !error && (
          <div className="card text-center">
            <p className="text-muted">{t.historyEmpty}</p>
            <a href="/" className="btn-primary mt-4">{t.newLeadsSearch}</a>
          </div>
        )}
        {rows && rows.length > 0 && (
          <ul className="divide-y divide-stone-300 overflow-hidden rounded-[10px] border border-stone-300 bg-white">
            {rows.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-3 p-4 sm:px-5">
                <a href={`/?search=${s.id}`} className="group min-w-0 flex-1">
                  <div className="font-semibold group-hover:text-teal-700">{s.brief.clientName || s.brief.offer.slice(0, 60) || t.appName}</div>
                  <div className="text-muted mt-0.5 text-sm">
                    {[industry(s), s.brief.locations.join(", ")].filter(Boolean).join(" · ")}
                  </div>
                </a>
                <div className="text-muted text-sm tabular-nums">
                  <b className="text-ink-950">{s.leadCount}</b> {t.leadsCount} · {fmtDate(t, s.createdAt)}
                </div>
                <div className="flex gap-2">
                  <a href={`/?search=${s.id}`} className="btn-secondary min-h-10 px-3 text-xs">{t.open}</a>
                  <a href={`/report?search=${s.id}`} target="_blank" className="btn-secondary min-h-10 px-3 text-xs">PDF</a>
                  <button onClick={() => remove(s.id)} className="min-h-10 rounded-[6px] px-3 text-xs font-semibold text-stone-500 hover:bg-red-50 hover:text-red-700">{t.delete}</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  );
}
