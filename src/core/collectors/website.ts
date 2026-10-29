import type { Lead } from "../../lib/types";
import { prov } from "./types";

/**
 * Website agent: visits each business's own public website (home page and a contact page), the way a
 * person would, and reads the contact details and social links the business published there.
 * It follows robots.txt and reads at most two pages per site.
 */
export interface WebsiteDeps { fetch: typeof fetch; userAgent: string; signal?: AbortSignal }

export interface SiteFacts { reachable: boolean; title: string; description: string; text: string }

async function get(d: WebsiteDeps, url: string, ms = 12_000): Promise<{ url: string; html: string } | null> {
  try {
    const signal = d.signal ? AbortSignal.any([d.signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms);
    const r = await d.fetch(url, { headers: { "user-agent": d.userAgent, accept: "text/html,*/*;q=0.5" }, redirect: "follow", signal });
    if (!r.ok || !/html|text/.test(r.headers.get("content-type") ?? "text/html")) return null;
    const html = (await r.text()).slice(0, 800_000);
    return { url: r.url || url, html };
  } catch { return null; }
}

async function allowed(d: WebsiteDeps, base: URL, path: string) {
  const r = await get(d, `${base.origin}/robots.txt`, 6000);
  if (!r) return true;
  let applies = false;
  for (const raw of r.html.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const [k, ...rest] = line.split(":");
    const v = rest.join(":").trim();
    if (/^user-agent$/i.test(k)) applies = v === "*" || /masar/i.test(v);
    else if (applies && /^disallow$/i.test(k) && v && path.startsWith(v)) return false;
  }
  return true;
}

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&#64;|&#x40;/g, "@").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const textOf = (html: string) => decode(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

function extract(html: string) {
  const h = decode(html);
  const hrefs = [...h.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
  const emails = new Set<string>();
  for (const m of h.matchAll(/mailto:([^"'?\s>]+)/gi)) emails.add(m[1].toLowerCase());
  for (const m of textOf(h).matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) emails.add(m[0].toLowerCase());
  const email = [...emails].find((e) => !/\.(png|jpe?g|gif|webp|svg)$/.test(e) && !/example\.|sentry|wixpress|@2x/.test(e)) ?? null;
  const tel = hrefs.find((x) => /^tel:/i.test(x))?.replace(/^tel:/i, "").replace(/[^\d+]/g, "") || null;
  const wa = hrefs.find((x) => /wa\.me\/|api\.whatsapp\.com\/send|whatsapp:\/\//i.test(x));
  const whatsapp = wa ? (wa.match(/(?:wa\.me\/|phone=)(\+?\d{8,15})/)?.[1] ?? null) : null;
  const pick = (re: RegExp, bad: RegExp) => hrefs.find((x) => re.test(x) && !bad.test(x))?.split("?")[0] ?? null;
  return {
    email, tel, whatsapp: whatsapp ? `+${whatsapp.replace(/^\+/, "")}` : null,
    instagram: pick(/instagram\.com\/[A-Za-z0-9_.]+/i, /instagram\.com\/(p|reel|explore|accounts|stories)\//i),
    facebook: pick(/facebook\.com\/[^/]+/i, /facebook\.com\/(sharer|share|dialog|tr|plugins)/i),
    linkedin: pick(/linkedin\.com\/(company|school|in)\//i, /shareArticle/i),
    title: textOf(h.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").slice(0, 200),
    description: (h.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i)?.[1] ?? "").slice(0, 400),
    contactHref: hrefs.find((x) => /contact|اتصل|تواصل/i.test(x)),
  };
}

export async function visitWebsite(d: WebsiteDeps, lead: Lead): Promise<{ lead: Lead; facts: SiteFacts }> {
  const none = { lead, facts: { reachable: false, title: "", description: "", text: "" } };
  if (!lead.website) return none;
  let base: URL;
  try { base = new URL(/^https?:/i.test(lead.website) ? lead.website : `https://${lead.website}`); } catch { return none; }
  if (/instagram|facebook|linkedin|tiktok|twitter|x\.com|linktr\.ee|wa\.me/i.test(base.host)) return none;
  if (!(await allowed(d, base, base.pathname || "/"))) return none;
  const home = await get(d, base.href);
  if (!home) return none;
  const a = extract(home.html);
  let text = textOf(home.html).slice(0, 3000);
  let more: ReturnType<typeof extract> | null = null;
  if (a.contactHref && (!a.email || !a.tel)) {
    try {
      const u = new URL(a.contactHref, home.url);
      if (u.host === new URL(home.url).host && (await allowed(d, u, u.pathname))) {
        const page = await get(d, u.href);
        if (page) { more = extract(page.html); text += " " + textOf(page.html).slice(0, 1500); }
      }
    } catch { /* bad link */ }
  }
  const l: Lead = { ...lead, sources: [...new Set([...lead.sources, home.url])], provenance: [...(lead.provenance ?? [])] };
  l.website = home.url;
  const fill = (k: "email" | "phone" | "whatsapp" | "instagram" | "facebook" | "linkedin", v: string | null | undefined) => {
    if (!l[k] && v) { l[k] = v; l.provenance!.push(prov("website", k, home.url)); }
  };
  fill("email", a.email ?? more?.email);
  fill("phone", a.tel ?? more?.tel);
  fill("whatsapp", a.whatsapp ?? more?.whatsapp);
  fill("instagram", a.instagram ?? more?.instagram);
  fill("facebook", a.facebook ?? more?.facebook);
  fill("linkedin", a.linkedin ?? more?.linkedin);
  l.provenance!.push(prov("website", "website", home.url));
  return { lead: l, facts: { reachable: true, title: a.title, description: a.description, text } };
}

/** Runs the website agent over many leads, a few at a time. */
export async function visitAll(d: WebsiteDeps, leads: Lead[], onProgress: (done: number) => void = () => {}, concurrency = 6) {
  const out: Lead[] = [...leads];
  const facts = new Map<string, SiteFacts>();
  let next = 0, done = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < leads.length) {
      const i = next++;
      if (d.signal?.aborted) break;
      const r = await visitWebsite(d, leads[i]);
      out[i] = r.lead;
      facts.set(r.lead.id, r.facts);
      onProgress(++done);
    }
  }));
  return { leads: out, facts };
}
