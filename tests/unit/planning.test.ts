/** Phase 30: demand planning maths (pure). */
import { describe, expect, it } from "vitest";
import {
  accuracy, croston, daysUntilSold, demandOver, eventFactor, expiryRisk, fit, holtDamped, leadStats, leadTimeToUse, markdownPct, mondayOf, overstock, plan, weekdayProfile, zFor,
} from "@/server/planning/model";
import { riskRows, type CompanyPlan, type PlanRow } from "@/server/planning/engine";

const D = (s: string) => new Date(`${s}T00:00:00Z`);

describe("forecast methods", () => {
  it("weeks start on Monday (UTC)", () => {
    expect(mondayOf(D("2026-11-12")).toISOString().slice(0, 10)).toBe("2026-11-09");
    expect(mondayOf(D("2026-11-09")).toISOString().slice(0, 10)).toBe("2026-11-09");
    expect(mondayOf(D("2026-11-15")).toISOString().slice(0, 10)).toBe("2026-11-09");
  });

  it("z for the service level", () => {
    expect(zFor(0.5)).toBeCloseTo(0, 3);
    expect(zFor(0.95)).toBeCloseTo(1.645, 2);
    expect(zFor(0.99)).toBeCloseTo(2.326, 2);
  });

  it("a steady product: the average wins and the range is around it", () => {
    const f = fit([10, 11, 9, 10, 10, 11, 9, 10, 10, 11, 9, 10], 4);
    expect(f.method).toBe("AVERAGE");
    expect(f.forecast[0]).toBeCloseTo(10, 0);
    expect(f.low[0]).toBeLessThan(f.forecast[0]);
    expect(f.high[0]).toBeGreaterThan(f.forecast[0]);
    expect(f.high[3] - f.low[3]).toBeGreaterThan(f.high[0] - f.low[0]); // wider further ahead
  });

  it("a growing product: the damped trend wins and keeps growing (but slower)", () => {
    const h = Array.from({ length: 14 }, (_, i) => 10 + i * 3);
    const f = fit(h, 4);
    expect(f.method).toBe("HOLT");
    expect(f.forecast[0]).toBeGreaterThan(h[h.length - 1]);
    expect(f.forecast[3] - f.forecast[2]).toBeLessThan(f.forecast[1] - f.forecast[0] + 1e-9);
    expect(holtDamped(h, 2).every((v) => v >= 0)).toBe(true);
  });

  it("a product sold every other week: Croston is a candidate and forecasts about half", () => {
    const h = [20, 0, 22, 0, 18, 0, 20, 0, 21, 0, 19, 0];
    const f = fit(h, 2);
    expect(f.intermittent).toBe(true);
    expect(f.scores.CROSTON).toBeDefined();
    expect(croston(h, 1)[0]).toBeGreaterThan(8);
    expect(croston(h, 1)[0]).toBeLessThan(12);
  });

  it("no history → nothing forecast; a new product → its average", () => {
    expect(fit([0, 0, 0], 3).forecast).toEqual([0, 0, 0]);
    const f = fit([0, 0, 0, 0, 6, 8], 2);
    expect(f.weeksOfHistory).toBe(2);
    expect(f.forecast[0]).toBe(7);
  });
});

describe("events", () => {
  it("weigh by the days they cover in the week", () => {
    const mon = D("2026-12-14");
    expect(eventFactor([{ startsOn: D("2026-12-14"), endsOn: D("2026-12-20"), upliftPct: 40 }], mon)).toBeCloseTo(1.4, 5);
    expect(eventFactor([{ startsOn: D("2026-12-18"), endsOn: D("2026-12-31"), upliftPct: 70 }], mon)).toBeCloseTo(1 + 0.7 * 3 / 7, 5);
    expect(eventFactor([{ startsOn: D("2027-01-04"), endsOn: D("2027-01-10"), upliftPct: 50 }], mon)).toBe(1);
  });
});

