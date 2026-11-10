/**
 * Who delivers an order, and the delivery fee (pure).
 *
 * Customer ← wholesaler (FIRINGI resells; domestic):
 *   goods reach the wholesaler's free-delivery minimum      → the WHOLESALER delivers, free
 *   else goods < FIRINGI's minimum order                     → checkout blocked
 *   else FIRINGI free delivery is on and goods ≥ its "free from" → FIRINGI delivers, free
 *   else                                                     → FIRINGI delivers at its flat rate
 *   (FIRINGI's minimum, flat rate and free delivery are set by the admin per country, or per
 *   delivery zone, which overrides the country.)
 *
 * Wholesaler ← distributor (and every cross-border order — FIRINGI vans don't cross borders):
 *   the DISTRIBUTOR always delivers (own fleet, or a carrier abroad)
 *   minimum (amount or units, the distributor decides) reached, or none set → free
 *   below it → the distributor's own flat rate; no flat rate set → checkout blocked
 *   FIRINGI invoices the fee to the wholesaler and passes it on to the distributor.
 */
import Decimal from "decimal.js";
import type { DeliveryMode } from "@prisma/client";

export type FiringiRule = { id: string; minOrderValue: Decimal.Value; feeNet: Decimal.Value; freeEnabled?: boolean; freeFrom?: Decimal.Value | null } | null;
export type VendorRule = { id: string; kind?: "AMOUNT" | "UNITS"; amount?: Decimal.Value | null; units?: number | null; flatFeeNet?: Decimal.Value | null } | null;

export type DeliveryDecision =
  | { ok: true; mode: DeliveryMode; feeNet: Decimal; ruleId: string | null; feeOwner: "FIRINGI" | "VENDOR" | null; free: "VENDOR" | "FIRINGI" | null }
  | { ok: false; reason: "BELOW_MINIMUM" | "BELOW_SUPPLIER_MINIMUM"; minimum: Decimal; missing: Decimal; unit: "AMOUNT" | "UNITS"; vendorMinimum: Decimal | null };

export type DeliveryInput = {
  goodsNet: Decimal.Value;
  /** Selling units (packs / cases) in the order. */
  units: number;
  /** The supplier delivers every order itself (distributor → wholesaler, cross-border). */
  supplierDelivers: boolean;
  crossBorder: boolean;
  firingi: FiringiRule;
  vendor: VendorRule;
  /** A supplier-paid free-delivery offer: the supplier delivers free, as if its minimum were reached. */
  vendorFree?: boolean;
};

/** Has the order reached the supplier's free-delivery minimum? (No minimum set → no.) */
export function vendorMinimumReached(vendor: VendorRule, goodsNet: Decimal.Value, units: number): boolean {
  if (!vendor) return false;
  if (vendor.kind === "UNITS") return vendor.units != null && vendor.units > 0 && units >= vendor.units;
  return vendor.amount != null && new Decimal(goodsNet).gte(vendor.amount);
}
const hasMinimum = (v: VendorRule) => !!v && (v.kind === "UNITS" ? v.units != null && v.units > 0 : v.amount != null);

export function decideDelivery(i: DeliveryInput): DeliveryDecision {
  const goods = new Decimal(i.goodsNet);
  const v = i.vendor;
  const vendorMode: DeliveryMode = i.crossBorder ? "CARRIER" : "VENDOR_FLEET";
  const vendorAmount = v && v.kind !== "UNITS" && v.amount != null ? new Decimal(v.amount) : null;

  if (vendorMinimumReached(v, goods, i.units) || i.vendorFree) return { ok: true, mode: vendorMode, feeNet: new Decimal(0), ruleId: v?.id ?? null, feeOwner: null, free: "VENDOR" };

  if (i.supplierDelivers || i.crossBorder) {
    if (!hasMinimum(v) && (v?.flatFeeNet == null)) return { ok: true, mode: vendorMode, feeNet: new Decimal(0), ruleId: v?.id ?? null, feeOwner: null, free: "VENDOR" };
    if (v?.flatFeeNet != null) {
      const fee = new Decimal(v.flatFeeNet);
      return { ok: true, mode: vendorMode, feeNet: fee, ruleId: v.id, feeOwner: fee.gt(0) ? "VENDOR" : null, free: fee.gt(0) ? null : "VENDOR" };
    }
    if (v!.kind === "UNITS")
      return { ok: false, reason: "BELOW_SUPPLIER_MINIMUM", minimum: new Decimal(v!.units!), missing: new Decimal(v!.units! - i.units), unit: "UNITS", vendorMinimum: null };
    return { ok: false, reason: "BELOW_SUPPLIER_MINIMUM", minimum: vendorAmount!, missing: vendorAmount!.minus(goods), unit: "AMOUNT", vendorMinimum: vendorAmount };
  }

  const f = i.firingi;
  const min = f ? new Decimal(f.minOrderValue) : new Decimal(0);
  if (goods.lt(min)) return { ok: false, reason: "BELOW_MINIMUM", minimum: min, missing: min.minus(goods), unit: "AMOUNT", vendorMinimum: vendorAmount };
  if (f?.freeEnabled && f.freeFrom != null && goods.gte(f.freeFrom)) return { ok: true, mode: "FIRINGI_FLEET", feeNet: new Decimal(0), ruleId: f.id, feeOwner: null, free: "FIRINGI" };
  const fee = f ? new Decimal(f.feeNet) : new Decimal(0);
  return { ok: true, mode: "FIRINGI_FLEET", feeNet: fee, ruleId: f?.id ?? null, feeOwner: fee.gt(0) ? "FIRINGI" : null, free: fee.gt(0) ? null : "FIRINGI" };
}

/** Rule rows (Prisma) → decision inputs. */
export function firingiInput(r: { id: string; minOrderValue: unknown; firingiDeliveryFeeNet: unknown; firingiFreeEnabled: boolean; firingiFreeFrom: unknown } | null): FiringiRule {
  return r && { id: r.id, minOrderValue: String(r.minOrderValue ?? 0), feeNet: String(r.firingiDeliveryFeeNet ?? 0), freeEnabled: r.firingiFreeEnabled, freeFrom: r.firingiFreeFrom == null ? null : String(r.firingiFreeFrom) };
}
export function vendorInput(r: { id: string; vendorMinimumKind: "AMOUNT" | "UNITS"; vendorDeliveryMinimum: unknown; vendorMinimumUnits: number | null; vendorFlatFeeNet: unknown } | null): VendorRule {
  return r && {
    id: r.id, kind: r.vendorMinimumKind, amount: r.vendorDeliveryMinimum == null ? null : String(r.vendorDeliveryMinimum),
    units: r.vendorMinimumUnits, flatFeeNet: r.vendorFlatFeeNet == null ? null : String(r.vendorFlatFeeNet),
  };
}
