import { errorResponse, HttpError } from "@/lib/server";
import { member } from "@/lib/member";
import { serviceDb } from "@/lib/cli";

/** The computers signed in to the member's CLI, for the website. */
export async function GET() {
  try {
    const me = await member();
    if (!me) throw new HttpError(401, "Please log in first.");
    const { data } = await me.supabase.from("cli_tokens")
      .select("id, device_name, ai_provider, ai_model, created_at, last_used_at")
      .is("revoked_at", null).order("created_at", { ascending: false }).limit(50);
    return Response.json({ devices: data ?? [] });
  } catch (e) {
    return errorResponse(e);
  }
}

/** Signs one computer out of the CLI. */
export async function DELETE(req: Request) {
  try {
    const me = await member();
    if (!me) throw new HttpError(401, "Please log in first.");
    const id = new URL(req.url).searchParams.get("id") ?? "";
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new HttpError(400, "Missing computer id.");
    await serviceDb().from("cli_tokens").update({ revoked_at: new Date().toISOString() }).eq("id", id).eq("user_id", me.userId);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
