/**
 * Buyer-facing catalogue. EVERY query here is built on `visibleOfferWhere`, so a
 * customer can never receive a distributor's offer, a hidden restricted product or
 * another country's wholesaler — whichever page or API calls it.
 */
import { orderingMode } from "@/server/allocation/mode";
import { allocationRules } from "@/server/allocation/rules";
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
import { candidatesInEur, grossOf, resolvePrice } from "@/server/catalogue/pricing";
import { currencySettings, ratesOn, viewerFx } from "@/server/currency/service";
import { isLocal, roundMoney, type Fx } from "@/lib/currency";
import { applyPromotions, type PromoCandidate } from "@/server/catalogue/promotions";
import { loadActivePromotions, promotionsForOffer } from "@/server/services/promotions";
import { buyerPromoContext } from "@/server/marketing/offers";
import { asBarcode } from "@/lib/barcode";
import { taxLabel } from "@/lib/tax-label";
import { byDistance, nearestKm, type LatLng } from "@/server/catalogue/distance";
import { excludedVendorIds } from "@/server/delivery/coverage";
import { badgesFor, vendorsWithBadge, type Badge } from "@/server/compliance/service";
import { buyerFoodWhere } from "@/server/food/service";

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
    prices: { where: { priceList: applicablePriceListWhere(scope) }, include: { priceList: { select: { id: true, scope: true, priority: true, currencyCode: true } } } },
    stockLevels: { select: { onHand: true, reserved: true } },
  }) satisfies Prisma.VendorOfferInclude;

type OfferRow = Prisma.VendorOfferGetPayload<{ include: ReturnType<typeof offerInclude> }>;

/** Phase 45: the buyer's currency and how price lists in other currencies are used. */
const priceFx = cache(async (ctx: Ctx) => {
  const [fx, s, rates] = await Promise.all([viewerFx(ctx, "BUYER"), currencySettings(), ratesOn()]);
  const mids = Object.fromEntries([...rates.values()].map((r) => [r.code, r.rate]));
  return { fx, rules: { buyerCode: fx.code, mids, localLists: s.enabled && s.localPriceLists, supplierCurrency: s.enabled && s.supplierCurrency } };
});

async function vatRates(countryId: string, taxCategoryIds: string[], ctx: Ctx) {
  const now = new Date();
  const rows = await prisma.taxRate.findMany({
    where: { countryId, regionId: null, taxCategoryId: { in: taxCategoryIds }, validFrom: { lte: now }, OR: [{ validTo: null }, { validTo: { gt: now } }] },
    orderBy: { validFrom: "desc" },
  });
  const map = new Map<string, { rate: Decimal; taxType: string }>();
  for (const r of rows) if (!map.has(r.taxCategoryId)) map.set(r.taxCategoryId, { rate: new Decimal(r.rate.toString()), taxType: r.taxType });
  return Object.assign(map, { pfx: await priceFx(ctx) });
}

type VatMap = Awaited<ReturnType<typeof vatRates>>;
type PromoFn = (o: OfferRow) => PromoCandidate[];

/** Active promotions for this buyer (its customer groups, its country), as a per-offer matcher. */
async function promoMatcher(ctx: Ctx, scope: Awaited<ReturnType<typeof buyerScope>>, couponId?: string | null): Promise<PromoFn> {
  const promos = await loadActivePromotions(scope.buyerCountryId);
  const buyer = await buyerPromoContext(ctx.company.id, promos, couponId);
  return (o) => {
    const product = o.packaging.variant.product;
    return promotionsForOffer(promos, { id: o.id, vendorCompanyId: o.vendorCompanyId, productId: product.id, categoryIds: categoryIdsOf(scope, product.categoryId) }, buyer);
  };
}

const categoryIdsOf = (scope: Awaited<ReturnType<typeof buyerScope>>, categoryId: string) => [...(scope.info.get(categoryId)?.ancestors ?? []), categoryId];

