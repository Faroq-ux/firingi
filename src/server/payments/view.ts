/** Shape a payment request for the pay pages (no internal ids beyond what the page needs). */
import "server-only";
import type { PayRequestView } from "@/components/payments/pay-panel";
import { availableMethods, requestForPayer } from "./service";
import { paymentInstructions } from "@/server/services/payments";

export async function payPageData(by: Parameters<typeof requestForPayer>[0]) {
  const r = await requestForPayer(by);
  const [m, bank] = await Promise.all([availableMethods(r.companyId), paymentInstructions(r.company.countryId)]);
  const view: PayRequestView = {
    id: r.id, token: r.token, amount: r.amount.toFixed(2), status: r.status, method: (r.method as PayRequestView["method"]) ?? null,
    action: (r.action as PayRequestView["action"]) ?? null, failureReason: r.failureReason, paidAmount: r.paidAmount?.toFixed(2) ?? null,
    docs: r.items.map((i) => ({ number: i.invoice.providerNumber ?? i.invoice.fullNumber ?? "?", amount: i.amount.toFixed(2) })),
    orderNumber: r.order?.number ?? null, company: r.company.tradeName ?? r.company.legalName,
  };
  return { view, methods: m.methods, mandateLast4: m.mandate?.ibanLast4 ?? null, providerLabel: m.provider ? (m.provider.mode === "simulated" ? "FIRINGI (simulated)" : m.provider.label) : null, bankTransfer: bank.bankTransfer, orderId: r.order?.id ?? null };
}
