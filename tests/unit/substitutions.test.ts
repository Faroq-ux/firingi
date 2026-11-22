/** Phase 60: substitution rules (pure). */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SUBSTITUTION_SETTINGS as S, effectiveRule, freeShort, matchedUnitPrice, mergeSubstitutionSettings, priceDiffPct, verdict,
} from "@/lib/substitutions";

describe("substitution rules", () => {
  it("settings are clamped and defaulted", () => {
    expect(mergeSubstitutionSettings(null)).toEqual(S);
    const m = mergeSubstitutionSettings({ responseMinutes: 1, defaultMaxPricePct: 400, defaultMode: "WHATEVER" as never, allowAuto: false });
    expect(m.responseMinutes).toBe(5);
    expect(m.defaultMaxPricePct).toBe(100);
    expect(m.defaultMode).toBe("ASK");
    expect(m.allowAuto).toBe(false);
  });

  it("a product rule overrides the general rule; FIRINGI can switch automatic acceptance off", () => {
    const pref = { mode: "AUTO" as const, maxPricePct: 5, sameBrandOnly: true, acceptOnTimeout: true };
    expect(effectiveRule(S, null, null)).toEqual({ mode: "ASK", maxPricePct: 10, sameBrandOnly: false, acceptOnTimeout: false });
    expect(effectiveRule(S, pref, null).mode).toBe("AUTO");
    expect(effectiveRule(S, pref, "NEVER").mode).toBe("NEVER");
    expect(effectiveRule({ ...S, allowAuto: false }, pref, null).mode).toBe("ASK");
    expect(effectiveRule({ ...S, allowAuto: false }, null, "AUTO").mode).toBe("ASK");
  });

  it("price difference compares what the replacement costs with what the missing units cost", () => {
    expect(priceDiffPct({ unitNet: 10, qty: 4 }, { unitNet: 22, qty: 2 })).toBe(10);
    expect(priceDiffPct({ unitNet: 10, qty: 4 }, { unitNet: 9, qty: 4 })).toBe(-10);
    expect(priceDiffPct({ unitNet: 0, qty: 4 }, { unitNet: 1, qty: 1 })).toBe(100);
    // same price: never more than the missing units cost, never more than the normal price
    expect(matchedUnitPrice({ unitNet: 10, qty: 4 }, { unitNet: 22, qty: 2 })).toBe(20);
    expect(matchedUnitPrice({ unitNet: 10, qty: 4 }, { unitNet: 18, qty: 2 })).toBe(18);
    expect(matchedUnitPrice({ unitNet: 10, qty: 1 }, { unitNet: 5, qty: 3 })).toBe(3.3333);
  });

  it("verdict: never / ask / automatic within the limits", () => {
    const auto = { mode: "AUTO" as const, maxPricePct: 10, sameBrandOnly: true, acceptOnTimeout: false };
    expect(verdict({ ...auto, mode: "NEVER" }, { diffPct: -50, sameBrand: true })).toBe("BLOCKED");
    expect(verdict({ ...auto, mode: "ASK" }, { diffPct: -50, sameBrand: true })).toBe("ASK");
    expect(verdict(auto, { diffPct: 10, sameBrand: true })).toBe("AUTO");
    expect(verdict(auto, { diffPct: 10.01, sameBrand: true })).toBe("ASK");
    expect(verdict(auto, { diffPct: 0, sameBrand: false })).toBe("ASK");
    expect(verdict({ ...auto, sameBrandOnly: false }, { diffPct: 0, sameBrand: false })).toBe("AUTO");
  });

  it("short units not yet replaced", () => {
    expect(freeShort({ qtyOrdered: 10, qtyConfirmed: 6, substitutedQty: 0 }, 0)).toBe(4);
    expect(freeShort({ qtyOrdered: 10, qtyConfirmed: 6, substitutedQty: 3 }, 1)).toBe(0);
    expect(freeShort({ qtyOrdered: 10, qtyConfirmed: null, substitutedQty: 0 }, 0)).toBe(0);
  });
});
