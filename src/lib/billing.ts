import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "./server";
import { captureOrder, createOrder, paypalCurrency, priceFor, type PaidPlan } from "./paypal";

/**
 * The payment flow, shared by the checkout page and PayPal's webhook:
 * 1. startCheckout: a pending row in public.payments, then a PayPal order that carries the row id.
 * 2. finishCheckout: capture the order and call complete_payment, which marks the row paid and
 *    extends the member's plan once (safe to call again from the webhook).
 * `db` is the service-role client (src/lib/cli.ts serviceDb), so every query filters by user id itself.
 */

export interface CheckoutStart { paymentId: string; orderId: string; approveUrl: string | null }

export async function startCheckout(db: SupabaseClient, fetchImpl: typeof fetch, o: { userId: string; plan: PaidPlan; months: number; site: string }): Promise<CheckoutStart> {
  const amount = priceFor(o.plan, o.months);
  const { data: row, error } = await db.from("payments")
    .insert({ user_id: o.userId, provider: "paypal", plan: o.plan, months: o.months, amount, currency: paypalCurrency() })
    .select("id").single();
  if (error || !row) throw new HttpError(500, `Could not start the payment: ${error?.message ?? "no row"}`);
  const order = await createOrder(fetchImpl, {
    plan: o.plan, months: o.months, reference: row.id,
    returnUrl: `${o.site}/billing?paid=1`, cancelUrl: `${o.site}/billing?cancelled=1`,
  }).catch(async (e) => {
    await db.from("payments").update({ status: "failed" }).eq("id", row.id);
    throw e;
  });
  await db.from("payments").update({ provider_order_id: order.id }).eq("id", row.id);
  const approveUrl = (order.links ?? []).find((l) => l.rel === "payer-action" || l.rel === "approve")?.href ?? null;
  return { paymentId: row.id, orderId: order.id, approveUrl };
}

export interface CheckoutResult { status: "paid" | "already_paid" | "pending"; plan: PaidPlan; months: number }

/** Captures the order and gives the plan. `userId` (from the checkout page) must own the order; the webhook passes null. */
export async function finishCheckout(db: SupabaseClient, fetchImpl: typeof fetch, orderId: string, userId: string | null): Promise<CheckoutResult> {
  const { data: pay } = await db.from("payments").select("id, user_id, plan, months, status").eq("provider_order_id", orderId).maybeSingle();
  if (!pay || (userId && pay.user_id !== userId)) throw new HttpError(404, "We could not find this payment.");
  if (pay.status === "paid") return { status: "already_paid", plan: pay.plan, months: pay.months };
  if (pay.status !== "pending") throw new HttpError(409, `This payment is ${pay.status}.`);
  const cap = await captureOrder(fetchImpl, orderId);
  if (cap.reference && cap.reference !== pay.id) throw new HttpError(409, "This PayPal order belongs to another payment.");
  if (cap.status !== "COMPLETED") {
    // PENDING means PayPal is still checking (eCheck, review). The webhook finishes it later.
    if (cap.status === "DECLINED" || cap.status === "FAILED") await db.from("payments").update({ status: "failed" }).eq("id", pay.id);
    return { status: "pending", plan: pay.plan, months: pay.months };
  }
  return complete(db, orderId, cap.captureId, cap.amount, cap.currency, cap.payerEmail, pay);
}

async function complete(db: SupabaseClient, orderId: string, captureId: string | null, amount: number, currency: string, payer: string | null, pay: { plan: PaidPlan; months: number }): Promise<CheckoutResult> {
  const { data, error } = await db.rpc("complete_payment", { order_id: orderId, capture_id: captureId, paid_amount: amount, paid_currency: currency, payer });
  if (error) throw new HttpError(500, `The payment went through but we could not update your plan: ${error.message}. Contact us and we will fix it.`);
  return { status: data ? "paid" : "already_paid", plan: pay.plan, months: pay.months };
}

interface WebhookEvent {
  event_type?: string;
  resource?: {
    id?: string; status?: string; custom_id?: string;
    amount?: { value?: string; currency_code?: string };
    supplementary_data?: { related_ids?: { order_id?: string } };
    links?: { rel?: string; href?: string }[];
    payer?: { email_address?: string };
  };
}

/** What PayPal's webhook does. Returns a short note for the logs. */
export async function handleWebhook(db: SupabaseClient, fetchImpl: typeof fetch, event: WebhookEvent): Promise<string> {
  const r = event.resource ?? {};
  switch (event.event_type) {
    case "CHECKOUT.ORDER.APPROVED": {
      // The member approved but closed the window before the page captured it.
      if (!r.id) return "no order id";
      const res = await finishCheckout(db, fetchImpl, r.id, null).catch((e) => { if (e instanceof HttpError && e.status === 404) return null; throw e; });
      return res ? `order ${r.id}: ${res.status}` : `order ${r.id}: not ours`;
    }
    case "PAYMENT.CAPTURE.COMPLETED": {
      const orderId = r.supplementary_data?.related_ids?.order_id;
      if (!orderId) return "no order id";
      const { data: pay } = await db.from("payments").select("plan, months, status").eq("provider_order_id", orderId).maybeSingle();
      if (!pay) return `order ${orderId}: not ours`;
      if (pay.status !== "pending") return `order ${orderId}: already ${pay.status}`;
      const res = await complete(db, orderId, r.id ?? null, Number(r.amount?.value ?? 0), r.amount?.currency_code ?? "", null, pay);
      return `order ${orderId}: ${res.status}`;
    }
    case "PAYMENT.CAPTURE.DENIED": {
      const orderId = r.supplementary_data?.related_ids?.order_id;
      if (orderId) await db.from("payments").update({ status: "failed" }).eq("provider_order_id", orderId).eq("status", "pending");
      return `order ${orderId ?? "?"}: denied`;
    }
    case "PAYMENT.CAPTURE.REFUNDED":
    case "PAYMENT.CAPTURE.REVERSED": {
      // REFUNDED carries the refund; its "up" link points at the capture. REVERSED carries the capture itself.
      const up = r.links?.find((l) => l.rel === "up")?.href ?? "";
      const captureId = event.event_type === "PAYMENT.CAPTURE.REVERSED" ? r.id : up.split("/captures/")[1]?.split(/[/?]/)[0];
      if (!captureId) return "no capture id";
      // The plan is not ended automatically: an admin decides (Admin page > End), since a refund can be partial.
      await db.from("payments").update({ status: "refunded", refunded_at: new Date().toISOString() }).eq("provider_capture_id", captureId);
      return `capture ${captureId}: refunded`;
    }
    default:
      return `ignored ${event.event_type ?? "unknown event"}`;
  }
}
