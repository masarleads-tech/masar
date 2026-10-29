import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ProviderId } from "../config";

/** A JSON schema written to also pass OpenAI's strict mode: every object lists all its properties as required. */
export type Schema = Record<string, unknown>;

export interface Usage { inputTokens: number; outputTokens: number; webSearches: number }

export interface AskOptions {
  schema: Schema;
  /** Let the AI search the web and read public pages (only when the provider can). */
  web?: boolean;
  /** A rough cap on web searches for this request. */
  searches?: number;
  /** City for local search results. */
  city?: string;
}

export interface AI {
  id: ProviderId;
  label: string;
  model: string;
  /** Can this AI search the web and read pages by itself? */
  web: boolean;
  usage: Usage;
  ask<T>(prompt: string, opts: AskOptions): Promise<T>;
}

/** The research rules every agent follows, whatever AI runs it. */
export const RULES = `You are a research agent inside Masar, a lead generation tool for businesses in the Middle East and Europe.
Rules you always follow:
- Use only public pages and public search results. Never log in anywhere, never use or create accounts, never try to get past a captcha, paywall or login wall, and never use private APIs.
- Every value you report must come from a page or search result you actually saw. If you did not find it, use null. Never guess a phone number, email, follower count, date or name.
- For people, report only their public business role: name, job title and a public profile link. No personal mobile numbers or personal emails unless the person published them for business on the company's own pages.
- Phone numbers in international format when the country is clear (Saudi Arabia +966, UAE +971, Jordan +962, Qatar +974, Kuwait +965, Bahrain +973, Oman +968, Egypt +20).
- Keep the source URL of every page you relied on.
- Answer with JSON only, matching the schema you are given.`;

export const emptyUsage = (): Usage => ({ inputTokens: 0, outputTokens: 0, webSearches: 0 });

export class AiError extends Error {}

/** Pulls the first JSON object out of a reply that may have text or code fences around it. */
export function parseJson<T>(text: string): T {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try { return JSON.parse(t) as T; } catch { /* look for an object inside */ }
  const start = t.indexOf("{");
  if (start >= 0) {
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < t.length; i++) {
      const ch = t[i];
      if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) {
        try { return JSON.parse(t.slice(start, i + 1)) as T; } catch { break; }
      }
    }
  }
  throw new AiError("The AI did not answer with valid JSON.");
}

/** Prompt text that asks for JSON matching a schema, for AIs that can't enforce one. */
export const schemaInstruction = (schema: Schema) =>
  `\n\nReply with one JSON object only (no prose, no code fences) that matches this JSON schema:\n${JSON.stringify(schema)}`;

/** Finds a program on PATH (with Windows extensions), or null. */
export function which(cmd: string): string | null {
  const exts = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").map((e) => e.toLowerCase()) : [""];
  const extra = process.platform === "win32" ? [] : [path.join(process.env.HOME ?? "", ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin"];
  for (const dir of [...(process.env.PATH ?? "").split(path.delimiter), ...extra]) {
    if (!dir) continue;
    for (const ext of exts) {
      const p = path.join(dir, cmd + ext);
      try { if (existsSync(p) && statSync(p).isFile()) return p; } catch { /* skip */ }
    }
  }
  return null;
}

/** Windows .cmd shims must run through the shell; quote anything with spaces. */
const needsShell = (file: string) => process.platform === "win32" && /\.(cmd|bat)$/i.test(file);
const winQuote = (a: string) => (a === "" || /[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a);
export const canPassRawArgs = (file: string) => !needsShell(file);

export function run(file: string, args: string[], opts: { input?: string; cwd?: string; timeoutMs?: number } = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const shell = needsShell(file);
    const child = spawn(shell ? winQuote(file) : file, shell ? args.map(winQuote) : args, {
      cwd: opts.cwd, shell, windowsHide: true, env: { ...process.env, NO_COLOR: "1" },
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    const timer = opts.timeoutMs ? setTimeout(() => { child.kill(); reject(new AiError(`${path.basename(file)} took too long and was stopped.`)); }, opts.timeoutMs) : null;
    child.on("error", (e) => { if (timer) clearTimeout(timer); reject(new AiError(`Could not start ${path.basename(file)}: ${e.message}`)); });
    child.on("close", (code) => { if (timer) clearTimeout(timer); resolve({ code: code ?? 1, stdout, stderr }); });
    if (opts.input !== undefined) child.stdin.end(opts.input);
    else child.stdin.end();
  });
}

/** An empty folder for an agent run, so no project files or instructions leak into it. */
export function scratchDir() {
  const dir = mkdtempSync(path.join(tmpdir(), "masar-"));
  return { dir, cleanup: () => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } } };
}

export async function httpJson(url: string, init: RequestInit & { timeoutMs?: number }): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(init.timeoutMs ?? 600_000) });
  } catch (e) {
    throw new AiError(`Could not reach ${new URL(url).host}: ${e instanceof Error ? e.message : e}`);
  }
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try { data = JSON.parse(text); } catch { /* not JSON */ }
  if (!res.ok) {
    const err = data.error as { message?: string } | string | undefined;
    const msg = typeof err === "string" ? err : err?.message || text.slice(0, 300) || res.statusText;
    throw new AiError(`${new URL(url).host} said ${res.status}: ${msg}`);
  }
  return data;
}
