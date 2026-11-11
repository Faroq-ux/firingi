/**
 * Simulated payment provider (PAYMENTS_SIMULATE=1) — development, demos and tests. No money
 * moves. It behaves like a real provider: card payments go through a hosted checkout page
 * (/pay/sim/…, approve or decline), MB WAY is approved on "the phone" a few seconds later
 * (numbers ending in 000 decline), Multibanco references are paid from the back office, SEPA
 * mandates are signed on a hosted page and direct debits settle a little later (IBANs ending in
 * 0000 bounce: insufficient funds). Every outcome arrives as a signed webhook, like the real thing.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { CollectInput, PaymentProvider, PollInput, ProviderEvent, SetupInput, StartInput } from "./types";
import { ProviderError, WebhookError } from "./types";

const rid = (p: string) => `${p}_${randomBytes(9).toString("base64url")}`;
export const simSecret = () => process.env.PAYMENTS_SIM_SECRET || createHash("sha256").update(`firingi-sim|${process.env.BETTER_AUTH_SECRET ?? "dev"}`).digest("hex");

/** Sign a simulated webhook body the way the provider would. */
export function simSign(body: string, at = Math.floor(Date.now() / 1000)) {
  return `t=${at},v1=${createHmac("sha256", simSecret()).update(`${at}.${body}`).digest("hex")}`;
}

export const MB_WAY_APPROVAL_MS = 4000;
export const DEBIT_SETTLE_MS = 3000;
const MULTIBANCO_ENTITY = "11249";

/** A simulated provider event body (what /api/webhooks/payments/sim receives). */
export function simEvent(kind: ProviderEvent["kind"], data: Omit<ProviderEvent, "eventId" | "type" | "kind" | "payload">) {
  return JSON.stringify({ id: rid("evt"), type: `sim.${kind}`, kind, data });
}

function reference(seed: string) {
  const n = BigInt(`0x${createHash("sha256").update(seed).digest("hex").slice(0, 12)}`) % 1_000_000_000n;
  return n.toString().padStart(9, "0").replace(/(\d{3})(\d{3})(\d{3})/, "$1 $2 $3");
}

export const simProvider: PaymentProvider = {
  key: "sim",
  label: "Simulated provider",
  mode: "simulated",
  methods: ["CARD", "MB_WAY", "MULTIBANCO", "DIRECT_DEBIT"],

  async start(input: StartInput) {
    if (input.method === "CARD") {
      const ref = rid("sim_cs");
      return { providerRef: ref, status: "OPEN", action: { type: "redirect", url: `/pay/sim/${ref}` } };
    }
    if (input.method === "MB_WAY") {
      const phone = (input.phone ?? "").replace(/[\s-]/g, "");
      if (!/^(\+?351)?9\d{8}$/.test(phone)) throw new ProviderError("Enter a Portuguese mobile number (9 digits, starting with 9).");
      const expiresAt = new Date(Date.now() + 4 * 60_000);
      return { providerRef: rid("sim_mbw"), status: "PROCESSING", action: { type: "mbway", phone: phone.replace(/^\+?351/, ""), expiresAt: expiresAt.toISOString() }, expiresAt };
    }
    const expiresAt = new Date(Date.now() + 3 * 86400_000);
    const ref = rid("sim_mb");
    return { providerRef: ref, status: "PROCESSING", action: { type: "multibanco", entity: MULTIBANCO_ENTITY, reference: reference(ref), amount: input.amount, expiresAt: expiresAt.toISOString() }, expiresAt };
  },

  async setupMandate(input: SetupInput) {
    const setupRef = rid("sim_seti");
    return { setupRef, customerRef: `sim_cus_${input.payer.companyId.slice(-10)}`, action: { type: "redirect", url: `/pay/sim/mandate/${setupRef}` } };
  },

  async collect(input: CollectInput) {
    if (!input.mandate.paymentMethodRef) return { providerRef: rid("sim_pi"), status: "FAILED", failureReason: "No signed mandate" };
    return { providerRef: rid("sim_pi"), status: "PROCESSING" };
  },

  async refund() {
    return { refundRef: rid("sim_re") };
  },

  async parseWebhook(rawBody, headers) {
    const sig = headers.get("x-sim-signature") ?? "";
    const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(sig);
    if (!m) throw new WebhookError("Missing signature");
    if (Math.abs(Date.now() / 1000 - Number(m[1])) > 300) throw new WebhookError("Signature too old");
    const want = Buffer.from(createHmac("sha256", simSecret()).update(`${m[1]}.${rawBody}`).digest("hex"));
    if (!timingSafeEqual(want, Buffer.from(m[2]))) throw new WebhookError("Bad signature");
    const e = JSON.parse(rawBody) as { id: string; type: string; kind: ProviderEvent["kind"]; data: Partial<ProviderEvent> };
    return [{ ...e.data, eventId: e.id, type: e.type, kind: e.kind, payload: e }];
  },

  /** MB WAY is approved "on the phone" after a few seconds; direct debits settle a bit later. */
  async poll(input: PollInput) {
    const age = Date.now() - input.updatedAt.getTime();
    const base = { requestId: input.requestId, providerRef: input.providerRef, payload: { simulated: true } };
    if (input.method === "MB_WAY" && input.action?.type === "mbway") {
      if (age < MB_WAY_APPROVAL_MS) return [];
      if (input.action.phone.endsWith("000")) return [{ ...base, eventId: `poll_${input.providerRef}_f`, type: "sim.poll", kind: "payment.failed", failureReason: "Declined in the MB WAY app" }];
      return [{ ...base, eventId: `poll_${input.providerRef}_s`, type: "sim.poll", kind: "payment.succeeded", providerPaymentRef: `${input.providerRef}_paid` }];
    }
    if (input.method === "DIRECT_DEBIT") {
      if (age < DEBIT_SETTLE_MS) return [];
      if (input.ibanLast4 === "0000") return [{ ...base, eventId: `poll_${input.providerRef}_f`, type: "sim.poll", kind: "payment.failed", failureReason: "Direct debit returned by the bank: insufficient funds (AM04)" }];
      return [{ ...base, eventId: `poll_${input.providerRef}_s`, type: "sim.poll", kind: "payment.succeeded", providerPaymentRef: input.providerRef }];
    }
    return [];
  },

  async check() {
    return { ok: true, detail: "Simulated provider — no real money moves" };
  },
};
