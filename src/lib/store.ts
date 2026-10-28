import type { Brief, Lead } from "./types";
import type { Lang } from "./i18n";

/** Browser-only storage. Every access is wrapped because storage can be blocked. */
const KEYS = "lead-agent:keys";
const LAST = "lead-agent:last";
const LANG = "lead-agent:lang";

export interface SavedRun {
  brief: Brief;
  leads: Lead[];
  usage: { inputTokens: number; outputTokens: number; webSearches: number };
  sourcesUsed: string[];
  at: string;
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked: the page still works without it */
  }
}

export const loadKeys = () => read<{ claude: string; google: string }>(KEYS) ?? { claude: "", google: "" };
export const saveKeys = (k: { claude: string; google: string }) => write(KEYS, k);
export const loadRun = () => read<SavedRun>(LAST);
export const saveRun = (r: SavedRun) => write(LAST, r);
export const loadLang = (): Lang => (read<Lang>(LANG) === "ar" ? "ar" : "en");
export function saveLang(l: Lang) {
  write(LANG, l);
  // The server reads this cookie to show the sign-in screens in the right language.
  document.cookie = `masar-lang=${l}; path=/; max-age=31536000; samesite=lax`;
}

/** Headers that carry the user's own keys, when they set any. */
export function keyHeaders(): Record<string, string> {
  const k = loadKeys();
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (k.claude) h["x-anthropic-key"] = k.claude;
  if (k.google) h["x-google-maps-key"] = k.google;
  return h;
}
