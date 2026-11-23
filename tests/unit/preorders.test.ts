/** Phase 71: pre-order rules — tiers, next tier, fair allocation, deposits, flow, price-lock sums, switches. */
import { describe, expect, it } from "vitest";
import { allocate, buyerTypeFor, cleanTiers, depositFor, isOpen, lockEnd, lockSums, nextTier, perMonth, tierPrice } from "@/lib/preorders";
import { buyerOn, mergePre, sellerOn, sellerTypeForBuyer } from "@/server/preorders/settings";

describe("tier prices", () => {
  const tiers = cleanTiers(10, [{ minTotal: 200, unitNet: 9 }, { minTotal: 100, unitNet: 9.5 }, { minTotal: 300, unitNet: 9.6 }, { minTotal: 0, unitNet: 5 }, { minTotal: 50, unitNet: 11 }]);
  it("cleans: sorted, each cheaper, below the base price", () => {
    expect(tiers).toEqual([{ minTotal: 100, unitNet: 9.5 }, { minTotal: 200, unitNet: 9 }]);
  });
  it("price for everyone by total pre-ordered, and the next step", () => {
    expect(tierPrice(10, tiers, 99)).toBe(10);
    expect(tierPrice(10, tiers, 150)).toBe(9.5);
    expect(tierPrice(10, tiers, 250)).toBe(9);
    expect(nextTier(tiers, 150)).toEqual({ minTotal: 200, unitNet: 9, missing: 50 });
    expect(nextTier(tiers, 250)).toBeNull();
  });
});

describe("allocation when supply is short", () => {
  const reqs = [{ id: "a", qty: 10, at: 1, loyalty: 100 }, { id: "b", qty: 10, at: 2, loyalty: 5000 }, { id: "c", qty: 5, at: 3, loyalty: 0 }];
  it("enough supply → everyone gets what they asked", () => {
    expect([...allocate("PRO_RATA", 100, reqs).values()]).toEqual([10, 10, 5]);
    expect([...allocate("PRO_RATA", null, reqs).values()]).toEqual([10, 10, 5]);
  });
  it("in proportion, every pack shared out", () => {
    const m = allocate("PRO_RATA", 15, reqs);
    expect([m.get("a"), m.get("b"), m.get("c")]).toEqual([6, 6, 3]);
    const m2 = allocate("PRO_RATA", 16, reqs);
    expect([...m2.values()].reduce((x, y) => x + y, 0)).toBe(16);
    expect(m2.get("a")).toBe(7); // the earliest gets the extra pack on a tie
  });
  it("first come and regular customers first", () => {
    const f = allocate("FIRST_COME", 15, reqs);
    expect([f.get("a"), f.get("b"), f.get("c")]).toEqual([10, 5, 0]);
    const lo = allocate("LOYAL_FIRST", 15, reqs);
    expect([lo.get("a"), lo.get("b"), lo.get("c")]).toEqual([5, 10, 0]);
  });
});

describe("money, dates, flow", () => {
  it("deposit, open window, lock end, lock sums, per month", () => {
    expect(depositFor(10, 123.45)).toBe(12.35);
    expect(depositFor(0, 100)).toBe(0);
    const now = new Date("2026-11-23T12:00:00Z");
    expect(isOpen({ status: "OPEN", opensAt: new Date("2026-11-01"), closesAt: new Date("2026-12-01") }, now)).toBe(true);
    expect(isOpen({ status: "OPEN", opensAt: new Date("2026-11-01"), closesAt: new Date("2026-11-20") }, now)).toBe(false);
    expect(isOpen({ status: "PENDING", opensAt: new Date("2026-11-01"), closesAt: new Date("2026-12-01") }, now)).toBe(false);
    expect(lockEnd(now, 3).toISOString().slice(0, 10)).toBe("2027-02-23");
    expect(lockSums({ unitNet: 9, listUnitNet: 10, qtyTotal: 30, qtyTaken: 12 })).toEqual({ left: 18, valueLeft: 162, saved: 12, pctTaken: 40 });
    expect(perMonth(18, new Date(now.getTime() + 89 * 86400_000), now)).toBe(6);
    expect(buyerTypeFor("DISTRIBUTOR")).toBe("WHOLESALER");
    expect(buyerTypeFor("WHOLESALER")).toBe("CUSTOMER");
    expect(sellerTypeForBuyer("WHOLESALER")).toBe("DISTRIBUTOR");
    expect(sellerTypeForBuyer("CUSTOMER")).toBe("WHOLESALER");
  });
});

describe("FIRINGI's switches", () => {
  it("sellers by type, parts, countries, single companies", () => {
    const s = mergePre({ sellers: { DISTRIBUTOR: false, WHOLESALER: true }, offCountries: ["lu"] });
    expect(sellerOn(s, { id: "w", type: "WHOLESALER", countryCode: "PT" }, "campaigns")).toBe(true);
    expect(sellerOn(s, { id: "d", type: "DISTRIBUTOR", countryCode: "PT" }, "campaigns")).toBe(false);
    expect(sellerOn({ ...s, companies: { d: "ON" } }, { id: "d", type: "DISTRIBUTOR", countryCode: "PT" }, "campaigns")).toBe(true);
    expect(sellerOn(s, { id: "w", type: "WHOLESALER", countryCode: "LU" }, "campaigns")).toBe(false);
    expect(sellerOn(s, { id: "c", type: "CUSTOMER" }, "campaigns")).toBe(false);
    expect(sellerOn({ ...s, parts: { ...s.parts, priceLocks: false } }, { id: "w", type: "WHOLESALER" }, "priceLocks")).toBe(false);
    // customers buy from wholesalers (on); wholesalers buy from distributors (off)
    expect(buyerOn(s, { id: "c", type: "CUSTOMER", countryCode: "PT" }, "campaigns")).toBe(true);
    expect(buyerOn(s, { id: "w", type: "WHOLESALER", countryCode: "PT" }, "campaigns")).toBe(false);
    expect(buyerOn({ ...s, companies: { c: "OFF" } }, { id: "c", type: "CUSTOMER" }, "campaigns")).toBe(false);
    expect(buyerOn({ ...s, enabled: false }, { id: "c", type: "CUSTOMER" }, "campaigns")).toBe(false);
  });
  it("limits kept in range", () => {
    const m = mergePre({ maxDepositPct: 500, maxLockMonths: 0, approval: "x" as never });
    expect(m.maxDepositPct).toBe(100);
    expect(m.maxLockMonths).toBe(1);
    expect(m.approval).toBe("ALWAYS");
  });
});
