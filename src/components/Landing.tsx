"use client";
/* eslint-disable @next/next/no-html-link-for-pages -- plain links keep auth cookies fresh with a full page load */

import { useEffect, useRef, useState } from "react";
import type { Lang, Strings } from "@/lib/i18n";
import { LANDING, PRICE, SAMPLE_ROWS, TESTIMONIALS } from "@/lib/landing-copy";
import { CONTACT_EMAIL, Logo, Mark } from "./site";

type Copy = (typeof LANDING)[Lang];

/** Adds `is-in` to every [data-reveal] element as it scrolls into view. */
function useReveal(dep: unknown) {
  useEffect(() => {
    if (!("IntersectionObserver" in window)) return;
    const root = document.documentElement;
    root.classList.add("reveal-ready");
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => {
        if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); }
      }),
      { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
    );
    document.querySelectorAll("[data-reveal]:not(.is-in)").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [dep]);
}

const delay = (ms: number) => ({ "--d": `${ms}ms` }) as React.CSSProperties;

/** Public home page for visitors who are not logged in. */
export function Landing({ t, lang, onLang }: { t: Strings; lang: Lang; onLang: () => void }) {
  const c = LANDING[lang];
  useReveal(lang);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  return (
    <div className="overflow-x-clip">
      {/* Top bar */}
      <header className={`sticky top-0 z-30 transition-colors duration-200 ${scrolled ? "border-b border-stone-300 bg-paper-50/95 backdrop-blur" : "border-b border-transparent bg-paper-50"}`}>
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Logo />
          <nav className="hidden items-center gap-7 text-[13px] font-semibold tracking-[0.04em] text-stone-500 uppercase md:flex">
            <a href="#platform" className="hover:text-ink-950">{c.nav.platform}</a>
            <a href="#how" className="hover:text-ink-950">{c.nav.how}</a>
            <a href="#pricing" className="hover:text-ink-950">{c.nav.pricing}</a>
            <a href="#tips" className="hover:text-ink-950">{c.nav.tips}</a>
          </nav>
          <div className="flex items-center gap-1 text-sm sm:gap-2">
            <button onClick={onLang} className="min-h-11 rounded-[6px] px-3 font-semibold text-ink-800 hover:bg-sand-100">{t.language}</button>
            <a href="/login" className="hidden min-h-11 items-center rounded-[6px] px-3 font-semibold text-ink-800 hover:bg-sand-100 sm:inline-flex">{t.signIn}</a>
            <a href="/login?mode=signup" className="btn-primary">{t.signUp}</a>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative">
        <div className="pointer-events-none absolute -top-24 end-[-120px] h-[420px] w-[420px] rounded-full bg-teal-100/50" aria-hidden />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pb-16 pt-10 sm:px-6 lg:grid-cols-[1fr_1.08fr] lg:pb-24 lg:pt-16">
          <div>
            <span className="eyebrow fade-up"><span className="h-1.5 w-1.5 rounded-full bg-teal-700" />{c.eyebrow}</span>
            <h1 className="t-display fade-up mt-5 max-w-[14ch]" style={{ animationDelay: "80ms" }}>{c.title}</h1>
            <p className="t-lead text-muted fade-up mt-5 max-w-xl" style={{ animationDelay: "160ms" }}>{c.sub}</p>
            <div className="fade-up mt-8 flex flex-wrap items-center gap-x-6 gap-y-3" style={{ animationDelay: "240ms" }}>
              <a href="/login?mode=signup" className="btn-primary min-h-12 px-6 text-[15px]">{c.ctaPrimary}</a>
              <a href="#how" className="btn-quiet text-[15px]">{c.ctaSecondary} <Arrow /></a>
            </div>
            <div className="fade-up mt-10 max-w-md border-t border-stone-300 pt-5" style={{ animationDelay: "320ms" }}>
              <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
                <span><b className="text-[22px] font-semibold tabular-nums">300</b> <span className="text-muted text-sm">{c.weekly}</span></span>
                <span className="hidden h-6 w-px bg-stone-300 sm:block" />
                <span><b className="text-[22px] font-semibold">{PRICE[lang]}</b> <span className="text-muted text-sm">{c.perMonth}</span></span>
              </div>
              <p className="text-muted mt-2 text-xs">{c.offerNote} <a href="/legal/terms" className="underline underline-offset-2 hover:text-ink-950">{c.terms}</a></p>
            </div>
          </div>
          <HeroMockups c={c} t={t} lang={lang} />
        </div>
      </section>

      {/* The problem */}
      <section className="bg-ink-950 text-white">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 py-16 sm:px-6 md:grid-cols-[1fr_1.2fr] md:py-20">
          <h2 data-reveal className="t-h2">{c.problemTitle}</h2>
          <p data-reveal style={delay(100)} className="t-lead text-white/70">{c.problemBody}</p>
        </div>
      </section>

      <RouteStory c={c} lang={lang} />

      {/* What a lead contains */}
      <section className="border-t border-stone-300 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-24">
          <h2 data-reveal className="t-h2">{c.leadTitle}</h2>
          <p data-reveal style={delay(80)} className="t-lead text-muted mt-3 max-w-2xl">{c.leadSub}</p>
          <div className="mt-10 grid gap-px overflow-hidden rounded-[10px] border border-stone-300 bg-stone-300 sm:grid-cols-2 lg:grid-cols-3">
            {c.leadParts.map(([title, body], i) => (
              <div key={title} data-reveal style={delay(i * 70)} className="bg-white p-6">
                <span className="grid h-10 w-10 place-items-center rounded-[6px] bg-teal-100 text-teal-800"><PartIcon i={i} /></span>
                <h3 className="mt-4 text-[17px] font-semibold">{title}</h3>
                <p className="text-muted mt-1 text-[15px]">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Product: sample results and installing the app */}
      <section id="platform" className="scroll-mt-16">
        <div className="mx-auto grid max-w-6xl gap-12 px-4 py-16 sm:px-6 md:py-24 lg:grid-cols-[1fr_1.3fr] lg:items-center">
          <div>
            <h2 data-reveal className="t-h2">{c.productTitle}</h2>
            <p data-reveal style={delay(80)} className="t-lead text-muted mt-3">{c.productSub}</p>
            <div data-reveal style={delay(160)} className="mt-8 rounded-[10px] border border-stone-300 bg-white p-5">
              <div className="flex items-center gap-2 text-sm font-semibold"><Mark size={22} />{c.installTitle}</div>
              <ul className="text-muted mt-3 space-y-2 text-sm">
                <li>{c.installIos}</li>
                <li>{c.installAndroid}</li>
              </ul>
            </div>
          </div>
          <SampleTable c={c} t={t} lang={lang} />
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="scroll-mt-16 border-y border-stone-300 bg-sand-100">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-24">
          <h2 data-reveal className="t-h2">{c.pricingTitle}</h2>
          <p data-reveal style={delay(80)} className="t-lead text-muted mt-3">{c.pricingSub}</p>
          <div className="mt-10 grid gap-5 md:grid-cols-2">
            <div data-reveal className="rounded-[16px] border border-stone-300 bg-white p-7">
              <div className="text-xs font-semibold tracking-[0.08em] text-stone-500 uppercase">{c.trialName}</div>
              <div className="t-h3 mt-3">{c.trialAmount}</div>
              <div className="text-muted mt-1 text-sm">{c.trialNote}</div>
              <Ticks items={c.trialFeatures} />
              <a href="/login?mode=signup" className="btn-secondary mt-8 w-full">{t.signUp}</a>
            </div>
            <div data-reveal style={delay(100)} className="rounded-[16px] bg-ink-950 p-7 text-white">
              <div className="text-xs font-semibold tracking-[0.08em] text-mint-400 uppercase">{c.planName}</div>
              <div className="mt-3 flex flex-wrap items-baseline gap-2">
                <span className="text-[40px] font-semibold leading-none">{PRICE[lang]}</span>
                <span className="text-white/60">{c.perMonth}</span>
              </div>
              <div className="mt-2 text-sm text-white/70">{c.planAmount}</div>
              <Ticks items={c.planFeatures} dark />
              <a href="/billing" className="btn-primary mt-8 w-full">{c.planCta}</a>
              <p className="mt-3 text-xs text-white/50">{c.offerNote} <a href="/legal/terms" className="underline underline-offset-2 hover:text-white">{c.terms}</a></p>
            </div>
          </div>
        </div>
      </section>

      {/* Tips */}
      <section id="tips" className="scroll-mt-16">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-24">
          <h2 data-reveal className="t-h2">{c.tipsTitle}</h2>
          <ol className="mt-10 grid gap-5 sm:grid-cols-2">
            {c.tips.map(([title, body], i) => (
              <li key={title} data-reveal style={delay(i * 80)} className="flex gap-4 rounded-[10px] border border-stone-300 bg-white p-6">
                <span className="text-[13px] font-semibold text-teal-700 tabular-nums">0{i + 1}</span>
                <div>
                  <h3 className="text-[17px] font-semibold">{title}</h3>
                  <p className="text-muted mt-1 text-[15px]">{body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Testimonials (examples until real quotes are added) */}
      <section className="border-t border-stone-300 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-24">
          <h2 data-reveal className="t-h2">{c.reviewsTitle}</h2>
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {TESTIMONIALS.map((q, i) => (
              <figure key={i} data-reveal style={delay(i * 90)} className="flex flex-col rounded-[10px] border border-stone-300 bg-paper-50 p-6">
                {q.example && <span className="mb-4 w-fit rounded-[6px] bg-sand-200 px-2 py-0.5 text-[11px] font-semibold text-ink-800">{c.example}</span>}
                <blockquote className="flex-1 text-[16px] leading-relaxed">“{q.quote[lang]}”</blockquote>
                <figcaption className="mt-5 border-t border-stone-300 pt-4 text-sm">
                  <div className="font-semibold">{q.name[lang]}</div>
                  <div className="text-muted">{q.role[lang]}</div>
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      {/* Final call to action */}
      <section className="bg-ink-950 text-white">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-4 py-16 sm:px-6 md:flex-row md:items-center md:justify-between md:py-20">
          <div data-reveal>
            <h2 className="t-h2 max-w-2xl">{c.finalTitle}</h2>
            <p className="mt-3 text-white/65">{c.finalSub}</p>
          </div>
          <a data-reveal style={delay(120)} href="/login?mode=signup" className="btn-primary min-h-12 shrink-0 px-6 text-[15px]">{t.signUp}</a>
        </div>
      </section>

      <Footer lang={lang} t={t} />
    </div>
  );
}

function Arrow() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4 text-teal-700 rtl:-scale-x-100" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 10h12M12 6l4 4-4 4" />
    </svg>
  );
}

function Ticks({ items, dark }: { items: readonly string[]; dark?: boolean }) {
  return (
    <ul className="mt-6 space-y-2.5 text-[15px]">
      {items.map((f) => (
        <li key={f} className="flex gap-2.5">
          <svg viewBox="0 0 20 20" className={`mt-1 h-4 w-4 shrink-0 ${dark ? "text-mint-400" : "text-teal-700"}`} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M4 10.5l3.5 3.5L16 6" /></svg>
          <span className={dark ? "text-white/85" : ""}>{f}</span>
        </li>
      ))}
    </ul>
  );
}

const PART_ICONS = [
  "M4 20V8l8-4 8 4v12M9 20v-6h6v6",
  "M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z",
  "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
  "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18",
  "M5 12.5l4 4L19 7",
  "M4 20h16M7 16v-5M12 16V7M17 16v-8",
];

function PartIcon({ i }: { i: number }) {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={PART_ICONS[i % PART_ICONS.length]} />
    </svg>
  );
}

function SampleTag({ c, dark }: { c: Copy; dark?: boolean }) {
  return <span className={`rounded-[4px] px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.06em] uppercase ${dark ? "bg-white/10 text-white/70" : "bg-sand-200 text-ink-800"}`}>{c.sample}</span>;
}

/* ---------- Hero mock-ups: the desktop app with the phone app in front ---------- */

function HeroMockups({ c, t, lang }: { c: Copy; t: Strings; lang: Lang }) {
  const rows = SAMPLE_ROWS[lang];
  return (
    <div className="relative mx-auto w-full max-w-[560px] lg:max-w-none">
      {/* Desktop app (tablets and up) */}
      <div data-reveal className="hidden overflow-hidden rounded-[16px] border border-stone-300 bg-white shadow-[0_24px_60px_-28px_rgba(16,26,27,0.35)] sm:block">
        <div className="flex items-center gap-1.5 border-b border-stone-300 bg-paper-50 px-4 py-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-stone-300" /><span className="h-2.5 w-2.5 rounded-full bg-stone-300" /><span className="h-2.5 w-2.5 rounded-full bg-stone-300" />
          <span className="mx-auto rounded-[6px] bg-white px-10 py-0.5 text-[11px] text-stone-500" dir="ltr">masar.app</span>
        </div>
        <div className="grid grid-cols-[112px_1fr]">
          <div className="space-y-1.5 bg-ink-950 p-3">
            <div className="mb-4 flex items-center gap-1.5" dir="ltr"><Mark size={20} /><span className="text-[12px] font-bold text-white">masar</span></div>
            {[t.navSearch, t.navResults, t.navHistory].map((label, i) => (
              <div key={label} className={`truncate rounded-[4px] px-2 py-1.5 text-[10px] font-medium ${i === 1 ? "bg-ink-800 text-white" : "text-white/55"}`}>{label}</div>
            ))}
            <div className="mt-6 rounded-[6px] border border-ink-800 bg-ink-900 p-2">
              <div className="text-[9px] text-white/55">{c.planName}</div>
              <div className="text-[15px] font-semibold text-white tabular-nums">86</div>
              <div className="mt-1 h-0.5 rounded-full bg-white/10"><div className="h-full w-[86%] rounded-full bg-mint-400" /></div>
            </div>
          </div>
          <div className="min-w-0 p-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-[13px] font-semibold">{t.navResults}</div>
                <div className="text-[10px] text-stone-500">{c.mockSearch}</div>
              </div>
              <SampleTag c={c} />
            </div>
            <div className="mt-3 divide-y divide-stone-300 rounded-[8px] border border-stone-300">
              {rows.map((r, i) => (
                <div key={r.org} className="flex items-center gap-2.5 px-3 py-2.5">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[6px] bg-teal-100 text-[10px] font-semibold text-teal-800">{r.org.slice(0, 1)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[11px] font-semibold">{r.org}</div>
                    <div className="truncate text-[10px] text-stone-500">{r.city} · {r.role}</div>
                  </div>
                  <div className="w-20 shrink-0">
                    <div className="flex justify-between text-[9px] text-stone-500"><span>{t.closing}</span><b className="text-ink-950">{r.closing}%</b></div>
                    <div className="mt-1 h-1 rounded-full bg-sand-200"><div className="bar-fill h-full rounded-full bg-teal-700" style={{ width: `${r.closing}%`, ...delay(300 + i * 120) }} /></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Phone app: in front of the desktop on large screens, on its own on phones */}
      <div data-reveal style={delay(200)} className="mx-auto w-[236px] sm:absolute sm:-bottom-10 sm:end-[-12px] sm:w-[200px] lg:end-[-28px] lg:w-[220px]">
        <PhoneMock c={c} t={t} lang={lang} />
      </div>
    </div>
  );
}

function PhoneMock({ c, t, lang }: { c: Copy; t: Strings; lang: Lang }) {
  const rows = SAMPLE_ROWS[lang].slice(0, 2);
  return (
    <div className="rounded-[34px] bg-ink-950 p-[7px] shadow-[0_30px_60px_-24px_rgba(16,26,27,0.5)]">
      <div className="relative overflow-hidden rounded-[28px] bg-paper-50">
        <div className="mx-auto mt-2 h-4 w-20 rounded-full bg-ink-950" />
        <div className="flex items-center justify-between px-3.5 pt-2" dir="ltr">
          <span className="flex items-center gap-1"><Mark size={16} /><span className="text-[11px] font-bold">masar</span></span>
          <SampleTag c={c} />
        </div>
        <div className="mx-3 mt-2.5 rounded-[10px] bg-ink-950 p-3 text-white">
          <div className="text-[9px] text-white/60">{c.mockWeek}</div>
          <div className="mt-0.5 flex items-baseline gap-1"><span className="text-[22px] font-semibold leading-none">100</span><span className="text-[9px] text-white/65">{c.mockNew}</span></div>
          <svg viewBox="0 0 160 26" className="mt-2 h-5 w-full rtl:-scale-x-100" aria-hidden>
            <path d="M4 20C40 20 40 6 80 6s40 14 72 14" fill="none" stroke="#72B7A7" strokeWidth="2" strokeLinecap="round" pathLength={1} className="route-line" style={delay(500)} />
            <circle cx="152" cy="20" r="3" fill="#72B7A7" />
          </svg>
        </div>
        <div className="flex items-center justify-between px-3.5 pt-3 text-[10px]">
          <b>{c.mockSuggested}</b><span className="text-teal-700">{c.mockViewAll}</span>
        </div>
        <div className="space-y-1.5 px-3 pt-1.5">
          {rows.map((r) => (
            <div key={r.org} className="rounded-[8px] border border-stone-300 bg-white p-2">
              <div className="flex items-center justify-between gap-1">
                <span className="truncate text-[10px] font-semibold">{r.org}</span>
                <span className="rounded-[4px] bg-teal-100 px-1 text-[9px] font-semibold text-teal-800">{r.closing}%</span>
              </div>
              <div className="truncate text-[9px] text-stone-500">{r.role} · {r.city}</div>
            </div>
          ))}
        </div>
        <div className="mx-3 mt-2.5 rounded-[6px] bg-teal-700 py-1.5 text-center text-[10px] font-semibold text-white">{c.mockExplore}</div>
        <div className="mt-3 grid grid-cols-4 border-t border-stone-300 bg-white px-1 pb-3 pt-1.5 text-center text-[8px] text-stone-500">
          {[t.navSearch, t.navResults, t.navHistory, t.account].map((l, i) => (
            <span key={l} className={`truncate ${i === 1 ? "font-semibold text-teal-700" : ""}`}>{l}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------- Signature scroll sequence: your team → sectors → decision maker → next step ---------- */

function RouteStory({ c, lang }: { c: Copy; lang: Lang }) {
  const [step, setStep] = useState(0);
  const refs = useRef<(HTMLLIElement | null)[]>([]);

  useEffect(() => {
    if (!("IntersectionObserver" in window)) { setStep(3); return; }
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) setStep(Number((e.target as HTMLElement).dataset.step)); }),
      { rootMargin: "-45% 0px -45% 0px" },
    );
    refs.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <section id="how" className="scroll-mt-16">
      <div className="mx-auto max-w-6xl px-4 pt-16 sm:px-6 md:pt-24">
        <h2 data-reveal className="t-h2">{c.howTitle}</h2>
        <div className="mt-4 flex flex-wrap gap-2">
          {c.steps3.map((s, i) => (
            <span key={s} data-reveal style={delay(i * 80)} className="chip pointer-events-none">{s}</span>
          ))}
        </div>
      </div>
      <div className="mx-auto grid max-w-6xl gap-6 px-4 pb-16 sm:px-6 md:pb-24 lg:grid-cols-[0.9fr_1.1fr] lg:gap-14">
        {/* The panel stays in view while the steps scroll past it */}
        <div className="sticky top-[60px] z-10 order-first self-start bg-paper-50 pt-4 pb-2 lg:order-last lg:top-24 lg:bg-transparent lg:pt-10">
          <StoryPanel c={c} lang={lang} step={step} />
        </div>
        <ol className="lg:pt-10">
          {c.how.map(([title, body], i) => (
            <li key={title} ref={(el) => { refs.current[i] = el; }} data-step={i}
              className="flex min-h-[46vh] flex-col justify-center lg:min-h-[62vh]">
              <div className={`story-fade border-s-2 ps-5 ${step === i ? "border-teal-700 opacity-100" : "border-stone-300 opacity-40"}`}>
                <span className="text-[13px] font-semibold text-teal-700 tabular-nums">0{i + 1}</span>
                <h3 className="t-h3 mt-1">{title}</h3>
                <p className="text-muted mt-2 max-w-md text-[16px]">{body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/** Coordinates in a 560 × 440 box. The drawing keeps its direction in Arabic; the words follow the page. */
const P = { you: [70, 240], s: [[200, 120], [200, 240], [200, 360]], dm: [430, 140] } as const;
const pct = ([x, y]: readonly [number, number]) => ({ left: `${(x / 560) * 100}%`, top: `${(y / 440) * 100}%` });

function StoryPanel({ c, lang, step }: { c: Copy; lang: Lang; step: number }) {
  const on = (n: number) => (step >= n ? "is-in" : "");
  const textDir = lang === "ar" ? "rtl" : "ltr";
  return (
    <div dir="ltr" className="relative aspect-[560/440] w-full overflow-hidden rounded-[16px] bg-ink-950 text-white">
      <svg viewBox="0 0 560 440" className="absolute inset-0 h-full w-full" aria-hidden>
        <defs>
          <pattern id="dots" width="28" height="28" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#FAF8F3" opacity=".09" /></pattern>
        </defs>
        <rect width="560" height="440" fill="url(#dots)" />
        {/* Faint routes that exist before the search */}
        {P.s.map(([x, y], i) => (
          <path key={i} d={`M70 240C135 240 135 ${y} ${x} ${y}`} fill="none" stroke="#57716D" strokeWidth="1.5" strokeDasharray="3 7" strokeLinecap="round" />
        ))}
        {/* Branches to sectors */}
        {P.s.map(([x, y], i) => (
          <path key={`b${i}`} d={`M70 240C135 240 135 ${y} ${x} ${y}`} fill="none" stroke={i === 0 ? "#72B7A7" : "#3E5A57"} strokeWidth={i === 0 ? 3 : 2}
            strokeLinecap="round" pathLength={1} className={`route-line ${on(1)}`} style={delay(i * 120)} />
        ))}
        {/* Sector to decision maker */}
        <path d="M200 120C300 120 330 140 430 140" fill="none" stroke="#72B7A7" strokeWidth="3" strokeLinecap="round" pathLength={1} className={`route-line ${on(2)}`} />
        {/* Nodes */}
        <circle cx="70" cy="240" r="26" fill="#263E3C" stroke="#72B7A7" strokeWidth="2" />
        <circle cx="70" cy="240" r="26" fill="none" stroke="#72B7A7" strokeWidth="2" className={step === 0 ? "pulse-dot" : "opacity-0"} />
        {P.s.map(([x, y], i) => (
          <circle key={`n${i}`} cx={x} cy={y} r={i === 0 ? 11 : 8} fill={step >= 1 ? (i === 0 ? "#72B7A7" : "#3E5A57") : "#1C2B2C"} stroke="#57716D" strokeWidth="1.5" className="transition-[fill] duration-500" />
        ))}
        <g className={`story-fade ${step >= 2 ? "opacity-100" : "opacity-0"}`}>
          <circle cx="430" cy="140" r="16" fill="#FAF8F3" />
          <circle cx="430" cy="140" r="6" fill="#176B64" />
          {step === 2 && <circle cx="430" cy="140" r="16" fill="none" stroke="#72B7A7" strokeWidth="2" className="pulse-dot" />}
        </g>
      </svg>

      {/* Labels (localised) */}
      <span className="absolute -translate-x-1/2 translate-y-[30px] text-center text-[11px] font-semibold whitespace-nowrap sm:text-[13px]" style={pct(P.you)} dir={textDir}>{c.nodeYou}</span>
      <span className="absolute top-3 start-4 text-[10px] font-semibold tracking-[0.08em] text-white/70 uppercase sm:top-5 sm:text-[11px]" dir={textDir}>{c.storyLabel}</span>
      <span className="absolute top-3 right-4 text-[10px] text-white/50 tabular-nums sm:top-5 sm:text-[11px]">0{step + 1} / 04</span>
      {P.s.map((p, i) => (
        <span key={i} dir={textDir}
          className={`story-fade absolute -translate-x-1/2 translate-y-[14px] text-[10px] whitespace-nowrap sm:text-[12px] ${step >= 1 ? "opacity-100" : "opacity-0"} ${i === 0 ? "font-semibold text-mint-400" : "text-white/55"}`}
          style={pct(p)}>{c.sectors[i]}</span>
      ))}

      {/* Decision-maker card */}
      <div dir={textDir}
        className={`story-fade absolute right-[3%] bottom-[4%] w-[46%] rounded-[10px] bg-paper-50 p-2.5 text-ink-950 shadow-lg sm:p-4 ${step >= 2 ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"}`}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[9px] font-semibold tracking-[0.06em] text-teal-700 uppercase sm:text-[11px]">{c.nodeDm}</span>
          <SampleTag c={c} />
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-teal-100 sm:h-8 sm:w-8">
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-teal-800 sm:h-4 sm:w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0" /></svg>
          </span>
          <span className="text-[11px] leading-tight font-semibold sm:text-[14px]">{c.cardRole}</span>
        </div>
        <div className="mt-1.5 hidden text-[11px] sm:block">
          <span className="text-stone-500">{c.cardCompany}: </span>{c.cardCompanyValue}
        </div>
        <div className="mt-0.5 text-[9px] text-stone-500 sm:text-[11px]">{c.cardWhyValue}</div>
        <div className={`story-fade mt-2 flex items-center gap-1.5 ${step >= 3 ? "opacity-100" : "opacity-0"}`}>
          <span className="rounded-[6px] bg-teal-700 px-2 py-1 text-[9px] font-semibold text-white sm:text-[11px]">{c.nextStep}</span>
          <span className="text-[9px] font-semibold text-ink-950 sm:text-[11px]">{c.viewLead} →</span>
        </div>
      </div>
    </div>
  );
}

/* ---------- Sample results table ---------- */

function SampleTable({ c, t, lang }: { c: Copy; t: Strings; lang: Lang }) {
  return (
    <div data-reveal className="overflow-hidden rounded-[16px] border border-stone-300 bg-white">
      <div className="flex items-center justify-between border-b border-stone-300 px-5 py-3">
        <span className="text-sm font-semibold">{c.mockSearch}</span>
        <SampleTag c={c} />
      </div>
      <div className="divide-y divide-stone-300">
        {SAMPLE_ROWS[lang].map((r, i) => (
          <div key={r.org} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 px-5 py-4 sm:grid-cols-[1.4fr_1fr_1fr_auto]">
            <div className="min-w-0">
              <div className="truncate font-semibold">{r.org}</div>
              <div className="text-muted truncate text-sm">{r.city} · {r.role}</div>
            </div>
            <div className="order-last col-span-2 grid grid-cols-2 gap-4 sm:order-none sm:col-span-2">
              {([[t.closing, r.closing], [t.fit, r.fit]] as const).map(([label, v], j) => (
                <div key={label}>
                  <div className="flex justify-between text-xs"><span className="text-muted">{label}</span><b className="tabular-nums">{v}%</b></div>
                  <div className="mt-1 h-1.5 rounded-full bg-sand-200"><div className="bar-fill h-full rounded-full bg-teal-700" style={{ width: `${v}%`, ...delay(i * 120 + j * 60) }} /></div>
                </div>
              ))}
            </div>
            <Badge v={r.check as "pass" | "warn"} label={t[r.check as "pass" | "warn"]} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function Footer({ lang, t }: { lang: Lang; t: Strings }) {
  return (
    <footer className="bg-ink-950 text-white/60">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 border-t border-white/10 px-4 py-10 text-sm sm:px-6 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-4">
          <Logo dark small />
          <span>© {new Date().getFullYear()}</span>
        </div>
        <nav className="flex flex-wrap gap-x-6 gap-y-2">
          <a href="/legal/privacy" className="hover:text-white">{t.legalPrivacy}</a>
          <a href="/legal/terms" className="hover:text-white">{t.legalTerms}</a>
          <a href="/legal/refund" className="hover:text-white">{t.legalRefund}</a>
          <a href={`mailto:${CONTACT_EMAIL}`} className="hover:text-white" dir="ltr">{CONTACT_EMAIL}</a>
        </nav>
      </div>
      <p className="pb-safe mx-auto max-w-6xl px-4 pb-10 text-xs text-white/40 sm:px-6">{LANDING[lang].footer}</p>
    </footer>
  );
}

export function Score({ value }: { value: number }) {
  const color = value >= 60 ? "bg-teal-700" : value >= 40 ? "bg-mint-400" : "bg-stone-300";
  return (
    <div className="flex items-center gap-2">
      <span className="w-9 font-semibold tabular-nums">{value}%</span>
      <div className="hidden h-1.5 w-14 overflow-hidden rounded-full bg-sand-200 sm:block">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

const BADGE = {
  pass: "bg-teal-100 text-teal-800",
  warn: "bg-copper-100 text-copper-600",
  fail: "bg-red-50 text-red-700",
};

export function Badge({ v, title, label }: { v: "pass" | "warn" | "fail"; title?: string; label?: string }) {
  return <span title={title} className={`inline-flex rounded-[6px] px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${BADGE[v]}`}>{label ?? v}</span>;
}
