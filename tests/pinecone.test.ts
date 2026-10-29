import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { lead } from "./helpers";

/**
 * A stand-in for Pinecone, so no test reaches the network: the index exists, upserts are kept, and a search
 * answers with fixed scores. Plus a stand-in for the Supabase leads table with each row's outcome.
 */
const upserts: string[] = [];
const calls: string[] = [];
let indexState: "missing" | "ready" = "missing";
const pinecone = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  calls.push(`${init?.method} ${url}`);
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
  if (url.endsWith("/indexes/masar-leads")) return indexState === "ready" ? json({ name: "masar-leads", host: "masar-leads.svc.pinecone.io", status: { ready: true, state: "Ready" }, embed: { model: "multilingual-e5-large", field_map: { text: "text" } } }) : json({ error: "not found" }, 404);
  if (url.endsWith("/indexes/create-for-model")) { indexState = "ready"; return json({ name: "masar-leads" }, 201); }
  if (url.endsWith("/upsert")) { upserts.push(String(init?.body)); return new Response(null, { status: 201 }); }
  if (url.endsWith("/search")) {
    return json({ result: { hits: [
      { _id: "row-same-search", _score: 0.97, fields: { name: "Other Cafe", search_id: "s2" } },
      { _id: "row-lost", _score: 0.95, fields: { name: "Lost Cafe", search_id: "s1" } },
      { _id: "row-won", _score: 0.91, fields: { name: "Won Cafe", search_id: "s1" } },
      { _id: "row-far", _score: 0.6, fields: { name: "Far Cafe", search_id: "s1" } },
    ] }, usage: { read_units: 1 } });
  }
  return json({}, 400);
}) as typeof fetch;

const outcomes: Record<string, string> = { "row-same-search": "won", "row-lost": "lost", "row-won": "won", "row-far": "won" };
const db = {
  from: () => {
    let ids: string[] = [], keep: string[] = [];
    const q = {
      select: () => q,
      in: (col: string, vals: string[]) => { if (col === "id") ids = vals; else keep = vals; return q; },
      then: (done: (r: unknown) => void) => done({ data: ids.filter((id) => keep.includes(outcomes[id])).map((id) => ({ id, outcome: outcomes[id] })), error: null }),
    };
    return q;
  },
} as unknown as SupabaseClient;

let mod: typeof import("../src/lib/pinecone");
beforeAll(async () => {
  vi.stubEnv("PINECONE_API_KEY", "pcsk_test");
  vi.stubGlobal("fetch", pinecone);
  mod = await import("../src/lib/pinecone");
});
afterAll(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("Pinecone lead memory", () => {
  it("creates the index on /api/health when it's missing, then reports it ready", async () => {
    expect(await mod.pineconeStatus()).toMatch(/creating the index masar-leads/);
    expect(await mod.pineconeStatus()).toBe("ok (index masar-leads ready, multilingual-e5-large)");
  });

  it("finds the closest Won lead from earlier searches and moves the lead up", async () => {
    const l = lead("a", "New Cafe", { rank: 50 });
    const found = await mod.findLookalikes(db, "user_1", "s2", [l]);
    // The same search's lead, the lost one and the far one don't count.
    expect(found.get("a")).toEqual({ name: "Won Cafe", outcome: "won", score: 0.91 });
    const [ranked] = mod.applyLookalikes([l], found);
    expect(ranked.rank).toBe(58);
    expect(ranked.lookalike?.name).toBe("Won Cafe");
  });

  it("ignores a hit that is the same business", async () => {
    const found = await mod.findLookalikes(db, "user_1", "s2", [lead("b", "Won Cafe")]);
    expect(found.size).toBe(0);
  });

  it("keeps saved leads in the member's own namespace", async () => {
    await mod.rememberLeads("user_1", "s2", [lead("a", "New Cafe", { rowId: "row-new", category: "cafe" }), lead("c", "Unsaved")]);
    expect(calls.some((c) => c.includes("/records/namespaces/member-user_1/upsert"))).toBe(true);
    const lines = upserts.at(-1)!.split("\n").map((x) => JSON.parse(x));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ _id: "row-new", name: "New Cafe", search_id: "s2" });
    expect(lines[0].text).toContain("cafe");
  });

  it("leaves leads unchanged when nothing looks alike", () => {
    const ls = [lead("a", "A", { rank: 10 }), lead("b", "B", { rank: 20 })];
    expect(mod.applyLookalikes(ls, new Map())).toBe(ls);
  });
});

