import { errorResponse, HttpError, requireUser } from "@/lib/server";
import { serviceDb } from "@/lib/cli";
import { startCheckout } from "@/lib/billing";
import { parseCheckout, paypalEnabled } from "@/lib/paypal";
import { rateLimit } from "@/lib/redis";

export const dynamic = "force-dynamic";

/** Opens a PayPal order for the signed-in member: { plan: "basic" | "premium", months: 1 | 3 | 12 } → { orderId }. */
export async function POST(req: Request) {
  try {
    if (!paypalEnabled()) throw new HttpError(503, "PayPal is not switched on yet.");
    const account = await requireUser();
    if (!account.userId) throw new HttpError(503, "Accounts are switched off on this copy of Masar.");
    await rateLimit("checkout", account.userId);
    const { plan, months } = parseCheckout(await req.json().catch(() => ({})));
    const site = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || new URL(req.url).origin;
    const r = await startCheckout(serviceDb(), fetch, { userId: account.userId, plan, months, site });
    return Response.json({ orderId: r.orderId, approveUrl: r.approveUrl });
  } catch (e) {
    return errorResponse(e);
  }
}
