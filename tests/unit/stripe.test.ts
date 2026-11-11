/** Phase 20: the Stripe adapter against a fake Stripe (no network, no keys). */
import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { formEncode, setStripeFetchForTests, stripeProvider, verifyStripeSignature } from "@/server/payments/stripe";
import { fromCents, toCents, WebhookError } from "@/server/payments/types";

type Call = { url: string; method: string; headers: Record<string, string>; body?: string };
const calls: Call[] = [];
let reply: (c: Call) => unknown = () => ({});
const SECRET = "whsec_test_secret";
const sign = (body: string, t = Math.floor(Date.now() / 1000), secret = SECRET) => `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
const params = (c: Call) => new URLSearchParams(c.body ?? c.url.split("?")[1] ?? "");
const party = { companyId: "co_1", name: "Kebab House", email: "owner@kebab.test", taxId: "PT1", locale: "pt-PT" };

beforeAll(() => {
  process.env.STRIPE_SECRET_KEY = "sk_test_123";
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  setStripeFetchForTests(async (url, init) => { const c = { url, ...init }; calls.push(c); return { status: 200, json: async () => reply(c) }; });
});
afterAll(() => { setStripeFetchForTests(null); delete process.env.STRIPE_SECRET_KEY; delete process.env.STRIPE_WEBHOOK_SECRET; });

describe("money and encoding", () => {
  it("converts euros to cents without floating point", () => {
    expect(toCents("12.3")).toBe(1230);
    expect(toCents("0.07")).toBe(7);
    expect(toCents("1999.99")).toBe(199999);
    expect(fromCents(199999)).toBe("1999.99");
    expect(() => toCents("1.234")).toThrow();
  });
  it("encodes nested params the way Stripe expects", () => {
    expect(formEncode({ a: 1, b: { c: "x y" }, d: ["p", "q"], e: [{ f: 2 }], g: undefined })).toEqual(["a=1", "b%5Bc%5D=x%20y", "d%5B0%5D=p", "d%5B1%5D=q", "e%5B0%5D%5Bf%5D=2"]);
  });
});

describe("webhook signature", () => {
  const body = JSON.stringify({ id: "evt_1" });
  it("accepts a correct signature", () => expect(() => verifyStripeSignature(body, sign(body), SECRET)).not.toThrow());
  it("refuses a tampered body, a wrong secret, an old timestamp or no header", () => {
    expect(() => verifyStripeSignature(body + " ", sign(body), SECRET)).toThrow(WebhookError);
    expect(() => verifyStripeSignature(body, sign(body, undefined, "whsec_other"), SECRET)).toThrow(/Bad Stripe signature/);
    expect(() => verifyStripeSignature(body, sign(body, Math.floor(Date.now() / 1000) - 600), SECRET)).toThrow(/too old/);
    expect(() => verifyStripeSignature(body, null, SECRET)).toThrow(/Missing/);
  });
});

describe("requests to Stripe", () => {
  it("card / MB WAY / Multibanco → a Checkout Session for that one method, idempotent, in the payer's language", async () => {
    calls.length = 0;
    reply = () => ({ id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1", expires_at: Math.floor(Date.now() / 1000) + 3600 });
    const r = await stripeProvider.start({ requestId: "req_1", amount: "141.50", currency: "EUR", method: "MB_WAY", payer: party, description: "FIRINGI FT 2026/1", returnUrl: "https://app/x?return=1", cancelUrl: "https://app/x" });
    expect(r).toMatchObject({ providerRef: "cs_test_1", status: "OPEN", action: { type: "redirect", url: "https://checkout.stripe.com/c/pay/cs_test_1" } });
    const c = calls[0], p = params(c);
    expect(c.url).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect(c.headers.authorization).toBe("Bearer sk_test_123");
    expect(c.headers["idempotency-key"]).toBe("start-req_1-MB_WAY");
    expect(p.get("mode")).toBe("payment");
    expect(p.get("payment_method_types[0]")).toBe("mb_way");
    expect(p.get("line_items[0][price_data][unit_amount]")).toBe("14150");
    expect(p.get("line_items[0][price_data][currency]")).toBe("eur");
    expect(p.get("metadata[requestId]")).toBe("req_1");
    expect(p.get("payment_intent_data[metadata][requestId]")).toBe("req_1");
    expect(p.get("locale")).toBe("pt");
  });

  it("direct debit → off-session PaymentIntent on the saved mandate; statuses mapped", async () => {
    calls.length = 0;
    reply = () => ({ id: "pi_1", status: "processing" });
    const mandate = { customerRef: "cus_1", paymentMethodRef: "pm_1", mandateRef: "mandate_1" };
    const r = await stripeProvider.collect({ requestId: "req_2", amount: "99.00", currency: "EUR", description: "x", mandate, payer: party });
    expect(r).toEqual({ providerRef: "pi_1", status: "PROCESSING", failureReason: null });
    const p = params(calls[0]);
    expect(calls[0].url).toBe("https://api.stripe.com/v1/payment_intents");
    expect([p.get("customer"), p.get("payment_method"), p.get("mandate"), p.get("off_session"), p.get("confirm"), p.get("payment_method_types[0]"), p.get("amount")]).toEqual(["cus_1", "pm_1", "mandate_1", "true", "true", "sepa_debit", "9900"]);
    reply = () => ({ id: "pi_2", status: "requires_payment_method", last_payment_error: { message: "Your bank account has insufficient funds." } });
    expect(await stripeProvider.collect({ requestId: "req_3", amount: "1.00", currency: "EUR", description: "x", mandate, payer: party })).toMatchObject({ status: "FAILED", failureReason: /insufficient/ });
    expect(await stripeProvider.collect({ requestId: "req_4", amount: "1.00", currency: "EUR", description: "x", mandate: { customerRef: null, paymentMethodRef: null, mandateRef: null }, payer: party })).toMatchObject({ status: "FAILED" });
  });

  it("Stripe errors: refused vs. unavailable (retry later)", async () => {
    setStripeFetchForTests(async () => ({ status: 402, json: async () => ({ error: { message: "Your card was declined." } }) }));
    await expect(stripeProvider.refund({ providerPaymentRef: "pi_1", amount: "1.00" })).rejects.toMatchObject({ message: "Your card was declined.", retryable: false });
    setStripeFetchForTests(async () => ({ status: 503, json: async () => ({}) }));
    await expect(stripeProvider.refund({ providerPaymentRef: "pi_1", amount: "1.00" })).rejects.toMatchObject({ retryable: true });
    setStripeFetchForTests(async (url, init) => { const c = { url, ...init }; calls.push(c); return { status: 200, json: async () => reply(c) }; });
  });
});

describe("reading webhooks", () => {
  const event = (type: string, object: Record<string, unknown>) => JSON.stringify({ id: `evt_${type}`, type, data: { object } });
  const parse = (body: string) => stripeProvider.parseWebhook(body, new Headers({ "stripe-signature": sign(body) }));

  it("card / MB WAY checkout paid → succeeded with amount and payment intent", async () => {
    const [e] = await parse(event("checkout.session.completed", { id: "cs_1", mode: "payment", payment_status: "paid", payment_intent: "pi_9", amount_total: 14150, metadata: { requestId: "req_1" } }));
    expect(e).toMatchObject({ kind: "payment.succeeded", requestId: "req_1", providerRef: "cs_1", providerPaymentRef: "pi_9", amount: "141.50" });
  });
  it("Multibanco checkout completed but unpaid → processing; paid later → succeeded; failed → failed; expired", async () => {
    expect((await parse(event("checkout.session.completed", { id: "cs_2", mode: "payment", payment_status: "unpaid", metadata: { requestId: "r" } })))[0].kind).toBe("payment.processing");
    expect((await parse(event("checkout.session.async_payment_succeeded", { id: "cs_2", payment_intent: { id: "pi_2" }, amount_total: 500, metadata: { requestId: "r" } })))[0]).toMatchObject({ kind: "payment.succeeded", providerPaymentRef: "pi_2", amount: "5.00" });
    expect((await parse(event("checkout.session.async_payment_failed", { id: "cs_2", metadata: { requestId: "r" } })))[0].kind).toBe("payment.failed");
    expect((await parse(event("checkout.session.expired", { id: "cs_2", mode: "payment", metadata: { requestId: "r" } })))[0].kind).toBe("payment.expired");
  });
  it("mandate signed in setup mode → active, with the account's last 4 digits from the SetupIntent", async () => {
    reply = (c) => (c.url.includes("/setup_intents/seti_1") ? { id: "seti_1", customer: "cus_1", mandate: "mandate_1", payment_method: { id: "pm_1", sepa_debit: { last4: "3000" }, billing_details: { name: "Karim Kebab" } } } : {});
    const [e] = await parse(event("checkout.session.completed", { id: "cs_3", mode: "setup", setup_intent: "seti_1", customer: "cus_1", metadata: { mandateId: "m_1" } }));
    expect(e).toMatchObject({ kind: "mandate.active", mandateId: "m_1", setupRef: "cs_3", mandate: { customerRef: "cus_1", paymentMethodRef: "pm_1", mandateRef: "mandate_1", holderName: "Karim Kebab", ibanLast4: "3000" } });
    expect(calls.at(-1)!.url).toContain("expand%5B0%5D=payment_method");
  });
  it("direct debit results and anything else", async () => {
    expect((await parse(event("payment_intent.succeeded", { id: "pi_5", amount_received: 9900, metadata: { requestId: "req_2" } })))[0]).toMatchObject({ kind: "payment.succeeded", amount: "99.00", providerPaymentRef: "pi_5" });
    expect((await parse(event("payment_intent.payment_failed", { id: "pi_5", last_payment_error: { message: "insufficient_funds" }, metadata: { requestId: "req_2" } })))[0]).toMatchObject({ kind: "payment.failed", failureReason: "insufficient_funds" });
    expect((await parse(event("mandate.updated", { id: "mandate_1", status: "inactive", payment_method: "pm_1" })))[0].kind).toBe("mandate.revoked");
    expect((await parse(event("customer.created", { id: "cus_9" })))[0].kind).toBe("ignored");
  });
  it("a webhook without a valid signature is refused", async () => {
    const body = event("payment_intent.succeeded", { id: "pi_x" });
    await expect(stripeProvider.parseWebhook(body, new Headers({ "stripe-signature": sign(body, undefined, "whsec_wrong") }))).rejects.toThrow(WebhookError);
  });
});
