import { serviceDb } from "@/lib/cli";
import { handleWebhook } from "@/lib/billing";
import { paypalEnabled, verifyWebhook } from "@/lib/paypal";

export const dynamic = "force-dynamic";

/**
 * PayPal's webhook (PayPal developer dashboard > your app > Webhooks > add
 * https://<your site>/api/billing/paypal/webhook, then copy its id into PAYPAL_WEBHOOK_ID).
 * Events: Checkout order approved, Payment capture completed / denied / refunded / reversed.
 * Every event is checked with PayPal before anything changes.
 */
export async function POST(req: Request) {
  if (!paypalEnabled()) return Response.json({ error: "PayPal is off" }, { status: 503 });
  const event = await req.json().catch(() => null);
  if (!event || !(await verifyWebhook(fetch, req.headers, event))) return Response.json({ error: "Could not verify this webhook" }, { status: 400 });
  try {
    const note = await handleWebhook(serviceDb(), fetch, event);
    console.log(`[masar] PayPal ${event.event_type}: ${note}`);
    return Response.json({ ok: true });
  } catch (e) {
    // A 500 makes PayPal retry later.
    console.error("[masar] PayPal webhook failed:", e instanceof Error ? e.message : e);
    return Response.json({ error: "failed" }, { status: 500 });
  }
}
