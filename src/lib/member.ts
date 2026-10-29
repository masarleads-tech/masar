import { readFile } from "node:fs/promises";
import path from "node:path";
import { currentUser } from "@clerk/nextjs/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { posthogScript, type Visitor } from "./analytics";
import { requireUser } from "./server";
import { accountsEnabled } from "./supabase/env";

/** Pages built as plain HTML (setup tour, dashboard, download) live in src/html and are sent by route handlers. */
export async function htmlPage(name: "home" | "welcome" | "dashboard" | "cli" | "cli-connect", data?: unknown, who?: Visitor) {
  let html = await readFile(path.join(process.cwd(), "src/html", `${name}.html`), "utf8");
  html = html.replace('href="app.css"', 'href="/app/app.css"');
  const analytics = posthogScript(who);
  if (analytics) html = html.replace("</head>", `<script>${analytics}</script>\n</head>`);
  const json = data === undefined ? "" : JSON.stringify(data).replace(/</g, "\\u003c").replace(/\u2028|\u2029/g, "");
  html = html.replace('<script src="app.js"></script>',
    (json ? `<script>window.MASAR_DATA=${json};</script>` : "") + '<script src="/app/app.js"></script>');
  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store" },
  });
}

/**
 * The signed-in member, or null. Fails closed: when accounts are off or Clerk/Supabase can't be read,
 * the caller sends the visitor to the log-in page instead of showing the page.
 */
