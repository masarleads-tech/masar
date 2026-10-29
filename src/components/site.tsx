"use client";
/* eslint-disable @next/next/no-html-link-for-pages -- plain links keep auth cookies fresh with a full page load */

import { useCallback, useEffect, useState } from "react";
import { fmtDate, STRINGS, type Lang, type Strings } from "@/lib/i18n";
import { loadLang, saveLang } from "@/lib/store";
import type { SiteConfig } from "@/lib/types";

export const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL || "hello@example.com";

/** Language and account state shared by every page. */
export function useSite() {
  const [lang, setLang] = useState<Lang>("en");
  const [config, setConfig] = useState<SiteConfig | null>(null);

  const reload = useCallback(() => {
    fetch("/api/config", { cache: "no-store" }).then((r) => r.json()).then(setConfig).catch(() => setConfig(null));
  }, []);

  useEffect(() => {
    const l = loadLang();
    setLang(l);
    saveLang(l);
    reload();
  }, [reload]);

  useEffect(() => {
    document.documentElement.lang = lang === "ar" ? "ar-SA" : "en-GB";
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  }, [lang]);

  const toggleLang = () => {
    const next = lang === "en" ? "ar" : "en";
    setLang(next);
    saveLang(next);
  };

  return { lang, t: STRINGS[lang], config, reload, toggleLang };
}

/** The Masar route mark: a continuous path turning toward a destination point. */
export function Mark({ size = 36, tile = true }: { size?: number; tile?: boolean }) {
  return (
    <svg viewBox="0 0 96 96" width={size} height={size} aria-hidden="true" className="shrink-0">
      {tile && <rect width="96" height="96" rx="20" fill="#101A1B" />}
      <path d="M25 67V34c0-5 4-9 9-9h10c5 0 9 4 9 9v12c0 5 4 9 9 9h9" fill="none" stroke={tile ? "#FAF8F3" : "currentColor"} strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="74" cy="55" r="7" fill="#72B7A7" />
    </svg>
  );
}

/** Symbol to the left of "masar", with مسار below (bilingual lockup). Never mirrored in RTL. */
export function Logo({ dark, small }: { t?: Strings; dark?: boolean; small?: boolean }) {
  return (
    <a href="/" className="flex items-center gap-2.5" dir="ltr" aria-label="Masar مسار">
      <Mark size={small ? 28 : 34} tile />
      <span className="flex flex-col leading-none">
        <span className={`font-bold tracking-[-0.03em] ${small ? "text-[18px]" : "text-[21px]"} ${dark ? "text-white" : "text-ink-950"}`}>masar</span>
        <span className={`mt-0.5 font-[IBM_Plex_Sans_Arabic] text-[10px] ${dark ? "text-white/55" : "text-stone-500"}`}>مسار</span>
      </span>
    </a>
  );
}

async function logOut() {
  await (window as unknown as { Clerk?: { signOut(): Promise<void> } }).Clerk?.signOut();
  location.href = "/";
}

export type NavKey = "search" | "results" | "history" | "admin" | "account";

const ICONS: Record<NavKey, string> = {
  search: "M21 21l-4.3-4.3M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14z",
  results: "M5 7h14M5 12h14M5 17h9",
  history: "M12 7v5l3 2M21 12a9 9 0 1 1-3-6.7M21 4v4h-4",
  admin: "M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z",
  account: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
};

function Icon({ k, className = "h-5 w-5" }: { k: NavKey; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[k]} />
    </svg>
  );
}

/**
 * Signed-in layout. Desktop: ink sidebar and a paper work area.
 * Phones (iPhone and Android): top bar, content, and a bottom tab bar like a native app.
 */
