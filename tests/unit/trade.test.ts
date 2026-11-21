import { describe, expect, it } from "vitest";
import {
  aggregateEcsl, aggregateIntrastat, checkTradeSettings, csv, DEFAULT_TRADE_SETTINGS, dueOn, genericTable, isPeriod, mergeTradeSettings, nationalFile, nextPeriod,
  normaliseCn, periodOf, periodRange, previousPeriod, vatWithPrefix, type TradeLine,
} from "@/lib/trade";

const line = (p: Partial<TradeLine> = {}): TradeLine => ({
  partnerCountry: "ES", partnerVat: "ESB12345678", partnerName: "Ibéricas", indicator: "GOODS", cnCode: "10063098", description: "Arroz", originCountry: "ES",
  netMassKg: 10, suppQty: null, suppUnit: null, value: 100, natureCode: "11", transportMode: "3", deliveryTerms: "DAP", correctsPeriod: null, sourceNumber: "VBS-1", ...p,
});
const D = DEFAULT_TRADE_SETTINGS.defaults;
const decl = { name: "FIRINGI, Lda", vat: "PT517000008", taxId: "517000008", country: "PT", phone: "+351 210 000 000" };

describe("periods and deadlines", () => {
  it("names months and quarters and their date ranges", () => {
    const d = new Date(Date.UTC(2026, 10, 21));
    expect(periodOf(d, "MONTHLY")).toBe("2026-11");
    expect(periodOf(d, "QUARTERLY")).toBe("2026-Q4");
    expect(periodRange("2026-Q4")).toEqual({ start: new Date(Date.UTC(2026, 9, 1)), end: new Date(Date.UTC(2027, 0, 1)) });
    expect(nextPeriod("2026-12")).toBe("2027-01");
    expect(previousPeriod("2027-Q1")).toBe("2026-Q4");
    expect(isPeriod("2026-13")).toBe(false);
    expect(() => periodRange("2026-Q5")).toThrow();
  });
  it("is due on the given day of the month after the period", () => {
    expect(dueOn("2026-11", 20).toISOString().slice(0, 10)).toBe("2026-12-20");
    expect(dueOn("2026-Q4", 15).toISOString().slice(0, 10)).toBe("2027-01-15");
  });
});

describe("codes and numbers", () => {
  it("accepts CN8 codes with spaces or dots, nothing else", () => {
    expect(normaliseCn("2202 10 00")).toBe("22021000");
    expect(normaliseCn("2202.10.00")).toBe("22021000");
    expect(normaliseCn("220210")).toBeNull();
    expect(normaliseCn("2202100A")).toBeNull();
  });
  it("adds the VIES prefix (Greece is EL)", () => {
    expect(vatWithPrefix("517000008", "PT")).toBe("PT517000008");
    expect(vatWithPrefix("ESB12345678", "ES")).toBe("ESB12345678");
    expect(vatWithPrefix("094014201", "GR")).toBe("EL094014201");
    expect(vatWithPrefix(null, "PT")).toBeNull();
  });
});

describe("settings", () => {
  it("fills defaults, keeps known countries and repairs bad values", () => {
    const s = mergeTradeSettings({ vies: { maxAgeDays: 999 }, countries: { PT: { ecslPeriod: "QUARTERLY", arrivalsObliged: true }, xx: {} }, reminders: { days: [1, 30, 1, 99] } });
    expect(s.vies.maxAgeDays).toBe(30);
    expect(s.countries.PT.ecslPeriod).toBe("QUARTERLY");
    expect(s.countries.PT.arrivalsObliged).toBe(true);
    expect(s.countries.PT.arrivalsThreshold).toBe(650000);
    expect(s.countries.xx).toBeUndefined();
    expect(s.reminders.days).toEqual([30, 1]);
    expect(mergeTradeSettings(null)).toEqual(DEFAULT_TRADE_SETTINGS);
  });
  it("names the first problem when saving", () => {
    expect(checkTradeSettings(DEFAULT_TRADE_SETTINGS)).toBeNull();
    expect(checkTradeSettings({ ...DEFAULT_TRADE_SETTINGS, defaults: { ...D, transportMode: "33" } })).toMatch(/transport/);
    expect(checkTradeSettings({ ...DEFAULT_TRADE_SETTINGS, countries: { PT: { ...DEFAULT_TRADE_SETTINGS.countries.PT, ecslDueDay: 31 } } })).toMatch(/1 to 28/);
  });
});

