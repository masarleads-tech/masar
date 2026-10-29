import { errorResponse } from "@/lib/server";
import { newToken, serviceDb, sha256 } from "@/lib/cli";

/**
 * Step 3: the CLI asks every few seconds whether the member approved the code.
 * Once approved it gets its token, exactly once.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { device_code?: unknown };
    const deviceHash = sha256(String(body.device_code ?? ""));
    const db = serviceDb();
    const { data: row } = await db.from("cli_device_codes").select("*").eq("device_hash", deviceHash).maybeSingle();
    if (!row) return Response.json({ status: "invalid" }, { status: 404 });
    if (row.status === "denied") return Response.json({ status: "denied" }, { status: 403 });
    if (row.status === "used") return Response.json({ status: "used" }, { status: 410 });
    if (new Date(row.expires_at).getTime() < Date.now()) return Response.json({ status: "expired" }, { status: 410 });
    if (row.status !== "approved" || !row.user_id) return Response.json({ status: "pending" });

    // Mark the code used first, so two polls at once can't both get a token.
    const { data: claimed } = await db.from("cli_device_codes").update({ status: "used" })
      .eq("device_hash", deviceHash).eq("status", "approved").select("device_hash");
    if (!claimed?.length) return Response.json({ status: "used" }, { status: 410 });
    const token = newToken();
    const { error } = await db.from("cli_tokens").insert({ user_id: row.user_id, token_hash: sha256(token), device_name: row.client_name });
    if (error) throw new Error(`Could not finish sign-in: ${error.message}`);
    const { data: profile } = await db.from("profiles").select("email").eq("id", row.user_id).maybeSingle();
    return Response.json({ status: "approved", token, email: profile?.email ?? null });
  } catch (e) {
    return errorResponse(e);
  }
}
