import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { accountsEnabled } from "./supabase/env";
import { supabaseServer } from "./supabase/server";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "./supabase/env";
import type { Brief } from "./types";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface Account {
  supabase: SupabaseClient | null;
  userId: string | null;
  /** Leads left; null when accounts are off (local testing). */
  credits: number | null;
}

/** API routes need a signed-in user when accounts are on. Clerk only finishes sign-up once the email is confirmed. */
export async function requireUser(): Promise<Account> {
  if (!accountsEnabled) return { supabase: null, userId: null, credits: null };
  const { userId, supabase } = await supabaseServer();
  if (!userId) throw new HttpError(401, "Please log in first.");
  const { data: rows, error } = await supabase.rpc("my_account");
  if (error) throw new HttpError(500, `Could not read your account: ${error.message}`);
  const credits = Array.isArray(rows) && rows[0] ? Number(rows[0].credits) : 0;
  return { supabase, userId, credits };
}

/** Takes up to `n` leads from the user's balance and returns how many it took. */
export async function chargeCredits(account: Account, n: number): Promise<number> {
  if (!account.supabase) return n;
  const { data, error } = await account.supabase.rpc("charge_credits", { wanted: n });
  if (error) throw new HttpError(500, `Could not update your balance: ${error.message}`);
  return Number(data) || 0;
}

export function noCreditsError() {
  return new HttpError(402, "You have no leads left. Contact us to add more.");
}

/** The customer's own Claude key, set by the admin. Needs SUPABASE_SERVICE_ROLE_KEY on the server. */
export async function customerKey(userId: string | null): Promise<string> {
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!userId || !service) return "";
  const admin = createClient(SUPABASE_URL, service, { auth: { persistSession: false } });
  const { data } = await admin.from("customer_keys").select("anthropic_key").eq("user_id", userId).maybeSingle();
  return data?.anthropic_key ?? "";
}

/**
 * Which keys a request uses, in order: the customer's own key (set by the admin), the key the user
 * typed in Settings (only when ALLOW_USER_KEYS=true), then the site's main key.
 * `ownKey` is true when the user pays for the key themselves, so no leads are taken from their balance.
 */
export async function keysFrom(req: Request, account: Account) {
  const byok = process.env.ALLOW_USER_KEYS === "true";
  const typed = (byok && req.headers.get("x-anthropic-key")) || "";
  const assigned = await customerKey(account.userId);
  const anthropicKey = assigned || typed || process.env.ANTHROPIC_API_KEY || "";
  const googleKey = (byok && req.headers.get("x-google-maps-key")) || process.env.GOOGLE_MAPS_API_KEY || "";
  if (!anthropicKey) throw new HttpError(503, "Masar is not switched on yet: the Claude API key is missing.");
  const ownKey = !assigned && !!typed;
  return { anthropic: new Anthropic({ apiKey: anthropicKey, maxRetries: 2 }), googleKey, ownKey };
}

export function cleanBrief(raw: unknown): Brief {
  const b = (raw ?? {}) as Partial<Brief>;
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String).map((s) => s.trim()).filter(Boolean) : []);
  return {
    clientName: String(b.clientName ?? "").slice(0, 120),
    offer: String(b.offer ?? "").slice(0, 1000),
    targetType: b.targetType === "individual" ? "individual" : "business",
    industry: String(b.industry ?? "cosmetics_retail"),
    industryCustom: String(b.industryCustom ?? "").slice(0, 200),
    locations: list(b.locations).slice(0, 5),
    size: (["any", "independent", "chain"] as const).includes(b.size as never) ? (b.size as Brief["size"]) : "any",
    positioning: (["any", "premium", "mid", "budget"] as const).includes(b.positioning as never) ? (b.positioning as Brief["positioning"]) : "any",
    channel: (["phone", "email", "social", "visit", "any"] as const).includes(b.channel as never) ? (b.channel as Brief["channel"]) : "phone",
    mustHave: list(b.mustHave).filter((m): m is Brief["mustHave"][number] => ["phone", "email", "website", "social"].includes(m)),
    goodSignals: list(b.goodSignals).slice(0, 10),
    exclude: list(b.exclude).slice(0, 30),
    count: Math.max(5, Math.min(200, Number(b.count) || 50)),
  };
}

export function errorResponse(e: unknown) {
  if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
  if (e instanceof Anthropic.AuthenticationError) return Response.json({ error: "The Claude API key was rejected." }, { status: 401 });
  if (e instanceof Anthropic.RateLimitError) return Response.json({ error: "Claude is busy (rate limit). Try again in a minute." }, { status: 429 });
  if (e instanceof Anthropic.APIError) return Response.json({ error: `Claude API error: ${e.message}` }, { status: 502 });
  console.error(e);
  return Response.json({ error: e instanceof Error ? e.message : "Something went wrong." }, { status: 500 });
}
