/**
 * Demo catalogue: master products (incl. tobacco & alcohol), demo addresses, offers
 * from each demo vendor, base / group / customer prices with tiers, stock, and
 * commission rates for the approved vendors. Idempotent (keyed by SKU / names).
 */
import type { PrismaClient, Restriction } from "@prisma/client";
import { makeEan13 } from "../../src/lib/barcode";

type Pk = { uom: string; en: string; pt: string; units: number };
type P = { sku: string; en: string; pt: string; cat: string; brand?: string; tax: string; restriction?: Restriction; packs: Pk[] };

const PRODUCTS: P[] = [
  { sku: "FIR-COLA33", en: "Coca-Cola can 33cl", pt: "Coca-Cola lata 33cl", cat: "soft-drinks", brand: "Coca-Cola", tax: "STANDARD",
    packs: [{ uom: "UN", en: "Can", pt: "Lata", units: 1 }, { uom: "CX", en: "Case 24 × 33cl", pt: "Caixa 24 × 33cl", units: 24 }] },
  { sku: "FIR-LUSO15", en: "Luso still water 1.5L", pt: "Água Luso 1,5L", cat: "water", brand: "Luso", tax: "REDUCED",
    packs: [{ uom: "PK", en: "Pack 6 × 1.5L", pt: "Pack 6 × 1,5L", units: 6 }] },
  { sku: "FIR-ARROZ1", en: "Long-grain rice 1kg", pt: "Arroz agulha 1kg", cat: "rice-pasta", brand: "Cigala", tax: "REDUCED",
    packs: [{ uom: "CX", en: "Case 10 × 1kg", pt: "Caixa 10 × 1kg", units: 10 }] },
  { sku: "FIR-AZEITE75", en: "Extra virgin olive oil 750ml", pt: "Azeite virgem extra 750ml", cat: "oils-vinegar", brand: "Gallo", tax: "REDUCED",
    packs: [{ uom: "UN", en: "Bottle", pt: "Garrafa", units: 1 }, { uom: "CX", en: "Case 6 × 750ml", pt: "Caixa 6 × 750ml", units: 6 }] },
  { sku: "FIR-FARINHA25", en: "Pizza flour type 00 25kg", pt: "Farinha para pizza tipo 00 25kg", cat: "flour-dough", tax: "REDUCED",
    packs: [{ uom: "UN", en: "Sack 25kg", pt: "Saco 25kg", units: 1 }] },
  { sku: "FIR-KEBAB10", en: "Chicken kebab cone 10kg (frozen)", pt: "Cone de kebab de frango 10kg (congelado)", cat: "kebab-meat", tax: "REDUCED",
    packs: [{ uom: "UN", en: "Cone 10kg", pt: "Cone 10kg", units: 1 }] },
  { sku: "FIR-MOZZ2", en: "Mozzarella block 2kg", pt: "Mozzarella bloco 2kg", cat: "cheese-dairy", tax: "REDUCED",
    packs: [{ uom: "UN", en: "Block 2kg", pt: "Bloco 2kg", units: 1 }, { uom: "CX", en: "Case 6 × 2kg", pt: "Caixa 6 × 2kg", units: 6 }] },
  { sku: "FIR-PIZZABOX33", en: "Pizza box 33cm", pt: "Caixa de pizza 33cm", cat: "pizza-kebab-packaging", tax: "STANDARD",
    packs: [{ uom: "CX", en: "Bundle of 100", pt: "Fardo de 100", units: 100 }] },
  { sku: "FIR-SKIP3L", en: "Laundry detergent 3L", pt: "Detergente da roupa 3L", cat: "household-cleaning", brand: "Skip", tax: "STANDARD",
    packs: [{ uom: "CX", en: "Case 4 × 3L", pt: "Caixa 4 × 3L", units: 4 }] },
  { sku: "FIR-SBOCK33", en: "Lager beer 33cl", pt: "Cerveja 33cl", cat: "beer", brand: "Super Bock", tax: "STANDARD",
    packs: [{ uom: "CX", en: "Case 24 × 33cl", pt: "Grade 24 × 33cl", units: 24 }] },
  { sku: "FIR-DOURO75", en: "Douro red wine 75cl", pt: "Vinho tinto Douro 75cl", cat: "wine", tax: "INTERMEDIATE",
    packs: [{ uom: "CX", en: "Case 6 × 75cl", pt: "Caixa 6 × 75cl", units: 6 }] },
  { sku: "FIR-CIG20", en: "Cigarettes, pack of 20", pt: "Cigarros, maço de 20", cat: "cigarettes", brand: "Marlboro", tax: "STANDARD",
    packs: [{ uom: "PK", en: "Carton 10 packs", pt: "Volume 10 maços", units: 10 }] },
  // Product-level restriction inside an unrestricted category (product can ADD a restriction).
  { sku: "FIR-RUMCAKE", en: "Rum cake 400g", pt: "Bolo de rum 400g", cat: "canned-goods", tax: "REDUCED", restriction: "ALCOHOL",
    packs: [{ uom: "CX", en: "Case 12", pt: "Caixa 12", units: 12 }] },
];

