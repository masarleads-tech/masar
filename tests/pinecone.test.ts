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
  if (url.endsWith("/indexes/masar-leads")) return indexState === "ready" ? json({ host: "masar-leads.svc.pinecone.io", status: { ready: true, state: "Ready" } }) : json({ error: "not found" }, 404);
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
    expect(await mod.pineconeStatus()).toBe("ok (index masar-leads ready)");
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
