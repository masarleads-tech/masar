"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell, PageHead, useSite } from "@/components/site";
import { supabaseBrowser } from "@/lib/supabase/browser";

interface Row {
  email: string; credits: number; plan: string; plan_until: string | null; week_started: string | null;
  created_at: string; confirmed: boolean; key_hint: string | null;
}

/** Admin page (English only): manage subscribers, leads and each customer's own Claude key. */
export default function Admin() {
  const { t, lang, config, toggleLang } = useSite();
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [filter, setFilter] = useState("");

  const load = useCallback(async () => {
    const { data, error } = await supabaseBrowser().rpc("admin_list_users");
    if (error) setError(error.message);
    else setRows((data ?? []) as Row[]);
  }, []);

  useEffect(() => {
    if (config?.user?.isAdmin) load();
  }, [config, load]);

  async function call(fn: string, args: Record<string, unknown>, done: string) {
    setError("");
    setNote("");
    const { error } = await supabaseBrowser().rpc(fn, args);
    if (error) setError(error.message);
    else {
      setNote(done);
      load();
    }
  }

  const day = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");
  const shown = rows.filter((r) => !filter || r.email?.toLowerCase().includes(filter.toLowerCase()));

  if (config && !config.user?.isAdmin) {
    return <AppShell t={t} lang={lang} config={config} active="admin" onLang={toggleLang}><p className="p-8">Admins only.</p></AppShell>;
  }

  return (
    <AppShell t={t} lang={lang} config={config} active="admin" onLang={toggleLang}>
      <PageHead title="Customers" sub={`${rows.length} accounts · ${rows.filter((r) => r.plan === "weekly").length} on the weekly plan`}
        actions={<input className="input w-full sm:w-64" placeholder="Search email" value={filter} onChange={(e) => setFilter(e.target.value)} />} />
      <div className="p-5 sm:p-8" dir="ltr">
      {error && <p className="mt-3 rounded-[6px] bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      {note && <p className="mt-3 rounded-[6px] bg-teal-100 p-2 text-sm text-teal-800">{note}</p>}
      <div className="card mt-4 overflow-x-auto p-0">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="border-b border-stone-300 bg-paper-50 text-[11px] font-semibold tracking-[0.04em] text-stone-500 uppercase">
            <tr>
              <th className="p-3 text-left">Email</th>
              <th className="p-3 text-left">Joined</th>
              <th className="p-3 text-left">Plan</th>
              <th className="p-3 text-left">Leads left</th>
              <th className="p-3 text-left">Weekly plan</th>
              <th className="p-3 text-left">Add leads</th>
              <th className="p-3 text-left">Own Claude key</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => <AdminRow key={r.email} r={r} day={day} call={call} />)}
          </tbody>
        </table>
      </div>
      <p className="mt-4 text-xs opacity-60">
        Weekly plan: the balance is set to 100 at the start of each week and unused leads do not carry over.
        A customer&apos;s own key is used for all their searches; make it in its own workspace in the Anthropic Console with a spend limit.
      </p>
      </div>
    </AppShell>
  );
}

function AdminRow({ r, day, call }: {
  r: Row; day: (d: string | null) => string;
  call: (fn: string, args: Record<string, unknown>, done: string) => Promise<void>;
}) {
  const [weeks, setWeeks] = useState(4);
  const [amount, setAmount] = useState(10);
  const [key, setKey] = useState("");
  return (
    <tr className="border-b border-stone-300 align-top last:border-0">
      <td className="p-3">
        <div className="font-medium">{r.email}</div>
        {!r.confirmed && <div className="text-xs text-copper-600">email not confirmed</div>}
      </td>
      <td className="p-3 text-xs">{day(r.created_at)}</td>
      <td className="p-3 text-xs">
        {r.plan === "weekly" ? <span className="rounded-[6px] bg-teal-100 px-2 py-0.5 font-semibold text-teal-800">weekly</span> : "free"}
        {r.plan_until && <div className="mt-1 opacity-70">until {day(r.plan_until)}</div>}
      </td>
      <td className="p-3 font-semibold tabular-nums">{r.credits}</td>
      <td className="p-3">
        <div className="flex items-center gap-1">
          <input type="number" min={1} max={52} value={weeks} onChange={(e) => setWeeks(Number(e.target.value))} className="input min-h-9 w-16 px-2 py-1" />
          <span className="text-xs">wk</span>
          <button className="btn-primary min-h-9 px-2.5 py-1 text-xs" onClick={() => call("admin_set_weekly", { target_email: r.email, weeks }, `${r.email}: weekly plan +${weeks} weeks`)}>
            {r.plan === "weekly" ? "Extend" : "Start"}
          </button>
          {r.plan === "weekly" && (
            <button className="btn-secondary min-h-9 px-2.5 py-1 text-xs" onClick={() => confirm(`End the weekly plan for ${r.email}?`) && call("admin_set_weekly", { target_email: r.email, weeks: 0 }, `${r.email}: plan ended`)}>End</button>
          )}
        </div>
      </td>
      <td className="p-3">
        <div className="flex items-center gap-1">
          <input type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} className="input min-h-9 w-20 px-2 py-1" />
          <button className="btn-secondary min-h-9 px-2.5 py-1 text-xs" onClick={() => call("admin_add_credits", { target_email: r.email, amount }, `${r.email}: ${amount > 0 ? "+" : ""}${amount} leads`)}>Add</button>
        </div>
      </td>
      <td className="p-3">
        <div className="mb-1 text-xs opacity-70">{r.key_hint ? `set (${r.key_hint})` : "uses main key"}</div>
        <div className="flex items-center gap-1">
          <input type="password" autoComplete="off" placeholder="sk-ant-..." value={key} onChange={(e) => setKey(e.target.value)} className="input min-h-9 w-40 px-2 py-1" />
          <button className="btn-secondary min-h-9 px-2.5 py-1 text-xs" disabled={!key} onClick={() => call("admin_set_key", { target_email: r.email, key }, `${r.email}: key saved`).then(() => setKey(""))}>Save</button>
          {r.key_hint && <button className="btn-secondary min-h-9 px-2.5 py-1 text-xs" onClick={() => call("admin_set_key", { target_email: r.email, key: "" }, `${r.email}: key removed`)}>Remove</button>}
        </div>
      </td>
    </tr>
  );
}
