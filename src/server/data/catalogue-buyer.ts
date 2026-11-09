/**
 * Buyer-facing catalogue. EVERY query here is built on `visibleOfferWhere`, so a
 * customer can never receive a distributor's offer, a hidden restricted product or
 * another country's wholesaler — whichever page or API calls it.
 */
import type { Prisma } from "@prisma/client";
import Decimal from "decimal.js";
import { cache } from "react";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { allowedRestrictions } from "@/server/services/restrictions";
import { browsableCategoryIds, categoryInfo, withDescendants } from "@/server/catalogue/restrictions";
import { applicablePriceListWhere, visibleOfferWhere, type BuyerScope } from "@/server/catalogue/visibility";
import { resolvePrice } from "@/server/catalogue/pricing";

async function loadCategoryInfo() {
  const cats = await prisma.category.findMany({ select: { id: true, parentId: true, restriction: true, isActive: true } });
  return categoryInfo(cats);
}

/** Resolve the caller's buyer scope, or refuse. */
export const buyerScope = cache(async (ctx: Ctx): Promise<BuyerScope & { info: Awaited<ReturnType<typeof loadCategoryInfo>> }> => {
  if ((ctx.company.type !== "CUSTOMER" && ctx.company.type !== "WHOLESALER") || ctx.company.status !== "APPROVED" || !can(ctx, "buyer.catalogue.view"))
    throw new ForbiddenError();
  const [allowed, info] = await Promise.all([allowedRestrictions(ctx.company.id), loadCategoryInfo()]);
  return {
    buyerCompanyId: ctx.company.id,
    buyerType: ctx.company.type,
    buyerCountryId: ctx.company.countryId,
    allowedRestrictions: allowed,
    browsableCategoryIds: browsableCategoryIds(info, allowed),
    info,
  };
});

const offerInclude = (scope: BuyerScope) =>
  ({
    vendor: { select: { id: true, legalName: true, tradeName: true, country: { select: { code: true, flag: true } } } },
    packaging: { include: { uom: true, variant: { include: { product: { include: { brand: { select: { name: true } }, category: { select: { id: true, name: true } } } } } } } },
    prices: { where: { priceList: applicablePriceListWhere(scope) }, include: { priceList: { select: { id: true, scope: true, priority: true } } } },
    stockLevels: { select: { onHand: true, reserved: true } },
  }) satisfies Prisma.VendorOfferInclude;

type OfferRow = Prisma.VendorOfferGetPayload<{ include: ReturnType<typeof offerInclude> }>;

async function vatRates(countryId: string, taxCategoryIds: string[]) {
  const now = new Date();
  const rows = await prisma.taxRate.findMany({
    where: { countryId, regionId: null, taxCategoryId: { in: taxCategoryIds }, validFrom: { lte: now }, OR: [{ validTo: null }, { validTo: { gt: now } }] },
    orderBy: { validFrom: "desc" },
  });
  const map = new Map<string, Decimal>();
  for (const r of rows) if (!map.has(r.taxCategoryId)) map.set(r.taxCategoryId, new Decimal(r.rate.toString()));
  return map;
}

function present(o: OfferRow, vat: Map<string, Decimal>, qty = 1) {
  const price = resolvePrice(
    o.prices.map((p) => ({ priceListId: p.priceListId, scope: p.priceList.scope, priority: p.priceList.priority, minQty: p.minQty, unitPriceNet: p.unitPriceNet })),
    Math.max(qty, o.minOrderQty),
  );
  const product = o.packaging.variant.product;
  const available = o.stockLevels.reduce((a, s) => a + s.onHand - s.reserved, 0);
  return {
    offerId: o.id,
    productId: product.id,
    name: product.name as Record<string, string>,
    description: (product.description ?? null) as Record<string, string> | null,
    brand: product.brand?.name ?? null,
    category: { id: product.category.id, name: product.category.name as Record<string, string> },
    restriction: product.restriction,
    sku: o.packaging.variant.sku,
    gtin: o.packaging.gtin ?? o.packaging.variant.gtin,
    attributes: (o.packaging.variant.attributes ?? null) as Record<string, string> | null,
    packaging: { name: o.packaging.name as Record<string, string>, unitsPerPack: o.packaging.unitsPerPack, uom: o.packaging.uomCode },
    vendor: { id: o.vendor.id, name: o.vendor.tradeName ?? o.vendor.legalName, country: o.vendor.country },
    minOrderQty: o.minOrderQty,
    qtyStep: o.qtyStep,
    leadTimeDays: o.leadTimeDays,
    price: price && {
      unitPriceNet: price.unitPriceNet.toFixed(2),
      perUnitNet: price.unitPriceNet.div(o.packaging.unitsPerPack).toFixed(4),
      scope: price.scope,
      tiers: price.tiers.map((t) => ({ minQty: t.minQty, unitPriceNet: t.unitPriceNet.toFixed(2) })),
    },
    vatRate: (vat.get(product.taxCategoryId) ?? new Decimal(0)).toString(),
    available,
    stockStatus: available <= 0 ? ("OUT" as const) : available < o.minOrderQty * 5 ? ("LOW" as const) : ("IN" as const),
  };
}

