/**
 * Promotions: vendor promotions (vendor-funded) and FIRINGI promotions (FIRINGI,
 * vendor or split funded, vendor must accept its share). Matching is done in memory
 * against the (small) set of currently active promotions.
 */
import { Prisma, type PromotionKind } from "@prisma/client";
import Decimal from "decimal.js";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { LINE_KINDS, type PromoCandidate } from "@/server/catalogue/promotions";
import { writeAudit } from "./audit";
import { notify } from "@/server/notify/dispatch";

const activeWhere = (now = new Date()): Prisma.PromotionWhereInput => ({
  status: "ACTIVE", validFrom: { lte: now }, OR: [{ validTo: null }, { validTo: { gt: now } }],
});

/** All currently active promotions with targets and acceptances (one query per request).
 *  Promotions that used up their redemption limit or budget are left out. */
export async function loadActivePromotions(countryId: string) {
  const promos = await prisma.promotion.findMany({
    where: { AND: [activeWhere(), { OR: [{ countryId: null }, { countryId }] }] },
    include: { targets: true, acceptances: { where: { status: "ACCEPTED" }, select: { vendorCompanyId: true } } },
  });
  const limited = promos.filter((p) => p.maxRedemptions != null || p.budget != null);
  if (!limited.length) return promos;
  const used = await usage(limited.map((p) => p.id));
  return promos.filter((p) => {
    const u = used.get(p.id);
    if (!u) return true;
    if (p.maxRedemptions != null && u.count >= p.maxRedemptions) return false;
    if (p.budget != null && u.amount >= Number(p.budget)) return false;
    return true;
  });
}
export type ActivePromotions = Awaited<ReturnType<typeof loadActivePromotions>>;

/** Uses (checkouts with an order not cancelled) and amount given per promotion, optionally for one buyer. */
export async function usage(promotionIds: string[], buyerCompanyId?: string) {
  if (!promotionIds.length) return new Map<string, { count: number; amount: number }>();
  const rows = await prisma.$queryRaw<{ promotionId: string; count: number; amount: number }[]>`
    SELECT r."promotionId", count(DISTINCT COALESCE(r."checkoutId", r."orderId"))::int AS count, COALESCE(sum(r.amount), 0)::float8 AS amount
      FROM "PromotionRedemption" r JOIN "Order" o ON o.id = r."orderId"
     WHERE o.status <> 'CANCELLED' AND r."promotionId" IN (${Prisma.join(promotionIds)})
       ${buyerCompanyId ? Prisma.sql`AND r."buyerCompanyId" = ${buyerCompanyId}` : Prisma.empty}
     GROUP BY r."promotionId"`;
  return new Map(rows.map((r) => [r.promotionId, { count: r.count, amount: r.amount }]));
}

/** Who is buying: what decides which customer offers apply. */
export type BuyerPromoContext = {
  companyId: string;
  groupIds: string[];
  /** CRM segments (referenced by active promotions) this buyer is in. */
  segmentIds: string[];
  /** No order yet (cancelled ones don't count). */
  firstOrder: boolean;
  /** The coupon the buyer entered (already validated), if any. */
  couponId?: string | null;
};

type Promo = ActivePromotions[number];

/** WHO targets (customer group, company, CRM segment): none = everyone; else the buyer must match one. */
export function promoForBuyer(p: Promo, buyer: BuyerPromoContext) {
  if (p.code && p.id !== buyer.couponId) return false;
  if (p.firstOrderOnly && !buyer.firstOrder) return false;
  const who = p.targets.filter((t) => t.customerGroupId || t.buyerCompanyId || t.crmSegmentId);
  return !who.length || who.some((t) =>
    (t.customerGroupId && buyer.groupIds.includes(t.customerGroupId)) || (t.buyerCompanyId && t.buyerCompanyId === buyer.companyId) || (t.crmSegmentId && buyer.segmentIds.includes(t.crmSegmentId)));
}

