/**
 * Phase 55 — rewards shop. Buyers (customers and wholesalers with loyalty on) spend their loyalty points on:
 *  - VOUCHER / FREE_DELIVERY: FIRINGI-funded, issued as a single-use coupon only this business can use;
 *  - SUPPLIER_PRODUCT: a supplier's own product (supplier-funded, approved by FIRINGI) — free in the cart on the
 *    buyer's next order from that supplier (like Phase 48 free goods; the supplier's payout carries the cost);
 *  - GIFT: merchandise with a stock count, shipped by FIRINGI to a delivery address;
 *  - PARTNER: a partner's offer — a code from a pool, shown right after redeeming.
 * Cancelled rewards (and, where FIRINGI says so, expired ones) give the points back. FIRINGI switches the shop and
 * each kind on / off, per buyer / supplier type and per business. A daily job keeps statuses right (voucher used /
 * expired, supplier product delivered / expired), reminds buyers and warns about low stock.
 */
import "server-only";
import Decimal from "decimal.js";
import type { Prisma, RewardKind, RewardStatus, RedemptionStatus } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";
import { notify } from "@/server/notify/dispatch";
import { pickLocalized } from "@/i18n/config";
import {
  REWARD_KINDS, REWARD_TIERS, blockedReason, buyerMayCancel, cleanRewardsSettings, goalProgress, mergeRewardsSettings, parseCodes, rewardCode, voucherCheck, voucherState,
  type Blocked, type RewardKindT, type RewardsSettings,
} from "@/lib/rewards";

type Tx = Prisma.TransactionClient;
const KEY = "rewards.settings";
const FEATURE = "REWARDS_SHOP";
const DAY = 86_400_000;
const BUYER_PERMS = ["buyer.orders.view", "buyer.orders.place"] as const;
/** System promotion that carries reward products on orders, invoices and promotion reports (never applied by itself). */
export const REWARD_PROMOTION_ID = "rewards-shop";
const GRANT = "rw:";
const COUPON_KINDS: RewardKindT[] = ["VOUCHER", "FREE_DELIVERY"];
const OPEN: RedemptionStatus[] = ["ISSUED", "PENDING", "SHIPPED"];
const n = (v: unknown) => (v == null ? null : Number(v));
const adminCompanyId = async () => (await prisma.company.findFirst({ where: { type: "ADMIN" }, select: { id: true } }))?.id ?? "";
const monthStart = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

// ── settings, switches, access ──────────────────────────────────────────────

export async function rewardsSettings(): Promise<RewardsSettings> {
  const row = await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: KEY } });
  return mergeRewardsSettings(row?.value as Partial<RewardsSettings> | null);
}

function staff(ctx: Ctx, manage = true) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, manage ? "admin.marketing.manage" : ["admin.marketing.view", "admin.marketing.manage"])) throw new ForbiddenError();
}

export async function saveRewardsSettings(ctx: Ctx, input: RewardsSettings) {
  staff(ctx);
  let v: RewardsSettings;
  try { v = cleanRewardsSettings(input); } catch (e) { throw new ValidationError((e as Error).message); }
  const before = await rewardsSettings();
  await prisma.setting.upsert({
    where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key: KEY } },
    create: { scope: "GLOBAL", scopeId: "", key: KEY, value: v as unknown as Prisma.InputJsonValue, updatedById: ctx.user.id },
    update: { value: v as unknown as Prisma.InputJsonValue, updatedById: ctx.user.id },
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "rewards.settings_saved", entityType: "Setting", entityId: KEY, before, after: v });
  return v;
}

type Switch = "DEFAULT" | "ON" | "OFF";
export async function rewardsSwitch(companyId: string): Promise<Switch> {
  const f = await prisma.companyFeature.findUnique({ where: { companyId_key: { companyId, key: FEATURE } } });
  return !f ? "DEFAULT" : f.enabled ? "ON" : "OFF";
}

/** FIRINGI: this business's own switch (buyers: may redeem; suppliers: may offer products). */
export async function setRewardsSwitch(ctx: Ctx, companyId: string, state: Switch) {
  staff(ctx);
  const co = await prisma.company.findUnique({ where: { id: companyId }, select: { type: true } });
  if (!co || co.type === "ADMIN") throw new NotFoundError("Business");
  if (state === "DEFAULT") await prisma.companyFeature.deleteMany({ where: { companyId, key: FEATURE } });
  else await prisma.companyFeature.upsert({ where: { companyId_key: { companyId, key: FEATURE } }, create: { companyId, key: FEATURE, enabled: state === "ON", updatedById: ctx.user.id }, update: { enabled: state === "ON", updatedById: ctx.user.id } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "rewards.company_switch", entityType: "Company", entityId: companyId, after: { state } });
}

export async function rewardsSwitches(ctx: Ctx) {
  staff(ctx, false);
  const f = await prisma.companyFeature.findMany({ where: { key: FEATURE }, include: { company: { select: { id: true, legalName: true, tradeName: true, type: true } } } });
  return f.map((x) => ({ companyId: x.companyId, name: x.company.tradeName ?? x.company.legalName, type: x.company.type, state: x.enabled ? ("ON" as const) : ("OFF" as const) }));
}

/** FIRINGI: find a business to switch (name / NIF). */
export async function findRewardsBusiness(ctx: Ctx, q: string) {
  staff(ctx, false);
  const t = q.trim();
  if (t.length < 2) return [];
  const rows = await prisma.company.findMany({
    where: { AND: [await (await import("@/server/services/admin-search")).adminCompanyWhere(ctx), { type: { in: ["CUSTOMER", "WHOLESALER", "DISTRIBUTOR"] }, OR: [{ legalName: { contains: t, mode: "insensitive" } }, { tradeName: { contains: t, mode: "insensitive" } }, { taxId: { contains: t } }] }] },
    select: { id: true, legalName: true, tradeName: true, type: true }, take: 10, orderBy: { legalName: "asc" },
  });
  return Promise.all(rows.map(async (c) => ({ id: c.id, name: c.tradeName ?? c.legalName, type: c.type, state: await rewardsSwitch(c.id) })));
}

export type Why = "OFF" | "TYPE_OFF" | "COMPANY_OFF" | "LOYALTY_OFF" | null;

/** May this buyer use the rewards shop? (Needs loyalty on too — the points come from there.) */
export async function buyerRewardsAccess(co: { id: string; type: string }, s?: RewardsSettings): Promise<{ on: boolean; why: Why; settings: RewardsSettings }> {
  const set = s ?? (await rewardsSettings());
  if (!set.enabled) return { on: false, why: "OFF", settings: set };
  if (co.type !== "CUSTOMER" && co.type !== "WHOLESALER") return { on: false, why: "TYPE_OFF", settings: set };
  const sw = await rewardsSwitch(co.id);
  if (sw === "OFF") return { on: false, why: "COMPANY_OFF", settings: set };
  if (sw !== "ON" && !set.buyerTypes[co.type as "CUSTOMER" | "WHOLESALER"]) return { on: false, why: "TYPE_OFF", settings: set };
  const { loyaltyOn } = await import("@/server/loyalty/service");
  if (!(await loyaltyOn(co.id))) return { on: false, why: "LOYALTY_OFF", settings: set };
  return { on: true, why: null, settings: set };
}

/** May this supplier offer its own products as rewards? */
export async function supplierRewardsAccess(co: { id: string; type: string }, s?: RewardsSettings): Promise<{ on: boolean; why: Why; settings: RewardsSettings }> {
  const set = s ?? (await rewardsSettings());
  if (!set.enabled || !set.kinds.SUPPLIER_PRODUCT) return { on: false, why: "OFF", settings: set };
  if (co.type !== "DISTRIBUTOR" && co.type !== "WHOLESALER") return { on: false, why: "TYPE_OFF", settings: set };
  const sw = await rewardsSwitch(co.id);
  if (sw === "OFF") return { on: false, why: "COMPANY_OFF", settings: set };
  if (sw !== "ON" && !set.supplierTypes[co.type as "DISTRIBUTOR" | "WHOLESALER"]) return { on: false, why: "TYPE_OFF", settings: set };
  return { on: true, why: null, settings: set };
}

async function buyerGuard(ctx: Ctx, place = false) {
  if (!can(ctx, place ? "buyer.orders.place" : [...BUYER_PERMS])) throw new ForbiddenError();
  const a = await buyerRewardsAccess(ctx.company);
  if (!a.on) throw new AppError("REWARDS_OFF", "The rewards shop is not available for your business.", 403);
  return a.settings;
}

async function supplierGuard(ctx: Ctx) {
  if (!can(ctx, "vendor.promotions.manage")) throw new ForbiddenError();
  const a = await supplierRewardsAccess(ctx.company);
  if (!a.on) throw new AppError("REWARDS_OFF", "Offering rewards is not available for your business.", 403);
  return a.settings;
}

