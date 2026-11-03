"use client";
/* eslint-disable @next/next/no-html-link-for-pages -- plain links keep auth cookies fresh with a full page load */

import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell, CONTACT_EMAIL, PageHead, useSite } from "@/components/site";
import { fmtDate } from "@/lib/i18n";
import { supabaseBrowser } from "@/lib/supabase/browser";
import type { PaypalConfig } from "@/lib/types";

type Plan = "basic" | "premium";
interface Payment { id: string; plan: Plan; months: number; amount: number; currency: string; status: string; created_at: string; paid_at: string | null }

interface PaypalButtons { render(el: HTMLElement): Promise<void>; close?(): Promise<void>; isEligible?(): boolean }
interface PaypalSdk {
  Buttons(o: {
    style?: Record<string, unknown>;
    createOrder(): Promise<string>;
    onApprove(d: { orderID: string }): Promise<void>;
    onCancel?(): void;
    onError?(e: unknown): void;
  }): PaypalButtons;
}

/** Loads PayPal's checkout script once for this client id and currency. */
function loadPaypal(cfg: PaypalConfig, locale: string): Promise<PaypalSdk> {
  const w = window as unknown as { paypal?: PaypalSdk };
  const src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(cfg.clientId)}&currency=${cfg.currency}&intent=capture&components=buttons&locale=${locale}`;
  const existing = document.querySelector<HTMLScriptElement>(`script[data-masar-paypal]`);
  if (existing?.src === src && w.paypal) return Promise.resolve(w.paypal);
  existing?.remove();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.dataset.masarPaypal = "1";
    s.onload = () => (w.paypal ? resolve(w.paypal) : reject(new Error("PayPal did not load")));
    s.onerror = () => reject(new Error("PayPal could not load. Check your connection or ad blocker."));
    document.head.appendChild(s);
  });
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Error ${r.status}`);
  return data as T;
}

