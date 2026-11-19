import { describe, expect, it } from "vitest";
import { accrue, DEFAULT_POS_SETTINGS, hashInput, lineTotals, mergePosSettings, packsOf, pointsFor, pointsValue, posAllowed, posCurrency, receiptNumber, reorderHint, saleTotals, settle, zReport } from "@/lib/pos";

describe("POS settings and who may use the till", () => {
  it("defaults: on for distributors, wholesalers and customers, every Schengen country non-fiscal with a suggested provider", () => {
    const s = mergePosSettings(null);
    expect(s.types).toEqual({ DISTRIBUTOR: true, WHOLESALER: true, CUSTOMER: true });
    expect(s.countries.PT).toEqual({ enabled: true, stage: "NONFISCAL", provider: "moloni", fallbackNonFiscal: false });
    expect(s.countries.PL.provider).toBe("fiscal-device");
    expect(s.countries.DE.provider).toBe("fiscal-cloud");
    expect(Object.values(s.features).every(Boolean)).toBe(true);
  });

  it("merge keeps sane values: Moloni only in Portugal, limits clamped", () => {
    const s = mergePosSettings({ countries: { DE: { provider: "moloni", stage: "PROVIDER" } }, offlineHours: 9999, offlineMaxSales: 1 });
    expect(s.countries.DE).toMatchObject({ provider: "fiscal-cloud", stage: "PROVIDER" });
    expect(s.offlineHours).toBe(168);
    expect(s.offlineMaxSales).toBe(10);
  });

  it("admin switches: master, company type, country, and the company's own override", () => {
    const s = mergePosSettings({ types: { CUSTOMER: false } });
    expect(posAllowed(s, { type: "CUSTOMER", countryCode: "PT" })).toEqual({ on: false, reason: "type" });
    expect(posAllowed(s, { type: "CUSTOMER", countryCode: "PT", adminState: "ON" }).on).toBe(true);
    expect(posAllowed(s, { type: "DISTRIBUTOR", countryCode: "PT", adminState: "OFF" })).toEqual({ on: false, reason: "company" });
    expect(posAllowed({ ...s, enabled: false }, { type: "DISTRIBUTOR", countryCode: "PT", adminState: "ON" }).reason).toBe("off");
    const noPl = mergePosSettings({ countries: { PL: { enabled: false } } });
    expect(posAllowed(noPl, { type: "WHOLESALER", countryCode: "PL" }).reason).toBe("country");
    expect(posAllowed(DEFAULT_POS_SETTINGS, { type: "ADMIN", countryCode: "PT" }).on).toBe(false);
  });

  it("the till's currency is the country's legal one", () => {
    expect(posCurrency("PT")).toBe("EUR");
    expect(posCurrency("PL")).toBe("PLN");
    expect(posCurrency("CH")).toBe("CHF");
  });
});

describe("money at the till", () => {
  it("a line: price incl. VAT, discount, rounded once, VAT split from the gross", () => {
    expect(lineTotals({ qty: 3, unitPrice: 1.5, vatRate: 23 })).toMatchObject({ gross: "4.50", net: "3.66", vat: "0.84" });
    expect(lineTotals({ qty: 0.348, unitPrice: 12.99, vatRate: 6 })).toMatchObject({ qty: "0.348", gross: "4.52", net: "4.26" });
    expect(lineTotals({ qty: 2, unitPrice: 10, vatRate: 23, discountPct: 10 }, 5).gross).toBe("17.10");
  });

  it("a sale: totals by VAT rate, the discount given", () => {
    const t = saleTotals([{ qty: 2, unitPrice: 5, vatRate: 13 }, { qty: 1, unitPrice: 2.5, vatRate: 23 }, { qty: 1, unitPrice: 4, vatRate: 13, discountPct: 50 }]);
    expect(t.gross).toBe("14.50");
    expect(t.byRate.map((r) => r.rate)).toEqual(["23", "13"]);
    expect(t.byRate.find((r) => r.rate === "13")!.gross).toBe("12.00");
    expect(t.discount).toBe("2.00");
    expect(Number(t.net) + Number(t.vat)).toBeCloseTo(14.5, 6);
  });

  it("forints and krónur have no cents", () => {
    expect(saleTotals([{ qty: 3, unitPrice: 333.33, vatRate: 27 }], 0, 0).gross).toBe("1000");
  });

  it("payments: change only from cash, split payments, still due", () => {
    expect(settle("12.40", [{ method: "CASH", amount: 12.4, tendered: 20 }])).toMatchObject({ change: "7.60", due: "0.00", cashKept: "12.40" });
    expect(settle("30.00", [{ method: "CARD", amount: 10 }, { method: "CASH", amount: 20, tendered: 50 }])).toMatchObject({ change: "30.00", cashKept: "20.00", due: "0.00" });
    expect(settle("30.00", [{ method: "CARD", amount: 10 }])).toMatchObject({ due: "20.00", change: "0.00" });
    expect(settle("5.00", [{ method: "CARD", amount: 6 }]).over).toBe(true);
  });

  it("receipt numbers and the hash chain input", () => {
    expect(receiptNumber("C1", 12, 34)).toBe("C1-0012-0034");
    const a = hashInput(null, { number: "C1-0001-0001", soldAt: "2026-11-19T10:00:00.000Z", gross: "4.50", lines: [{ name: "Bica", qty: "3", gross: "4.50" }] });
    expect(a).toBe("|C1-0001-0001|2026-11-19T10:00:00.000Z|4.50|Bica:3:4.50");
    expect(hashInput("abc", { number: "x", soldAt: "t", gross: "1", lines: [] }).startsWith("abc|")).toBe(true);
  });

  it("loyalty points: earned on money paid, worth their value", () => {
    expect(pointsFor("12.99", 1)).toBe(12);
    expect(pointsFor("12.99", 0.5)).toBe(6);
    expect(pointsValue(250, 0.01)).toBe("2.50");
  });
});

