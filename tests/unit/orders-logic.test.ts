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

describe("delivery decision: vendor minimum, else FIRINGI (admin minimum + fee)", () => {
  const firingi = { id: "f", minOrderValue: 50, feeNet: "9.90" };
  const vendor = { id: "v", amount: 150 };
  it("vendor delivers free when its own minimum is met", () => {
    expect(decideDelivery(150, firingi, vendor, false)).toMatchObject({ ok: true, mode: "VENDOR_FLEET", ruleId: "v" });
  });
  it("otherwise FIRINGI delivers with its fee, if FIRINGI's minimum is met", () => {
    const d = decideDelivery(100, firingi, vendor, false);
    expect(d).toMatchObject({ ok: true, mode: "FIRINGI_FLEET" });
    expect((d as { feeNet: { toFixed: (n: number) => string } }).feeNet.toFixed(2)).toBe("9.90");
  });
  it("below FIRINGI's minimum, checkout is blocked (and says how much is missing)", () => {
    const d = decideDelivery(40, firingi, vendor, false);
    expect(d).toMatchObject({ ok: false, reason: "BELOW_MINIMUM" });
    expect((d as { missing: { toFixed: (n: number) => string } }).missing.toFixed(2)).toBe("10.00");
  });
  it("a vendor minimum below FIRINGI's still lets the vendor deliver", () => {
    expect(decideDelivery(30, firingi, { id: "v", amount: 25 }, false)).toMatchObject({ ok: true, mode: "VENDOR_FLEET" });
  });
  it("a vendor without a minimum never delivers itself", () => {
    expect(decideDelivery(1000, firingi, null, false)).toMatchObject({ ok: true, mode: "FIRINGI_FLEET" });
  });
  it("cross-border: only the vendor (carrier) delivers; below its minimum checkout is blocked", () => {
    expect(decideDelivery(600, firingi, { id: "v", amount: 500 }, true)).toMatchObject({ ok: true, mode: "CARRIER" });
    expect(decideDelivery(400, firingi, { id: "v", amount: 500 }, true)).toMatchObject({ ok: false, reason: "BELOW_SUPPLIER_MINIMUM" });
  });
});
