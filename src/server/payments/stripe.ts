/**
 * Stripe adapter (https://docs.stripe.com/api) — used when STRIPE_SECRET_KEY is set.
 *
 *  • Card, MB WAY and Multibanco: a Checkout Session (hosted by Stripe, in the payer's language)
 *    for the one method chosen. Card / MB WAY confirm at once; Multibanco shows the reference and
 *    confirms when paid (checkout.session.async_payment_succeeded).
 *  • SEPA direct debit: a Checkout Session in setup mode signs the mandate (FIRINGI keeps the
 *    payment method + mandate id); invoices are then collected with an off-session PaymentIntent
 *    (payment_intent.succeeded / payment_intent.payment_failed a few days later).
 *  • Refunds: POST /v1/refunds on the payment intent.
 *  • Webhooks: "Stripe-Signature: t=…,v1=…" = HMAC-SHA256(secret, "t.body"), 5-minute tolerance.
 *
 * Keys only in the server environment: STRIPE_SECRET_KEY (sk_test_… / sk_live_…) and
 * STRIPE_WEBHOOK_SECRET (whsec_…) for https://<domain>/api/webhooks/payments/stripe.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { CollectInput, PaymentProvider, ProviderEvent, SetupInput, StartInput } from "./types";
import { ProviderError, WebhookError, fromCents, toCents } from "./types";

export type StripeFetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ status: number; json: () => Promise<unknown> }>;
let fetchOverride: StripeFetch | null = null;
/** Tests plug in a fake Stripe here (no network). */
export function setStripeFetchForTests(f: StripeFetch | null) { fetchOverride = f; }

const API = "https://api.stripe.com/v1";
const METHOD_TYPE = { CARD: "card", MB_WAY: "mb_way", MULTIBANCO: "multibanco" } as const;
// Stripe Checkout languages FIRINGI uses (others fall back to "auto").
const LOCALES = new Set(["bg", "cs", "da", "de", "el", "en", "es", "et", "fi", "fr", "hr", "hu", "it", "lt", "lv", "mt", "nb", "nl", "pl", "pt", "ro", "sk", "sl", "sv"]);
const stripeLocale = (l: string) => { const s = l.toLowerCase().split("-")[0]; return LOCALES.has(s) ? s : "auto"; };

