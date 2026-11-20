/** Phase 49: buying groups (pure) — FIRINGI's settings and how a pooled bonus is shared between members. */
import { describe, expect, it } from "vitest";
import { cleanGroupSettings, DEFAULT_GROUP_SETTINGS, mergeGroupSettings, shareMoney, shareUnits } from "@/lib/buying-groups";

const sum = (a: number[]) => Math.round(a.reduce((x, y) => x + y, 0) * 100) / 100;

describe("sharing a pooled bonus by purchases", () => {
  it("money: in proportion, to the cent, adding up exactly", () => {
    expect(shareMoney(100, [1, 1, 1])).toEqual([33.34, 33.33, 33.33]);
    expect(shareMoney(90, [3000, 1500, 0])).toEqual([60, 30, 0]);
    const x = shareMoney(123.45, [1720.5, 330, 9910.25, 0, 4100]);
    expect(sum(x)).toBe(123.45);
    expect(x[3]).toBe(0);
  });
  it("money: nothing to share, or nobody bought", () => {
    expect(shareMoney(0, [10, 20])).toEqual([0, 0]);
    expect(shareMoney(50, [0, 0])).toEqual([0, 0]);
    expect(shareMoney(50, [-5, 10])).toEqual([0, 50]); // a negative (more returned than bought) gets nothing
  });
  it("units: whole free units, largest remainders, never to a member who bought nothing", () => {
    expect(shareUnits(5, [10, 10, 10])).toEqual([2, 2, 1]);
    expect(shareUnits(3, [60, 30, 10])).toEqual([2, 1, 0]);
    expect(shareUnits(1, [0, 5])).toEqual([0, 1]);
    const u = shareUnits(17, [7, 3, 11, 0, 2]);
    expect(u.reduce((a, b) => a + b, 0)).toBe(17);
    expect(u[3]).toBe(0);
  });
});

describe("FIRINGI's settings", () => {
  it("merged with the defaults", () => {
    const m = mergeGroupSettings({ features: { groupOrders: false } as never, members: { WHOLESALER: false } as never, maxMembers: 20 });
    expect(m.features).toEqual({ pooledRebates: true, groupPrices: true, reports: true, groupOrders: false });
    expect(m.members).toEqual({ CUSTOMER: true, WHOLESALER: false });
    expect(m.creators).toEqual(DEFAULT_GROUP_SETTINGS.creators);
    expect(m.maxMembers).toBe(20);
    expect(mergeGroupSettings(null)).toEqual(DEFAULT_GROUP_SETTINGS);
  });
  it("checked and cleaned", () => {
    expect(() => cleanGroupSettings({ ...DEFAULT_GROUP_SETTINGS, maxMembers: 1 })).toThrow(/Members per group/);
    expect(() => cleanGroupSettings({ ...DEFAULT_GROUP_SETTINGS, roundMaxDays: 90 })).toThrow(/Days a group order/);
    const c = cleanGroupSettings({ ...DEFAULT_GROUP_SETTINGS, approval: "weird" as never, maxMembers: 12.6, features: { pooledRebates: 1 } as never });
    expect(c.approval).toBe("ALWAYS");
    expect(c.maxMembers).toBe(13);
    expect(c.features).toEqual({ pooledRebates: true, groupPrices: false, reports: false, groupOrders: false });
  });
});
