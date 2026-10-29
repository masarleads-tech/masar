import { describe, expect, it } from "vitest";
import { applyPatches, categoryOf, compatibility, dedupe, dedupeKeys, rank, saveCollected, saveLeads, verification } from "../src/core/intelligence";
import { prov } from "../src/core/collectors/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { brief, fakeLlm, lead } from "./helpers";

describe("deduplication", () => {
  it("merges the same business found by phone, website or name", () => {
    const leads = [
      lead("a", "Rumi Coffee", { phone: "+962 6 464 4131", sources: ["maps"] }),
      lead("b", "Rumi Cafe Lweibdeh", { phone: "064644131", email: "hi@rumi.jo", sources: ["web"] }),
      lead("c", "Almond", { website: "https://www.almond.jo/menu" }),
      lead("d", "Almond Coffee House", { website: "http://almond.jo" }),
      lead("e", "Dimitri's Coffee"),
      lead("f", "Dimitri's  coffee"),
    ];
    const out = dedupe(leads);
    expect(out.map((l) => l.id)).toEqual(["a", "c", "e"]);
    expect(out[0]).toMatchObject({ email: "hi@rumi.jo", sources: ["maps", "web"] });
  });

  it("does not merge businesses that only share a social site domain", () => {
    expect(dedupeKeys(lead("a", "A", { website: "https://instagram.com/a" }))).not.toContain("w:instagram.com");
    expect(dedupe([lead("a", "A", { website: "https://instagram.com/a" }), lead("b", "B", { website: "https://instagram.com/b" })])).toHaveLength(2);
  });

  it("applies patches in order and keeps provenance", () => {
    const [l] = applyPatches([lead("a", "A")], [
      { id: "a", fields: { instagramVerdict: "warn" }, sources: ["s1"], provenance: [prov("web_search", "instagram_check", null)] },
      { id: "a", fields: { instagramVerdict: "pass" }, sources: ["s2"], provenance: [prov("instagram", "instagram_check", "https://instagram.com/a")] },
      { id: "missing", fields: { phone: "1" }, sources: [], provenance: [] },
    ]);
    expect(l.instagramVerdict).toBe("pass");
    expect(l.sources).toEqual(["s1", "s2"]);
    expect(l.provenance?.map((p) => p.source)).toEqual(["web_search", "instagram"]);
  });
});

describe("scoring", () => {
  it("counts official-API checks above search-result guesses", () => {
    const viaSearch = verification(lead("a", "A", { instagramVerdict: "pass", provenance: [prov("web_search", "instagram_check", null)] }));
    const viaApi = verification(lead("b", "B", { instagramVerdict: "pass", provenance: [prov("instagram", "instagram_check", null)] }));
    expect(viaApi.score).toBeGreaterThan(viaSearch.score);
  });

  it("ranks by 40% fit, 30% compatibility and 30% verified information", () => {
    const strong = lead("a", "Strong", { phone: "+962790000000", email: "a@a.jo", website: "https://a.jo", provenance: [prov("places", "name", null), prov("website", "email", null)] });
    const weak = lead("b", "Weak");
    const [first, second] = rank(brief, [weak, strong], new Map([["a", { compatibility: 90, reason: "good" }], ["b", { compatibility: 10, reason: "bad" }]]));
    expect(first.id).toBe("a");
    expect(first.compatibility).toBe(90);
    expect(first.compatibilityReason).toBe("good");
    const expected = Math.round(0.4 * first.fit + 0.3 * 90 + 0.3 * first.verified!);
    expect(first.rank).toBe(expected);
    expect(second.rank).toBeLessThan(first.rank!);
  });

  it("pushes failed legitimacy checks down", () => {
    const [a, b] = rank(brief, [lead("a", "A", { instagramVerdict: "fail" }), lead("b", "B")]);
    expect(a.id).toBe("b");
    expect(b.legitimacy).toBe("fail");
  });

  it("asks the AI for compatibility in batches", async () => {
    let calls = 0;
    const llm = fakeLlm((p) => { calls++; const ids = [...p.matchAll(/"id": "([^"]+)"/g)].map((m) => m[1]); return { results: ids.map((id) => ({ id, compatibility: 70, reason: "ok" })) }; });
    const leads = Array.from({ length: 20 }, (_, i) => lead(`l${i}`, `Lead ${i}`));
    const out = await compatibility(llm, brief, leads);
    expect(calls).toBe(2);
    expect(out.size).toBe(20);
  });
});

describe("saving to Supabase", () => {
  function fakeDb() {
    const writes: { table: string; op: string; rows: unknown }[] = [];
    const chain = (table: string) => {
      const q = {
        upsert: (rows: unknown) => { writes.push({ table, op: "upsert", rows }); return Object.assign(Promise.resolve({ error: null }), { select: () => Promise.resolve({ data: (rows as { lead_key: string }[]).map((r, i) => ({ id: `row${i}`, lead_key: r.lead_key, outcome: "new", note: "" })), error: null }) }); },
        update: (rows: unknown) => { writes.push({ table, op: "update", rows }); return { eq: () => ({ in: () => Promise.resolve({ error: null }) }) }; },
      };
      return q;
    };
    return { db: { from: chain } as unknown as SupabaseClient, writes };
  }

  it("files every collected business under the searched category", async () => {
    const { db, writes } = fakeDb();
    await saveCollected(db, "u1", "s1", brief, [lead("a", "A", { category: "Coffee Shop", provenance: [prov("places", "name", null)] })]);
    expect(writes[0]).toMatchObject({ table: "collected_leads", op: "upsert" });
    expect((writes[0].rows as Record<string, unknown>[])[0]).toMatchObject({ user_id: "u1", search_id: "s1", lead_key: "a", category: "cafes", business_type: "coffee_shop", city: "Amman", sources: ["places"], stage: "found" });
  });

  it("saves checked leads with their category and marks them checked", async () => {
    const { db, writes } = fakeDb();
    const saved = await saveLeads(db, "u1", "s1", brief, [lead("a", "A")]);
    expect(saved.get("a")).toMatchObject({ id: "row0", outcome: "new" });
    expect(writes.map((w) => `${w.table}:${w.op}`)).toEqual(["leads:upsert", "collected_leads:upsert", "collected_leads:update"]);
    expect((writes[0].rows as Record<string, unknown>[])[0]).toMatchObject({ category: "cafes", user_id: "u1" });
  });

  it("uses the member's own words for a custom category", () => {
    expect(categoryOf({ ...brief, industry: "custom", industryCustom: "Pet groomers" }, lead("a", "A")).category).toBe("custom:pet_groomers");
  });
});
