/** Phase 50 (pure): pay-later fees, schedules, models per country, settings; tender bid ranking, award grouping, settings. */
import { describe, expect, it } from "vitest";
import { cleanPayLater, countryModels, DEFAULT_PAY_LATER, feeFor, lastDueDays, mergePayLater, modelOrder, schedule } from "@/lib/pay-later";
import { cheapestAward, cleanTenderSettings, DEFAULT_TENDER_SETTINGS, groupAward, rankBids } from "@/lib/tenders";

const term = (p = {}) => ({ feePct: 2, feeFixed: 0, feePayer: "BUYER" as const, buyerSharePct: 50, ...p });

describe("pay later — fees", () => {
  it("the buyer, FIRINGI or both pay it", () => {
    expect(feeFor(term(), 500)).toEqual({ total: 10, buyer: 10, firingi: 0 });
    expect(feeFor(term({ feePayer: "FIRINGI" }), 500)).toEqual({ total: 10, buyer: 0, firingi: 10 });
    expect(feeFor(term({ feePayer: "SHARED", buyerSharePct: 25 }), 500)).toEqual({ total: 10, buyer: 2.5, firingi: 7.5 });
    expect(feeFor(term({ feePct: 1.5, feeFixed: 2 }), 333.33)).toEqual({ total: 7, buyer: 7, firingi: 0 }); // 5.00 + 2
    expect(feeFor(term({ feeFixed: 5 }), 0).total).toBe(0);
  });
});

describe("pay later — schedules", () => {
  const from = new Date("2026-01-31T10:00:00Z");
  it("N days: one payment", () => {
    expect(schedule({ kind: "DAYS", days: 60, count: 0 }, from, 123.45)).toEqual([{ n: 1, dueAt: new Date("2026-04-01T10:00:00Z"), amount: 123.45 }]);
    expect(lastDueDays({ kind: "DAYS", days: 90, count: 0 }, from)).toBe(90);
  });
  it("monthly instalments: month ends kept, cents spread, the last takes the rest", () => {
    const s = schedule({ kind: "INSTALMENTS", days: 0, count: 3 }, from, 100);
    expect(s.map((i) => i.dueAt.toISOString().slice(0, 10))).toEqual(["2026-02-28", "2026-03-31", "2026-04-30"]);
    expect(s.map((i) => i.amount)).toEqual([33.33, 33.33, 33.34]);
    expect(s.reduce((a, i) => a + i.amount, 0)).toBeCloseTo(100, 2);
  });
});

describe("pay later — who finances it, settings", () => {
  it("per country, the first model then the other; switched-off models are skipped", () => {
    const s = mergePayLater({ countries: { PT: { partner: true, own: true, first: "OWN" }, DE: { partner: true, own: false, first: "OWN" } } });
    expect(modelOrder(countryModels(s, "PT"))).toEqual(["OWN", "PARTNER"]);
    expect(modelOrder(countryModels(s, "DE"))).toEqual(["PARTNER"]);
    expect(modelOrder(countryModels(s, "FR"))).toEqual(["PARTNER", "OWN"]); // the default
  });
  it("defaults and checks", () => {
    expect(DEFAULT_PAY_LATER.terms.filter((t) => t.enabled).map((t) => t.id)).toEqual(["d30", "d60", "d90", "i3"]);
    expect(() => cleanPayLater({ ...DEFAULT_PAY_LATER, terms: [] })).toThrow(/at least one term/);
    expect(() => cleanPayLater({ ...DEFAULT_PAY_LATER, terms: [{ ...DEFAULT_PAY_LATER.terms[0], days: 3 }] })).toThrow(/Days/);
    expect(() => cleanPayLater({ ...DEFAULT_PAY_LATER, terms: [{ ...DEFAULT_PAY_LATER.terms[5], count: 24 }] })).toThrow(/Instalments/);
    const c = cleanPayLater({ ...DEFAULT_PAY_LATER, countries: { pt: { partner: true, own: true, first: "OWN" }, ES: { partner: true, own: false, first: "x" as never } } });
    expect(Object.keys(c.countries)).toEqual(["ES"]);
    expect(c.countries.ES.first).toBe("PARTNER");
  });
});

describe("tenders", () => {
  it("bids ranked cheapest first (ties: first come), saving against the target", () => {
    const r = rankBids([{ bidLineId: "a", supplierId: "s1", unitNet: 9.2 }, { bidLineId: "b", supplierId: "s2", unitNet: 8.9 }, { bidLineId: "c", supplierId: "s3", unitNet: 9.2 }], 9.5);
    expect(r.map((x) => [x.bidLineId, x.rank, x.belowTarget])).toEqual([["b", 1, 0.6], ["a", 2, 0.3], ["c", 3, 0.3]]);
  });
  it("cheapest award per line; awarded lines grouped by supplier (one order each)", () => {
    const award = cheapestAward([{ id: "l1", bids: [{ bidLineId: "x", supplierId: "s1", unitNet: 3 }, { bidLineId: "y", supplierId: "s2", unitNet: 2 }] }, { id: "l2", bids: [] }]);
    expect(award).toEqual({ l1: "y" });
    const g = groupAward([{ lineId: "l1", supplierId: "s2" }, { lineId: "l2", supplierId: "s1" }, { lineId: "l3", supplierId: "s2" }]);
    expect([...g.keys()]).toEqual(["s2", "s1"]);
    expect(g.get("s2")!.map((x) => x.lineId)).toEqual(["l1", "l3"]);
  });
  it("settings checked", () => {
    expect(() => cleanTenderSettings({ ...DEFAULT_TENDER_SETTINGS, minHours: 48, maxDays: 1 })).toThrow(/shortest/);
    expect(cleanTenderSettings({ ...DEFAULT_TENDER_SETTINGS, approval: "nope" as never }).approval).toBe("AUTO");
  });
});