/** vendor legal name → [sku, pack index, base price, tiers?][] */
const OFFERS: Record<string, [string, number, number, [number, number][]?][]> = {
  "Distribuidora Atlântico, Lda": [
    ["FIR-COLA33", 1, 11.4], ["FIR-LUSO15", 0, 2.1], ["FIR-ARROZ1", 0, 9.2], ["FIR-AZEITE75", 1, 31.5], ["FIR-FARINHA25", 0, 16.9],
    ["FIR-KEBAB10", 0, 58], ["FIR-MOZZ2", 1, 66], ["FIR-PIZZABOX33", 0, 17.5], ["FIR-SKIP3L", 0, 26], ["FIR-SBOCK33", 0, 12.8],
    ["FIR-DOURO75", 0, 27], ["FIR-CIG20", 0, 47], ["FIR-RUMCAKE", 0, 24],
  ],
  "Distribuciones Ibéricas S.L.": [["FIR-COLA33", 1, 10.9, [[50, 10.5]]], ["FIR-AZEITE75", 1, 29.9], ["FIR-ARROZ1", 0, 8.8]],
  "Grossista Lisboa Central, Lda": [
    ["FIR-COLA33", 0, 0.62], ["FIR-COLA33", 1, 13.9, [[10, 13.4], [30, 12.9]]], ["FIR-LUSO15", 0, 2.6], ["FIR-ARROZ1", 0, 11.2],
    ["FIR-AZEITE75", 0, 6.4], ["FIR-AZEITE75", 1, 37.5], ["FIR-FARINHA25", 0, 19.9], ["FIR-KEBAB10", 0, 69], ["FIR-MOZZ2", 0, 13.5],
    ["FIR-MOZZ2", 1, 78], ["FIR-PIZZABOX33", 0, 21], ["FIR-SBOCK33", 0, 15.9], ["FIR-DOURO75", 0, 33], ["FIR-CIG20", 0, 52], ["FIR-RUMCAKE", 0, 29],
  ],
  // Pending wholesaler: its offers exist but must never be visible.
  "Grossista Porto Norte, Lda": [["FIR-COLA33", 1, 12.5], ["FIR-MOZZ2", 1, 70]],
};

const COMMISSION: Record<string, number> = { "Distribuidora Atlântico, Lda": 5, "Distribuciones Ibéricas S.L.": 6, "Grossista Lisboa Central, Lda": 8 };

