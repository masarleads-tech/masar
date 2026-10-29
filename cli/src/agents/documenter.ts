import { passesMustHave, rescore } from "../../../src/lib/lead";
import type { Brief, Lead } from "../../../src/lib/types";
import type { AI } from "../ai/base";
import * as ui from "../ui";
import type { SiteFacts } from "./website";
import { arr, int, obj, str } from "./schema";

/**
 * Documenter agent: collects what the finder agents brought back, checks how much of each lead is
 * verified, asks the AI how well each lead fits the member's need, ranks them, and presents the list.
 * Rank = 40% fit score + 30% compatibility + 30% verified information.
 */

/** How much of the lead was confirmed by a real source, 0-100. Shown with the reasons. */
export function verification(l: Lead, site?: SiteFacts): { score: number; reasons: string[] } {
  let s = 0;
  const why: string[] = [];
  const add = (n: number, r: string) => { s += n; why.push(r); };
  if (l.sources.some((u) => u.includes("openstreetmap.org"))) add(10, "on the map");
  if (site?.reachable) add(20, "website works");
  if (l.phone || l.whatsapp) add(15, "phone");
  if (l.email) add(10, "email");
  if (l.instagramVerdict === "pass") add(15, "Instagram checked"); else if (l.instagramVerdict === "warn") add(5, "Instagram unclear");
  if (l.facebookVerdict === "pass") add(10, "Facebook checked"); else if (l.facebookVerdict === "warn") add(3, "Facebook unclear");
  if (l.linkedin) add(10, "LinkedIn page");
  if (l.decisionMakers.length) add(10, "decision maker named");
  return { score: Math.min(100, s), reasons: why };
}

const COMPAT = obj({ results: arr(obj({ id: str, compatibility: int, reason: str })) });

async function judge(ai: AI, brief: Brief, leads: Lead[], facts: Map<string, SiteFacts>) {
  const rows = leads.map((l) => ({
    id: l.id, name: l.name, category: l.category, city: l.city, chain: l.isChain,
    about: [facts.get(l.id)?.title, facts.get(l.id)?.description].filter(Boolean).join(" — ").slice(0, 300) || null,
    instagram_followers: l.instagramFollowers, decision_makers: l.decisionMakers.map((d) => d.title),
  }));
  const prompt = `You are Masar's documenter. Rate how compatible each business is with what my client needs, from 0 (wrong fit) to 100 (ideal buyer).
My client sells: ${brief.offer || "(not given)"}
They want: ${brief.industryCustom || brief.industry.replace(/_/g, " ")} in ${brief.locations.join(", ")}; size: ${brief.size}; positioning: ${brief.positioning}.
${brief.goodSignals.length ? `Good signs: ${brief.goodSignals.join(", ")}.` : ""}${brief.exclude.length ? ` Avoid: ${brief.exclude.join(", ")}.` : ""}
Judge only from the facts given. "reason": under 15 words, in the language of the client's offer.
Businesses (JSON):
${JSON.stringify(rows, null, 1)}`;
  const out = await ai.ask<{ results: { id: string; compatibility: number; reason: string }[] }>(prompt, { schema: COMPAT });
  return new Map((out.results ?? []).map((r) => [r.id, r]));
}

