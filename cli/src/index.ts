import { spawn } from "node:child_process";
import { INDUSTRIES } from "../../src/lib/industries";
import { createAI, detect, PROVIDERS } from "./ai/providers";
import { obj, bool } from "./agents/schema";
import { FINDERS, interview, normalizeBrief, type Finder, type Plan } from "./agents/main";
import { present } from "./agents/documenter";
import { api, ApiError, type Me } from "./api";
import { configPath, loadConfig, saveConfig, type Config, type ProviderId } from "./config";
import { writeCsv, writeJson } from "./export";
import { runPipeline } from "./pipeline";
import * as ui from "./ui";
import { VERSION } from "./version";

// ---------- Arguments ----------

const argv = process.argv.slice(2);
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
const flag = (k: string) => (typeof flags[k] === "string" ? (flags[k] as string) : undefined);

const AGENT_NAME: Record<Finder, string> = { google: "Google", website: "Website", instagram: "Instagram", facebook: "Facebook", linkedin: "LinkedIn" };
const PLAN_NAME: Record<Me["plan"], string> = { free: "Free", weekly: "Weekly", basic: "Basic", premium: "Premium" };

function openBrowser(url: string) {
  const [cmd, args] = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  try { spawn(cmd, args, { stdio: "ignore", detached: true, windowsHide: true }).on("error", () => {}).unref(); } catch { /* print the link instead */ }
}

// ---------- Commands ----------

async function login(cfg: Config) {
  ui.banner("Sign in with your Masar account");
  const start = await api.start(cfg);
  ui.panel("Your sign-in code", [
    "",
    "   " + ui.c.accentBold(start.user_code.split("").join(" ")),
    "",
    ui.c.muted("Approve it on the Masar website:"),
    ui.link(start.verification_uri_complete),
  ]);
  if (!flags["no-browser"]) openBrowser(start.verification_uri_complete);
  ui.info("Opening your browser… If it didn't open, copy the link above.");
  const sp = ui.spinner("Waiting for you to approve on the website");
  const until = Date.now() + start.expires_in * 1000;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, Math.max(2, start.interval) * 1000));
    let r: Awaited<ReturnType<typeof api.poll>>;
    try { r = await api.poll(cfg, start.device_code); } catch { continue; }
    if (r.status === "pending") continue;
    if (r.status === "approved" && r.token) {
      cfg.token = r.token; cfg.email = r.email ?? undefined;
      saveConfig(cfg);
      sp.done(`Signed in as ${r.email ?? "your Masar account"}`);
      if (cfg.ai) await api.setAi(cfg, cfg.ai.provider, cfg.ai.model ?? "").catch(() => {});
      return true;
    }
    sp.fail(r.status === "denied" ? "Sign-in was denied on the website." : "This code can't be used any more. Run masar login again.");
    return false;
  }
  sp.fail("The code expired. Run masar login again.");
  return false;
}

async function logout(cfg: Config) {
  if (cfg.token) await api.logout(cfg).catch(() => {});
  delete cfg.token; delete cfg.email;
  saveConfig(cfg);
  ui.ok("Signed out on this computer.");
}

async function status(cfg: Config) {
  ui.banner();
  if (!cfg.token) { ui.warn("Not signed in. Run: masar login"); return; }
  const me = await api.me(cfg);
  ui.facts([
    ["Account", ui.c.text(me.email ?? cfg.email ?? "—")],
    ["Plan", ui.c.strong(PLAN_NAME[me.plan]) + (me.planUntil ? ui.c.muted(`  until ${new Date(me.planUntil).toLocaleDateString("en-GB")}`) : "")],
    ["Credits", me.cliLeadsFree ? ui.c.accent("CLI leads are free on your plan") : `${ui.c.strong(String(me.credits))} ${ui.c.muted("left · 1 credit per saved lead")}`],
    ["AI", cfg.ai ? `${PROVIDERS[cfg.ai.provider].label}${cfg.ai.model ? ui.c.muted(` · ${cfg.ai.model}`) : ""}` : ui.c.warn("not chosen yet (masar ai)")],
    ["Dashboard", ui.link(me.dashboardUrl)],
  ]);
  ui.print();
}

