"use client";
/* eslint-disable @next/next/no-html-link-for-pages -- auth routes need a full page load */

import { useEffect, useState } from "react";
import { fmtDate, STRINGS, type Lang } from "@/lib/i18n";
import { passesMustHave } from "@/lib/lead";
import { loadSearch } from "@/lib/saved";
import { loadLang, loadRun, type SavedRun } from "@/lib/store";

/** Printable report of the last search. The browser's "Save as PDF" turns it into the PDF. */
export default function Report() {
  const [run, setRun] = useState<SavedRun | null>(null);
  const [lang, setLang] = useState<Lang>("en");
  const [ready, setReady] = useState(false);
  const t = STRINGS[lang];

  useEffect(() => {
    const l = loadLang();
    setLang(l);
    document.documentElement.lang = l === "ar" ? "ar-SA" : "en-GB";
    document.documentElement.dir = l === "ar" ? "rtl" : "ltr";
    const id = new URLSearchParams(location.search).get("search");
    if (!id) { setRun(loadRun()); setReady(true); return; }
    // A saved search from the account (opened from Leads or History).
    loadSearch(id)
      .then((r) => setRun(r ? { brief: r.search.brief, leads: r.leads, sourcesUsed: r.search.sources, at: r.search.createdAt, usage: { inputTokens: 0, outputTokens: 0, webSearches: 0 } } : loadRun()))
      .catch(() => setRun(loadRun()))
      .finally(() => setReady(true));
  }, []);

  if (!ready) return null;
  if (!run) return <main className="p-10 text-center">No results yet. <a className="underline" href="/">{t.newSearch}</a></main>;

  const leads = run.leads.filter((l) => passesMustHave(l, run.brief.mustHave)).sort((a, b) => b.closing - a.closing);
  const date = fmtDate(t, run.at, { day: "numeric", month: "long", year: "numeric" });

  return (
    <main className="mx-auto max-w-5xl bg-white p-6 text-black print:p-0">
      <div className="no-print mb-6 flex gap-2">
        <button onClick={() => window.print()} className="btn-primary">{t.pdf}</button>
        <a href="/" className="btn-secondary">{t.appName}</a>
      </div>
      <header className="border-b-2 border-ink-950 pb-3">
        <h1 className="text-2xl font-bold">{run.brief.clientName || t.appName}</h1>
        <p className="text-sm text-gray-600">
          {leads.length} {t.results} · {run.brief.locations.join(", ")} · {date}
        </p>
        <p className="mt-1 text-sm text-gray-600">{run.brief.offer}</p>
      </header>
      <table className="mt-4 w-full border-collapse text-[11px]">
        <thead>
          <tr className="bg-ink-950 text-white">
            <th className="p-1.5 text-start">#</th>
            <th className="p-1.5 text-start">{t.closing}</th>
            <th className="p-1.5 text-start">{t.fit}</th>
            <th className="p-1.5 text-start">{t.lead}</th>
            <th className="p-1.5 text-start">{t.contact}</th>
            <th className="p-1.5 text-start">{t.decisionMaker}</th>
            <th className="p-1.5 text-start">{t.why}</th>
          </tr>
        </thead>
        <tbody>
          {leads.map((l, i) => (
            <tr key={l.id} className="break-inside-avoid border-b border-gray-200 align-top even:bg-gray-50">
              <td className="p-1.5">{i + 1}</td>
              <td className="p-1.5 font-bold">{l.closing}%</td>
              <td className="p-1.5">{l.fit}%</td>
              <td className="p-1.5">
                <a href={l.mapsUrl || l.website || "#"} className="font-semibold text-teal-700">{l.name}</a>
                <div className="text-gray-600">{[l.category, l.city].filter(Boolean).join(" · ")}</div>
                <div className="text-gray-600">{l.legitimacy ? `${t.legit}: ${t[l.legitimacy]}` : ""}</div>
              </td>
              <td className="p-1.5" dir="ltr">
                {l.phone && <div>{l.phone}</div>}
                {l.whatsapp && <div><a href={`https://wa.me/${l.whatsapp.replace(/\D/g, "")}`}>WhatsApp {l.whatsapp}</a></div>}
                {l.email && <div><a href={`mailto:${l.email}`}>{l.email}</a></div>}
                <div className="flex flex-wrap gap-x-2 text-teal-700">
                  {l.website && <a href={l.website}>Web</a>}
                  {l.instagram && <a href={l.instagram}>Instagram</a>}
                  {l.facebook && <a href={l.facebook}>Facebook</a>}
                  {l.linkedin && <a href={l.linkedin}>LinkedIn</a>}
                </div>
              </td>
              <td className="p-1.5">
                {l.decisionMakers.slice(0, 2).map((d) => (
                  <div key={d.name}>{d.profileUrl ? <a href={d.profileUrl}>{d.name}</a> : d.name} <span className="text-gray-600">{d.title}</span></div>
                ))}
              </td>
              <td className="p-1.5 text-gray-700">{[...l.fitReasons, ...l.closingReasons].slice(0, 4).join(" · ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-4 text-[10px] text-gray-500">{t.privacy}</p>
    </main>
  );
}