// ── shared reading ──────────────────────────────────────────────────────────

const pickName = (v: unknown) => pickLocalized(v, "en");

async function offerLabels(ids: string[]) {
  if (!ids.length) return new Map<string, { name: string; productId: string; image: string | null }>();
  const rows = await prisma.vendorOffer.findMany({ where: { id: { in: ids } }, select: { id: true, packaging: { select: { name: true, variant: { select: { product: { select: { id: true, name: true, images: true } } } } } } } });
  return new Map(rows.map((o) => [o.id, { name: `${pickName(o.packaging.variant.product.name)} — ${pickName(o.packaging.name)}`, productId: o.packaging.variant.product.id, image: o.packaging.variant.product.images[0] ?? null }]));
}

async function companyNames(ids: string[]) {
  const u = [...new Set(ids.filter(Boolean))];
  if (!u.length) return new Map<string, string>();
  const rows = await prisma.company.findMany({ where: { id: { in: u } }, select: { id: true, legalName: true, tradeName: true } });
  return new Map(rows.map((c) => [c.id, c.tradeName ?? c.legalName]));
}

/** Live stock: partner offers count their unused codes; the rest their own counter (null = unlimited). */
async function liveStock(items: { id: string; kind: RewardKind; stock: number | null }[]) {
  const partner = items.filter((i) => i.kind === "PARTNER").map((i) => i.id);
  const codes = partner.length ? await prisma.rewardPartnerCode.groupBy({ by: ["rewardId"], where: { rewardId: { in: partner }, redemptionId: null }, _count: { _all: true } }) : [];
  const left = new Map(codes.map((c) => [c.rewardId, c._count._all]));
  return new Map(items.map((i) => [i.id, i.kind === "PARTNER" ? left.get(i.id) ?? 0 : i.stock]));
}

type ItemRow = Prisma.RewardItemGetPayload<object>;
function itemView(r: ItemRow, locale: string, extra: { stock: number | null; offer?: { name: string; productId: string; image: string | null } | null; supplier?: string | null }) {
  return {
    id: r.id, kind: r.kind as RewardKindT, status: r.status, points: r.points,
    title: pickLocalized(r.title, locale), description: pickLocalized(r.description, locale) || null, terms: pickLocalized(r.terms, locale) || null,
    titles: r.title as Record<string, string>, descriptions: (r.description ?? {}) as Record<string, string>, termsAll: (r.terms ?? {}) as Record<string, string>,
    stock: extra.stock, perBuyerLimit: r.perBuyerLimit, minTier: r.minTier, buyerTypes: r.buyerTypes, countryCodes: r.countryCodes,
    validFrom: r.validFrom, validTo: r.validTo, featured: r.featured, sortOrder: r.sortOrder, image: r.imageKey ? `/api/rewards/image/${r.id}` : extra.offer?.image ? `/api/catalogue/images/${extra.offer.productId}/0` : null,
    voucherAmount: n(r.voucherAmount), voucherMinOrder: n(r.voucherMinOrder), voucherDays: r.voucherDays,
    supplierCompanyId: r.supplierCompanyId, supplier: extra.supplier ?? null, offerId: r.offerId, qty: r.qty, offer: extra.offer ?? null,
    giftCost: n(r.giftCost), partnerName: r.partnerName, partnerUrl: r.partnerUrl, reviewNote: r.reviewNote, createdAt: r.createdAt,
  };
}
export type RewardView = ReturnType<typeof itemView>;

async function viewItems(rows: ItemRow[], locale: string) {
  const [stock, offers, suppliers] = await Promise.all([
    liveStock(rows), offerLabels(rows.map((r) => r.offerId).filter(Boolean) as string[]), companyNames(rows.map((r) => r.supplierCompanyId ?? "")),
  ]);
  return rows.map((r) => itemView(r, locale, { stock: stock.get(r.id) ?? null, offer: r.offerId ? offers.get(r.offerId) ?? null : null, supplier: r.supplierCompanyId ? suppliers.get(r.supplierCompanyId) ?? null : null }));
}

async function buyerState(companyId: string, type: string, countryCode: string) {
  const { ensureAccount } = await import("@/server/loyalty/service");
  const acc = await ensureAccount(prisma, companyId);
  const spent = await prisma.rewardRedemption.aggregate({ where: { companyId, createdAt: { gte: monthStart() }, status: { not: "CANCELLED" } }, _sum: { points: true } });
  return { type, countryCode, tier: acc.tier, balance: acc.balance, spentThisMonth: spent._sum.points ?? 0, goalRewardId: acc.goalRewardId };
}

// ── buyer: the shop ─────────────────────────────────────────────────────────

/** The shop: every reward the business could see, with why it can't redeem one (if so). */
export async function rewardsShop(ctx: Ctx, locale: string, f: { kind?: string } = {}) {
  const s = await buyerGuard(ctx);
  const now = new Date();
  const kinds = REWARD_KINDS.filter((k) => s.kinds[k] && (!f.kind || f.kind === k));
  const rows = await prisma.rewardItem.findMany({
    where: { status: "ACTIVE", kind: { in: kinds }, validFrom: { lte: now }, OR: [{ validTo: null }, { validTo: { gt: now } }] },
    orderBy: [{ featured: "desc" }, { sortOrder: "asc" }, { points: "asc" }],
  });
  // a business never sees rewards for another type / country (it can't ever redeem them)
  const visible = rows.filter((r) => (!r.buyerTypes.length || r.buyerTypes.includes(ctx.company.type)) && (!r.countryCodes.length || r.countryCodes.includes(ctx.company.countryCode)));
  const me = await buyerState(ctx.company.id, ctx.company.type, ctx.company.countryCode);
  const used = await prisma.rewardRedemption.groupBy({ by: ["rewardId"], where: { companyId: ctx.company.id, rewardId: { in: visible.map((r) => r.id) }, status: { not: "CANCELLED" } }, _count: { _all: true } });
  const usedBy = new Map(used.map((u) => [u.rewardId, u._count._all]));
  const items = await viewItems(visible, locale);
  const { loyaltySettings } = await import("@/server/loyalty/service");
  const ls = await loyaltySettings();
  const list = items.map((it) => {
    const raw = visible.find((r) => r.id === it.id)!;
    const blocked = blockedReason({ ...raw, kind: raw.kind as RewardKindT, stock: it.stock }, me, { settings: s, usedByBuyer: usedBy.get(it.id) ?? 0, now });
    return { ...it, blocked, progress: goalProgress(me.balance, it.points) };
  });
  const goal = me.goalRewardId ? list.find((i) => i.id === me.goalRewardId) ?? null : null;
  return {
    settings: s, balance: me.balance, tier: me.tier, value: new Decimal(me.balance).mul(ls.pointValue).toFixed(2), spentThisMonth: me.spentThisMonth,
    monthlyLeft: s.monthlyLimit > 0 ? Math.max(0, s.monthlyLimit - me.spentThisMonth) : null,
    goal, items: list, kinds: REWARD_KINDS.filter((k) => s.kinds[k]),
  };
}

export async function rewardForBuyer(ctx: Ctx, id: string, locale: string) {
  const shop = await rewardsShop(ctx, locale);
  const it = shop.items.find((i) => i.id === id);
  if (!it) throw new NotFoundError("Reward");
  const addresses = it.kind === "GIFT"
    ? await prisma.address.findMany({ where: { companyId: ctx.company.id, kind: { in: ["DELIVERY", "HEAD_OFFICE"] } }, select: { id: true, label: true, line1: true, postalCode: true, cityName: true, kind: true }, orderBy: [{ kind: "asc" }, { label: "asc" }] })
    : [];
  return { ...shop, item: it, addresses };
}

/** Saving for a reward (shown with its progress), or stop (null). */
export async function setRewardGoal(ctx: Ctx, rewardId: string | null) {
  await buyerGuard(ctx);
  if (rewardId && !(await prisma.rewardItem.count({ where: { id: rewardId, status: "ACTIVE" } }))) throw new NotFoundError("Reward");
  const { ensureAccount } = await import("@/server/loyalty/service");
  await ensureAccount(prisma, ctx.company.id);
  await prisma.loyaltyAccount.update({ where: { companyId: ctx.company.id }, data: { goalRewardId: rewardId } });
}

const BLOCKED_MSG: Record<Blocked, string> = {
  KIND_OFF: "This kind of reward is not available now.", NOT_ACTIVE: "This reward is not available now.", NOT_YET: "This reward is not available yet.",
  ENDED: "This reward has ended.", TYPE: "This reward is not for your type of business.", COUNTRY: "This reward is not available in your country.",
  TIER: "Your loyalty tier is too low for this reward.", LIMIT: "You have redeemed this reward as often as allowed.", SOLD_OUT: "This reward is sold out.",
  MONTHLY: "This goes over the monthly points limit for the rewards shop.", POINTS: "You don't have enough points.",
};

