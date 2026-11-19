import { describe, expect, it } from "vitest";
import { XMLParser } from "fast-xml-parser";
import { DEFAULT_EINVOICE_SETTINGS, PERIOD, documentLanguages, mergeEInvoiceSettings, periodRange, previousPeriod, providerFits } from "@/lib/einvoice";
import { renderXml, splitPeppol, toKsef, toUbl, toVerifactu, verifactuHuella } from "@/server/einvoice/formats";
import { parseEInvoice } from "@/server/einvoice/parse";
import { hasErrors, validateEDoc } from "@/server/einvoice/validate";
import type { EDoc } from "@/server/einvoice/types";

const doc = (over: Partial<EDoc> = {}): EDoc => ({
  typeCode: "380", kind: "INVOICE", number: "FT FIR2026/12", issueDate: "2026-11-19", dueDate: "2026-12-19", currency: "EUR", vatInEur: null,
  seller: { name: "FIRINGI Portugal, Lda.", vatId: "PT515000001", taxId: "515000001", countryCode: "PT", street: "Rua A 1", city: "Lisboa", postalCode: "1000-001", email: "fin@firingi.test", phone: "+351 210000000", peppolId: "9946:PT515000001", iban: "PT50 0002 0123 1234 5678 9015 4" },
  buyer: { name: "Kebab House, Lda.", vatId: "PT509999999", taxId: "509999999", countryCode: "PT", street: "Rua B 2", city: "Porto", postalCode: "4000-001", email: "kh@test", peppolId: "9946:PT509999999" },
  buyerReference: "PO-77", orderReference: "FO-2026-000123", preceding: null, notes: ["Order FO-2026-000123"],
  lines: [
    { id: "1", name: "Mozzarella 2,5 kg", sku: "MOZ-25", qty: "3", unitCode: "C62", price: "12.2", listPrice: "12.2", discount: "0", net: "36.60", vatCategory: "S", vatRate: "6" },
    { id: "2", name: "Delivery", sku: null, qty: "1", unitCode: "C62", price: "9.9", listPrice: "9.9", discount: "0", net: "9.90", vatCategory: "S", vatRate: "23" },
  ],
  taxes: [{ category: "S", rate: "6", base: "36.60", vat: "2.20" }, { category: "S", rate: "23", base: "9.90", vat: "2.28" }],
  totals: { lineNet: "46.50", net: "46.50", vat: "4.48", gross: "50.98", paid: "0", payable: "50.98" },
  payment: { meansCode: "58", iban: "PT50 0002 0123 1234 5678 9015 4", reference: "FT FIR2026/12", terms: "30 days" },
  language: "pt-PT", extra: {},
  ...over,
});