async function chooseAi(cfg: Config) {
  ui.heading("Choose your AI");
  ui.info("Masar runs your AI on this computer, signed in as you, for your own searches. Your AI login and keys never leave this computer.");
  const found = await detect();
  const ids = Object.keys(PROVIDERS) as ProviderId[];
  let pick = words[1] as ProviderId | undefined;
  if (!pick || !ids.includes(pick)) {
    const labels = ids.map((id) => {
      const d = found.find((f) => f.id === id)!;
      return `${PROVIDERS[id].label}  ${d.ready ? ui.c.accent("● ready") : ui.c.muted(`○ ${d.detail}`)}`;
    });
    const first = ids.findIndex((id) => found.find((f) => f.id === id)?.ready);
    const chosen = await ui.choose("Which AI should Masar's agents use?", labels, { default: first >= 0 ? first : 0 });
    pick = ids[labels.indexOf(chosen)];
  }
  const d = found.find((f) => f.id === pick)!;
  let model = flag("model");
  let baseUrl = flag("url");
  if (!model && d.models?.length) model = await ui.choose("Which model?", d.models.slice(0, 15), { default: 0, allowOther: true });
  else if (!model && (pick === "ollama" || pick === "openai-compatible")) model = await ui.ask("Model name", { hint: pick === "ollama" ? "For example llama3.1:8b or qwen2.5:14b (run: ollama pull <name>)" : "As your local server names it" });
  else if (!model && pick === "claude-code") model = (await ui.choose("Which Claude model?", ["Default (what Claude Code uses)", "sonnet", "opus", "haiku"], { default: 0 })).replace(/^Default.*/, "");
  if (pick === "openai-compatible" && !baseUrl) baseUrl = await ui.ask("Server URL", { default: "http://127.0.0.1:1234/v1" });
  cfg.ai = { provider: pick, ...(model ? { model } : {}), ...(baseUrl ? { baseUrl } : {}) };
  saveConfig(cfg);
  ui.ok(`Masar will use ${PROVIDERS[pick].label}${model ? ` · ${model}` : ""}`);
  ui.info(PROVIDERS[pick].note);
  if (!PROVIDERS[pick].web) ui.warn("Local models can't search the web: you get map and website data, without Instagram, Facebook and LinkedIn checks.");
  if (cfg.token) await api.setAi(cfg, pick, model ?? "").catch(() => {});
  if (!flags.yes && (await ui.confirm("Test it now?"))) await testAi(cfg);
}

