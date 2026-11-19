/**
 * Reference data: currencies, languages, 27 EU countries, PT/ES regions & cities,
 * tax categories & rates, exemption reasons, units of measure, category tree.
 * Idempotent (safe to re-run).
 *
 * ⚠ Tax rates are seeded for development. Have them confirmed by your accountant
 *   before go-live; rates change via new TaxRate rows (validFrom/validTo), never edits.
 */
import { UI_LOCALES } from "../../src/i18n/config";
import type { PrismaClient, Restriction } from "@prisma/client";

const CURRENCIES = [
  { code: "EUR", name: "Euro", symbol: "€" },
  { code: "CZK", name: "Czech koruna", symbol: "Kč" },
  { code: "DKK", name: "Danish krone", symbol: "kr" },
  { code: "HUF", name: "Hungarian forint", symbol: "Ft" },
  { code: "PLN", name: "Polish złoty", symbol: "zł" },
  { code: "RON", name: "Romanian leu", symbol: "lei" },
  { code: "SEK", name: "Swedish krona", symbol: "kr" },
  { code: "NOK", name: "Norwegian krone", symbol: "kr" },
  { code: "CHF", name: "Swiss franc", symbol: "CHF" },
  { code: "ISK", name: "Icelandic króna", symbol: "kr", decimals: 0 },
];

/** Approximate EUR rates for development only — replace with an ECB feed. */
const FX: Record<string, number> = { CZK: 24.3, DKK: 7.46, HUF: 395, PLN: 4.25, RON: 5.08, SEK: 11.0, NOK: 11.7, CHF: 0.94, ISK: 150 };

const LANGUAGES: [code: string, name: string, native: string, ui?: boolean][] = [ // ui flag now comes from UI_LOCALES
  ["en", "English", "English", true], ["pt-PT", "Portuguese (Portugal)", "Português", true], ["es", "Spanish", "Español", true],
  ["de", "German", "Deutsch"], ["fr", "French", "Français"], ["nl", "Dutch", "Nederlands"], ["it", "Italian", "Italiano"],
  ["pl", "Polish", "Polski"], ["ro", "Romanian", "Română"], ["cs", "Czech", "Čeština"], ["sk", "Slovak", "Slovenčina"],
  ["sl", "Slovenian", "Slovenščina"], ["hr", "Croatian", "Hrvatski"], ["bg", "Bulgarian", "Български"], ["el", "Greek", "Ελληνικά"],
  ["hu", "Hungarian", "Magyar"], ["da", "Danish", "Dansk"], ["sv", "Swedish", "Svenska"], ["fi", "Finnish", "Suomi"],
  ["et", "Estonian", "Eesti"], ["lv", "Latvian", "Latviešu"], ["lt", "Lithuanian", "Lietuvių"], ["mt", "Maltese", "Malti"],
  ["ga", "Irish", "Gaeilge"], ["lb", "Luxembourgish", "Lëtzebuergesch"], ["nb", "Norwegian (Bokmål)", "Norsk bokmål"],
  ["is", "Icelandic", "Íslenska"], ["rm", "Romansh", "Rumantsch"],
];

type C = { code: string; en: string; pt: string; es: string; flag: string; cur: string; langs: string[]; vat: number; prefix?: string; eu?: false; schengen?: false };
/**
 * FIRINGI operates within the Schengen area. Cyprus and Ireland are EU but not Schengen
 * (kept inactive); Norway, Switzerland, Iceland and Liechtenstein are Schengen but not EU.
 */
