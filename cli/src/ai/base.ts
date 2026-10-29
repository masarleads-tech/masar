import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// The AI interface, the research rules and the JSON helpers live in the shared core, so the CLI and
// the website hold every AI to the same rules.
export {
  emptyUsage, LlmError as AiError, parseJson, RULES, schemaInstruction,
  type AskOptions, type JsonSchema as Schema, type LlmConnector as AI, type Usage,
} from "../../../src/core";
import { LlmError as AiError } from "../../../src/core";

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

export function run(file: string, args: string[], opts: { input?: string; cwd?: string; timeoutMs?: number; signal?: AbortSignal } = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const shell = needsShell(file);
    const child = spawn(shell ? winQuote(file) : file, shell ? args.map(winQuote) : args, {
      cwd: opts.cwd, shell, windowsHide: true, env: { ...process.env, NO_COLOR: "1" },
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    const timer = opts.timeoutMs ? setTimeout(() => { child.kill(); reject(new AiError(`${path.basename(file)} took too long and was stopped.`)); }, opts.timeoutMs) : null;
    const onAbort = () => { child.kill(); reject(new AiError(`${path.basename(file)} was stopped.`)); };
    if (opts.signal?.aborted) onAbort(); else opts.signal?.addEventListener("abort", onAbort, { once: true });
    child.on("error", (e) => { if (timer) clearTimeout(timer); reject(new AiError(`Could not start ${path.basename(file)}: ${e.message}`)); });
    child.on("close", (code) => { if (timer) clearTimeout(timer); opts.signal?.removeEventListener("abort", onAbort); resolve({ code: code ?? 1, stdout, stderr }); });
    if (opts.input !== undefined) child.stdin.end(opts.input);
    else child.stdin.end();
  });
}

/** An empty folder for an agent run, so no project files or instructions leak into it. */
export function scratchDir() {
  const dir = mkdtempSync(path.join(tmpdir(), "masar-"));
  return { dir, cleanup: () => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } } };
}

export async function httpJson(url: string, init: RequestInit & { timeoutMs?: number; signal?: AbortSignal }): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(init.timeoutMs ?? 600_000)]) : AbortSignal.timeout(init.timeoutMs ?? 600_000) });
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
