import type { Usage } from "./schemas";

/**
 * Agent 6, the Connector and LLM service: one interface over every AI Masar can use.
 * The website plugs in its Claude API connector; the CLI plugs in the member's own AI
 * (Claude Code, Codex, an API key, Ollama or another local server). Agents only see this interface.
 */
export type JsonSchema = Record<string, unknown>;

export interface AskOptions {
  /** JSON schema the answer must match. Written strict-mode compatible (see obj()). */
  schema: JsonSchema;
  /** Let the AI use its own web search and page reading. Ignored when the AI can't. */
  web?: boolean;
  /** Rough cap on web searches for this request. */
  searches?: number;
  /** City to bias local search results. */
  city?: string;
  signal?: AbortSignal;
}

export interface LlmCapabilities {
  /** Has a built-in, provider-authorized web search tool. */
  webSearch: boolean;
  /** Can be held to a JSON schema natively (otherwise the schema goes in the prompt and the answer is parsed). */
  structured: boolean;
  /** Supports function/tool calling. The Boss runs agents itself, so this is informational. */
  toolCalling: boolean | "unknown";
}

export interface LlmConnector {
  id: string;
  label: string;
  model: string;
  capabilities: LlmCapabilities;
  usage: Usage;
  ask<T>(prompt: string, opts: AskOptions): Promise<T>;
}

export class LlmError extends Error {}

/** The research rules every agent gives the AI, whatever AI it is. */
export const RULES = `You are a research agent inside Masar, a lead generation tool for businesses in the Middle East and Europe.
Rules you always follow:
- Use only public web pages and public search results. Never log in anywhere, never use or create accounts, never try to get past a captcha, paywall or login wall, and never use private APIs.
- Do not open or fetch pages on instagram.com, facebook.com or linkedin.com: they need a login. You may use what a search engine's result list shows about them (title, link, snippet).
- Every value you report must come from a page or search result you actually saw. If you did not find it, use null. Never guess a phone number, email, follower count, date or name.
- For people, report only their public business role: name, job title and a public profile link. No personal mobile numbers or personal emails unless the person published them for business on the company's own pages.
- Phone numbers in international format when the country is clear (Saudi Arabia +966, UAE +971, Jordan +962, Qatar +974, Kuwait +965, Bahrain +973, Oman +968, Egypt +20).
- Keep the source URL of every page or search result you relied on.`;

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
  throw new LlmError("The AI did not answer with valid JSON.");
}

/** Prompt text that asks for JSON matching a schema, for AIs that can't enforce one. */
export const schemaInstruction = (schema: JsonSchema) =>
  `\n\nReply with one JSON object only (no prose, no code fences) that matches this JSON schema:\n${JSON.stringify(schema)}`;

// ---------- Strict JSON schema helpers (every property required, no extras) ----------

export const str: JsonSchema = { type: "string" };
export const nstr: JsonSchema = { type: ["string", "null"] };
export const nint: JsonSchema = { type: ["integer", "null"] };
export const nbool: JsonSchema = { type: ["boolean", "null"] };
export const int: JsonSchema = { type: "integer" };
export const bool: JsonSchema = { type: "boolean" };
export const arr = (items: JsonSchema): JsonSchema => ({ type: "array", items });
export const nenum = (values: string[]): JsonSchema => ({ type: ["string", "null"], enum: [...values, null] });
export const enm = (values: string[]): JsonSchema => ({ type: "string", enum: values });
export function obj(properties: Record<string, JsonSchema>): JsonSchema {
  return { type: "object", additionalProperties: false, required: Object.keys(properties), properties };
}