const EU: C[] = [
  { code: "PT", en: "Portugal", pt: "Portugal", es: "Portugal", flag: "🇵🇹", cur: "EUR", langs: ["pt-PT"], vat: 23 },
  { code: "ES", en: "Spain", pt: "Espanha", es: "España", flag: "🇪🇸", cur: "EUR", langs: ["es"], vat: 21 },
  { code: "AT", en: "Austria", pt: "Áustria", es: "Austria", flag: "🇦🇹", cur: "EUR", langs: ["de"], vat: 20 },
  { code: "BE", en: "Belgium", pt: "Bélgica", es: "Bélgica", flag: "🇧🇪", cur: "EUR", langs: ["nl", "fr", "de"], vat: 21 },
  { code: "BG", en: "Bulgaria", pt: "Bulgária", es: "Bulgaria", flag: "🇧🇬", cur: "EUR", langs: ["bg"], vat: 20 },
  { code: "HR", en: "Croatia", pt: "Croácia", es: "Croacia", flag: "🇭🇷", cur: "EUR", langs: ["hr"], vat: 25 },
  { code: "CY", en: "Cyprus", pt: "Chipre", es: "Chipre", flag: "🇨🇾", cur: "EUR", langs: ["el"], vat: 19, schengen: false },
  { code: "CZ", en: "Czechia", pt: "Chéquia", es: "Chequia", flag: "🇨🇿", cur: "CZK", langs: ["cs"], vat: 21 },
  { code: "DK", en: "Denmark", pt: "Dinamarca", es: "Dinamarca", flag: "🇩🇰", cur: "DKK", langs: ["da"], vat: 25 },
  { code: "EE", en: "Estonia", pt: "Estónia", es: "Estonia", flag: "🇪🇪", cur: "EUR", langs: ["et"], vat: 24 },
  { code: "FI", en: "Finland", pt: "Finlândia", es: "Finlandia", flag: "🇫🇮", cur: "EUR", langs: ["fi", "sv"], vat: 25.5 },
  { code: "FR", en: "France", pt: "França", es: "Francia", flag: "🇫🇷", cur: "EUR", langs: ["fr"], vat: 20 },
  { code: "DE", en: "Germany", pt: "Alemanha", es: "Alemania", flag: "🇩🇪", cur: "EUR", langs: ["de"], vat: 19 },
  { code: "GR", en: "Greece", pt: "Grécia", es: "Grecia", flag: "🇬🇷", cur: "EUR", langs: ["el"], vat: 24, prefix: "EL" },
  { code: "HU", en: "Hungary", pt: "Hungria", es: "Hungría", flag: "🇭🇺", cur: "HUF", langs: ["hu"], vat: 27 },
  { code: "IE", en: "Ireland", pt: "Irlanda", es: "Irlanda", flag: "🇮🇪", cur: "EUR", langs: ["en", "ga"], vat: 23, schengen: false },
  { code: "IT", en: "Italy", pt: "Itália", es: "Italia", flag: "🇮🇹", cur: "EUR", langs: ["it"], vat: 22 },
  { code: "LV", en: "Latvia", pt: "Letónia", es: "Letonia", flag: "🇱🇻", cur: "EUR", langs: ["lv"], vat: 21 },
  { code: "LT", en: "Lithuania", pt: "Lituânia", es: "Lituania", flag: "🇱🇹", cur: "EUR", langs: ["lt"], vat: 21 },
  { code: "LU", en: "Luxembourg", pt: "Luxemburgo", es: "Luxemburgo", flag: "🇱🇺", cur: "EUR", langs: ["fr", "de", "lb"], vat: 17 },
  { code: "MT", en: "Malta", pt: "Malta", es: "Malta", flag: "🇲🇹", cur: "EUR", langs: ["mt", "en"], vat: 18 },
  { code: "NL", en: "Netherlands", pt: "Países Baixos", es: "Países Bajos", flag: "🇳🇱", cur: "EUR", langs: ["nl"], vat: 21 },
  { code: "PL", en: "Poland", pt: "Polónia", es: "Polonia", flag: "🇵🇱", cur: "PLN", langs: ["pl"], vat: 23 },
  { code: "RO", en: "Romania", pt: "Roménia", es: "Rumanía", flag: "🇷🇴", cur: "RON", langs: ["ro"], vat: 21 },
  { code: "SK", en: "Slovakia", pt: "Eslováquia", es: "Eslovaquia", flag: "🇸🇰", cur: "EUR", langs: ["sk"], vat: 23 },
  { code: "SI", en: "Slovenia", pt: "Eslovénia", es: "Eslovenia", flag: "🇸🇮", cur: "EUR", langs: ["sl"], vat: 22 },
  { code: "SE", en: "Sweden", pt: "Suécia", es: "Suecia", flag: "🇸🇪", cur: "SEK", langs: ["sv"], vat: 25 },
  { code: "NO", en: "Norway", pt: "Noruega", es: "Noruega", flag: "🇳🇴", cur: "NOK", langs: ["nb"], vat: 25, eu: false },
  { code: "CH", en: "Switzerland", pt: "Suíça", es: "Suiza", flag: "🇨🇭", cur: "CHF", langs: ["de", "fr", "it"], vat: 8.1, prefix: "CHE", eu: false },
  { code: "IS", en: "Iceland", pt: "Islândia", es: "Islandia", flag: "🇮🇸", cur: "ISK", langs: ["is"], vat: 24, eu: false },
  { code: "LI", en: "Liechtenstein", pt: "Listenstaine", es: "Liechtenstein", flag: "🇱🇮", cur: "CHF", langs: ["de"], vat: 8.1, eu: false },
];

