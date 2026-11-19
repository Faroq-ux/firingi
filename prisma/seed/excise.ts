/** Phase 43: licensed & excise goods — category defaults, the supplier licence type's categories, demo product details. */
import type { PrismaClient } from "@prisma/client";

const CATEGORY_DEFAULTS: [string, string][] = [
  ["beer", "ec_beer"], ["wine", "ec_wine"], ["spirits", "ec_spirits"], ["cigarettes", "ec_cigarettes"], ["rolling-tobacco", "ec_rolling_tobacco"], ["soft-drinks", "ec_sugar_drink"],
];

/** Reference data the migration can't link on a fresh database (categories are created by the seed). */
export async function seedExciseReference(db: PrismaClient) {
  for (const [slug, ec] of CATEGORY_DEFAULTS) {
    const cat = await db.category.findUnique({ where: { slug }, select: { id: true, exciseCategoryId: true } });
    if (cat && !cat.exciseCategoryId && (await db.exciseCategory.count({ where: { id: ec } }))) await db.category.update({ where: { id: cat.id }, data: { exciseCategoryId: ec } });
  }
  const t = await db.certificateType.findUnique({ where: { key: "excise-authorisation" } });
  if (t && !t.categoryIds.length) {
    const ids = (await db.category.findMany({ where: { slug: { in: ["beer", "wine", "spirits", "cigarettes", "rolling-tobacco"] } }, select: { id: true } })).map((c) => c.id);
    await db.certificateType.update({ where: { id: t.id }, data: { categoryIds: ids } });
  }
}

/** Demo: excise details on the seeded beer, wine, cigarettes and cola (licences are not seeded: customers apply). */
export async function seedExciseDemo(db: PrismaClient) {
  const details: Record<string, (units: number) => Record<string, unknown>> = {
    "FIR-SBOCK33": (n) => ({ abv: 5.2, volumeL: +(0.33 * n).toFixed(3) }),
    "FIR-DOURO75": (n) => ({ abv: 13, volumeL: +(0.75 * n).toFixed(3) }),
    "FIR-CIG20": (n) => ({ exciseUnits: 20 * n }),
    "FIR-COLA33": (n) => ({ volumeL: +(0.33 * n).toFixed(3), sugarGPerL: 106 }),
  };
  for (const [sku, f] of Object.entries(details)) {
    const offers = await db.vendorOffer.findMany({ where: { packaging: { variant: { sku } } }, select: { id: true, abv: true, volumeL: true, exciseUnits: true, packaging: { select: { unitsPerPack: true } } } });
    for (const o of offers) if (o.abv == null && o.volumeL == null && o.exciseUnits == null) await db.vendorOffer.update({ where: { id: o.id }, data: f(o.packaging.unitsPerPack) });
  }
}
