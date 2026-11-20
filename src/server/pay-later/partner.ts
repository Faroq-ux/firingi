/**
 * Pay later partners (Phase 50): a payment gateway's / B2B financing partner's "buy now, pay later". The partner
 * checks the buyer, approves an order amount, pays FIRINGI when the invoice is issued and collects from the buyer
 * on the chosen schedule. A real gateway plugs in here with its API key; the simulated one is used in tests.
 */
import "server-only";

export type PartnerDecision = { approved: boolean; ref?: string; limit?: number; reason?: string };
export interface PayLaterPartner {
  key: string;
  label: string;
  /** may this buyer pay this amount later? */
  authorize(i: { companyId: string; taxId: string | null; country: string; orderIds: string[]; amount: number; termLabel: string }): Promise<PartnerDecision>;
  /** the invoice is issued: the partner pays FIRINGI (returns what it paid) */
  capture(i: { ref: string; invoiceNumber: string; amount: number }): Promise<{ paid: number; reference: string }>;
  cancel(ref: string): Promise<void>;
}

/** Simulated partner: approves known businesses up to a limit (env PAYLATER_SIM_LIMIT, default 25 000 €). */
const sim: PayLaterPartner = {
  key: "sim",
  label: "Simulated pay-later partner",
  async authorize(i) {
    const limit = Number(process.env.PAYLATER_SIM_LIMIT ?? 25000);
    if (!i.taxId) return { approved: false, reason: "No tax number to check.", limit: 0 };
    if (i.amount > limit) return { approved: false, reason: `Above the partner's limit (${limit} €).`, limit };
    return { approved: true, ref: `SIM-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`, limit };
  },
  async capture(i) { return { paid: i.amount, reference: `${i.ref}/${i.invoiceNumber}` }; },
  async cancel() {},
};

export function activePartner(): PayLaterPartner | null {
  const k = process.env.PAYLATER_PARTNER ?? (process.env.PAYLATER_SIMULATE === "1" || process.env.PAYMENTS_SIMULATE === "1" ? "sim" : "");
  return k === "sim" ? sim : null;
}
