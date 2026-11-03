import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { finishCheckout, handleWebhook, startCheckout } from "../src/lib/billing";
import { parseCheckout, paypalStatus, priceFor, publicPaypalConfig, resetPaypalToken, verifyWebhook } from "../src/lib/paypal";
import { fakeFetch, json } from "./helpers";

/** An in-memory payments table and complete_payment(), shaped like the Supabase calls billing.ts makes. */
type Row = Record<string, unknown> & { id: string; status: string };
function fakeDb() {
  const rows: Row[] = [];
  const plans: { uid: string; plan: string; months: number }[] = [];
  const match = (filters: [string, unknown][]) => rows.filter((r) => filters.every(([k, v]) => r[k] === v));
  const db = {
    from: () => ({
      insert: (v: Record<string, unknown>) => {
        const row = { id: `pay_${rows.length + 1}`, status: "pending", ...v } as Row;
        rows.push(row);
        return { select: () => ({ single: async () => ({ data: { id: row.id }, error: null }) }) };
      },
      update: (patch: Record<string, unknown>) => {
        const filters: [string, unknown][] = [];
        const q = {
          eq(k: string, v: unknown) { filters.push([k, v]); return q; },
          then(done: (r: { error: null }) => void) { match(filters).forEach((r) => Object.assign(r, patch)); done({ error: null }); },
        };
        return q;
      },
      select: () => {
        const filters: [string, unknown][] = [];
        const q = {
          eq(k: string, v: unknown) { filters.push([k, v]); return q; },
          maybeSingle: async () => ({ data: match(filters)[0] ?? null, error: null }),
        };
        return q;
      },
    }),
    rpc: async (fn: string, a: { order_id: string; capture_id: string; paid_amount: number; paid_currency: string; payer: string | null }) => {
      expect(fn).toBe("complete_payment");
      const p = rows.find((r) => r.provider_order_id === a.order_id);
      if (!p) return { data: null, error: { message: "Unknown order" } };
      if (p.status !== "pending") return { data: false, error: null };
      if (a.paid_amount < Number(p.amount) || a.paid_currency !== p.currency) return { data: null, error: { message: "amount mismatch" } };
      Object.assign(p, { status: "paid", provider_capture_id: a.capture_id, payer_email: a.payer });
      plans.push({ uid: String(p.user_id), plan: String(p.plan), months: Number(p.months) });
      return { data: true, error: null };
    },
  };
  return { db: db as unknown as SupabaseClient, rows, plans };
}

/** A stand-in for PayPal's REST API. */
function fakePaypal(opts: { captureStatus?: string; amount?: string; verify?: string } = {}) {
  const bodies: Record<string, unknown>[] = [];
  let reference = "";
  return {
    bodies,
    ...fakeFetch(async (url, init) => {
      const body = init?.body && typeof init.body === "string" && init.body.startsWith("{") ? JSON.parse(init.body) : {};
      bodies.push({ url, ...body });
      if (url.endsWith("/v1/oauth2/token")) return json({ access_token: "A21", expires_in: 32400 });
      if (url.endsWith("/v2/checkout/orders")) {
        reference = body.purchase_units[0].custom_id;
        return json({ id: "ORDER123", status: "PAYER_ACTION_REQUIRED", links: [{ rel: "payer-action", href: "https://www.sandbox.paypal.com/checkoutnow?token=ORDER123" }] }, 201);
      }
      if (url.endsWith("/v2/checkout/orders/ORDER123/capture")) {
        return json({ id: "ORDER123", status: "COMPLETED", payer: { email_address: "buyer@example.com" }, purchase_units: [{ payments: { captures: [
          { id: "CAP9", status: opts.captureStatus ?? "COMPLETED", custom_id: reference, amount: { value: opts.amount ?? "423.00", currency_code: "USD" } },
        ] } }] }, 201);
      }
      if (url.endsWith("/v1/notifications/verify-webhook-signature")) return json({ verification_status: opts.verify ?? "SUCCESS" });
      return json({ message: "not found" }, 404);
    }),
  };
}

const ENV = { PAYPAL_CLIENT_ID: "client", PAYPAL_CLIENT_SECRET: "secret", PAYPAL_PRICE_BASIC: "141", PAYPAL_PRICE_PREMIUM: "199", PAYPAL_WEBHOOK_ID: "WH-1" };
let saved: Record<string, string | undefined> = {};
beforeEach(() => {
  saved = Object.fromEntries(Object.keys({ ...ENV, PAYPAL_ENV: "", PAYPAL_CURRENCY: "" }).map((k) => [k, process.env[k]]));
  Object.assign(process.env, ENV);
  delete process.env.PAYPAL_ENV;
  delete process.env.PAYPAL_CURRENCY;
  resetPaypalToken();
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
});

