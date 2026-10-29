import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fakeFetch } from "./helpers";

/**
 * A stand-in for the Upstash REST API, so no test reaches the network. Commands arrive as JSON arrays,
 * batched on /pipeline (one answer per command) or one at a time.
 */
const store = new Map<string, string>();
const run = ([cmd, key, value]: string[]) => {
  const name = cmd.toLowerCase();
  return { result: name === "get" ? store.get(key) ?? null : name === "set" ? (store.set(key, value), "OK") : name === "ping" ? "PONG" : null };
};
const upstash = (async (url: string | URL | Request, init?: RequestInit) => {
  const body = JSON.parse(String(init?.body)) as string[] | string[][];
  const answer = String(url).endsWith("/pipeline") ? (body as string[][]).map(run) : run(body as string[]);
  return new Response(JSON.stringify(answer), { headers: { "content-type": "application/json" } });
}) as typeof fetch;

let mod: typeof import("../src/lib/redis");
beforeAll(async () => {
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example.upstash.io");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "test-token");
  vi.stubGlobal("fetch", upstash);
  mod = await import("../src/lib/redis");
});
afterAll(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("Upstash Redis", () => {
  it("keeps a public page and serves the second visit from the cache", async () => {
    const site = fakeFetch(() => new Response("<html>Cafe</html>", { headers: { "content-type": "text/html" } }));
    const get = mod.cachedFetch(site.fetch);
    expect(await (await get("https://cafe.example/")).text()).toBe("<html>Cafe</html>");
    await new Promise((r) => setTimeout(r, 20)); // the save runs in the background
    const again = await get("https://cafe.example/");
    expect(await again.text()).toBe("<html>Cafe</html>");
    expect(again.headers.get("x-masar-cache")).toBe("hit");
    expect(again.url).toBe("https://cafe.example/");
    expect(site.calls).toHaveLength(1);
  });

  it("never caches official APIs or failed pages", async () => {
    const api = fakeFetch(() => new Response("{}", { headers: { "content-type": "application/json" } }));
    const get = mod.cachedFetch(api.fetch);
    await get("https://graph.facebook.com/v26.0/pages");
    await get("https://graph.facebook.com/v26.0/pages");
    expect(api.calls).toHaveLength(2);
    const down = fakeFetch(() => new Response("gone", { status: 500, headers: { "content-type": "text/html" } }));
    const get2 = mod.cachedFetch(down.fetch);
    await get2("https://down.example/");
    await new Promise((r) => setTimeout(r, 20));
    await get2("https://down.example/");
    expect(down.calls).toHaveLength(2);
  });

  it("reports a working connection on /api/health", async () => {
    expect(await mod.redisStatus()).toBe("ok (connected)");
  });
});
