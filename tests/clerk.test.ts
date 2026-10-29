import { afterEach, describe, expect, it, vi } from "vitest";
import { clerkHost, clerkStatus } from "../src/lib/clerk";

const pk = (kind: "test" | "live", host: string) => `pk_${kind}_${Buffer.from(`${host}$`).toString("base64")}`;
const environment = (google: boolean) => async () =>
  new Response(JSON.stringify({ user_settings: { social: { oauth_google: { enabled: google } } } }), { headers: { "content-type": "application/json" } });

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("Clerk settings check", () => {
  it("reads the login server from a publishable key", () => {
    expect(clerkHost(pk("test", "happy-cat-12.clerk.accounts.dev"))).toEqual({ instance: "development", host: "happy-cat-12.clerk.accounts.dev" });
    expect(clerkHost(pk("live", "clerk.masar.sa"))).toEqual({ instance: "production", host: "clerk.masar.sa" });
    expect(clerkHost("pk_live_not-a-key")).toBeNull();
  });

  it("flags a production key used on the .vercel.app address and reports Google login", async () => {
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", pk("live", "clerk.masar.sa"));
    vi.stubEnv("CLERK_SECRET_KEY", "sk_live_x");
    vi.stubGlobal("fetch", environment(false));
    const out = await clerkStatus("masar-umber-two.vercel.app");
    expect(out.domain).toContain("only works on masar.sa");
    expect(out.google).toMatch(/^off/);
    expect(out.keys).toBeUndefined();
    expect((await clerkStatus("www.masar.sa")).domain).toBeUndefined();
  });

  it("flags keys from different instances", async () => {
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", pk("test", "happy-cat-12.clerk.accounts.dev"));
    vi.stubEnv("CLERK_SECRET_KEY", "sk_live_x");
    vi.stubGlobal("fetch", environment(true));
    const out = await clerkStatus("masar-umber-two.vercel.app");
    expect(out.keys).toContain("different instances");
    expect(out.google).toBe("on");
    expect(out.status).toBe("ok");
  });
});
