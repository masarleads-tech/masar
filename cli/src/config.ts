import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export type ProviderId = "claude-code" | "codex" | "anthropic" | "openai" | "ollama" | "openai-compatible";

export interface Config {
  /** The Masar website the CLI signs in to. */
  site: string;
  /** This computer's sign-in token (never the member's password, never their AI keys). */
  token?: string;
  email?: string;
  ai?: {
    provider: ProviderId;
    model?: string;
    /** Ollama host or the base URL of an OpenAI-compatible server (LM Studio, llama.cpp, vLLM). */
    baseUrl?: string;
  };
}

export const DEFAULT_SITE = "https://masar-umber-two.vercel.app";

/** ~/.config/masar on macOS and Linux, %APPDATA%\masar on Windows. */
export function configDir() {
  if (process.env.MASAR_CONFIG_DIR) return process.env.MASAR_CONFIG_DIR;
  if (process.platform === "win32" && process.env.APPDATA) return path.join(process.env.APPDATA, "masar");
  return path.join(process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config"), "masar");
}
const file = () => path.join(configDir(), "config.json");

export function loadConfig(): Config {
  let cfg: Config = { site: DEFAULT_SITE };
  try {
    if (existsSync(file())) cfg = { ...cfg, ...JSON.parse(readFileSync(file(), "utf8")) };
  } catch { /* A broken file is replaced on the next save. */ }
  if (process.env.MASAR_URL) cfg.site = process.env.MASAR_URL;
  if (process.env.MASAR_TOKEN) cfg.token = process.env.MASAR_TOKEN;
  cfg.site = cfg.site.replace(/\/+$/, "");
  return cfg;
}

export function saveConfig(cfg: Config) {
  mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  const { site, ...rest } = cfg;
  const toSave = process.env.MASAR_URL ? rest : { site, ...rest };
  writeFileSync(file(), JSON.stringify(toSave, null, 2), { mode: 0o600 });
  try { chmodSync(file(), 0o600); } catch { /* Windows */ }
}

export const configPath = file;
