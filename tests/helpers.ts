import type { CollectorContext, CollectorEnv } from "../src/core/collectors/types";
import { parseBrief, type SearchOptions } from "../src/core/schemas";
import type { LlmConnector } from "../src/core/llm";
import { emptyLead } from "../src/lib/lead";
import type { Lead } from "../src/lib/types";

export const brief = parseBrief({ industry: "cafes", locations: ["Amman"], offer: "Specialty coffee beans", count: 10 });
export const options: SearchOptions = { timeoutMs: 2000, openStreetMap: false, websites: false };
export const env: CollectorEnv = { userAgent: "test", graphVersion: "v26.0", linkedinVersion: "202510" };

export function lead(id: string, name: string, extra: Partial<Lead> = {}): Lead {
  return { ...emptyLead(id, name, "Amman"), ...extra };
}

/** A fetch that fails the test if anything reaches the network, and records every URL asked for. */
export function fakeFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: string[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    return handler(url, init);
  }) as typeof fetch;
  return { fetch: fn, calls };
}
export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
export const noNetwork = fakeFetch((url) => { throw new Error(`unexpected network call: ${url}`); });

export function ctx(over: Partial<CollectorContext> = {}): CollectorContext {
  return { brief, options, llm: null, env, fetch: noNetwork.fetch, signal: new AbortController().signal, log: () => {}, ...over };
}

export function fakeLlm(answer: (prompt: string) => unknown, caps: Partial<LlmConnector["capabilities"]> = {}): LlmConnector {
  return {
    id: "fake", label: "Fake AI", model: "test", usage: { inputTokens: 0, outputTokens: 0, webSearches: 0 },
    capabilities: { webSearch: false, structured: true, toolCalling: false, ...caps },
    async ask<T>(prompt: string) { return answer(prompt) as T; },
  };
}
