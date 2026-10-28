import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./env";

type ClerkGlobal = { session?: { getToken(): Promise<string | null> } | null };

let client: SupabaseClient | null = null;

/** Supabase client acting as the signed-in Clerk user: Supabase trusts Clerk's session token. */
export function supabaseBrowser() {
  client ??= createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    accessToken: async () => (await (window as unknown as { Clerk?: ClerkGlobal }).Clerk?.session?.getToken()) ?? null,
  });
  return client;
}
