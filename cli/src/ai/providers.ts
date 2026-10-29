import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Config, ProviderId } from "../config";
import {
  AiError, canPassRawArgs, emptyUsage, httpJson, parseJson, RULES, run, schemaInstruction, scratchDir, which,
  type AI, type AskOptions, type Schema, type Usage,
} from "./base";

const JSON_ONLY = "\n- Answer with JSON only, matching the schema you are given.";

/**
 * Every AI runs on the member's own computer with the member's own account: their Claude subscription
 * through Claude Code, their ChatGPT plan through Codex, their own API keys, or a local model.
 * Masar never sees or stores these credentials, and nothing here shares one person's plan with anyone else.
 */
export const PROVIDERS: Record<ProviderId, { label: string; web: boolean; note: string; defaultModel: string }> = {
  "claude-code": { label: "Claude (your Pro or Max plan, via Claude Code)", web: true, note: "Uses the Claude Code app signed in on this computer.", defaultModel: "" },
  codex: { label: "ChatGPT / Codex (your ChatGPT plan, via Codex CLI)", web: true, note: "Uses the Codex CLI signed in on this computer.", defaultModel: "" },
  anthropic: { label: "Claude API key", web: true, note: "Reads ANTHROPIC_API_KEY on this computer.", defaultModel: "claude-opus-5-5" },
  openai: { label: "OpenAI API key", web: true, note: "Reads OPENAI_API_KEY on this computer.", defaultModel: "gpt-5" },
  ollama: { label: "Ollama (local model, e.g. Llama, Qwen)", web: false, note: "Runs fully on this computer. No web search: agents use maps and websites only.", defaultModel: "" },
  "openai-compatible": { label: "Other local server (LM Studio, llama.cpp, vLLM)", web: false, note: "Any server with an OpenAI-style /v1/chat/completions endpoint.", defaultModel: "" },
};

const LIMITS = { ask: 15 * 60_000 };

// ---------- Claude Code (Claude Pro / Max subscription) ----------

