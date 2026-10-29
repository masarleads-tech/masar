import { describe, expect, it } from "vitest";
import { briefFromSetup } from "../src/core/brief";
import { AgentReportSchema, parseBrief, parseIncomingLead, SearchOptionsSchema } from "../src/core/schemas";

describe("parseBrief", () => {
  it("keeps valid criteria", () => {
    const b = parseBrief({ industry: "clinics", locations: ["Riyadh", " Jeddah "], count: 40, size: "chain", mustHave: ["phone"] });
    expect(b).toMatchObject({ industry: "clinics", locations: ["Riyadh", "Jeddah"], count: 40, size: "chain", mustHave: ["phone"] });
  });

  it("falls back to defaults instead of throwing on bad input", () => {
    const b = parseBrief({ industry: "clinics", locations: "Riyadh", size: "huge", count: "lots", mustHave: ["phone", "fax"] });
    expect(b.locations).toEqual([]);
    expect(b.size).toBe("any");
    expect(b.count).toBe(50);
    expect(b.mustHave).toEqual(["phone"]);
    expect(() => parseBrief(null)).not.toThrow();
    expect(() => parseBrief("not an object")).not.toThrow();
  });

  it("clamps the count and limits list sizes", () => {
    expect(parseBrief({ industry: "x", locations: [], count: 9999 }).count).toBe(200);
    expect(parseBrief({ industry: "x", locations: [], count: 1 }).count).toBe(5);
    expect(parseBrief({ industry: "x", locations: ["a", "b", "c", "d", "e", "f", "g"] }).locations).toHaveLength(5);
  });
});

describe("parseIncomingLead", () => {
  it("drops unknown fields and resets scores the client sent", () => {
    const l = parseIncomingLead({ id: "a", name: "Cafe", city: "Amman", phone: "+962", fit: 100, closing: 100, admin: true, instagramVerdict: "great" })!;
    expect(l.fit).toBe(0);
    expect(l.closing).toBe(0);
    expect(l.instagramVerdict).toBeNull();
    expect((l as unknown as Record<string, unknown>).admin).toBeUndefined();
  });

  it("rejects a lead with no id or name", () => {
    expect(parseIncomingLead({ name: "x" })).toBeNull();
    expect(parseIncomingLead({ id: "x", name: "" })).toBeNull();
    expect(parseIncomingLead("junk")).toBeNull();
  });

  it("caps long strings", () => {
    expect(parseIncomingLead({ id: "a", name: "b", phone: "9".repeat(5000) })!.phone).toHaveLength(60);
  });
});

describe("other shared schemas", () => {
  it("defaults search options", () => {
    expect(SearchOptionsSchema.parse({})).toMatchObject({ timeoutMs: 240000, openStreetMap: false, websites: true });
  });
  it("accepts only known agents and statuses in reports", () => {
    expect(AgentReportSchema.safeParse({ agent: "linkedin", phase: "enrich", status: "unsupported", message: "", found: 0, durationMs: 0 }).success).toBe(true);
    expect(AgentReportSchema.safeParse({ agent: "tiktok", phase: "enrich", status: "ok", message: "", found: 0, durationMs: 0 }).success).toBe(false);
    expect(AgentReportSchema.safeParse({ agent: "linkedin", phase: "enrich", status: "great", message: "", found: 0, durationMs: 0 }).success).toBe(false);
  });
  it("turns setup answers into a starting brief", () => {
    expect(briefFromSetup({ industries: ["Clinics", "Retail"], cities: ["Riyadh"], leads_per_week: 25 })).toEqual({ industry: "clinics", locations: ["Riyadh"], count: 25 });
    expect(briefFromSetup({ industries: ["Logistics"] })).toMatchObject({ industry: "custom", industryCustom: "Logistics and shipping companies" });
    expect(briefFromSetup(null)).toEqual({});
  });
});
