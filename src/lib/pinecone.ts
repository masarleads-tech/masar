import type { SupabaseClient } from "@supabase/supabase-js";
import { normName } from "./lead";
import type { Lead } from "./types";

/**
 * Pinecone: each member's lead memory. Every checked lead is kept as a short text in the member's own
 * namespace and turned into a vector by a Pinecone-hosted model (multilingual, so Arabic and English names
 * match): by the index itself when it has a model attached, otherwise by Masar through Pinecone's embed API. When a new lead looks like one the member already marked Won or Meeting, it gets
 * a small boost and a "like your lead X" note, so the list learns from what actually closes.
 *
 * Off until PINECONE_API_KEY is set (server-only: the key can read and write every member's memory).
 * Uses the index Vercel's Pinecone integration made (PINECONE_HOSTNAME), or creates masar-leads on first use. Every call has a short time limit and any failure is skipped,
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

interface IndexInfo {
  name: string; host?: string; dimension?: number; vector_type?: string;
  status?: { ready?: boolean; state?: string }; embed?: { model?: string; field_map?: { text?: string } };
}
/**
 * `field`: the index embeds this text field itself (records API). Otherwise `model` is the hosted model
 * Masar embeds with before saving and searching (vectors API), picked to match the index's dimension.
 */
type Index = { host: string; field: string; model?: undefined } | { host: string; field?: undefined; model: { name: string; dimension?: number } };

/** Hosted models for an index without one attached: e5 is 1024 wide; llama can be cut to the index's width. */
function modelFor(info: IndexInfo): { name: string; dimension?: number } | null {
  if (info.vector_type && info.vector_type !== "dense") return null;
  if (info.dimension === 1024) return { name: "multilingual-e5-large" };
  if ([384, 512, 768, 2048].includes(info.dimension ?? 0)) return { name: "llama-text-embed-v2", dimension: info.dimension };
  return null;
}

function toIndex(info: IndexInfo | null): Index | null {
  if (!info?.status?.ready || !info.host) return null;
  const field = info.embed?.field_map?.text;
  if (field) return { host: info.host, field };
  const model = modelFor(info);
  return model ? { host: info.host, model } : null;
}