describe("recipes and stock", () => {
  it("recipe quantities as a share of the purchased pack", () => {
    expect(packsOf(0.15, "KG", { netWeightKg: 10 }).toNumber()).toBeCloseTo(0.015, 6);
    expect(packsOf(2, "PCS", { unitsPerPack: 24 }).toNumber()).toBeCloseTo(1 / 12, 6);
    expect(packsOf(1, "PACK", {}).toNumber()).toBe(1);
  });

  it("fractions add up and whole packs leave stock", () => {
    let p = "0";
    let taken = 0;
    for (let i = 0; i < 70; i++) { const a = accrue(p, 0.015); p = a.pending; taken += a.whole; }
    expect(taken).toBe(1);
    expect(Number(p)).toBeCloseTo(0.05, 6);
  });

  it("reorder hint from the recent rate", () => {
    expect(reorderHint(3, 0.5, 7)).toEqual({ daysLeft: 6, suggest: 1 });
    expect(reorderHint(10, 0, 7)).toEqual({ daysLeft: null, suggest: 0 });
  });
});

describe("X / Z report", () => {
  it("sales minus refunds, by payment, VAT and cashier; the cash expected in the drawer", () => {
    const z = zReport([
      { kind: "SALE", status: "COMPLETED", gross: 10, net: 8.13, vat: 1.87, discount: 0, cashierId: "a", payments: [{ method: "CASH", amount: 10 }], byRate: [{ rate: 23, net: 8.13, vat: 1.87, gross: 10 }] },
      { kind: "SALE", status: "COMPLETED", gross: 20, net: 17.7, vat: 2.3, discount: 1, cashierId: "b", payments: [{ method: "CARD", amount: 20 }], byRate: [{ rate: 13, net: 17.7, vat: 2.3, gross: 20 }] },
      { kind: "REFUND", status: "COMPLETED", gross: 5, net: 4.07, vat: 0.93, discount: 0, cashierId: "a", payments: [{ method: "CASH", amount: 5 }], byRate: [{ rate: 23, net: 4.07, vat: 0.93, gross: 5 }] },
      { kind: "SALE", status: "VOIDED", gross: 99, net: 0, vat: 0, discount: 0, cashierId: "a", payments: [{ method: "CASH", amount: 99 }], byRate: [] },
    ], [{ kind: "PAY_IN", amount: 50 }, { kind: "PAY_OUT", amount: 12 }, { kind: "NO_SALE", amount: 0 }], 100);
    expect(z).toMatchObject({ count: 2, refundCount: 1, voided: 1, gross: 25, salesGross: 30, refundsGross: 5, payIn: 50, payOut: 12, noSale: 1 });
    expect(z.byPayment).toEqual({ CASH: 5, CARD: 20 });
    expect(z.expectedCash).toBe(143);
    expect(z.byRate.find((r) => r.rate === 23)!.gross).toBe(5);
    expect(z.byCashier.a).toEqual({ count: 1, gross: 5 });
  });
});

