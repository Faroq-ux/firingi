/**
 * Phase 45 demo: multi-currency on for Poland and Sweden (FX margin 1.5 %), 30 days of rate history, a Polish
 * wholesaler with a PLN price list (+ one item priced in EUR) and a Polish customer. Idempotent.
 */
import type { PrismaClient } from "@prisma/client";

const BASE: Record<string, number> = { CZK: 24.3, DKK: 7.46, HUF: 395, PLN: 4.25, RON: 5.08, SEK: 11.0, NOK: 11.7, CHF: 0.94, ISK: 150 };

export async function seedCurrencyDemo(db: PrismaClient) {
  const settings = {
    enabled: true, countries: { CH: false, LI: false, NO: false, IS: false, DK: false, SE: true, PL: true, CZ: false, HU: false, RO: false },
    showEur: true, supplierCurrency: true, payoutsLocal: true, localPriceLists: true,
    margins: { CHF: 0, NOK: 0, ISK: 0, DKK: 0, SEK: 1.5, PLN: 1.5, CZK: 0, HUF: 0, RON: 0 },
    feed: "ECB", autoFetch: true, alertMovePct: 2, alertFeedFailure: true, staleDays: 4, invoiceEurEquivalent: true, fxAccounting: true, reportSwitch: true,
  };
  await db.setting.upsert({ where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key: "currency.settings" } }, update: {}, create: { scope: "GLOBAL", scopeId: "", key: "currency.settings", value: settings } });

  // 30 days of reference rates before today (today's comes from the reference seed)
  const today = new Date(new Date().toISOString().slice(0, 10));
  for (const [code, base] of Object.entries(BASE))
    for (let d = 30; d >= 1; d--) {
      const date = new Date(today.getTime() - d * 86400_000);
      if (date.getUTCDay() === 0 || date.getUTCDay() === 6) continue; // the ECB publishes on working days
      const rate = +(base * (1 + 0.006 * Math.sin(d / 3 + code.charCodeAt(0)) + 0.003 * Math.cos(d / 7))).toFixed(code === "HUF" || code === "ISK" ? 2 : 4);
      await db.exchangeRate.upsert({ where: { baseCode_quoteCode_date: { baseCode: "EUR", quoteCode: code, date } }, update: {}, create: { baseCode: "EUR", quoteCode: code, rate, date, source: "ECB" } });
    }

  const pl = await db.country.findUniqueOrThrow({ where: { code: "PL" } });
  const tax = Object.fromEntries((await db.taxCategory.findMany()).map((t) => [t.code, t.id]));
  // Polish reduced VAT rates (food 5 %, other reduced 8 %)
  for (const [code, rate] of [["REDUCED", 5], ["INTERMEDIATE", 8]] as const)
    if (tax[code] && !(await db.taxRate.findFirst({ where: { countryId: pl.id, regionId: null, taxCategoryId: tax[code] } })))
      await db.taxRate.create({ data: { countryId: pl.id, taxCategoryId: tax[code], rate, taxType: "VAT", validFrom: new Date("2025-01-01") } });
  // FIRINGI delivery in Poland: minimum €50, fee €9.90 (customers see both in złoty)
  if (!(await db.deliveryRule.findFirst({ where: { scope: "COUNTRY", countryId: pl.id } })))
    await db.deliveryRule.create({ data: { scope: "COUNTRY", countryId: pl.id, minOrderValue: 50, firingiDeliveryFeeNet: 9.9, feeTaxCategoryId: tax.STANDARD } });

  // FIRINGI's Polish entity sells to Polish customers (FIRINGI invoices every buyer from the entity of its country)
  await db.legalEntity.upsert({
    where: { countryId_taxId: { countryId: pl.id, taxId: "5213999999" } }, update: {},
    create: { countryId: pl.id, legalName: "FIRINGI Polska Sp. z o.o.", taxId: "5213999999", vatNumber: "PL5213999999", addressLine: "ul. Marszałkowska 100", postalCode: "00-026", city: "Warszawa", email: "faktury@firingi.test", iban: "PL61 1090 1014 0000 0712 1981 2874" },
  });
  const whs = await db.company.findFirstOrThrow({ where: { legalName: "Hurtownia Kraków Sp. z o.o." } });
  const cust = await db.company.findFirstOrThrow({ where: { legalName: "Kebab Kraków Sp. z o.o." } });
  const addr = async (companyId: string, kind: "HEAD_OFFICE" | "WAREHOUSE" | "DELIVERY", label: string, line1: string, postal: string, at: [number, number]) =>
    (await db.address.findFirst({ where: { companyId, kind, label } })) ??
    db.address.create({ data: { companyId, kind, label, line1, postalCode: postal, cityName: "Kraków", countryId: pl.id, latitude: at[0], longitude: at[1], isDefault: true } });
  await addr(whs.id, "HEAD_OFFICE", "Siedziba", "ul. Wielicka 50", "30-552", [50.035, 19.976]);
  const store = await addr(whs.id, "WAREHOUSE", "Magazyn Kraków", "ul. Półłanki 18", "30-740", [50.025, 20.03]);
  await addr(cust.id, "HEAD_OFFICE", "Siedziba", "ul. Floriańska 20", "31-021", [50.063, 19.94]);
  await addr(cust.id, "DELIVERY", "Restauracja Rynek", "ul. Floriańska 20", "31-021", [50.063, 19.94]);

  if (!(await db.commissionRule.findFirst({ where: { vendorCompanyId: whs.id, validTo: null } })))
    await db.commissionRule.create({ data: { vendorCompanyId: whs.id, rate: 6, note: "Demo rate" } });
  if (!(await db.deliveryRule.findFirst({ where: { scope: "VENDOR", vendorCompanyId: whs.id } })))
    await db.deliveryRule.create({ data: { scope: "VENDOR", vendorCompanyId: whs.id, countryId: pl.id, vendorDeliveryMinimum: 150 } });

  const list = async (name: string, currencyCode: string) =>
    (await db.priceList.findFirst({ where: { vendorCompanyId: whs.id, scope: "BASE", currencyCode } })) ??
    db.priceList.create({ data: { vendorCompanyId: whs.id, name, scope: "BASE", countryId: pl.id, currencyCode } });
  const pln = await list("Cennik bazowy (PLN)", "PLN");
  const eur = await list("Import prices (EUR)", "EUR");
  const items: [string, number, string, number][] = [
    ["FIR-COLA33", 1, pln.id, 55], ["FIR-MOZZ2", 0, pln.id, 52.9], ["FIR-FARINHA25", 0, pln.id, 79], ["FIR-PIZZABOX33", 0, pln.id, 85], ["FIR-KEBAB10", 0, pln.id, 279],
    ["FIR-AZEITE75", 1, eur.id, 31.5], // priced in EUR: Polish customers see it in złoty at the customer rate
  ];
  for (const [i, [sku, idx, listId, price]] of items.entries()) {
    const variant = await db.productVariant.findUniqueOrThrow({ where: { sku }, include: { packagings: { orderBy: { unitsPerPack: "asc" } } } });
    const packagingUnitId = variant.packagings[idx].id;
    const offer = await db.vendorOffer.upsert({
      where: { vendorCompanyId_packagingUnitId: { vendorCompanyId: whs.id, packagingUnitId } }, update: {},
      create: { vendorCompanyId: whs.id, sellerType: "WHOLESALER", packagingUnitId, countryId: pl.id, status: "ACTIVE", minOrderQty: 1, vendorSku: `HKR-${sku.slice(4)}` },
    });
    await db.priceListItem.upsert({ where: { priceListId_offerId_minQty: { priceListId: listId, offerId: offer.id, minQty: 1 } }, update: { unitPriceNet: price }, create: { priceListId: listId, offerId: offer.id, minQty: 1, unitPriceNet: price } });
    if (!(await db.stockLevel.findFirst({ where: { offerId: offer.id } }))) await db.stockLevel.create({ data: { offerId: offer.id, addressId: store.id, onHand: 120 + i * 15 } });
  }
}