async function ensureRewardPromotion(tx: Tx | typeof prisma = prisma) {
  await tx.promotion.upsert({
    where: { id: REWARD_PROMOTION_ID }, update: {},
    create: {
      id: REWARD_PROMOTION_ID, ownerType: "ADMIN", name: { en: "Reward (points)", pt: "Recompensa (pontos)", es: "Recompensa (puntos)" }, kind: "ORDER_AMOUNT", value: 0.01,
      firingiFundPct: 0, vendorFundPct: 100, validFrom: new Date(0), status: "PAUSED", showInOffers: false,
      description: { en: "Supplier products redeemed with loyalty points in the rewards shop (Phase 55), free on the order. Supplier-funded." },
    },
  });
}

/** The buyer spends points on a reward. */
export async function redeemReward(ctx: Ctx, rewardId: string, input: { addressId?: string | null; note?: string | null } = {}) {
  const s = await buyerGuard(ctx, true);
  const { loyaltySettings, spendPoints } = await import("@/server/loyalty/service");
  const ls = await loyaltySettings();
  const result = await prisma.$transaction(async (tx) => {
    // lock the reward so two buyers can't take the last unit
    await tx.$queryRaw`SELECT 1 FROM "RewardItem" WHERE id = ${rewardId} FOR UPDATE`;
    const r = await tx.rewardItem.findUnique({ where: { id: rewardId } });
    if (!r) throw new NotFoundError("Reward");
    const kind = r.kind as RewardKindT;
    const stock = kind === "PARTNER" ? await tx.rewardPartnerCode.count({ where: { rewardId, redemptionId: null } }) : r.stock;
    const me = await buyerState(ctx.company.id, ctx.company.type, ctx.company.countryCode);
    const usedByBuyer = await tx.rewardRedemption.count({ where: { rewardId, companyId: ctx.company.id, status: { not: "CANCELLED" } } });
    const why = blockedReason({ ...r, kind, stock }, me, { settings: s, usedByBuyer });
    if (why) throw new AppError(`REWARD_${why}`, BLOCKED_MSG[why], 409);
    const now = new Date();
    let addressId: string | null = null;
    if (kind === "GIFT") {
      const a = input.addressId ? await tx.address.findFirst({ where: { id: input.addressId, companyId: ctx.company.id } }) : await tx.address.findFirst({ where: { companyId: ctx.company.id, kind: "DELIVERY" }, orderBy: { createdAt: "asc" } });
      if (!a) throw new ValidationError("Choose where to send the gift.");
      addressId = a.id;
    }
    if (kind === "SUPPLIER_PRODUCT" && (!r.offerId || !(await tx.vendorOffer.count({ where: { id: r.offerId, status: "ACTIVE" } })))) throw new AppError("REWARD_NOT_ACTIVE", BLOCKED_MSG.NOT_ACTIVE, 409);
    const red = await tx.rewardRedemption.create({
      data: {
        rewardId, companyId: ctx.company.id, userId: ctx.user.id, points: r.points,
        status: COUPON_KINDS.includes(kind) || kind === "PARTNER" ? "ISSUED" : "PENDING",
        addressId, note: input.note?.trim().slice(0, 500) || null,
        ...(kind === "SUPPLIER_PRODUCT" ? { supplierCompanyId: r.supplierCompanyId, offerId: r.offerId, qty: r.qty ?? 1, expiresAt: new Date(now.getTime() + s.handoverDays * DAY) } : {}),
      },
    });
    // the points (oldest first); refused if the balance changed meanwhile
    await spendPoints(tx, ctx.company.id, { kind: "REDEEM_REWARD", points: r.points, euros: new Decimal(r.points).mul(ls.pointValue).toDecimalPlaces(2), note: pickName(r.title), dedupeKey: `RW:${red.id}`, createdById: ctx.user.id });
    let couponCode: string | null = null, partnerCode: string | null = null;
    if (COUPON_KINDS.includes(kind)) {
      const days = r.voucherDays ?? s.voucherDays;
      const expiresAt = new Date(now.getTime() + days * DAY);
      for (let i = 0; i < 5 && !couponCode; i++) {
        const code = rewardCode();
        if (!(await tx.promotion.count({ where: { code } }))) couponCode = code;
      }
      if (!couponCode) throw new Error("coupon code");
      const promo = await tx.promotion.create({
        data: {
          ownerType: "ADMIN", name: r.title as Prisma.InputJsonValue, kind: kind === "VOUCHER" ? "ORDER_AMOUNT" : "FREE_DELIVERY", value: kind === "VOUCHER" ? r.voucherAmount ?? 0 : 100,
          firingiFundPct: 100, vendorFundPct: 0, minOrderValue: r.voucherMinOrder, validFrom: now, validTo: expiresAt, status: "ACTIVE", code: couponCode,
          maxRedemptions: 1, maxPerCustomer: 1, showInOffers: true, createdById: ctx.user.id,
          description: { en: "Reward from the rewards shop", pt: "Recompensa da loja de recompensas", es: "Recompensa de la tienda de recompensas" },
          targets: { create: [{ buyerCompanyId: ctx.company.id }] },
        },
      });
      await tx.rewardRedemption.update({ where: { id: red.id }, data: { promotionId: promo.id, couponCode, expiresAt } });
    } else if (kind === "PARTNER") {
      const code = (await tx.$queryRaw<{ id: string; code: string }[]>`SELECT id, code FROM "RewardPartnerCode" WHERE "rewardId" = ${rewardId} AND "redemptionId" IS NULL ORDER BY "createdAt", id LIMIT 1 FOR UPDATE SKIP LOCKED`)[0];
      if (!code) throw new AppError("REWARD_SOLD_OUT", BLOCKED_MSG.SOLD_OUT, 409);
      await tx.rewardPartnerCode.update({ where: { id: code.id }, data: { redemptionId: red.id } });
      partnerCode = code.code;
      await tx.rewardRedemption.update({ where: { id: red.id }, data: { partnerCode, expiresAt: r.validTo } });
    } else if (r.stock != null) {
      await tx.rewardItem.update({ where: { id: rewardId }, data: { stock: { decrement: 1 } } });
    }
    // a reached goal is done
    await tx.loyaltyAccount.updateMany({ where: { companyId: ctx.company.id, goalRewardId: rewardId }, data: { goalRewardId: null } });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "rewards.redeemed", entityType: "RewardRedemption", entityId: red.id, after: { reward: rewardId, kind, points: r.points, couponCode } }, tx);
    return { id: red.id, kind, couponCode, partnerCode, partnerUrl: r.partnerUrl, supplierCompanyId: r.supplierCompanyId, title: pickName(r.title) };
  });
  if (result.kind === "SUPPLIER_PRODUCT" && result.supplierCompanyId) {
    await ensureRewardPromotion();
    await notify("rewards.supplier_redeemed", [{ companyId: result.supplierCompanyId, link: "/vendor/products/rewards/handover" }], { reward: result.title, company: ctx.company.tradeName ?? ctx.company.legalName }).catch(() => null);
  }
  if (result.kind === "GIFT") await notify("rewards.gift_to_send", [{ companyId: await adminCompanyId(), link: "/admin/marketing/rewards/redemptions?status=PENDING" }], { reward: result.title, company: ctx.company.tradeName ?? ctx.company.legalName }).catch(() => null);
  return result;
}

/** The buyer's redeemed rewards, newest first. */
export async function myRedemptions(ctx: Ctx, locale: string) {
  const s = await buyerGuard(ctx);
  const rows = await prisma.rewardRedemption.findMany({ where: { companyId: ctx.company.id }, include: { reward: true }, orderBy: { createdAt: "desc" }, take: 200 });
  const [offers, suppliers, addresses, orders] = await Promise.all([
    offerLabels(rows.map((r) => r.offerId).filter(Boolean) as string[]), companyNames(rows.map((r) => r.supplierCompanyId ?? "")),
    prisma.address.findMany({ where: { id: { in: rows.map((r) => r.addressId).filter(Boolean) as string[] } }, select: { id: true, label: true, line1: true, cityName: true } }),
    prisma.order.findMany({ where: { id: { in: rows.map((r) => r.orderId).filter(Boolean) as string[] } }, select: { id: true, number: true } }),
  ]);
  const addr = new Map(addresses.map((a) => [a.id, `${a.label} — ${a.line1}, ${a.cityName}`]));
  const ord = new Map(orders.map((o) => [o.id, o.number]));
  return {
    settings: s,
    rows: rows.map((r) => ({
      id: r.id, kind: r.reward.kind as RewardKindT, title: pickLocalized(r.reward.title, locale), points: r.points, status: r.status, at: r.createdAt,
      couponCode: r.couponCode, expiresAt: r.expiresAt, partnerCode: r.partnerCode, partnerUrl: r.reward.partnerUrl, partnerName: r.reward.partnerName, terms: pickLocalized(r.reward.terms, locale) || null,
      offerId: r.offerId, offer: r.offerId ? offers.get(r.offerId)?.name ?? null : null, supplier: r.supplierCompanyId ? suppliers.get(r.supplierCompanyId) ?? null : null,
      qty: r.qty, usedQty: r.usedQty, order: r.orderId ? { id: r.orderId, number: ord.get(r.orderId) ?? null } : null,
      address: r.addressId ? addr.get(r.addressId) ?? null : null, tracking: r.tracking, cancelReason: r.cancelReason,
      canCancel: s.buyerCancel && buyerMayCancel(r.reward.kind as RewardKindT, r.status, r.usedQty),
    })),
  };
}