describe("the customer's NIF on a receipt", () => {
  it("Portugal: check digit, spaces and the PT prefix; the final-consumer number", async () => {
    const { checkTaxId, PT_FINAL_CONSUMER } = await import("@/lib/tax-id");
    expect(checkTaxId("123 456 789", "PT")).toEqual({ ok: true, value: "123456789" });
    expect(checkTaxId("123456780", "PT")).toEqual({ ok: false, reason: "checksum" });
    expect(checkTaxId("PT 504.426.290", "PT")).toEqual({ ok: true, value: "PT504426290" });
    expect(checkTaxId("12345", "PT")).toEqual({ ok: false, reason: "format" });
    expect(checkTaxId(PT_FINAL_CONSUMER, "PT").ok).toBe(true);
  });
  it("other countries: their prefix or a light format check", async () => {
    const { checkTaxId } = await import("@/lib/tax-id");
    expect(checkTaxId("B12345678", "ES").ok).toBe(true);
    expect(checkTaxId("DE 123456789", "PT")).toEqual({ ok: true, value: "DE123456789" });
    expect(checkTaxId("1234567890", "PL").ok).toBe(true);
    expect(checkTaxId("abc", "DE").ok).toBe(false);
  });
});

describe("special goods: declaration + activity code (CAE / NACE)", () => {
  it("open only when declared and a code matches the rule's prefixes; exceptions, missing codes, warn mode", async () => {
    const { DEFAULT_SPECIAL_SETTINGS: S, verdict, mergeSpecialSettings } = await import("@/lib/special-access");
    const base = { country: "PT", codes: ["56101"], declared: true, sells: ["TOBACCO", "ALCOHOL"], exceptions: [] as string[] };
    expect(verdict(S, base, "ALCOHOL")).toMatchObject({ open: true, reason: "OK" }); // restaurant 5610
    expect(verdict(S, { ...base, sells: ["TOBACCO"] }, "ALCOHOL")).toMatchObject({ open: false, reason: "NOT_DECLARED" });
    expect(verdict(S, { ...base, codes: ["62010"] }, "TOBACCO")).toMatchObject({ open: false, reason: "CODE" }); // IT services
    expect(verdict(S, { ...base, codes: ["62010", "47260"] }, "TOBACCO").open).toBe(true); // a secondary code counts
    expect(verdict(S, { ...base, codes: ["62010"], exceptions: ["TOBACCO"] }, "TOBACCO")).toMatchObject({ open: true, reason: "EXCEPTION" });
    expect(verdict(S, { ...base, declared: false, sells: [], codes: [] }, "TOBACCO").open).toBe(true); // older account, no code: kept
    expect(verdict({ ...S, noCode: "BLOCK" }, { ...base, codes: [] }, "TOBACCO")).toMatchObject({ open: false, reason: "NO_CODE" });
    const warn = mergeSpecialSettings({ ...S, rules: S.rules.map((r) => ({ ...r, mode: "WARN" })) });
    expect(verdict(warn, { ...base, codes: ["62010"] }, "TOBACCO")).toMatchObject({ open: true, warn: true });
    expect(verdict({ ...S, enabled: false }, { ...base, sells: [] }, "TOBACCO").open).toBe(true);
    // a category rule (special items) and country-specific rules
    const cat = mergeSpecialSettings({ ...S, rules: [...S.rules, { id: "pharma", target: "cat:abc", label: "Pharmacy", codes: ["4773"], countries: ["PT"], mode: "BLOCK", active: true }] });
    expect(verdict(cat, base, "cat:abc").open).toBe(false);
    expect(verdict(cat, { ...base, country: "ES" }, "cat:abc").open).toBe(true);
    expect(verdict(cat, { ...base, codes: ["47730"] }, "cat:abc").open).toBe(true);
  });
  it("secondary codes: list parsing, duplicates and the main code dropped, the country's format", async () => {
    const { parseActivityCodes } = await import("@/lib/activity-code");
    expect(parseActivityCodes("56102, 47111 47112,56101", "PT", "56101")).toEqual({ ok: true, values: ["56102", "47111", "47112"] });
    expect(parseActivityCodes("561", "PT")).toEqual({ ok: false, bad: "561" });
    expect(parseActivityCodes(Array.from({ length: 21 }, (_, i) => String(10000 + i)), "PT").ok).toBe(false);
  });
});
