/**
 * Order money maths (pure). All amounts net of VAT unless named *Vat / *Gross.
 * Commission is ALWAYS calculated on the pre-discount list price (vendor promotions
 * never reduce FIRINGI's commission). Discounts are wired in for Phase 5.
 */
import Decimal from "decimal.js";

const r2 = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const r4 = (d: Decimal) => d.toDecimalPlaces(4, Decimal.ROUND_HALF_UP);

export type LineInput = {
  qty: number;
  unitListPriceNet: Decimal.Value;
  vatRatePercent: Decimal.Value;
  commissionRatePercent: Decimal.Value | null; // null = no rule (vendor can't sell — guarded elsewhere)
  vendorFundedDiscountPerUnit?: Decimal.Value; // Phase 5
  firingiFundedDiscountPerUnit?: Decimal.Value; // Phase 5
};

export function computeLine(i: LineInput) {
  const qty = new Decimal(i.qty);
  const list = new Decimal(i.unitListPriceNet);
  const vendorDisc = new Decimal(i.vendorFundedDiscountPerUnit ?? 0);
  const firingiDisc = new Decimal(i.firingiFundedDiscountPerUnit ?? 0);
  const unitSale = list.minus(vendorDisc).minus(firingiDisc);
  const lineNet = r2(unitSale.mul(qty));
  const lineVat = r2(lineNet.mul(new Decimal(i.vatRatePercent)).div(100));
  const commissionBase = r2(list.mul(qty)); // pre-discount
  const commissionAmount = r2(commissionBase.mul(new Decimal(i.commissionRatePercent ?? 0)).div(100));
  // What FIRINGI pays the vendor: list − the vendor's own discount − commission.
  const vendorLineNet = r2(list.minus(vendorDisc).mul(qty).minus(commissionAmount));
  return {
    unitListPriceNet: r4(list),
    vendorFundedDiscount: r4(vendorDisc),
    firingiFundedDiscount: r4(firingiDisc),
    unitSalePriceNet: r4(unitSale),
    lineNet,
    lineVat,
    commissionBase,
    commissionAmount,
    vendorLineNet,
    vendorUnitCostNet: qty.gt(0) ? r4(vendorLineNet.div(qty)) : new Decimal(0),
  };
}

export type ComputedLine = ReturnType<typeof computeLine> & { qty: number };

/**
 * `delivery.toVendor`: the supplier delivers at its own flat rate — FIRINGI invoices the fee and pays it on.
 * `delivery.firingiPaysVendorFeeNet`: a FIRINGI-paid free-delivery offer waived that fee for the buyer;
 * FIRINGI still pays it to the supplier.
 */
export function computeTotals(lines: ComputedLine[], delivery: { feeNet: Decimal.Value; feeVatPercent: Decimal.Value; toVendor?: boolean; firingiPaysVendorFeeNet?: Decimal.Value }) {
  const sum = (f: (l: ComputedLine) => Decimal) => lines.reduce((a, l) => a.plus(f(l)), new Decimal(0));
  const goodsNet = sum((l) => l.lineNet);
  const listNet = sum((l) => l.commissionBase);
  const feeNet = r2(new Decimal(delivery.feeNet));
  const feeVat = r2(feeNet.mul(new Decimal(delivery.feeVatPercent)).div(100));
  const vatTotal = sum((l) => l.lineVat).plus(feeVat);
  const netTotal = goodsNet.plus(feeNet);
  const vendorGoodsNet = sum((l) => l.vendorLineNet);
  const vendorPayableNet = delivery.toVendor ? vendorGoodsNet.plus(feeNet).plus(r2(new Decimal(delivery.firingiPaysVendorFeeNet ?? 0))) : vendorGoodsNet;
  return {
    listNet,
    discountTotal: listNet.minus(goodsNet),
    goodsNet,
    deliveryFeeNet: feeNet,
    deliveryFeeVat: feeVat,
    netTotal,
    vatTotal,
    grandTotal: netTotal.plus(vatTotal),
    commissionTotal: sum((l) => l.commissionAmount),
    vendorPayableNet,
    /** FIRINGI's gross margin on goods (= what it sells for − what it pays the vendor). */
    firingiMarginNet: goodsNet.minus(vendorGoodsNet),
  };
}

/** Quantity rules of an offer. Returns an error key or null. */
export function checkQty(qty: number, minOrderQty: number, qtyStep: number): "QTY_INVALID" | "QTY_MIN" | "QTY_STEP" | null {
  if (!Number.isInteger(qty) || qty < 1) return "QTY_INVALID";
  if (qty < minOrderQty) return "QTY_MIN";
  if ((qty - minOrderQty) % qtyStep !== 0) return "QTY_STEP";
  return null;
}