/** WHAT targets (offer, product, category, supplier): none = everything (a vendor's own: its offers). */
export function promoMatchesOffer(p: Promo, offer: { id: string; vendorCompanyId: string; productId: string; categoryIds: string[] }) {
  if (p.ownerType === "VENDOR" && p.ownerCompanyId !== offer.vendorCompanyId) return false;
  // A FIRINGI promotion that the vendor co-funds applies only if this vendor accepted.
  if (p.ownerType === "ADMIN" && new Decimal(p.vendorFundPct.toString()).gt(0) && !p.acceptances.some((a) => a.vendorCompanyId === offer.vendorCompanyId)) return false;
  const what = p.targets.filter((t) => t.offerId || t.productId || t.categoryId || t.vendorCompanyId);
  if (!what.length) return p.ownerType === "VENDOR" || p.targets.length > 0 || p.code != null || p.kind === "ORDER_AMOUNT" || p.kind === "FREE_DELIVERY";
  return what.some((t) =>
    (t.offerId && t.offerId === offer.id) || (t.productId && t.productId === offer.productId) ||
    (t.categoryId && offer.categoryIds.includes(t.categoryId)) || (t.vendorCompanyId && t.vendorCompanyId === offer.vendorCompanyId));
}

export function candidateOf(p: Promo): PromoCandidate {
  return {
    id: p.id, ownerType: p.ownerType, kind: p.kind, value: p.value.toString(), firingiFundPct: p.firingiFundPct.toString(), vendorFundPct: p.vendorFundPct.toString(),
    minQty: p.minQty, buyQty: p.buyQty, freeQty: p.freeQty, priority: p.priority, coupon: p.code != null,
    name: (p.name as Record<string, string>).pt ?? (p.name as Record<string, string>).en,
  };
}

/** Line promotions applicable to one offer for one buyer. */
export function promotionsForOffer(
  promos: ActivePromotions,
  offer: { id: string; vendorCompanyId: string; productId: string; categoryIds: string[] },
  buyer: BuyerPromoContext,
): PromoCandidate[] {
  return promos.filter((p) => LINE_KINDS.includes(p.kind) && promoForBuyer(p, buyer) && promoMatchesOffer(p, offer)).map(candidateOf);
}

export type PromotionInput = {
  id?: string;
  name: { en: string; pt?: string | null };
  kind: PromotionKind;
  value: number;
  validFrom: Date;
  validTo?: Date | null;
  minQty?: number | null;
  targets: { offerIds?: string[]; productIds?: string[]; categoryIds?: string[]; vendorIds?: string[]; customerGroupIds?: string[]; buyerCompanyIds?: string[]; segmentIds?: string[] };
  // Phase 15: coupons and customer offers
  code?: string | null;
  description?: { en: string; pt?: string | null } | null;
  firstOrderOnly?: boolean;
  maxRedemptions?: number | null;
  maxPerCustomer?: number | null;
  buyQty?: number | null;
  freeQty?: number | null;
  minOrderValue?: number | null;
  budget?: number | null;
  showInOffers?: boolean;
  // admin only
  firingiFundPct?: number;
  countryCode?: string | null;
};

/** Coupon codes: 3–32 of A–Z, 0–9, "-" and "_", stored in capitals. */
export const normaliseCode = (c: string | null | undefined) => (c ? c.trim().toUpperCase().replace(/\s+/g, "") : "") || null;

function validate(i: PromotionInput) {
  if (!i.name.en?.trim()) throw new ValidationError("Name is required.");
  if (i.kind === "FREE_DELIVERY") i.value = 100; // the whole fee
  if (i.kind === "BUY_X_GET_Y") {
    if (!(Number.isInteger(i.buyQty) && i.buyQty! >= 1 && Number.isInteger(i.freeQty) && i.freeQty! >= 1)) throw new ValidationError("Enter how many to buy and how many are free (at least 1 each).");
    i.value = i.freeQty!;
  } else { i.buyQty = null; i.freeQty = null; }
  if (!(i.value > 0)) throw new ValidationError("Discount must be greater than 0.");
  if (i.kind === "PERCENT" && i.value >= 100) throw new ValidationError("A percentage discount must be below 100 %.");
  if (i.validTo && i.validTo <= i.validFrom) throw new ValidationError("End date must be after start date.");
  i.code = normaliseCode(i.code);
  if (i.code && !/^[A-Z0-9_-]{3,32}$/.test(i.code)) throw new ValidationError("A coupon code has 3 to 32 letters, digits, - or _.");
  for (const [n, v] of [["Uses in total", i.maxRedemptions], ["Uses per customer", i.maxPerCustomer]] as const)
    if (v != null && !(Number.isInteger(v) && v >= 1)) throw new ValidationError(`${n} must be at least 1.`);
  if (i.minOrderValue != null && !(i.minOrderValue >= 0)) throw new ValidationError("Minimum order can't be negative.");
  if (i.budget != null && !(i.budget > 0)) throw new ValidationError("Budget must be greater than 0.");
}