export type CatalogueItem = ReturnType<typeof present>;

export async function browseCatalogue(ctx: Ctx, f: { q?: string; categoryId?: string; vendorId?: string; page?: number } = {}) {
  const scope = await buyerScope(ctx);
  const pageSize = 24;
  const page = Math.max(1, f.page ?? 1);
  const categoryIds = f.categoryId ? withDescendants(f.categoryId, scope.info).filter((id) => scope.browsableCategoryIds.includes(id)) : undefined;
  const where: Prisma.VendorOfferWhereInput = {
    AND: [
      visibleOfferWhere(scope),
      f.q ? { packaging: { variant: { product: { searchText: { contains: f.q.trim().toLowerCase() } } } } } : {},
      categoryIds ? { packaging: { variant: { product: { categoryId: { in: categoryIds } } } } } : {},
      f.vendorId ? { vendorCompanyId: f.vendorId } : {},
    ],
  };
  const [rows, total] = await Promise.all([
    prisma.vendorOffer.findMany({ where, include: offerInclude(scope), orderBy: [{ packaging: { variant: { product: { searchText: "asc" } } } }, { id: "asc" }], skip: (page - 1) * pageSize, take: pageSize }),
    prisma.vendorOffer.count({ where }),
  ]);
  const vat = await vatRates(scope.buyerCountryId, [...new Set(rows.map((r) => r.packaging.variant.product.taxCategoryId))]);
  return { items: rows.map((r) => present(r, vat)), total, page, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

/** A single offer — 404 (not 403) when it isn't visible, so its existence isn't revealed. */
export async function catalogueItem(ctx: Ctx, offerId: string) {
  const scope = await buyerScope(ctx);
  const row = await prisma.vendorOffer.findFirst({ where: { AND: [{ id: offerId }, visibleOfferWhere(scope)] }, include: offerInclude(scope) });
  if (!row) throw new NotFoundError("Product");
  const vat = await vatRates(scope.buyerCountryId, [row.packaging.variant.product.taxCategoryId]);
  // Other visible packagings / suppliers of the same product, for comparison.
  const alternatives = await prisma.vendorOffer.findMany({
    where: { AND: [visibleOfferWhere(scope), { id: { not: offerId } }, { packaging: { variant: { productId: row.packaging.variant.productId } } }] },
    include: offerInclude(scope),
    take: 20,
  });
  return { item: present(row, vat), alternatives: alternatives.map((a) => present(a, vat)) };
}

/** Category tree the buyer may browse (restricted branches only with approval). */
export async function browsableCategories(ctx: Ctx) {
  const scope = await buyerScope(ctx);
  return prisma.category.findMany({
    where: { id: { in: scope.browsableCategoryIds } },
    select: { id: true, parentId: true, name: true, depth: true, sortOrder: true, restriction: true },
    orderBy: [{ depth: "asc" }, { sortOrder: "asc" }],
  });
}

/** Vendors the buyer can buy from (with at least one visible offer). */
export async function visibleSuppliers(ctx: Ctx) {
  const scope = await buyerScope(ctx);
  const grouped = await prisma.vendorOffer.groupBy({ by: ["vendorCompanyId"], where: visibleOfferWhere(scope), _count: { _all: true } });
  const vendors = await prisma.company.findMany({
    where: { id: { in: grouped.map((g) => g.vendorCompanyId) } },
    select: { id: true, legalName: true, tradeName: true, country: { select: { code: true, flag: true } }, addresses: { where: { kind: "HEAD_OFFICE", isActive: true }, select: { cityName: true }, take: 1 } },
    orderBy: { legalName: "asc" },
  });
  const counts = new Map(grouped.map((g) => [g.vendorCompanyId, g._count._all]));
  return vendors.map((v) => ({ ...v, offers: counts.get(v.id) ?? 0 }));
}

/**
 * A product image, only for people allowed to see the product: FIRINGI catalogue
 * staff, vendors (approved products or their own proposal), and buyers who can see
 * at least one offer of it. Returns null when not allowed / not found.
 */
export async function productImageForViewer(ctx: Ctx, productId: string, index: number) {
  const p = await prisma.product.findUnique({ where: { id: productId }, select: { images: true, status: true, proposedByCompanyId: true } });
  const key = p?.images[index];
  if (!p || !key) return null;
  let allowed = false;
  if (ctx.company.type === "ADMIN") allowed = can(ctx, ["admin.catalogue.view", "admin.catalogue.manage", "admin.catalogue.approve"]);
  else if ((ctx.company.type === "DISTRIBUTOR" || ctx.company.type === "WHOLESALER") && can(ctx, ["vendor.products.view", "vendor.products.manage"]))
    allowed = p.status === "APPROVED" || p.proposedByCompanyId === ctx.company.id;
  if (!allowed && (ctx.company.type === "CUSTOMER" || ctx.company.type === "WHOLESALER") && ctx.company.status === "APPROVED" && can(ctx, "buyer.catalogue.view")) {
    const scope = await buyerScope(ctx);
    allowed = (await prisma.vendorOffer.count({ where: { AND: [visibleOfferWhere(scope), { packaging: { variant: { productId } } }] } })) > 0;
  }
  return allowed ? key : null;
}
