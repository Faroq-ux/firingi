import { describe, expect, it } from "vitest";
import { checkQty, computeLine, computeTotals } from "@/server/orders/calc";
import { canTransition, nextStatuses } from "@/server/orders/state";
import { decideDelivery } from "@/server/orders/delivery-rule";

describe("order maths", () => {
  it("commission on list price; vendor paid list − commission", () => {
    const l = computeLine({ qty: 3, unitListPriceNet: "13.90", vatRatePercent: 23, commissionRatePercent: 8 });
    expect(l.lineNet.toFixed(2)).toBe("41.70");
    expect(l.lineVat.toFixed(2)).toBe("9.59");
    expect(l.commissionAmount.toFixed(2)).toBe("3.34");
    expect(l.vendorLineNet.toFixed(2)).toBe("38.36");
  });
  it("a vendor discount does not reduce FIRINGI commission (Phase 5 rule, wired now)", () => {
    const l = computeLine({ qty: 1, unitListPriceNet: 100, vatRatePercent: 23, commissionRatePercent: 10, vendorFundedDiscountPerUnit: 5 });
    expect([l.lineNet, l.commissionAmount, l.vendorLineNet].map((d) => d.toNumber())).toEqual([95, 10, 85]);
  });
  it("totals add delivery fee and its VAT; FIRINGI margin = sale − vendor cost", () => {
    const a = { ...computeLine({ qty: 2, unitListPriceNet: 10, vatRatePercent: 6, commissionRatePercent: 5 }), qty: 2 };
    const b = { ...computeLine({ qty: 1, unitListPriceNet: 30, vatRatePercent: 23, commissionRatePercent: 5 }), qty: 1 };
    const t = computeTotals([a, b], { feeNet: "9.90", feeVatPercent: 23 });
    expect(t.goodsNet.toFixed(2)).toBe("50.00");
    expect(t.netTotal.toFixed(2)).toBe("59.90");
    expect(t.vatTotal.toFixed(2)).toBe("10.38"); // 1.20 + 6.90 + 2.28 (fee)
    expect(t.grandTotal.toFixed(2)).toBe("70.28");
    expect(t.commissionTotal.toFixed(2)).toBe("2.50");
    expect(t.firingiMarginNet.toFixed(2)).toBe("2.50");
    expect(t.vendorPayableNet.toFixed(2)).toBe("47.50");
    // Distributor's own flat rate: FIRINGI invoices it and pays it on; FIRINGI's margin unchanged.
    const v = computeTotals([a, b], { feeNet: "9.90", feeVatPercent: 23, toVendor: true });
    expect(v.vendorPayableNet.toFixed(2)).toBe("57.40");
    expect(v.firingiMarginNet.toFixed(2)).toBe("2.50");
  });
  it("quantity rules", () => {
    expect(checkQty(5, 1, 1)).toBeNull();
    expect(checkQty(2, 3, 1)).toBe("QTY_MIN");
    expect(checkQty(4, 2, 2)).toBeNull();
    expect(checkQty(5, 2, 2)).toBe("QTY_STEP");
    expect(checkQty(0, 1, 1)).toBe("QTY_INVALID");
  });
});

describe("status machine", () => {
  it("buyers can only cancel before the vendor accepts", () => {
    expect(canTransition("PENDING_CONFIRMATION", "CANCELLED", "BUYER", null)).toBe(true);
    expect(canTransition("SUPPLIER_PROCESSING", "CANCELLED", "BUYER", null)).toBe(false);
    expect(canTransition("PENDING_CONFIRMATION", "SUPPLIER_PROCESSING", "BUYER", null)).toBe(false);
  });
  it("vendors accept / prepare; deliver only when they are the ones delivering", () => {
    expect(canTransition("PENDING_CONFIRMATION", "SUPPLIER_PROCESSING", "VENDOR", "FIRINGI_FLEET")).toBe(true);
    expect(canTransition("READY_FOR_PICKUP", "DISPATCHED", "VENDOR", "FIRINGI_FLEET")).toBe(false);
    expect(canTransition("READY_FOR_PICKUP", "DISPATCHED", "VENDOR", "VENDOR_FLEET")).toBe(true);
    expect(canTransition("SUPPLIER_PROCESSING", "CANCELLED", "VENDOR", "VENDOR_FLEET")).toBe(false);
    expect(canTransition("DELIVERED", "RETURNED", "VENDOR", "VENDOR_FLEET")).toBe(false);
  });
  it("admins can do any allowed step, never skip steps", () => {
    expect(canTransition("READY_FOR_PICKUP", "DISPATCHED", "ADMIN", "FIRINGI_FLEET")).toBe(true);
    expect(canTransition("PENDING_CONFIRMATION", "DELIVERED", "ADMIN", "FIRINGI_FLEET")).toBe(false);
    expect(nextStatuses("DELIVERED")).toEqual(["RETURNED"]);
    expect(nextStatuses("CANCELLED")).toEqual([]);
  });
});

