/** Phase 68: service schedules, fryer oil status, used-oil storage, visit money (who invoices) and the switches. */
import { describe, expect, it } from "vitest";
import { BUILT_IN_SERVICES, DEFAULT_OIL, fryerStatus, isoDay, nextVisit, scheduleWords, storage, visitDates, visitMoney, type PlanSchedule } from "@/lib/services";
import { customerOn, mergeServices, providerOn } from "@/server/servicing/settings";

const D = (s: string) => new Date(`${s}T00:00:00Z`);
const days = (p: PlanSchedule, a: string, b: string) => visitDates(p, D(a), D(b)).map(isoDay);
const plan = (x: Partial<PlanSchedule>): PlanSchedule => ({ frequency: "WEEKLY", weekday: 2, dayA: 1, dayB: 15, startsOn: D("2026-11-02"), ...x });

describe("visit dates", () => {
  it("weekly: every chosen weekday", () => {
    // 2026-11-02 is a Monday; weekday 2 = Tuesday
    expect(days(plan({}), "2026-11-01", "2026-11-30")).toEqual(["2026-11-03", "2026-11-10", "2026-11-17", "2026-11-24"]);
  });
  it("every 2 weeks: counted from the start, also when planning from later", () => {
    const p = plan({ frequency: "BIWEEKLY" });
    expect(days(p, "2026-11-01", "2026-12-31")).toEqual(["2026-11-03", "2026-11-17", "2026-12-01", "2026-12-15", "2026-12-29"]);
    expect(days(p, "2026-11-20", "2026-12-20")).toEqual(["2026-12-01", "2026-12-15"]);
  });
  it("twice a month and monthly; day 31 moves to the month's last day", () => {
    expect(days(plan({ frequency: "TWICE_MONTHLY", dayA: 15, dayB: 1 }), "2026-11-02", "2027-01-10")).toEqual(["2026-11-15", "2026-12-01", "2026-12-15", "2027-01-01"]);
    expect(days(plan({ frequency: "MONTHLY", dayA: 31 }), "2027-01-01", "2027-04-30")).toEqual(["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30"]);
  });
  it("nothing before the plan starts; on request has no dates", () => {
    expect(days(plan({ startsOn: D("2026-11-20") }), "2026-11-01", "2026-11-30")).toEqual(["2026-11-24"]);
    expect(days(plan({ frequency: "ON_REQUEST" }), "2026-11-01", "2027-11-30")).toEqual([]);
    expect(nextVisit(plan({ frequency: "MONTHLY", dayA: 5 }), D("2026-11-06"))?.toISOString().slice(0, 10)).toBe("2026-12-05");
  });
  it("words", () => {
    expect(scheduleWords(plan({}))).toBe("every Tuesday");
    expect(scheduleWords(plan({ frequency: "TWICE_MONTHLY" }))).toBe("on day 1 and 15");
  });
});

describe("fryer oil", () => {
  const now = D("2026-11-23");
  it("days since the change decide without a test", () => {
    expect(fryerStatus({ lastChangeAt: D("2026-11-21"), lastPolarPct: null }, DEFAULT_OIL, now).status).toBe("OK");
    expect(fryerStatus({ lastChangeAt: D("2026-11-17"), lastPolarPct: null }, DEFAULT_OIL, now).status).toBe("SOON");
    expect(fryerStatus({ lastChangeAt: D("2026-11-16"), lastPolarPct: null }, DEFAULT_OIL, now)).toEqual({ status: "CHANGE", days: 7 });
    expect(fryerStatus({ lastChangeAt: null, lastPolarPct: null }, DEFAULT_OIL, now)).toEqual({ status: "OK", days: null });
  });
  it("the tester reading (polar compounds %) overrides", () => {
    expect(fryerStatus({ lastChangeAt: D("2026-11-22"), lastPolarPct: 21 }, DEFAULT_OIL, now).status).toBe("SOON");
    expect(fryerStatus({ lastChangeAt: D("2026-11-22"), lastPolarPct: 24 }, DEFAULT_OIL, now).status).toBe("CHANGE");
  });
  it("containers: % full and the full flag; unknown size", () => {
    expect(storage(85, 100, 80)).toEqual({ litres: 85, capacity: 100, pct: 85, full: true });
    expect(storage(40, 100, 80).full).toBe(false);
    expect(storage(40, null, 80)).toEqual({ litres: 40, capacity: null, pct: null, full: false });
  });
});

describe("visit money: who invoices the customer", () => {
  const oil = BUILT_IN_SERVICES.find((t) => t.code === "OIL_COLLECTION")!;
  const pest = BUILT_IN_SERVICES.find((t) => t.code === "PEST_CONTROL")!;
  it("FIRINGI invoices: fee and buy-back, the provider's amount, no commission", () => {
    expect(visitMoney(oil, 100, "FIRINGI")).toEqual({ fee: 0, buyback: 20, provider: 5, commission: 0 });
    expect(visitMoney(pest, 1, "FIRINGI")).toEqual({ fee: 45, buyback: 0, provider: 35, commission: 0 });
  });
  it("the provider invoices: FIRINGI gets a commission only (% + per visit + per unit)", () => {
    expect(visitMoney(pest, 1, "PROVIDER")).toEqual({ fee: 45, buyback: 0, provider: 0, commission: 6.75 });
    expect(visitMoney(oil, 100, "PROVIDER")).toEqual({ fee: 0, buyback: 20, provider: 0, commission: 3 });
    expect(visitMoney({ ...pest, commissionPct: 10, commissionPerVisit: 2, commissionPerUnit: 0 }, 1, "PROVIDER").commission).toBe(6.5);
  });
});

describe("switches", () => {
  const c = (type: string, id = "c1") => ({ id, type });
  it("audiences and providers by type, per-business override, master switch", () => {
    const s = mergeServices({ audiences: { customers: true, wholesalers: false }, providers: { distributors: true, wholesalers: false, firingi: true } });
    expect(customerOn(s, c("CUSTOMER"))).toBe(true);
    expect(customerOn(s, c("WHOLESALER"))).toBe(false);
    expect(customerOn({ ...s, companies: { c1: "ON" } }, c("WHOLESALER"))).toBe(true);
    expect(customerOn({ ...s, companies: { c1: "OFF" } }, c("CUSTOMER"))).toBe(false);
    expect(providerOn(s, c("DISTRIBUTOR"))).toBe(true);
    expect(providerOn(s, c("WHOLESALER"))).toBe(false);
    expect(providerOn(s, c("ADMIN"))).toBe(true);
    expect(customerOn({ ...s, enabled: false }, c("CUSTOMER"))).toBe(false);
  });
  it("numbers are kept in range", () => {
    const s = mergeServices({ oil: { changeDays: 0, warnPolarPct: 99, maxPolarPct: 24, fullPct: 10 }, reminderHours: 9999 } as never);
    expect(s.oil).toEqual({ changeDays: 1, warnPolarPct: 40, maxPolarPct: 24, fullPct: 30 });
    expect(s.reminderHours).toBe(168);
  });
});
