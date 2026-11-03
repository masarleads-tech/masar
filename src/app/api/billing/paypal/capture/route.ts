import { errorResponse, HttpError, requireUser } from "@/lib/server";
import { serviceDb } from "@/lib/cli";
import { finishCheckout } from "@/lib/billing";
import { paypalEnabled } from "@/lib/paypal";

export const dynamic = "force-dynamic";

/** After the member approves in PayPal: takes the payment and extends their plan. { orderId } → { status, plan, months }. */
export async function POST(req: Request) {
  try {
    if (!paypalEnabled()) throw new HttpError(503, "PayPal is not switched on yet.");
    const account = await requireUser();
    if (!account.userId) throw new HttpError(503, "Accounts are switched off on this copy of Masar.");
    const { orderId } = (await req.json().catch(() => ({}))) as { orderId?: unknown };
    if (typeof orderId !== "string" || !orderId) throw new HttpError(400, "Missing the PayPal order.");
    return Response.json(await finishCheckout(serviceDb(), fetch, orderId, account.userId));
  } catch (e) {
    return errorResponse(e);
  }
}