describe("PayPal prices and choices", () => {
  it("prices months from the monthly price, in USD by default", () => {
    expect(priceFor("basic", 3)).toBe("423.00");
    expect(priceFor("premium", 12)).toBe("2388.00");
    const cfg = publicPaypalConfig()!;
    expect(cfg).toMatchObject({ clientId: "client", currency: "USD", live: false, months: [1, 3, 12] });
    expect(JSON.stringify(cfg)).not.toContain("secret");
  });

  it("only accepts a paid plan and 1, 3 or 12 months", () => {
    expect(parseCheckout({ plan: "premium", months: 3 })).toEqual({ plan: "premium", months: 3 });
    expect(() => parseCheckout({ plan: "free", months: 1 })).toThrow(/Basic or Premium/);
    expect(() => parseCheckout({ plan: "basic", months: 2 })).toThrow(/1, 3 or 12/);
  });

  it("is off without credentials, and reports the sandbox in health", async () => {
    delete process.env.PAYPAL_CLIENT_SECRET;
    expect(publicPaypalConfig()).toBeNull();
    expect(await paypalStatus(fakePaypal().fetch)).toBe("PAYPAL_CLIENT_SECRET is missing");
    process.env.PAYPAL_CLIENT_SECRET = "secret";
    const pp = fakePaypal();
    expect(await paypalStatus(pp.fetch)).toMatch(/^ok \(sandbox, basic 141 USD, premium 199 USD, webhook on\)$/);
    expect(pp.calls[0]).toBe("https://api-m.sandbox.paypal.com/v1/oauth2/token");
  });
});

describe("PayPal checkout", () => {
  it("opens an order, captures it and extends the plan once", async () => {
    const { db, rows, plans } = fakeDb();
    const pp = fakePaypal();
    const start = await startCheckout(db, pp.fetch, { userId: "user_1", plan: "basic", months: 3, site: "https://masar.test" });
    expect(start).toMatchObject({ orderId: "ORDER123", approveUrl: expect.stringContaining("token=ORDER123") });
    expect(rows[0]).toMatchObject({ user_id: "user_1", plan: "basic", months: 3, amount: "423.00", currency: "USD", provider_order_id: "ORDER123", status: "pending" });
    const order = pp.bodies.find((b) => String(b.url).endsWith("/v2/checkout/orders")) as { purchase_units: { custom_id: string; amount: { value: string } }[] };
    expect(order.purchase_units[0]).toMatchObject({ custom_id: rows[0].id, amount: { value: "423.00" } });

    // Someone else can't finish this member's order.
    await expect(finishCheckout(db, pp.fetch, "ORDER123", "user_2")).rejects.toThrow(/could not find/);

    expect(await finishCheckout(db, pp.fetch, "ORDER123", "user_1")).toEqual({ status: "paid", plan: "basic", months: 3 });
    expect(rows[0]).toMatchObject({ status: "paid", provider_capture_id: "CAP9", payer_email: "buyer@example.com" });
    // The webhook arriving after the page finished it changes nothing.
    await handleWebhook(db, pp.fetch, { event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { id: "CAP9", amount: { value: "423.00", currency_code: "USD" }, supplementary_data: { related_ids: { order_id: "ORDER123" } } } });
    expect(await finishCheckout(db, pp.fetch, "ORDER123", "user_1")).toMatchObject({ status: "already_paid" });
    expect(plans).toEqual([{ uid: "user_1", plan: "basic", months: 3 }]);
  });

  it("does not give the plan when less was paid than the order", async () => {
    const { db, plans } = fakeDb();
    const pp = fakePaypal({ amount: "1.00" });
    await startCheckout(db, pp.fetch, { userId: "user_1", plan: "basic", months: 3, site: "https://masar.test" });
    await expect(finishCheckout(db, pp.fetch, "ORDER123", "user_1")).rejects.toThrow(/could not update your plan/);
    expect(plans).toEqual([]);
  });

  it("waits for the webhook when PayPal holds the capture", async () => {
    const { db, rows, plans } = fakeDb();
    const pp = fakePaypal({ captureStatus: "PENDING" });
    await startCheckout(db, pp.fetch, { userId: "user_1", plan: "premium", months: 1, site: "https://masar.test" });
    expect(await finishCheckout(db, pp.fetch, "ORDER123", "user_1")).toMatchObject({ status: "pending" });
    expect(plans).toEqual([]);
    const note = await handleWebhook(db, pp.fetch, { event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { id: "CAP9", amount: { value: "199.00", currency_code: "USD" }, supplementary_data: { related_ids: { order_id: "ORDER123" } } } });
    expect(note).toBe("order ORDER123: paid");
    expect(rows[0].status).toBe("paid");
    expect(plans).toEqual([{ uid: "user_1", plan: "premium", months: 1 }]);
  });

  it("marks a refunded capture", async () => {
    const { db, rows } = fakeDb();
    const pp = fakePaypal();
    await startCheckout(db, pp.fetch, { userId: "user_1", plan: "basic", months: 1, site: "https://masar.test" });
    await finishCheckout(db, pp.fetch, "ORDER123", "user_1");
    await handleWebhook(db, pp.fetch, { event_type: "PAYMENT.CAPTURE.REFUNDED", resource: { id: "REF1", links: [{ rel: "up", href: "https://api-m.sandbox.paypal.com/v2/payments/captures/CAP9" }] } });
    expect(rows[0].status).toBe("refunded");
  });

  it("only trusts webhooks PayPal confirms", async () => {
    const h = new Headers({ "paypal-transmission-id": "t1" });
    expect(await verifyWebhook(fakePaypal().fetch, h, { id: "WH" })).toBe(true);
    expect(await verifyWebhook(fakePaypal({ verify: "FAILURE" }).fetch, h, { id: "WH" })).toBe(false);
    delete process.env.PAYPAL_WEBHOOK_ID;
    expect(await verifyWebhook(fakePaypal().fetch, h, { id: "WH" })).toBe(false);
  });
});
