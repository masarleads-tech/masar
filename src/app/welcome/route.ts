import { ensureSetup, htmlPage, member, toLogin } from "@/lib/member";

export const dynamic = "force-dynamic";

/** The setup tour after sign-up. Only for signed-in members; their earlier answers are filled in. */
export async function GET(req: Request) {
  const me = await member();
  if (!me) return toLogin(req, "/welcome", true);
  try {
    const setup = await ensureSetup(me.supabase, me.userId);
    return htmlPage("welcome", { setup, username: setup.username ?? null },
      { id: me.userId, email: setup.email as string | null, username: setup.username as string | null });
  } catch (e) {
    console.error("[masar] welcome:", e instanceof Error ? e.message : e);
    // For example before the new tables are added in Supabase: fall back to the search app.
    return Response.redirect(new URL("/", req.url), 303);
  }
}