/** Regions & cities for the launch markets. taxRegion = regions with their own rates. */
const REGIONS: { country: string; code: string; en: string; pt: string; taxRegion?: string; cities: [string, number, number][] }[] = [
  { country: "PT", code: "PT-11", en: "Lisbon", pt: "Lisboa", cities: [["Lisboa", 38.7223, -9.1393], ["Sintra", 38.8029, -9.3817], ["Amadora", 38.7538, -9.2308]] },
  { country: "PT", code: "PT-13", en: "Porto", pt: "Porto", cities: [["Porto", 41.1579, -8.6291], ["Vila Nova de Gaia", 41.1239, -8.6118], ["Matosinhos", 41.1844, -8.6963]] },
  { country: "PT", code: "PT-15", en: "Setúbal", pt: "Setúbal", cities: [["Setúbal", 38.5244, -8.8882], ["Almada", 38.6790, -9.1569]] },
  { country: "PT", code: "PT-03", en: "Braga", pt: "Braga", cities: [["Braga", 41.5454, -8.4265]] },
  { country: "PT", code: "PT-08", en: "Faro", pt: "Faro", cities: [["Faro", 37.0194, -7.9322], ["Albufeira", 37.0891, -8.2479]] },
  { country: "PT", code: "PT-30", en: "Madeira", pt: "Madeira", taxRegion: "PT-MA", cities: [["Funchal", 32.6669, -16.9241]] },
  { country: "PT", code: "PT-20", en: "Azores", pt: "Açores", taxRegion: "PT-AC", cities: [["Ponta Delgada", 37.7412, -25.6756]] },
  { country: "ES", code: "ES-MD", en: "Community of Madrid", pt: "Comunidade de Madrid", cities: [["Madrid", 40.4168, -3.7038]] },
  { country: "ES", code: "ES-CT", en: "Catalonia", pt: "Catalunha", cities: [["Barcelona", 41.3874, 2.1686]] },
  { country: "ES", code: "ES-CN", en: "Canary Islands", pt: "Canárias", taxRegion: "ES-CN", cities: [["Las Palmas de Gran Canaria", 28.1235, -15.4363]] },
];

const TAX_CATEGORIES = [
  { code: "STANDARD", name: { en: "Standard rate", pt: "Taxa normal" } },
  { code: "INTERMEDIATE", name: { en: "Intermediate rate", pt: "Taxa intermédia" } },
  { code: "REDUCED", name: { en: "Reduced rate", pt: "Taxa reduzida" } },
  { code: "SUPER_REDUCED", name: { en: "Super-reduced rate", pt: "Taxa super-reduzida" } },
  { code: "EXEMPT", name: { en: "Exempt", pt: "Isento" } },
];

/** [country, regionCode|null, category, rate, saftCode, taxType] */
const RATES: [string, string | null, string, number, string | null, string][] = [
  ["PT", null, "STANDARD", 23, "NOR", "VAT"], ["PT", null, "INTERMEDIATE", 13, "INT", "VAT"], ["PT", null, "REDUCED", 6, "RED", "VAT"], ["PT", null, "EXEMPT", 0, "ISE", "VAT"],
  ["PT", "PT-30", "STANDARD", 22, "NOR", "VAT"], ["PT", "PT-30", "INTERMEDIATE", 12, "INT", "VAT"], ["PT", "PT-30", "REDUCED", 4, "RED", "VAT"],
  ["PT", "PT-20", "STANDARD", 16, "NOR", "VAT"], ["PT", "PT-20", "INTERMEDIATE", 9, "INT", "VAT"], ["PT", "PT-20", "REDUCED", 4, "RED", "VAT"],
  ["ES", null, "STANDARD", 21, null, "VAT"], ["ES", null, "REDUCED", 10, null, "VAT"], ["ES", null, "SUPER_REDUCED", 4, null, "VAT"], ["ES", null, "EXEMPT", 0, null, "VAT"],
  ["ES", "ES-CN", "STANDARD", 7, null, "IGIC"], ["ES", "ES-CN", "REDUCED", 3, null, "IGIC"], ["ES", "ES-CN", "SUPER_REDUCED", 0, null, "IGIC"],
];