export async function member() {
  if (!accountsEnabled) return null;
  try {
    const account = await requireUser();
    if (!account.userId || !account.supabase) return null;
    return { userId: account.userId, supabase: account.supabase, credits: account.credits ?? 0 };
  } catch (e) {
    console.error("[masar] member check failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

export function toLogin(req: Request, back: string, signup = false) {
  const url = new URL(signup ? "/login?mode=signup" : "/login", req.url);
  url.searchParams.set("redirect_url", back);
  return Response.redirect(url, 303);
}

/** Username and email straight from Clerk, so the browser can't set someone else's. */
async function clerkIdentity() {
  const u = await currentUser();
  const email = u?.primaryEmailAddress?.emailAddress ?? u?.emailAddresses?.[0]?.emailAddress ?? null;
  const full = [u?.firstName, u?.lastName].filter(Boolean).join(" ").trim();
  const username = u?.username || full || (email ? email.split("@")[0] : null);
  return { username, email };
}

/** Makes sure the member has a setup row with their current username and email, and returns it. */
export async function ensureSetup(supabase: SupabaseClient, userId: string) {
  const who = await clerkIdentity();
  const { data, error } = await supabase.from("user_setup")
    .upsert({ user_id: userId, username: who.username, email: who.email }, { onConflict: "user_id" })
    .select("*").single();
  if (error) throw new Error(`Could not read your setup: ${error.message}`);
  return data as Record<string, unknown>;
}

const SETUP_FIELDS = z.object({
  industries: z.array(z.string().max(80)).max(30),
  ideal_customer: z.string().max(1000),
  cities: z.array(z.string().max(80)).max(60),
  leads_per_week: z.number().int().min(1).max(10000),
  meetings_per_month: z.number().int().min(0).max(1000),
  deal_size: z.number().min(0).max(1e12),
  currency: z.string().min(3).max(3),
  close_rate: z.number().int().min(0).max(100),
  sales_cycle: z.number().int().min(0).max(3),
  connectors: z.array(z.string().max(60)).max(20),
  features: z.array(z.string().max(80)).max(20),
  setup_done: z.literal(true),
}).partial().strict();

export async function saveSetup(supabase: SupabaseClient, userId: string, body: unknown) {
  const patch = SETUP_FIELDS.parse(body);
  const who = await clerkIdentity();
  const { error } = await supabase.from("user_setup").upsert(
    { ...patch, user_id: userId, username: who.username, email: who.email, updated_at: new Date().toISOString() },
    { onConflict: "user_id" });
  if (error) throw new Error(`Could not save: ${error.message}`);
}

const DAY = 864e5;
/** Lead counts for the dashboard, from the member's own leads. */
async function leadStats(supabase: SupabaseClient) {
  const now = Date.now();
  const [{ count: total }, { data: recent }] = await Promise.all([
    supabase.from("leads").select("id", { count: "exact", head: true }),
    supabase.from("leads").select("created_at, updated_at, outcome")
      .gte("created_at", new Date(now - 60 * DAY).toISOString()).limit(20000),
  ]);
  const week = [0, 0, 0, 0, 0, 0, 0], month = [0, 0, 0, 0], funnel = [0, 0, 0, 0];
  let month30 = 0, prev30 = 0, meetings30 = 0;
  const startOfToday = new Date(); startOfToday.setUTCHours(0, 0, 0, 0);
  for (const r of recent ?? []) {
    const t = new Date(r.created_at as string).getTime(), age = now - t;
    const dayIdx = 6 - Math.floor((startOfToday.getTime() + DAY - 1 - t) / DAY);
    if (dayIdx >= 0 && dayIdx <= 6) week[dayIdx]++;
    const wk = 3 - Math.floor(age / (7 * DAY));
    if (wk >= 0 && wk <= 3) month[wk]++;
    const o = r.outcome as string;
    if (age <= 30 * DAY) {
      month30++;
      funnel[0]++;
      if (o !== "new") funnel[1]++;
      if (o === "meeting" || o === "won") funnel[2]++;
      if (o === "won") funnel[3]++;
    } else prev30++;
    if ((o === "meeting" || o === "won") && now - new Date(r.updated_at as string).getTime() <= 30 * DAY) meetings30++;
  }
  return { week, month, month30, prev30, total: total ?? 0, meetings30, funnel };
}

type ListRow = { kind: "search" | "list"; id: string; name: string; n: number; src: string; at: string };

async function memberLists(supabase: SupabaseClient): Promise<ListRow[]> {
  const [{ data: searches }, { data: own }] = await Promise.all([
    supabase.from("searches").select("id, brief, created_at, leads(count)").order("created_at", { ascending: false }).limit(100),
    supabase.from("client_lists").select("id, name, source, row_count, updated_at").order("updated_at", { ascending: false }).limit(200),
  ]);
  const a: ListRow[] = (searches ?? []).map((s) => {
    const b = (s.brief ?? {}) as { clientName?: string; industryCustom?: string; industry?: string; locations?: string[] };
    const name = b.clientName || [b.industryCustom || b.industry?.replace(/_/g, " "), (b.locations ?? []).slice(0, 2).join(", ")].filter(Boolean).join(" · ");
    return { kind: "search", id: s.id as string, name, n: Number((s.leads as { count: number }[] | null)?.[0]?.count ?? 0), src: "masar", at: s.created_at as string };
  });
  const b: ListRow[] = (own ?? []).map((l) => ({ kind: "list", id: l.id as string, name: l.name as string, n: l.row_count as number, src: l.source as string, at: l.updated_at as string }));
  return [...a, ...b].sort((x, y) => y.at.localeCompare(x.at));
}

/** The member's Masar CLI: signed-in computers, the AI each one uses, and the last 30 days of CLI searches. */
async function cliStats(supabase: SupabaseClient) {
  const since = new Date(Date.now() - 30 * DAY).toISOString();
  const [{ data: devices, error }, { data: runs }] = await Promise.all([
    supabase.from("cli_tokens").select("id, device_name, ai_provider, ai_model, last_used_at, created_at")
      .is("revoked_at", null).order("created_at", { ascending: false }).limit(20),
    supabase.from("cli_usage").select("ai_provider, leads_saved, credits_used, input_tokens, output_tokens, created_at")
      .gte("created_at", since).order("created_at", { ascending: false }).limit(1000),
  ]);
  if (error) return null; // Before the CLI tables are added in Supabase.
  const r = runs ?? [];
  const sum = (k: "leads_saved" | "credits_used" | "input_tokens" | "output_tokens") => r.reduce((n, x) => n + Number(x[k] ?? 0), 0);
  const last = (devices ?? []).map((d) => d.last_used_at as string | null).filter(Boolean).sort().pop() ?? null;
  return {
    connected: (devices ?? []).length > 0,
    devices: devices ?? [],
    provider: (r[0]?.ai_provider as string | undefined) ?? (devices?.[0]?.ai_provider as string | undefined) ?? null,
    lastUsedAt: last,
    runs30: r.length,
    leads30: sum("leads_saved"),
    credits30: sum("credits_used"),
    tokens30: sum("input_tokens") + sum("output_tokens"),
  };
}

export async function dashboardData(supabase: SupabaseClient, userId: string) {
  const setup = await ensureSetup(supabase, userId);
  const [{ data: acc }, stats, lists] = await Promise.all([
    supabase.rpc("my_account"), leadStats(supabase), memberLists(supabase),
  ]);
  const cli = await cliStats(supabase).catch(() => null);
  const a = Array.isArray(acc) && acc[0] ? acc[0] : {};
  return {
    username: setup.username ?? null,
    setup,
    account: { credits: Number(a.credits ?? 0), plan: ["weekly", "basic", "premium"].includes(a.plan) ? a.plan : "free", until: a.plan_until ?? null },
    stats,
    lists,
    cli,
  };
}
