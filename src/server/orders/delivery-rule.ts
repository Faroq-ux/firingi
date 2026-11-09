/**
 * Who delivers an order (pure).
 *
 *   goods ≥ vendor's own delivery minimum  → the VENDOR delivers (free)
 *   otherwise, goods ≥ FIRINGI minimum     → FIRINGI delivers and charges its fee
 *   otherwise                              → checkout blocked
 *
 * The FIRINGI minimum and fee are set by FIRINGI admin (per country, later per zone).
 * The vendor minimum is set by each vendor; a vendor without one never delivers itself.
 * Cross-border orders (distributor in another EU country) must be delivered by the
 * vendor's own fleet / carrier — FIRINGI vans don't cross borders — so only the vendor
 * minimum applies (no minimum set = the vendor ships any amount).
 */
import Decimal from "decimal.js";
import type { DeliveryMode } from "@prisma/client";

export type FiringiRule = { id: string; minOrderValue: Decimal.Value; feeNet: Decimal.Value } | null;
export type VendorMinimum = { id: string; amount: Decimal.Value } | null;

export type DeliveryDecision =
  | { ok: true; mode: DeliveryMode; feeNet: Decimal; ruleId: string | null }
  | { ok: false; reason: "BELOW_MINIMUM" | "BELOW_SUPPLIER_MINIMUM"; minimum: Decimal; missing: Decimal; vendorMinimum: Decimal | null };

export function decideDelivery(goodsNet: Decimal.Value, firingi: FiringiRule, vendor: VendorMinimum, crossBorder: boolean): DeliveryDecision {
  const goods = new Decimal(goodsNet);
  const vendorMin = vendor ? new Decimal(vendor.amount) : null;

  if (vendorMin && goods.gte(vendorMin)) return { ok: true, mode: crossBorder ? "CARRIER" : "VENDOR_FLEET", feeNet: new Decimal(0), ruleId: vendor!.id };

  if (crossBorder) {
    if (!vendorMin) return { ok: true, mode: "CARRIER", feeNet: new Decimal(0), ruleId: null };
    return { ok: false, reason: "BELOW_SUPPLIER_MINIMUM", minimum: vendorMin, missing: vendorMin.minus(goods), vendorMinimum: vendorMin };
  }

  const min = firingi ? new Decimal(firingi.minOrderValue) : new Decimal(0);
  if (goods.lt(min)) return { ok: false, reason: "BELOW_MINIMUM", minimum: min, missing: min.minus(goods), vendorMinimum: vendorMin };
  return { ok: true, mode: "FIRINGI_FLEET", feeNet: firingi ? new Decimal(firingi.feeNet) : new Decimal(0), ruleId: firingi?.id ?? null };
}
