import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./env";

/** The signed-in Clerk user (or null) and a Supabase client acting as them. */
export async function supabaseServer() {
  const { userId, getToken } = await auth();
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    accessToken: async () => (await getToken()) ?? null,
  });
  return { userId, supabase };
}