/** "Use it": a voucher goes into the cart as its coupon; a supplier product goes into the cart (free there). */
export async function applyRedemption(ctx: Ctx, id: string) {
  await buyerGuard(ctx, true);
  const r = await prisma.rewardRedemption.findFirst({ where: { id, companyId: ctx.company.id }, include: { reward: { select: { kind: true } } } });
  if (!r) throw new NotFoundError("Reward");
  const cart = await import("@/server/services/cart");
  if (r.couponCode && r.status === "ISSUED") { await cart.applyCoupon(ctx, r.couponCode); return { to: "/buy/orders/cart" }; }
  if (r.reward.kind === "SUPPLIER_PRODUCT" && r.offerId && (r.status === "PENDING" || r.status === "SHIPPED") && r.usedQty < r.qty) {
    await cart.addToCart(ctx, r.offerId, r.qty - r.usedQty);
    return { to: "/buy/orders/cart" };
  }
  throw new AppError("REWARD_NOT_USABLE", "This reward can't be used now.", 409);
}

/** Points back (once per redemption). */
async function refund(tx: Tx, r: { id: string; companyId: string; points: number }, points: number, note: string) {
  if (points <= 0) return;
  const { addPoints, loyaltySettings } = await import("@/server/loyalty/service");
  await addPoints(tx, r.companyId, { kind: "REFUND", points, note, dedupeKey: `RWREF:${r.id}` }, await loyaltySettings());
}

