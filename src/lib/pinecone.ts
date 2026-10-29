import type { SupabaseClient } from "@supabase/supabase-js";
import { normName } from "./lead";
import type { Lead } from "./types";

/**
 * Pinecone: each member's lead memory. Every checked lead is kept as a short text in the member's own
 * namespace; Pinecone turns it into a vector itself (integrated embedding, multilingual so Arabic and
 * English names match). When a new lead looks like one the member already marked Won or Meeting, it gets
 * a small boost and a "like your lead X" note, so the list learns from what actually closes.
 *
 * Off until PINECONE_API_KEY is set (server-only: the key can read and write every member's memory).
 * The index is created on first use. Every call has a short time limit and any failure is skipped,
 * so the site never breaks or slows down because of Pinecone.
 */
const env = (...names: string[]) => names.map((n) => process.env[n]?.trim()).find(Boolean) ?? "";
const API_KEY = env("PINECONE_API_KEY");
export const INDEX_NAME = env("PINECONE_INDEX") || "masar-leads";
export const pineconeEnabled = !!API_KEY && !/^["']|["']$|\s/.test(API_KEY);

const CONTROL = "https://api.pinecone.io";
const API_VERSION = "2025-10";
// Free (Starter) projects can only create indexes in AWS us-east-1.
const NEW_INDEX = { cloud: "aws", region: "us-east-1", embed: { model: "multilingual-e5-large", field_map: { text: "text" } } };

/** A lookalike hit counts from this similarity (0-1). The multilingual model scores unrelated shops around 0.75. */
export const LOOKALIKE_MIN = 0.86;
const BONUS = { won: 8, meeting: 5 } as const;

const headers = (json = true) => ({ "Api-Key": API_KEY, "X-Pinecone-Api-Version": API_VERSION, ...(json ? { "content-type": "application/json" } : {}) });

async function call(url: string, init: RequestInit = {}, ms = 2500): Promise<Response> {
  return fetch(url, { ...init, headers: { ...headers(), ...(init.headers as Record<string, string>) }, signal: AbortSignal.timeout(ms) });
}

let hostPromise: Promise<string | null> | null = null;

/** The index's own address, looked up once per server. Creates the index when it doesn't exist yet. */
async function indexHost(): Promise<string | null> {
  if (!pineconeEnabled) return null;
  hostPromise ??= (async () => {
    const res = await call(`${CONTROL}/indexes/${encodeURIComponent(INDEX_NAME)}`, { method: "GET" });
    if (res.status === 404) {
      await call(`${CONTROL}/indexes/create-for-model`, { method: "POST", body: JSON.stringify({ name: INDEX_NAME, ...NEW_INDEX }) }, 5000);
      return null;
    }
    if (!res.ok) throw new Error(`Pinecone ${res.status}`);
    const d = (await res.json()) as { host?: string; status?: { ready?: boolean } };
    return d.status?.ready && d.host ? d.host : null;
  })().catch((e) => { console.error("[masar] Pinecone:", e instanceof Error ? e.message : e); return null; });
  const host = await hostPromise;
  if (!host) hostPromise = null; // not ready yet or failed: ask again next time
  return host;
}

/** What Pinecone embeds for a lead: the kind of business and where, not the contact details. */
export function leadText(l: Lead): string {
  const parts = [l.name, l.category, l.city, l.address, l.isChain ? "chain" : "independent",
    l.website ? l.website.replace(/^https?:\/\/(www\.)?/, "").split("/")[0] : "", ...l.decisionMakers.slice(0, 2).map((d) => d.title)];
  return parts.filter(Boolean).join(". ").slice(0, 1000);
}

/** Pinecone namespaces: one per member, so nobody's memory mixes with another's. */
const space = (userId: string) => encodeURIComponent(`member-${userId}`);

/** Keeps saved leads in the member's memory. Record id = the leads table row id. */
export async function rememberLeads(userId: string, searchId: string, leads: Lead[]) {
  const rows = leads.filter((l) => l.rowId);
  if (!rows.length) return;
  try {
    const host = await indexHost();
    if (!host) return;
    const body = rows.map((l) => JSON.stringify({ _id: l.rowId, text: leadText(l), name: l.name.slice(0, 200), city: l.city.slice(0, 120), search_id: searchId })).join("\n");
    const res = await call(`https://${host}/records/namespaces/${space(userId)}/upsert`, { method: "POST", body, headers: { "content-type": "application/x-ndjson" } }, 5000);
    if (!res.ok) throw new Error(`upsert ${res.status}`);
  } catch (e) {
    console.error("[masar] Pinecone:", e instanceof Error ? e.message : e);
  }
}

/** Removes a deleted search's leads from the member's memory. */
export async function forgetSearch(userId: string, searchId: string) {
  try {
    const host = await indexHost();
    if (!host) return;
    await call(`https://${host}/vectors/delete`, { method: "POST", body: JSON.stringify({ namespace: decodeURIComponent(space(userId)), filter: { search_id: { $eq: searchId } } }) }, 5000);
  } catch (e) {
    console.error("[masar] Pinecone:", e instanceof Error ? e.message : e);
  }
}

export interface Lookalike { name: string; outcome: "won" | "meeting"; score: number }
interface Hit { _id: string; _score: number; fields?: { name?: string; search_id?: string } }

/**
 * For each lead, the closest lead from the member's earlier searches that they marked Won or Meeting.
 * Leads from this same search and the same business (same name) don't count.
 */
export async function findLookalikes(db: SupabaseClient, userId: string, searchId: string, leads: Lead[]): Promise<Map<string, Lookalike>> {
  const out = new Map<string, Lookalike>();
  try {
    const host = await indexHost();
    if (!host || !leads.length) return out;
    const hits = await Promise.all(leads.map(async (l) => {
      const res = await call(`https://${host}/records/namespaces/${space(userId)}/search`, {
        method: "POST", body: JSON.stringify({ query: { inputs: { text: leadText(l) }, top_k: 10 }, fields: ["name", "search_id"] }),
      });
      if (res.status === 404) return []; // a new member has no memory yet
      if (!res.ok) throw new Error(`search ${res.status}`);
      const d = (await res.json()) as { result?: { hits?: Hit[] } };
      return (d.result?.hits ?? []).filter((h) => h._score >= LOOKALIKE_MIN && h.fields?.search_id !== searchId && normName(h.fields?.name ?? "") !== normName(l.name));
    }));
    const ids = [...new Set(hits.flat().map((h) => h._id))];
    if (!ids.length) return out;
    const { data } = await db.from("leads").select("id, outcome").in("id", ids).in("outcome", ["won", "meeting"]);
    const outcome = new Map((data ?? []).map((r) => [r.id as string, r.outcome as Lookalike["outcome"]]));
    leads.forEach((l, i) => {
      const best = hits[i].find((h) => outcome.has(h._id)); // hits come best first
      if (best) out.set(l.id, { name: best.fields?.name ?? "", outcome: outcome.get(best._id)!, score: Math.round(best._score * 100) / 100 });
    });
  } catch (e) {
    console.error("[masar] Pinecone:", e instanceof Error ? e.message : e);
  }
  return out;
}

/** Adds the lookalike boost to the rank and re-sorts. Leads without a lookalike are unchanged. */
export function applyLookalikes(leads: Lead[], found: Map<string, Lookalike>): Lead[] {
  if (!found.size) return leads;
  return leads.map((l) => {
    const like = found.get(l.id);
    return like ? { ...l, lookalike: like, rank: Math.min(100, (l.rank ?? 0) + BONUS[like.outcome]) } : l;
  }).sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0) || b.closing - a.closing);
}