function claudeCode(model: string): AI {
  const bin = which("claude");
  const usage = emptyUsage();
  return {
    id: "claude-code", label: "Claude Code", model: model || "default", usage,
    capabilities: { webSearch: true, structured: true, toolCalling: true },
    async ask<T>(prompt: string, opts: AskOptions): Promise<T> {
      if (!bin) throw new AiError("Claude Code is not installed. Install it from https://claude.com/claude-code, run `claude` once to sign in, then try again.");
      const raw = canPassRawArgs(bin);
      const args = ["-p", "--output-format", "json", "--no-session-persistence",
        "--tools", opts.web ? "WebSearch,WebFetch" : "", ...(opts.web ? ["--allowedTools", "WebSearch,WebFetch"] : [])];
      if (raw) args.push("--json-schema", JSON.stringify(opts.schema));
      if (model) args.push("--model", model);
      const where = opts.city ? `\nThe search area is ${opts.city}; prefer local results.` : "";
      const input = `${RULES}${JSON_ONLY}${where}\n\n${prompt}${raw ? "" : schemaInstruction(opts.schema)}`;
      const s = scratchDir();
      try {
        const r = await run(bin, args, { input, cwd: s.dir, timeoutMs: LIMITS.ask, signal: opts.signal });
        let out: Record<string, unknown>;
        try { out = JSON.parse(r.stdout); } catch { throw new AiError(`Claude Code failed: ${(r.stderr || r.stdout).trim().slice(0, 400) || `exit ${r.code}`}`); }
        const u = (out.usage ?? {}) as Record<string, number & Record<string, number>>;
        usage.inputTokens += (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
        usage.outputTokens += u.output_tokens ?? 0;
        const byModel = Object.values((out.modelUsage ?? {}) as Record<string, { webSearchRequests?: number }>).reduce((n, m) => n + (m.webSearchRequests ?? 0), 0);
        usage.webSearches += Math.max(byModel, (u.server_tool_use as unknown as Record<string, number> | undefined)?.web_search_requests ?? 0);
        if (out.is_error) throw new AiError(`Claude Code: ${String(out.result ?? out.subtype ?? "error").slice(0, 400)}`);
        if (out.structured_output) return out.structured_output as T;
        return parseJson<T>(String(out.result ?? ""));
      } finally { s.cleanup(); }
    },
  };
}

// ---------- Codex CLI (ChatGPT plan) ----------

function codex(model: string): AI {
  const bin = which("codex");
  const usage = emptyUsage();
  return {
    id: "codex", label: "Codex", model: model || "default", usage,
    capabilities: { webSearch: true, structured: true, toolCalling: true },
    async ask<T>(prompt: string, opts: AskOptions): Promise<T> {
      if (!bin) throw new AiError("Codex CLI is not installed. Install it with `npm i -g @openai/codex`, run `codex login`, then try again.");
      const s = scratchDir();
      const schemaFile = path.join(s.dir, "schema.json"), outFile = path.join(s.dir, "answer.json");
      writeFileSync(schemaFile, JSON.stringify(opts.schema));
      const args = [...(opts.web ? ["--search"] : []), "exec", "--skip-git-repo-check", "--ephemeral", "--sandbox", "read-only",
        "--json", "--output-schema", schemaFile, "-o", outFile, "-C", s.dir, ...(model ? ["-m", model] : []), "-"];
      const where = opts.city ? `\nThe search area is ${opts.city}; prefer local results.` : "";
      try {
        const r = await run(bin, args, { input: `${RULES}${JSON_ONLY}${where}\nDo not run shell commands or edit files; only search and read the web.\n\n${prompt}`, cwd: s.dir, timeoutMs: LIMITS.ask, signal: opts.signal });
        let lastError = "";
        for (const line of r.stdout.split("\n")) {
          if (!line.trim().startsWith("{")) continue;
          try {
            const ev = JSON.parse(line);
            const u = ev.usage ?? ev.msg?.usage ?? ev.info?.total_token_usage;
            if (ev.type === "turn.completed" && u) { usage.inputTokens += u.input_tokens ?? 0; usage.outputTokens += u.output_tokens ?? 0; }
            if (ev.item?.type === "web_search" && /completed/.test(ev.type)) usage.webSearches++;
            if (ev.type === "error" || ev.type === "turn.failed") lastError = ev.message ?? ev.error?.message ?? lastError;
          } catch { /* not an event */ }
        }
        let text = "";
        try { text = readFileSync(outFile, "utf8"); } catch { /* no answer */ }
        if (!text.trim()) throw new AiError(`Codex failed: ${(lastError || r.stderr || `exit ${r.code}`).trim().slice(-400)}`);
        return parseJson<T>(text);
      } finally { s.cleanup(); }
    },
  };
}

// ---------- Claude API key ----------

function anthropic(model: string): AI {
  const usage = emptyUsage();
  const m = model || PROVIDERS.anthropic.defaultModel;
  return {
    id: "anthropic", label: "Claude API", model: m, usage,
    capabilities: { webSearch: true, structured: true, toolCalling: true },
    async ask<T>(prompt: string, opts: AskOptions): Promise<T> {
      const key = process.env.ANTHROPIC_API_KEY;
      if (!key) throw new AiError("Set ANTHROPIC_API_KEY on this computer first (your own key from console.anthropic.com).");
      const submit = { name: "submit", description: "Submit your final answer. Call this once, at the end.", input_schema: opts.schema, strict: true };
      const tools: unknown[] = [submit];
      if (opts.web) {
        tools.unshift(
          { type: "web_search_20260209", name: "web_search", max_uses: opts.searches ?? 10, ...(opts.city ? { user_location: { type: "approximate", city: opts.city } } : {}) },
          { type: "web_fetch_20260209", name: "web_fetch", max_uses: Math.ceil((opts.searches ?? 10) / 2) },
        );
      }
      const messages: { role: string; content: unknown }[] = [{ role: "user", content: prompt }];
      for (let turn = 0, nudged = false; turn < 10; turn++) {
        const res = await httpJson("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({ model: m, max_tokens: 16000, system: RULES, tools, messages }), signal: opts.signal,
        });
        const u = (res.usage ?? {}) as Record<string, number & Record<string, number>>;
        usage.inputTokens += (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
        usage.outputTokens += u.output_tokens ?? 0;
        usage.webSearches += (u.server_tool_use as unknown as Record<string, number> | undefined)?.web_search_requests ?? 0;
        const content = (res.content ?? []) as { type: string; name?: string; input?: unknown }[];
        const done = content.find((b) => b.type === "tool_use" && b.name === "submit");
        if (done) return done.input as T;
        if (res.stop_reason === "refusal") throw new AiError("Claude declined this request.");
        messages.push({ role: "assistant", content });
        if (res.stop_reason === "pause_turn") continue;
        if (nudged) break;
        nudged = true;
        messages.push({ role: "user", content: "Call submit now with what you found so far." });
      }
      throw new AiError("Claude did not return an answer.");
    },
  };
}

// ---------- OpenAI API key (Responses API) ----------

function openai(model: string): AI {
  const usage = emptyUsage();
  const m = model || PROVIDERS.openai.defaultModel;
  return {
    id: "openai", label: "OpenAI API", model: m, usage,
    capabilities: { webSearch: true, structured: true, toolCalling: true },
    async ask<T>(prompt: string, opts: AskOptions): Promise<T> {
      const key = process.env.OPENAI_API_KEY;
      if (!key) throw new AiError("Set OPENAI_API_KEY on this computer first (your own key from platform.openai.com).");
      const res = await httpJson(`${(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "")}/responses`, {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: m, instructions: RULES, input: prompt,
          tools: opts.web ? [{ type: "web_search", ...(opts.city ? { user_location: { type: "approximate", city: opts.city } } : {}) }] : [],
          text: { format: { type: "json_schema", name: "answer", schema: opts.schema, strict: true } },
        }),
        signal: opts.signal,
      });
      const u = (res.usage ?? {}) as Record<string, number>;
      usage.inputTokens += u.input_tokens ?? 0;
      usage.outputTokens += u.output_tokens ?? 0;
      let text = "";
      for (const item of (res.output ?? []) as { type: string; content?: { type: string; text?: string }[] }[]) {
        if (item.type === "web_search_call") usage.webSearches++;
        if (item.type === "message") text += (item.content ?? []).filter((c) => c.type === "output_text").map((c) => c.text).join("");
      }
      return parseJson<T>(text);
    },
  };
}

