/**
 * Promotions: vendor promotions (vendor-funded) and FIRINGI promotions (FIRINGI,
 * vendor or split funded, vendor must accept its share). Matching is done in memory
 * against the (small) set of currently active promotions.
 */
import type { Prisma, PromotionKind } from "@prisma/client";
import Decimal from "decimal.js";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import type { PromoCandidate } from "@/server/catalogue/promotions";
import { writeAudit } from "./audit";
import { notifyCompany } from "./notify";

const activeWhere = (now = new Date()): Prisma.PromotionWhereInput => ({
  status: "ACTIVE", validFrom: { lte: now }, OR: [{ validTo: null }, { validTo: { gt: now } }],
});

/** All currently active promotions with targets and acceptances (one query per request). */
export async function loadActivePromotions(countryId: string) {
  return prisma.promotion.findMany({
    where: { AND: [activeWhere(), { OR: [{ countryId: null }, { countryId }] }] },
    include: { targets: true, acceptances: { where: { status: "ACCEPTED" }, select: { vendorCompanyId: true } } },
  });
}
export type ActivePromotions = Awaited<ReturnType<typeof loadActivePromotions>>;

/** Promotions applicable to one offer for one buyer. */
export function promotionsForOffer(
  promos: ActivePromotions,
  offer: { id: string; vendorCompanyId: string; productId: string; categoryIds: string[] },
  buyerGroupIds: string[],
): PromoCandidate[] {
  return promos
    .filter((p) => {
      if (p.ownerType === "VENDOR" && p.ownerCompanyId !== offer.vendorCompanyId) return false;
      // A FIRINGI promotion that the vendor co-funds applies only if this vendor accepted.
      if (p.ownerType === "ADMIN" && new Decimal(p.vendorFundPct.toString()).gt(0) && !p.acceptances.some((a) => a.vendorCompanyId === offer.vendorCompanyId)) return false;
      if (p.targets.length === 0) return p.ownerType === "VENDOR"; // vendor promo with no target = all its offers
      // Customer-group targets restrict WHO gets the promotion; the others restrict WHAT.
      const groupTargets = p.targets.filter((t) => t.customerGroupId);
      if (groupTargets.length && !groupTargets.some((t) => buyerGroupIds.includes(t.customerGroupId!))) return false;
      const what = p.targets.filter((t) => !t.customerGroupId);
      if (what.length === 0) return true;
      return what.some((t) =>
        (t.offerId && t.offerId === offer.id) || (t.productId && t.productId === offer.productId) ||
        (t.categoryId && offer.categoryIds.includes(t.categoryId)) || (t.vendorCompanyId && t.vendorCompanyId === offer.vendorCompanyId));
    })
    .map((p) => ({
      id: p.id, ownerType: p.ownerType, kind: p.kind, value: p.value.toString(), firingiFundPct: p.firingiFundPct.toString(),
      vendorFundPct: p.vendorFundPct.toString(), minQty: p.minQty, priority: p.priority, name: (p.name as Record<string, string>).pt ?? (p.name as Record<string, string>).en,
    }));
}

export type PromotionInput = {
  id?: string;
  name: { en: string; pt?: string | null };
  kind: PromotionKind;
  value: number;
  validFrom: Date;
  validTo?: Date | null;
  minQty?: number | null;
  targets: { offerIds?: string[]; productIds?: string[]; categoryIds?: string[]; vendorIds?: string[]; customerGroupIds?: string[] };
  // admin only
  firingiFundPct?: number;
  countryCode?: string | null;
};

function validate(i: PromotionInput) {
  if (!i.name.en?.trim()) throw new ValidationError("Name is required.");
  if (!(i.value > 0)) throw new ValidationError("Discount must be greater than 0.");
  if (i.kind === "PERCENT" && i.value >= 100) throw new ValidationError("A percentage discount must be below 100 %.");
  if (i.validTo && i.validTo <= i.validFrom) throw new ValidationError("End date must be after start date.");
}

function targetRows(t: PromotionInput["targets"]) {
  return [
    ...(t.offerIds ?? []).map((offerId) => ({ offerId })), ...(t.productIds ?? []).map((productId) => ({ productId })),
    ...(t.categoryIds ?? []).map((categoryId) => ({ categoryId })), ...(t.vendorIds ?? []).map((vendorCompanyId) => ({ vendorCompanyId })),
    ...(t.customerGroupIds ?? []).map((customerGroupId) => ({ customerGroupId })),
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
  if (i.targets.vendorIds?.length || i.targets.productIds?.length) throw new ValidationError("Vendor promotions target your offers, categories or customer groups.");
  return savePromotion(ctx, i, { ownerType: "VENDOR", ownerCompanyId: ctx.company.id, firingiFundPct: 0, vendorFundPct: 100, countryId: null });
}

/** FIRINGI creates a promotion and decides who pays: FIRINGI, vendor, or a split. */
export async function saveAdminPromotion(ctx: Ctx, i: PromotionInput) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, ["admin.pricing.manage", "admin.marketing.manage"])) throw new ForbiddenError();
  validate(i);
  const firingiPct = i.firingiFundPct ?? 100;
  if (!(firingiPct >= 0 && firingiPct <= 100)) throw new ValidationError("FIRINGI's share must be between 0 and 100 %.");
  const country = i.countryCode ? await prisma.country.findUnique({ where: { code: i.countryCode } }) : null;
  return savePromotion(ctx, i, { ownerType: "ADMIN", ownerCompanyId: null, firingiFundPct: firingiPct, vendorFundPct: 100 - firingiPct, countryId: country?.id ?? null });
}

async function savePromotion(ctx: Ctx, i: PromotionInput, fixed: { ownerType: "VENDOR" | "ADMIN"; ownerCompanyId: string | null; firingiFundPct: number; vendorFundPct: number; countryId: string | null }) {
  const data = {
    name: Object.fromEntries(Object.entries(i.name).filter(([, v]) => v)), kind: i.kind, value: i.value, validFrom: i.validFrom, validTo: i.validTo ?? null,
    minQty: i.minQty ?? null, ...fixed, requiresVendorAcceptance: fixed.ownerType === "ADMIN" && fixed.vendorFundPct > 0,
  };
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
      await notifyCompany(v, { type: "promotion.acceptance", title: "FIRINGI promotion — your answer is needed", body: `FIRINGI proposes "${i.name.en}" and asks you to fund ${fixed.vendorFundPct}% of the discount.`, link: "/vendor/products/promotions" });
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
