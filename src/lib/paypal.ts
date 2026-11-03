import { HttpError } from "./server";

/**
 * PayPal checkout for Basic and Premium (Orders API v2, server-side create and capture).
 * A member pays for 1, 3 or 12 months up front; there is no automatic renewal.
 * Off until PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are set. PAYPAL_ENV=live switches from the sandbox.
 * Uses fetch only (no PayPal SDK on the server). Every function takes `fetchImpl` so tests never hit PayPal.
 */

export type PaidPlan = "basic" | "premium";
export const PLAN_KEYS: PaidPlan[] = ["basic", "premium"];
export const MONTH_CHOICES = [1, 3, 12] as const;

const env = (name: string) => process.env[name]?.trim() ?? "";

export const paypalEnabled = () => !!(env("PAYPAL_CLIENT_ID") && env("PAYPAL_CLIENT_SECRET"));
export const paypalLive = () => env("PAYPAL_ENV").toLowerCase() === "live";
export const paypalApi = () => (paypalLive() ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com");

/** PayPal can't take SAR or JOD, so prices are in a currency PayPal settles (USD by default). */
export const paypalCurrency = () => (env("PAYPAL_CURRENCY") || "USD").toUpperCase();

/** The monthly price of each plan, from PAYPAL_PRICE_BASIC / PAYPAL_PRICE_PREMIUM. */
export function monthlyPrice(plan: PaidPlan): number {
  const raw = env(plan === "basic" ? "PAYPAL_PRICE_BASIC" : "PAYPAL_PRICE_PREMIUM");
  const n = Number(raw || (plan === "basic" ? "141" : "199"));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
}

/** What `months` of `plan` costs, as PayPal wants it ("423.00"). */
export const priceFor = (plan: PaidPlan, months: number) => (monthlyPrice(plan) * months).toFixed(2);

/** The plans and prices the checkout page shows. Only the public client id goes to the browser. */
export function publicPaypalConfig() {
  if (!paypalEnabled()) return null;
  return {
    clientId: env("PAYPAL_CLIENT_ID"),
    currency: paypalCurrency(),
    live: paypalLive(),
    plans: PLAN_KEYS.map((plan) => ({ plan, monthly: monthlyPrice(plan) })),
    months: [...MONTH_CHOICES],
  };
}

export function parseCheckout(body: unknown): { plan: PaidPlan; months: number } {
  const b = (body ?? {}) as { plan?: unknown; months?: unknown };
  const plan = PLAN_KEYS.find((p) => p === b.plan);
  const months = Number(b.months);
  if (!plan) throw new HttpError(400, "Choose Basic or Premium.");
  if (!(MONTH_CHOICES as readonly number[]).includes(months)) throw new HttpError(400, "Choose 1, 3 or 12 months.");
  if (!monthlyPrice(plan)) throw new HttpError(503, "This plan has no price set yet.");
  return { plan, months };
}

// ---------- PayPal REST calls ----------

class PaypalError extends HttpError {
  constructor(status: number, message: string, public issue = "") { super(status, message); }
}

let cached: { token: string; until: number; key: string } | null = null;

async function accessToken(fetchImpl: typeof fetch): Promise<string> {
  if (!paypalEnabled()) throw new HttpError(503, "PayPal is not switched on yet.");
  const key = `${paypalApi()}|${env("PAYPAL_CLIENT_ID")}`;
  if (cached && cached.key === key && cached.until > Date.now()) return cached.token;
  const basic = Buffer.from(`${env("PAYPAL_CLIENT_ID")}:${env("PAYPAL_CLIENT_SECRET")}`).toString("base64");
  const res = await fetchImpl(`${paypalApi()}/v1/oauth2/token`, {
    method: "POST",
    headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !data.access_token) {
    throw new HttpError(502, res.status === 401 ? "PayPal rejected the client id or secret." : `PayPal sign-in failed: ${data.error_description ?? res.status}`);
  }
  cached = { token: data.access_token, key, until: Date.now() + Math.max(60, (data.expires_in ?? 300) - 120) * 1000 };
  return cached.token;
}

/** Test helper: forget the cached PayPal token. */
export const resetPaypalToken = () => { cached = null; };

async function call<T>(fetchImpl: typeof fetch, method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<T> {
  const token = await accessToken(fetchImpl);
  const res = await fetchImpl(`${paypalApi()}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json", ...extra },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await res.json().catch(() => ({}))) as T & { message?: string; details?: { issue?: string; description?: string }[] };
  if (!res.ok) {
    const issue = data.details?.[0]?.issue ?? "";
    throw new PaypalError(issue === "INSTRUMENT_DECLINED" ? 402 : 502, issue === "INSTRUMENT_DECLINED"
      ? "PayPal declined this payment method. Try another card or account."
      : `PayPal error: ${data.details?.[0]?.description ?? data.message ?? res.status}`, issue);
  }
  return data;
}

export interface CreatedOrder { id: string; status: string; links?: { rel: string; href: string }[] }

/** Opens a PayPal order for `months` of `plan`. `reference` is our payment row id (kept as custom_id). */
export function createOrder(fetchImpl: typeof fetch, o: { plan: PaidPlan; months: number; reference: string; returnUrl: string; cancelUrl: string }) {
  const name = `Masar ${o.plan === "basic" ? "Basic" : "Premium"} · ${o.months} ${o.months === 1 ? "month" : "months"}`;
  const value = priceFor(o.plan, o.months);
  return call<CreatedOrder>(fetchImpl, "POST", "/v2/checkout/orders", {
    intent: "CAPTURE",
    purchase_units: [{
      reference_id: o.plan,
      custom_id: o.reference,
      description: name,
      amount: { currency_code: paypalCurrency(), value, breakdown: { item_total: { currency_code: paypalCurrency(), value } } },
      items: [{ name, quantity: "1", category: "DIGITAL_GOODS", unit_amount: { currency_code: paypalCurrency(), value } }],
    }],
    payment_source: { paypal: { experience_context: {
      brand_name: "Masar", shipping_preference: "NO_SHIPPING", user_action: "PAY_NOW",
      return_url: o.returnUrl, cancel_url: o.cancelUrl,
    } } },
  }, { "PayPal-Request-Id": `masar-order-${o.reference}` });
}

export interface Capture {
  orderId: string;
  status: string;
  captureId: string | null;
  amount: number;
  currency: string;
  payerEmail: string | null;
  reference: string | null;
}

interface OrderBody {
  id: string; status: string;
  payer?: { email_address?: string };
  purchase_units?: { custom_id?: string; payments?: { captures?: { id: string; status: string; custom_id?: string; amount: { value: string; currency_code: string } }[] } }[];
}

const toCapture = (o: OrderBody): Capture => {
  const unit = o.purchase_units?.[0];
  const cap = unit?.payments?.captures?.[0];
  return {
    orderId: o.id,
    status: cap?.status ?? o.status,
    captureId: cap?.id ?? null,
    amount: Number(cap?.amount.value ?? 0),
    currency: cap?.amount.currency_code ?? "",
    payerEmail: o.payer?.email_address ?? null,
    reference: cap?.custom_id ?? unit?.custom_id ?? null,
  };
};

/** Takes the money for an approved order. Capturing twice is safe: PayPal returns the first capture. */
export async function captureOrder(fetchImpl: typeof fetch, orderId: string): Promise<Capture> {
  if (!/^[A-Z0-9-]{5,40}$/i.test(orderId)) throw new HttpError(400, "That is not a PayPal order.");
  try {
    return toCapture(await call<OrderBody>(fetchImpl, "POST", `/v2/checkout/orders/${orderId}/capture`, {}, { "PayPal-Request-Id": `masar-capture-${orderId}` }));
  } catch (e) {
    // ORDER_ALREADY_CAPTURED and similar: read the order instead.
    if (e instanceof PaypalError && e.issue === "INSTRUMENT_DECLINED") throw e;
    const o = await call<OrderBody>(fetchImpl, "GET", `/v2/checkout/orders/${orderId}`).catch(() => null);
    if (o?.status === "COMPLETED") return toCapture(o);
    throw e;
  }
}

/** Checks a webhook really came from PayPal (needs PAYPAL_WEBHOOK_ID from the PayPal developer dashboard). */
export async function verifyWebhook(fetchImpl: typeof fetch, headers: Headers, event: unknown): Promise<boolean> {
  const webhookId = env("PAYPAL_WEBHOOK_ID");
  if (!webhookId) return false;
  const h = (n: string) => headers.get(n) ?? "";
  const r = await call<{ verification_status?: string }>(fetchImpl, "POST", "/v1/notifications/verify-webhook-signature", {
    auth_algo: h("paypal-auth-algo"),
    cert_url: h("paypal-cert-url"),
    transmission_id: h("paypal-transmission-id"),
    transmission_sig: h("paypal-transmission-sig"),
    transmission_time: h("paypal-transmission-time"),
    webhook_id: webhookId,
    webhook_event: event,
  }).catch(() => ({ verification_status: "FAILURE" }));
  return r.verification_status === "SUCCESS";
}

/** One line for /api/health. */
export async function paypalStatus(fetchImpl: typeof fetch = fetch): Promise<string> {
  if (!env("PAYPAL_CLIENT_ID") && !env("PAYPAL_CLIENT_SECRET")) return "missing (checkout is off)";
  if (!paypalEnabled()) return env("PAYPAL_CLIENT_ID") ? "PAYPAL_CLIENT_SECRET is missing" : "PAYPAL_CLIENT_ID is missing";
  const mode = paypalLive() ? "live" : "sandbox";
  const prices = PLAN_KEYS.map((p) => `${p} ${monthlyPrice(p) || "no price"} ${paypalCurrency()}`).join(", ");
  try {
    await accessToken(fetchImpl);
  } catch (e) {
    return `${mode}: ${e instanceof Error ? e.message : e}`;
  }
  const hook = env("PAYPAL_WEBHOOK_ID") ? "webhook on" : "PAYPAL_WEBHOOK_ID missing (payments still work from the checkout page)";
  return `ok (${mode}, ${prices}, ${hook})`;
}
