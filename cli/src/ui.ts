/**
 * The Masar look in a terminal, from the brand system: deep ink, warm paper, a restrained mineral
 * teal for actions and the mint destination dot, copper only for the rare highlight.
 * Crisp geometry, calm motion that respects reduced motion, and never colour alone for meaning.
 */
import * as readline from "node:readline";
import { stdin, stdout } from "node:process";

type RGB = [number, number, number];
const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;

const light = process.env.MASAR_THEME === "light" || (!process.env.MASAR_THEME && /;(7|15)$/.test(process.env.COLORFGBG ?? ""));
const PALETTE = light
  ? { text: "#101A1B", muted: "#777B75", accent: "#176B64", dot: "#176B64", copper: "#A76B45", line: "#D4D4CC", warn: "#9A6A1F", bad: "#B5483A", path: "#101A1B" }
  : { text: "#EEF2F0", muted: "#9AAEAC", accent: "#72B7A7", dot: "#72B7A7", copper: "#C08A63", line: "#3A4B4C", warn: "#D8A657", bad: "#E07A6B", path: "#FAF8F3" };

const colorOn = stdout.isTTY && !process.env.NO_COLOR && process.env.TERM !== "dumb";
const truecolor = /truecolor|24bit/i.test(process.env.COLORTERM ?? "") || !!process.env.WT_SESSION ||
  /iTerm|vscode|WezTerm|ghostty/i.test(process.env.TERM_PROGRAM ?? "");

function ansi256([r, g, b]: RGB) {
  if (r === g && g === b) return r < 8 ? 16 : r > 248 ? 231 : Math.round(((r - 8) / 247) * 24) + 232;
  const q = (v: number) => Math.round((v / 255) * 5);
  return 16 + 36 * q(r) + 6 * q(g) + q(b);
}
function paint(h: string, bold = false) {
  return (s: string | number) => {
    if (!colorOn) return String(s);
    const rgb = hex(h);
    const fg = truecolor ? `38;2;${rgb.join(";")}` : `38;5;${ansi256(rgb)}`;
    return `\x1b[${bold ? "1;" : ""}${fg}m${s}\x1b[0m`;
  };
}

export const c = {
  text: paint(PALETTE.text),
  strong: paint(PALETTE.text, true),
  muted: paint(PALETTE.muted),
  accent: paint(PALETTE.accent),
  accentBold: paint(PALETTE.accent, true),
  dot: paint(PALETTE.dot, true),
  copper: paint(PALETTE.copper),
  line: paint(PALETTE.line),
  warn: paint(PALETTE.warn),
  bad: paint(PALETTE.bad),
  path: paint(PALETTE.path, true),
};

const ANSI = /\x1b\[[0-9;]*m/g;
export const visible = (s: string) => s.replace(ANSI, "");
/** Display width, counting wide (CJK/emoji) characters as two columns. */
export function width(s: string) {
  let w = 0;
  for (const ch of visible(s)) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp < 32 || (cp >= 0x300 && cp < 0x370) || (cp >= 0x64b && cp <= 0x65f)) continue;
    w += cp >= 0x1100 && (cp <= 0x115f || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0x1f300 && cp <= 0x1faff)) ? 2 : 1;
  }
  return w;
}
export function fit(s: string, n: number) {
  const plain = visible(s);
  if (width(plain) <= n) return s + " ".repeat(n - width(plain));
  let out = "";
  for (const ch of plain) { if (width(out + ch) > n - 1) break; out += ch; }
  return out + "…" + " ".repeat(Math.max(0, n - width(out) - 1));
}
export const cols = () => Math.max(60, Math.min(stdout.columns || 100, 140));

export const reducedMotion = !stdout.isTTY || !!process.env.MASAR_REDUCED_MOTION || !!process.env.CI;
const out = (s = "") => stdout.write(s + "\n");
export const print = out;

/** The route mark: a single continuous path that bends toward its destination point. */
export function banner(sub?: string) {
  out();
  out("  " + c.path("╭───╮"));
  out("  " + c.path("│   ╰──") + c.dot("●") + "   " + c.strong("masar") + c.muted("  lead generation for the Middle East"));
  out("  " + c.path("│") + (sub ? "        " + c.muted(sub) : ""));
  out();
}

export function heading(s: string) { out(); out("  " + c.strong(s)); }
export function rule() { out("  " + c.line("─".repeat(cols() - 4))); }
export function info(s: string) { out("  " + c.muted(s)); }
export function say(s: string) { out("  " + s); }
export function ok(s: string) { out("  " + c.accent("✓") + " " + c.text(s)); }
export function warn(s: string) { out("  " + c.warn("!") + " " + c.text(s)); }
export function fail(s: string) { out("  " + c.bad("✕") + " " + c.text(s)); }
export function step(n: number, total: number, s: string) { out("  " + c.muted(`${n}/${total}`) + "  " + c.text(s)); }
/** A key-value list, aligned. */
export function facts(rows: [string, string][]) {
  const w = Math.max(...rows.map(([k]) => width(k)));
  for (const [k, v] of rows) out("  " + c.muted(fit(k, w)) + "   " + v);
}
/** A flat panel with a thin border and a title, 10px-card in spirit. */
export function panel(title: string, lines: string[]) {
  const w = Math.min(cols() - 4, Math.max(width(title) + 6, ...lines.map((l) => width(l) + 4)));
  out("  " + c.line("┌─ ") + c.strong(title) + " " + c.line("─".repeat(Math.max(0, w - width(title) - 5)) + "┐"));
  for (const l of lines) out("  " + c.line("│") + " " + fit(l, w - 3) + " " + c.line("│"));
  out("  " + c.line("└" + "─".repeat(w - 2) + "┘"));
}

