import { createHash, randomBytes, randomInt } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "./server";
import { SUPABASE_URL } from "./supabase/env";

/**
 * The Masar CLI signs in with a one-time code the member approves on the website (like signing in
 * to a TV), then sends a long-lived token in the x-masar-token header. Only a hash of each token is kept.
 * These tables are written with the service role key, so every query here filters by user id itself.
 */
export function serviceDb(): SupabaseClient {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !key) throw new HttpError(503, "The Masar CLI is not switched on yet (SUPABASE_SERVICE_ROLE_KEY is missing).");
  return createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const newToken = () => `masar_${randomBytes(32).toString("base64url")}`;
export const newDeviceCode = () => randomBytes(32).toString("base64url");

/** Eight letters a person can read out loud without mixing them up, shown as ABCD-EFGH. */
const ALPHABET = "BCDFGHJKLMNPQRSTVWXZ";
export function newUserCode() {
  let s = "";
  for (let i = 0; i < 8; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}
export const cleanUserCode = (raw: unknown) => {
  const s = String(raw ?? "").toUpperCase().replace(/[^A-Z]/g, "");
  return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4)}` : "";
};

export interface CliAccount {
  db: SupabaseClient;
  userId: string;
  tokenId: string;
  email: string | null;
  credits: number;
  plan: "free" | "weekly" | "basic" | "premium";
  planUntil: string | null;
}

/** The member behind the CLI token on this request, with their plan and credits. */
export async function cliUser(req: Request): Promise<CliAccount> {
  const token = req.headers.get("x-masar-token")?.trim() ?? "";
  if (!token.startsWith("masar_")) throw new HttpError(401, "Not signed in. Run: masar login");
  const db = serviceDb();
  const { data: row } = await db.from("cli_tokens").select("id, user_id, revoked_at")
    .eq("token_hash", sha256(token)).maybeSingle();
  if (!row || row.revoked_at) throw new HttpError(401, "This computer was signed out. Run: masar login");
  const [{ data: acc, error }] = await Promise.all([
    db.rpc("account_for", { uid: row.user_id }),
    db.from("cli_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", row.id),
  ]);
  if (error) throw new HttpError(500, `Could not read your account: ${error.message}`);
  const a = Array.isArray(acc) && acc[0] ? acc[0] : {};
  const plan = (["weekly", "basic", "premium"] as const).find((p) => p === a.plan) ?? "free";
  return { db, userId: row.user_id, tokenId: row.id, email: a.email ?? null, credits: Number(a.credits ?? 0), plan, planUntil: a.plan_until ?? null };
}

/** Premium members' CLI leads are free: their own AI does the work. Set CLI_FREE_LEADS=true to make CLI leads free for everyone. */
export const cliLeadsAreFree = (plan: CliAccount["plan"]) => plan === "premium" || process.env.CLI_FREE_LEADS === "true";
