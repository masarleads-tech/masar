"use client";

import { use } from "react";
import { Footer } from "@/components/Landing";
import { Logo, useSite } from "@/components/site";
import { LEGAL, type DocKey } from "@/lib/legal";

const DOCS: DocKey[] = ["privacy", "terms", "refund"];

/** Privacy policy, terms of service and refund policy, in Arabic and English. */
export default function LegalPage({ params }: { params: Promise<{ doc: string }> }) {
  const { doc } = use(params);
  const { lang, t, toggleLang } = useSite();
  const key = (DOCS.includes(doc as DocKey) ? doc : "privacy") as DocKey;
  const d = LEGAL[lang][key];
  const names = { privacy: t.legalPrivacy, terms: t.legalTerms, refund: t.legalRefund };

  return (
    <div>
      <header className="border-b border-stone-300 bg-paper-50">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <Logo />
          <button onClick={toggleLang} className="min-h-11 rounded-[6px] px-3 text-sm font-semibold text-ink-800 hover:bg-sand-100">{t.language}</button>
        </div>
      </header>
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[220px_1fr] lg:gap-12 lg:py-14">
        <nav className="flex gap-1 overflow-x-auto text-sm lg:sticky lg:top-8 lg:block lg:space-y-1 lg:self-start">
          {DOCS.map((k) => (
            <a key={k} href={`/legal/${k}`} className={`flex min-h-11 shrink-0 items-center rounded-[6px] px-3 whitespace-nowrap ${k === key ? "bg-teal-100 font-semibold text-teal-800" : "text-stone-500 hover:bg-sand-100 hover:text-ink-950"}`}>{names[k]}</a>
          ))}
        </nav>
        <article className="max-w-3xl">
          <h1 className="t-h1">{d.title}</h1>
          <p className="t-lead text-muted mt-5">{d.intro}</p>
          {d.sections.map((s) => (
            <section key={s.h} className="mt-9">
              <h2 className="text-[19px] font-semibold">{s.h}</h2>
              {s.p.map((p) => <p key={p} className="mt-3 leading-relaxed">{p}</p>)}
            </section>
          ))}
        </article>
      </div>
      <Footer lang={lang} t={t} />
    </div>
  );
}