const PT_EXEMPTIONS: [string, { en: string; pt: string }][] = [
  ["M07", { en: "Exempt under Article 9 of the VAT Code", pt: "Isento artigo 9.º do CIVA" }],
  ["M16", { en: "Exempt under Article 14 of RITI (intra-EU supply)", pt: "Isento artigo 14.º do RITI" }],
  ["M99", { en: "Not subject to VAT / not taxed", pt: "Não sujeito ou não tributado" }],
];

const UNITS: [string, { en: string; pt: string; es: string }][] = [
  ["UN", { en: "Unit", pt: "Unidade", es: "Unidad" }], ["KG", { en: "Kilogram", pt: "Quilograma", es: "Kilogramo" }],
  ["L", { en: "Litre", pt: "Litro", es: "Litro" }], ["PK", { en: "Pack", pt: "Pack", es: "Paquete" }],
  ["CX", { en: "Case / Box", pt: "Caixa", es: "Caja" }], ["PAL", { en: "Pallet", pt: "Palete", es: "Palé" }],
];

type CatDef = { slug: string; en: string; pt: string; es: string; tax?: string; restriction?: Restriction; children?: CatDef[] };
const CATEGORIES: CatDef[] = [
  { slug: "groceries", en: "Groceries", pt: "Mercearia", es: "Alimentación", tax: "REDUCED", children: [
    { slug: "rice-pasta", en: "Rice & Pasta", pt: "Arroz e Massa", es: "Arroz y pasta" },
    { slug: "oils-vinegar", en: "Oils & Vinegar", pt: "Azeites e Vinagres", es: "Aceites y vinagres" },
    { slug: "canned-goods", en: "Canned Goods", pt: "Conservas", es: "Conservas" },
    { slug: "spices", en: "Spices & Seasoning", pt: "Especiarias e Temperos", es: "Especias" },
  ] },
  { slug: "fresh-produce", en: "Fresh Produce", pt: "Frescos", es: "Productos frescos", tax: "REDUCED", children: [
    { slug: "fruit", en: "Fruit", pt: "Fruta", es: "Fruta" },
    { slug: "vegetables", en: "Vegetables", pt: "Legumes", es: "Verduras" },
  ] },
  { slug: "beverages", en: "Beverages", pt: "Bebidas", es: "Bebidas", tax: "STANDARD", children: [
    { slug: "water", en: "Water", pt: "Água", es: "Agua", tax: "REDUCED" },
    { slug: "soft-drinks", en: "Soft Drinks", pt: "Refrigerantes", es: "Refrescos" },
    { slug: "juices", en: "Juices", pt: "Sumos", es: "Zumos" },
    { slug: "alcoholic-beverages", en: "Alcoholic Beverages", pt: "Bebidas Alcoólicas", es: "Bebidas alcohólicas", restriction: "ALCOHOL", children: [
      { slug: "beer", en: "Beer", pt: "Cerveja", es: "Cerveza" },
      { slug: "wine", en: "Wine", pt: "Vinho", es: "Vino", tax: "INTERMEDIATE" },
      { slug: "spirits", en: "Spirits", pt: "Bebidas Espirituosas", es: "Licores" },
    ] },
  ] },
  { slug: "cosmetics-beauty", en: "Cosmetics & Beauty", pt: "Cosmética e Beleza", es: "Cosmética y belleza" },
  { slug: "personal-hygiene", en: "Personal Hygiene", pt: "Higiene Pessoal", es: "Higiene personal" },
  { slug: "household-cleaning", en: "Household & Cleaning", pt: "Casa e Limpeza", es: "Hogar y limpieza" },
  { slug: "baby-childcare", en: "Baby & Childcare", pt: "Bebé e Puericultura", es: "Bebé y puericultura" },
  { slug: "pet-supplies", en: "Pet Supplies", pt: "Animais de Estimação", es: "Mascotas" },
  { slug: "tobacco", en: "Tobacco", pt: "Tabaco", es: "Tabaco", restriction: "TOBACCO", children: [
    { slug: "cigarettes", en: "Cigarettes", pt: "Cigarros", es: "Cigarrillos" },
    { slug: "rolling-tobacco", en: "Rolling Tobacco", pt: "Tabaco de Enrolar", es: "Tabaco de liar" },
    { slug: "smoking-accessories", en: "Smoking Accessories", pt: "Acessórios", es: "Accesorios" },
  ] },
  { slug: "fashion-accessories", en: "Fashion & Accessories", pt: "Moda e Acessórios", es: "Moda y accesorios" },
  { slug: "toys-kids", en: "Toys & Kids", pt: "Brinquedos e Criança", es: "Juguetes" },
  { slug: "souvenirs-gifts", en: "Souvenirs & Gifts", pt: "Lembranças e Presentes", es: "Recuerdos y regalos" },
  { slug: "packaging-supplies", en: "Packaging & Supplies", pt: "Embalagens e Consumíveis", es: "Envases y suministros" },
  { slug: "kebab-pizza-supplies", en: "Kebab & Pizza Supplies", pt: "Produtos para Kebab e Pizza", es: "Suministros kebab y pizza", tax: "REDUCED", children: [
    { slug: "kebab-meat", en: "Kebab Meat", pt: "Carne para Kebab", es: "Carne de kebab" },
    { slug: "cheese-dairy", en: "Cheese & Dairy", pt: "Queijo e Lacticínios", es: "Queso y lácteos" },
    { slug: "flour-dough", en: "Flour & Dough", pt: "Farinha e Massas", es: "Harina y masas" },
    { slug: "sauces", en: "Sauces", pt: "Molhos", es: "Salsas", tax: "INTERMEDIATE" },
    { slug: "pizza-kebab-packaging", en: "Boxes & Wrapping", pt: "Caixas e Embalagens", es: "Cajas y envoltorios", tax: "STANDARD" },
  ] },
];