/** Cancels a redemption (buyer, supplier for its product, or FIRINGI): points back, stock / code back, coupon ended. */
async function cancelRedemption(by: { userId: string; companyId: string }, id: string, reason: string, who: "BUYER" | "SUPPLIER" | "FIRINGI") {
  const out = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "RewardRedemption" WHERE id = ${id} FOR UPDATE`;
    const r = await tx.rewardRedemption.findUnique({ where: { id }, include: { reward: true } });
    if (!r) throw new NotFoundError("Reward");
    const kind = r.reward.kind as RewardKindT;
    if (!OPEN.includes(r.status)) throw new AppError("REWARD_FINISHED", "This reward can't be cancelled any more.", 409);
    if (who !== "FIRINGI" && !buyerMayCancel(kind, r.status, r.usedQty)) throw new AppError("REWARD_IN_USE", "This reward is already being used and can't be cancelled.", 409);
    if (COUPON_KINDS.includes(kind) && r.promotionId) {
      const used = await tx.promotionRedemption.count({ where: { promotionId: r.promotionId, order: { status: { not: "CANCELLED" } } } });
      if (used) throw new AppError("REWARD_IN_USE", "This voucher was used on an order and can't be cancelled.", 409);
      await tx.promotion.update({ where: { id: r.promotionId }, data: { status: "ENDED" } });
    }
    if (kind === "PARTNER") await tx.rewardPartnerCode.updateMany({ where: { redemptionId: r.id }, data: { redemptionId: null } }); // FIRINGI only: the code goes back to the pool
    if ((kind === "GIFT" || kind === "SUPPLIER_PRODUCT") && r.reward.stock != null) await tx.rewardItem.update({ where: { id: r.rewardId }, data: { stock: { increment: 1 } } });
    // a supplier product partly on an order gives back the part not yet taken
    const back = kind === "SUPPLIER_PRODUCT" && r.usedQty > 0 ? Math.floor((r.points * (r.qty - r.usedQty)) / r.qty) : r.points;
    await tx.rewardRedemption.update({ where: { id }, data: { status: "CANCELLED", cancelReason: reason.slice(0, 500), fulfilledById: by.userId, fulfilledAt: new Date() } });
    await refund(tx, r, back, `Reward cancelled: ${pickName(r.reward.title)}`);
    await writeAudit({ actorUserId: by.userId, actorCompanyId: by.companyId, action: "rewards.cancelled", entityType: "RewardRedemption", entityId: id, after: { by: who, reason, points: back } }, tx);
    return { companyId: r.companyId, title: pickName(r.reward.title), points: back };
  });
  if (who !== "BUYER") await notify("rewards.refunded", [{ companyId: out.companyId, link: "/buy/rewards/mine" }], { reward: out.title, points: out.points, reason }).catch(() => null);
  return out;
}

export async function buyerCancelRedemption(ctx: Ctx, id: string) {
  const s = await buyerGuard(ctx, true);
  if (!s.buyerCancel) throw new AppError("REWARD_NO_CANCEL", "Rewards can't be cancelled.", 409);
  if (!(await prisma.rewardRedemption.count({ where: { id, companyId: ctx.company.id } }))) throw new NotFoundError("Reward");
  return cancelRedemption({ userId: ctx.user.id, companyId: ctx.company.id }, id, "Cancelled by the customer", "BUYER");
}

// ── supplier: own products as rewards ───────────────────────────────────────

export type SupplierRewardInput = {
  id?: string; offerId: string; qty: number; points: number; stock: number | null; perBuyerLimit: number | null; minTier: string | null;
  title: Record<string, string>; description?: Record<string, string> | null; validTo?: Date | null;
};

const cleanJson = (v: Record<string, string> | null | undefined) => {
  const o = Object.fromEntries(Object.entries(v ?? {}).map(([k, x]) => [k, (x ?? "").trim()]).filter(([, x]) => x));
  return Object.keys(o).length ? o : null;
};

export async function supplierRewards(ctx: Ctx, locale: string) {
  const s = await supplierGuard(ctx);
  const rows = await prisma.rewardItem.findMany({ where: { supplierCompanyId: ctx.company.id }, orderBy: { createdAt: "desc" } });
  const items = await viewItems(rows, locale);
  const counts = await prisma.rewardRedemption.groupBy({ by: ["rewardId", "status"], where: { rewardId: { in: rows.map((r) => r.id) } }, _count: { _all: true } });
  return {
    settings: s,
    items: items.map((i) => ({
      ...i,
      redeemed: counts.filter((c) => c.rewardId === i.id && c.status !== "CANCELLED").reduce((a, c) => a + c._count._all, 0),
      toHand: counts.filter((c) => c.rewardId === i.id && (c.status === "PENDING" || c.status === "SHIPPED")).reduce((a, c) => a + c._count._all, 0),
    })),
  };
}

export async function supplierRewardOptions(ctx: Ctx) {
  const s = await supplierGuard(ctx);
  const offers = await prisma.vendorOffer.findMany({ where: { vendorCompanyId: ctx.company.id, status: "ACTIVE" }, select: { id: true }, take: 2000 });
  const labels = await offerLabels(offers.map((o) => o.id));
  return { settings: s, offers: [...labels.entries()].map(([id, l]) => ({ id, name: l.name })).sort((a, b) => a.name.localeCompare(b.name)) };
}

export async function saveSupplierReward(ctx: Ctx, i: SupplierRewardInput) {
  const s = await supplierGuard(ctx);
  const offer = await prisma.vendorOffer.findFirst({ where: { id: i.offerId, vendorCompanyId: ctx.company.id, status: "ACTIVE" } });
  if (!offer) throw new ValidationError("Choose one of your active products.");
  if (!Number.isInteger(i.qty) || i.qty < 1 || i.qty > 100) throw new ValidationError("Quantity: 1 to 100.");
  if (!Number.isInteger(i.points) || i.points < s.supplierMinPoints || i.points > s.supplierMaxPoints) throw new ValidationError(`Points: ${s.supplierMinPoints} to ${s.supplierMaxPoints}.`);
  if (i.stock == null || !Number.isInteger(i.stock) || i.stock < 0 || i.stock > 100_000) throw new ValidationError("How many you give away: 0 to 100000.");
  if (i.perBuyerLimit != null && (!Number.isInteger(i.perBuyerLimit) || i.perBuyerLimit < 1)) throw new ValidationError("Per customer: at least 1.");
  if (i.minTier && !(REWARD_TIERS as readonly string[]).includes(i.minTier)) throw new ValidationError("Unknown tier.");
  const title = cleanJson(i.title);
  if (!title?.en && !Object.keys(title ?? {}).length) throw new ValidationError("Give the reward a name.");
  if (i.validTo && i.validTo <= new Date()) throw new ValidationError("The end date must be in the future.");
  const data = {
    kind: "SUPPLIER_PRODUCT" as const, supplierCompanyId: ctx.company.id, offerId: i.offerId, qty: i.qty, points: i.points, stock: i.stock, perBuyerLimit: i.perBuyerLimit, minTier: i.minTier || null,
    title: { en: title!.en ?? Object.values(title!)[0], ...title } as Prisma.InputJsonValue, description: (cleanJson(i.description) ?? undefined) as Prisma.InputJsonValue | undefined, validTo: i.validTo ?? null,
  };
  const status: RewardStatus = s.supplierApproval ? "PENDING" : "ACTIVE";
  let id = i.id;
  if (id) {
    const cur = await prisma.rewardItem.findFirst({ where: { id, supplierCompanyId: ctx.company.id } });
    if (!cur) throw new NotFoundError("Reward");
    if (cur.status === "ENDED") throw new AppError("REWARD_ENDED", "This reward has ended. Create a new one.", 409);
    // changing what is given or its price goes back to FIRINGI; only stock / limits / texts don't
    const bigChange = cur.offerId !== i.offerId || cur.qty !== i.qty || cur.points !== i.points;
    await prisma.rewardItem.update({ where: { id }, data: { ...data, ...(bigChange || cur.status === "REJECTED" ? { status, reviewNote: null } : {}), lowStockSentAt: i.stock > s.lowStock ? null : undefined } });
  } else id = (await prisma.rewardItem.create({ data: { ...data, status, createdById: ctx.user.id } })).id;
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: i.id ? "rewards.supplier_updated" : "rewards.supplier_created", entityType: "RewardItem", entityId: id, after: data });
  const now = await prisma.rewardItem.findUniqueOrThrow({ where: { id }, select: { status: true } });
  if (now.status === "PENDING") await notify("rewards.to_review", [{ companyId: await adminCompanyId(), link: "/admin/marketing/rewards?status=PENDING" }], { company: ctx.company.tradeName ?? ctx.company.legalName, reward: pickName(data.title) }).catch(() => null);
  return { id, status: now.status };
}

export async function setSupplierRewardStatus(ctx: Ctx, id: string, status: "ACTIVE" | "PAUSED" | "ENDED") {
  await supplierGuard(ctx);
  const cur = await prisma.rewardItem.findFirst({ where: { id, supplierCompanyId: ctx.company.id } });
  if (!cur) throw new NotFoundError("Reward");
  const ok = (cur.status === "ACTIVE" && (status === "PAUSED" || status === "ENDED")) || (cur.status === "PAUSED" && (status === "ACTIVE" || status === "ENDED")) || ((cur.status === "PENDING" || cur.status === "REJECTED" || cur.status === "DRAFT") && status === "ENDED");
  if (!ok) throw new AppError("REWARD_STATUS", "This change isn't possible.", 409);
  await prisma.rewardItem.update({ where: { id }, data: { status } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "rewards.supplier_status", entityType: "RewardItem", entityId: id, before: { status: cur.status }, after: { status } });
}

/** The supplier's list of reward products redeemed by its customers: waiting for an order, on an order, delivered. */
export async function supplierHandovers(ctx: Ctx, locale: string) {
  await supplierGuard(ctx);
  const rows = await prisma.rewardRedemption.findMany({ where: { supplierCompanyId: ctx.company.id }, include: { reward: { select: { title: true } } }, orderBy: { createdAt: "desc" }, take: 500 });
  const [offers, buyers, orders] = await Promise.all([
    offerLabels(rows.map((r) => r.offerId).filter(Boolean) as string[]), companyNames(rows.map((r) => r.companyId)),
    prisma.order.findMany({ where: { id: { in: rows.map((r) => r.orderId).filter(Boolean) as string[] } }, select: { id: true, number: true, status: true } }),
  ]);
  const ord = new Map(orders.map((o) => [o.id, o]));
  return rows.map((r) => ({
    id: r.id, title: pickLocalized(r.reward.title, locale), buyer: buyers.get(r.companyId) ?? "", offer: r.offerId ? offers.get(r.offerId)?.name ?? null : null,
    qty: r.qty, usedQty: r.usedQty, status: r.status, at: r.createdAt, expiresAt: r.expiresAt, cancelReason: r.cancelReason,
    order: r.orderId ? { id: r.orderId, number: ord.get(r.orderId)?.number ?? null, status: ord.get(r.orderId)?.status ?? null } : null,
    canCancel: r.status === "PENDING" && r.usedQty === 0,
  }));
}

/** The supplier can't give it (e.g. out of stock): the customer gets the points back. */
export async function supplierCancelRedemption(ctx: Ctx, id: string, reason: string) {
  await supplierGuard(ctx);
  if (!reason.trim()) throw new ValidationError("Tell the customer why.");
  if (!(await prisma.rewardRedemption.count({ where: { id, supplierCompanyId: ctx.company.id } }))) throw new NotFoundError("Reward");
  return cancelRedemption({ userId: ctx.user.id, companyId: ctx.company.id }, id, reason.trim(), "SUPPLIER");
}

// ── checkout: supplier products free on the order ───────────────────────────

export type RewardGrant = { id: string; qty: number; funder: "SUPPLIER" };

/** Reward products the buyer has redeemed and not yet taken, per offer. */
export async function rewardGrantsFor(companyId: string, offerIds: string[]): Promise<Map<string, RewardGrant[]>> {
  const out = new Map<string, RewardGrant[]>();
  if (!offerIds.length) return out;
  const rows = await prisma.rewardRedemption.findMany({ where: { companyId, offerId: { in: offerIds }, status: { in: ["PENDING", "SHIPPED"] }, expiresAt: { gt: new Date() } }, orderBy: { expiresAt: "asc" } });
  for (const r of rows) {
    const left = r.qty - r.usedQty;
    if (left > 0 && r.offerId) out.set(r.offerId, [...(out.get(r.offerId) ?? []), { id: `${GRANT}${r.id}`, qty: left, funder: "SUPPLIER" }]);
  }
  if (out.size) await ensureRewardPromotion();
  return out;
}
export const isRewardGrant = (id: string) => id.startsWith(GRANT);

/** An order took reward units: use them up (refused if used meanwhile — nothing is placed then). */
export async function consumeRewardGoods(tx: Tx, orderId: string, grants: { id: string; qty: number }[]) {
  for (const g of grants) {
    if (g.qty <= 0 || !isRewardGrant(g.id)) continue;
    const id = g.id.slice(GRANT.length);
    const row = await tx.rewardRedemption.findUnique({ where: { id } });
    const changed = () => new ValidationError("Your reward changed meanwhile — please check your cart again.");
    if (!row || !(row.status === "PENDING" || row.status === "SHIPPED") || row.qty - row.usedQty < g.qty || (row.expiresAt && row.expiresAt <= new Date())) throw changed();
    const uses = [...((row.uses as { orderId: string; qty: number; at: string }[]) ?? []), { orderId, qty: g.qty, at: new Date().toISOString() }];
    const done = await tx.rewardRedemption.updateMany({ where: { id, usedQty: row.usedQty }, data: { usedQty: row.usedQty + g.qty, uses, status: "SHIPPED", orderId } });
    if (!done.count) throw changed();
  }
}

/** A cancelled order gives the reward units back (a week more to order them if they had expired). */
export async function restoreRewardGoods(orderId: string) {
  const rows = await prisma.rewardRedemption.findMany({ where: { uses: { array_contains: [{ orderId }] } } });
  for (const r of rows) {
    const uses = (r.uses as { orderId: string; qty: number; at: string; restored?: boolean }[]) ?? [];
    const back = uses.filter((u) => u.orderId === orderId && !u.restored).reduce((a, u) => a + u.qty, 0);
    if (!back || r.status === "CANCELLED" || r.status === "EXPIRED") continue;
    const usedQty = Math.max(0, r.usedQty - back);
    const live = uses.filter((u) => u.orderId !== orderId && !u.restored);
    await prisma.rewardRedemption.update({
      where: { id: r.id },
      data: {
        usedQty, uses: uses.map((u) => (u.orderId === orderId ? { ...u, restored: true } : u)), status: usedQty === 0 ? "PENDING" : r.status,
        orderId: r.orderId === orderId ? live[live.length - 1]?.orderId ?? null : r.orderId,
        ...(r.expiresAt && r.expiresAt < new Date(Date.now() + 7 * DAY) ? { expiresAt: new Date(Date.now() + 7 * DAY) } : {}),
      },
    });
  }
}

// ── FIRINGI: the shop ───────────────────────────────────────────────────────

export type AdminRewardInput = {
  id?: string; kind: RewardKindT; points: number; stock: number | null; perBuyerLimit: number | null; minTier: string | null;
  buyerTypes: string[]; countryCodes: string[]; validFrom?: Date | null; validTo?: Date | null; featured: boolean; sortOrder: number;
  title: Record<string, string>; description?: Record<string, string> | null; terms?: Record<string, string> | null;
  voucherAmount?: number | null; voucherMinOrder?: number | null; voucherDays?: number | null; giftCost?: number | null; partnerName?: string | null; partnerUrl?: string | null;
  status?: "DRAFT" | "ACTIVE";
};

export async function adminRewards(ctx: Ctx, f: { status?: string; kind?: string; q?: string } = {}) {
  staff(ctx, false);
  const where: Prisma.RewardItemWhereInput = {
    ...(f.status && f.status !== "ALL" ? { status: f.status as RewardStatus } : {}),
    ...(f.kind ? { kind: f.kind as RewardKind } : {}),
  };
  const rows = await prisma.rewardItem.findMany({ where, orderBy: [{ status: "asc" }, { featured: "desc" }, { sortOrder: "asc" }, { createdAt: "desc" }], take: 500 });
  const items = await viewItems(rows, "en");
  const q = f.q?.trim().toLowerCase();
  const counts = await prisma.rewardRedemption.groupBy({ by: ["rewardId"], where: { rewardId: { in: rows.map((r) => r.id) }, status: { not: "CANCELLED" } }, _count: { _all: true }, _sum: { points: true } });
  const by = new Map(counts.map((c) => [c.rewardId, c]));
  const pending = await prisma.rewardItem.count({ where: { status: "PENDING" } });
  return {
    pending,
    items: items.filter((i) => !q || i.title.toLowerCase().includes(q) || (i.supplier ?? "").toLowerCase().includes(q) || (i.partnerName ?? "").toLowerCase().includes(q))
      .map((i) => ({ ...i, redeemed: by.get(i.id)?._count._all ?? 0, pointsSpent: by.get(i.id)?._sum.points ?? 0 })),
  };
}

export async function adminReward(ctx: Ctx, id: string) {
  staff(ctx, false);
  const r = await prisma.rewardItem.findUnique({ where: { id } });
  if (!r) throw new NotFoundError("Reward");
  const [item] = await viewItems([r], "en");
  const [codes, used] = await Promise.all([
    r.kind === "PARTNER" ? prisma.rewardPartnerCode.count({ where: { rewardId: id } }) : Promise.resolve(0),
    r.kind === "PARTNER" ? prisma.rewardPartnerCode.count({ where: { rewardId: id, redemptionId: { not: null } } }) : Promise.resolve(0),
  ]);
  const { loyaltySettings } = await import("@/server/loyalty/service");
  const ls = await loyaltySettings();
  return { item, codes: { total: codes, used, left: codes - used }, check: r.voucherAmount ? voucherCheck(r.points, Number(r.voucherAmount), ls.pointValue) : null, pointValue: ls.pointValue };
}

function validateAdmin(i: AdminRewardInput) {
  if (!REWARD_KINDS.includes(i.kind) || i.kind === "SUPPLIER_PRODUCT") throw new ValidationError("Suppliers create their own product rewards.");
  if (!Number.isInteger(i.points) || i.points < 1 || i.points > 10_000_000) throw new ValidationError("Points: a whole number, at least 1.");
  if (i.stock != null && (!Number.isInteger(i.stock) || i.stock < 0)) throw new ValidationError("Stock: 0 or more (empty = unlimited).");
  if (i.kind === "GIFT" && i.stock == null) throw new ValidationError("Gifts need a stock count.");
  if (i.perBuyerLimit != null && (!Number.isInteger(i.perBuyerLimit) || i.perBuyerLimit < 1)) throw new ValidationError("Per business: at least 1 (empty = no limit).");
  if (i.minTier && !(REWARD_TIERS as readonly string[]).includes(i.minTier)) throw new ValidationError("Unknown tier.");
  if (!cleanJson(i.title)?.en) throw new ValidationError("A title in English is required.");
  if (i.validFrom && i.validTo && i.validTo <= i.validFrom) throw new ValidationError("The end date must be after the start date.");
  if (i.kind === "VOUCHER" && !(i.voucherAmount && i.voucherAmount > 0 && i.voucherAmount <= 10_000)) throw new ValidationError("Voucher amount: more than 0 €, up to 10000 €.");
  if (COUPON_KINDS.includes(i.kind) && i.voucherDays != null && (!Number.isInteger(i.voucherDays) || i.voucherDays < 1 || i.voucherDays > 365)) throw new ValidationError("Valid for: 1 to 365 days.");
  if (i.voucherMinOrder != null && i.voucherMinOrder < 0) throw new ValidationError("Minimum order can't be negative.");
  if (i.kind === "PARTNER" && !i.partnerName?.trim()) throw new ValidationError("Name the partner.");
  if (i.partnerUrl && !/^https:\/\/[^\s]+$/i.test(i.partnerUrl.trim())) throw new ValidationError("The partner link must start with https://");
  if (i.giftCost != null && i.giftCost < 0) throw new ValidationError("Cost can't be negative.");
}

export async function saveAdminReward(ctx: Ctx, i: AdminRewardInput) {
  staff(ctx);
  validateAdmin(i);
  const s = await rewardsSettings();
  const coupon = COUPON_KINDS.includes(i.kind);
  const data = {
    kind: i.kind, points: i.points, stock: i.kind === "PARTNER" ? null : i.stock, perBuyerLimit: i.perBuyerLimit, minTier: i.minTier || null,
    buyerTypes: i.buyerTypes.filter((t) => t === "CUSTOMER" || t === "WHOLESALER"), countryCodes: [...new Set(i.countryCodes.map((c) => c.trim().toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)))],
    validFrom: i.validFrom ?? new Date(), validTo: i.validTo ?? null, featured: i.featured, sortOrder: Math.trunc(i.sortOrder || 0),
    title: cleanJson(i.title) as Prisma.InputJsonValue, description: (cleanJson(i.description) ?? undefined) as Prisma.InputJsonValue | undefined, terms: (cleanJson(i.terms) ?? undefined) as Prisma.InputJsonValue | undefined,
    voucherAmount: i.kind === "VOUCHER" ? i.voucherAmount : null, voucherMinOrder: coupon ? i.voucherMinOrder ?? null : null, voucherDays: coupon ? i.voucherDays ?? s.voucherDays : null,
    giftCost: i.kind === "GIFT" ? i.giftCost ?? null : null, partnerName: i.kind === "PARTNER" ? i.partnerName!.trim() : null, partnerUrl: i.kind === "PARTNER" ? i.partnerUrl?.trim() || null : null,
  };
  let id = i.id;
  if (id) {
    const cur = await prisma.rewardItem.findUnique({ where: { id } });
    if (!cur || cur.kind === "SUPPLIER_PRODUCT") throw new NotFoundError("Reward");
    if (cur.kind !== i.kind) throw new ValidationError("The kind of a reward can't change.");
    await prisma.rewardItem.update({ where: { id }, data: { ...data, ...(data.stock != null && data.stock > s.lowStock ? { lowStockSentAt: null } : {}) } });
  } else id = (await prisma.rewardItem.create({ data: { ...data, status: i.status ?? "ACTIVE", createdById: ctx.user.id } })).id;
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: i.id ? "rewards.updated" : "rewards.created", entityType: "RewardItem", entityId: id, after: data });
  return { id };
}

/** FIRINGI: supplier reward approved (live in the shop) or rejected with a note. Supplier rewards' texts may be edited too. */
export async function reviewSupplierReward(ctx: Ctx, id: string, approve: boolean, note: string | null) {
  staff(ctx);
  const r = await prisma.rewardItem.findUnique({ where: { id } });
  if (!r || r.kind !== "SUPPLIER_PRODUCT") throw new NotFoundError("Reward");
  if (r.status !== "PENDING") throw new AppError("REWARD_STATUS", "This reward is not waiting for a decision.", 409);
  if (!approve && !note?.trim()) throw new ValidationError("Tell the supplier why.");
  await prisma.rewardItem.update({ where: { id }, data: { status: approve ? "ACTIVE" : "REJECTED", reviewNote: note?.trim() || null, reviewedById: ctx.user.id, reviewedAt: new Date() } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: approve ? "rewards.approved" : "rewards.rejected", entityType: "RewardItem", entityId: id, after: { note } });
  if (r.supplierCompanyId)
    await notify(approve ? "rewards.approved" : "rewards.rejected", [{ companyId: r.supplierCompanyId, link: "/vendor/products/rewards" }], { reward: pickName(r.title), reason: note ?? "" }).catch(() => null);
}

export async function setRewardStatus(ctx: Ctx, id: string, status: "ACTIVE" | "PAUSED" | "ENDED") {
  staff(ctx);
  const r = await prisma.rewardItem.findUnique({ where: { id } });
  if (!r) throw new NotFoundError("Reward");
  if (r.status === "ENDED" || (status === "ACTIVE" && (r.status === "PENDING" || r.status === "REJECTED"))) throw new AppError("REWARD_STATUS", "This change isn't possible.", 409);
  await prisma.rewardItem.update({ where: { id }, data: { status } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "rewards.status", entityType: "RewardItem", entityId: id, before: { status: r.status }, after: { status } });
}

/** Partner codes pasted one per line: new ones added, duplicates skipped. */
export async function addPartnerCodes(ctx: Ctx, id: string, text: string) {
  staff(ctx);
  const r = await prisma.rewardItem.findUnique({ where: { id } });
  if (!r || r.kind !== "PARTNER") throw new NotFoundError("Reward");
  const { codes, bad } = parseCodes(text);
  if (!codes.length) throw new ValidationError(bad.length ? `No valid codes (3–64 characters, no spaces): ${bad.slice(0, 3).join(", ")}` : "Paste at least one code.");
  if (codes.length > 20_000) throw new ValidationError("At most 20000 codes at once.");
  const res = await prisma.rewardPartnerCode.createMany({ data: codes.map((code) => ({ rewardId: id, code })), skipDuplicates: true });
  await prisma.rewardItem.update({ where: { id }, data: { lowStockSentAt: null } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "rewards.codes_added", entityType: "RewardItem", entityId: id, after: { added: res.count, skipped: codes.length - res.count, bad: bad.length } });
  return { added: res.count, skipped: codes.length - res.count, bad: bad.length };
}

/** Unused partner codes removed (e.g. the partner withdrew them). */
export async function removeUnusedCodes(ctx: Ctx, id: string) {
  staff(ctx);
  const res = await prisma.rewardPartnerCode.deleteMany({ where: { rewardId: id, redemptionId: null } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "rewards.codes_removed", entityType: "RewardItem", entityId: id, after: { removed: res.count } });
  return res.count;
}

export async function setRewardImage(ctx: Ctx, id: string, file: File | null) {
  staff(ctx);
  if (!(await prisma.rewardItem.count({ where: { id } }))) throw new NotFoundError("Reward");
  let key: string | null = null;
  if (file) {
    const { storeUpload } = await import("@/server/services/storage");
    const f = await storeUpload(file, "rewards");
    if (!f.mimeType.startsWith("image/")) throw new ValidationError("Choose a JPG, PNG or WEBP picture.");
    key = f.key;
  }
  await prisma.rewardItem.update({ where: { id }, data: { imageKey: key } });
}

/** Signed-in users see reward pictures (they aren't private). */
export async function rewardImageKey(id: string) {
  const r = await prisma.rewardItem.findUnique({ where: { id }, select: { imageKey: true } });
  if (!r?.imageKey) throw new NotFoundError("Picture");
  return r.imageKey;
}

export async function adminRedemptions(ctx: Ctx, f: { status?: string; kind?: string; q?: string; rewardId?: string } = {}) {
  staff(ctx, false);
  const rows = await prisma.rewardRedemption.findMany({
    where: { ...(f.status && f.status !== "ALL" ? { status: f.status as RedemptionStatus } : {}), ...(f.kind ? { reward: { kind: f.kind as RewardKind } } : {}), ...(f.rewardId ? { rewardId: f.rewardId } : {}) },
    include: { reward: { select: { kind: true, title: true, partnerName: true } } }, orderBy: { createdAt: "desc" }, take: 500,
  });
  const [buyers, suppliers, addresses, orders] = await Promise.all([
    companyNames(rows.map((r) => r.companyId)), companyNames(rows.map((r) => r.supplierCompanyId ?? "")),
    prisma.address.findMany({ where: { id: { in: rows.map((r) => r.addressId).filter(Boolean) as string[] } }, select: { id: true, label: true, line1: true, line2: true, postalCode: true, cityName: true, contactName: true } }),
    prisma.order.findMany({ where: { id: { in: rows.map((r) => r.orderId).filter(Boolean) as string[] } }, select: { id: true, number: true } }),
  ]);
  const addr = new Map(addresses.map((a) => [a.id, a]));
  const ord = new Map(orders.map((o) => [o.id, o.number]));
  const q = f.q?.trim().toLowerCase();
  return rows.map((r) => {
    const a = r.addressId ? addr.get(r.addressId) : null;
    return {
      id: r.id, kind: r.reward.kind as RewardKindT, title: pickName(r.reward.title), buyer: buyers.get(r.companyId) ?? "", companyId: r.companyId, supplier: r.supplierCompanyId ? suppliers.get(r.supplierCompanyId) ?? null : null,
      points: r.points, status: r.status, at: r.createdAt, expiresAt: r.expiresAt, couponCode: r.couponCode, partnerCode: r.partnerCode, qty: r.qty, usedQty: r.usedQty,
      order: r.orderId ? { id: r.orderId, number: ord.get(r.orderId) ?? null } : null, tracking: r.tracking, note: r.note, cancelReason: r.cancelReason,
      address: a ? [a.label, a.contactName, a.line1, a.line2, `${a.postalCode} ${a.cityName}`].filter(Boolean).join(", ") : null,
    };
  }).filter((r) => !q || r.buyer.toLowerCase().includes(q) || r.title.toLowerCase().includes(q) || (r.couponCode ?? "").toLowerCase().includes(q));
}

/** FIRINGI ships a gift (with tracking) and marks it delivered. */
export async function fulfilGift(ctx: Ctx, id: string, action: "SHIP" | "DELIVER", tracking?: string | null) {
  staff(ctx);
  const r = await prisma.rewardRedemption.findUnique({ where: { id }, include: { reward: { select: { kind: true, title: true } } } });
  if (!r || r.reward.kind !== "GIFT") throw new NotFoundError("Gift");
  if (action === "SHIP" && r.status !== "PENDING") throw new AppError("REWARD_STATUS", "Only gifts waiting to be sent can be shipped.", 409);
  if (action === "DELIVER" && r.status !== "SHIPPED" && r.status !== "PENDING") throw new AppError("REWARD_STATUS", "This gift is already finished.", 409);
  await prisma.rewardRedemption.update({ where: { id }, data: { status: action === "SHIP" ? "SHIPPED" : "DELIVERED", tracking: tracking?.trim() || r.tracking, fulfilledById: ctx.user.id, fulfilledAt: new Date() } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: action === "SHIP" ? "rewards.gift_shipped" : "rewards.gift_delivered", entityType: "RewardRedemption", entityId: id, after: { tracking } });
  if (action === "SHIP") await notify("rewards.gift_shipped", [{ companyId: r.companyId, link: "/buy/rewards/mine" }], { reward: pickName(r.reward.title), tracking: tracking?.trim() || "—" }).catch(() => null);
}

export async function adminCancelRedemption(ctx: Ctx, id: string, reason: string) {
  staff(ctx);
  if (!reason.trim()) throw new ValidationError("Tell the customer why.");
  return cancelRedemption({ userId: ctx.user.id, companyId: ctx.company.id }, id, reason.trim(), "FIRINGI");
}

/** FIRINGI: numbers for the rewards shop. */
export async function rewardsOverview(ctx: Ctx) {
  staff(ctx, false);
  const { loyaltySettings } = await import("@/server/loyalty/service");
  const [s, ls] = await Promise.all([rewardsSettings(), loyaltySettings()]);
  const since = new Date(Date.now() - 30 * DAY);
  const [byKind, month, open, pending, lowStock, items, giftCost, top, supplierUnits] = await Promise.all([
    prisma.$queryRaw<{ kind: string; count: number; points: number }[]>`SELECT i.kind::text AS kind, count(*)::int AS count, COALESCE(sum(r.points),0)::int AS points FROM "RewardRedemption" r JOIN "RewardItem" i ON i.id = r."rewardId" WHERE r.status <> 'CANCELLED' GROUP BY i.kind`,
    prisma.rewardRedemption.aggregate({ where: { createdAt: { gte: since }, status: { not: "CANCELLED" } }, _count: { _all: true }, _sum: { points: true } }),
    prisma.rewardRedemption.groupBy({ by: ["status"], where: { status: { in: OPEN } }, _count: { _all: true } }),
    prisma.rewardItem.count({ where: { status: "PENDING" } }),
    prisma.rewardItem.findMany({ where: { status: "ACTIVE", stock: { not: null, lte: s.lowStock } }, select: { id: true, title: true, stock: true, kind: true } }),
    prisma.rewardItem.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.$queryRaw<{ cost: number }[]>`SELECT COALESCE(sum(i."giftCost"),0)::float8 AS cost FROM "RewardRedemption" r JOIN "RewardItem" i ON i.id = r."rewardId" WHERE i.kind = 'GIFT' AND r.status <> 'CANCELLED'`,
    prisma.rewardRedemption.groupBy({ by: ["rewardId"], where: { status: { not: "CANCELLED" } }, _count: { _all: true }, orderBy: { _count: { rewardId: "desc" } }, take: 5 }),
    prisma.rewardRedemption.aggregate({ where: { supplierCompanyId: { not: null }, status: { not: "CANCELLED" } }, _sum: { usedQty: true } }),
  ]);
  const vouchers = await prisma.$queryRaw<{ amount: number }[]>`SELECT COALESCE(sum(pr.amount),0)::float8 AS amount FROM "PromotionRedemption" pr JOIN "RewardRedemption" r ON r."promotionId" = pr."promotionId" JOIN "Order" o ON o.id = pr."orderId" WHERE o.status <> 'CANCELLED'`;
  const titles = new Map((await prisma.rewardItem.findMany({ where: { id: { in: top.map((t) => t.rewardId) } }, select: { id: true, title: true, kind: true } })).map((r) => [r.id, r]));
  return {
    settings: s, pointValue: ls.pointValue,
    byKind: REWARD_KINDS.map((k) => ({ kind: k, count: byKind.find((b) => b.kind === k)?.count ?? 0, points: byKind.find((b) => b.kind === k)?.points ?? 0 })),
    last30: { count: month._count._all, points: month._sum.points ?? 0, euros: new Decimal(month._sum.points ?? 0).mul(ls.pointValue).toFixed(2) },
    open: Object.fromEntries(open.map((o) => [o.status, o._count._all])) as Partial<Record<RedemptionStatus, number>>,
    pending, lowStock: lowStock.map((l) => ({ id: l.id, title: pickName(l.title), stock: l.stock, kind: l.kind })),
    items: Object.fromEntries(items.map((i) => [i.status, i._count._all])) as Partial<Record<RewardStatus, number>>,
    giftCost: (giftCost[0]?.cost ?? 0).toFixed(2), voucherDiscount: (vouchers[0]?.amount ?? 0).toFixed(2), supplierUnits: supplierUnits._sum.usedQty ?? 0,
    top: top.map((t) => ({ id: t.rewardId, title: pickName(titles.get(t.rewardId)?.title), kind: titles.get(t.rewardId)?.kind ?? null, count: t._count._all })),
  };
}

/** The customer's redeemed rewards on FIRINGI's member page. */
export async function memberRedemptions(ctx: Ctx, companyId: string) {
  staff(ctx, false);
  const rows = await prisma.rewardRedemption.findMany({ where: { companyId }, include: { reward: { select: { title: true, kind: true } } }, orderBy: { createdAt: "desc" }, take: 50 });
  return rows.map((r) => ({ id: r.id, title: pickName(r.reward.title), kind: r.reward.kind, points: r.points, status: r.status, at: r.createdAt }));
}

// ── the daily job ───────────────────────────────────────────────────────────

/** Statuses kept right, points given back for what expired, reminders and low-stock alerts. Safe to run any number of times. */
export async function runRewardsJob(now = new Date()) {
  const s = await rewardsSettings();
  const out = { vouchersUsed: 0, vouchersExpired: 0, productsDelivered: 0, productsExpired: 0, reminded: 0, ended: 0, lowStock: 0, refunded: 0 };
  // 1. vouchers / free delivery: used on a live order, back to open (order cancelled), or expired
  const coupons = await prisma.rewardRedemption.findMany({ where: { promotionId: { not: null }, status: { in: ["ISSUED", "USED"] } }, include: { reward: { select: { title: true } } } });
  for (const r of coupons) {
    const live = await prisma.promotionRedemption.findFirst({ where: { promotionId: r.promotionId!, order: { status: { not: "CANCELLED" } } }, select: { orderId: true } });
    const state = voucherState({ expiresAt: r.expiresAt, usedOnLiveOrder: !!live }, now);
    if (state === r.status) continue;
    if (state === "USED") { await prisma.rewardRedemption.update({ where: { id: r.id }, data: { status: "USED", orderId: live!.orderId } }); out.vouchersUsed++; continue; }
    if (state === "ISSUED") { await prisma.rewardRedemption.update({ where: { id: r.id }, data: { status: "ISSUED", orderId: null } }); continue; }
    await prisma.$transaction(async (tx) => {
      await tx.rewardRedemption.update({ where: { id: r.id }, data: { status: "EXPIRED" } });
      await tx.promotion.update({ where: { id: r.promotionId! }, data: { status: "ENDED" } });
      if (s.refundExpired) { await refund(tx, r, r.points, `Reward expired unused: ${pickName(r.reward.title)}`); out.refunded++; }
    });
    out.vouchersExpired++;
    if (s.refundExpired) await notify("rewards.refunded", [{ companyId: r.companyId, link: "/buy/rewards/mine" }], { reward: pickName(r.reward.title), points: r.points, reason: "expired" }).catch(() => null);
  }
  // 2. reminders: vouchers expiring soon
  const soon = await prisma.rewardRedemption.findMany({ where: { status: "ISSUED", promotionId: { not: null }, remindedAt: null, expiresAt: { gt: now, lte: new Date(now.getTime() + s.reminderDays * DAY) } }, include: { reward: { select: { title: true } } } });
  for (const r of soon) {
    await notify("rewards.voucher_expiring", [{ companyId: r.companyId, link: "/buy/rewards/mine" }], { reward: pickName(r.reward.title), code: r.couponCode ?? "", date: r.expiresAt!.toISOString().slice(0, 10) }).catch(() => null);
    await prisma.rewardRedemption.update({ where: { id: r.id }, data: { remindedAt: now } });
    out.reminded++;
  }
  // 3. supplier products: delivered with the order, or expired (never ordered) → points and stock back
  const goods = await prisma.rewardRedemption.findMany({ where: { supplierCompanyId: { not: null }, status: { in: ["PENDING", "SHIPPED"] } }, include: { reward: { select: { title: true, stock: true } } } });
  const orderIds = [...new Set(goods.flatMap((g) => ((g.uses as { orderId: string; restored?: boolean }[]) ?? []).filter((u) => !u.restored).map((u) => u.orderId)))];
  const st = new Map((await prisma.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, status: true } })).map((o) => [o.id, o.status]));
  for (const g of goods) {
    const uses = ((g.uses as { orderId: string; restored?: boolean }[]) ?? []).filter((u) => !u.restored);
    if (g.usedQty >= g.qty && uses.length && uses.every((u) => st.get(u.orderId) === "DELIVERED")) {
      await prisma.rewardRedemption.update({ where: { id: g.id }, data: { status: "DELIVERED", fulfilledAt: now } });
      out.productsDelivered++;
      continue;
    }
    if (g.expiresAt && g.expiresAt <= now && g.usedQty < g.qty && !uses.some((u) => !["DELIVERED", "CANCELLED", "RETURNED"].includes(st.get(u.orderId) ?? ""))) {
      const back = Math.floor((g.points * (g.qty - g.usedQty)) / g.qty);
      await prisma.$transaction(async (tx) => {
        await tx.rewardRedemption.update({ where: { id: g.id }, data: { status: g.usedQty > 0 ? "DELIVERED" : "EXPIRED", cancelReason: g.usedQty > 0 ? `Not all ordered in time (${g.usedQty} of ${g.qty})` : "Not ordered in time" } });
        if (g.usedQty === 0 && g.reward.stock != null) await tx.rewardItem.update({ where: { id: g.rewardId }, data: { stock: { increment: 1 } } });
        await refund(tx, g, back, `Reward not ordered in time: ${pickName(g.reward.title)}`);
      });
      if (back > 0) { out.refunded++; await notify("rewards.refunded", [{ companyId: g.companyId, link: "/buy/rewards/mine" }], { reward: pickName(g.reward.title), points: back, reason: "expired" }).catch(() => null); }
      out.productsExpired++;
    }
  }
  // 4. rewards past their end date leave the shop
  out.ended = (await prisma.rewardItem.updateMany({ where: { status: { in: ["ACTIVE", "PAUSED"] }, validTo: { lte: now } }, data: { status: "ENDED" } })).count;
  // 5. low stock (once until restocked)
  const items = await prisma.rewardItem.findMany({ where: { status: "ACTIVE", lowStockSentAt: null } });
  const stock = await liveStock(items);
  const admin = await adminCompanyId();
  for (const it of items) {
    const left = stock.get(it.id);
    if (left == null || left > s.lowStock) continue;
    const to = it.supplierCompanyId ? { companyId: it.supplierCompanyId, link: "/vendor/products/rewards" } : { companyId: admin, link: `/admin/marketing/rewards/${it.id}` };
    await notify("rewards.low_stock", [to], { reward: pickName(it.title), left }).catch(() => null);
    await prisma.rewardItem.update({ where: { id: it.id }, data: { lowStockSentAt: now } });
    out.lowStock++;
  }
  return out;
}