describe("restock plan", () => {
  const weekly = Array(8).fill(70); // 10 a day
  it("demand over days and days until sold", () => {
    expect(demandOver(weekly, 3)).toBeCloseTo(30, 5);
    expect(demandOver([70, 140], 14)).toBeCloseTo(210, 5);
    expect(daysUntilSold(weekly, 25)).toBe(3);
    expect(daysUntilSold([0], 5)).toBeNull();
  });

  it("enough stock → nothing to do", () => {
    const p = plan({ weekly, sigma: 10, leadTimeDays: 3, reviewDays: 7, serviceLevel: 95, usable: 500, incoming: 0 });
    expect(p.urgency).toBeNull();
    expect(p.qty).toBe(0);
    expect(p.dailyDemand).toBe(10);
  });

  it("at the reorder point → order up to the level, in pack multiples and at least the minimum", () => {
    const p = plan({ weekly, sigma: 10, leadTimeDays: 3, reviewDays: 7, serviceLevel: 95, usable: 40, incoming: 0, packMultiple: 12, minOrderQty: 50 });
    // safety = 1.645 × 10 × √(10/7) ≈ 19.7 → 20; ROP = 30 + 20 = 50; up-to = 100 + 20 = 120
    expect(p.safetyStock).toBe(20);
    expect(p.reorderPoint).toBe(50);
    expect(p.orderUpTo).toBe(120);
    expect(p.urgency).toBe("ORDER_NOW");
    expect(p.qty % 12).toBe(0);
    expect(p.qty).toBe(84); // 80 → next multiple of 12
  });

  it("runs out before a new order could arrive → LATE; nothing left → OUT", () => {
    expect(plan({ weekly, sigma: 5, leadTimeDays: 7, reviewDays: 7, serviceLevel: 95, usable: 30, incoming: 0 }).urgency).toBe("LATE");
    expect(plan({ weekly, sigma: 5, leadTimeDays: 7, reviewDays: 7, serviceLevel: 95, usable: 0, incoming: 0 }).urgency).toBe("OUT");
  });

  it("incoming goods count; reaching the reorder point within the review period → SOON", () => {
    expect(plan({ weekly, sigma: 10, leadTimeDays: 3, reviewDays: 7, serviceLevel: 95, usable: 20, incoming: 200 }).urgency).toBeNull();
    const s = plan({ weekly, sigma: 10, leadTimeDays: 3, reviewDays: 7, serviceLevel: 95, usable: 100, incoming: 0 });
    expect(s.urgency).toBe("SOON");
    expect(s.orderInDays).toBe(5);
  });

  it("already on order: no 'order soon' top-up; still asks for more when the order isn't enough", () => {
    // same position as the SOON case above, but part of it is an order on the way
    expect(plan({ weekly, sigma: 10, leadTimeDays: 3, reviewDays: 7, serviceLevel: 95, usable: 40, incoming: 60 }).urgency).toBeNull();
    const short = plan({ weekly, sigma: 10, leadTimeDays: 3, reviewDays: 7, serviceLevel: 95, usable: 5, incoming: 10 });
    expect(["ORDER_NOW", "LATE"]).toContain(short.urgency);
    expect(short.qty).toBeGreaterThan(0);
  });

  it("a manual reorder point is a floor", () => {
    const p = plan({ weekly, sigma: 10, leadTimeDays: 3, reviewDays: 7, serviceLevel: 95, usable: 150, incoming: 0, manualReorderPoint: 200 });
    expect(p.reorderPoint).toBe(200);
    expect(p.urgency).toBe("ORDER_NOW");
  });

  it("higher service level → more safety stock", () => {
    const a = plan({ weekly, sigma: 10, leadTimeDays: 5, reviewDays: 7, serviceLevel: 90, usable: 0, incoming: 0 });
    const b = plan({ weekly, sigma: 10, leadTimeDays: 5, reviewDays: 7, serviceLevel: 99, usable: 0, incoming: 0 });
    expect(b.safetyStock).toBeGreaterThan(a.safetyStock);
  });
});

