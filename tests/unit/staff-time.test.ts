import { describe, expect, it } from "vitest";
import {
  DEFAULT_STAFF_SETTINGS as S, breakMinutes, cleanStaffSettings, easter, entryFlags, labourShare, leaveDays, localParts, matchShift, mergeStaffSettings, nationalHolidays, rotaWarnings, splitWork, weekStartOf, weekTotals, zoneOf, hm,
} from "@/lib/staff-time";

const at = (iso: string) => new Date(iso);
const LIS = "Europe/Lisbon";

describe("staff time rules (Phase 52)", () => {
  it("reads local days and weeks in the site's zone", () => {
    expect(zoneOf("PT")).toBe(LIS);
    expect(zoneOf("DE")).toBe("Europe/Berlin");
    expect(zoneOf(null)).toBe(LIS);
    // 23:30 UTC on Sunday is already Monday in Berlin
    expect(localParts(at("2026-11-22T23:30:00Z"), "Europe/Berlin").day).toBe("2026-11-23");
    expect(weekStartOf(at("2026-11-26T10:00:00Z"), LIS)).toBe("2026-11-23");
    expect(weekStartOf(at("2026-11-22T23:30:00Z"), "Europe/Berlin")).toBe("2026-11-23");
  });

  it("counts worked, night and public-holiday minutes, breaks taken out", () => {
    const e = { clockIn: at("2026-12-24T18:00:00Z"), clockOut: at("2026-12-25T02:00:00Z"), breaks: [{ start: "2026-12-24T21:00:00.000Z", end: "2026-12-24T21:30:00.000Z" }] };
    const days = splitWork([e], LIS, new Set(["2026-12-25"]), S.rules);
    expect(days.get("2026-12-24")).toEqual({ worked: 330, night: 120, holiday: 0 }); // 18:00–24:00 minus the 21:00 break; night 22:00–24:00
    expect(days.get("2026-12-25")).toEqual({ worked: 120, night: 120, holiday: 120 });
    expect(breakMinutes(e.breaks)).toBe(30);
  });

  it("overtime is the larger of daily and weekly overtime", () => {
    const days = new Map([["a", { worked: 600, night: 0, holiday: 0 }], ["b", { worked: 480, night: 0, holiday: 0 }]]);
    expect(weekTotals(days, S.rules).overtimeMinutes).toBe(120); // 10 h day → 2 h; 18 h week < 40 h
    const five = new Map(Array.from({ length: 6 }, (_, i) => [String(i), { worked: 450, night: 0, holiday: 0 }]));
    expect(weekTotals(five, S.rules).overtimeMinutes).toBe(300); // 45 h week → 5 h, no day over 8 h
  });

  it("warns on rota breaking the working-time rules", () => {
    const sh = (id: string, s: string, e: string, b = 30) => ({ id, startsAt: at(s), endsAt: at(e), breakMinutes: b });
    const r = rotaWarnings([
      sh("a", "2026-11-23T14:00:00Z", "2026-11-23T23:00:00Z"),
      sh("b", "2026-11-24T06:00:00Z", "2026-11-24T14:00:00Z"), // 7 h rest
      sh("c", "2026-11-25T08:00:00Z", "2026-11-25T16:00:00Z", 0), // 8 h without a break
      sh("d", "2026-11-25T15:00:00Z", "2026-11-25T18:00:00Z", 0), // overlaps c
    ], S.rules, [{ start: at("2026-11-25T00:00:00Z"), end: at("2026-11-26T00:00:00Z") }]);
    expect(r.warnings.get("b")).toContain("SHORT_REST");
    expect(r.warnings.get("c")).toEqual(expect.arrayContaining(["NO_BREAK", "OVERLAP", "ON_LEAVE"]));
    expect(r.warnings.get("d")).toContain("OVERLAP");
    expect(r.warnings.get("a")).toBeUndefined();
    const long = Array.from({ length: 6 }, (_, i) => sh(`w${i}`, `2026-11-${23 + i}T06:00:00Z`, `2026-11-${23 + i}T15:00:00Z`, 30));
    expect(rotaWarnings(long, S.rules).warnings.get("w0")).toContain("WEEK_OVER_MAX"); // 51 h > 48 h
  });

  it("flags late, left early, outside the area and no break", () => {
    const shift = { startsAt: at("2026-11-23T09:00:00Z"), endsAt: at("2026-11-23T17:00:00Z") };
    expect(entryFlags({ clockIn: at("2026-11-23T09:04:00Z"), clockOut: null, breaks: [] }, shift, S)).toEqual([]);
    const f = entryFlags({ clockIn: at("2026-11-23T09:20:00Z"), clockOut: at("2026-11-23T16:00:00Z"), breaks: [], inDistanceM: 400 }, shift, S);
    expect(f).toEqual(expect.arrayContaining(["LATE", "EARLY_LEAVE", "OUTSIDE_AREA", "NO_BREAK"]));
    expect(entryFlags({ clockIn: at("2026-11-23T09:00:00Z"), clockOut: null, breaks: [] }, null, S)).toContain("NO_SHIFT");
    expect(entryFlags({ clockIn: at("2026-11-23T09:00:00Z"), clockOut: null, breaks: [], inDistanceM: 400 }, shift, { ...S, clock: { ...S.clock, location: false } })).not.toContain("OUTSIDE_AREA");
  });

  it("matches a clock-in to the nearest planned shift", () => {
    const a = { id: "a", startsAt: at("2026-11-23T09:00:00Z"), endsAt: at("2026-11-23T13:00:00Z") }, b = { id: "b", startsAt: at("2026-11-23T14:00:00Z"), endsAt: at("2026-11-23T18:00:00Z") };
    expect(matchShift(at("2026-11-23T08:30:00Z"), [a, b])?.id).toBe("a");
    expect(matchShift(at("2026-11-23T13:40:00Z"), [a, b])?.id).toBe("b");
    expect(matchShift(at("2026-11-23T20:00:00Z"), [a, b])).toBeNull();
  });

  it("counts leave in working days, public holidays and weekends left out", () => {
    expect(leaveDays("2026-12-21", "2027-01-03", new Set(["2026-12-25", "2027-01-01"]))).toBe(8);
    expect(leaveDays("2026-11-23", "2026-11-23", new Set(), true)).toBe(0.5);
  });

  it("knows Easter and the national holidays", () => {
    expect(easter(2026)).toBe("2026-04-05");
    expect(easter(2027)).toBe("2027-03-28");
    expect(easter(2024)).toBe("2024-03-31");
    const pt = nationalHolidays("PT", 2026);
    expect(pt).toHaveLength(13);
    expect(pt.find((h) => h.name === "Corpo de Deus")?.date).toBe("2026-06-04");
    expect(pt.find((h) => h.name === "Sexta-feira Santa")?.date).toBe("2026-04-03");
    expect(nationalHolidays("NL", 2026).find((h) => h.name === "Koningsdag")?.date).toBe("2026-04-27");
    expect(nationalHolidays("XX", 2026)).toEqual([]);
  });

  it("settings: defaults, limits, labour share", () => {
    const m = mergeStaffSettings({ clock: { radiusM: 300 } as never });
    expect(m.clock.radiusM).toBe(300);
    expect(m.clock.phone).toBe(true);
    expect(() => cleanStaffSettings({ ...S, clock: { ...S.clock, radiusM: 5 } })).toThrow(/distance/);
    expect(() => cleanStaffSettings({ ...S, rules: { ...S.rules, nightFrom: "25:00" } })).toThrow(/Night from/);
    expect(cleanStaffSettings({ ...S, clock: { ...S.clock, outside: "x" as never } }).clock.outside).toBe("FLAG");
    expect(labourShare(300, 1000)).toBe(30);
    expect(labourShare(10, 0)).toBeNull();
    expect(hm(425)).toBe("7 h 05");
  });
});