function targetRows(t: PromotionInput["targets"]) {
  return [
    ...(t.offerIds ?? []).map((offerId) => ({ offerId })), ...(t.productIds ?? []).map((productId) => ({ productId })),
    ...(t.categoryIds ?? []).map((categoryId) => ({ categoryId })), ...(t.vendorIds ?? []).map((vendorCompanyId) => ({ vendorCompanyId })),
    ...(t.customerGroupIds ?? []).map((customerGroupId) => ({ customerGroupId })),
    ...(t.buyerCompanyIds ?? []).map((buyerCompanyId) => ({ buyerCompanyId })), ...(t.segmentIds ?? []).map((crmSegmentId) => ({ crmSegmentId })),
  ];
}

/** Vendor creates / updates its own promotion (always 100 % vendor-funded). */
export async function saveVendorPromotion(ctx: Ctx, i: PromotionInput) {
  if ((ctx.company.type !== "DISTRIBUTOR" && ctx.company.type !== "WHOLESALER") || !can(ctx, "vendor.promotions.manage")) throw new ForbiddenError();
  validate(i);
  // Targets may only point at the vendor's own offers / own customer groups.
  if (i.targets.offerIds?.length && (await prisma.vendorOffer.count({ where: { id: { in: i.targets.offerIds }, vendorCompanyId: ctx.company.id } })) !== i.targets.offerIds.length)
    throw new ValidationError("You can only promote your own products.");
  if (i.targets.customerGroupIds?.length && (await prisma.customerGroup.count({ where: { id: { in: i.targets.customerGroupIds }, ownerCompanyId: ctx.company.id } })) !== i.targets.customerGroupIds.length)
    throw new ValidationError("Choose one of your own customer groups.");
  if (i.targets.vendorIds?.length || i.targets.productIds?.length || i.targets.buyerCompanyIds?.length || i.targets.segmentIds?.length)
    throw new ValidationError("Vendor promotions target your offers, categories or customer groups.");
  return savePromotion(ctx, i, { ownerType: "VENDOR", ownerCompanyId: ctx.company.id, firingiFundPct: 0, vendorFundPct: 100, countryId: null });
}

/** FIRINGI creates a promotion and decides who pays: FIRINGI, vendor, or a split. */
export async function saveAdminPromotion(ctx: Ctx, i: PromotionInput) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, ["admin.pricing.manage", "admin.marketing.manage"])) throw new ForbiddenError();
  validate(i);
  const firingiPct = i.firingiFundPct ?? 100;
  if (!(firingiPct >= 0 && firingiPct <= 100)) throw new ValidationError("FIRINGI's share must be between 0 and 100 %.");
  if (i.kind === "FREE_DELIVERY" && firingiPct !== 0 && firingiPct !== 100) throw new ValidationError("Free delivery is paid entirely by FIRINGI or entirely by the supplier.");
  // Big FIRINGI-paid offers need a second person.
  const { approvalSettings, fourEyes } = await import("@/server/approvals/gate");
  const ap = await approvalSettings();
  const big = firingiPct > 0 && ((i.kind === "PERCENT" && i.value > ap.offerPercentAbove) || (i.kind === "ORDER_AMOUNT" && i.value > ap.offerAmountAbove) || (i.budget != null && i.budget > ap.offerAmountAbove));
  if (ap.enabled && big)
    await fourEyes(ctx, {
      kind: "OFFER", amount: i.budget ?? (i.kind === "ORDER_AMOUNT" ? i.value : null),
      summary: `${i.code ? `Coupon ${i.code}` : "Offer"} “${i.name.en}”: ${i.kind === "PERCENT" ? `${i.value} %` : `${i.value} €`} ${i.kind.toLowerCase().replace(/_/g, " ")}, FIRINGI pays ${firingiPct} %${i.budget ? `, budget ${i.budget} €` : ""}`,
      payload: { input: { ...i, validFrom: i.validFrom.toISOString(), validTo: i.validTo ? i.validTo.toISOString() : null } },
    });
  const country = i.countryCode ? await prisma.country.findUnique({ where: { code: i.countryCode } }) : null;
  return savePromotion(ctx, i, { ownerType: "ADMIN", ownerCompanyId: null, firingiFundPct: firingiPct, vendorFundPct: 100 - firingiPct, countryId: country?.id ?? null });
}

