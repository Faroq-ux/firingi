import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import {
  currencyForCountry, customerRate, DEFAULT_CURRENCY_SETTINGS, decimalsOf, docFx, EUR_FX, fxAmount, fxGainLoss, localAmounts, mergeCurrencySettings, movePct, parseEcb, roundMoney, toEur, toLocal,
} from "@/lib/currency";
import { candidatesInEur, resolvePrice } from "@/server/catalogue/pricing";
import { formatMoney } from "@/lib/utils";
import { fmtValue } from "@/lib/analytics-format";

describe("multi-currency rules", () => {
  it("settings: defaults (on, every country off, no margin), cleaning (margins 0–10 %, thresholds)", () => {
    expect(mergeCurrencySettings(null)).toEqual(DEFAULT_CURRENCY_SETTINGS);
    expect(Object.values(DEFAULT_CURRENCY_SETTINGS.countries).every((v) => v === false)).toBe(true);
    const s = mergeCurrencySettings({ margins: { PLN: 25, SEK: -1, CHF: 1.234 }, alertMovePct: 0, staleDays: 99, feed: "nope", countries: { PL: true, XX: true } });
    expect(s.margins).toMatchObject({ PLN: 10, SEK: 0, CHF: 1.23 });
    expect(s.alertMovePct).toBe(0.1);
    expect(s.staleDays).toBe(30);
    expect(s.feed).toBe("ECB");
    expect(s.countries.PL).toBe(true);
    expect("XX" in s.countries).toBe(false);
  });

  it("who is billed in what: the country switch, the master switch, suppliers' own switch", () => {
    const s = mergeCurrencySettings({ countries: { PL: true, LI: true } });
    expect(currencyForCountry(s, "PL", "BUYER")).toBe("PLN");
    expect(currencyForCountry(s, "LI", "BUYER")).toBe("CHF");
    expect(currencyForCountry(s, "SE", "BUYER")).toBe("EUR");
    expect(currencyForCountry(s, "PT", "BUYER")).toBe("EUR");
    expect(currencyForCountry({ ...s, enabled: false }, "PL", "BUYER")).toBe("EUR");
    expect(currencyForCountry({ ...s, supplierCurrency: false }, "PL", "SUPPLIER")).toBe("EUR");
  });

  it("conversion: customer rate = reference × (1 + margin); rounding to the minor unit (ISK has none)", () => {
    expect(customerRate(4.25, 1.5).toNumber()).toBeCloseTo(4.31375, 8);
    expect(toLocal(10, "4.31375", "PLN").toFixed(2)).toBe("43.14");
    expect(toLocal(10, 150.4, "ISK").toString()).toBe("1504");
    expect(decimalsOf("ISK")).toBe(0);
    expect(roundMoney("2.345", "EUR").toFixed(2)).toBe("2.35");
    expect(toEur(55, 4.25).toFixed(4)).toBe("12.9412");
    expect(fxAmount(EUR_FX, "12.345")).toBe(12.35);
    expect(fxAmount(docFx({ currencyCode: "SEK", eurRate: 11 }), 2)).toBe(22);
  });

  it("document amounts: a fixed local price stays exact; the rest at the document's rate; totals add up", () => {
    const r = localAmounts(
      [
        { lineNet: "51.76", lineVat: "11.90", taxRate: 23, unitSaleEur: "12.94", unitLocal: "55" }, // 4 × 55 zł fixed
        { lineNet: "63.00", lineVat: "3.15", taxRate: 5, unitSaleEur: "31.50" }, // 2 × €31.50 → customer rate
      ],
      { net: "124.66", vat: "17.33", grand: "141.99" }, // + €9.90 delivery, VAT 2.28
      "4.31375", "PLN",
    );
    expect(r.lines[0].netLocal.toFixed(2)).toBe("220.00");
    expect(r.lines[0].vatLocal.toFixed(2)).toBe("50.60");
    expect(r.lines[1].unitLocal.toFixed(4)).toBe("135.8831");
    expect(r.grand.toFixed(2)).toBe(r.net.plus(r.vat).toFixed(2));
    expect(r.net.minus(r.lines[0].netLocal).minus(r.lines[1].netLocal).toFixed(2)).toBe(toLocal("9.90", "4.31375", "PLN").toFixed(2));
  });

  it("realised exchange difference: receivables gain when the currency strengthens; payables the other way", () => {
    expect(fxGainLoss(425, 4.25, 4.0).toFixed(2)).toBe("6.25"); // 425 zł was €100, is now €106.25
    expect(fxGainLoss(425, 4.25, 4.5).toFixed(2)).toBe("-5.56");
    expect(fxGainLoss(425, 4.25, 4.0, "PAYABLE").toFixed(2)).toBe("-6.25"); // paying 425 zł now costs more
    expect(movePct(4.25, 4.335)).toBe(2);
  });

  it("the ECB file", () => {
    const xml = `<gesmes:Envelope><Cube><Cube time='2026-11-18'><Cube currency='USD' rate='1.0812'/><Cube currency='PLN' rate='4.2510'/><Cube currency='ISK' rate='149.90'/></Cube></Cube></gesmes:Envelope>`;
    expect(parseEcb(xml)).toEqual({ date: "2026-11-18", rates: { USD: "1.0812", PLN: "4.2510", ISK: "149.90" } });
    expect(parseEcb("<html>maintenance</html>")).toBeNull();
  });

  it("price lists in other currencies: the buyer's own is preferred and kept exactly; a supplier's at the reference rate; unusable ones drop", () => {
    const rules = { buyerCode: "PLN", mids: { PLN: "4.25", SEK: "11" }, localLists: true, supplierCurrency: true };
    const c = candidatesInEur([
      { priceListId: "eur", scope: "BASE", priority: 0, minQty: 1, unitPriceNet: "12.00", currencyCode: "EUR" },
      { priceListId: "pln", scope: "BASE", priority: 0, minQty: 1, unitPriceNet: "55", currencyCode: "PLN" },
      { priceListId: "sek", scope: "BASE", priority: 0, minQty: 1, unitPriceNet: "110", currencyCode: "SEK" },
      { priceListId: "nok", scope: "BASE", priority: 0, minQty: 1, unitPriceNet: "1", currencyCode: "NOK" },
    ], rules);
    expect(c.candidates.map((x) => x.priceListId)).toEqual(["eur", "pln", "sek"]);
    expect(resolvePrice(c.candidates)!.priceListId).toBe("pln"); // preferred although dearer than the EUR list
    expect(c.fixed.get("pln")!.byMinQty.get(1)).toBe("55.0000");
    expect(new Decimal(c.candidates[2].unitPriceNet.toString()).toFixed(2)).toBe("10.00");
    expect(candidatesInEur(c.candidates.length ? [{ priceListId: "pln", scope: "BASE", priority: 0, minQty: 1, unitPriceNet: "55", currencyCode: "PLN" }] : [], { ...rules, localLists: false }).candidates).toEqual([]);
  });

  it("formatting: a code (already in it) or a viewer's Fx (EUR converted); report money in another currency", () => {
    expect(formatMoney(55, "pl-PL", "PLN")).toMatch(/55,00\s?zł/);
    const sp = (t: string) => t.replace(/\s/g, " ");
    expect(sp(formatMoney(10, "en-GB", docFx({ currencyCode: "PLN", eurRate: "4.25" })))).toBe("PLN 42.50");
    expect(sp(formatMoney(1504, "en-GB", "ISK"))).toBe("ISK 1,504");
    expect(sp(fmtValue(42.5, "money:SEK", "en-GB"))).toBe("SEK 42.50");
    expect(fmtValue(42.5, "money", "en-GB")).toBe("€42.50");
  });
});
