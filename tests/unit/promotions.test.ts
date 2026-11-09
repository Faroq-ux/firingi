import { describe, expect, it } from "vitest";
import { applyPromotions, type PromoCandidate } from "@/server/catalogue/promotions";
import { computeLine } from "@/server/orders/calc";

const vendor10: PromoCandidate = { id: "v10", ownerType: "VENDOR", kind: "PERCENT", value: 10, firingiFundPct: 0, vendorFundPct: 100 };
const vendorFix: PromoCandidate = { id: "vf", ownerType: "VENDOR", kind: "FIXED_AMOUNT", value: 3, firingiFundPct: 0, vendorFundPct: 100 };
const adminFiringi: PromoCandidate = { id: "af", ownerType: "ADMIN", kind: "FIXED_AMOUNT", value: 10, firingiFundPct: 100, vendorFundPct: 0 };
const adminSplit: PromoCandidate = { id: "as", ownerType: "ADMIN", kind: "FIXED_AMOUNT", value: 10, firingiFundPct: 50, vendorFundPct: 50 };

describe("promotion engine", () => {
  it("picks the best vendor promotion, then the best admin promotion on the reduced price", () => {
    const r = applyPromotions(100, 1, [vendor10, vendorFix, adminSplit]);
    expect(r.applied.map((a) => a.promotionId)).toEqual(["v10", "as"]);
    expect(r.salePriceNet.toNumber()).toBe(80);
    expect(r.vendorFundedPerUnit.toNumber()).toBe(15); // 10 vendor promo + 5 vendor share of admin promo
    expect(r.firingiFundedPerUnit.toNumber()).toBe(5);
  });
  it("respects minimum quantity and never discounts below zero", () => {
    expect(applyPromotions(100, 1, [{ ...vendor10, minQty: 5 }]).applied).toEqual([]);
    expect(applyPromotions(2, 1, [vendorFix]).salePriceNet.toNumber()).toBe(0);
  });
});

describe("checklist: worked examples from the design (list 100, commission 10 %)", () => {
  const line = (promos: PromoCandidate[]) => {
    const p = applyPromotions(100, 1, promos);
    const c = computeLine({ qty: 1, unitListPriceNet: 100, vatRatePercent: 23, commissionRatePercent: 10, vendorFundedDiscountPerUnit: p.vendorFundedPerUnit, firingiFundedDiscountPerUnit: p.firingiFundedPerUnit });
    return { buyer: c.lineNet.toNumber(), vendor: c.vendorLineNet.toNumber(), commission: c.commissionAmount.toNumber(), firingi: c.lineNet.minus(c.vendorLineNet).toNumber() };
  };
  it("no promotion: buyer 100, vendor 90, FIRINGI 10", () => expect(line([])).toEqual({ buyer: 100, vendor: 90, commission: 10, firingi: 10 }));
  it("vendor promotion −5 does NOT reduce FIRINGI's commission", () => {
    const fiveOff: PromoCandidate = { ...vendorFix, value: 5 };
    expect(line([fiveOff])).toEqual({ buyer: 95, vendor: 85, commission: 10, firingi: 10 });
  });
  it("admin promotion −10 paid by FIRINGI", () => expect(line([adminFiringi])).toEqual({ buyer: 90, vendor: 90, commission: 10, firingi: 0 }));
  it("admin promotion −10 split 50/50", () => expect(line([adminSplit])).toEqual({ buyer: 90, vendor: 85, commission: 10, firingi: 5 }));
});
