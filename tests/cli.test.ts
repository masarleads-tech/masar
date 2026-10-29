import { describe, expect, it } from "vitest";
import { parseArgs, planFromFlags } from "../cli/src/args";
import { collectorStatus } from "../cli/src/collectors";
import { normalizeBrief } from "../cli/src/agents/main";
import { env } from "./helpers";

describe("CLI", () => {
  it("parses words and flags", () => {
    const { flags, words } = parseArgs(["find", "coffee", "--city", "Amman", "--count=10", "--json", "-y"]);
    expect(words).toEqual(["find", "coffee"]);
    expect(flags).toEqual({ city: "Amman", count: "10", json: true, yes: true });
  });

  it("builds a plan from flags, mapping old agent names to the collectors", () => {
    const plan = planFromFlags(parseArgs(["--city", "Amman, Irbid", "--industry", "cafes", "--agents", "google,website,linkedin,tiktok", "--count", "15"]).flags, 100)!;
    expect(plan.brief).toMatchObject({ industry: "cafes", locations: ["Amman", "Irbid"], count: 15 });
    expect(plan.sources).toEqual(["google_web", "linkedin"]);
    expect(plan.websites).toBe(true);
  });

  it("sends every collector by default and needs a city", () => {
    expect(planFromFlags({ city: "Riyadh" }, 50)!.sources).toEqual(["google_web", "instagram", "facebook", "linkedin"]);
    expect(planFromFlags({ industry: "cafes" }, 50)).toBeNull();
  });

  it("keeps the lead count within the member's credits", () => {
    expect(normalizeBrief({ industry: "clinics", locations: ["Riyadh"], count: 80 }, 12).count).toBe(12);
    expect(normalizeBrief({ industry: "pet_shops_unknown", locations: [] }, 50)).toMatchObject({ industry: "custom", industryCustom: "pet shops unknown" });
  });

  it("doctor says which APIs are connected without printing secrets", () => {
    const lines = collectorStatus({ ...env, facebookAppToken: "app|SECRET" });
    expect(lines.find((l) => l.text.startsWith("Facebook"))?.ok).toBe(true);
    expect(lines.map((l) => l.text).join(" ")).not.toContain("SECRET");
  });
});