const ADDRESSES: Record<string, { kind: "HEAD_OFFICE" | "WAREHOUSE" | "PICKUP" | "DELIVERY"; label: string; line1: string; postal: string; city: string; country: string }[]> = {
  "Distribuidora Atlântico, Lda": [
    { kind: "HEAD_OFFICE", label: "Sede", line1: "Rua do Comércio 5", postal: "4000-100", city: "Porto", country: "PT" },
    { kind: "WAREHOUSE", label: "Armazém Maia", line1: "Zona Industrial da Maia, Lote 12", postal: "4470-000", city: "Matosinhos", country: "PT" },
  ],
  "Distribuciones Ibéricas S.L.": [
    { kind: "HEAD_OFFICE", label: "Oficina central", line1: "Calle de Alcalá 100", postal: "28009", city: "Madrid", country: "ES" },
    { kind: "WAREHOUSE", label: "Almacén Coslada", line1: "Polígono Industrial 3", postal: "28820", city: "Madrid", country: "ES" },
  ],
  "Grossista Lisboa Central, Lda": [
    { kind: "HEAD_OFFICE", label: "Sede", line1: "Avenida Infante D. Henrique 300", postal: "1950-421", city: "Lisboa", country: "PT" },
    { kind: "WAREHOUSE", label: "Armazém Lisboa", line1: "Rua do Açúcar 50", postal: "1950-009", city: "Lisboa", country: "PT" },
    { kind: "PICKUP", label: "Cash & carry Amadora", line1: "Estrada da Falagueira 20", postal: "2700-365", city: "Amadora", country: "PT" },
    { kind: "DELIVERY", label: "Receção armazém", line1: "Rua do Açúcar 50", postal: "1950-009", city: "Lisboa", country: "PT" },
  ],
  "Grossista Porto Norte, Lda": [{ kind: "HEAD_OFFICE", label: "Sede", line1: "Rua de Santa Catarina 200", postal: "4000-442", city: "Porto", country: "PT" }],
  "Kebab House Lisboa, Lda": [
    { kind: "HEAD_OFFICE", label: "Sede", line1: "Rua da Madalena 120", postal: "1100-319", city: "Lisboa", country: "PT" },
    { kind: "DELIVERY", label: "Restaurante Baixa", line1: "Rua da Madalena 120", postal: "1100-319", city: "Lisboa", country: "PT" },
  ],
  "Mini-Mercado Sol, Unipessoal Lda": [{ kind: "HEAD_OFFICE", label: "Loja", line1: "Rua de Benfica 300", postal: "1500-086", city: "Lisboa", country: "PT" }],
  "Pizzaria Bella Porto, Lda": [{ kind: "HEAD_OFFICE", label: "Pizzaria", line1: "Rua das Flores 50", postal: "4050-262", city: "Porto", country: "PT" }],
};

/** Demo barcodes: unit EAN-13 per SKU, and a separate barcode per multi-unit packaging. */
const UNIT_EAN: Record<string, string> = {
  "FIR-COLA33": "5449000000996", // real Coca-Cola 33cl can EAN
  "FIR-LUSO15": makeEan13("560100000015"), "FIR-ARROZ1": makeEan13("560100000022"), "FIR-AZEITE75": makeEan13("560100000039"),
  "FIR-FARINHA25": makeEan13("560100000046"), "FIR-KEBAB10": makeEan13("560100000053"), "FIR-MOZZ2": makeEan13("560100000060"),
  "FIR-PIZZABOX33": makeEan13("560100000077"), "FIR-SKIP3L": makeEan13("560100000084"), "FIR-SBOCK33": makeEan13("560100000091"),
  "FIR-DOURO75": makeEan13("560100000107"), "FIR-CIG20": makeEan13("560100000114"), "FIR-RUMCAKE": makeEan13("560100000121"),
};
/** Case / pack barcode: GTIN-14 style "1" + unit EAN body, recomputed check digit. */
const packGtin = (unitEan: string, idx: number) => makeEan13(`56020${unitEan.slice(5, 11)}${idx}`);

