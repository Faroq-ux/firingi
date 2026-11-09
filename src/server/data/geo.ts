/** International / multi-country reference data (read). */
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { requirePermission } from "@/server/rbac/guard";

const VIEW = ["admin.international.view", "admin.international.manage", "admin.tax.manage", "admin.settings.view"] as const;

export async function listCountries(ctx: Ctx) {
  requirePermission(ctx, [...VIEW]);
  return prisma.country.findMany({
    include: {
      languages: { include: { language: true }, orderBy: { sortOrder: "asc" } },
      _count: { select: { regions: true, cities: true, companies: true } },
    },
    orderBy: [{ customerMarketEnabled: "desc" }, { code: "asc" }],
  });
}

export async function listRegions(ctx: Ctx) {
  requirePermission(ctx, [...VIEW]);
  return prisma.region.findMany({
    include: { country: { select: { code: true, flag: true } }, _count: { select: { cities: true } } },
    orderBy: [{ country: { code: "asc" } }, { code: "asc" }],
  });
}

export async function listCities(ctx: Ctx) {
  requirePermission(ctx, [...VIEW]);
  return prisma.city.findMany({
    include: { country: { select: { code: true, flag: true } }, region: { select: { name: true } } },
    orderBy: [{ country: { code: "asc" } }, { name: "asc" }],
  });
}

export async function listCurrencies(ctx: Ctx) {
  requirePermission(ctx, [...VIEW]);
  return prisma.currency.findMany({ include: { _count: { select: { countries: true } } }, orderBy: { code: "asc" } });
}

export async function listExchangeRates(ctx: Ctx) {
  requirePermission(ctx, [...VIEW]);
  return prisma.exchangeRate.findMany({ orderBy: [{ date: "desc" }, { quoteCode: "asc" }], take: 200 });
}

export async function listLanguages(ctx: Ctx) {
  requirePermission(ctx, [...VIEW]);
  return prisma.language.findMany({ include: { _count: { select: { countries: true } } }, orderBy: { name: "asc" } });
}

export async function listTaxRates(ctx: Ctx) {
  requirePermission(ctx, [...VIEW, "admin.invoices.view"]);
  return prisma.taxRate.findMany({
    where: { OR: [{ validTo: null }, { validTo: { gte: new Date() } }] },
    include: {
      country: { select: { code: true, flag: true, name: true } },
      region: { select: { name: true } },
      taxCategory: { select: { code: true } },
    },
    orderBy: [{ country: { code: "asc" } }, { regionId: "asc" }, { rate: "desc" }],
  });
}

export async function listLegalEntities(ctx: Ctx) {
  requirePermission(ctx, ["admin.settings.view", "admin.settings.manage"]);
  return prisma.legalEntity.findMany({ include: { country: { select: { code: true, flag: true } } } });
}

/** Region list for scoping regional managers (admin user form). */
export async function listRegionOptions(ctx: Ctx) {
  requirePermission(ctx, ["admin.users.manage"]);
  return prisma.region.findMany({
    where: { isActive: true, country: { OR: [{ customerMarketEnabled: true }, { wholesalerMarketEnabled: true }] } },
    select: { id: true, name: true, country: { select: { code: true } } },
    orderBy: [{ country: { code: "asc" } }, { code: "asc" }],
  });
}

/** Languages the user may choose: their company country's languages + English. */
export async function allowedLocales(countryId: string | null) {
  const langs = countryId
    ? await prisma.countryLanguage.findMany({ where: { countryId }, include: { language: true }, orderBy: { sortOrder: "asc" } })
    : [];
  const list = langs.map((l) => ({ code: l.language.code, native: l.language.native }));
  if (!list.some((l) => l.code === "en")) list.push({ code: "en", native: "English" });
  return list;
}
