import { describe, expect, it } from "vitest";
import { facebook } from "../src/core/collectors/facebook";
import { googleWeb } from "../src/core/collectors/google-web";
import { instagram, usernameFrom } from "../src/core/collectors/instagram";
import { linkedin, vanityFrom } from "../src/core/collectors/linkedin";
import { ctx, env, fakeFetch, json, lead } from "./helpers";

const OFFICIAL = /^https:\/\/(graph\.facebook\.com|api\.linkedin\.com)\//;

describe("provider boundaries", () => {
  it("leaves every social collector disabled or unsupported without credentials", () => {
    const c = ctx();
    for (const col of [instagram, facebook, linkedin]) for (const phase of ["discover", "enrich"] as const) {
      const a = col.availability(c, phase);
      expect(a.ok, `${col.id} ${phase}`).toBe(false);
    }
  });

  it("never offers keyword search where the platform has none", () => {
    const c = ctx({ env: { ...env, instagramToken: "t", instagramUserId: "1", linkedinToken: "t" } });
    expect(instagram.availability(c, "discover")).toMatchObject({ ok: false, status: "unsupported" });
    expect(linkedin.availability(c, "discover")).toMatchObject({ ok: false, status: "unsupported" });
    expect(instagram.discover).toBeUndefined();
    expect(linkedin.discover).toBeUndefined();
  });

  it("Instagram checks a known handle through Business Discovery only", async () => {
    const recent = new Date(Date.now() - 5 * 864e5).toISOString();
    const f = fakeFetch(() => json({ business_discovery: { username: "rumi", name: "Rumi Coffee", followers_count: 12000, media: { data: [{ timestamp: recent }] } } }));
    const c = ctx({ env: { ...env, instagramToken: "SECRET", instagramUserId: "17841" }, fetch: f.fetch });
    const r = await instagram.enrich!(c, [lead("a", "Rumi Coffee", { instagram: "https://www.instagram.com/rumi/" }), lead("b", "No Handle")]);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]).toMatch(/^https:\/\/graph\.facebook\.com\/v26\.0\/17841\?/);
    expect(decodeURIComponent(f.calls[0])).toContain("business_discovery.username(rumi)");
    expect(r.items[0]).toMatchObject({ id: "a", fields: { instagramFollowers: 12000, instagramVerdict: "pass", activeLast30Days: true } });
  });

  it("Instagram reports unsupported on a permission error and never leaks the token", async () => {
    const f = fakeFetch(() => json({ error: { code: 10, message: "Application does not have permission (access_token=SECRET)" } }, 403));
    const c = ctx({ env: { ...env, instagramToken: "SECRET", instagramUserId: "1" }, fetch: f.fetch });
    const r = await instagram.enrich!(c, [lead("a", "A", { instagram: "@abc" })]);
    expect(r.status).toBe("unsupported");
    expect(r.message).not.toContain("SECRET");
  });

  it("Facebook search needs Page Public Metadata Access and says so", async () => {
    const f = fakeFetch(() => json({ error: { code: 10, message: "Requires Page Public Metadata Access" } }, 400));
    const c = ctx({ env: { ...env, facebookAppToken: "app|tok" }, fetch: f.fetch });
    const r = await facebook.discover!(c);
    expect(r.status).toBe("unsupported");
    expect(f.calls.every((u) => u.startsWith("https://graph.facebook.com/v26.0/pages/search?"))).toBe(true);
  });

  it("Facebook keeps the pages it got before a rate limit", async () => {
    let n = 0;
    const f = fakeFetch(() => (n++ === 0 ? json({ data: [{ id: "1", name: "Cafe One", location: { city: "Amman" } }] }) : json({ error: { code: 4, message: "Application request limit reached" } }, 400)));
    const r = await facebook.discover!(ctx({ env: { ...env, facebookAppToken: "app|tok" }, fetch: f.fetch }));
    expect(r.status).toBe("partial");
    expect(r.items.map((l) => l.name)).toEqual(["Cafe One"]);
  });

  it("LinkedIn looks up a company by vanity name and treats 403 as unsupported", async () => {
    const ok = fakeFetch(() => json({ elements: [{ localizedName: "Acme", localizedWebsite: "https://acme.jo" }] }));
    const c = ctx({ env: { ...env, linkedinToken: "T" }, fetch: ok.fetch });
    const r = await linkedin.enrich!(c, [lead("a", "Acme", { linkedin: "https://www.linkedin.com/company/acme-jo/", website: "https://acme.jo" })]);
    expect(ok.calls[0]).toBe("https://api.linkedin.com/rest/organizations?q=vanityName&vanityName=acme-jo");
    expect(r.items[0].provenance[0].field).toBe("linkedin_verified");
    const denied = fakeFetch(() => new Response("", { status: 403 }));
    const r2 = await linkedin.enrich!(ctx({ env: { ...env, linkedinToken: "T" }, fetch: denied.fetch }), [lead("a", "Acme", { linkedin: "https://www.linkedin.com/company/acme-jo/" })]);
    expect(r2.status).toBe("unsupported");
  });

  it("social collectors only ever call official API hosts", async () => {
    const f = fakeFetch(() => json({ data: [], elements: [] }));
    const c = ctx({ env: { ...env, instagramToken: "t", instagramUserId: "1", facebookAppToken: "t", linkedinToken: "t" }, fetch: f.fetch });
    const leads = [lead("a", "A", { instagram: "https://instagram.com/a", linkedin: "https://linkedin.com/company/a", facebook: "https://facebook.com/a" })];
    await instagram.enrich!(c, leads); await facebook.enrich!(c, leads); await facebook.discover!(c); await linkedin.enrich!(c, leads);
    expect(f.calls.length).toBeGreaterThan(0);
    for (const u of f.calls) expect(u).toMatch(OFFICIAL);
  });

  it("Google & web is disabled with no key, no web AI, no maps and no websites", () => {
    expect(googleWeb.availability(ctx({ options: { timeoutMs: 1000, openStreetMap: false, websites: false } }), "discover")).toMatchObject({ ok: false, status: "disabled" });
  });

  it("parses handles and vanity names", () => {
    expect(usernameFrom("https://instagram.com/rumi.coffee?hl=en")).toBe("rumi.coffee");
    expect(usernameFrom("https://instagram.com/p/abc")).toBeNull();
    expect(usernameFrom("@rumi")).toBe("rumi");
    expect(vanityFrom("https://jo.linkedin.com/company/acme-jo/about")).toBe("acme-jo");
    expect(vanityFrom("https://linkedin.com/in/someone")).toBeNull();
  });
});
