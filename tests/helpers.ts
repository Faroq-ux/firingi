import { prisma } from "@/server/db";
import { loadContext } from "@/server/context";

/** Build the request context of a seeded user (as if they were signed in). */
export async function ctxFor(email: string, companyLegalName?: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  const company = companyLegalName ? await prisma.company.findFirstOrThrow({ where: { legalName: companyLegalName } }) : null;
  const ctx = await loadContext(user.id, "test-session", company?.id);
  if (!ctx) throw new Error(`no context for ${email}`);
  return ctx;
}

export async function companyId(legalName: string) {
  return (await prisma.company.findFirstOrThrow({ where: { legalName } })).id;
}

/** Minimal catalogue fixture: one product, one packaging unit, one offer per given vendor. */
export async function makeOffers(vendorNames: string[]) {
  const category = await prisma.category.findUniqueOrThrow({ where: { slug: "soft-drinks" } });
  const taxCat = await prisma.taxCategory.findUniqueOrThrow({ where: { code: "STANDARD" } });
  const pt = await prisma.country.findUniqueOrThrow({ where: { code: "PT" } });
  const suffix = Math.random().toString(36).slice(2, 8);
  const product = await prisma.product.create({
    data: {
      categoryId: category.id, taxCategoryId: taxCat.id, name: { en: `Cola ${suffix}` }, status: "APPROVED",
      variants: { create: { sku: `COLA-${suffix}`, packagings: { create: { uomCode: "CX", name: { en: "Case 24" }, unitsPerPack: 24 } } } },
    },
    include: { variants: { include: { packagings: true } } },
  });
  const packagingUnitId = product.variants[0].packagings[0].id;
  const offers: Record<string, string> = {};
  for (const name of vendorNames) {
    const vendorCompanyId = await companyId(name);
    // sellerType is deliberately WRONG here — the DB trigger must correct it.
    const o = await prisma.vendorOffer.create({
      data: { vendorCompanyId, packagingUnitId, countryId: pt.id, sellerType: "WHOLESALER", status: "ACTIVE" },
    });
    offers[name] = o.id;
  }
  return offers;
}