async function savePromotion(ctx: Ctx, i: PromotionInput, fixed: { ownerType: "VENDOR" | "ADMIN"; ownerCompanyId: string | null; firingiFundPct: number; vendorFundPct: number; countryId: string | null }) {
  const data = {
    name: Object.fromEntries(Object.entries(i.name).filter(([, v]) => v)), kind: i.kind, value: i.value, validFrom: i.validFrom, validTo: i.validTo ?? null,
    minQty: i.minQty ?? null, ...fixed, requiresVendorAcceptance: fixed.ownerType === "ADMIN" && fixed.vendorFundPct > 0,
    code: i.code ?? null, description: i.description ? (Object.fromEntries(Object.entries(i.description).filter(([, v]) => v)) as Prisma.InputJsonValue) : Prisma.DbNull,
    firstOrderOnly: !!i.firstOrderOnly, maxRedemptions: i.maxRedemptions ?? null, maxPerCustomer: i.maxPerCustomer ?? null, buyQty: i.buyQty ?? null, freeQty: i.freeQty ?? null,
    minOrderValue: i.minOrderValue ?? null, budget: i.budget ?? null, showInOffers: i.showInOffers ?? true,
  };
  if (data.code && (await prisma.promotion.count({ where: { code: data.code, ...(i.id ? { id: { not: i.id } } : {}) } }))) throw new ValidationError("This coupon code is already used. Choose another.");
  const promo = await prisma.$transaction(async (tx) => {
    let id = i.id;
    if (id) {
      const p = await tx.promotion.findFirst({ where: { id, ownerType: fixed.ownerType, ownerCompanyId: fixed.ownerCompanyId } });
      if (!p) throw new NotFoundError("Promotion");
      await tx.promotion.update({ where: { id }, data });
      await tx.promotionTarget.deleteMany({ where: { promotionId: id } });
    } else id = (await tx.promotion.create({ data: { ...data, status: "ACTIVE", createdById: ctx.user.id } })).id;
    const rows = targetRows(i.targets);
    if (rows.length) await tx.promotionTarget.createMany({ data: rows.map((r) => ({ ...r, promotionId: id! })) });
    // Vendors asked to co-fund get an acceptance request.
    if (data.requiresVendorAcceptance) {
      const vendors = i.targets.vendorIds ?? [];
      if (!vendors.length) throw new ValidationError("Choose the vendors that co-fund this promotion.");
      for (const v of vendors)
        await tx.promotionVendorAcceptance.upsert({ where: { promotionId_vendorCompanyId: { promotionId: id!, vendorCompanyId: v } }, update: {}, create: { promotionId: id!, vendorCompanyId: v } });
    }
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: i.id ? "promotion.updated" : "promotion.created", entityType: "Promotion", entityId: id, after: { ...data, targets: i.targets } }, tx);
    return { id: id! };
  });
  if (data.requiresVendorAcceptance)
    for (const v of i.targets.vendorIds ?? [])
      await notify("promotion.acceptance", [{ companyId: v, link: "/vendor/products/promotions" }], { promotion: i.name.en, share: fixed.vendorFundPct });
  return promo;
}

