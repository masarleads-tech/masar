import { writeFileSync } from "node:fs";
import path from "node:path";
import type { Lead } from "../../src/lib/types";

const COLS: [string, (l: Lead, i: number) => unknown][] = [
  ["Rank", (_, i) => i + 1], ["Business", (l) => l.name], ["Category", (l) => l.category], ["City", (l) => l.city],
  ["Address", (l) => l.address], ["Rank score", (l) => l.rank], ["Fit %", (l) => l.fit], ["Compatibility %", (l) => l.compatibility],
  ["Why it fits", (l) => l.compatibilityReason], ["Verified %", (l) => l.verified], ["Closing %", (l) => l.closing],
  ["Phone", (l) => l.phone], ["WhatsApp", (l) => l.whatsapp], ["Email", (l) => l.email], ["Website", (l) => l.website],
  ["Instagram", (l) => l.instagram], ["Instagram followers", (l) => l.instagramFollowers], ["Instagram check", (l) => l.instagramVerdict],
  ["Facebook", (l) => l.facebook], ["Facebook check", (l) => l.facebookVerdict], ["LinkedIn", (l) => l.linkedin],
  ["Decision makers", (l) => l.decisionMakers.map((d) => `${d.name} (${d.title})${d.profileUrl ? ` ${d.profileUrl}` : ""}`).join("; ")],
  ["Chain", (l) => (l.isChain ? "yes" : "")], ["Legitimacy", (l) => l.legitimacy], ["Checks", (l) => l.legitimacyReason],
  ["Google Maps", (l) => l.mapsUrl], ["Sources", (l) => l.sources.join(" ")],
];

const cell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  // Quote everything; neutralise spreadsheet formulas.
  return `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
};

/** Writes the leads as CSV (opens in Excel and Google Sheets, Arabic included) and returns the path. */
export function writeCsv(leads: Lead[], file: string) {
  const lines = [COLS.map(([h]) => cell(h)).join(","), ...leads.map((l, i) => COLS.map(([, f]) => cell(f(l, i))).join(","))];
  const p = path.resolve(file);
  writeFileSync(p, "﻿" + lines.join("\r\n"), "utf8");
  return p;
}

export function writeJson(leads: Lead[], file: string) {
  const p = path.resolve(file);
  writeFileSync(p, JSON.stringify(leads, null, 2), "utf8");
  return p;
}