/** Stripe's form encoding: nested keys as a[b][c], arrays as a[0]. */
export function formEncode(obj: Record<string, unknown>, prefix = ""): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((x, i) => (typeof x === "object" ? out.push(...formEncode(x as Record<string, unknown>, `${key}[${i}]`)) : out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(x))}`)));
    else if (typeof v === "object") out.push(...formEncode(v as Record<string, unknown>, key));
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return out;
}

async function call<T = Record<string, unknown>>(method: "GET" | "POST", path: string, params?: Record<string, unknown>, idempotencyKey?: string): Promise<T> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new ProviderError("Stripe isn't configured (STRIPE_SECRET_KEY).");
  const body = params ? formEncode(params).join("&") : undefined;
  const url = method === "GET" && body ? `${API}${path}?${body}` : `${API}${path}`;
  const headers: Record<string, string> = { authorization: `Bearer ${key}`, "stripe-version": "2025-03-31.basil" };
  if (method === "POST") headers["content-type"] = "application/x-www-form-urlencoded";
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
  let res: { status: number; json: () => Promise<unknown> };
  try {
    res = fetchOverride ? await fetchOverride(url, { method, headers, body: method === "POST" ? body : undefined })
      : await fetch(url, { method, headers, body: method === "POST" ? body : undefined, signal: AbortSignal.timeout(20_000) }).then((r) => ({ status: r.status, json: () => r.json() }));
  } catch (e) {
    throw new ProviderError(`Stripe unreachable: ${e instanceof Error ? e.message : String(e)}`, true);
  }
  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: string } } & Record<string, unknown>;
  if (res.status >= 500 || res.status === 429) throw new ProviderError(`Stripe is unavailable (HTTP ${res.status}).`, true);
  if (res.status >= 400) throw new ProviderError(json.error?.message ?? `Stripe refused the request (HTTP ${res.status}).`);
  return json as T;
}

export function verifyStripeSignature(rawBody: string, header: string | null, secret: string, now = Date.now()) {
  if (!header) throw new WebhookError("Missing Stripe-Signature");
  const parts = header.split(",").map((p) => p.split("=") as [string, string]);
  const t = parts.find(([k]) => k === "t")?.[1];
  const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!t || !sigs.length) throw new WebhookError("Malformed Stripe-Signature");
  if (Math.abs(now / 1000 - Number(t)) > 300) throw new WebhookError("Stripe-Signature too old");
  const want = Buffer.from(createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex"));
  if (!sigs.some((s) => s.length === want.length && timingSafeEqual(Buffer.from(s), want))) throw new WebhookError("Bad Stripe signature");
}

type Obj = Record<string, unknown> & { id: string; metadata?: Record<string, string> };
const str = (v: unknown) => (typeof v === "string" ? v : v && typeof v === "object" && "id" in v ? String((v as { id: string }).id) : null);

export const stripeProvider: PaymentProvider = {
  key: "stripe",
  label: "Stripe",
  get mode() { return (process.env.STRIPE_SECRET_KEY ?? "").startsWith("sk_live_") ? ("live" as const) : ("test" as const); },
  methods: ["CARD", "MB_WAY", "MULTIBANCO", "DIRECT_DEBIT"],

  async start(input: StartInput) {
    const s = await call<Obj & { url: string; expires_at: number }>("POST", "/checkout/sessions", {
      mode: "payment",
      payment_method_types: [METHOD_TYPE[input.method]],
      line_items: [{ quantity: 1, price_data: { currency: input.currency.toLowerCase(), unit_amount: toCents(input.amount), product_data: { name: input.description.slice(0, 250) } } }],
      customer_email: input.payer.email ?? undefined,
      client_reference_id: input.requestId,
      metadata: { requestId: input.requestId, companyId: input.payer.companyId },
      payment_intent_data: { metadata: { requestId: input.requestId }, description: input.description.slice(0, 250) },
      locale: stripeLocale(input.payer.locale),
      success_url: input.returnUrl,
      cancel_url: input.cancelUrl,
      expires_at: Math.floor(Date.now() / 1000) + 23 * 3600,
    }, `start-${input.requestId}-${input.method}`);
    return { providerRef: s.id, status: "OPEN", action: { type: "redirect", url: s.url }, expiresAt: new Date(s.expires_at * 1000) };
  },

  async setupMandate(input: SetupInput) {
    const customer = await call<Obj>("POST", "/customers", { name: input.payer.name, email: input.payer.email ?? undefined, metadata: { companyId: input.payer.companyId }, preferred_locales: [stripeLocale(input.payer.locale)] }, `cus-${input.mandateId}`);
    const s = await call<Obj & { url: string }>("POST", "/checkout/sessions", {
      mode: "setup", currency: "eur", payment_method_types: ["sepa_debit"], customer: customer.id,
      metadata: { mandateId: input.mandateId }, setup_intent_data: { metadata: { mandateId: input.mandateId } },
      locale: stripeLocale(input.payer.locale), success_url: input.returnUrl, cancel_url: input.cancelUrl,
    }, `setup-${input.mandateId}`);
    return { setupRef: s.id, customerRef: customer.id, action: { type: "redirect", url: s.url } };
  },

  async collect(input: CollectInput) {
    if (!input.mandate.customerRef || !input.mandate.paymentMethodRef) return { providerRef: `none_${input.requestId}`, status: "FAILED", failureReason: "No signed mandate" };
    const pi = await call<Obj & { status: string; last_payment_error?: { message?: string } }>("POST", "/payment_intents", {
      amount: toCents(input.amount), currency: input.currency.toLowerCase(), customer: input.mandate.customerRef, payment_method: input.mandate.paymentMethodRef,
      payment_method_types: ["sepa_debit"], mandate: input.mandate.mandateRef ?? undefined, confirm: true, off_session: true,
      description: input.description.slice(0, 250), metadata: { requestId: input.requestId },
    }, `collect-${input.requestId}`);
    const status = pi.status === "succeeded" ? "PAID" : pi.status === "processing" ? "PROCESSING" : "FAILED";
    return { providerRef: pi.id, status, failureReason: status === "FAILED" ? (pi.last_payment_error?.message ?? pi.status) : null };
  },

  async refund({ providerPaymentRef, amount }) {
    const r = await call<Obj>("POST", "/refunds", { payment_intent: providerPaymentRef, amount: toCents(amount) }, `refund-${providerPaymentRef}-${amount}-${Date.now()}`);
    return { refundRef: r.id };
  },

  async parseWebhook(rawBody, headers) {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) throw new WebhookError("STRIPE_WEBHOOK_SECRET is not set");
    verifyStripeSignature(rawBody, headers.get("stripe-signature"), secret);
    const e = JSON.parse(rawBody) as { id: string; type: string; data: { object: Obj } };
    const o = e.data.object;
    const base = { eventId: e.id, type: e.type, payload: { id: e.id, type: e.type, object: o.id } };
    const md = o.metadata ?? {};
    switch (e.type) {
      case "checkout.session.completed": {
        if (o.mode === "setup") {
          const si = await call<Obj & { payment_method: Obj & { sepa_debit?: { last4?: string }; billing_details?: { name?: string } }; mandate?: string | Obj; customer?: string }>("GET", `/setup_intents/${str(o.setup_intent)}`, { expand: ["payment_method"] });
          return [{ ...base, kind: "mandate.active", mandateId: md.mandateId ?? null, setupRef: o.id,
            mandate: { customerRef: str(si.customer) ?? str(o.customer), paymentMethodRef: str(si.payment_method), mandateRef: str(si.mandate), holderName: si.payment_method?.billing_details?.name ?? null, ibanLast4: si.payment_method?.sepa_debit?.last4 ?? null } }];
        }
        const paid = o.payment_status === "paid";
        return [{ ...base, kind: paid ? "payment.succeeded" : "payment.processing", requestId: md.requestId ?? (o.client_reference_id as string) ?? null, providerRef: o.id, providerPaymentRef: str(o.payment_intent), amount: typeof o.amount_total === "number" ? fromCents(o.amount_total) : null }];
      }
      case "checkout.session.async_payment_succeeded":
        return [{ ...base, kind: "payment.succeeded", requestId: md.requestId ?? null, providerRef: o.id, providerPaymentRef: str(o.payment_intent), amount: typeof o.amount_total === "number" ? fromCents(o.amount_total) : null }];
      case "checkout.session.async_payment_failed":
        return [{ ...base, kind: "payment.failed", requestId: md.requestId ?? null, providerRef: o.id, failureReason: "The payment didn't go through" }];
      case "checkout.session.expired":
        return [{ ...base, kind: o.mode === "setup" ? "mandate.failed" : "payment.expired", requestId: md.requestId ?? null, mandateId: md.mandateId ?? null, setupRef: o.id, providerRef: o.id, failureReason: "Expired" }];
      // Direct debits (and card / MB WAY payment intents behind a checkout, matched by requestId).
      case "payment_intent.succeeded":
        return [{ ...base, kind: "payment.succeeded", requestId: md.requestId ?? null, providerRef: o.id, providerPaymentRef: o.id, amount: typeof o.amount_received === "number" ? fromCents(o.amount_received) : null }];
      case "payment_intent.processing":
        return [{ ...base, kind: "payment.processing", requestId: md.requestId ?? null, providerRef: o.id }];
      case "payment_intent.payment_failed":
        return [{ ...base, kind: "payment.failed", requestId: md.requestId ?? null, providerRef: o.id, failureReason: ((o.last_payment_error as { message?: string } | undefined)?.message) ?? "Payment failed" }];
      case "mandate.updated":
        return o.status === "inactive" ? [{ ...base, kind: "mandate.revoked", mandate: { customerRef: null, paymentMethodRef: str(o.payment_method), mandateRef: o.id, holderName: null, ibanLast4: null } }] : [{ ...base, kind: "ignored" }];
      default:
        return [{ ...base, kind: "ignored" }];
    }
  },

  async check() {
    try {
      const b = await call<{ available?: unknown }>("GET", "/balance");
      return { ok: !!b, detail: `Stripe ${this.mode} mode — connected` };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
  },
};
