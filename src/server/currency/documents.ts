import "server-only";
/**
 * Phase 45: orders, invoices and supplier statements in the customer's / supplier's own currency.
 *
 * Amounts stay in EUR (FIRINGI's books); a document in another currency also keeps them in that currency,
 * worked out with the rate locked when the order was placed (localAmounts in src/lib/currency.ts). Every
 * place that changes an order's EUR amounts calls syncOrderLocal so the local ones follow.
 */
import Decimal from "decimal.js";
import type { Tx } from "@/server/db";
import { localAmounts, roundMoney, toLocal } from "@/lib/currency";
import { buyerBilling, supplierBilling } from "./service";

const D = (v: { toString(): string } | number | string) => new Decimal(v.toString());

/**
 * At placement: lock the customer's currency and rates on the order (and the supplier's), then work out the
 * local amounts. `fixedLocal` = offer → the price-list price already in the customer's currency (used exactly).
 */
export async function lockOrderCurrency(tx: Tx, orderId: string, fixedLocal?: Map<string, { code: string; listEur: string; listLocal: string }>, fromOrderId?: string | null) {
  const o = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { buyer: { select: { country: { select: { code: true } } } }, seller: { select: { country: { select: { code: true } } } } } });
  const from = fromOrderId ? await tx.order.findUnique({ where: { id: fromOrderId }, select: { currencyCode: true, eurRate: true, midRate: true, fxMarginPct: true } }) : null;
  const [b0, v] = await Promise.all([buyerBilling({ countryCode: o.buyer.country.code }), supplierBilling({ countryCode: o.seller.country.code })]);
  // a moved / split order keeps the customer's rate of the order it came from
  const b = from ? { code: from.currencyCode, rate: from.eurRate, mid: from.midRate, marginPct: Number(from.fxMarginPct) } : b0;
  await tx.order.update({
    where: { id: orderId },
    data: {
      currencyCode: b.code, eurRate: b.rate.toString(), midRate: b.mid.toString(), fxMarginPct: b.marginPct,
      vendorCurrencyCode: v.code, vendorRate: v.rate.toString(),
      fxRate: D(b.rate).div(D(v.rate)).toDecimalPlaces(8).toString(),
    },
  });
  if (b.code === "EUR") return;
  if (fixedLocal?.size) {
    const lines = await tx.orderLine.findMany({ where: { orderId }, select: { id: true, offerId: true, unitSalePriceNet: true } });
    for (const l of lines) {
      const f = fixedLocal.get(l.offerId);
      if (!f || f.code !== b.code || D(f.listEur).isZero()) continue;
      // the fixed local price, less the discounts in the same proportion
      const unitLocal = D(l.unitSalePriceNet).mul(D(f.listLocal)).div(D(f.listEur)).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
      await tx.orderLine.update({ where: { id: l.id }, data: { unitPriceLocal: unitLocal.toString() } });
    }
  }
  await syncOrderLocal(tx, orderId);
}

/** The order's local amounts from its EUR amounts (after placement, confirmation, weighing, excise …). */
export async function syncOrderLocal(tx: Tx, orderId: string) {
  const o = await tx.order.findUnique({
    where: { id: orderId },
    select: { currencyCode: true, eurRate: true, netTotal: true, vatTotal: true, grandTotal: true, lines: { select: { id: true, lineNet: true, lineVat: true, taxRate: true, unitSalePriceNet: true, unitPriceLocal: true } } },
  });
  if (!o || o.currencyCode === "EUR") return;
  const rate = D(o.eurRate);
  // a line whose local price is not EUR × rate came from a fixed local price list: keep it
  const fixed = (l: (typeof o.lines)[number]) => l.unitPriceLocal != null && !D(l.unitPriceLocal).minus(D(l.unitSalePriceNet).mul(rate)).abs().lte(0.0001);
  const r = localAmounts(
    o.lines.map((l) => ({ lineNet: l.lineNet, lineVat: l.lineVat, taxRate: l.taxRate, unitSaleEur: l.unitSalePriceNet, unitLocal: fixed(l) ? l.unitPriceLocal : null })),
    { net: o.netTotal, vat: o.vatTotal, grand: o.grandTotal }, rate, o.currencyCode,
  );
  for (const [i, l] of o.lines.entries())
    await tx.orderLine.update({ where: { id: l.id }, data: { unitPriceLocal: r.lines[i].unitLocal.toString(), lineNetLocal: r.lines[i].netLocal.toString(), lineVatLocal: r.lines[i].vatLocal.toString() } });
  await tx.order.update({ where: { id: orderId }, data: { netTotalLocal: r.net.toString(), vatTotalLocal: r.vat.toString(), grandTotalLocal: r.grand.toString() } });
}

