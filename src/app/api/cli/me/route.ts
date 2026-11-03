import { errorResponse } from "@/lib/server";
import { cliLeadsAreFree, cliUser } from "@/lib/cli";

/** The signed-in CLI member: plan, credits and the answers from their setup tour (to start the interview). */
export async function GET(req: Request) {
  try {
    const me = await cliUser(req);
    const { data: setup } = await me.db.from("user_setup")
      .select("username, industries, ideal_customer, cities, leads_per_week, currency, deal_size")
      .eq("user_id", me.userId).maybeSingle();
    const site = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || new URL(req.url).origin;
    return Response.json({
      email: me.email,
      username: setup?.username ?? null,
      plan: me.plan,
      planUntil: me.planUntil,
      credits: me.credits,
      cliLeadsFree: cliLeadsAreFree(me.plan),
      setup: setup ?? null,
      dashboardUrl: `${site}/dashboard`,
      billingUrl: `${site}/billing`,
    });
  } catch (e) {
    return errorResponse(e);
  }
}

/** Remembers which AI this computer uses, so the dashboard can show it. */
export async function PATCH(req: Request) {
  try {
    const me = await cliUser(req);
    const body = (await req.json().catch(() => ({}))) as { provider?: unknown; model?: unknown; device?: unknown };
    const patch: Record<string, string> = {};
    if (body.provider !== undefined) patch.ai_provider = String(body.provider).slice(0, 40);
    if (body.model !== undefined) patch.ai_model = String(body.model).slice(0, 80);
    if (body.device !== undefined) patch.device_name = String(body.device).slice(0, 80);
    if (Object.keys(patch).length) await me.db.from("cli_tokens").update(patch).eq("id", me.tokenId);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

/** masar logout: this computer's token stops working. */
export async function DELETE(req: Request) {
  try {
    const me = await cliUser(req);
    await me.db.from("cli_tokens").update({ revoked_at: new Date().toISOString() }).eq("id", me.tokenId);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
