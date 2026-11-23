import { describe, expect, it } from "vitest";
import { cashVariance, changeDue, estimateGross, lotLeft, mergeVanSalesSettings, sellable, splitReturn, takeFromLots } from "@/lib/van-sales";

const lot = (id: string, offerId: string, expiresOn: string | null, loaded: number, sold = 0, extra: Partial<{ blocked: boolean }> = {}) => ({ id, offerId, expiresOn, qtyLoaded: loaded, qtySold: sold, qtyBack: 0, qtyLost: 0, ...extra });
const today = new Date("2026-11-20T10:00:00Z");

describe("van sales rules", () => {
  it("sells first to expire first, never blocked or past the date", () => {
    const lots = [lot("a", "x", "2026-12-31", 5), lot("b", "x", "2026-11-25", 3), lot("c", "x", "2026-11-19", 9), lot("d", "x", null, 4), lot("e", "x", "2026-11-22", 2, 0, { blocked: true })];
    expect(takeFromLots(lots, "x", 6, today)).toEqual([{ lotId: "b", qty: 3 }, { lotId: "a", qty: 3 }]);
    expect(takeFromLots(lots, "x", 12, today)).toEqual([{ lotId: "b", qty: 3 }, { lotId: "a", qty: 5 }, { lotId: "d", qty: 4 }]);
    expect(takeFromLots(lots, "x", 13, today)).toBeNull();
    expect(takeFromLots(lots, "x", 0, today)).toBeNull();
    expect(sellable(lots, today).get("x")).toBe(12);
  });
  it("counts back on the latest-to-expire lots; the rest is missing", () => {
    const lots = [lot("a", "x", "2026-11-25", 5, 3), lot("b", "x", "2026-12-31", 4), lot("c", "y", null, 2)];
    const r = splitReturn(lots, { x: 5 });
    expect(r.get("b")).toEqual({ back: 4, lost: 0 });
    expect(r.get("a")).toEqual({ back: 1, lost: 1 });
    expect(r.get("c")).toEqual({ back: 0, lost: 2 });
    expect(splitReturn(lots, { x: 99 }).get("a")).toEqual({ back: 2, lost: 0 });
    expect(lotLeft({ qtyLoaded: 5, qtySold: 3, qtyBack: 1, qtyLost: 1 })).toBe(0);
  });
  it("cash, change and the phone's estimate", () => {
    expect(cashVariance(120.5, 118.5)).toBe(-2);
    expect(changeDue(18.3, 20)).toBe(1.7);
    expect(changeDue(18.3, 10)).toBe(0);
    expect(estimateGross([{ qty: 3, unitNet: 1.1, vatPct: 6 }, { qty: 1, unitNet: 10, vatPct: 23 }])).toEqual({ net: 13.3, vat: 2.5, gross: 15.8 });
  });
  it("settings are merged and clamped", () => {
    const s = mergeVanSalesSettings({ maxCashPerSale: -5, methods: { CARD: false } as never, maxRoundHours: 500, disabledVendors: ["a", "a", 3 as never] });
    expect(s.maxCashPerSale).toBe(0);
    expect(s.methods).toEqual({ CASH: true, CARD: false, MB_WAY: true, ON_ACCOUNT: true });
    expect(s.maxRoundHours).toBe(72);
    expect(s.disabledVendors).toEqual(["a"]);
    expect(mergeVanSalesSettings(null).enabled).toBe(true);
  });
});
