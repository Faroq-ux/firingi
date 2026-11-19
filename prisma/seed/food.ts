/** Phase 44: food information — category requirements (fresh databases) and approved demo data for a few products. */
import type { Prisma, PrismaClient } from "@prisma/client";

const REQUIREMENTS: [string, string[]][] = [
  ["groceries", ["ALLERGENS", "INGREDIENTS", "NUTRITION", "STORAGE"]],
  ["beverages", ["ALLERGENS", "INGREDIENTS", "NUTRITION", "STORAGE"]],
  ["kebab-pizza-supplies", ["ALLERGENS", "INGREDIENTS", "NUTRITION", "STORAGE"]],
  ["fresh-produce", ["ORIGIN"]],
  ["water", ["ORIGIN"]],
  ["alcoholic-beverages", ["ALLERGENS"]],
  ["pizza-kebab-packaging", []],
];

/** The categories' requirements (the migration sets them on existing databases; fresh ones get them here). */
export async function seedFoodReference(db: PrismaClient) {
  for (const [slug, fields] of REQUIREMENTS) {
    const c = await db.category.findUnique({ where: { slug }, select: { id: true, foodRequirements: true } });
    if (c && c.foodRequirements === null) await db.category.update({ where: { id: c.id }, data: { foodRequirements: { fields } } });
  }
}

const FREE_ALL = { GLUTEN: "FREE", CRUSTACEANS: "FREE", EGGS: "FREE", FISH: "FREE", PEANUTS: "FREE", SOY: "FREE", MILK: "FREE", NUTS: "FREE", CELERY: "FREE", MUSTARD: "FREE", SESAME: "FREE", SULPHITES: "FREE", LUPIN: "FREE", MOLLUSCS: "FREE" };
type Demo = { allergens: Record<string, string>; detail?: Record<string, string>; ingredients: Record<string, string>; nutrition?: Record<string, number | string>; diets: string[]; origin: string; storage: Record<string, string>; shelf?: number; opened?: number };
const DEMO: Record<string, Demo> = {
  "FIR-MOZZ2": {
    allergens: { ...FREE_ALL, MILK: "CONTAINS" },
    ingredients: { pt: "*Leite* pasteurizado de vaca, sal, fermentos lácticos, coalho.", en: "Pasteurised cow's *milk*, salt, lactic cultures, rennet." },
    nutrition: { basis: "100g", energyKj: 1059, energyKcal: 255, fat: 19, saturates: 13, carbohydrate: 1.5, sugars: 1.5, protein: 19, salt: 0.8 },
    diets: ["VEGETARIAN"], origin: "IT", storage: { pt: "Conservar entre 0 °C e 4 °C.", en: "Keep at 0–4 °C." }, shelf: 30, opened: 5,
  },
  "FIR-FARINHA25": {
    allergens: { ...FREE_ALL, GLUTEN: "CONTAINS", SOY: "MAY_CONTAIN" }, detail: { GLUTEN: "wheat" },
    ingredients: { pt: "Farinha de *trigo* tipo 00.", en: "*Wheat* flour type 00." },
    nutrition: { basis: "100g", energyKj: 1456, energyKcal: 344, fat: 1.2, saturates: 0.2, carbohydrate: 71, sugars: 1.4, fibre: 2.8, protein: 11.5, salt: 0.01 },
    diets: ["VEGAN", "VEGETARIAN"], origin: "IT", storage: { pt: "Conservar em local fresco e seco.", en: "Store in a cool, dry place." }, shelf: 365,
  },
  "FIR-AZEITE75": {
    allergens: { ...FREE_ALL },
    ingredients: { pt: "Azeite virgem extra.", en: "Extra virgin olive oil." },
    nutrition: { basis: "100ml", energyKj: 3389, energyKcal: 824, fat: 91.6, saturates: 13.3, carbohydrate: 0, sugars: 0, protein: 0, salt: 0 },
    diets: ["VEGAN", "VEGETARIAN", "GLUTEN_FREE"], origin: "PT", storage: { pt: "Conservar ao abrigo da luz e do calor.", en: "Keep away from light and heat." }, shelf: 540,
  },
  "FIR-ARROZ1": {
    allergens: { ...FREE_ALL },
    ingredients: { pt: "Arroz agulha.", en: "Long-grain rice." },
    nutrition: { basis: "100g", energyKj: 1491, energyKcal: 351, fat: 0.6, saturates: 0.2, carbohydrate: 78, sugars: 0.2, fibre: 1.4, protein: 7.5, salt: 0 },
    diets: ["VEGAN", "VEGETARIAN", "GLUTEN_FREE"], origin: "PT", storage: { pt: "Conservar em local fresco e seco.", en: "Store in a cool, dry place." }, shelf: 720,
  },
  "FIR-SBOCK33": {
    allergens: { ...FREE_ALL, GLUTEN: "CONTAINS" }, detail: { GLUTEN: "barley" },
    ingredients: { pt: "Água, malte de *cevada*, milho, lúpulo.", en: "Water, *barley* malt, maize, hops." },
    diets: ["VEGAN"], origin: "PT", storage: { pt: "Conservar em local fresco.", en: "Keep cool." },
  },
  "FIR-COLA33": {
    allergens: { ...FREE_ALL },
    ingredients: { pt: "Água gaseificada, açúcar, corante (caramelo E150d), acidificante (ácido fosfórico), aromas naturais, cafeína.", en: "Carbonated water, sugar, colour (caramel E150d), acid (phosphoric acid), natural flavourings, caffeine." },
    nutrition: { basis: "100ml", energyKj: 180, energyKcal: 42, fat: 0, saturates: 0, carbohydrate: 10.6, sugars: 10.6, protein: 0, salt: 0 },
    diets: ["VEGAN", "VEGETARIAN", "GLUTEN_FREE"], origin: "PT", storage: { pt: "Conservar em local fresco e seco.", en: "Store in a cool, dry place." }, shelf: 270,
  },
};

/** Demo: approved food information on six products (the rum cake and the sauces are left without, for the "missing" views). */
export async function seedFoodDemo(db: PrismaClient) {
  const admin = await db.user.findFirst({ where: { email: "superadmin@firingi.test" }, select: { id: true } });
  for (const [sku, d] of Object.entries(DEMO)) {
    const v = await db.productVariant.findUnique({ where: { sku }, select: { productId: true, product: { select: { foodInfoId: true } } } });
    if (!v || v.product.foodInfoId) continue;
    const f = await db.foodInfo.create({
      data: {
        productId: v.productId, version: 1, status: "APPROVED", source: "MANUAL", allergens: d.allergens, allergenDetail: d.detail ?? {}, ingredients: d.ingredients,
        nutrition: (d.nutrition ?? undefined) as Prisma.InputJsonValue | undefined, diets: d.diets, originCountryCode: d.origin, storage: d.storage,
        shelfLifeDays: d.shelf ?? null, afterOpeningDays: d.opened ?? null, reviewedById: admin?.id ?? null, reviewedAt: new Date(), submittedAt: new Date(),
      },
    });
    const of = (l: string) => Object.entries(d.allergens).filter(([, x]) => x === l).map(([k]) => k);
    await db.product.update({ where: { id: v.productId }, data: { foodInfoId: f.id, allergensContain: of("CONTAINS"), allergensMayContain: of("MAY_CONTAIN"), allergensFree: of("FREE"), diets: d.diets } });
  }
}
