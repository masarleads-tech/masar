import { describe, expect, it } from "vitest";
import { bossDiscover, bossEnrich, bossSearch } from "../src/core/boss";
import type { Collector } from "../src/core/collectors/types";
import { sleep } from "../src/core/util";
import type { ProgressEvent } from "../src/core/schemas";
import { brief, env, lead, options } from "./helpers";

const req = { brief, options };
const deps = (collectors: Collector[], extra = {}) => ({ llm: null, env, collectors, ...extra });

const found = (id: Collector["id"], names: string[], ms = 0): Collector => ({
  id, availability: () => ({ ok: true }),
  async discover(ctx) { await sleep(ms, ctx.signal); return { items: names.map((n) => lead(`${id}:${n}`, n, { category: "Cafe" })) }; },
});

describe("Boss", () => {
  it("runs collectors in parallel", async () => {
    const t0 = Date.now();
    const r = await bossDiscover(req, deps([found("google_web", ["A"], 200), found("facebook", ["B"], 200)]));
    expect(Date.now() - t0).toBeLessThan(380);
    expect(r.leads.map((l) => l.name).sort()).toEqual(["A", "B"]);
  });

  it("keeps the others' results when one collector throws", async () => {
    const broken: Collector = { id: "facebook", availability: () => ({ ok: true }), discover: async () => { throw new Error("Meta is down"); } };
    const r = await bossDiscover(req, deps([found("google_web", ["A"]), broken]));
    expect(r.leads.map((l) => l.name)).toEqual(["A"]);
    expect(r.reports.find((x) => x.agent === "facebook")).toMatchObject({ status: "error", message: "Meta is down" });
    expect(r.warnings).toContain("Facebook: Meta is down");
  });

  it("times a slow collector out without waiting for it", async () => {
    const t0 = Date.now();
    const r = await bossDiscover({ brief, options: { ...options, timeoutMs: 100 } }, deps([found("google_web", ["A"]), found("facebook", ["B"], 5000)]));
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(r.leads.map((l) => l.name)).toEqual(["A"]);
    expect(r.reports.find((x) => x.agent === "facebook")?.status).toBe("timeout");
  });

  it("reports disabled and unsupported collectors without calling them", async () => {
    let called = false;
    const off: Collector = { id: "instagram", availability: () => ({ ok: false, status: "disabled", reason: "no token" }), discover: async () => { called = true; return { items: [] }; } };
    const none: Collector = { id: "linkedin", availability: () => ({ ok: true }) };
    const r = await bossDiscover(req, deps([found("google_web", ["A"]), off, none]));
    expect(called).toBe(false);
    expect(r.reports.find((x) => x.agent === "instagram")).toMatchObject({ status: "disabled", message: "no token" });
    expect(r.reports.find((x) => x.agent === "linkedin")?.status).toBe("unsupported");
    expect(r.reports.find((x) => x.agent === "connector")?.status).toBe("disabled");
  });

  it("only sends the collectors the request asks for", async () => {
    const r = await bossDiscover({ brief, options: { ...options, sources: ["facebook"] } }, deps([found("google_web", ["A"]), found("facebook", ["B"])]));
    expect(r.leads.map((l) => l.name)).toEqual(["B"]);
    expect(r.reports.some((x) => x.agent === "google_web")).toBe(false);
  });

  it("passes partial results and their status through", async () => {
    const half: Collector = { id: "google_web", availability: () => ({ ok: true }), discover: async () => ({ items: [lead("a", "A")], status: "partial", message: "one city failed" }) };
    const r = await bossDiscover(req, deps([half]));
    expect(r.leads).toHaveLength(1);
    expect(r.reports.find((x) => x.agent === "google_web")).toMatchObject({ status: "partial", message: "one city failed", found: 1 });
  });

  it("enriches with google_web first, so later collectors see its findings", async () => {
    const seen: (string | null)[] = [];
    const web: Collector = { id: "google_web", availability: () => ({ ok: true }),
      enrich: async (_c, leads) => ({ items: leads.map((l) => ({ id: l.id, fields: { instagram: "https://instagram.com/a" }, sources: [], provenance: [] })) }) };
    const ig: Collector = { id: "instagram", availability: () => ({ ok: true }),
      enrich: async (_c, leads) => { seen.push(...leads.map((l) => l.instagram)); return { items: leads.map((l) => ({ id: l.id, fields: { instagramVerdict: "pass" as const }, sources: [], provenance: [] })) }; } };
    const r = await bossEnrich(req, [lead("a", "A")], deps([ig, web]));
    expect(seen).toEqual(["https://instagram.com/a"]);
    expect(r.leads[0]).toMatchObject({ instagram: "https://instagram.com/a", instagramVerdict: "pass", enriched: true });
    expect(r.reports.at(-1)?.agent).toBe("intelligence");
  });

  it("runs a whole search, reports progress, and never throws for a collector failure", async () => {
    const events: ProgressEvent[] = [];
    const flaky: Collector = { id: "facebook", availability: () => ({ ok: true }), discover: async () => { throw new Error("boom"); }, enrich: async () => { throw new Error("boom"); } };
    const web: Collector = { ...found("google_web", ["A", "B", "C"]), enrich: async (_c, leads) => ({ items: leads.map((l) => ({ id: l.id, fields: { phone: "+962790000000" }, sources: [], provenance: [] })) }) };
    const r = await bossSearch(req, deps([web, flaky], { onProgress: (e: ProgressEvent) => events.push(e), batchSize: 2 }));
    expect(r.found).toHaveLength(3);
    expect(r.leads).toHaveLength(3);
    expect(r.leads.every((l) => l.phone && typeof l.rank === "number")).toBe(true);
    expect(r.reports.filter((x) => x.agent === "facebook" && x.phase === "enrich")).toHaveLength(1);
    expect(r.reports.find((x) => x.agent === "facebook" && x.phase === "enrich")?.status).toBe("error");
    expect(events.some((e) => e.agent === "boss")).toBe(true);
    expect(events.some((e) => e.agent === "intelligence" && e.state === "finished")).toBe(true);
  });
});
