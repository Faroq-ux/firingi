/** Phase 69: food safety rules — limits, slots and lateness, tasks due, cooling, deliveries, drift, completion, switches. */
import { describe, expect, it } from "vitest";
import { DEFAULT_RULES, TEMPLATES, completion, coolingOk, deliveryOk, drift, inRange, limitText, slotsFor, taskDue, validTime } from "@/lib/haccp";
import { haccpOn, mergeHaccp } from "@/server/haccp/settings";

const D = (s: string) => new Date(`${s}Z`);

describe("limits", () => {
  it("in range with open ends", () => {
    expect(inRange(4, 0, 5)).toBe(true);
    expect(inRange(6, 0, 5)).toBe(false);
    expect(inRange(-20, null, -18)).toBe(true);
    expect(inRange(-15, null, -18)).toBe(false);
    expect(inRange(65, 63, null)).toBe(true);
    expect(inRange(60, 63, null)).toBe(false);
  });
  it("limit text", () => {
    expect(limitText(0, 5)).toBe("0 – 5 °C");
    expect(limitText(null, -18)).toBe("≤ −18 °C");
    expect(limitText(63, null)).toBe("≥ 63 °C");
    expect(limitText(null, null)).toBe("—");
    expect(validTime("09:00") && !validTime("9:00") && !validTime("24:00")).toBe(true);
  });
});

describe("check times", () => {
  const units = [{ id: "f1", times: ["09:00", "17:00"] }];
  it("done, out of range, due, late, later", () => {
    const day = D("2026-11-23T00:00:00");
    const now = D("2026-11-23T10:30:00");
    expect(slotsFor(units, [], day, now, 60).map((s) => s.state)).toEqual(["LATE", "LATER"]);
    expect(slotsFor(units, [], day, D("2026-11-23T09:30:00"), 60).map((s) => s.state)).toEqual(["DUE", "LATER"]);
    expect(slotsFor(units, [{ unitId: "f1", slot: "09:00", ok: false }], day, now, 60).map((s) => s.state)).toEqual(["OUT", "LATER"]);
    expect(slotsFor(units, [{ unitId: "f1", slot: "17:00", ok: true }], D("2026-11-22T00:00:00"), now, 60).map((s) => s.state)).toEqual(["LATE", "DONE"]);
  });
  it("tasks due by frequency; month end", () => {
    const mon = D("2026-11-23T00:00:00");
    expect(taskDue({ frequency: "DAILY", weekday: null, dayOfMonth: null }, mon)).toBe(true);
    expect(taskDue({ frequency: "WEEKLY", weekday: 1, dayOfMonth: null }, mon)).toBe(true);
    expect(taskDue({ frequency: "WEEKLY", weekday: 2, dayOfMonth: null }, mon)).toBe(false);
    expect(taskDue({ frequency: "MONTHLY", weekday: null, dayOfMonth: 31 }, D("2026-11-30T00:00:00"))).toBe(true);
    expect(taskDue({ frequency: "MONTHLY", weekday: null, dayOfMonth: 1 }, mon)).toBe(false);
  });
});

describe("cooling, deliveries, drift, completion", () => {
  it("cooling within the time", () => {
    expect(coolingOk(8, 110, DEFAULT_RULES)).toBe(true);
    expect(coolingOk(12, 90, DEFAULT_RULES)).toBe(false);
    expect(coolingOk(8, 150, DEFAULT_RULES)).toBe(false);
  });
  it("delivery: packaging, dates, chilled / frozen limits", () => {
    expect(deliveryOk({ packagingOk: true, datesOk: true, valueC: 4 }, DEFAULT_RULES)).toBe(true);
    expect(deliveryOk({ packagingOk: true, datesOk: true, valueC: 7 }, DEFAULT_RULES)).toBe(false);
    expect(deliveryOk({ packagingOk: true, datesOk: true, valueC: -16, frozen: true }, DEFAULT_RULES)).toBe(true);
    expect(deliveryOk({ packagingOk: false, datesOk: true, valueC: null }, DEFAULT_RULES)).toBe(false);
  });
  it("drift: out of range repeatedly or creeping to the limit", () => {
    expect(drift([3, 3, 3], 5, 0)).toBeNull();
    expect(drift([6, 7, 6.5, 3], 5, 0)?.kind).toBe("OUT");
    expect(drift([4.2, 4.5, 4.4, 4.1], 5, 0)?.kind).toBe("NEAR_MAX");
    expect(drift([2, 2.5, 3, 2], 5, 0)).toBeNull();
  });
  it("completion", () => {
    expect(completion(0, 0)).toBe(100);
    expect(completion(8, 6)).toBe(75);
    expect(completion(4, 9)).toBe(100);
  });
  it("templates use known kinds", () => {
    for (const t of TEMPLATES) { expect(t.units.length + t.tasks.length).toBeGreaterThan(0); for (const u of t.units) expect(u.times.every(validTime)).toBe(true); }
  });
});

describe("switches", () => {
  it("audiences, override, master switch; distributors never", () => {
    const s = mergeHaccp({ audiences: { customers: true, wholesalers: false } });
    expect(haccpOn(s, { id: "a", type: "CUSTOMER" })).toBe(true);
    expect(haccpOn(s, { id: "a", type: "WHOLESALER" })).toBe(false);
    expect(haccpOn({ ...s, companies: { a: "ON" } }, { id: "a", type: "WHOLESALER" })).toBe(true);
    expect(haccpOn({ ...s, companies: { a: "OFF" } }, { id: "a", type: "CUSTOMER" })).toBe(false);
    expect(haccpOn(s, { id: "a", type: "DISTRIBUTOR" })).toBe(false);
    expect(haccpOn({ ...s, enabled: false }, { id: "a", type: "CUSTOMER" })).toBe(false);
  });
  it("rules kept in range", () => {
    const s = mergeHaccp({ rules: { coolingTargetC: 99, coolingMaxMinutes: 5, graceMinutes: -3, trainingWarnDays: 9999, deliveryChilledMaxC: 5, deliveryFrozenMaxC: -15 } });
    expect(s.rules).toEqual({ coolingTargetC: 30, coolingMaxMinutes: 15, graceMinutes: 0, trainingWarnDays: 180, deliveryChilledMaxC: 5, deliveryFrozenMaxC: -15 });
  });
});
