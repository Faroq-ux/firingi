import { describe, expect, it } from "vitest";
import { DEFAULT_RISK, scoreRisk, type RiskFacts } from "@/server/risk/engine";

const base: RiskFacts = {
  checkoutGross: 300, checkoutGoods: 260, accountAgeDays: 400, priorOrders: 20, priorAvgGoods: 250, recentCheckouts: 0, recentCancelled: 0,
  addressKm: 3, addressAgeHours: 5000, userAgeHours: 9000, userIsOwner: true, couponLookAlikes: 0,
};

describe("risk scoring", () => {
  it("a normal order is low risk with no reasons", () => {
    expect(scoreRisk(base)).toEqual({ score: 0, level: "LOW", reasons: [] });
  });
  it("new account placing a big first order is held", () => {
    const r = scoreRisk({ ...base, accountAgeDays: 2, priorOrders: 0, priorAvgGoods: 0, checkoutGross: 5000, checkoutGoods: 4200 });
    expect(r.reasons.map((x) => x.rule)).toEqual(["NEW_ACCOUNT_BIG", "FIRST_ORDER_BIG"]);
    expect(r.score).toBe(80);
    expect(r.level).toBe("HIGH");
  });
  it("a spike or a far, brand-new address flags for review", () => {
    expect(scoreRisk({ ...base, checkoutGoods: 2000, checkoutGross: 2400 }).level).toBe("LOW"); // 25: spike alone
    const r = scoreRisk({ ...base, addressKm: 180, addressAgeHours: 2 });
    expect(r.score).toBe(35);
    expect(r.level).toBe("MEDIUM");
  });
  it("velocity, coupon look-alikes and cancellations add up", () => {
    const r = scoreRisk({ ...base, recentCheckouts: 3, couponLookAlikes: 2, recentCancelled: 4 });
    expect(r.reasons.map((x) => x.rule)).toEqual(["VELOCITY", "COUPON_SHARED", "CANCEL_HISTORY"]);
    expect(r.level).toBe("HIGH");
  });
  it("thresholds and switched-off checks are respected; disabled engine never holds", () => {
    const f = { ...base, recentCheckouts: 3, couponLookAlikes: 1 };
    expect(scoreRisk(f, { ...DEFAULT_RISK, disabledRules: ["COUPON_SHARED"] }).level).toBe("MEDIUM");
    expect(scoreRisk(f, { ...DEFAULT_RISK, holdScore: 100 }).level).toBe("MEDIUM");
    expect(scoreRisk(f, { ...DEFAULT_RISK, enabled: false }).level).toBe("LOW");
  });
});
