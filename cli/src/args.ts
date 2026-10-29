import { SOURCES } from "../../src/core";
import { INDUSTRIES } from "../../src/lib/industries";
import { cleanSources, normalizeBrief, type Plan } from "./agents/main";

/** Command-line words and flags: `--k v`, `--k=v`, `--flag`, and the short -h, -v, -y. */
export function parseArgs(argv: string[]) {
  const flags: Record<string, string | true> = {};
  const words: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=", 2);
      if (v !== undefined) flags[k] = v;
      else if (argv[i + 1] && !argv[i + 1].startsWith("-")) flags[k] = argv[++i];
      else flags[k] = true;
    } else if (a === "-h") flags.help = true;
    else if (a === "-v") flags.version = true;
    else if (a === "-y") flags.yes = true;
    else words.push(a);
  }
  return { flags, words };
}

/** `masar find --city … --industry …` skips the Boss's interview. Null when no city is given. */
export function planFromFlags(flags: Record<string, string | true>, cap: number): Plan | null {
  const flag = (k: string) => (typeof flags[k] === "string" ? (flags[k] as string) : undefined);
  const city = flag("city") ?? flag("cities");
  if (!city) return null;
  const ind = flag("industry") ?? "custom";
  const known = INDUSTRIES.some((i) => i.key === ind);
  // --agents keeps its old names working: google → google_web, website → read websites.
  const asked = flag("agents")?.split(",").map((s) => s.trim().toLowerCase().replace(/^google$/, "google_web")) ?? [...SOURCES, "website"];
  return {
    brief: normalizeBrief({ industry: known ? ind : "custom", industryCustom: known ? "" : (flag("what") ?? ind), locations: city.split(/[,،]/), offer: flag("offer") ?? "", count: Number(flag("count")) || 20 }, cap),
    sources: cleanSources(asked), websites: !flags["no-websites"] && (asked.includes("website") || !flag("agents")),
    reason: "Chosen with command-line options.", summary: "",
  };
}
