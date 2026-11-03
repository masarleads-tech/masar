import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { createHash } from "node:crypto";
import { HttpError } from "./server";

/**
 * Upstash Redis: rate limits for the API routes and a short cache of public web pages. Off until the
 * REST URL and token are set. Names from the Upstash site (UPSTASH_REDIS_REST_*) and from Vercel's
 * Upstash integration (KV_REST_API_*) both work. Both are server-only: the token can read and write the database.
 * If Redis is slow or down, every check lets the request through, so the site never breaks because of it.
 */
const env = (...names: string[]) => names.map((n) => process.env[n]?.trim()).find(Boolean) ?? "";
export const REDIS_URL = env("UPSTASH_REDIS_REST_URL", "KV_REST_API_URL");
const REDIS_TOKEN = env("UPSTASH_REDIS_REST_TOKEN", "KV_REST_API_TOKEN");
export const redisEnabled = /^https:\/\//.test(REDIS_URL) && !!REDIS_TOKEN;

export const redis = redisEnabled ? new Redis({ url: REDIS_URL, token: REDIS_TOKEN, enableTelemetry: false }) : null;

/** Gives up after `ms` and returns `fallback`, so a slow Redis never holds up a search. */
async function quick<T>(work: Promise<T>, fallback: T, ms = 1500): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<T>((done) => { timer = setTimeout(() => done(fallback), ms); })]);
  } catch (e) {
    console.error("[masar] Redis:", e instanceof Error ? e.message : e);
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}

/** How often each action may run, per member (or per IP address before sign-in). */
const LIMITS = {
  discover: [10, "10 m"], // a search sends every collector and Claude, so this is the costly one
  enrich: [120, "10 m"], // checks go in batches of 5, so one 100-lead search is about 20 calls
  cliAuthStart: [10, "10 m"],
  cliAuthPoll: [60, "1 m"], // the CLI asks every 3 seconds
  checkout: [20, "10 m"], // each opens a PayPal order
} as const satisfies Record<string, readonly [number, `${number} ${"s" | "m" | "h"}`]>;
export type LimitName = keyof typeof LIMITS;

const limiters = new Map<LimitName, Ratelimit>();
function limiter(name: LimitName) {
  if (!redis) return null;
  let l = limiters.get(name);
  if (!l) {
    const [count, window] = LIMITS[name];
    l = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(count, window), prefix: `masar:rl:${name}`, timeout: 1500 });
    limiters.set(name, l);
  }
  return l;
}

/** The caller's IP address, for limits before sign-in. */
export const clientIp = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";

/** Throws a 429 when `who` (a member id or an IP) went over the limit for this action. */
export async function rateLimit(name: LimitName, who: string) {
  const l = limiter(name);
  if (!l) return;
  const r = await quick(l.limit(who), null);
  if (!r || r.success) return;
  const minutes = Math.max(1, Math.ceil((r.reset - Date.now()) / 60_000));
  throw new HttpError(429, `Too many requests. Please wait ${minutes} minute${minutes === 1 ? "" : "s"} and try again.`);
}

// Official APIs (Google, Meta, LinkedIn, Claude) are never cached: their terms or tokens don't allow it.
const NO_CACHE = /(^|\.)(googleapis|google|facebook|instagram|linkedin|anthropic)\.com$/i;
const CACHE_SECONDS = 12 * 60 * 60;
const MAX_CACHED = 300_000;

interface CachedPage { status: number; url: string; type: string; body: string }

/**
 * A fetch for the collectors that keeps public pages (business websites, robots.txt, OpenStreetMap
 * place lookups) for 12 hours, so checking the same business again is faster and polite to its site.
 * Only plain GET requests that succeeded are kept; everything else goes straight to the network.
 */
export function cachedFetch(base: typeof fetch = fetch): typeof fetch {
  if (!redis) return base;
  const db = redis;
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    let host = "";
    try { host = new URL(url).hostname; } catch { /* not a URL: let fetch report it */ }
    if (method !== "GET" || !host || NO_CACHE.test(host)) return base(input, init);

    const key = `masar:page:${createHash("sha256").update(url).digest("hex")}`;
    const hit = await quick(db.get<CachedPage>(key), null, 800);
    if (hit) {
      const res = new Response(hit.body, { status: hit.status, headers: { "content-type": hit.type, "x-masar-cache": "hit" } });
      Object.defineProperty(res, "url", { value: hit.url });
      return res;
    }
    const res = await base(input, init);
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !/html|text|json/.test(type)) return res;
    const body = await res.text();
    if (body.length <= MAX_CACHED) {
      // Saved in the background: the search doesn't wait for it.
      void quick(db.set(key, { status: res.status, url: res.url || url, type, body }, { ex: CACHE_SECONDS }), null);
    }
    const copy = new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
    Object.defineProperty(copy, "url", { value: res.url || url });
    return copy;
  }) as typeof fetch;
}

/** For /api/health: can the server reach Redis? */
export async function redisStatus(): Promise<string> {
  if (!REDIS_URL && !REDIS_TOKEN) return "missing (rate limits off)";
  if (/^["']|["']$|\s/.test(REDIS_URL + REDIS_TOKEN)) return "has quotes or spaces";
  if (!/^https:\/\//.test(REDIS_URL)) return "the URL should start with https://";
  if (!REDIS_TOKEN) return "token missing";
  try {
    const timeout = new Promise<never>((_, fail) => setTimeout(() => fail(new Error("timed out")), 3000));
    return (await Promise.race([redis!.ping(), timeout])) === "PONG" ? "ok (connected)" : "cannot connect";
  } catch (e) {
    return `cannot connect: ${e instanceof Error ? e.message : "unknown error"}`;
  }
}