describe("e-invoice settings and languages", () => {
  it("merges settings: unknown provider/format fall back, a provider that can't carry a format becomes the EU-wide service", () => {
    const s = mergeEInvoiceSettings({ countries: { PL: { format: "PEPPOL_BIS3", provider: "ksef" }, DE: { format: "NOPE" } }, retention: { PT: 99 } });
    expect(s.countries.PL).toMatchObject({ format: "PEPPOL_BIS3", provider: "eu-hub" });
    expect(s.countries.DE.format).toBe("XRECHNUNG");
    expect(s.retention.PT).toBe(30);
    expect(s.emailXml).toBe(true);
    expect(mergeEInvoiceSettings({ emailXml: false }).emailXml).toBe(false);
    expect(s.monthlyPack).toEqual({ enabled: true, day: 1, includeXml: true, includeSummary: true, includeInvoicePdfs: false, includeTillSales: true });
    expect(mergeEInvoiceSettings({ monthlyPack: { day: 40 } }).monthlyPack.day).toBe(28);
    expect(mergeEInvoiceSettings({ monthlyPack: { day: 0, enabled: false } }).monthlyPack).toMatchObject({ day: 1, enabled: false, includeXml: true });
    expect(previousPeriod(new Date(Date.UTC(2027, 0, 3)))).toBe("2026-12");
    expect(previousPeriod(new Date(Date.UTC(2026, 10, 19)))).toBe("2026-10");
    const r = periodRange("2026-12");
    expect(r.from.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(r.to.toISOString()).toBe("2027-01-01T00:00:00.000Z");
    expect(PERIOD.test("2026-13")).toBe(false);
    expect(s.languagePriority).toEqual(["CUSTOMER_COUNTRY", "CUSTOMER_CHOICE", "ENTITY"]);
    expect(providerFits("ksef", "KSEF_FA3", "PL")).toBe(true);
    expect(providerFits("ksef", "KSEF_FA3", "DE")).toBe(false);
    expect(providerFits("eu-hub", "FATTURAPA", "IT")).toBe(true);
  });

  it("picks languages: customer country first, own choice becomes the second language, entity language kept when required", () => {
    const base = { customerCountryLanguage: "pl", customerChoice: null, customerSecond: null, entityLanguage: "pl", entitySecond: null, requireOwnLanguage: true };
    expect(documentLanguages(DEFAULT_EINVOICE_SETTINGS, base)).toEqual({ primary: "pl", second: null });
    expect(documentLanguages(DEFAULT_EINVOICE_SETTINGS, { ...base, customerChoice: "en" })).toEqual({ primary: "pl", second: "en" });
    expect(documentLanguages(DEFAULT_EINVOICE_SETTINGS, { ...base, customerCountryLanguage: "de", entityLanguage: "pt-PT" })).toEqual({ primary: "de", second: "pt-PT" });
    const choiceFirst = { ...DEFAULT_EINVOICE_SETTINGS, languagePriority: ["CUSTOMER_CHOICE", "CUSTOMER_COUNTRY", "ENTITY"] as const } as typeof DEFAULT_EINVOICE_SETTINGS;
    expect(documentLanguages(choiceFirst, { ...base, customerChoice: "en", requireOwnLanguage: false })).toEqual({ primary: "en", second: null });
    expect(documentLanguages({ ...DEFAULT_EINVOICE_SETTINGS, allowBilingual: false }, { ...base, customerChoice: "en", requireOwnLanguage: false })).toEqual({ primary: "pl", second: null });
  });
});

describe("e-invoice formats", () => {
  const p = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", removeNSPrefix: true, parseTagValue: false });

  it("Peppol BIS 3 UBL: header, parties, VAT breakdown, lines — and reads back the same", () => {
    const xml = toUbl(doc(), "PEPPOL_BIS3");
    expect(xml).toContain("urn:fdc:peppol.eu:2017:poacc:billing:3.0");
    expect(xml).toContain('<cbc:EndpointID schemeID="9946">PT509999999</cbc:EndpointID>');
    expect(xml).toContain('<cbc:PayableAmount currencyID="EUR">50.98</cbc:PayableAmount>');
    const back = parseEInvoice(xml)!;
    expect(back).toMatchObject({ format: "UBL", credit: false, number: "FT FIR2026/12", net: 46.5, vat: 4.48, gross: 50.98, currency: "EUR" });
    expect(back.lines).toHaveLength(2);
    expect(back.seller.vatId).toBe("PT515000001");
    expect(back.references).toContain("PO-77");
  });

  it("credit note uses CreditNote / CreditNoteLine and points at the invoice", () => {
    const xml = toUbl(doc({ typeCode: "381", kind: "CREDIT_NOTE", preceding: { number: "FT FIR2026/1", issueDate: "2026-11-01" } }), "PEPPOL_BIS3");
    expect(xml).toContain("<CreditNote ");
    expect(xml).toContain("<cbc:CreditedQuantity");
    expect(xml).toContain("<cbc:ID>FT FIR2026/1</cbc:ID>");
    expect(parseEInvoice(xml)!.credit).toBe(true);
  });

  it("a weighed line whose price doesn't divide evenly gets a 6-decimal price so qty × price rounds to the line amount", () => {
    const xml = toUbl(doc({ lines: [{ ...doc().lines[0], qty: "3", net: "36.61" }], taxes: [{ category: "S", rate: "6", base: "36.61", vat: "2.20" }], totals: { lineNet: "36.61", net: "36.61", vat: "2.20", gross: "38.81", paid: "0", payable: "38.81" } }), "PEPPOL_BIS3");
    const price = Number(/<cbc:PriceAmount currencyID="EUR">([\d.]+)<\/cbc:PriceAmount>/.exec(xml)![1]);
    expect(price).toBe(12.203333);
    expect((price * 3).toFixed(2)).toBe("36.61");
  });

  it("XRechnung, Factur-X CII, KSeF, FatturaPA and Verifactu are well-formed and carry the totals", () => {
    for (const f of ["XRECHNUNG", "FACTURX", "KSEF_FA3", "FATTURAPA", "VERIFACTU"] as const) {
      const { xml } = renderXml(f, doc());
      expect(() => p.parse(xml)).not.toThrow();
      expect(xml).toContain("50.98");
    }
    const cii = parseEInvoice(renderXml("FACTURX", doc()).xml)!;
    expect(cii).toMatchObject({ format: "CII", number: "FT FIR2026/12", net: 46.5, vat: 4.48, gross: 50.98, issueDate: "2026-11-19" });
  });

  it("KSeF FA(3): NIPs, VAT slots per rate, KOR for corrections, self-billing flag", () => {
    const pl = doc({ currency: "PLN", seller: { ...doc().seller, countryCode: "PL", taxId: "5260001234", vatId: "PL5260001234" }, buyer: { ...doc().buyer, countryCode: "PL", taxId: "6790002345", vatId: "PL6790002345" },
      taxes: [{ category: "S", rate: "5", base: "36.60", vat: "1.83" }, { category: "S", rate: "23", base: "9.90", vat: "2.28" }], totals: { lineNet: "46.50", net: "46.50", vat: "4.11", gross: "50.61", paid: "0", payable: "50.61" } });
    const xml = toKsef(pl);
    expect(xml).toContain("<NIP>5260001234</NIP>");
    expect(xml).toContain("<NIP>6790002345</NIP>");
    expect(xml).toContain("<P_13_3>36.60</P_13_3>");
    expect(xml).toContain("<P_14_1>2.28</P_14_1>");
    expect(xml).toContain("<RodzajFaktury>VAT</RodzajFaktury>");
    expect(xml.indexOf("<P_13_1>")).toBeLessThan(xml.indexOf("<P_13_3>"));
    const back = parseEInvoice(xml)!;
    expect(back).toMatchObject({ format: "KSEF", number: "FT FIR2026/12", net: 46.5, vat: 4.11, gross: 50.61 });
    expect(toKsef({ ...pl, typeCode: "381", kind: "CREDIT_NOTE", preceding: { number: "X/1", issueDate: "2026-11-01" } })).toContain("<RodzajFaktury>KOR</RodzajFaktury>");
    expect(toKsef({ ...pl, kind: "SELF_BILLED", typeCode: "389" })).toContain("<P_17>1</P_17>");
  });

  it("Verifactu fingerprint chains to the previous record", () => {
    const at = new Date("2026-11-19T10:00:00Z");
    const first = toVerifactu(doc({ seller: { ...doc().seller, countryCode: "ES", taxId: "B12345678" } }), at);
    expect(first.xml).toContain("<sum1:PrimerRegistro>S</sum1:PrimerRegistro>");
    expect(first.huella).toMatch(/^[0-9A-F]{64}$/);
    const second = toVerifactu(doc({ number: "F/2", seller: { ...doc().seller, countryCode: "ES", taxId: "B12345678" }, extra: { previousHash: first.huella, previousNumber: "FT FIR2026/12", previousDate: "2026-11-19" } }), at);
    expect(second.xml).toContain(`<sum1:Huella>${first.huella}</sum1:Huella>`);
    expect(second.huella).not.toBe(first.huella);
    expect(verifactuHuella({ nif: "B1", number: "1", date: "19-11-2026", type: "F1", vat: "1.00", gross: "2.00", previous: null, at: "x" })).toHaveLength(64);
  });

  it("Peppol ids split into scheme and identifier", () => {
    expect(splitPeppol("0208:0123456789")).toEqual({ scheme: "0208", id: "0123456789" });
    expect(splitPeppol("nope")).toBeNull();
  });
});

describe("e-invoice validation", () => {
  it("a complete document passes; broken totals and missing ids are errors", () => {
    expect(hasErrors(validateEDoc(doc(), "PEPPOL_BIS3"))).toBe(false);
    const bad = validateEDoc(doc({ totals: { ...doc().totals, vat: "5.00", gross: "51.50", payable: "51.50" }, buyer: { ...doc().buyer, peppolId: null } }), "PEPPOL_BIS3");
    expect(bad.map((f) => f.code)).toEqual(expect.arrayContaining(["BR-CO-14", "PEPPOL-EN16931-R010"]));
  });

  it("network rules: XRechnung needs the Leitweg-ID, KSeF the NIPs, SDI the recipient code, reverse charge both VAT ids", () => {
    expect(validateEDoc(doc({ buyerReference: null }), "XRECHNUNG").map((f) => f.code)).toContain("BR-DE-15");
    expect(validateEDoc(doc(), "KSEF_FA3").map((f) => f.code)).toEqual(expect.arrayContaining(["KSEF-01", "KSEF-NIP-1"]));
    expect(validateEDoc(doc({ seller: { ...doc().seller, countryCode: "IT" }, buyer: { ...doc().buyer, countryCode: "IT" } }), "FATTURAPA").map((f) => f.code)).toContain("SDI-02");
    const rc = doc({ buyer: { ...doc().buyer, vatId: null }, taxes: [{ category: "AE", rate: "0", base: "46.50", vat: "0", exemptionCode: "VATEX-EU-AE", exemptionText: "Reverse charge" }], totals: { lineNet: "46.50", net: "46.50", vat: "0", gross: "46.50", paid: "0", payable: "46.50" } });
    expect(validateEDoc(rc, "PEPPOL_BIS3").map((f) => f.code)).toContain("BR-AE-02");
  });
});