export function AppShell({ t, lang, config, active, onLang, onNav, onKeys, children }: {
  t: Strings; lang: Lang; config: SiteConfig | null; active: NavKey; onLang: () => void;
  onNav?: (k: NavKey) => void; onKeys?: () => void; children: React.ReactNode;
}) {
  const [sheet, setSheet] = useState(false);
  const user = config?.user ?? null;
  const items: [NavKey, string][] = [["search", t.navSearch], ["results", t.navResults]];
  if (config?.accountsEnabled) items.push(["history", t.navHistory]);
  if (user?.isAdmin) items.push(["admin", t.admin]);

  const go = (k: NavKey) => {
    setSheet(false);
    if (k === "account") return setSheet(true);
    if (k === "admin") location.href = "/admin";
    else if (k === "history") location.href = "/history";
    else if (onNav) onNav(k);
    else location.href = k === "results" ? "/?view=results" : "/?new=1";
  };

  const footer = (
    <div className="space-y-1 border-t border-ink-800 p-3 text-sm">
      {config?.allowUserKeys && onKeys && (
        <button onClick={onKeys} className="w-full rounded-[6px] px-3 py-2.5 text-start text-white/70 hover:bg-white/5 hover:text-white">{t.settings}</button>
      )}
      <button onClick={onLang} className="w-full rounded-[6px] px-3 py-2.5 text-start text-white/70 hover:bg-white/5 hover:text-white">{t.language}</button>
      {user && (
        <button onClick={logOut} className="w-full rounded-[6px] px-3 py-2.5 text-start text-white/70 hover:bg-white/5 hover:text-white">
          {t.signOut}<span className="block truncate text-xs text-white/40">{user.email}</span>
        </button>
      )}
    </div>
  );

  const mobileTabs: [NavKey, string][] = [...items.filter(([k]) => k !== "admin"), ["account", t.account]];

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[256px_1fr]">
      {/* Desktop sidebar */}
      <aside className="no-print sticky top-0 hidden h-screen flex-col bg-ink-950 text-white lg:flex">
        <div className="px-5 py-6"><Logo dark /></div>
        <nav className="flex-1 space-y-1 px-3">
          {items.map(([k, label]) => (
            <button key={k} onClick={() => go(k)} aria-current={active === k ? "page" : undefined}
              className={`flex min-h-11 w-full items-center gap-3 rounded-[6px] px-3 text-sm font-medium transition-colors duration-150 ${active === k ? "bg-ink-800 text-white" : "text-white/65 hover:bg-white/5 hover:text-white"}`}>
              <span className={active === k ? "text-mint-400" : ""}><Icon k={k} /></span>
              {label}
            </button>
          ))}
        </nav>
        {user && <CreditsCard t={t} config={config!} />}
        {footer}
      </aside>

      {/* Phone top bar */}
      <div className="no-print sticky top-0 z-30 flex items-center justify-between border-b border-stone-300 bg-paper-50/95 px-4 py-3 backdrop-blur lg:hidden">
        <Logo small />
        {user && <span className="rounded-[6px] bg-teal-100 px-2.5 py-1 text-xs font-semibold text-teal-800">{user.credits} {t.leadsLeft}</span>}
      </div>

      <main className="min-w-0 pb-24 lg:pb-0">{children}</main>

      {/* Phone bottom tab bar */}
      <nav className="no-print pb-safe fixed inset-x-0 bottom-0 z-30 grid border-t border-stone-300 bg-white/95 backdrop-blur lg:hidden"
        style={{ gridTemplateColumns: `repeat(${mobileTabs.length}, 1fr)` }}>
        {mobileTabs.map(([k, label]) => (
          <button key={k} onClick={() => go(k)} aria-current={active === k ? "page" : undefined}
            className={`flex min-h-14 flex-col items-center justify-center gap-1 pt-2 text-[11px] font-semibold ${active === k ? "text-teal-700" : "text-stone-500"}`}>
            <Icon k={k} className="h-[22px] w-[22px]" />
            {label}
          </button>
        ))}
      </nav>

      {/* Phone account sheet */}
      {sheet && (
        <div className="fixed inset-0 z-40 bg-ink-950/50 lg:hidden" onClick={() => setSheet(false)}>
          <div className="pb-safe absolute inset-x-0 bottom-0 rounded-t-[16px] bg-ink-950 pt-2 text-white" onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20" />
            {user && <CreditsCard t={t} config={config!} />}
            {user?.isAdmin && <button onClick={() => (location.href = "/admin")} className="mx-3 w-[calc(100%-24px)] rounded-[6px] px-3 py-2.5 text-start text-sm text-white/70 hover:bg-white/5">{t.admin}</button>}
            {footer}
          </div>
        </div>
      )}
      <span hidden>{lang}</span>
    </div>
  );
}

function CreditsCard({ t, config }: { t: Strings; config: SiteConfig }) {
  const u = config.user!;
  const paid = u.plan === "basic" || u.plan === "premium";
  const total = paid ? 300 : u.plan === "weekly" ? 100 : 10;
  const pct = Math.max(0, Math.min(100, (100 * u.credits) / total));
  const refill = u.weekStarted ? new Date(new Date(u.weekStarted).getTime() + 7 * 864e5) : null;
  return (
    <div className="mx-3 mb-3 rounded-[10px] border border-ink-800 bg-ink-900 p-4">
      <div className="text-xs font-semibold text-white/60">{u.plan === "premium" ? t.planPremiumShort : u.plan === "basic" ? t.planBasicShort : u.plan === "weekly" ? t.planWeeklyShort : t.planFree}</div>
      <div className="mt-1.5 flex items-baseline gap-1.5">
        <span className="text-[26px] font-semibold tabular-nums">{u.credits}</span>
        <span className="text-xs text-white/55">{t.leadsLeft}</span>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-mint-400" style={{ width: `${pct}%` }} /></div>
      {u.plan === "weekly" && refill && <div className="mt-2 text-xs text-white/55">{t.renews} {fmtDate(t, refill, { day: "numeric", month: "short" })}</div>}
      {paid && u.planUntil && <div className="mt-2 text-xs text-white/55">{t.until} {fmtDate(t, new Date(u.planUntil), { day: "numeric", month: "short" })}</div>}
      {u.plan === "premium" && <div className="mt-1 text-xs text-mint-400">{t.premiumCli}</div>}
      {u.plan === "free" && (
        <a href={`mailto:${CONTACT_EMAIL}?subject=Masar%20Basic%20or%20Premium`} className="mt-3 flex min-h-10 items-center justify-center rounded-[6px] bg-teal-700 text-xs font-semibold text-white hover:bg-teal-800">{t.subscribe}</a>
      )}
    </div>
  );
}

/** Page header inside the work area. */
export function PageHead({ title, sub, actions }: { title: string; sub?: string; actions?: React.ReactNode }) {
  return (
    <div className="no-print flex flex-wrap items-end justify-between gap-4 border-b border-stone-300 bg-white px-4 py-5 sm:px-8 sm:py-6">
      <div>
        <h1 className="text-[22px] font-semibold tracking-[-0.01em] sm:text-[24px]">{title}</h1>
        {sub && <p className="text-muted mt-1 text-sm">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
