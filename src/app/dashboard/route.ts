import { dashboardData, htmlPage, member, toLogin } from "@/lib/member";

export const dynamic = "force-dynamic";

/** The customer dashboard. Only for signed-in members; new members finish the setup tour first. */
export async function GET(req: Request) {
  const me = await member();
  if (!me) return toLogin(req, "/dashboard");
  try {
    const data = await dashboardData(me.supabase, me.userId);
    if (!data.setup.setup_done) return Response.redirect(new URL("/welcome", req.url), 303);
    return htmlPage("dashboard", data);
  } catch (e) {
    console.error("[masar] dashboard:", e instanceof Error ? e.message : e);
    // For example before the new tables are added in Supabase: fall back to the search app.
    return Response.redirect(new URL("/", req.url), 303);
  }
}
