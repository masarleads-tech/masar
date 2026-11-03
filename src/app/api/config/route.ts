import { briefFromSetup } from "@/core/brief";
import { customerKey } from "@/lib/server";
import { publicPaypalConfig } from "@/lib/paypal";
import type { UserInfo } from "@/lib/types";
import { accountsEnabled } from "@/lib/supabase/env";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** What the browser needs to know about this deployment and the signed-in user. */
export async function GET() {
  let user: UserInfo | null = null;
  let hasOwnKey = false;
  let defaults = {};
  if (accountsEnabled) {
    const { userId, supabase } = await supabaseServer();
    if (userId) {
      const { data: rows } = await supabase.rpc("my_account");
      const a = Array.isArray(rows) ? rows[0] : null;
      user = {
        email: a?.email ?? null,
        confirmed: true,
        credits: Number(a?.credits ?? 0),
        plan: ["weekly", "basic", "premium"].includes(a?.plan) ? a.plan : "free",
        planUntil: a?.plan_until ?? null,
        weekStarted: a?.week_started ?? null,
        isAdmin: !!a?.is_admin,
      };
      hasOwnKey = !!(await customerKey(userId));
      // The setup tour's answers become the search form's starting values.
      const { data: setup } = await supabase.from("user_setup").select("industries, cities, ideal_customer, leads_per_week").eq("user_id", userId).maybeSingle();
      defaults = briefFromSetup(setup);
    }
  }
  return Response.json({
    accountsEnabled,
    googleLogin: true,
    user,
    allowUserKeys: process.env.ALLOW_USER_KEYS === "true",
    hasServerClaudeKey: !!process.env.ANTHROPIC_API_KEY || hasOwnKey,
    hasServerGoogleKey: !!process.env.GOOGLE_MAPS_API_KEY,
    defaults,
    paypal: publicPaypalConfig(),
  });
}