describe("Pinecone index made by Vercel's integration", () => {
  it("finds the index by PINECONE_HOSTNAME and embeds into its own field", async () => {
    vi.resetModules();
    vi.stubEnv("PINECONE_HOSTNAME", "https://masar-abc.svc.pinecone.io");
    const bodies: string[] = [];
    vi.stubGlobal("fetch", (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/indexes")) return new Response(JSON.stringify({ indexes: [
        { name: "other", host: "other.svc.pinecone.io", status: { ready: true }, embed: { field_map: { text: "text" } } },
        { name: "masar", host: "masar-abc.svc.pinecone.io", status: { ready: true }, embed: { model: "multilingual-e5-large", field_map: { text: "chunk_text" } } },
      ] }));
      bodies.push(`${url} ${init?.body}`);
      return new Response(null, { status: 201 });
    }) as typeof fetch);
    const m = await import("../src/lib/pinecone");
    expect(await m.pineconeStatus()).toBe("ok (index masar ready, multilingual-e5-large)");
    await m.rememberLeads("user_1", "s1", [lead("a", "Cafe", { rowId: "r1" })]);
    expect(bodies[0]).toContain("https://masar-abc.svc.pinecone.io/records/namespaces/member-user_1/upsert");
    expect(bodies[0]).toContain('"chunk_text":');
  });
});

describe("Pinecone index without a model attached", () => {
  it("embeds with Pinecone's hosted model and uses the vectors API", async () => {
    vi.resetModules();
    vi.stubEnv("PINECONE_HOSTNAME", "masar-xyz.svc.pinecone.io");
    const seen: { url: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal("fetch", (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const json = (b: unknown) => new Response(JSON.stringify(b), { headers: { "content-type": "application/json" } });
      if (url.endsWith("/indexes")) return json({ indexes: [{ name: "masar", host: "masar-xyz.svc.pinecone.io", dimension: 1024, vector_type: "dense", status: { ready: true } }] });
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      seen.push({ url, body });
      if (url.endsWith("/embed")) return json({ data: (body.inputs as unknown[]).map(() => ({ values: [0.1, 0.2] })) });
      if (url.endsWith("/query")) return json({ matches: [{ id: "row-won", score: 0.9, metadata: { name: "Won Cafe", search_id: "s1" } }] });
      return json({ upsertedCount: 1 });
    }) as typeof fetch);
    const m = await import("../src/lib/pinecone");
    expect(await m.pineconeStatus()).toBe("ok (index masar ready, Masar embeds with multilingual-e5-large)");

    await m.rememberLeads("user_1", "s1", [lead("a", "Cafe", { rowId: "r1" })]);
    const up = seen.find((x) => x.url.endsWith("/vectors/upsert"))!;
    expect(up.body).toMatchObject({ namespace: "member-user_1", vectors: [{ id: "r1", values: [0.1, 0.2], metadata: { name: "Cafe", search_id: "s1" } }] });
    expect(seen.find((x) => x.url.endsWith("/embed") && (x.body.parameters as { input_type: string }).input_type === "passage")).toBeTruthy();

    const found = await m.findLookalikes(db, "user_1", "s2", [lead("b", "New Cafe")]);
    expect(found.get("b")).toEqual({ name: "Won Cafe", outcome: "won", score: 0.9 });
  });
});