describe("aggregation", () => {
  it("EC Sales List: one row per VAT number and type; credits net; zero rows drop", () => {
    const rows = aggregateEcsl([line(), line({ value: 50 }), line({ value: -150 }), line({ partnerVat: "FR12345678901", partnerCountry: "FR", value: 70 }), line({ indicator: "SERVICES", value: 20 })]);
    expect(rows).toEqual([
      expect.objectContaining({ partnerVat: "ESB12345678", indicator: "SERVICES", value: 20 }),
      expect.objectContaining({ partnerVat: "FR12345678901", value: 70 }),
    ]);
  });
  it("corrections stay apart, marked with their period", () => {
    const rows = aggregateEcsl([line(), line({ value: -30, correctsPeriod: "2026-10" })]);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.correctsPeriod)?.value).toBe(-30);
  });
  it("Intrastat: one row per CN8, country, origin, nature, transport, terms and partner", () => {
    const rows = aggregateIntrastat([line(), line({ netMassKg: 5.5, value: 40 }), line({ originCountry: "IT" }), line({ suppQty: 7.92, suppUnit: "l", cnCode: "22021000" })], D);
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.cnCode === "10063098" && r.originCountry === "ES")).toMatchObject({ netMassKg: 15.5, value: 140 });
    expect(rows.find((r) => r.cnCode === "22021000")?.suppQty).toBe(7.92);
  });
});

describe("files", () => {
  it("generic spreadsheet headers per return", () => {
    expect(genericTable("ECSL", [line()], D).headers[1]).toBe("VAT number");
    expect(genericTable("ARRIVALS", [line()], D).headers[2]).toBe("Country of consignment");
    expect(csv(["a", "b"], [["x;y", 1]])).toBe('﻿a;b\r\n"x;y";1\r\n');
  });
  it("Portugal: AT recapitulative statement and INE Intrastat", () => {
    const dr = nationalFile("PT", "ECSL", [line(), line({ indicator: "SERVICES", value: 12.5 })], D, decl, "2026-11");
    expect(dr.fileName).toBe("DR_2026-11.csv");
    expect(dr.body).toContain("ES;B12345678;100,00;1;");
    expect(dr.body).toContain("ES;B12345678;12,50;5;");
    const ine = nationalFile("PT", "DISPATCHES", [line({ partnerCountry: "FR", partnerVat: "FR12345678901" })], D, decl, "2026-11");
    expect(ine.fileName).toBe("INTRASTAT_EXPED_2026-11.csv");
    expect(ine.body).toContain("10063098;FR;11;3;DAP;10;;100;100;FR12345678901;ES");
  });
  it("Spain: Modelo 349 fixed records of 500 characters", () => {
    const f = nationalFile("ES", "ECSL", [line({ partnerCountry: "PT", partnerVat: "PT517000008", partnerName: "FIRINGI Lda", value: 1234.56 })], D, { ...decl, vat: "ESB99999999", country: "ES" }, "2026-Q4");
    const recs = f.body.split("\r\n").filter(Boolean);
    expect(recs).toHaveLength(2);
    expect(recs.every((r) => r.length === 500)).toBe(true);
    expect(recs[0].slice(0, 8)).toBe("13492026");
    expect(recs[0].slice(8, 17)).toBe("B99999999");
    expect(recs[1].slice(0, 1)).toBe("2");
    expect(recs[1].slice(75, 92).trim()).toBe("PT517000008");
    expect(recs[1].slice(132, 133)).toBe("E");
    expect(recs[1].slice(133, 146)).toBe("0000000123456");
  });
  it("France: DEB as INSTAT XML; Germany: ZM CSV and IDEV", () => {
    const deb = nationalFile("FR", "ARRIVALS", [line()], D, decl, "2026-11");
    expect(deb.body).toContain("<CN8Code>10063098</CN8Code>");
    expect(deb.body).toContain("<flowCode>A</flowCode>");
    const zm = nationalFile("DE", "ECSL", [line(), line({ indicator: "TRIANGULAR", value: 5 })], D, decl, "2026-11");
    expect(zm.body).toContain("ES,B12345678,100,L");
    expect(zm.body).toContain("ES,B12345678,5,D");
    expect(nationalFile("DE", "DISPATCHES", [line()], D, decl, "2026-11").fileName).toBe("IDEV_VERSENDUNG_2026-11.csv");
  });
});
