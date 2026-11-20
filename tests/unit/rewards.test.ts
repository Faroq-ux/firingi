/** Phase 55: rewards shop — pure rules (settings, who may redeem, goals, voucher value, codes, statuses). */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_REWARDS_SETTINGS, blockedReason, buyerMayCancel, cleanRewardsSettings, goalProgress, isFinal, mergeRewardsSettings, parseCodes, rewardCode, tierRank, voucherCheck, voucherState,
  type BuyerLite, type RewardLite,
} from "@/lib/rewards";

const item = (p: Partial<RewardLite> = {}): RewardLite => ({ kind: "VOUCHER", status: "ACTIVE", points: 1000, stock: null, perBuyerLimit: null, minTier: null, buyerTypes: [], countryCodes: [], validFrom: new Date("2026-01-01"), validTo: null, ...p });
const buyer = (p: Partial<BuyerLite> = {}): BuyerLite => ({ type: "CUSTOMER", countryCode: "PT", tier: "BRONZE", balance: 5000, spentThisMonth: 0, ...p });
const opts = (p: Partial<{ usedByBuyer: number; monthlyLimit: number }> = {}) => ({ settings: { ...DEFAULT_REWARDS_SETTINGS, monthlyLimit: p.monthlyLimit ?? 0 }, usedByBuyer: p.usedByBuyer ?? 0, now: new Date("2026-06-01") });

describe("rewards settings", () => {
  it("merges with defaults and keeps unknown values out", () => {
    const s = mergeRewardsSettings({ kinds: { GIFT: false } as never, handoverDays: "x" as never });
    expect(s.kinds).toEqual({ ...DEFAULT_REWARDS_SETTINGS.kinds, GIFT: false });
    expect(s.handoverDays).toBe(90);
    expect(mergeRewardsSettings(null)).toEqual(DEFAULT_REWARDS_SETTINGS);
  });
  it("refuses values out of range", () => {
    expect(() => cleanRewardsSettings({ ...DEFAULT_REWARDS_SETTINGS, handoverDays: 2 })).toThrow(/7 to 365/);
    expect(() => cleanRewardsSettings({ ...DEFAULT_REWARDS_SETTINGS, supplierMinPoints: 500, supplierMaxPoints: 100 })).toThrow(/at least the fewest/);
    expect(cleanRewardsSettings({ ...DEFAULT_REWARDS_SETTINGS, monthlyLimit: 0 }).monthlyLimit).toBe(0);
  });
});

describe("who may redeem", () => {
  it("passes when everything fits", () => expect(blockedReason(item(), buyer(), opts())).toBeNull());
  it("gives the first reason in a fixed order", () => {
    expect(blockedReason(item(), buyer(), { ...opts(), settings: { ...DEFAULT_REWARDS_SETTINGS, kinds: { ...DEFAULT_REWARDS_SETTINGS.kinds, VOUCHER: false } } })).toBe("KIND_OFF");
    expect(blockedReason(item({ status: "PAUSED" }), buyer(), opts())).toBe("NOT_ACTIVE");
    expect(blockedReason(item({ validFrom: new Date("2026-07-01") }), buyer(), opts())).toBe("NOT_YET");
    expect(blockedReason(item({ validTo: new Date("2026-05-01") }), buyer(), opts())).toBe("ENDED");
    expect(blockedReason(item({ buyerTypes: ["WHOLESALER"] }), buyer(), opts())).toBe("TYPE");
    expect(blockedReason(item({ countryCodes: ["ES"] }), buyer(), opts())).toBe("COUNTRY");
    expect(blockedReason(item({ minTier: "SILVER" }), buyer(), opts())).toBe("TIER");
    expect(blockedReason(item({ minTier: "SILVER" }), buyer({ tier: "GOLD" }), opts())).toBeNull();
    expect(blockedReason(item({ perBuyerLimit: 2 }), buyer(), opts({ usedByBuyer: 2 }))).toBe("LIMIT");
    expect(blockedReason(item({ stock: 0 }), buyer(), opts())).toBe("SOLD_OUT");
    expect(blockedReason(item(), buyer({ spentThisMonth: 4500 }), opts({ monthlyLimit: 5000 }))).toBe("MONTHLY");
    expect(blockedReason(item({ points: 6000 }), buyer(), opts())).toBe("POINTS");
  });
  it("ranks tiers", () => {
    expect(tierRank("GOLD")).toBeGreaterThan(tierRank("SILVER"));
    expect(tierRank(null)).toBe(0);
    expect(tierRank("UNKNOWN")).toBe(0);
  });
});

describe("goals, vouchers, codes, statuses", () => {
  it("shows progress to a goal", () => {
    expect(goalProgress(250, 1000)).toEqual({ pct: 25, missing: 750 });
    expect(goalProgress(1500, 1000)).toEqual({ pct: 100, missing: 0 });
    expect(goalProgress(-5, 1000)).toEqual({ pct: 0, missing: 1005 });
  });
  it("warns FIRINGI when a voucher is worth more than its points", () => {
    expect(voucherCheck(1000, 5, 0.01)).toEqual({ worth: 10, generous: false, ratio: 0.5 });
    expect(voucherCheck(300, 5, 0.01).generous).toBe(true);
  });
  it("makes readable coupon codes", () => {
    expect(rewardCode()).toMatch(/^RW-[A-HJ-NP-Z2-9]{8}$/);
    expect(rewardCode(() => 0)).toBe("RW-AAAAAAAA");
  });
  it("knows when a voucher is used, open or expired", () => {
    const now = new Date("2026-06-01");
    expect(voucherState({ expiresAt: new Date("2026-05-01"), usedOnLiveOrder: true }, now)).toBe("USED");
    expect(voucherState({ expiresAt: new Date("2026-05-01"), usedOnLiveOrder: false }, now)).toBe("EXPIRED");
    expect(voucherState({ expiresAt: null, usedOnLiveOrder: false }, now)).toBe("ISSUED");
  });
  it("reads pasted partner codes", () => {
    expect(parseCodes("ABC-1\r\nABC-2;ABC-1,  ABC-3 \n\nx\nhas space")).toEqual({ codes: ["ABC-1", "ABC-2", "ABC-3"], bad: ["x", "has space"] });
    expect(parseCodes("").codes).toEqual([]);
  });
  it("lets buyers cancel only what is not on its way", () => {
    expect(buyerMayCancel("VOUCHER", "ISSUED")).toBe(true);
    expect(buyerMayCancel("VOUCHER", "USED")).toBe(false);
    expect(buyerMayCancel("SUPPLIER_PRODUCT", "PENDING", 0)).toBe(true);
    expect(buyerMayCancel("SUPPLIER_PRODUCT", "PENDING", 1)).toBe(false);
    expect(buyerMayCancel("GIFT", "SHIPPED")).toBe(false);
    expect(buyerMayCancel("PARTNER", "ISSUED")).toBe(false);
    expect(isFinal("DELIVERED")).toBe(true);
    expect(isFinal("PENDING")).toBe(false);
  });
});
