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
import { grossOf, resolvePrice } from "@/server/catalogue/pricing";
import { applyPromotions, type PromoCandidate } from "@/server/catalogue/promotions";
import { loadActivePromotions, promotionsForOffer } from "@/server/services/promotions";
import { asBarcode } from "@/lib/barcode";
import { taxLabel } from "@/lib/tax-label";
import { byDistance, nearestKm, type LatLng } from "@/server/catalogue/distance";
import { excludedVendorIds } from "@/server/delivery/coverage";

async function loadCategoryInfo() {
  const cats = await prisma.category.findMany({ select: { id: true, parentId: true, restriction: true, isActive: true } });
  return categoryInfo(cats);
}

/** Resolve the caller's buyer scope, or refuse. */
export const buyerScope = cache(async (ctx: Ctx): Promise<BuyerScope & { info: Awaited<ReturnType<typeof loadCategoryInfo>> }> => {
  if ((ctx.company.type !== "CUSTOMER" && ctx.company.type !== "WHOLESALER") || ctx.company.status !== "APPROVED" || !can(ctx, "buyer.catalogue.view"))
    throw new ForbiddenError();
  const [allowed, info, addressId] = await Promise.all([allowedRestrictions(ctx.company.id), loadCategoryInfo(), buyerAddressId(ctx.company.id)]);
  return {
    buyerCompanyId: ctx.company.id,
    buyerType: ctx.company.type,
    buyerCountryId: ctx.company.countryId,
    allowedRestrictions: allowed,
    browsableCategoryIds: browsableCategoryIds(info, allowed),
    excludedVendorIds: await excludedVendorIds(addressId),
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
  const map = new Map<string, { rate: Decimal; taxType: string }>();
  for (const r of rows) if (!map.has(r.taxCategoryId)) map.set(r.taxCategoryId, { rate: new Decimal(r.rate.toString()), taxType: r.taxType });
  return map;
}

type VatMap = Awaited<ReturnType<typeof vatRates>>;
type PromoFn = (o: OfferRow) => PromoCandidate[];

/** Active promotions for this buyer (its customer groups, its country), as a per-offer matcher. */
async function promoMatcher(ctx: Ctx, scope: Awaited<ReturnType<typeof buyerScope>>): Promise<PromoFn> {
  const [promos, groups] = await Promise.all([
    loadActivePromotions(scope.buyerCountryId),
    prisma.customerGroupMember.findMany({ where: { companyId: ctx.company.id }, select: { groupId: true } }),
  ]);
  const groupIds = groups.map((g) => g.groupId);
  return (o) => {
    const product = o.packaging.variant.product;
    const categoryIds = [...(scope.info.get(product.categoryId)?.ancestors ?? []), product.categoryId];
    return promotionsForOffer(promos, { id: o.id, vendorCompanyId: o.vendorCompanyId, productId: product.id, categoryIds }, groupIds);
  };
}

function present(o: OfferRow, vat: VatMap, countryCode: string, qty = 1, promoFn?: PromoFn) {
  const price = resolvePrice(
    o.prices.map((p) => ({ priceListId: p.priceListId, scope: p.priceList.scope, priority: p.priceList.priority, minQty: p.minQty, unitPriceNet: p.unitPriceNet })),
    Math.max(qty, o.minOrderQty),
  );
  const product = o.packaging.variant.product;
  const available = o.stockLevels.reduce((a, s) => a + s.onHand - s.reserved, 0);
  const tax = vat.get(product.taxCategoryId) ?? { rate: new Decimal(0), taxType: "VAT" };
  // Promotions apply on top of the resolved (list) price.
  const promo = price ? applyPromotions(price.unitPriceNet, Math.max(qty, o.minOrderQty), promoFn ? promoFn(o) : []) : null;
  const sale = promo ? promo.salePriceNet : null;
  return {
    offerId: o.id,
    productId: product.id,
    name: product.name as Record<string, string>,
    description: (product.description ?? null) as Record<string, string> | null,
    brand: product.brand?.name ?? null,
    category: { id: product.category.id, name: product.category.name as Record<string, string> },
    restriction: product.restriction,
    sku: o.packaging.variant.sku,
    vendorSku: o.vendorSku,
    /** Barcode of the packaging sold (case / pack) and of the single unit inside. */
    gtin: o.packaging.gtin ?? (o.packaging.unitsPerPack === 1 ? o.packaging.variant.gtin : null),
    unitGtin: o.packaging.variant.gtin,
    attributes: (o.packaging.variant.attributes ?? null) as Record<string, string> | null,
    packaging: { name: o.packaging.name as Record<string, string>, unitsPerPack: o.packaging.unitsPerPack, uom: o.packaging.uomCode },
    vendor: { id: o.vendor.id, name: o.vendor.tradeName ?? o.vendor.legalName, country: o.vendor.country },
    minOrderQty: o.minOrderQty,
    qtyStep: o.qtyStep,
    leadTimeDays: o.leadTimeDays,
    price: price && sale && promo && {
      /** Price before promotions (the vendor's list / contract price). */
      listUnitNet: price.unitPriceNet.toFixed(2),
      listUnitGross: grossOf(price.unitPriceNet, tax.rate).toFixed(2),
      /** What the buyer pays per unit (after promotions). */
      unitPriceNet: sale.toFixed(2),
      unitPriceGross: grossOf(sale, tax.rate).toFixed(2),
      vatAmount: grossOf(sale, tax.rate).minus(sale.toDecimalPlaces(2)).toFixed(2),
      perUnitNet: sale.div(o.packaging.unitsPerPack).toFixed(4),
      perUnitGross: grossOf(sale.div(o.packaging.unitsPerPack), tax.rate).toFixed(2),
      promotions: promo.applied.map((a) => ({ id: a.promotionId, name: a.name ?? "", ownerType: a.ownerType, perUnit: a.perUnit.toFixed(4), firingiPerUnit: a.firingiPerUnit.toFixed(4), vendorPerUnit: a.vendorPerUnit.toFixed(4) })),
      vendorFundedPerUnit: promo.vendorFundedPerUnit.toFixed(4),
      firingiFundedPerUnit: promo.firingiFundedPerUnit.toFixed(4),
      scope: price.scope,
      tiers: price.tiers.map((t) => ({ minQty: t.minQty, unitPriceNet: t.unitPriceNet.toFixed(2), unitPriceGross: grossOf(t.unitPriceNet, tax.rate).toFixed(2) })),
    },
    vatRate: tax.rate.toString(),
    /** Local tax name in the buyer's country (IVA in PT/ES, IGIC in the Canaries, …). */
    taxLabel: taxLabel(countryCode, tax.taxType),
    available,
    stockStatus: available <= 0 ? ("OUT" as const) : available < o.minOrderQty * 5 ? ("LOW" as const) : ("IN" as const),
  };
}

export type CatalogueItem = ReturnType<typeof present>;

/**
 * Search filter: a barcode (8–14 digits, typed or scanned) matches the packaging or
 * unit barcode exactly; anything else searches names, brand, SKU and barcodes.
 */
export function productQueryWhere(q: string): Prisma.VendorOfferWhereInput {
  const code = asBarcode(q);
  if (code) return { OR: [{ packaging: { gtin: code } }, { packaging: { variant: { gtin: code } } }, { packaging: { variant: { sku: code } } }] };
  const text = q.trim();
  return {
    OR: [
      { packaging: { variant: { product: { searchText: { contains: text.toLowerCase() } } } } },
      { packaging: { variant: { sku: { equals: text.toUpperCase() } } } },
      { vendorSku: { equals: text, mode: "insensitive" } },
    ],
  };
}

/**
 * Find goods across every supplier the buyer may use — by barcode or name — with the
 * supplier's distance, nearest supplier first.
 */
export async function searchAcrossSuppliers(ctx: Ctx, q: string) {
  const scope = await buyerScope(ctx);
  if (!q.trim()) return { items: [], barcode: null as string | null };
  const rows = await prisma.vendorOffer.findMany({
    where: { AND: [visibleOfferWhere(scope), productQueryWhere(q)] },
    include: offerInclude(scope),
    take: 100,
  });
  const [vat, promoFn] = await Promise.all([vatRates(scope.buyerCountryId, [...new Set(rows.map((r) => r.packaging.variant.product.taxCategoryId))]), promoMatcher(ctx, scope)]);
  const suppliers = new Map((await visibleSuppliers(ctx)).map((s) => [s.id, s]));
  const items = rows
    .map((r) => ({ ...present(r, vat, ctx.company.countryCode, 1, promoFn), distanceKm: suppliers.get(r.vendorCompanyId)?.distanceKm ?? null }))
    .sort((a, b) => byDistance({ name: a.vendor.name, distanceKm: a.distanceKm }, { name: b.vendor.name, distanceKm: b.distanceKm }));
  return { items, barcode: asBarcode(q) };
}

export async function browseCatalogue(ctx: Ctx, f: { q?: string; categoryId?: string; vendorId?: string; page?: number } = {}) {
  const scope = await buyerScope(ctx);
  const pageSize = 24;
  const page = Math.max(1, f.page ?? 1);
  const categoryIds = f.categoryId ? withDescendants(f.categoryId, scope.info).filter((id) => scope.browsableCategoryIds.includes(id)) : undefined;
  const where: Prisma.VendorOfferWhereInput = {
    AND: [
      visibleOfferWhere(scope),
      f.q ? productQueryWhere(f.q) : {},
      categoryIds ? { packaging: { variant: { product: { categoryId: { in: categoryIds } } } } } : {},
      f.vendorId ? { vendorCompanyId: f.vendorId } : {},
    ],
  };
  const [rows, total] = await Promise.all([
    prisma.vendorOffer.findMany({ where, include: offerInclude(scope), orderBy: [{ packaging: { variant: { product: { searchText: "asc" } } } }, { id: "asc" }], skip: (page - 1) * pageSize, take: pageSize }),
    prisma.vendorOffer.count({ where }),
  ]);
  const [vat, promoFn] = await Promise.all([vatRates(scope.buyerCountryId, [...new Set(rows.map((r) => r.packaging.variant.product.taxCategoryId))]), promoMatcher(ctx, scope)]);
  return { items: rows.map((r) => present(r, vat, ctx.company.countryCode, 1, promoFn)), total, page, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

/** A single offer — 404 (not 403) when it isn't visible, so its existence isn't revealed. */
export async function catalogueItem(ctx: Ctx, offerId: string) {
  const scope = await buyerScope(ctx);
  const row = await prisma.vendorOffer.findFirst({ where: { AND: [{ id: offerId }, visibleOfferWhere(scope)] }, include: offerInclude(scope) });
  if (!row) throw new NotFoundError("Product");
  const [vat, promoFn] = await Promise.all([vatRates(scope.buyerCountryId, [row.packaging.variant.product.taxCategoryId]), promoMatcher(ctx, scope)]);
  // Other visible packagings / suppliers of the same product, for comparison.
  const alternatives = await prisma.vendorOffer.findMany({
    where: { AND: [visibleOfferWhere(scope), { id: { not: offerId } }, { packaging: { variant: { productId: row.packaging.variant.productId } } }] },
    include: offerInclude(scope),
    take: 20,
  });
  return { item: present(row, vat, ctx.company.countryCode, 1, promoFn), alternatives: alternatives.map((a) => present(a, vat, ctx.company.countryCode, 1, promoFn)) };
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

/** Where the buyer receives goods: default delivery address, else head office. */
const buyerAddress = cache(async (companyId: string) =>
  prisma.address.findFirst({
    where: { companyId, isActive: true, kind: { in: ["DELIVERY", "HEAD_OFFICE"] } },
    orderBy: [{ kind: "asc" }, { isDefault: "desc" }], // DELIVERY sorts before HEAD_OFFICE
    select: { id: true, latitude: true, longitude: true },
  }),
);
const buyerAddressId = async (companyId: string) => (await buyerAddress(companyId))?.id ?? null;

export async function buyerLocation(ctx: Ctx): Promise<LatLng | null> {
  const a = await buyerAddress(ctx.company.id);
  return a?.latitude != null && a.longitude != null ? { lat: Number(a.latitude), lng: Number(a.longitude) } : null;
}

/**
 * Suppliers (wholesalers for customers, distributors for wholesalers) with at least one
 * visible offer — optionally only those carrying a category — nearest first. Distance is
 * from the buyer's delivery address to the supplier's closest warehouse / pickup point.
 */
export async function visibleSuppliers(ctx: Ctx, opts: { categoryId?: string; q?: string } = {}) {
  const scope = await buyerScope(ctx);
  const categoryIds = opts.categoryId ? withDescendants(opts.categoryId, scope.info).filter((id) => scope.browsableCategoryIds.includes(id)) : undefined;
  const where: Prisma.VendorOfferWhereInput = {
    AND: [
      visibleOfferWhere(scope),
      categoryIds ? { packaging: { variant: { product: { categoryId: { in: categoryIds } } } } } : {},
      opts.q?.trim() ? productQueryWhere(opts.q) : {},
    ],
  };
  const [grouped, from] = await Promise.all([
    prisma.vendorOffer.groupBy({ by: ["vendorCompanyId"], where, _count: { _all: true } }),
    buyerLocation(ctx),
  ]);
  const vendors = await prisma.company.findMany({
    where: { id: { in: grouped.map((g) => g.vendorCompanyId) } },
    select: {
      id: true, legalName: true, tradeName: true, country: { select: { code: true, flag: true } },
      addresses: { where: { isActive: true, kind: { in: ["WAREHOUSE", "PICKUP", "HEAD_OFFICE"] } }, select: { kind: true, cityName: true, latitude: true, longitude: true } },
    },
  });
  const counts = new Map(grouped.map((g) => [g.vendorCompanyId, g._count._all]));
  return vendors
    .map((v) => {
      const depots = v.addresses.filter((a) => a.kind !== "HEAD_OFFICE" && a.latitude !== null);
      const points = (depots.length ? depots : v.addresses.filter((a) => a.latitude !== null)).map((a) => ({ lat: Number(a.latitude), lng: Number(a.longitude) }));
      const km = nearestKm(from, points);
      return {
        id: v.id,
        name: v.tradeName ?? v.legalName,
        legalName: v.legalName,
        country: v.country,
        city: (v.addresses.find((a) => a.kind === "HEAD_OFFICE") ?? v.addresses[0])?.cityName ?? null,
        offers: counts.get(v.id) ?? 0,
        distanceKm: km === null ? null : Math.round(km * 10) / 10,
      };
    })
    .sort(byDistance);
}

export type Supplier = Awaited<ReturnType<typeof visibleSuppliers>>[number];

/** Top-level categories (with the number of visible products in their branch). */
export async function shopCategories(ctx: Ctx) {
  const scope = await buyerScope(ctx);
  const [cats, offers] = await Promise.all([
    prisma.category.findMany({ where: { id: { in: scope.browsableCategoryIds }, parentId: null }, select: { id: true, name: true, restriction: true }, orderBy: { sortOrder: "asc" } }),
    prisma.vendorOffer.findMany({ where: visibleOfferWhere(scope), select: { packaging: { select: { variant: { select: { product: { select: { categoryId: true } } } } } } } }),
  ]);
  const count = new Map<string, number>();
  for (const o of offers) {
    const catId = o.packaging.variant.product.categoryId;
    const root = scope.info.get(catId)?.ancestors[0] ?? catId;
    count.set(root, (count.get(root) ?? 0) + 1);
  }
  return cats.map((c) => ({ ...c, products: count.get(c.id) ?? 0 }));
}

/** A category with its sub-categories and breadcrumb, if the buyer may browse it. */
export async function shopCategory(ctx: Ctx, categoryId: string) {
  const scope = await buyerScope(ctx);
  if (!scope.browsableCategoryIds.includes(categoryId)) throw new NotFoundError("Category");
  const info = scope.info.get(categoryId)!;
  const [category, children, crumbs] = await Promise.all([
    prisma.category.findUniqueOrThrow({ where: { id: categoryId }, select: { id: true, name: true, restriction: true } }),
    prisma.category.findMany({ where: { parentId: categoryId, id: { in: scope.browsableCategoryIds } }, select: { id: true, name: true }, orderBy: { sortOrder: "asc" } }),
    prisma.category.findMany({ where: { id: { in: info.ancestors } }, select: { id: true, name: true } }),
  ]);
  return { category, children, breadcrumb: info.ancestors.map((id) => crumbs.find((c) => c.id === id)!).filter(Boolean) };
}

/**
 * A supplier's store: the supplier and the categories of its visible products.
 * 404 when the buyer may not buy from it (e.g. a customer opening a distributor).
 */
export async function supplierStore(ctx: Ctx, vendorId: string) {
  const scope = await buyerScope(ctx);
  const supplier = (await visibleSuppliers(ctx)).find((s) => s.id === vendorId);
  if (!supplier) throw new NotFoundError("Supplier");
  const offers = await prisma.vendorOffer.findMany({
    where: { AND: [visibleOfferWhere(scope), { vendorCompanyId: vendorId }] },
    select: { packaging: { select: { variant: { select: { product: { select: { categoryId: true } } } } } } },
  });
  // Count products per category, rolled up to every ancestor so parent filters work.
  const count = new Map<string, number>();
  for (const o of offers) {
    const id = o.packaging.variant.product.categoryId;
    for (const c of [...(scope.info.get(id)?.ancestors ?? []), id]) count.set(c, (count.get(c) ?? 0) + 1);
  }
  const cats = await prisma.category.findMany({
    where: { id: { in: [...count.keys()] } },
    select: { id: true, name: true, parentId: true, depth: true, sortOrder: true },
  });
  // Depth-first order for an indented filter list.
  const byParent = new Map<string | null, typeof cats>();
  for (const c of cats) byParent.set(c.parentId, [...(byParent.get(c.parentId) ?? []), c]);
  const ordered: (typeof cats[number] & { products: number })[] = [];
  const walk = (p: string | null) => { for (const c of (byParent.get(p) ?? []).sort((a, b) => a.sortOrder - b.sortOrder)) { ordered.push({ ...c, products: count.get(c.id)! }); walk(c.id); } };
  walk(null);
  return { supplier, categories: ordered };
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

/**
 * Price a set of offers for the buyer at given quantities (cart / checkout). Offers
 * that are no longer visible to the buyer are returned in `unavailable`.
 */
export async function pricedOffers(ctx: Ctx, lines: { offerId: string; qty: number }[]) {
  const scope = await buyerScope(ctx);
  const rows = await prisma.vendorOffer.findMany({
    where: { AND: [visibleOfferWhere(scope), { id: { in: lines.map((l) => l.offerId) } }] },
    include: offerInclude(scope),
  });
  const [vat, promoFn] = await Promise.all([vatRates(scope.buyerCountryId, [...new Set(rows.map((r) => r.packaging.variant.product.taxCategoryId))]), promoMatcher(ctx, scope)]);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const items = lines.filter((l) => byId.has(l.offerId)).map((l) => {
    const r = byId.get(l.offerId)!;
    return { ...present(r, vat, ctx.company.countryCode, l.qty, promoFn), qty: l.qty, taxCategoryId: r.packaging.variant.product.taxCategoryId, vendorCompanyId: r.vendorCompanyId, productId: r.packaging.variant.productId };
  });
  return { items, unavailable: lines.filter((l) => !byId.has(l.offerId)).map((l) => l.offerId) };
}