/** Choose Basic or Premium, how many months, and pay with PayPal (or a card through PayPal). */
export default function Billing() {
  const { lang, t, config, reload, toggleLang } = useSite();
  const [plan, setPlan] = useState<Plan>("basic");
  const [months, setMonths] = useState(1);
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [note, setNote] = useState<{ kind: "ok" | "info" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const pp = config?.paypal ?? null;
  const user = config?.user ?? null;

  // Latest choice, read by PayPal's callbacks (the buttons are drawn once per language).
  const choice = useRef({ plan, months });
  choice.current = { plan, months };

  const loadPayments = useCallback(async () => {
    const { data } = await supabaseBrowser().from("payments")
      .select("id, plan, months, amount, currency, status, created_at, paid_at")
      .order("created_at", { ascending: false }).limit(20);
    setPayments(((data ?? []) as Payment[]).filter((p) => p.status !== "pending" || Date.now() - new Date(p.created_at).getTime() < 864e5));
  }, []);

  useEffect(() => {
    if (!config) return;
    if (!config.user) { location.href = `/login?mode=signup&next=${encodeURIComponent("/billing" + location.search)}`; return; }
    if (config.user.plan === "premium") setPlan("premium");
    loadPayments();
    const q = new URLSearchParams(location.search);
    if (q.get("cancelled")) setNote({ kind: "info", text: t.billingCancelled });
    if (q.get("plan") === "premium" || q.get("plan") === "basic") setPlan(q.get("plan") as Plan);
    // Back from PayPal's own page (no-script flow): finish the order it names.
    const token = q.get("token");
    if (q.get("paid") && token) {
      history.replaceState(null, "", "/billing");
      finish(token);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.user?.email]);

  async function finish(orderId: string) {
    setBusy(true);
    try {
      const r = await post<{ status: string; plan: Plan }>("/api/billing/paypal/capture", { orderId });
      if (r.status === "pending") setNote({ kind: "info", text: t.billingPending });
      else {
        const res = await fetch("/api/config", { cache: "no-store" }).then((x) => x.json()).catch(() => null);
        const until = res?.user?.planUntil ? fmtDate(t, res.user.planUntil) : "";
        setNote({ kind: "ok", text: t.billingDone.replace("{plan}", r.plan === "premium" ? t.billingPremium : t.billingBasic).replace("{date}", until) });
        reload();
      }
      loadPayments();
    } catch (e) {
      setNote({ kind: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  // Draw PayPal's buttons.
  useEffect(() => {
    if (!pp || !user || !box.current) return;
    let buttons: PaypalButtons | null = null;
    let gone = false;
    const el = box.current;
    loadPaypal(pp, lang === "ar" ? "ar_SA" : "en_GB").then((paypal) => {
      if (gone) return;
      el.innerHTML = "";
      buttons = paypal.Buttons({
        style: { layout: "vertical", shape: "rect", label: "pay", height: 44 },
        createOrder: async () => {
          setNote(null);
          const r = await post<{ orderId: string }>("/api/billing/paypal/order", choice.current);
          return r.orderId;
        },
        onApprove: async (d) => { await finish(d.orderID); },
        onCancel: () => setNote({ kind: "info", text: t.billingCancelled }),
        onError: (e) => setNote({ kind: "error", text: e instanceof Error ? e.message : String(e) }),
      });
      return buttons.render(el);
    }).catch((e) => setNote({ kind: "error", text: e instanceof Error ? e.message : String(e) }));
    return () => { gone = true; buttons?.close?.().catch(() => {}); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pp?.clientId, pp?.currency, lang, !!user]);

  const price = (p: Plan) => pp?.plans.find((x) => x.plan === p)?.monthly ?? 0;
  const money = (n: number) => new Intl.NumberFormat(t.locale, { style: "currency", currency: pp?.currency || "USD" }).format(n);
  const monthLabel = (n: number) => (n === 1 ? t.billingMonth1 : t.billingMonthsN.replace("{n}", String(n)));
  const paid = user && (user.plan === "basic" || user.plan === "premium");

  return (
    <AppShell t={t} lang={lang} config={config} active="billing" onLang={toggleLang}>
      <PageHead title={t.navBilling} sub={t.billingSub} />
      <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-8">
        {note && (
          <p role="status" className={`rounded-[6px] p-3 text-sm ${note.kind === "ok" ? "bg-teal-100 text-teal-800" : note.kind === "error" ? "bg-red-50 text-red-700" : "bg-sand-100 text-ink-800"}`}>{note.text}</p>
        )}

        {user && (
          <div className="card flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold tracking-[0.06em] text-stone-500 uppercase">{t.billingCurrent}</div>
              <div className="mt-1 font-semibold">
                {paid ? `${user.plan === "premium" ? t.billingPremium : t.billingBasic}${user.planUntil ? ` · ${t.until} ${fmtDate(t, user.planUntil)}` : ""}` : user.plan === "weekly" ? t.planWeeklyShort : t.billingFreeNow}
              </div>
            </div>
            <div className="text-muted text-sm">{user.credits} {t.leadsLeft}</div>
          </div>
        )}

        {config && !pp && (
          <div className="card">
            <p>{t.billingOff}</p>
            <a href={`mailto:${CONTACT_EMAIL}?subject=Masar%20Basic%20or%20Premium`} className="btn-primary mt-4">{t.subscribe}</a>
          </div>
        )}

        {pp && (
          <>
            <div className="grid gap-4 sm:grid-cols-2" role="radiogroup" aria-label={t.navBilling}>
              {(["basic", "premium"] as Plan[]).map((p) => (
                <button key={p} type="button" role="radio" aria-checked={plan === p} onClick={() => setPlan(p)}
                  className={`rounded-[12px] border bg-white p-5 text-start transition-colors ${plan === p ? "border-teal-700 ring-2 ring-teal-700/20" : "border-stone-300 hover:border-stone-500"}`}>
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">{p === "basic" ? t.billingBasic : t.billingPremium}</span>
                    <span className={`h-4 w-4 rounded-full border-2 ${plan === p ? "border-teal-700 bg-teal-700" : "border-stone-400"}`} />
                  </div>
                  <div className="mt-3"><span className="text-[28px] font-semibold tabular-nums">{money(price(p))}</span> <span className="text-muted text-sm">{t.perMonthShort}</span></div>
                  <p className="text-muted mt-2 text-sm">{p === "basic" ? t.billingBasicDesc : t.billingPremiumDesc}</p>
                </button>
              ))}
            </div>

            <div className="card space-y-5">
              <div>
                <div className="text-sm font-semibold">{t.billingMonths}</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {pp.months.map((m) => (
                    <button key={m} type="button" onClick={() => setMonths(m)} aria-pressed={months === m}
                      className={`${months === m ? "btn-primary" : "btn-secondary"} min-h-10 px-4 py-2 text-sm`}>{monthLabel(m)}</button>
                  ))}
                </div>
              </div>
              <div className="flex items-baseline justify-between border-t border-stone-300 pt-4">
                <span className="font-semibold">{t.billingTotal}</span>
                <span className="text-[22px] font-semibold tabular-nums">{money(price(plan) * months)}</span>
              </div>
              {!pp.live && <p className="rounded-[6px] bg-sand-100 p-2.5 text-xs text-ink-800">{t.billingSandbox}</p>}
              <div ref={box} aria-busy={busy} className={busy ? "pointer-events-none opacity-60" : ""}>
                <p className="text-muted text-sm">{t.loading}</p>
              </div>
              <p className="text-muted text-xs">{t.billingNoRenew} {t.billingRefundNote} <a href="/legal/refund" className="underline">{t.legalRefund}</a>.</p>
            </div>
          </>
        )}

        {user && (
          <div className="card p-0">
            <div className="border-b border-stone-300 px-5 py-3 text-sm font-semibold">{t.billingHistory}</div>
            {payments === null && <p className="text-muted p-5 text-sm">{t.loading}</p>}
            {payments?.length === 0 && <p className="text-muted p-5 text-sm">{t.billingNone}</p>}
            {payments && payments.length > 0 && (
              <ul className="divide-y divide-stone-300 text-sm">
                {payments.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                    <span>{fmtDate(t, p.paid_at ?? p.created_at)} · {p.plan === "premium" ? t.billingPremium : t.billingBasic} · {monthLabel(p.months)}</span>
                    <span className="tabular-nums">{new Intl.NumberFormat(t.locale, { style: "currency", currency: p.currency }).format(Number(p.amount))} · <b>{t.billingStatus[p.status] ?? p.status}</b></span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
