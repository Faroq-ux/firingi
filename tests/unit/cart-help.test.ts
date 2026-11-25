/** Buying from several wholesalers: where a supplier stands against its minimum, cart-first order, supplier names. */
import { describe, expect, it } from "vitest";
import { areaLabels, cartFirst, cartHelpOn, formatStanding, mergeCartHelp, mergeSupplierNames, nameModeFor, standing } from "@/lib/cart-help";

const firingi = { id: "f", minOrderValue: "50", feeNet: "7.5" };
const amount = (a: string, fee?: string) => ({ id: "v", kind: "AMOUNT" as const, amount: a, flatFeeNet: fee ?? null });

describe("where a supplier stands", () => {
  it("customer: FIRINGI's minimum blocks, the supplier's free-delivery minimum is the next goal", () => {
    expect(standing({ wholesaler: false, goodsNet: 30, units: 3, firingi, vendor: amount("150") })).toMatchObject({ state: "MINIMUM", target: "50.00", missing: "20.00" });
    expect(standing({ wholesaler: false, goodsNet: 120, units: 9, firingi, vendor: amount("150") })).toMatchObject({ state: "FREE", target: "150.00", missing: "30.00" });
    expect(standing({ wholesaler: false, goodsNet: 150, units: 9, firingi, vendor: amount("150") })).toMatchObject({ state: "REACHED", missing: null });
    expect(standing({ wholesaler: false, goodsNet: 0, units: 0, firingi, vendor: null })).toMatchObject({ state: "MINIMUM", target: "50.00" });
    expect(standing({ wholesaler: false, goodsNet: 60, units: 1, firingi: null, vendor: null })).toMatchObject({ state: "NONE" });
  });
  it("wholesaler ← distributor: minimum blocks unless the distributor charges a flat fee; units minimum", () => {
    expect(standing({ wholesaler: true, goodsNet: 200, units: 4, firingi, vendor: amount("500") })).toMatchObject({ state: "MINIMUM", missing: "300.00" });
    expect(standing({ wholesaler: true, goodsNet: 200, units: 4, firingi, vendor: amount("300", "15") })).toMatchObject({ state: "FREE", missing: "100.00" });
    expect(standing({ wholesaler: true, goodsNet: 0, units: 4, firingi, vendor: { id: "v", kind: "UNITS", units: 10 } })).toMatchObject({ state: "MINIMUM", unit: "UNITS", target: "10", missing: "6" });
    expect(standing({ wholesaler: true, goodsNet: 10, units: 1, firingi, vendor: null })).toMatchObject({ state: "NONE" });
  });
  it("formatting keeps units as counts", () => {
    const s = standing({ wholesaler: false, goodsNet: 120, units: 9, firingi, vendor: amount("150") });
    expect(formatStanding(s, (x) => `€${x}`)).toMatchObject({ target: "€150.00", missing: "€30.00" });
  });
});

describe("results order and switches", () => {
  it("suppliers in the cart first, then usual ones, otherwise as given", () => {
    const items = [{ vendor: { id: "a" } }, { vendor: { id: "b" } }, { vendor: { id: "c" } }, { vendor: { id: "b" } }];
    expect(cartFirst(items, new Set(["c"]), ["b"]).map((i) => i.vendor.id)).toEqual(["c", "b", "b", "a"]);
  });
  it("settings cleaned; off per country", () => {
    const s = mergeCartHelp({ badges: false, offCountries: ["pt", "xx1"] as string[] });
    expect(s).toMatchObject({ enabled: true, cartFirst: true, badges: false, offCountries: ["PT"] });
    expect(cartHelpOn(s, "PT")).toBe(false);
    expect(cartHelpOn(s, "ES")).toBe(true);
  });
});

describe("supplier names", () => {
  const s = mergeSupplierNames({ customers: "NAME", countries: { pt: "AREA" } as Record<string, "AREA">, wholesalers: "NAME", companies: { v2: "NAME" } });
  it("customer country, wholesalers, and a supplier override that wins", () => {
    expect(nameModeFor(s, { type: "CUSTOMER", countryCode: "PT" }, "v1")).toBe("AREA");
    expect(nameModeFor(s, { type: "CUSTOMER", countryCode: "PT" }, "v2")).toBe("NAME");
    expect(nameModeFor(s, { type: "CUSTOMER", countryCode: "ES" }, "v1")).toBe("NAME");
    expect(nameModeFor(s, { type: "WHOLESALER", countryCode: "PT" }, "v1")).toBe("NAME");
    expect(nameModeFor(s, { type: "ADMIN", countryCode: "PT" }, "v1")).toBe("NAME");
  });
  it("FIRINGI + the warehouse city; numbered within a city by joining order", () => {
    const d = (n: number) => new Date(2026, 0, n);
    const m = areaLabels([{ id: "x", createdAt: d(2), city: "Lisboa" }, { id: "y", createdAt: d(1), city: "lisboa" }, { id: "z", createdAt: d(3), city: "Almada" }, { id: "w", createdAt: d(4), city: null }]);
    expect(m.get("y")).toBe("FIRINGI lisboa");
    expect(m.get("x")).toBe("FIRINGI Lisboa 2");
    expect(m.get("z")).toBe("FIRINGI Almada");
    expect(m.get("w")).toBe("FIRINGI");
  });
});