function present(o: OfferRow, vat: VatMap, countryCode: string, qty = 1, promoFn?: PromoFn) {
  // Phase 45: lists in other currencies → EUR; a list in the buyer's own currency is kept exactly
  const conv = candidatesInEur(o.prices.map((p) => ({ priceListId: p.priceListId, scope: p.priceList.scope, priority: p.priceList.priority, minQty: p.minQty, unitPriceNet: p.unitPriceNet, currencyCode: p.priceList.currencyCode })), vat.pfx.rules);
  const price = resolvePrice(conv.candidates, Math.max(qty, o.minOrderQty));
  const fixedList = price ? conv.fixed.get(price.priceListId) : undefined;
  const fixedLocal = fixedList && price ? { code: fixedList.code, unitNet: fixedList.byMinQty.get(price.minQty) ?? price.unitPriceNet.mul(vat.pfx.rules.mids[fixedList.code]).toFixed(4) } : null;
  const product = o.packaging.variant.product;
  const available = o.stockLevels.reduce((a, s) => a + s.onHand - s.reserved, 0);
  const tax = vat.get(product.taxCategoryId) ?? { rate: new Decimal(0), taxType: "VAT" };
  // Promotions apply on top of the resolved (list) price.
  const promo = price ? applyPromotions(price.unitPriceNet, Math.max(qty, o.minOrderQty), promoFn ? promoFn(o) : []) : null;
  const sale = promo ? promo.salePriceNet : null;
  return {
    offerId: o.id,
    packagingUnitId: o.packagingUnitId,
    productId: product.id,
    name: product.name as Record<string, string>,
    description: (product.description ?? null) as Record<string, string> | null,
    brand: product.brand?.name ?? null,
    category: { id: product.category.id, name: product.category.name as Record<string, string> },
    restriction: product.restriction,
    /** Phase 44: allergens / diets from the approved food information (badges; empty when none) */
    food: { approved: !!product.foodInfoId, contain: product.allergensContain, mayContain: product.allergensMayContain, diets: product.diets },
    sku: o.packaging.variant.sku,
    vendorSku: o.vendorSku,
    /** Barcode of the packaging sold (case / pack) and of the single unit inside. */
    gtin: o.packaging.gtin ?? (o.packaging.unitsPerPack === 1 ? o.packaging.variant.gtin : null),
    unitGtin: o.packaging.variant.gtin,
    attributes: (o.packaging.variant.attributes ?? null) as Record<string, string> | null,
    packaging: { name: o.packaging.name as Record<string, string>, unitsPerPack: o.packaging.unitsPerPack, uom: o.packaging.uomCode },
    vendor: { id: o.vendor.id, name: o.vendor.tradeName ?? o.vendor.legalName, country: o.vendor.country, badges: [] as Badge[] },
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
      promotions: promo.applied.map((a) => ({ id: a.promotionId, name: a.name ?? "", ownerType: a.ownerType, coupon: !!a.coupon, perUnit: a.perUnit.toFixed(4), firingiPerUnit: a.firingiPerUnit.toFixed(4), vendorPerUnit: a.vendorPerUnit.toFixed(4) })),
      vendorFundedPerUnit: promo.vendorFundedPerUnit.toFixed(4),
      firingiFundedPerUnit: promo.firingiFundedPerUnit.toFixed(4),
      scope: price.scope,
      tiers: price.tiers.map((t) => ({ minQty: t.minQty, unitPriceNet: t.unitPriceNet.toFixed(2), unitPriceGross: grossOf(t.unitPriceNet, tax.rate).toFixed(2) })),
      /** Phase 45: the price-list price already in the buyer's currency (used exactly at checkout) */
      fixedLocal,
      /** Phase 45: what the buyer sees in its own currency (null = EUR) */
      local: localPrice(vat.pfx.fx, price, sale, fixedLocal, fixedList, tax.rate, o.packaging.unitsPerPack),
    },
    vatRate: tax.rate.toString(),
    /** Local tax name in the buyer's country (IVA in PT/ES, IGIC in the Canaries, …). */
    taxLabel: taxLabel(countryCode, tax.taxType),
    available,
    stockStatus: available <= 0 ? ("OUT" as const) : available < o.minOrderQty * 5 ? ("LOW" as const) : ("IN" as const),
  };
}

export type CatalogueItem = ReturnType<typeof present>;

