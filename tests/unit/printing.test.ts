/** Printing rules and the new 3 / 6-month service schedules, parts & labour money. */
import { describe, expect, it } from "vitest";
import { nextSteps, printMoney, printPrice, qtyOk, roundQty } from "@/lib/printing";
import { isoDay, visitDates, visitMoney } from "@/lib/services";

describe("printing", () => {
  it("quantities: minimum and steps", () => {
    const p = { minQty: 100, stepQty: 50 };
    expect(qtyOk(p, 99)).toBe(false);
    expect(qtyOk(p, 100)).toBe(true);
    expect(qtyOk(p, 150)).toBe(true);
    expect(qtyOk(p, 120)).toBe(false);
    expect(roundQty(p, 120)).toBe(150);
    expect(roundQty(p, 10)).toBe(100);
  });
  it("price = setup + per item; who gets what", () => {
    expect(printPrice({ unitPriceNet: 0.05, setupNet: 15 }, 150)).toBe(22.5);
    expect(printMoney(22.5, 12, "FIRINGI")).toEqual({ provider: 19.8, commission: 0 });
    expect(printMoney(22.5, 12, "PROVIDER")).toEqual({ provider: 0, commission: 2.7 });
  });
  it("steps: quote first when price on request; customer accepts a quote or cancels before printing", () => {
    expect(nextSteps("REQUESTED", "PROVIDER", true)).not.toContain("ACCEPT");
    expect(nextSteps("REQUESTED", "PROVIDER", false)).toContain("ACCEPT");
    expect(nextSteps("QUOTED", "CUSTOMER", true)).toEqual(["ACCEPT_QUOTE", "CANCEL"]);
    expect(nextSteps("PRINTING", "CUSTOMER", false)).toEqual([]);
    expect(nextSteps("DELIVERED", "PROVIDER", false)).toEqual([]);
  });
});

describe("services: every 3 / 6 months, parts & labour", () => {
  const base = { weekday: 1, dayA: 10, dayB: 25, startsOn: new Date("2026-01-05T00:00:00Z") };
  it("every 3 months on day A, counted from the start month", () => {
    const d = visitDates({ ...base, frequency: "QUARTERLY" }, new Date("2026-01-01Z"), new Date("2026-12-31Z")).map(isoDay);
    expect(d).toEqual(["2026-01-10", "2026-04-10", "2026-07-10", "2026-10-10"]);
    const h = visitDates({ ...base, frequency: "HALF_YEARLY" }, new Date("2026-02-01Z"), new Date("2027-12-31Z")).map(isoDay);
    expect(h).toEqual(["2026-07-10", "2027-01-10", "2027-07-10"]);
  });
  it("parts & labour: added to the customer charge; FIRINGI keeps its commission % of them", () => {
    const t = { feeNet: 55, pricePerUnit: 0, buybackPerUnit: 0, providerPerVisit: 45, providerPerUnit: 0, commissionPct: 15, commissionPerVisit: 0, commissionPerUnit: 0 };
    expect(visitMoney(t, 1, "FIRINGI", 120)).toEqual({ fee: 175, buyback: 0, provider: 147, commission: 0 });
    expect(visitMoney(t, 1, "PROVIDER", 120)).toMatchObject({ fee: 175, commission: 26.25 });
  });
});