/** A calm table: header in muted text, subtle separators, numbers right-aligned. */
export function table(head: string[], rows: string[][], opts: { right?: number[]; widths?: number[] } = {}) {
  const avail = cols() - 4 - 2 * (head.length - 1);
  let ws = opts.widths ?? head.map((h, i) => Math.max(width(h), ...rows.map((r) => width(r[i] ?? ""))));
  const total = ws.reduce((a, b) => a + b, 0);
  if (total > avail) {
    const widest = ws.indexOf(Math.max(...ws));
    ws = ws.map((w, i) => (i === widest ? Math.max(8, w - (total - avail)) : w));
  }
  const cell = (s: string, i: number) => {
    const f = fit(s, ws[i]);
    return opts.right?.includes(i) ? " ".repeat(Math.max(0, ws[i] - width(s))) + (width(s) > ws[i] ? f : s) : f;
  };
  out("  " + head.map((h, i) => c.muted(cell(h, i))).join("  "));
  out("  " + c.line(ws.map((w) => "─".repeat(w)).join("  ")));
  for (const r of rows) out("  " + r.map((s, i) => cell(s ?? "", i)).join("  "));
}

/** A score as a short bar plus the number, so it reads without colour too. */
export function meter(v: number, n = 10) {
  const full = Math.round((Math.max(0, Math.min(100, v)) / 100) * n);
  const col = v >= 70 ? c.accent : v >= 45 ? c.text : c.muted;
  return col("■".repeat(full)) + c.line((colorOn ? "■" : "·").repeat(n - full)) + " " + col(String(Math.round(v)).padStart(3));
}

/** The route-draw spinner: a dot travelling along a thin line. Static text when motion is reduced. */
export function spinner(text: string) {
  let msg = text, i = 0, timer: NodeJS.Timeout | null = null;
  const W = 6;
  const frame = () => {
    const pos = i % (W * 2 - 2), p = pos < W ? pos : W * 2 - 2 - pos;
    return c.line("─".repeat(p)) + c.dot("●") + c.line("─".repeat(W - 1 - p));
  };
  const draw = () => { stdout.write("\r\x1b[2K  " + frame() + "  " + c.text(msg)); i++; };
  if (reducedMotion) out("  " + c.muted("…") + " " + c.text(msg));
  else { draw(); timer = setInterval(draw, 110); }
  const stop = (mark: string, final: string) => {
    if (timer) { clearInterval(timer); stdout.write("\r\x1b[2K"); }
    out("  " + mark + " " + c.text(final));
  };
  return {
    update(s: string) { msg = s; if (reducedMotion) out("  " + c.muted("…") + " " + c.text(s)); },
    done(s = msg) { stop(c.accent("✓"), s); },
    warn(s = msg) { stop(c.warn("!"), s); },
    fail(s = msg) { stop(c.bad("✕"), s); },
  };
}

// ---------- Questions ----------

let rl: readline.Interface | null = null;
let inputClosed = false;
let pending: ((a: string) => void) | null = null;
function iface() {
  if (!rl) {
    rl = readline.createInterface({ input: stdin, output: stdout, terminal: stdin.isTTY });
    rl.on("SIGINT", () => { out(); info("Stopped."); process.exit(130); });
    rl.on("close", () => { inputClosed = true; pending?.(""); pending = null; });
  }
  return rl;
}
export function closeInput() { rl?.close(); rl = null; }

/** One line from the member. When input has ended (a pipe or Ctrl+D), the default is used. */
function readLine(prompt: string): Promise<string> {
  if (inputClosed) { out(prompt); return Promise.resolve(""); }
  return new Promise((resolve) => {
    pending = resolve;
    iface().question(prompt, (a) => { pending = null; resolve(a.trim()); });
  });
}

export function ask(question: string, opts: { default?: string; hint?: string } = {}): Promise<string> {
  out();
  out("  " + c.accent("?") + " " + c.strong(question));
  if (opts.hint) out("    " + c.muted(opts.hint));
  const prompt = "  " + c.accent("›") + " " + (opts.default ? c.muted(`(${opts.default}) `) : "");
  return readLine(prompt).then((a) => a || opts.default || "");
}

/** Numbered choices; the answer can be a number or free text. */
export async function choose(question: string, choices: string[], opts: { default?: number; allowOther?: boolean; hint?: string } = {}): Promise<string> {
  out();
  out("  " + c.accent("?") + " " + c.strong(question));
  if (opts.hint) out("    " + c.muted(opts.hint));
  choices.forEach((ch, i) => out("    " + c.accent(String(i + 1).padStart(2)) + "  " + c.text(ch)));
  if (opts.allowOther) out("    " + c.muted("   or type your own answer"));
  const def = opts.default !== undefined ? String(opts.default + 1) : "";
  for (;;) {
    const a = (await readLine("  " + c.accent("›") + " " + (def ? c.muted(`(${def}) `) : ""))) || def;
    if (!a && inputClosed) throw new Error("No answer given (input ended).");
    const n = Number(a);
    if (Number.isInteger(n) && n >= 1 && n <= choices.length) return choices[n - 1];
    if (a && opts.allowOther) return a;
    out("    " + c.warn(`Type a number from 1 to ${choices.length}.`));
  }
}

export async function confirm(question: string, def = true): Promise<boolean> {
  const a = (await ask(question + c.muted(def ? "  [Y/n]" : "  [y/N]"))).toLowerCase();
  if (!a) return def;
  return /^(y|yes|نعم|ايوه|اي)/.test(a);
}

export function link(url: string, text = url) {
  if (!colorOn) return url;
  return `\x1b]8;;${url}\x1b\\${c.accent(text)}\x1b]8;;\x1b\\`;
}
