import { errorResponse, HttpError } from "@/lib/server";
import { member } from "@/lib/member";
import { cleanUserCode, serviceDb } from "@/lib/cli";

/** Step 2: the signed-in member approves (or denies) the code their terminal shows. */
export async function POST(req: Request) {
  try {
    const me = await member();
    if (!me) throw new HttpError(401, "Please log in first.");
    const body = (await req.json().catch(() => ({}))) as { code?: unknown; approve?: unknown };
    const code = cleanUserCode(body.code);
    if (!code) throw new HttpError(400, "That code doesn't look right. It has 8 letters, like ABCD-EFGH.");
    const db = serviceDb();
    const { data: row } = await db.from("cli_device_codes").select("status, expires_at, client_name").eq("user_code", code).maybeSingle();
    if (!row || row.status !== "pending" || new Date(row.expires_at).getTime() < Date.now()) {
      throw new HttpError(404, "This code has expired or was already used. Run masar login again for a new one.");
    }
    const approve = body.approve !== false;
    const { error } = await db.from("cli_device_codes")
      .update({ status: approve ? "approved" : "denied", user_id: approve ? me.userId : null })
      .eq("user_code", code).eq("status", "pending");
    if (error) throw new Error(`Could not save: ${error.message}`);
    return Response.json({ ok: true, approved: approve, device: row.client_name });
  } catch (e) {
    return errorResponse(e);
  }
}