describe("delivery decision", () => {
  const firingi = { id: "f", minOrderValue: 50, feeNet: "9.90" };
  const vendor = { id: "v", amount: 150 };
  const D = (goodsNet: number, f: Parameters<typeof decideDelivery>[0]["firingi"], v: Parameters<typeof decideDelivery>[0]["vendor"], o: { units?: number; supplierDelivers?: boolean; crossBorder?: boolean } = {}) =>
    decideDelivery({ goodsNet, units: o.units ?? 1, supplierDelivers: o.supplierDelivers ?? false, crossBorder: o.crossBorder ?? false, firingi: f, vendor: v });
  const fee = (d: unknown) => (d as { feeNet: { toFixed: (n: number) => string } }).feeNet.toFixed(2);

  describe("customer ← wholesaler", () => {
    it("wholesaler delivers free when its own minimum is met", () => {
      expect(D(150, firingi, vendor)).toMatchObject({ ok: true, mode: "VENDOR_FLEET", ruleId: "v", free: "VENDOR" });
    });
    it("otherwise FIRINGI delivers at its flat rate, if FIRINGI's minimum is met", () => {
      const d = D(100, firingi, vendor);
      expect(d).toMatchObject({ ok: true, mode: "FIRINGI_FLEET", feeOwner: "FIRINGI" });
      expect(fee(d)).toBe("9.90");
    });
    it("FIRINGI free delivery (switched on): free from its threshold, flat rate below", () => {
      const f = { ...firingi, freeEnabled: true, freeFrom: 120 };
      expect(D(130, f, vendor)).toMatchObject({ ok: true, mode: "FIRINGI_FLEET", free: "FIRINGI", feeOwner: null });
      expect(fee(D(130, f, vendor))).toBe("0.00");
      expect(fee(D(110, f, vendor))).toBe("9.90");
      expect(fee(D(130, { ...f, freeEnabled: false }, vendor))).toBe("9.90"); // switched off → flat rate
    });
    it("below FIRINGI's minimum, checkout is blocked (and says how much is missing)", () => {
      const d = D(40, firingi, vendor);
      expect(d).toMatchObject({ ok: false, reason: "BELOW_MINIMUM", unit: "AMOUNT" });
      expect((d as { missing: { toFixed: (n: number) => string } }).missing.toFixed(2)).toBe("10.00");
    });
    it("a wholesaler minimum below FIRINGI's still lets the wholesaler deliver", () => {
      expect(D(30, firingi, { id: "v", amount: 25 })).toMatchObject({ ok: true, mode: "VENDOR_FLEET" });
    });
    it("a wholesaler without a minimum never delivers itself", () => {
      expect(D(1000, firingi, null)).toMatchObject({ ok: true, mode: "FIRINGI_FLEET" });
    });
  });

  describe("wholesaler ← distributor (the distributor always delivers)", () => {
    const S = { supplierDelivers: true };
    it("minimum by amount reached → free", () => {
      expect(D(600, firingi, { id: "v", amount: 500, flatFeeNet: 25 }, S)).toMatchObject({ ok: true, mode: "VENDOR_FLEET", free: "VENDOR" });
    });
    it("minimum by units: free from N units, else the distributor's flat rate (passed on to it)", () => {
      const v = { id: "v", kind: "UNITS" as const, units: 20, flatFeeNet: 25 };
      expect(D(100, firingi, v, { ...S, units: 20 })).toMatchObject({ ok: true, mode: "VENDOR_FLEET", free: "VENDOR" });
      const d = D(5000, firingi, v, { ...S, units: 19 });
      expect(d).toMatchObject({ ok: true, mode: "VENDOR_FLEET", feeOwner: "VENDOR" });
      expect(fee(d)).toBe("25.00");
    });
    it("below the minimum without a flat rate, checkout is blocked (missing units)", () => {
      expect(D(100, firingi, { id: "v", kind: "UNITS", units: 20 }, { ...S, units: 12 })).toMatchObject({ ok: false, reason: "BELOW_SUPPLIER_MINIMUM", unit: "UNITS" });
      expect(String((D(100, firingi, { id: "v", kind: "UNITS", units: 20 }, { ...S, units: 12 }) as { missing: unknown }).missing)).toBe("8");
    });
    it("never FIRINGI's fleet, even below FIRINGI's minimum; no rule → free", () => {
      expect(D(10, firingi, null, S)).toMatchObject({ ok: true, mode: "VENDOR_FLEET", free: "VENDOR" });
      expect(fee(D(10, firingi, { id: "v", flatFeeNet: 12 }, S))).toBe("12.00"); // flat rate only, no minimum
    });
    it("cross-border: carrier; below the minimum the flat rate, else blocked", () => {
      expect(D(600, firingi, { id: "v", amount: 500 }, { crossBorder: true })).toMatchObject({ ok: true, mode: "CARRIER" });
      expect(D(400, firingi, { id: "v", amount: 500 }, { crossBorder: true })).toMatchObject({ ok: false, reason: "BELOW_SUPPLIER_MINIMUM" });
      expect(D(400, firingi, { id: "v", amount: 500, flatFeeNet: 30 }, { crossBorder: true })).toMatchObject({ ok: true, mode: "CARRIER", feeOwner: "VENDOR" });
    });
  });
});
