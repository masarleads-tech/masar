import { errorResponse } from "@/lib/server";
import { clientIp, rateLimit } from "@/lib/redis";
import { newDeviceCode, newUserCode, serviceDb, sha256 } from "@/lib/cli";

const TTL = 10 * 60; // seconds

/**
 * Step 1 of signing in the CLI: it gets a secret device code (kept on the computer) and a short code
 * the member approves on the website at /cli/connect.
 */
export async function POST(req: Request) {
  try {
    await rateLimit("cliAuthStart", clientIp(req));
    const body = (await req.json().catch(() => ({}))) as { client?: unknown };
    const client = String(body.client ?? "").replace(/[^\p{L}\p{N} ._()\-/]/gu, "").slice(0, 80);
    const db = serviceDb();
    await db.from("cli_device_codes").delete().lt("expires_at", new Date(Date.now() - 864e5).toISOString());
    const deviceCode = newDeviceCode();
    let userCode = "";
    for (let i = 0; i < 4 && !userCode; i++) {
      const code = newUserCode();
      const { error } = await db.from("cli_device_codes").insert({
        device_hash: sha256(deviceCode), user_code: code, client_name: client,
        expires_at: new Date(Date.now() + TTL * 1000).toISOString(),
      });
      if (!error) userCode = code;
      else if (error.code !== "23505") throw new Error(`Could not start sign-in: ${error.message}`);
    }
    if (!userCode) throw new Error("Could not start sign-in. Try again.");
    const site = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || new URL(req.url).origin;
    return Response.json({
      device_code: deviceCode,
      user_code: userCode,
      verification_uri: `${site}/cli/connect`,
      verification_uri_complete: `${site}/cli/connect?code=${userCode}`,
      interval: 3,
      expires_in: TTL,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
