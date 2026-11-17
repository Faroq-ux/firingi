import { describe, expect, it } from "vitest";
import {
  ageUnits, chargedUnits, DEFAULT_RETURNABLE_SETTINGS, depositVatRate, mergeReturnableSettings, overdueRule, overdueUnits, splitEmpties, unitsFor,
} from "@/lib/returnables";

const d = (s: string) => new Date(`${s}T12:00:00Z`);

describe("returnables rules", () => {
  it("merges settings over the defaults", () => {
    const s = mergeReturnableSettings({ vat: { ES: { mode: "FIXED", rate: 21 } }, overdue: { days: 30 } as never });
    expect(s.vat.PT.mode).toBe("NONE");
    expect(s.vat.ES).toEqual({ mode: "FIXED", rate: 21 });
    expect(s.overdue).toEqual({ days: 30, action: "REMIND", remindEveryDays: 14 });
    expect(mergeReturnableSettings(null)).toEqual(DEFAULT_RETURNABLE_SETTINGS);
  });

  it("picks the deposit VAT rate by country", () => {
    const s = mergeReturnableSettings({ vat: { ES: { mode: "FIXED", rate: 21 }, FR: { mode: "FIXED", rate: -5 } } });
    expect(depositVatRate(s, "PT", [6, 23])).toBe(0);
    expect(depositVatRate(s, "ES", [10])).toBe(21);
    expect(depositVatRate(s, "FR", [5.5])).toBe(0);
    expect(depositVatRate(s, "DE", [7, 19])).toBe(19);
    expect(depositVatRate(s, "DE", [])).toBe(0);
  });

  it("uses a supplier's exception to the overdue rule", () => {
    const s = mergeReturnableSettings({ suppliers: { sup1: { days: 10, action: "KEEP" } } });
    expect(overdueRule(s, "sup1")).toEqual({ days: 10, action: "KEEP" });
    expect(overdueRule(s, "other")).toEqual({ days: 90, action: "REMIND" });
  });

  it("counts returnable units per type from order lines", () => {
    const m = unitsFor(
      [{ offerId: "beer", qty: 3 }, { offerId: "gas", qty: 2 }, { offerId: "rice", qty: 5 }, { offerId: "beer", qty: 0 }],
      [{ offerId: "beer", typeId: "crate", qtyPerUnit: 1 }, { offerId: "beer", typeId: "bottle", qtyPerUnit: 24 }, { offerId: "gas", typeId: "cyl", qtyPerUnit: 1 }],
    );
    expect(Object.fromEntries(m)).toEqual({ crate: 3, bottle: 72, cyl: 2 });
  });

  it("splits counted empties into swaps and returns", () => {
    const order = [{ typeId: "cyl", kind: "EXCHANGE" as const, qtyOut: 2 }, { typeId: "crate", kind: "DEPOSIT" as const, qtyOut: 4 }];
    expect(splitEmpties({ cyl: 3, crate: 4, keg: 1, junk: -2 }, order)).toEqual({ swaps: { cyl: 2 }, returns: { cyl: 1, crate: 4, keg: 1 } });
    expect(splitEmpties({ cyl: 1.7 }, order)).toEqual({ swaps: { cyl: 1 }, returns: {} });
    expect(splitEmpties({}, order)).toEqual({ swaps: {}, returns: {} });
  });

  it("charges deposits on units without an empty swapped", () => {
    expect(chargedUnits("DEPOSIT", 4, 4)).toBe(4);
    expect(chargedUnits("EXCHANGE", 3, 1)).toBe(2);
    expect(chargedUnits("EXCHANGE", 3, 5)).toBe(0);
  });

  it("ages what the customer holds first in, first out", () => {
    const lots = ageUnits([
      { qty: -1, at: d("2026-01-01") }, // returned before anything recorded: ignored, then absorbs the next unit out
      { qty: 5, at: d("2026-02-01") },
      { qty: 3, at: d("2026-05-01") },
      { qty: -6, at: d("2026-06-01") },
    ]);
    expect(lots).toEqual([{ qty: 1, since: d("2026-05-01") }]);
    const held = ageUnits([{ qty: 4, at: d("2026-01-01") }, { qty: 2, at: d("2026-10-01") }]);
    expect(overdueUnits(held, 90, d("2026-11-17"))).toBe(4);
    expect(overdueUnits(held, 365, d("2026-11-17"))).toBe(0);
  });
});