const VALID_FROM = new Date("2025-01-01");

export async function seedReference(db: PrismaClient) {
  for (const c of CURRENCIES) await db.currency.upsert({ where: { code: c.code }, update: c, create: c });
  for (const [code, rate] of Object.entries(FX)) {
    const date = new Date(new Date().toISOString().slice(0, 10));
    await db.exchangeRate.upsert({
      where: { baseCode_quoteCode_date: { baseCode: "EUR", quoteCode: code, date } },
      update: {},
      create: { baseCode: "EUR", quoteCode: code, rate, date, source: "seed (approximate)" },
    });
  }
  for (const [code, name, native] of LANGUAGES) {
    const ui = (UI_LOCALES as readonly string[]).includes(code);
    await db.language.upsert({ where: { code }, update: { name, native, uiAvailable: ui }, create: { code, name, native, uiAvailable: ui } });
  }

  const countryIds: Record<string, string> = {};
  for (const c of EU) {
    const data = {
      name: { en: c.en, pt: c.pt, es: c.es },
      flag: c.flag,
      isEU: c.eu !== false,
      isSchengen: c.schengen !== false,
      isActive: c.schengen !== false,
      vatPrefix: c.prefix ?? c.code,
      defaultCurrencyCode: c.cur,
      defaultLanguageCode: c.langs[0],
      // Launch configuration: customers & wholesalers Portugal-only; distributors in any EU
      // Schengen country. Non-EU Schengen countries wait for customs/import handling.
      customerMarketEnabled: c.code === "PT",
      wholesalerMarketEnabled: c.code === "PT",
      distributorSourcingEnabled: c.schengen !== false && c.eu !== false,
    };
    const row = await db.country.upsert({ where: { code: c.code }, update: data, create: { code: c.code, ...data } });
    countryIds[c.code] = row.id;
    for (const [i, lang] of c.langs.entries())
      await db.countryLanguage.upsert({
        where: { countryId_languageCode: { countryId: row.id, languageCode: lang } },
        update: { sortOrder: i },
        create: { countryId: row.id, languageCode: lang, sortOrder: i },
      });
  }

  const regionIds: Record<string, string> = {};
  for (const r of REGIONS) {
    const countryId = countryIds[r.country];
    const region = await db.region.upsert({
      where: { countryId_code: { countryId, code: r.code } },
      update: { name: { en: r.en, pt: r.pt }, taxRegionCode: r.taxRegion ?? null },
      create: { countryId, code: r.code, name: { en: r.en, pt: r.pt }, taxRegionCode: r.taxRegion ?? null },
    });
    regionIds[r.code] = region.id;
    for (const [name, lat, lng] of r.cities)
      await db.city.upsert({
        where: { regionId_name: { regionId: region.id, name } },
        update: { latitude: lat, longitude: lng },
        create: { countryId, regionId: region.id, name, latitude: lat, longitude: lng },
      });
  }

  const taxCatIds: Record<string, string> = {};
  for (const t of TAX_CATEGORIES) {
    const row = await db.taxCategory.upsert({ where: { code: t.code }, update: { name: t.name }, create: t });
    taxCatIds[t.code] = row.id;
  }

  // Tax rates: PT & ES in full; other EU countries standard rate (for intra-EU reference).
  const allRates = [...RATES, ...EU.filter((c) => !["PT", "ES"].includes(c.code)).map((c) => [c.code, null, "STANDARD", c.vat, null, "VAT"] as (typeof RATES)[number])];
  for (const [country, regionCode, cat, rate, saft, taxType] of allRates) {
    const where = { countryId: countryIds[country], regionId: regionCode ? regionIds[regionCode] : null, taxCategoryId: taxCatIds[cat], validFrom: VALID_FROM };
    const existing = await db.taxRate.findFirst({ where });
    if (!existing) await db.taxRate.create({ data: { ...where, rate, saftCode: saft, taxType } });
  }

  for (const [code, text] of PT_EXEMPTIONS)
    await db.taxExemptionReason.upsert({
      where: { countryId_code: { countryId: countryIds.PT, code } },
      update: { text },
      create: { countryId: countryIds.PT, code, text },
    });

  for (const [code, name] of UNITS) await db.unitOfMeasure.upsert({ where: { code }, update: { name }, create: { code, name } });

  async function upsertCategory(def: CatDef, parent: { id: string; path: string; depth: number } | null, sort: number) {
    const data = {
      name: { en: def.en, pt: def.pt, es: def.es },
      parentId: parent?.id ?? null,
      depth: parent ? parent.depth + 1 : 0,
      sortOrder: sort,
      restriction: def.restriction ?? null,
      defaultTaxCategoryId: def.tax ? taxCatIds[def.tax] : null,
    };
    let row = await db.category.findUnique({ where: { slug: def.slug } });
    row = row
      ? await db.category.update({ where: { id: row.id }, data })
      : await db.category.create({ data: { ...data, slug: def.slug, path: "" } });
    const path = `${parent?.path ?? "/"}${row.id}/`;
    if (row.path !== path) await db.category.update({ where: { id: row.id }, data: { path } });
    for (const [i, child] of (def.children ?? []).entries()) await upsertCategory(child, { id: row.id, path, depth: data.depth }, i);
  }
  for (const [i, c] of CATEGORIES.entries()) await upsertCategory(c, null, i);

  // Phase 42: temperature classes (same rows as the migration) and the category defaults
  const TEMP_CLASSES = [
    { id: "tc_ambient", code: "AMBIENT", name: { en: "Ambient", pt: "Ambiente" }, minC: null, maxC: 25, toleranceC: 0, coldChain: false, sortOrder: 0 },
    { id: "tc_chilled", code: "CHILLED", name: { en: "Chilled (0–4 °C)", pt: "Refrigerado (0–4 °C)" }, minC: 0, maxC: 4, toleranceC: 1, coldChain: true, sortOrder: 10 },
    { id: "tc_fresh_fish", code: "FRESH_FISH", name: { en: "Fresh fish (0–2 °C)", pt: "Peixe fresco (0–2 °C)" }, minC: 0, maxC: 2, toleranceC: 1, coldChain: true, sortOrder: 20 },
    { id: "tc_frozen", code: "FROZEN", name: { en: "Frozen (≤ −18 °C)", pt: "Congelado (≤ −18 °C)" }, minC: null, maxC: -18, toleranceC: 3, coldChain: true, sortOrder: 30 },
    { id: "tc_deep_frozen", code: "DEEP_FROZEN", name: { en: "Deep frozen (≤ −25 °C)", pt: "Ultracongelado (≤ −25 °C)" }, minC: null, maxC: -25, toleranceC: 3, coldChain: true, sortOrder: 40 },
  ];
  for (const t of TEMP_CLASSES) await db.tempClass.upsert({ where: { code: t.code }, update: {}, create: t });
  for (const [slug, cls] of [["cheese-dairy", "tc_chilled"], ["kebab-meat", "tc_frozen"]] as const) {
    const cat = await db.category.findUnique({ where: { slug }, select: { id: true, tempClassId: true } });
    if (cat && !cat.tempClassId) await db.category.update({ where: { id: cat.id }, data: { tempClassId: cls } });
  }

  return { countryIds, regionIds, taxCatIds };
}