/** Phase 45: a price in the buyer's currency — a fixed local price exactly, else EUR × the customer rate. */
function localPrice(fx: Fx, price: NonNullable<ReturnType<typeof resolvePrice>>, sale: Decimal, fixedLocal: { code: string; unitNet: string } | null,
  fixedList: { byMinQty: Map<number, string> } | undefined, vatRate: Decimal, unitsPerPack: number) {
  if (!isLocal(fx)) return null;
  const ratio = fixedLocal && !price.unitPriceNet.isZero() ? new Decimal(fixedLocal.unitNet).div(price.unitPriceNet) : new Decimal(fx.rate);
  const net = (eur: Decimal, r = ratio) => eur.mul(r).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
  const gross = (n: Decimal) => roundMoney(grossOf(n, vatRate), fx.code).toFixed(fx.decimals);
  const list = net(price.unitPriceNet), unit = net(sale);
  return {
    code: fx.code, showEur: fx.showEur,
    listUnitNet: roundMoney(list, fx.code).toFixed(fx.decimals), listUnitGross: gross(list),
    unitPriceNet: roundMoney(unit, fx.code).toFixed(fx.decimals), unitPriceGross: gross(unit),
    perUnitGross: gross(unit.div(unitsPerPack)),
    tiers: price.tiers.map((t) => {
      const f = fixedList?.byMinQty.get(t.minQty);
      const n = f ? new Decimal(f) : net(t.unitPriceNet);
      return { minQty: t.minQty, unitPriceNet: roundMoney(n, fx.code).toFixed(fx.decimals), unitPriceGross: gross(n) };
    }),
  };
}

/**
 * "Order from FIRINGI" countries: one offer per product packaging — the one FIRINGI would
 * pick (nearest or cheapest wholesaler with stock, per the allocation rules) — sold as FIRINGI.
 * Returns null when the buyer chooses suppliers itself.
 */
async function firingiPicks(ctx: Ctx, items: CatalogueItem[]): Promise<CatalogueItem[] | null> {
  if ((await orderingMode(ctx)) !== "FIRINGI") return null;
  const [rules, distances] = await Promise.all([allocationRules(), supplierDistances(ctx)]);
  const best = new Map<string, CatalogueItem>();
  const key = (i: CatalogueItem) => [i.available > 0 ? 0 : 1, rules.pickBy === "CHEAPEST" ? Number(i.price?.unitPriceNet ?? Infinity) : distances.get(i.vendor.id) ?? Infinity, Number(i.price?.unitPriceNet ?? Infinity)];
  const better = (a: CatalogueItem, b: CatalogueItem) => { const x = key(a), y = key(b); for (let k = 0; k < x.length; k++) if (x[k] !== y[k]) return x[k] < y[k]; return false; };
  for (const i of items) {
    if (!i.price) continue;
    const cur = best.get(i.packagingUnitId);
    if (!cur || better(i, cur)) best.set(i.packagingUnitId, i);
  }
  return [...best.values()].map(asFiringi);
}
// Sold as FIRINGI: no supplier name, id or supplier SKU.
const asFiringi = (i: CatalogueItem): CatalogueItem => ({ ...i, vendorSku: null, vendor: { ...i.vendor, id: "", name: "FIRINGI", badges: [] } });

/** Phase 28: the suppliers' verified badges (FIRINGI-sold items carry none — the supplier isn't shown). */
async function withBadges<T extends { vendor: { id: string; badges: Badge[] } }>(items: T[]): Promise<T[]> {
  const map = await badgesFor(items.map((i) => i.vendor.id));
  return items.map((i) => (i.vendor.id ? { ...i, vendor: { ...i.vendor, badges: map.get(i.vendor.id) ?? [] } } : i));
}
/** Phase 28: limit to suppliers holding a verified badge (catalogue filter). */
async function badgeWhere(badge?: string | null): Promise<Prisma.VendorOfferWhereInput> {
  return badge ? { vendorCompanyId: { in: await vendorsWithBadge(badge) } } : {};
}

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
export async function searchAcrossSuppliers(ctx: Ctx, q: string, badge?: string | null) {
  const scope = await buyerScope(ctx);
  if (!q.trim()) return { items: [], barcode: null as string | null };
  const rows = await prisma.vendorOffer.findMany({
    where: { AND: [visibleOfferWhere(scope), productQueryWhere(q), await badgeWhere(badge)] },
    include: offerInclude(scope),
    take: 100,
  });
  const [vat, promoFn] = await Promise.all([vatRates(scope.buyerCountryId, [...new Set(rows.map((r) => r.packaging.variant.product.taxCategoryId))], ctx), promoMatcher(ctx, scope)]);
  const presented = rows.map((r) => present(r, vat, ctx.company.countryCode, 1, promoFn));
  const picked = await firingiPicks(ctx, presented);
  if (picked) return { items: picked.map((i) => ({ ...i, distanceKm: null as number | null })), barcode: asBarcode(q) };
  const suppliers = new Map((await visibleSuppliers(ctx)).map((s) => [s.id, s]));
  const items = rows
    .map((r) => ({ ...present(r, vat, ctx.company.countryCode, 1, promoFn), distanceKm: suppliers.get(r.vendorCompanyId)?.distanceKm ?? null }))
    .sort((a, b) => byDistance({ name: a.vendor.name, distanceKm: a.distanceKm }, { name: b.vendor.name, distanceKm: b.distanceKm }));
  return { items: await withBadges(items), barcode: asBarcode(q) };
}