export async function setPromotionStatus(ctx: Ctx, id: string, status: "ACTIVE" | "PAUSED" | "ENDED") {
  const p = await prisma.promotion.findUnique({ where: { id } });
  if (!p) throw new NotFoundError("Promotion");
  const own = p.ownerType === "VENDOR" ? p.ownerCompanyId === ctx.company.id && can(ctx, "vendor.promotions.manage") : ctx.company.type === "ADMIN" && can(ctx, ["admin.pricing.manage", "admin.marketing.manage"]);
  if (!own) throw new ForbiddenError();
  await prisma.promotion.update({ where: { id }, data: { status } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: `promotion.${status.toLowerCase()}`, entityType: "Promotion", entityId: id });
}

/** Vendor answers a FIRINGI co-funding request. */
export async function answerPromotion(ctx: Ctx, promotionId: string, accept: boolean) {
  if ((ctx.company.type !== "DISTRIBUTOR" && ctx.company.type !== "WHOLESALER") || !can(ctx, "vendor.promotions.manage")) throw new ForbiddenError();
  const a = await prisma.promotionVendorAcceptance.findUnique({ where: { promotionId_vendorCompanyId: { promotionId, vendorCompanyId: ctx.company.id } } });
  if (!a) throw new NotFoundError("Promotion");
  if (a.status !== "PENDING") throw new AppError("ALREADY_ANSWERED", "You already answered this promotion.");
  await prisma.promotionVendorAcceptance.update({ where: { promotionId_vendorCompanyId: { promotionId, vendorCompanyId: ctx.company.id } }, data: { status: accept ? "ACCEPTED" : "DECLINED", respondedById: ctx.user.id, respondedAt: new Date() } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: accept ? "promotion.accepted" : "promotion.declined", entityType: "Promotion", entityId: promotionId });
}

export async function listPromotions(ctx: Ctx, as: "VENDOR" | "ADMIN") {
  if (as === "VENDOR" && !can(ctx, ["vendor.promotions.manage"])) throw new ForbiddenError();
  if (as === "ADMIN" && (ctx.company.type !== "ADMIN" || !can(ctx, ["admin.pricing.view", "admin.pricing.manage", "admin.marketing.view", "admin.marketing.manage"]))) throw new ForbiddenError();
  const include = {
    targets: { include: { offer: { include: { packaging: { include: { variant: { include: { product: { select: { name: true } } } } } } } }, category: { select: { name: true } }, vendor: { select: { legalName: true } }, customerGroup: { select: { name: true } }, product: { select: { name: true } } } },
    acceptances: { include: { vendor: { select: { id: true, legalName: true } } } },
    owner: { select: { legalName: true } },
    _count: { select: { lineDiscounts: true } },
  } satisfies Prisma.PromotionInclude;
  const [own, requests] = await Promise.all([
    prisma.promotion.findMany({ where: as === "VENDOR" ? { ownerType: "VENDOR", ownerCompanyId: ctx.company.id } : {}, include, orderBy: { createdAt: "desc" } }),
    as === "VENDOR" ? prisma.promotion.findMany({ where: { acceptances: { some: { vendorCompanyId: ctx.company.id } } }, include, orderBy: { createdAt: "desc" } }) : Promise.resolve([]),
  ]);
  return { own, requests };
}

/** Finance view: discounts given and who paid them. */
export async function promotionFunding(ctx: Ctx) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, ["admin.finance.view", "admin.pricing.view", "admin.marketing.view"])) throw new ForbiddenError();
  const rows = await prisma.orderLineDiscount.groupBy({ by: ["promotionId"], _sum: { amount: true, firingiAmount: true, vendorAmount: true }, _count: { _all: true } });
  const promos = await prisma.promotion.findMany({ where: { id: { in: rows.map((r) => r.promotionId) } }, select: { id: true, name: true, ownerType: true, owner: { select: { legalName: true } } } });
  return rows.map((r) => ({ ...r, promotion: promos.find((p) => p.id === r.promotionId)! }));
}
