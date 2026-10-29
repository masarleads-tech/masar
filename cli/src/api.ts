import { hostname, platform, release } from "node:os";
import type { Brief, Lead } from "../../src/lib/types";
import type { Config } from "./config";
import { VERSION } from "./version";

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export interface Me {
  email: string | null;
  username: string | null;
  plan: "free" | "weekly" | "basic" | "premium";
  planUntil: string | null;
  credits: number;
  cliLeadsFree: boolean;
  setup: { industries?: string[]; ideal_customer?: string; cities?: string[]; leads_per_week?: number; currency?: string; deal_size?: number } | null;
  dashboardUrl: string;
}

export interface SaveResult {
  searchId: string | null; saved: number; skipped: number; charged: number; free: boolean;
  creditsLeft: number; plan: Me["plan"]; dashboardUrl: string;
}

export const deviceName = () => `${hostname()} (${{ darwin: "macOS", win32: "Windows", linux: "Linux" }[platform() as string] ?? platform()} ${release().split(".")[0]})`;

async function call<T>(cfg: Config, method: string, path: string, body?: unknown, auth = true): Promise<T> {
  const headers: Record<string, string> = { "user-agent": `masar-cli/${VERSION}`, accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (auth) {
    if (!cfg.token) throw new ApiError(401, "Not signed in. Run: masar login");
    headers["x-masar-token"] = cfg.token;
  }
  let res: Response;
  try {
    res = await fetch(cfg.site + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
  } catch (e) {
    throw new ApiError(0, `Could not reach ${cfg.site} (${e instanceof Error ? e.message : e}). Check your internet connection.`);
  }
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try { data = text ? JSON.parse(text) : {}; } catch { /* not JSON */ }
  if (!res.ok && !(path.endsWith("/poll") && "status" in data)) {
    throw new ApiError(res.status, (data.error as string) || `${res.status} ${res.statusText}`);
  }
  return data as T;
}

export const api = {
  start: (cfg: Config) => call<{ device_code: string; user_code: string; verification_uri: string; verification_uri_complete: string; interval: number; expires_in: number }>(
    cfg, "POST", "/api/cli/auth/start", { client: deviceName() }, false),
  poll: (cfg: Config, deviceCode: string) => call<{ status: string; token?: string; email?: string | null }>(
    cfg, "POST", "/api/cli/auth/poll", { device_code: deviceCode }, false),
  me: (cfg: Config) => call<Me>(cfg, "GET", "/api/cli/me"),
  setAi: (cfg: Config, provider: string, model: string) => call(cfg, "PATCH", "/api/cli/me", { provider, model, device: deviceName() }),
  logout: (cfg: Config) => call(cfg, "DELETE", "/api/cli/me"),
  save: (cfg: Config, body: { brief: Brief; leads: Lead[]; found: number; agents: string[]; ai: { provider: string; model: string };
    usage: { inputTokens: number; outputTokens: number; webSearches: number }; durationMs: number }) =>
    call<SaveResult>(cfg, "POST", "/api/cli/leads", body),
};
