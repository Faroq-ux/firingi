/**
 * Payment providers behind one interface, so FIRINGI can use Stripe today and a Portuguese
 * provider (ifthenpay, Easypay, SIBS…) later without touching the rest of the app.
 */
export type OnlineMethod = "CARD" | "MB_WAY" | "MULTIBANCO" | "DIRECT_DEBIT";
export const ONLINE_METHODS: OnlineMethod[] = ["CARD", "MB_WAY", "MULTIBANCO", "DIRECT_DEBIT"];

/** What the payer has to do after a payment is started. */
export type PayAction =
  | { type: "redirect"; url: string }
  | { type: "multibanco"; entity: string; reference: string; amount: string; expiresAt: string }
  | { type: "mbway"; phone: string; expiresAt: string }
  | { type: "none" };

export type Party = { companyId: string; name: string; email: string | null; taxId: string | null; locale: string };

export type StartInput = {
  requestId: string; amount: string; currency: string; method: Exclude<OnlineMethod, "DIRECT_DEBIT">;
  payer: Party; description: string; returnUrl: string; cancelUrl: string; phone?: string | null;
};
export type StartResult = { providerRef: string; status: "OPEN" | "PROCESSING"; action: PayAction; expiresAt?: Date };

export type MandateRefs = { customerRef: string | null; paymentMethodRef: string | null; mandateRef: string | null };
export type SetupInput = { mandateId: string; payer: Party; returnUrl: string; cancelUrl: string };
export type SetupResult = { setupRef: string; customerRef: string | null; action: PayAction };
export type CollectInput = { requestId: string; amount: string; currency: string; description: string; mandate: MandateRefs; payer: Party };
export type CollectResult = { providerRef: string; status: "PROCESSING" | "PAID" | "FAILED"; failureReason?: string | null };

/** A provider notification, normalised. */
export type ProviderEvent = {
  eventId: string;
  type: string; // the provider's own type, for the log
  kind: "payment.succeeded" | "payment.processing" | "payment.failed" | "payment.expired" | "mandate.active" | "mandate.failed" | "mandate.revoked" | "ignored";
  requestId?: string | null;
  providerRef?: string | null;
  providerPaymentRef?: string | null;
  amount?: string | null;
  failureReason?: string | null;
  mandateId?: string | null;
  setupRef?: string | null;
  mandate?: MandateRefs & { holderName: string | null; ibanLast4: string | null };
  payload: unknown;
};

/** What polling needs to know about an attempt (providers without webhooks, and the simulator). */
export type PollInput = { requestId: string; providerRef: string; method: OnlineMethod; createdAt: Date; updatedAt: Date; action: PayAction | null; ibanLast4?: string | null };

export interface PaymentProvider {
  key: "sim" | "stripe";
  label: string;
  mode: "simulated" | "test" | "live";
  methods: OnlineMethod[];
  start(input: StartInput): Promise<StartResult>;
  setupMandate(input: SetupInput): Promise<SetupResult>;
  collect(input: CollectInput): Promise<CollectResult>;
  refund(input: { providerPaymentRef: string; amount: string }): Promise<{ refundRef: string }>;
  /** Verify and read a webhook call (throws WebhookError when the signature is wrong). */
  parseWebhook(rawBody: string, headers: Headers): Promise<ProviderEvent[]>;
  /** Optional: ask the provider for news about an attempt (no webhook). */
  poll?(input: PollInput): Promise<ProviderEvent[]>;
  /** Is the provider configured and reachable? */
  check(): Promise<{ ok: boolean; detail: string }>;
}

export class WebhookError extends Error {}
export class ProviderError extends Error {
  constructor(message: string, readonly retryable = false) { super(message); }
}

/** "12.30" → 1230 (cents), never via floating point. */
export function toCents(amount: string): number {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(amount.trim());
  if (!m) throw new Error(`Bad amount ${amount}`);
  return Number(m[1]) * 100 + Number((m[2] ?? "0").padEnd(2, "0"));
}
export const fromCents = (c: number) => `${Math.trunc(c / 100)}.${String(Math.abs(c % 100)).padStart(2, "0")}`;