export async function document(ai: AI, brief: Brief, leads: Lead[], facts: Map<string, SiteFacts>, opts: { useAi: boolean }) {
  let ranked = leads.map((l) => rescore(l, brief));
  const compat = new Map<string, { compatibility: number; reason: string }>();
  if (opts.useAi && ranked.length) {
    const sp = ui.spinner("Documenter is checking how well each lead fits");
    try {
      for (let i = 0; i < ranked.length; i += 15) {
        sp.update(`Documenter is checking fit (${Math.min(i + 15, ranked.length)}/${ranked.length})`);
        for (const [id, r] of await judge(ai, brief, ranked.slice(i, i + 15), facts)) compat.set(id, r);
      }
      sp.done("Documenter checked how well each lead fits");
    } catch (e) {
      sp.warn(`Documenter used the fit score only (${e instanceof Error ? e.message : e})`);
    }
  }
  ranked = ranked.map((l) => {
    const v = verification(l, facts.get(l.id));
    const c = compat.get(l.id);
    const compatibility = Math.max(0, Math.min(100, Math.round(c?.compatibility ?? l.fit)));
    const legitimacy = l.legitimacy ?? (l.instagramVerdict === "fail" || l.facebookVerdict === "fail" ? "fail" : v.score >= 45 ? "pass" : "warn");
    const out: Lead = {
      ...l, verified: v.score, compatibility, compatibilityReason: c?.reason ?? "",
      legitimacy, legitimacyReason: l.legitimacyReason || `Verified: ${v.reasons.join(", ") || "nothing yet"}`,
    };
    const rank = 0.4 * out.fit + 0.3 * compatibility + 0.3 * v.score - (passesMustHave(out, brief.mustHave) ? 0 : 25) - (legitimacy === "fail" ? 30 : 0);
    return rescore({ ...out, rank: Math.max(0, Math.round(rank)) }, brief);
  });
  ranked.sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0));
  return ranked;
}

const contactOf = (l: Lead) => l.phone || l.whatsapp || l.email || (l.instagram ? "Instagram" : l.linkedin ? "LinkedIn" : "—");

/** The documenter's report in the terminal: a ranked table, then the top leads in detail. */
export function present(leads: Lead[], show = 15) {
  ui.heading(`Your leads, ranked`);
  ui.info("Rank = 40% fit + 30% compatibility with your need + 30% verified information.");
  ui.print();
  ui.table(["#", "Business", "City", "Rank", "Fit", "Verified", "Close", "Contact"],
    leads.slice(0, show).map((l, i) => [
      ui.c.muted(String(i + 1)), (i < 3 ? ui.c.strong(l.name) : l.name) + (l.isChain ? ui.c.muted(" · chain") : ""), ui.c.muted(l.city),
      ui.meter(l.rank ?? 0, 6), String(l.fit), String(l.verified ?? 0), `${l.closing}%`, contactOf(l),
    ]), { right: [0, 4, 5, 6] });
  if (leads.length > show) ui.info(`…and ${leads.length - show} more in the file.`);
  for (const l of leads.slice(0, 3)) {
    ui.print();
    const lines = [
      ui.c.muted("Why it fits   ") + (l.compatibilityReason || l.fitReasons.slice(0, 2).join(", ") || "—"),
      ui.c.muted("Verified      ") + `${l.verified ?? 0}/100  ${ui.c.muted(l.legitimacyReason.replace(/^Verified: /, ""))}`,
      ui.c.muted("Closing       ") + `${l.closing}%  ${ui.c.muted(l.closingReasons.join(", "))}`,
    ];
    if (l.phone || l.whatsapp) lines.push(ui.c.muted("Phone         ") + [l.phone, l.whatsapp && `WhatsApp ${l.whatsapp}`].filter(Boolean).join("  ·  "));
    if (l.email) lines.push(ui.c.muted("Email         ") + l.email);
    if (l.website) lines.push(ui.c.muted("Website       ") + l.website);
    const socials = [l.instagram && `Instagram${l.instagramFollowers ? ` (${l.instagramFollowers.toLocaleString("en")})` : ""}`, l.facebook && "Facebook", l.linkedin && "LinkedIn"].filter(Boolean);
    if (socials.length) lines.push(ui.c.muted("Social        ") + socials.join("  ·  "));
    for (const d of l.decisionMakers) lines.push(ui.c.muted("Decision maker ") + `${d.name}, ${d.title}`);
    ui.panel(`${l.name}  ${ui.c.copper("●")} ${ui.c.muted(`rank ${l.rank}`)}`, lines);
  }
}
