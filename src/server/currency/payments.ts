import "server-only";
/**
 * Phase 45: payments in the customer's / supplier's currency.
 *
 * The money that moves is in the document's currency (Payment.amountLocal); what it clears is booked in EUR at
 * the document's own rate (Payment.amount and the allocations), so balances, credit and reports keep working in
 * EUR. The difference with the money's EUR value on the day (reference rate) is the realised exchange gain or
 * loss, kept in FxEntry (P&L, accounting export) when FIRINGI books FX.
 */
import Decimal from "decimal.js";
import type { PaymentMethod } from "@prisma/client";
import type { Tx } from "@/server/db";
import { fxGainLoss, roundMoney } from "@/lib/currency";
import { currencySettings, midRate } from "./service";

const D = (v: { toString(): string } | number | string | null | undefined) => new Decimal((v ?? 0).toString());
const ZERO = new Decimal(0);

/** Local units per € of a document (from its own totals; its locked rate when the totals are 0). */
export const docRatio = (d: { grossEur: unknown; grossLocal: unknown; eurRate?: unknown }) =>
  d.grossLocal != null && !D(d.grossEur as string).isZero() ? D(d.grossLocal as string).div(D(d.grossEur as string)) : D((d.eurRate ?? 1) as string);

/** Currency and ratio of sales invoices (null = EUR). */
export async function invoiceRatios(tx: Tx, ids: string[]) {
  const rows = await tx.invoice.findMany({ where: { id: { in: ids } }, select: { id: true, currencyCode: true, grossTotal: true, grossTotalLocal: true, eurRate: true } });
  return new Map(rows.map((r) => [r.id, { code: r.currencyCode, ratio: r.currencyCode === "EUR" ? null : docRatio({ grossEur: r.grossTotal, grossLocal: r.grossTotalLocal, eurRate: r.eurRate }) }]));
}

/** What a payment request charges in the documents' currency (one currency per request). */
export async function requestCurrency(tx: Tx, src: { orderId?: string; amountEur: Decimal; items?: { invoiceId: string; amount: Decimal }[] }) {
  if (src.orderId) {
    const o = await tx.order.findUniqueOrThrow({ where: { id: src.orderId }, select: { currencyCode: true, grandTotal: true, grandTotalLocal: true, eurRate: true } });
    if (o.currencyCode === "EUR") return { currencyCode: "EUR", amountLocal: null };
    const ratio = docRatio({ grossEur: o.grandTotal, grossLocal: o.grandTotalLocal, eurRate: o.eurRate });
    return { currencyCode: o.currencyCode, amountLocal: roundMoney(src.amountEur.mul(ratio), o.currencyCode).toString() };
  }
  const items = src.items ?? [];
  const ratios = await invoiceRatios(tx, items.map((i) => i.invoiceId));
  const codes = [...new Set(items.map((i) => ratios.get(i.invoiceId)?.code ?? "EUR"))];
  if (codes.length > 1) throw Object.assign(new Error("MIXED_CURRENCIES"), { codes });
  const code = codes[0] ?? "EUR";
  if (code === "EUR") return { currencyCode: "EUR", amountLocal: null };
  const local = items.reduce((a, i) => a.plus(roundMoney(i.amount.mul(ratios.get(i.invoiceId)!.ratio!), code)), ZERO);
  return { currencyCode: code, amountLocal: local.toString() };
}

/** Book a realised exchange difference (when FIRINGI books FX and there is one). */
export async function bookFx(tx: Tx, e: { kind: "RECEIVABLE" | "PAYABLE"; companyId: string; paymentId: string; invoiceId?: string | null; vendorInvoiceId?: string | null; code: string; amountLocal: Decimal; docRate: Decimal; settleRate: Decimal }) {
  if (!(await currencySettings(tx)).fxAccounting || e.amountLocal.lte(0)) return null;
  const gl = fxGainLoss(e.amountLocal, e.docRate, e.settleRate, e.kind);
  if (gl.isZero()) return null;
  return tx.fxEntry.create({
    data: {
      kind: e.kind, companyId: e.companyId, paymentId: e.paymentId, invoiceId: e.invoiceId ?? null, vendorInvoiceId: e.vendorInvoiceId ?? null, currencyCode: e.code,
      amountLocal: e.amountLocal.toFixed(2), docRate: e.docRate.toDecimalPlaces(8).toString(), settleRate: e.settleRate.toDecimalPlaces(8).toString(), gainLossEur: gl.toFixed(2),
    },
  });
}

/**
 * An inbound payment in another currency (online payment request, bank line): allocate it to the open
 * invoices in their currency, book the payment at the invoices' rates, the rest as credit at today's rate,
 * and the FX difference. `targets` in the order to pay; `orderId` = a prepayment of a not-yet-invoiced order.
 */