// ---------- Local models ----------

const ollamaHost = (baseUrl?: string) => (baseUrl || process.env.OLLAMA_HOST || "http://127.0.0.1:11434").replace(/\/$/, "").replace(/^(?!https?:)/, "http://");

/**
 * Asks Ollama what the model can do (/api/show lists "tools" for models with tool calling). The Boss
 * runs the agents itself and every answer uses Ollama's structured `format`, so tool calling is only
 * reported, never required.
 */
export async function ollamaToolCalling(model: string, baseUrl?: string, fetchFn: typeof fetch = fetch): Promise<boolean | "unknown"> {
  try {
    const r = await fetchFn(`${ollamaHost(baseUrl)}/api/show`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ model }), signal: AbortSignal.timeout(3000) });
    if (!r.ok) return "unknown";
    const caps = ((await r.json()) as { capabilities?: unknown }).capabilities;
    return Array.isArray(caps) ? caps.includes("tools") : "unknown";
  } catch { return "unknown"; }
}

function ollama(model: string, baseUrl?: string): AI {
  const usage = emptyUsage();
  const host = ollamaHost(baseUrl);
  return {
    id: "ollama", label: "Ollama", model, usage,
    capabilities: { webSearch: false, structured: true, toolCalling: "unknown" },
    async ask<T>(prompt: string, opts: AskOptions): Promise<T> {
      if (!model) throw new AiError("Pick an Ollama model first: masar ai");
      const res = await httpJson(`${host}/api/chat`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, stream: false, format: opts.schema, options: { temperature: 0.2, num_ctx: 16384 },
          messages: [{ role: "system", content: RULES }, { role: "user", content: prompt + schemaInstruction(opts.schema) }] }),
        signal: opts.signal,
      });
      usage.inputTokens += Number(res.prompt_eval_count ?? 0);
      usage.outputTokens += Number(res.eval_count ?? 0);
      return parseJson<T>(String((res.message as { content?: string } | undefined)?.content ?? ""));
    },
  };
}

