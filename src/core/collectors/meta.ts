import { fetchWithBackoff } from "../util";
import { ProviderError } from "./types";

/**
 * Meta Graph API calls (Instagram and Facebook collectors). Official API only, with the member's or
 * Masar's own app tokens. Rate limits back off, then stop the run with partial results.
 */
export async function graphGet(fetchFn: typeof fetch, version: string, path: string, params: Record<string, string>, signal?: AbortSignal) {
  const url = `https://graph.facebook.com/${version}/${path.replace(/^\//, "")}?${new URLSearchParams(params)}`;
  const res = await fetchWithBackoff(fetchFn, url, { signal });
  const body = (await res.json().catch(() => ({}))) as { error?: { code?: number; error_subcode?: number; message?: string } } & Record<string, unknown>;
  if (res.ok && !body.error) return body;
  const e = body.error ?? {};
  const code = e.code ?? res.status;
  const msg = (e.message ?? `HTTP ${res.status}`).replace(/access_token=[^&\s]+/g, "access_token=…");
  if (code === 190 || code === 102) throw new ProviderError(`Meta token rejected: ${msg}`, "auth");
  if ([4, 17, 32, 613, 80001, 80002].includes(code) || res.status === 429) throw new ProviderError(`Meta rate limit: ${msg}`, "rate_limit");
  if ([10, 200, 3, 299].includes(code) || (code >= 200 && code < 300)) throw new ProviderError(`Meta permission missing: ${msg}`, "permission");
  if (code === 100 || code === 110 || code === 803) throw new ProviderError(msg, "not_found");
  throw new ProviderError(`Meta API error ${code}: ${msg}`, "other");
}

export const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
export const domain = (u?: string | null) => {
  if (!u) return "";
  try { return new URL(/^https?:/i.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; }
};
/** Rough name match: one name contains the other, or they share most words. */
export function sameName(a: string, b: string) {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  if (x.includes(y) || y.includes(x)) return true;
  const wa = new Set(x.split(" ").filter((w) => w.length > 2)), wb = y.split(" ").filter((w) => w.length > 2);
  const shared = wb.filter((w) => wa.has(w)).length;
  return shared >= Math.max(1, Math.ceil(Math.min(wa.size, wb.length) * 0.6));
}