/** For /api/health: is the key accepted and the index ready? Creates the index when it's missing. */
export async function pineconeStatus(): Promise<string> {
  const raw = process.env.PINECONE_API_KEY?.trim() ?? "";
  if (!raw) return "missing (lead memory off)";
  if (!pineconeEnabled) return "has quotes or spaces";
  try {
    const res = await call(`${CONTROL}/indexes/${encodeURIComponent(INDEX_NAME)}`, { method: "GET" }, 4000);
    if (res.status === 401 || res.status === 403) return "the API key was rejected";
    if (res.status === 404) {
      const made = await call(`${CONTROL}/indexes/create-for-model`, { method: "POST", body: JSON.stringify({ name: INDEX_NAME, ...NEW_INDEX }) }, 5000);
      return made.ok ? `creating the index ${INDEX_NAME}, check again in a minute` : `could not create the index (${made.status}: ${(await made.text()).slice(0, 120)})`;
    }
    if (!res.ok) return `cannot connect (${res.status})`;
    const d = (await res.json()) as { status?: { ready?: boolean; state?: string } };
    return d.status?.ready ? `ok (index ${INDEX_NAME} ready)` : `index ${INDEX_NAME} is starting (${d.status?.state ?? "not ready"}), check again in a minute`;
  } catch (e) {
    return `cannot connect: ${e instanceof Error ? e.message : "unknown error"}`;
  }
}