function openaiCompatible(model: string, baseUrl?: string): AI {
  const usage = emptyUsage();
  const base = (baseUrl || "http://127.0.0.1:1234/v1").replace(/\/$/, "");
  return {
    id: "openai-compatible", label: "Local server", model, usage,
    capabilities: { webSearch: false, structured: false, toolCalling: "unknown" },
    async ask<T>(prompt: string, opts: AskOptions): Promise<T> {
      const body = { model, temperature: 0.2, messages: [{ role: "system", content: RULES }, { role: "user", content: prompt + schemaInstruction(opts.schema) }] };
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (process.env.MASAR_LOCAL_API_KEY) headers.authorization = `Bearer ${process.env.MASAR_LOCAL_API_KEY}`;
      let res: Record<string, unknown>;
      try {
        res = await httpJson(`${base}/chat/completions`, { method: "POST", headers, signal: opts.signal,
          body: JSON.stringify({ ...body, response_format: { type: "json_schema", json_schema: { name: "answer", schema: opts.schema, strict: true } } }) });
      } catch {
        res = await httpJson(`${base}/chat/completions`, { method: "POST", headers, body: JSON.stringify(body), signal: opts.signal });
      }
      const u = (res.usage ?? {}) as Record<string, number>;
      usage.inputTokens += u.prompt_tokens ?? 0;
      usage.outputTokens += u.completion_tokens ?? 0;
      const choice = ((res.choices ?? []) as { message?: { content?: string } }[])[0];
      return parseJson<T>(choice?.message?.content ?? "");
    },
  };
}

/** The member's AI as a core connector. Ollama's tool-calling support is looked up, not assumed. */
export async function connectAI(cfg: Config["ai"]): Promise<AI> {
  const ai = createAI(cfg);
  if (ai.id === "ollama" && ai.model) ai.capabilities.toolCalling = await ollamaToolCalling(ai.model, cfg?.baseUrl);
  return ai;
}

export function createAI(cfg: Config["ai"]): AI {
  if (!cfg) throw new AiError("Choose your AI first: masar ai");
  const model = cfg.model ?? "";
  switch (cfg.provider) {
    case "claude-code": return claudeCode(model);
    case "codex": return codex(model);
    case "anthropic": return anthropic(model);
    case "openai": return openai(model);
    case "ollama": return ollama(model, cfg.baseUrl);
    case "openai-compatible": return openaiCompatible(model, cfg.baseUrl);
  }
}

/** What this computer has: installed AI apps, API keys in the environment and local model servers. */
export async function detect(): Promise<{ id: ProviderId; ready: boolean; detail: string; models?: string[] }[]> {
  const ping = async (url: string) => {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(1500) });
      return r.ok ? ((await r.json()) as Record<string, unknown>) : null;
    } catch { return null; }
  };
  const oHost = ollamaHost();
  const [tags, lm] = await Promise.all([ping(`${oHost}/api/tags`), ping("http://127.0.0.1:1234/v1/models")]);
  const ollamaModels = ((tags?.models ?? []) as { name: string }[]).map((m) => m.name);
  const lmModels = ((lm?.data ?? []) as { id: string }[]).map((m) => m.id);
  const claude = which("claude"), cx = which("codex");
  return [
    { id: "claude-code", ready: !!claude, detail: claude ? `found ${claude}` : "not installed" },
    { id: "codex", ready: !!cx, detail: cx ? `found ${cx}` : "not installed" },
    { id: "anthropic", ready: !!process.env.ANTHROPIC_API_KEY, detail: process.env.ANTHROPIC_API_KEY ? "ANTHROPIC_API_KEY is set" : "no ANTHROPIC_API_KEY" },
    { id: "openai", ready: !!process.env.OPENAI_API_KEY, detail: process.env.OPENAI_API_KEY ? "OPENAI_API_KEY is set" : "no OPENAI_API_KEY" },
    { id: "ollama", ready: ollamaModels.length > 0, detail: tags ? `${ollamaModels.length} models at ${oHost}` : "not running", models: ollamaModels },
    { id: "openai-compatible", ready: lmModels.length > 0, detail: lm ? `${lmModels.length} models at 127.0.0.1:1234` : "not running (LM Studio default port)", models: lmModels },
  ];
}

export type { AI, Schema, Usage };