describe("lead times & accuracy", () => {
  const s = (sent: string, got: string | null, exp: string) => ({ sentAt: D(sent), receivedAt: got ? D(got) : null, expectedOn: D(exp), ordered: 10, received: got ? 10 : 0 });
  it("measured from sent to received; on time against the promised date", () => {
    const st = leadStats([s("2026-10-01", "2026-10-08", "2026-10-06"), s("2026-10-10", "2026-10-15", "2026-10-15"), s("2026-10-20", "2026-10-26", "2026-10-25"), s("2026-11-01", null, "2026-11-05")]);
    expect(st.orders).toBe(3);
    expect(st.measured).toBe(6);
    expect(st.onTimePct).toBe(33);
    expect(st.fillPct).toBe(100);
    expect(leadTimeToUse(2, st, true)).toEqual({ days: 6, source: "MEASURED" });
    expect(leadTimeToUse(2, st, false)).toEqual({ days: 2, source: "STATED" });
    expect(leadTimeToUse(2, { ...st, orders: 2 }, true).source).toBe("STATED");
  });

  it("accuracy = 1 − WAPE; bias shows over-forecasting", () => {
    const a = accuracy([{ qty: 12, actual: 10 }, { qty: 12, actual: 10 }]);
    expect(a.accuracyPct).toBe(80);
    expect(a.biasPct).toBe(20);
    expect(accuracy([]).accuracyPct).toBeNull();
  });
});

describe("overstock & expiry", () => {
  const weekly = Array(8).fill(7); // 1 a day
  it("first-expiry-first-out: what won't sell before its date is at risk", () => {
    const r = expiryRisk([{ id: "b", free: 20, daysLeft: 30 }, { id: "a", free: 10, daysLeft: 5 }, { id: "c", free: 50, daysLeft: null }], weekly);
    expect(r.find((x) => x.id === "a")).toEqual({ id: "a", sells: 5, atRisk: 5 });
    expect(r.find((x) => x.id === "b")).toEqual({ id: "b", sells: 20, atRisk: 0 }); // 30 days of demand − 5 used by "a"
    expect(r.find((x) => x.id === "c")!.atRisk).toBe(0);
  });

  it("overstock beyond the cover limit; nothing selling = all of it", () => {
    expect(overstock(100, weekly, 60).excess).toBe(40);
    expect(overstock(30, weekly, 60).excess).toBe(0);
    expect(overstock(30, [0], 60)).toEqual({ excess: 30, coverDays: null, noSales: true });
  });

  it("markdown deepens closer to the date; weekday shares add up", () => {
    expect([markdownPct(2), markdownPct(6), markdownPct(12), markdownPct(25)]).toEqual([40, 25, 15, 10]);
    expect(weekdayProfile([1, 1, 1, 1, 4, 2, 0]).reduce((a, v) => a + v, 0)).toBeCloseTo(1, 3);
  });

  it("stock that won't sell here goes to the warehouse that needs it; otherwise a markdown close to the date", () => {
    const row = (addressId: string, warehouse: string, weeklyUnits: number, usable: number, batches: PlanRow["batches"]) => ({
      key: `o|${addressId}`, offerId: "o", addressId, warehouse, product: { en: "Milk" }, packaging: { en: "1L" }, sku: null, categoryPath: "/",
      forecast: Array(8).fill(weeklyUnits), usable, incoming: 0, onHand: usable, avgCost: 2, batches,
      plan: { dailyDemand: weeklyUnits / 7, safetyStock: 0 }, overstock: { excess: 0, coverDays: null, noSales: false, value: 0 },
    }) as unknown as PlanRow;
    const b = { id: "b1", lotCode: "L1", expiresOn: D("2026-12-01"), daysLeft: 10, free: 50, sells: 10, atRisk: 40, value: 80, expired: false };
    const cp = { rows: [row("A", "North", 7, 50, [b]), row("B", "South", 70, 20, [])], settings: { overstockDays: 60 }, markdown: true } as unknown as CompanyPlan;
    const r = riskRows(cp);
    expect(r[0].kind).toBe("EXPIRY");
    expect(r[0].action).toEqual({ kind: "TRANSFER", toAddressId: "B", to: "South", qty: 40 });
    const alone = { ...cp, rows: [cp.rows[0]] } as CompanyPlan;
    expect(riskRows(alone)[0].action).toEqual({ kind: "MARKDOWN", pct: 15, batchId: "b1", enabled: true });
  });
});