export async function browseCatalogue(ctx: Ctx, f: { q?: string; categoryId?: string; vendorId?: string; page?: number; badge?: string | null; free?: string[]; diet?: string | null } = {}) {
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
      await badgeWhere(f.badge),
      await buyerFoodWhere(ctx, { free: f.free, diet: f.diet }),
    ],
  };
  if (!f.vendorId && (await orderingMode(ctx)) === "FIRINGI") {
    // One FIRINGI offer per packaging: pick across all suppliers, then page.
    const all = await prisma.vendorOffer.findMany({ where, include: offerInclude(scope), orderBy: [{ packaging: { variant: { product: { searchText: "asc" } } } }, { id: "asc" }] });
    const [vat, promoFn] = await Promise.all([vatRates(scope.buyerCountryId, [...new Set(all.map((r) => r.packaging.variant.product.taxCategoryId))], ctx), promoMatcher(ctx, scope)]);
    const picked = (await firingiPicks(ctx, all.map((r) => present(r, vat, ctx.company.countryCode, 1, promoFn))))!;
    return { items: picked.slice((page - 1) * pageSize, page * pageSize), total: picked.length, page, pageCount: Math.max(1, Math.ceil(picked.length / pageSize)) };
  }
  const [rows, total] = await Promise.all([
    prisma.vendorOffer.findMany({ where, include: offerInclude(scope), orderBy: [{ packaging: { variant: { product: { searchText: "asc" } } } }, { id: "asc" }], skip: (page - 1) * pageSize, take: pageSize }),
    prisma.vendorOffer.count({ where }),
  ]);
  const [vat, promoFn] = await Promise.all([vatRates(scope.buyerCountryId, [...new Set(rows.map((r) => r.packaging.variant.product.taxCategoryId))], ctx), promoMatcher(ctx, scope)]);
  return { items: await withBadges(rows.map((r) => present(r, vat, ctx.company.countryCode, 1, promoFn))), total, page, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

/** A single offer — 404 (not 403) when it isn't visible, so its existence isn't revealed. */
export async function catalogueItem(ctx: Ctx, offerId: string) {
  const scope = await buyerScope(ctx);
  const row = await prisma.vendorOffer.findFirst({ where: { AND: [{ id: offerId }, visibleOfferWhere(scope)] }, include: offerInclude(scope) });
  if (!row) throw new NotFoundError("Product");
  const [vat, promoFn] = await Promise.all([vatRates(scope.buyerCountryId, [row.packaging.variant.product.taxCategoryId], ctx), promoMatcher(ctx, scope)]);
  // Other visible packagings / suppliers of the same product, for comparison.
  const alternatives = await prisma.vendorOffer.findMany({
    where: { AND: [visibleOfferWhere(scope), { id: { not: offerId } }, { packaging: { variant: { productId: row.packaging.variant.productId } } }] },
    include: offerInclude(scope),
    take: 20,
  });
  const item = present(row, vat, ctx.company.countryCode, 1, promoFn);
  const alts = alternatives.map((a) => present(a, vat, ctx.company.countryCode, 1, promoFn));
  const picked = await firingiPicks(ctx, alts.filter((a) => a.packagingUnitId !== item.packagingUnitId));
  if (picked) return { item: asFiringi(item), alternatives: picked };
  const [withB, ...altsB] = await withBadges([item, ...alts]);
  return { item: withB, alternatives: altsB };
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
export async function visibleSuppliers(ctx: Ctx, opts: { categoryId?: string; q?: string; badge?: string | null } = {}) {
  // Customers in "order from FIRINGI" countries don't pick suppliers.
  if ((await orderingMode(ctx)) === "FIRINGI") return [];
  const rows = await suppliersNearest(ctx, opts);
  const allowed = opts.badge ? new Set(await vendorsWithBadge(opts.badge)) : null;
  const list = allowed ? rows.filter((r) => allowed.has(r.id)) : rows;
  const map = await badgesFor(list.map((r) => r.id));
  return list.map((r) => ({ ...r, badges: map.get(r.id) ?? [] }));
}

/** Distance (km) to each supplier the buyer may use. */
async function supplierDistances(ctx: Ctx) {
  return new Map((await suppliersNearest(ctx, {})).map((s) => [s.id, s.distanceKm ?? Infinity]));
}

async function suppliersNearest(ctx: Ctx, opts: { categoryId?: string; q?: string }) {
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
  const supplier = (await visibleSuppliers(ctx)).find((s) => s.id === vendorId); // none in FIRINGI mode
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
/** Cart lines priced for this buyer (automatic offers + the coupon, if `couponId`). */
export async function pricedOffers(ctx: Ctx, lines: { offerId: string; qty: number }[], opts: { couponId?: string | null } = {}) {
  const scope = await buyerScope(ctx);
  const rows = await prisma.vendorOffer.findMany({
    where: { AND: [visibleOfferWhere(scope), { id: { in: lines.map((l) => l.offerId) } }] },
    include: offerInclude(scope),
  });
  const [vat, promoFn] = await Promise.all([vatRates(scope.buyerCountryId, [...new Set(rows.map((r) => r.packaging.variant.product.taxCategoryId))], ctx), promoMatcher(ctx, scope, opts.couponId)]);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const items = lines.filter((l) => byId.has(l.offerId)).map((l) => {
    const r = byId.get(l.offerId)!;
    return {
      ...present(r, vat, ctx.company.countryCode, l.qty, promoFn), qty: l.qty, taxCategoryId: r.packaging.variant.product.taxCategoryId, vendorCompanyId: r.vendorCompanyId, productId: r.packaging.variant.productId,
      categoryIds: categoryIdsOf(scope, r.packaging.variant.product.categoryId),
    };
  });
  return { items, unavailable: lines.filter((l) => !byId.has(l.offerId)).map((l) => l.offerId) };
}

/** Suppliers whose offers this buyer can see (e.g. for showing their promotions). */
export async function visibleVendorIds(ctx: Ctx) {
  const scope = await buyerScope(ctx);
  return (await prisma.vendorOffer.groupBy({ by: ["vendorCompanyId"], where: visibleOfferWhere(scope) })).map((g) => g.vendorCompanyId);
}

/**
 * Phase 34 (sponsored products): the given offers as this buyer would see them — only those visible to
 * the buyer (market, supplier area, restrictions, active), priced for the buyer, with badges.
 * `matching` keeps only offers that match a search text.
 */
export async function presentOffers(ctx: Ctx, offerIds: string[], opts: { matching?: string | null; categoryIds?: string[] | null } = {}) {
  if (!offerIds.length) return [];
  const scope = await buyerScope(ctx);
  const categoryIds = opts.categoryIds ? opts.categoryIds.flatMap((c) => withDescendants(c, scope.info)) : null;
  const rows = await prisma.vendorOffer.findMany({
    where: {
      AND: [
        visibleOfferWhere(scope), { id: { in: offerIds } },
        opts.matching ? productQueryWhere(opts.matching) : {},
        categoryIds ? { packaging: { variant: { product: { categoryId: { in: categoryIds } } } } } : {},
      ],
    },
    include: offerInclude(scope),
  });
  const [vat, promoFn] = await Promise.all([vatRates(scope.buyerCountryId, [...new Set(rows.map((r) => r.packaging.variant.product.taxCategoryId))], ctx), promoMatcher(ctx, scope)]);
  return withBadges(rows.map((r) => present(r, vat, ctx.company.countryCode, 1, promoFn)));
}
