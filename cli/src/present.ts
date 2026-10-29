import type { Lead } from "../../src/lib/types";
import * as ui from "./ui";

const contactOf = (l: Lead) => l.phone || l.whatsapp || l.email || (l.instagram ? "Instagram" : l.linkedin ? "LinkedIn" : "—");

/** The Intelligence agent's ranking in the terminal: a ranked table, then the top leads in detail. */
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