/** Vercel's Pinecone integration sets PINECONE_HOSTNAME for the index it made; then that index is used, whatever its name. */
const HOSTNAME = env("PINECONE_HOSTNAME").replace(/^https?:\/\//, "").replace(/\/+$/, "");

/**
 * Finds the index: the one at PINECONE_HOSTNAME when set, else the one named PINECONE_INDEX (default masar-leads),
 * which is created when it doesn't exist. `create: false` only looks.
 */
async function lookup(create = true): Promise<{ info: IndexInfo | null; created?: Response }> {
  if (HOSTNAME) {
    const res = await call(`${CONTROL}/indexes`, { method: "GET" }, 4000);
    if (!res.ok) throw new PineconeError(res.status);
    const d = (await res.json()) as { indexes?: IndexInfo[] };
    return { info: d.indexes?.find((i) => i.host === HOSTNAME) ?? null };
  }
  const res = await call(`${CONTROL}/indexes/${encodeURIComponent(INDEX_NAME)}`, { method: "GET" }, 4000);
  if (res.status === 404) {
    if (!create) return { info: null };
    return { info: null, created: await call(`${CONTROL}/indexes/create-for-model`, { method: "POST", body: JSON.stringify({ name: INDEX_NAME, ...NEW_INDEX }) }, 5000) };
  }
  if (!res.ok) throw new PineconeError(res.status);
  return { info: (await res.json()) as IndexInfo };
}

class PineconeError extends Error {
  constructor(public status: number) { super(`Pinecone ${status}`); }
}

let indexPromise: Promise<Index | null> | null = null;

/** The index's address and the field Pinecone embeds, looked up once per server. */
async function getIndex(): Promise<Index | null> {
  if (!pineconeEnabled) return null;
  indexPromise ??= lookup().then(({ info }) => toIndex(info)).catch((e) => { console.error("[masar] Pinecone:", e instanceof Error ? e.message : e); return null; });
  const index = await indexPromise;
  if (!index) indexPromise = null; // not ready yet or failed: ask again next time
  return index;
}

/** What Pinecone embeds for a lead: the kind of business and where, not the contact details. */
export function leadText(l: Lead): string {
  const parts = [l.name, l.category, l.city, l.address, l.isChain ? "chain" : "independent",
    l.website ? l.website.replace(/^https?:\/\/(www\.)?/, "").split("/")[0] : "", ...l.decisionMakers.slice(0, 2).map((d) => d.title)];
  return parts.filter(Boolean).join(". ").slice(0, 1000);
}

/** Pinecone namespaces: one per member, so nobody's memory mixes with another's. */
const space = (userId: string) => encodeURIComponent(`member-${userId}`);

/** Vectors from Pinecone's hosted model: "passage" for what is saved, "query" for what is searched. */
async function embed(model: { name: string; dimension?: number }, texts: string[], kind: "passage" | "query"): Promise<number[][]> {
  const parameters = { input_type: kind, truncate: "END", ...(model.dimension ? { dimension: model.dimension } : {}) };
  const res = await call(`${CONTROL}/embed`, { method: "POST", body: JSON.stringify({ model: model.name, parameters, inputs: texts.map((text) => ({ text })) }) }, 5000);
  if (!res.ok) throw new Error(`embed ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const d = (await res.json()) as { data?: { values?: number[] }[] };
  const out = (d.data ?? []).map((x) => x.values ?? []);
  if (out.length !== texts.length || out.some((v) => !v.length)) throw new Error("embed returned no vectors");
  return out;
}

type Meta = { name: string; city: string; search_id: string };

async function upsert(index: Index, userId: string, records: { id: string; text: string; meta: Meta }[]) {
  let res: Response;
  if (index.model === undefined) {
    const body = records.map((r) => JSON.stringify({ _id: r.id, [index.field]: r.text, ...r.meta })).join("\n");
    res = await call(`https://${index.host}/records/namespaces/${space(userId)}/upsert`, { method: "POST", body, headers: { "content-type": "application/x-ndjson" } }, 5000);
  } else {
    const values = await embed(index.model, records.map((r) => r.text), "passage");
    const vectors = records.map((r, i) => ({ id: r.id, values: values[i], metadata: r.meta }));
    res = await call(`https://${index.host}/vectors/upsert`, { method: "POST", body: JSON.stringify({ namespace: decodeURIComponent(space(userId)), vectors }) }, 5000);
  }
  if (!res.ok) throw new Error(`upsert ${res.status}`);
}

interface Hit { id: string; score: number; name: string; searchId: string }

/** The closest saved leads to each text, best first. */
async function search(index: Index, userId: string, texts: string[], topK: number): Promise<Hit[][]> {
  if (index.model === undefined) {
    return Promise.all(texts.map(async (text) => {
      const res = await call(`https://${index.host}/records/namespaces/${space(userId)}/search`, {
        method: "POST", body: JSON.stringify({ query: { inputs: { text }, top_k: topK }, fields: ["name", "search_id"] }),
      });
      if (res.status === 404) return []; // a new member has no memory yet
      if (!res.ok) throw new Error(`search ${res.status}`);
      const d = (await res.json()) as { result?: { hits?: { _id: string; _score: number; fields?: { name?: string; search_id?: string } }[] } };
      return (d.result?.hits ?? []).map((h) => ({ id: h._id, score: h._score, name: h.fields?.name ?? "", searchId: h.fields?.search_id ?? "" }));
    }));
  }
  const vectors = await embed(index.model, texts, "query");
  return Promise.all(vectors.map(async (vector) => {
    const res = await call(`https://${index.host}/query`, {
      method: "POST", body: JSON.stringify({ namespace: decodeURIComponent(space(userId)), vector, topK, includeMetadata: true }),
    });
    if (res.status === 404) return [];
    if (!res.ok) throw new Error(`query ${res.status}`);
    const d = (await res.json()) as { matches?: { id: string; score: number; metadata?: { name?: string; search_id?: string } }[] };
    return (d.matches ?? []).map((m) => ({ id: m.id, score: m.score, name: m.metadata?.name ?? "", searchId: m.metadata?.search_id ?? "" }));
  }));
}

/** Keeps saved leads in the member's memory. Record id = the leads table row id. */
export async function rememberLeads(userId: string, searchId: string, leads: Lead[]) {
  const rows = leads.filter((l) => l.rowId);
  if (!rows.length) return;
  try {
    const index = await getIndex();
    if (!index) return;
    await upsert(index, userId, rows.map((l) => ({ id: l.rowId!, text: leadText(l), meta: { name: l.name.slice(0, 200), city: l.city.slice(0, 120), search_id: searchId } })));
  } catch (e) {
    console.error("[masar] Pinecone:", e instanceof Error ? e.message : e);
  }
}

/** Removes a deleted search's leads from the member's memory. */
export async function forgetSearch(userId: string, searchId: string) {
  try {
    const index = await getIndex();
    if (!index) return;
    await call(`https://${index.host}/vectors/delete`, { method: "POST", body: JSON.stringify({ namespace: decodeURIComponent(space(userId)), filter: { search_id: { $eq: searchId } } }) }, 5000);
  } catch (e) {
    console.error("[masar] Pinecone:", e instanceof Error ? e.message : e);
  }
}

export interface Lookalike { name: string; outcome: "won" | "meeting"; score: number }

/**
 * For each lead, the closest lead from the member's earlier searches that they marked Won or Meeting.
 * Leads from this same search and the same business (same name) don't count.
 */
export async function findLookalikes(db: SupabaseClient, userId: string, searchId: string, leads: Lead[]): Promise<Map<string, Lookalike>> {
  const out = new Map<string, Lookalike>();
  try {
    const index = await getIndex();
    if (!index || !leads.length) return out;
    const found = await search(index, userId, leads.map(leadText), 10);
    const hits = found.map((hs, i) => hs.filter((h) => h.score >= LOOKALIKE_MIN && h.searchId !== searchId && normName(h.name) !== normName(leads[i].name)));
    const ids = [...new Set(hits.flat().map((h) => h.id))];
    if (!ids.length) return out;
    const { data } = await db.from("leads").select("id, outcome").in("id", ids).in("outcome", ["won", "meeting"]);
    const outcome = new Map((data ?? []).map((r) => [r.id as string, r.outcome as Lookalike["outcome"]]));
    leads.forEach((l, i) => {
      const best = hits[i].find((h) => outcome.has(h.id)); // hits come best first
      if (best) out.set(l.id, { name: best.name, outcome: outcome.get(best.id)!, score: Math.round(best.score * 100) / 100 });
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
    const { info, created } = await lookup();
    if (created) return created.ok ? `creating the index ${INDEX_NAME}, check again in a minute` : `could not create the index (${created.status}: ${(await created.text()).slice(0, 120)})`;
    if (!info) return `no index at PINECONE_HOSTNAME (${HOSTNAME}) in this API key's project`;
    if (!info.status?.ready) return `index ${info.name} is starting (${info.status?.state ?? "not ready"}), check again in a minute`;
    if (info.embed?.field_map?.text) return `ok (index ${info.name} ready, ${info.embed.model})`;
    const model = modelFor(info);
    if (!model) return `index ${info.name} can't be used (${info.vector_type ?? "dense"}, ${info.dimension ?? "?"} dimensions): make a dense index with multilingual-e5-large`;
    await embed(model, ["test"], "query"); // proves the key may use Pinecone's hosted models
    return `ok (index ${info.name} ready, Masar embeds with ${model.name})`;
  } catch (e) {
    if (e instanceof PineconeError && (e.status === 401 || e.status === 403)) return "the API key was rejected";
    return `cannot connect: ${e instanceof Error ? e.message : "unknown error"}`;
  }
}
