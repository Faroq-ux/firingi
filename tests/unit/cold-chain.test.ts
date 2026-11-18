import { describe, expect, it } from "vitest";
import { classify, DEFAULT_COLD_CHAIN_SETTINGS, effectiveClass, inferFault, mergeColdChainSettings, minutesOutNow, monthRange, nextDue, parseC, rangeLabel, tripStats } from "@/lib/cold-chain";

const CHILLED = { minC: 0, maxC: 4, toleranceC: 1 };
const FROZEN = { minC: null, maxC: -18, toleranceC: 3 };
const t = (min: number) => new Date(Date.UTC(2026, 10, 17, 10, min));

describe("cold-chain rules", () => {
  it("classifies readings: in range, within tolerance, out", () => {
    expect(classify(3, CHILLED)).toBe("OK");
    expect(classify(4, CHILLED)).toBe("OK");
    expect(classify(4.8, CHILLED)).toBe("WARN");
    expect(classify(5.1, CHILLED)).toBe("OUT");
    expect(classify(-1, CHILLED)).toBe("WARN");
    expect(classify(-22, FROZEN)).toBe("OK");
    expect(classify(-16, FROZEN)).toBe("WARN");
    expect(classify(-14, FROZEN)).toBe("OUT");
  });

  it("labels and parses temperatures", () => {
    expect(rangeLabel(CHILLED)).toBe("0–4 °C");
    expect(rangeLabel(FROZEN)).toBe("≤ −18 °C");
    expect(rangeLabel({ minC: 2, maxC: null })).toBe("≥ 2 °C");
    expect(rangeLabel({ minC: -1.5, maxC: 2 })).toBe("−1,5–2 °C");
    expect(parseC("−18,5")).toBe(-18.5);
    expect(parseC("-18.5 °C")).toBe(-18.5);
    expect(parseC("3")).toBe(3);
    expect(parseC(4.25)).toBe(4.3);
    expect(parseC("abc")).toBeNull();
    expect(parseC("120")).toBeNull();
    expect(parseC(null)).toBeNull();
  });

  it("settings, class of an offer, fault", () => {
    expect(mergeColdChainSettings({ actions: { block: true } as never }).actions).toEqual({ ...DEFAULT_COLD_CHAIN_SETTINGS.actions, block: true });
    expect(mergeColdChainSettings(null)).toEqual(DEFAULT_COLD_CHAIN_SETTINGS);
    expect(effectiveClass("own", ["cat"])).toBe("own");
    expect(effectiveClass(null, [null, "parent"])).toBe("parent");
    expect(effectiveClass(undefined, [null, undefined])).toBeNull();
    expect(inferFault({ dispatch: "OUT", loading: "OK", firingiFleet: true })).toBe("SUPPLIER");
    expect(inferFault({ dispatch: "OK", loading: "OUT", firingiFleet: true })).toBe("SUPPLIER");
    expect(inferFault({ dispatch: "OK", loading: "OK", firingiFleet: true })).toBe("DRIVER");
    expect(inferFault({ loading: "WARN", firingiFleet: false })).toBe("SUPPLIER");
    expect(inferFault({ dispatch: "OK", firingiFleet: true })).toBe("DRIVER");
    expect(inferFault({ firingiFleet: true })).toBe("FIRINGI");
    expect(inferFault({ firingiFleet: false })).toBe("SUPPLIER");
  });

  it("trip stats, minutes out now, due dates, months", () => {
    const rows = [0, 5, 10, 15, 20].map((m, i) => ({ at: t(m), valueC: [3, 6, 7, 3, 2][i] }));
    expect(tripStats(rows, CHILLED)).toMatchObject({ count: 5, minC: 2, maxC: 7, avgC: 4.2, minutesOut: 10, longestOut: 10 });
    expect(tripStats([], CHILLED)).toBeNull();
    expect(minutesOutNow([{ at: t(0), valueC: 3 }, { at: t(5), valueC: 7 }, { at: t(20), valueC: 8 }], CHILLED)).toBe(15);
    expect(minutesOutNow([{ at: t(0), valueC: 7 }, { at: t(5), valueC: 3 }], CHILLED)).toBe(0);
    expect(nextDue(null, 7, t(0))?.toISOString()).toBe(new Date(t(0).getTime() + 7 * 86_400_000).toISOString());
    expect(nextDue(t(0), null, t(0))).toBeNull();
    expect(monthRange("2026-11")?.map((d) => d.toISOString().slice(0, 10))).toEqual(["2026-11-01", "2026-12-01"]);
    expect(monthRange("2026-13")).toBeNull();
  });
});