/** Currency of an invoice made for an order (or crediting an invoice): the order's locked rate. */
export async function invoiceCurrency(tx: Tx, src: { orderId?: string | null; originalInvoiceId?: string | null }) {
  if (src.originalInvoiceId) {
    const inv = await tx.invoice.findUnique({ where: { id: src.originalInvoiceId }, select: { currencyCode: true, eurRate: true, midRate: true, lines: { select: { orderLineId: true, unitPriceNet: true, unitPriceLocal: true } } } });
    if (inv && inv.currencyCode !== "EUR") {
      const ratios = new Map(inv.lines.filter((l) => l.orderLineId && l.unitPriceLocal != null && !D(l.unitPriceNet).isZero()).map((l) => [l.orderLineId!, D(l.unitPriceLocal!).div(D(l.unitPriceNet))]));
      return { code: inv.currencyCode, eurRate: D(inv.eurRate), midRate: D(inv.midRate), ratios };
    }
  }
  if (src.orderId) {
    const o = await tx.order.findUnique({ where: { id: src.orderId }, select: { currencyCode: true, eurRate: true, midRate: true, lines: { select: { id: true, unitSalePriceNet: true, unitPriceLocal: true } } } });
    if (o && o.currencyCode !== "EUR") {
      const ratios = new Map(o.lines.filter((l) => l.unitPriceLocal != null && !D(l.unitSalePriceNet).isZero()).map((l) => [l.id, D(l.unitPriceLocal!).div(D(l.unitSalePriceNet))]));
      return { code: o.currencyCode, eurRate: D(o.eurRate), midRate: D(o.midRate), ratios };
    }
  }
  return null;
}
export type InvoiceCurrency = NonNullable<Awaited<ReturnType<typeof invoiceCurrency>>>;

type LineIn = { orderLineId?: string | null; unitPriceNet: Decimal; taxRate: Decimal; lineNet: Decimal; lineVat: Decimal };
/** Local amounts of an invoice's lines and totals (lines from an order line keep its local price ratio). */
export function invoiceLocal(fx: InvoiceCurrency, lines: LineIn[], net: Decimal, vat: Decimal) {
  return localAmounts(
    lines.map((l) => {
      const ratio = l.orderLineId ? fx.ratios.get(l.orderLineId) : undefined;
      return { lineNet: l.lineNet, lineVat: l.lineVat, taxRate: l.taxRate, unitSaleEur: l.unitPriceNet, unitLocal: ratio ? D(l.unitPriceNet).mul(ratio).toDecimalPlaces(4) : null, vatFromEur: !l.orderLineId };
    }),
    { net, vat, grand: net.plus(vat) }, fx.eurRate, fx.code,
  );
}

/** A supplier statement in the supplier's currency (the order's locked supplier rate). */
export async function statementLocal(tx: Tx, orderId: string, eur: { net: Decimal; vat: Decimal; gross: Decimal }) {
  const o = await tx.order.findUnique({ where: { id: orderId }, select: { vendorCurrencyCode: true, vendorRate: true } });
  if (!o || o.vendorCurrencyCode === "EUR") return {};
  const code = o.vendorCurrencyCode, rate = D(o.vendorRate);
  const net = toLocal(eur.net, rate, code), vat = toLocal(eur.vat, rate, code);
  return { currencyCode: code, rate: rate.toString(), expectedNetLocal: net.toString(), expectedVatLocal: vat.toString(), expectedGrossLocal: roundMoney(net.plus(vat), code).toString() };
}