async function testAi(cfg: Config) {
  const ai = createAI(cfg.ai);
  const sp = ui.spinner(`Asking ${ai.label} a test question`);
  try {
    const r = await ai.ask<{ ok: boolean }>("Reply with ok=true.", { schema: obj({ ok: bool }) });
    if (r.ok) sp.done(`${ai.label} works`); else sp.warn(`${ai.label} answered, but not as expected`);
  } catch (e) {
    sp.fail(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  }
}

function planFromFlags(cap: number): Plan | null {
  const city = flag("city") ?? flag("cities");
  if (!city) return null;
  const ind = flag("industry") ?? "custom";
  const known = INDUSTRIES.some((i) => i.key === ind);
  const agents = (flag("agents")?.split(",").map((s) => s.trim()) ?? ["google", "website", "instagram", "facebook", "linkedin"]).filter((a): a is Finder => (FINDERS as readonly string[]).includes(a));
  return {
    brief: normalizeBrief({ industry: known ? ind : "custom", industryCustom: known ? "" : (flag("what") ?? ind), locations: city.split(/[,،]/), offer: flag("offer") ?? "", count: Number(flag("count")) || 20 }, cap),
    agents: [...new Set<Finder>(["google", ...agents])], queries: [], reason: "Chosen with command-line options.", summary: "",
  };
}

async function find(cfg: Config) {
  ui.banner("Find the decision makers your next conversation depends on.");
  if (!cfg.token) {
    ui.warn("Sign in first, so your leads and usage go to your Masar dashboard.");
    if (!(await login(cfg))) return;
  }
  if (!cfg.ai) await chooseAi(cfg);
  const ai = createAI(cfg.ai);
  const me = await api.me(cfg);
  const cap = me.cliLeadsFree ? 200 : Math.min(200, me.credits);
  ui.facts([
    ["Signed in", ui.c.text(me.email ?? "—") + ui.c.muted(`  ·  ${PLAN_NAME[me.plan]} plan`)],
    ["Credits", me.cliLeadsFree ? ui.c.accent("free on your plan") : `${me.credits} left ${ui.c.muted("· 1 per saved lead")}`],
    ["AI", `${PROVIDERS[ai.id].label}${cfg.ai?.model ? ui.c.muted(` · ${cfg.ai.model}`) : ""}`],
  ]);
  if (cap <= 0) {
    ui.print();
    ui.fail("You have no credits left this month.");
    ui.info(`Basic gives 300 a month; on Premium, CLI leads are free. See ${me.dashboardUrl}`);
    return;
  }

  let plan = planFromFlags(cap) ?? (await interview(ai, me, cap, words.slice(1).join(" ") || undefined));
  for (;;) {
    ui.print();
    const b = plan.brief;
    ui.panel("The plan", [
      ...(plan.summary ? [ui.c.text(plan.summary), ""] : []),
      ui.c.muted("Looking for  ") + (b.industryCustom || INDUSTRIES.find((i) => i.key === b.industry)?.en || b.industry),
      ui.c.muted("Where        ") + b.locations.join(", "),
      ui.c.muted("Selling      ") + (b.offer || "—"),
      ui.c.muted("How many     ") + `${b.count} leads` + (me.cliLeadsFree ? "" : ui.c.muted(`  (up to ${b.count} credits)`)),
      ui.c.muted("Agents       ") + ["Main", ...plan.agents.map((a) => AGENT_NAME[a]), "Documenter"].join(ui.c.line(" → ")),
      ...(plan.reason ? [ui.c.muted("Why          ") + plan.reason] : []),
    ]);
    if (flags.yes) break;
    const go = await ui.choose("Start the search?", ["Yes, start", "Change something", "Cancel"], { default: 0 });
    if (go === "Cancel") return;
    if (go === "Yes, start") break;
    const change = await ui.ask("What should I change?");
    plan = await interview(ai, me, cap, `${JSON.stringify(plan.brief)}\nChange: ${change}`);
  }

  const result = await runPipeline(ai, plan);
  if (!result.leads.length) return;
  present(result.leads);

  // Save to the member's account and log the usage
  ui.print();
  let toSave = result.leads;
  if (!me.cliLeadsFree && toSave.length > me.credits) toSave = toSave.slice(0, me.credits);
  if (!flags["no-save"]) {
    const sp = ui.spinner("Saving to your Masar dashboard");
    try {
      const saved = await api.save(cfg, {
        brief: plan.brief, leads: toSave, found: result.found, agents: result.agentsRan,
        ai: { provider: ai.id, model: cfg.ai?.model ?? "" }, usage: ai.usage, durationMs: result.durationMs,
      });
      sp.done(`Saved ${saved.saved} leads to your dashboard` + (saved.free ? ui.c.muted("  ·  free on Premium") : ui.c.muted(`  ·  ${saved.charged} credits used, ${saved.creditsLeft} left`)));
      if (saved.skipped) ui.warn(`${saved.skipped} leads were not saved because you ran out of credits.`);
      ui.info(`Open your dashboard: ${saved.dashboardUrl}`);
    } catch (e) {
      sp.fail(`Could not save to Masar: ${e instanceof Error ? e.message : e}`);
    }
  }
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const csv = writeCsv(toSave, flag("out") ?? `masar-leads-${stamp}.csv`);
  ui.ok(`Saved the list to ${csv}`);
  if (flags.json) ui.ok(`And as JSON: ${writeJson(toSave, csv.replace(/\.csv$/i, "") + ".json")}`);
  const u = ai.usage;
  ui.info(`AI usage: ${(u.inputTokens + u.outputTokens).toLocaleString("en")} tokens, ${u.webSearches} web searches, ${Math.round(result.durationMs / 1000)}s`);
  ui.print();
}

async function doctor(cfg: Config) {
  ui.banner("Checking this computer");
  ui.facts([["Version", VERSION], ["Node.js", process.version], ["Settings", configPath()], ["Masar site", cfg.site]]);
  ui.print();
  try { await fetch(cfg.site + "/api/health", { signal: AbortSignal.timeout(10_000) }); ui.ok("Masar website reachable"); } catch { ui.fail(`Can't reach ${cfg.site}`); }
  if (cfg.token) { try { const me = await api.me(cfg); ui.ok(`Signed in as ${me.email}`); } catch (e) { ui.fail(e instanceof Error ? e.message : String(e)); } } else ui.warn("Not signed in (masar login)");
  for (const d of await detect()) (d.ready ? ui.ok : ui.info)(`${PROVIDERS[d.id].label}: ${d.detail}`);
  if (cfg.ai) await testAi(cfg); else ui.warn("No AI chosen yet (masar ai)");
  ui.print();
}

function help() {
  ui.banner(`v${VERSION}`);
  ui.facts([
    ["masar login", "Sign in with your Masar account (opens the website)"],
    ["masar ai", "Choose your AI: Claude, Codex, an API key or a local model"],
    ["masar find", "Talk to the main agent and find leads"],
    ["masar find \"…\"", "Start with what you need, e.g. masar find \"coffee beans to cafes in Amman\""],
    ["masar status", "Your plan, credits and AI"],
    ["masar open", "Open your dashboard"],
    ["masar doctor", "Check that everything works"],
    ["masar logout", "Sign out on this computer"],
  ]);
  ui.print();
  ui.info("Skip the questions: masar find --city \"Riyadh\" --industry clinics --offer \"…\" --count 20 --agents google,website,linkedin -y");
  ui.info(`Industries: ${INDUSTRIES.map((i) => i.key).join(", ")}`);
  ui.info("Options: --out leads.csv  --json  --no-save  --no-browser  --model <name>  --url <local server>");
  ui.print();
}

async function main() {
  const cfg = loadConfig();
  if (flags.version) { ui.print(VERSION); return; }
  const cmd = words[0] ?? (flags.help ? "help" : cfg.token ? "find" : "welcome");
  switch (cmd) {
    case "login": if (await login(cfg)) { if (!cfg.ai) await chooseAi(cfg); ui.info("Next: masar find"); } break;
    case "logout": await logout(cfg); break;
    case "status": case "whoami": await status(cfg); break;
    case "ai": if (words[1] === "test") await testAi(cfg); else await chooseAi(cfg); break;
    case "find": case "search": await find(cfg); break;
    case "open": case "dashboard": openBrowser(`${cfg.site}/dashboard`); ui.info(`${cfg.site}/dashboard`); break;
    case "doctor": await doctor(cfg); break;
    case "help": help(); break;
    case "welcome":
      ui.banner("Find the decision makers your next conversation depends on.");
      ui.say("Welcome to Masar. Two steps and you're ready:");
      ui.step(1, 2, "masar login   sign in with your Masar account");
      ui.step(2, 2, "masar find    tell the main agent who you sell to");
      ui.print();
      if (await ui.confirm("Sign in now?")) { if (await login(cfg)) { if (!cfg.ai) await chooseAi(cfg); await find(cfg); } }
      break;
    default:
      // "masar coffee beans to cafes in Amman" works like masar find "…"
      words.unshift("find");
      await find(cfg);
  }
}

main().catch((e) => {
  ui.print();
  if (e instanceof ApiError && e.status === 401) ui.fail(e.message);
  else ui.fail(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
}).finally(() => ui.closeInput());