export async function receiveForeign(tx: Tx, p: {
  companyId: string; code: string; amountLocal: Decimal; method: PaymentMethod; reference: string | null; provider?: string | null; recordedById?: string | null;
  targets: { invoiceId: string; maxEur?: Decimal }[]; orderId?: string | null; openEur: Map<string, Decimal>;
}) {
  const mid = (await midRate(p.code)) ?? null;
  const ratios = await invoiceRatios(tx, p.targets.map((t) => t.invoiceId));
  const order = p.orderId ? await tx.order.findUnique({ where: { id: p.orderId }, select: { grandTotal: true, grandTotalLocal: true, eurRate: true } }) : null;
  const orderRatio = order ? docRatio({ grossEur: order.grandTotal, grossLocal: order.grandTotalLocal, eurRate: order.eurRate }) : null;
  const settle = mid ? new Decimal(mid.toString()) : orderRatio ?? new Decimal(1);
  const payment = await tx.payment.create({
    data: { companyId: p.companyId, direction: "INBOUND", method: p.method, amount: 0, currencyCode: p.code, amountLocal: p.amountLocal.toFixed(2), rate: settle.toString(), reference: p.reference, status: "CONFIRMED", paidAt: new Date(), provider: p.provider ?? null, recordedById: p.recordedById ?? null },
  });
  let freeLocal = p.amountLocal, bookedEur = ZERO;
  for (const t of p.targets) {
    if (freeLocal.lte(0.004)) break;
    const ratio = ratios.get(t.invoiceId)?.ratio;
    if (!ratio || ratios.get(t.invoiceId)?.code !== p.code) continue;
    const openEur = Decimal.min(p.openEur.get(t.invoiceId) ?? ZERO, t.maxEur ?? new Decimal(Infinity));
    if (openEur.lte(0.004)) continue;
    const openLocal = roundMoney(openEur.mul(ratio), p.code);
    const allocLocal = Decimal.min(freeLocal, openLocal);
    const allocEur = allocLocal.eq(openLocal) ? openEur : allocLocal.div(ratio).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    await tx.paymentAllocation.create({ data: { paymentId: payment.id, invoiceId: t.invoiceId, amount: allocEur.toFixed(2) } });
    await bookFx(tx, { kind: "RECEIVABLE", companyId: p.companyId, paymentId: payment.id, invoiceId: t.invoiceId, code: p.code, amountLocal: allocLocal, docRate: ratio, settleRate: settle });
    freeLocal = freeLocal.minus(allocLocal);
    bookedEur = bookedEur.plus(allocEur);
  }
  // what is left: a prepaid order at its own rate (the FX difference now), else credit at today's rate
  if (freeLocal.gt(0.004)) {
    const r = orderRatio ?? settle;
    bookedEur = bookedEur.plus(freeLocal.div(r).toDecimalPlaces(2, Decimal.ROUND_HALF_UP));
    if (orderRatio) await bookFx(tx, { kind: "RECEIVABLE", companyId: p.companyId, paymentId: payment.id, code: p.code, amountLocal: freeLocal, docRate: orderRatio, settleRate: settle });
  }
  return tx.payment.update({ where: { id: payment.id }, data: { amount: bookedEur.toFixed(2) } });
}

/**
 * FIRINGI pays a supplier in its currency: book the payment at the supplier invoices' rates and the FX
 * difference against today's rate. Returns the EUR amount booked.
 */
export async function payableFx(tx: Tx, p: { paymentId: string; companyId: string; code: string; allocations: { vendorInvoiceId: string; amountEur: Decimal }[] }) {
  if (p.code === "EUR") return;
  const mid = await midRate(p.code);
  if (!mid) return;
  const vis = await tx.vendorInvoice.findMany({ where: { id: { in: p.allocations.map((a) => a.vendorInvoiceId) } }, select: { id: true, rate: true, grossTotal: true, grossTotalLocal: true } });
  let local = ZERO;
  for (const a of p.allocations) {
    const v = vis.find((x) => x.id === a.vendorInvoiceId);
    if (!v) continue;
    const ratio = docRatio({ grossEur: v.grossTotal, grossLocal: v.grossTotalLocal, eurRate: v.rate });
    const amountLocal = roundMoney(a.amountEur.mul(ratio), p.code);
    local = local.plus(amountLocal);
    await bookFx(tx, { kind: "PAYABLE", companyId: p.companyId, paymentId: p.paymentId, vendorInvoiceId: v.id, code: p.code, amountLocal, docRate: ratio, settleRate: new Decimal(mid.toString()) });
  }
  await tx.payment.update({ where: { id: p.paymentId }, data: { currencyCode: p.code, amountLocal: local.toFixed(2), rate: mid.toString() } });
}

export const isForeign = (code: string | null | undefined) => !!code && code !== "EUR";