export async function seedCatalogue(db: PrismaClient) {
  const country = Object.fromEntries((await db.country.findMany({ select: { code: true, id: true } })).map((c) => [c.code, c.id]));
  const tax = Object.fromEntries((await db.taxCategory.findMany()).map((t) => [t.code, t.id]));
  const company = async (legalName: string) => db.company.findFirstOrThrow({ where: { legalName } });

  // Addresses
  for (const [name, list] of Object.entries(ADDRESSES)) {
    const c = await company(name);
    for (const a of list) {
      if (await db.address.findFirst({ where: { companyId: c.id, kind: a.kind, label: a.label } })) continue;
      const city = await db.city.findFirst({ where: { name: a.city, countryId: country[a.country] } });
      const isDefault = !(await db.address.count({ where: { companyId: c.id, kind: a.kind, isDefault: true } }));
      await db.address.create({
        data: { companyId: c.id, kind: a.kind, label: a.label, line1: a.line1, postalCode: a.postal, cityId: city?.id ?? null, cityName: a.city,
          countryId: country[a.country], latitude: city?.latitude ?? null, longitude: city?.longitude ?? null, isDefault },
      });
    }
  }

  // Brands + products
  const packIds: Record<string, string[]> = {};
  for (const p of PRODUCTS) {
    const brand = p.brand ? await db.brand.upsert({ where: { name: p.brand }, update: {}, create: { name: p.brand } }) : null;
    const category = await db.category.findUniqueOrThrow({ where: { slug: p.cat } });
    let variant = await db.productVariant.findUnique({ where: { sku: p.sku }, include: { packagings: { orderBy: { unitsPerPack: "asc" } } } });
    if (!variant) {
      const product = await db.product.create({
        data: {
          name: { en: p.en, pt: p.pt }, categoryId: category.id, brandId: brand?.id ?? null, taxCategoryId: tax[p.tax], restriction: p.restriction ?? null,
          status: "APPROVED", approvedAt: new Date(),
          searchText: [p.en, p.pt, p.brand ?? "", p.sku].join(" ").toLowerCase(),
          variants: { create: { sku: p.sku, packagings: { create: p.packs.map((k) => ({ uomCode: k.uom, name: { en: k.en, pt: k.pt }, unitsPerPack: k.units })) } } },
        },
      });
      variant = await db.productVariant.findUniqueOrThrow({ where: { sku: p.sku }, include: { packagings: { orderBy: { unitsPerPack: "asc" } } } });
      void product;
    }
    packIds[p.sku] = variant.packagings.map((x) => x.id);
    // Barcodes (filled in when missing, so re-seeding an older database adds them).
    const ean = UNIT_EAN[p.sku];
    if (ean && !variant.gtin) await db.productVariant.update({ where: { id: variant.id }, data: { gtin: ean } });
    for (const [i, pk] of variant.packagings.entries())
      if (!pk.gtin) await db.packagingUnit.update({ where: { id: pk.id }, data: { gtin: pk.unitsPerPack === 1 ? null : packGtin(ean, i) } });
    await db.product.update({
      where: { id: variant.productId },
      data: { searchText: [p.en, p.pt, p.brand ?? "", p.sku, ean, ...variant.packagings.map((pk, i) => (pk.unitsPerPack === 1 ? "" : packGtin(ean, i)))].join(" ").toLowerCase() },
    });
  }

  // Commission for approved vendors (no default commission in FIRINGI).
  for (const [name, rate] of Object.entries(COMMISSION)) {
    const c = await company(name);
    if (!(await db.commissionRule.findFirst({ where: { vendorCompanyId: c.id, validTo: null } })))
      await db.commissionRule.create({ data: { vendorCompanyId: c.id, rate, note: "Demo rate" } });
  }

  // Offers, base prices, stock
  for (const [name, offers] of Object.entries(OFFERS)) {
    const v = await company(name);
    const base =
      (await db.priceList.findFirst({ where: { vendorCompanyId: v.id, scope: "BASE" } })) ??
      (await db.priceList.create({ data: { vendorCompanyId: v.id, name: "Base prices", scope: "BASE", countryId: v.countryId } }));
    const store = await db.address.findFirst({ where: { companyId: v.id, kind: "WAREHOUSE" } });
    for (const [i, [sku, packIdx, price, tiers]] of offers.entries()) {
      const packagingUnitId = packIds[sku][packIdx];
      const offer = await db.vendorOffer.upsert({
        where: { vendorCompanyId_packagingUnitId: { vendorCompanyId: v.id, packagingUnitId } },
        update: {},
        create: { vendorCompanyId: v.id, sellerType: v.type as "WHOLESALER", packagingUnitId, countryId: v.countryId, status: "ACTIVE", minOrderQty: 1, vendorSku: `${v.legalName.slice(0, 3).toUpperCase()}-${sku.slice(4)}` },
      });
      for (const [minQty, p] of [[1, price] as [number, number], ...(tiers ?? [])])
        await db.priceListItem.upsert({
          where: { priceListId_offerId_minQty: { priceListId: base.id, offerId: offer.id, minQty } },
          update: { unitPriceNet: p },
          create: { priceListId: base.id, offerId: offer.id, minQty, unitPriceNet: p },
        });
      if (store && !(await db.stockLevel.findFirst({ where: { offerId: offer.id } })))
        await db.stockLevel.create({ data: { offerId: offer.id, addressId: store.id, onHand: i % 5 === 4 ? 0 : 40 + ((i * 37) % 200) } });
    }
  }

  // Lisboa Central: a customer group with group prices, and a Kebab House contract price.
  const lx = await company("Grossista Lisboa Central, Lda");
  const kebab = await company("Kebab House Lisboa, Lda");
  const group =
    (await db.customerGroup.findFirst({ where: { ownerCompanyId: lx.id, name: "Kebab & pizza restaurants" } })) ??
    (await db.customerGroup.create({ data: { ownerCompanyId: lx.id, name: "Kebab & pizza restaurants", description: "Better prices on kebab & pizza supplies" } }));
  await db.customerGroupMember.upsert({ where: { groupId_companyId: { groupId: group.id, companyId: kebab.id } }, update: {}, create: { groupId: group.id, companyId: kebab.id } });
  const lxOffer = async (sku: string, idx: number) =>
    db.vendorOffer.findUniqueOrThrow({ where: { vendorCompanyId_packagingUnitId: { vendorCompanyId: lx.id, packagingUnitId: packIds[sku][idx] } } });
  const groupList =
    (await db.priceList.findFirst({ where: { vendorCompanyId: lx.id, scope: "CUSTOMER_GROUP", targetGroupId: group.id } })) ??
    (await db.priceList.create({ data: { vendorCompanyId: lx.id, name: "Restaurant prices", scope: "CUSTOMER_GROUP", targetGroupId: group.id, countryId: lx.countryId } }));
  for (const [sku, idx, p] of [["FIR-FARINHA25", 0, 18.5], ["FIR-KEBAB10", 0, 64], ["FIR-PIZZABOX33", 0, 19.5]] as const) {
    const o = await lxOffer(sku, idx);
    await db.priceListItem.upsert({ where: { priceListId_offerId_minQty: { priceListId: groupList.id, offerId: o.id, minQty: 1 } }, update: {}, create: { priceListId: groupList.id, offerId: o.id, minQty: 1, unitPriceNet: p } });
  }
  const contract =
    (await db.priceList.findFirst({ where: { vendorCompanyId: lx.id, scope: "CONTRACT", targetCompanyId: kebab.id } })) ??
    (await db.priceList.create({ data: { vendorCompanyId: lx.id, name: "Kebab House contract 2026", scope: "CONTRACT", targetCompanyId: kebab.id, countryId: lx.countryId } }));
  const mozz = await lxOffer("FIR-MOZZ2", 0);
  await db.priceListItem.upsert({ where: { priceListId_offerId_minQty: { priceListId: contract.id, offerId: mozz.id, minQty: 1 } }, update: {}, create: { priceListId: contract.id, offerId: mozz.id, minQty: 1, unitPriceNet: 12.2 } });

  await db.setting.upsert({
    where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key: "catalogue.offerApprovalRequired" } },
    update: {},
    create: { scope: "GLOBAL", scopeId: "", key: "catalogue.offerApprovalRequired", value: false },
  });
}
