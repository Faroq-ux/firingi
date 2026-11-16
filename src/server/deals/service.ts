/**
 * Clearance deals (Phase 38): suppliers create deals on their offers; FIRINGI approves them (always,
 * or by itself within limits) and takes a lower commission on clearance deals (a lot close to its
 * best-before date, or overstock). Buyers see live deals, pay the deal price in the cart, make
 * offers on best-offer deals, and follow products / categories / suppliers.
 *
 * A deal is live when APPROVED, startsAt ≤ now < endsAt and units are left. A deal line never stacks
 * with promotions or coupons: the deal price replaces them on that line.
 */
import "server-only";
import type { ClearanceKind, Prisma } from "@prisma/client";
import { prisma, type Tx } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";
import { notify } from "@/server/notify/dispatch";
import { bestDealUnit, DEAL_KINDS, DEFAULT_DEAL_SETTINGS, dealUnitPrice, discountPct, type DealKindKey, type DealSettings, type DealTerms, type Tier } from "@/lib/deals";

const DAY = 86_400_000;
const KEY = "deals.settings";
const isVendor = (ctx: Ctx) => ctx.company.type === "DISTRIBUTOR" || ctx.company.type === "WHOLESALER";
const isBuyer = (ctx: Ctx) => ctx.company.type === "CUSTOMER" || ctx.company.type === "WHOLESALER";
const N = (v: unknown) => (v == null ? null : Number(v));
const admin = () => prisma.company.findFirst({ where: { type: "ADMIN" }, select: { id: true } });

// ── settings ────────────────────────────────────────────────────────────────

export async function dealSettings(): Promise<DealSettings> {
  const row = await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: KEY } });
  const v = (row?.value as Partial<DealSettings>) ?? {};
  const d = DEFAULT_DEAL_SETTINGS;
  return { ...d, ...v, kinds: { ...d.kinds, ...(v.kinds ?? {}) }, approval: { ...d.approval, ...(v.approval ?? {}) }, clearance: { ...d.clearance, ...(v.clearance ?? {}) }, bestOffer: { ...d.bestOffer, ...(v.bestOffer ?? {}) }, alerts: { ...d.alerts, ...(v.alerts ?? {}) } };
}

function staff(ctx: Ctx, manage = false) {
  if (ctx.company.type !== "ADMIN") throw new ForbiddenError();
  if (!can(ctx, manage ? ["admin.pricing.manage", "admin.marketing.manage", "admin.settings.manage"] : ["admin.pricing.view", "admin.pricing.manage", "admin.marketing.manage", "admin.settings.manage", "admin.vendors.view"])) throw new ForbiddenError();
}

export async function saveDealSettings(ctx: Ctx, input: DealSettings) {
  staff(ctx, true);
  const n = (x: number, lo: number, hi: number, label: string) => { if (!Number.isFinite(x) || x < lo || x > hi) throw new ValidationError(`${label} must be between ${lo} and ${hi}.`); return x; };
  const v: DealSettings = {
    kinds: Object.fromEntries(DEAL_KINDS.map((k) => [k, !!input.kinds?.[k]])) as Record<DealKindKey, boolean>,
    approval: { mode: input.approval.mode === "ALWAYS" ? "ALWAYS" : "AUTO", maxDiscountPct: n(input.approval.maxDiscountPct, 1, 95, "The largest discount approved by itself"), maxDays: Math.round(n(input.approval.maxDays, 1, 90, "The longest deal approved by itself")), trustedOnly: !!input.approval.trustedOnly },
    minDiscountPct: n(input.minDiscountPct, 0, 90, "The smallest discount"),
    maxDurationDays: Math.round(n(input.maxDurationDays, 1, 180, "The longest deal")),
    clearance: { expiryDays: Math.round(n(input.clearance.expiryDays, 1, 180, "The best-before window")), overstock: !!input.clearance.overstock, commissionPct: n(input.clearance.commissionPct, 0, 50, "The clearance commission") },
    bestOffer: { answerHours: Math.round(n(input.bestOffer.answerHours, 1, 168, "The time to answer an offer")), holdHours: Math.round(n(input.bestOffer.holdHours, 1, 336, "How long an accepted offer holds")) },
    alerts: { smart: !!input.alerts.smart, lookbackDays: Math.round(n(input.alerts.lookbackDays, 7, 730, "The 'bought before' window")), watch: !!input.alerts.watch, digest: !!input.alerts.digest, maxPerDay: Math.round(n(input.alerts.maxPerDay, 1, 20, "The alerts per day")) },
  };
  const before = await dealSettings();
  const row = await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: KEY } });
  if (row) await prisma.setting.update({ where: { id: row.id }, data: { value: v } });
  else await prisma.setting.create({ data: { scope: "GLOBAL", scopeId: "", key: KEY, value: v } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "deals.settings_saved", entityType: "Setting", entityId: KEY, before, after: v });
  return v;
}

/** Suppliers FIRINGI trusts (their deals start by themselves within the limits when "trusted only" is on). */
export async function isTrusted(vendorId: string) {
  return !!(await prisma.companyFeature.findFirst({ where: { companyId: vendorId, key: "DEALS_TRUSTED", enabled: true } }));
}
export async function setTrusted(ctx: Ctx, vendorId: string, on: boolean) {
  staff(ctx, true);
  await prisma.companyFeature.upsert({ where: { companyId_key: { companyId: vendorId, key: "DEALS_TRUSTED" } }, create: { companyId: vendorId, key: "DEALS_TRUSTED", enabled: on, updatedById: ctx.user.id }, update: { enabled: on, updatedById: ctx.user.id } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "deals.trusted", entityType: "Company", entityId: vendorId, after: { on } });
}

// ── facts about an offer ────────────────────────────────────────────────────

/** The supplier's base list price for an offer (the "was" price). */
export async function listPrice(offerId: string) {
  const p = await prisma.priceListItem.findFirst({ where: { offerId, minQty: { lte: 1 }, priceList: { scope: "BASE", isActive: true } }, orderBy: { minQty: "desc" }, select: { unitPriceNet: true } });
  return p ? Number(p.unitPriceNet) : null;
}

/** Why a deal on this offer is a clearance deal (short-dated lot / overstock), if it is. */
export async function clearanceOf(offerId: string, batchId: string | null, s: DealSettings) {
  const now = new Date();
  const soon = new Date(now.getTime() + s.clearance.expiryDays * DAY);
  const batches = await prisma.stockBatch.findMany({ where: { offerId, writtenOffAt: null, blockedAt: null, expiresOn: { not: null } }, select: { id: true, expiresOn: true, onHand: true, reserved: true, lotCode: true }, orderBy: { expiresOn: "asc" } });
  const lot = batchId ? batches.find((b) => b.id === batchId) : batches.find((b) => b.onHand - b.reserved > 0 && b.expiresOn! <= soon);
  if (batchId && !lot) throw new ValidationError("Choose one of this product's lots.");
  if (lot && lot.expiresOn! <= soon) return { clearance: true, reason: "EXPIRY" as const, bestBefore: lot.expiresOn, batchId: lot.id, lotUnits: lot.onHand - lot.reserved };
  if (s.clearance.overstock) {
    const stock = await prisma.stockLevel.aggregate({ where: { offerId }, _sum: { onHand: true, reserved: true } });
    const available = (stock._sum.onHand ?? 0) - (stock._sum.reserved ?? 0);
    const sold = await prisma.orderLine.aggregate({ where: { offerId, order: { placedAt: { gte: new Date(now.getTime() - 90 * DAY) }, status: { notIn: ["CANCELLED", "RETURNED"] } } }, _sum: { qtyOrdered: true } });
    const perDay = (sold._sum?.qtyOrdered ?? 0) / 90;
    // more than 60 days of cover at the last 90 days' pace (or stock that hasn't sold at all)
    if (available > 0 && (perDay === 0 || available / perDay > 60)) return { clearance: true, reason: "OVERSTOCK" as const, bestBefore: lot?.expiresOn ?? null, batchId: lot?.id ?? null, lotUnits: null };
  }
  return { clearance: false, reason: null, bestBefore: lot?.expiresOn ?? null, batchId: lot?.id ?? null, lotUnits: null };
}

/** For the supplier's form: the offer's list price, lots with dates, and whether it's clearance. */
export async function dealFormInfo(ctx: Ctx, offerId: string) {
  if (!isVendor(ctx)) throw new ForbiddenError();
  const offer = await prisma.vendorOffer.findFirst({ where: { id: offerId, vendorCompanyId: ctx.company.id }, select: { id: true } });
  if (!offer) throw new NotFoundError("Product");
  const s = await dealSettings();
  const [list, cl, lots, commission] = await Promise.all([
    listPrice(offerId), clearanceOf(offerId, null, s),
    prisma.stockBatch.findMany({ where: { offerId, writtenOffAt: null, blockedAt: null }, select: { id: true, lotCode: true, expiresOn: true, onHand: true, reserved: true }, orderBy: [{ expiresOn: "asc" }] }),
    (await import("@/server/services/orders")).activeCommission(prisma as unknown as Tx, ctx.company.id),
  ]);
  const usual = commission ? Number(commission.rate) : null;
  return {
    list, clearance: cl.clearance, reason: cl.reason, bestBefore: cl.bestBefore?.toISOString().slice(0, 10) ?? null,
    lots: lots.filter((l) => l.onHand - l.reserved > 0).map((l) => ({ id: l.id, lotCode: l.lotCode, expiresOn: l.expiresOn?.toISOString().slice(0, 10) ?? null, units: l.onHand - l.reserved })),
    usualCommission: usual, clearanceCommission: usual == null ? null : Math.min(usual, s.clearance.commissionPct),
  };
}

// ── suppliers ───────────────────────────────────────────────────────────────

export type DealInput = {
  offerId: string; kind: DealKindKey; title?: string | null; note?: string | null; startsAt: Date; endsAt: Date;
  maxQty?: number | null; perBuyerMax?: number | null; dealPrice?: number | null; bundleQty?: number | null; bundlePrice?: number | null;
  tiers?: Tier[] | null; lotPrice?: number | null; floorPrice?: number | null; minBidQty?: number | null; batchId?: string | null;
};

function check(i: DealInput, list: number, s: DealSettings) {
  if (!s.kinds[i.kind]) throw new ValidationError("FIRINGI doesn't offer this kind of deal right now.");
  if (!(i.endsAt > i.startsAt)) throw new ValidationError("The deal must end after it starts.");
  if (i.endsAt.getTime() - i.startsAt.getTime() > s.maxDurationDays * DAY + 60_000) throw new ValidationError(`A deal can last at most ${s.maxDurationDays} days.`);
  if (i.endsAt <= new Date()) throw new ValidationError("The end must be in the future.");
  const pos = (x: number | null | undefined, label: string) => { if (x == null || !(x > 0)) throw new ValidationError(`Enter ${label}.`); return x; };
  if (i.maxQty != null && (!Number.isInteger(i.maxQty) || i.maxQty < 1)) throw new ValidationError("The quantity on the deal must be a whole number.");
  if (i.perBuyerMax != null && (!Number.isInteger(i.perBuyerMax) || i.perBuyerMax < 1)) throw new ValidationError("The limit per buyer must be a whole number.");
  const terms: DealTerms = { kind: i.kind };
  switch (i.kind) {
    case "FLASH": terms.dealPrice = pos(i.dealPrice, "the deal price"); break;
    case "BUNDLE": terms.bundleQty = Math.round(pos(i.bundleQty, "how many units make a pack")); terms.bundlePrice = pos(i.bundlePrice, "the pack price"); if (terms.bundleQty < 2) throw new ValidationError("A pack has at least 2 units."); break;
    case "VOLUME": {
      const t = (i.tiers ?? []).filter((x) => x.minQty > 0 && x.unitPrice > 0).map((x) => ({ minQty: Math.round(x.minQty), unitPrice: x.unitPrice })).sort((a, b) => a.minQty - b.minQty);
      if (!t.length) throw new ValidationError("Add at least one quantity tier.");
      for (let k = 1; k < t.length; k++) if (!(t[k].minQty > t[k - 1].minQty && t[k].unitPrice < t[k - 1].unitPrice)) throw new ValidationError("Each tier needs a larger quantity and a lower price than the one before.");
      terms.tiers = t; break;
    }
    case "LOT": terms.maxQty = Math.round(pos(i.maxQty, "the units in the lot")); terms.lotPrice = pos(i.lotPrice, "the price of the whole lot"); break;
    case "BEST_OFFER": if (i.floorPrice != null && !(i.floorPrice > 0 && i.floorPrice < list)) throw new ValidationError("The lowest price you accept must be below the list price."); break;
  }
  const best = bestDealUnit(terms, list);
  const pct = i.kind === "BEST_OFFER" ? (i.floorPrice ? discountPct(i.floorPrice, list) : null) : discountPct(best, list);
  if (i.kind !== "BEST_OFFER" && (pct == null || pct < s.minDiscountPct)) throw new ValidationError(`A deal must be at least ${s.minDiscountPct} % below the list price (${list.toFixed(2)} €).`);
  return { terms, pct };
}

export async function createDeal(ctx: Ctx, i: DealInput, submit = true) {
  if (!isVendor(ctx) || !can(ctx, ["vendor.promotions.manage", "vendor.pricing.manage"])) throw new ForbiddenError();
  const s = await dealSettings();
  const offer = await prisma.vendorOffer.findFirst({ where: { id: i.offerId, vendorCompanyId: ctx.company.id }, select: { id: true, status: true } });
  if (!offer) throw new NotFoundError("Product");
  if (offer.status !== "ACTIVE") throw new ValidationError("Only active products can be put on a deal.");
  const list = await listPrice(offer.id);
  if (!list) throw new ValidationError("This product has no list price.");
  const { terms, pct } = check(i, list, s);
  const cl = await clearanceOf(offer.id, i.batchId ?? null, s);
  if (i.kind === "LOT" && cl.lotUnits != null && terms.maxQty! > cl.lotUnits) throw new ValidationError(`The lot has ${cl.lotUnits} units available.`);
  const overlap = await prisma.clearanceDeal.findFirst({ where: { offerId: offer.id, status: { in: ["PENDING", "APPROVED"] }, startsAt: { lt: i.endsAt }, endsAt: { gt: i.startsAt } } });
  if (overlap) throw new ValidationError(`This product already has a deal at that time (${overlap.number}).`);
  const commission = await (await import("@/server/services/orders")).activeCommission(prisma as unknown as Tx, ctx.company.id);
  const usual = commission ? Number(commission.rate) : null;
  // auto-approval within FIRINGI's limits
  const days = (i.endsAt.getTime() - i.startsAt.getTime()) / DAY;
  const trustedOk = !s.approval.trustedOnly || (await isTrusted(ctx.company.id));
  const within = s.approval.mode === "AUTO" && trustedOk && days <= s.approval.maxDays + 0.001 && (i.kind === "BEST_OFFER" || (pct ?? 0) <= s.approval.maxDiscountPct);
  const deal = await prisma.$transaction(async (tx) => {
    const { nextNumber } = await import("@/server/services/orders");
    return tx.clearanceDeal.create({
      data: {
        number: await nextNumber(tx, "deal", "DL"), vendorCompanyId: ctx.company.id, offerId: offer.id, kind: i.kind as ClearanceKind,
        status: !submit ? "DRAFT" : within ? "APPROVED" : "PENDING", autoApproved: submit && within, reviewedAt: submit && within ? new Date() : null,
        title: i.title?.trim().slice(0, 80) || null, note: i.note?.trim().slice(0, 200) || null, startsAt: i.startsAt, endsAt: i.endsAt,
        maxQty: terms.maxQty ?? i.maxQty ?? null, perBuyerMax: i.perBuyerMax ?? null, dealPrice: terms.dealPrice ?? null, bundleQty: terms.bundleQty ?? null, bundlePrice: terms.bundlePrice ?? null,
        tiers: (terms.tiers ?? undefined) as unknown as Prisma.InputJsonValue, lotPrice: terms.lotPrice ?? null, floorPrice: i.kind === "BEST_OFFER" ? i.floorPrice ?? null : null, minBidQty: i.kind === "BEST_OFFER" ? i.minBidQty ?? null : null,
        batchId: cl.batchId, bestBefore: cl.bestBefore, clearance: cl.clearance, clearanceReason: cl.reason,
        commissionPct: cl.clearance && usual != null ? Math.min(usual, s.clearance.commissionPct) : null,
        listPriceAt: list, discountPct: pct, createdById: ctx.user.id,
      },
    });
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: deal.autoApproved ? "deals.created_auto_approved" : "deals.created", entityType: "ClearanceDeal", entityId: deal.id, after: { number: deal.number, kind: deal.kind, pct, clearance: deal.clearance } });
  if (deal.status === "PENDING") {
    const a = await admin();
    if (a) await notify("deal.review", [{ companyId: a.id, link: "/admin/pricing/deals" }], { company: ctx.company.tradeName ?? ctx.company.legalName, number: deal.number }).catch(() => null);
  }
  if (deal.status === "APPROVED" && deal.startsAt <= new Date()) await alertDeal(deal.id).catch(() => null);
  return deal;
}

export async function cancelDeal(ctx: Ctx, id: string) {
  const d = await prisma.clearanceDeal.findFirst({ where: { id, ...(ctx.company.type === "ADMIN" ? {} : { vendorCompanyId: ctx.company.id }) } });
  if (!d) throw new NotFoundError("Deal");
  if (ctx.company.type === "ADMIN") staff(ctx, true);
  else if (!can(ctx, ["vendor.promotions.manage", "vendor.pricing.manage"])) throw new ForbiddenError();
  if (!["DRAFT", "PENDING", "APPROVED"].includes(d.status)) throw new ValidationError("This deal has already ended.");
  await prisma.$transaction(async (tx) => {
    await tx.clearanceDeal.update({ where: { id: d.id }, data: { status: d.status === "APPROVED" && d.startsAt <= new Date() ? "ENDED" : "CANCELLED", endsAt: d.startsAt <= new Date() ? new Date() : d.endsAt } });
    await tx.clearanceBid.updateMany({ where: { dealId: d.id, status: { in: ["PENDING", "COUNTERED"] } }, data: { status: "EXPIRED", decidedAt: new Date() } });
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: ctx.company.type === "ADMIN" ? "deals.stopped" : "deals.cancelled", entityType: "ClearanceDeal", entityId: d.id });
}

/** Units sold on deals (orders not cancelled), per deal — and per buyer when asked. */
export async function soldOn(dealIds: string[], buyerCompanyId?: string, db: Tx | typeof prisma = prisma) {
  if (!dealIds.length) return new Map<string, number>();
  const rows = await db.orderLine.groupBy({ by: ["dealId"], where: { dealId: { in: dealIds }, order: { status: { notIn: ["CANCELLED", "RETURNED"] }, ...(buyerCompanyId ? { buyerCompanyId } : {}) } }, _sum: { qtyOrdered: true } });
  return new Map(rows.map((r) => [r.dealId!, r._sum.qtyOrdered ?? 0]));
}

export async function vendorDeals(ctx: Ctx) {
  if (!isVendor(ctx)) throw new ForbiddenError();
  const deals = await prisma.clearanceDeal.findMany({
    where: { vendorCompanyId: ctx.company.id }, orderBy: { createdAt: "desc" }, take: 200,
    include: { offer: { select: { packaging: { select: { name: true, variant: { select: { sku: true, product: { select: { name: true } } } } } } } }, bids: { where: { status: { in: ["PENDING", "COUNTERED", "ACCEPTED"] } }, include: { buyer: { select: { legalName: true, tradeName: true } } }, orderBy: { createdAt: "desc" } } },
  });
  const sold = await soldOn(deals.map((d) => d.id));
  const rev = await prisma.orderLine.groupBy({ by: ["dealId"], where: { dealId: { in: deals.map((d) => d.id) }, order: { status: { notIn: ["CANCELLED", "RETURNED"] } } }, _sum: { lineNet: true } });
  return deals.map((d) => ({ ...d, sold: sold.get(d.id) ?? 0, revenue: Number(rev.find((r) => r.dealId === d.id)?._sum.lineNet ?? 0) }));
}

// ── FIRINGI ─────────────────────────────────────────────────────────────────

export async function adminDeals(ctx: Ctx, f: { status?: string } = {}) {
  staff(ctx);
  const where: Prisma.ClearanceDealWhereInput = f.status === "PENDING" ? { status: "PENDING" } : f.status === "LIVE" ? { status: "APPROVED", endsAt: { gt: new Date() } } : f.status === "ENDED" ? { status: { in: ["ENDED", "SOLD_OUT", "CANCELLED", "REJECTED"] } } : {};
  const deals = await prisma.clearanceDeal.findMany({
    where, orderBy: [{ status: "asc" }, { createdAt: "desc" }], take: 300,
    include: { vendor: { select: { id: true, legalName: true, tradeName: true } }, offer: { select: { packaging: { select: { variant: { select: { sku: true, product: { select: { name: true } } } } } } } } },
  });
  const sold = await soldOn(deals.map((d) => d.id));
  const lines = await prisma.orderLine.groupBy({ by: ["dealId"], where: { dealId: { in: deals.map((d) => d.id) }, order: { status: { notIn: ["CANCELLED", "RETURNED"] } } }, _sum: { lineNet: true, commissionAmount: true } });
  const trusted = new Set((await prisma.companyFeature.findMany({ where: { key: "DEALS_TRUSTED", enabled: true }, select: { companyId: true } })).map((x) => x.companyId));
  return deals.map((d) => {
    const l = lines.find((x) => x.dealId === d.id);
    return { ...d, sold: sold.get(d.id) ?? 0, revenue: Number(l?._sum.lineNet ?? 0), commission: Number(l?._sum.commissionAmount ?? 0), trusted: trusted.has(d.vendorCompanyId) };
  });
}

export async function reviewDeal(ctx: Ctx, id: string, approve: boolean, note: string | null, commissionPct?: number | null) {
  staff(ctx, true);
  const d = await prisma.clearanceDeal.findUnique({ where: { id } });
  if (!d) throw new NotFoundError("Deal");
  if (d.status !== "PENDING") throw new ValidationError("This deal isn't waiting for a decision.");
  if (!approve && !note?.trim()) throw new ValidationError("Say why (the supplier sees it).");
  if (commissionPct != null && !(commissionPct >= 0 && commissionPct <= 50)) throw new ValidationError("The commission must be between 0 and 50 %.");
  const u = await prisma.clearanceDeal.update({
    where: { id }, data: { status: approve ? "APPROVED" : "REJECTED", reviewNote: note?.trim() || null, reviewedById: ctx.user.id, reviewedAt: new Date(), ...(approve && commissionPct !== undefined ? { commissionPct } : {}) },
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: approve ? "deals.approved" : "deals.rejected", entityType: "ClearanceDeal", entityId: id, after: { note, commissionPct: u.commissionPct?.toString() ?? null } });
  await notify(approve ? "deal.approved" : "deal.rejected", [{ companyId: d.vendorCompanyId, link: "/vendor/products/deals" }], { number: d.number, reason: note ?? "" }).catch(() => null);
  if (approve && u.startsAt <= new Date()) await alertDeal(u.id).catch(() => null);
  return u;
}

export async function dealsOverview(ctx: Ctx) {
  staff(ctx);
  const now = new Date();
  const [pending, live, lines] = await Promise.all([
    prisma.clearanceDeal.count({ where: { status: "PENDING" } }),
    prisma.clearanceDeal.count({ where: { status: "APPROVED", startsAt: { lte: now }, endsAt: { gt: now } } }),
    prisma.orderLine.aggregate({ where: { dealId: { not: null }, order: { placedAt: { gte: new Date(now.getTime() - 30 * DAY) }, status: { notIn: ["CANCELLED", "RETURNED"] } } }, _sum: { lineNet: true, commissionAmount: true, qtyOrdered: true } }),
  ]);
  return { pending, live, revenue30: Number(lines._sum?.lineNet ?? 0), commission30: Number(lines._sum?.commissionAmount ?? 0), units30: lines._sum?.qtyOrdered ?? 0 };
}

// ── buyers ──────────────────────────────────────────────────────────────────

const liveWhere = (now = new Date()): Prisma.ClearanceDealWhereInput => ({ status: "APPROVED", startsAt: { lte: now }, endsAt: { gt: now } });

/** Live deals the buyer can see, priced for it (badges, Deals page, product page). */
export async function liveDeals(ctx: Ctx, f: { offerIds?: string[]; categoryId?: string | null; q?: string | null } = {}) {
  if (!isBuyer(ctx)) return [];
  const deals = await prisma.clearanceDeal.findMany({ where: { ...liveWhere(), ...(f.offerIds ? { offerId: { in: f.offerIds } } : {}) }, orderBy: { endsAt: "asc" }, take: 300 });
  if (!deals.length) return [];
  const { presentOffers } = await import("@/server/data/catalogue-buyer");
  const offers = await presentOffers(ctx, [...new Set(deals.map((d) => d.offerId))], { matching: f.q ?? null, categoryIds: f.categoryId ? [f.categoryId] : null });
  const byOffer = new Map(offers.map((o) => [o.offerId, o]));
  const [sold, mine, bids] = await Promise.all([
    soldOn(deals.map((d) => d.id)), soldOn(deals.map((d) => d.id), ctx.company.id),
    prisma.clearanceBid.findMany({ where: { dealId: { in: deals.map((d) => d.id) }, buyerCompanyId: ctx.company.id, status: { in: ["PENDING", "ACCEPTED", "COUNTERED"] } }, orderBy: { createdAt: "desc" } }),
  ]);
  const out = [];
  for (const d of deals) {
    const o = byOffer.get(d.offerId);
    if (!o?.price) continue;
    const left = d.maxQty == null ? null : Math.max(0, d.maxQty - (sold.get(d.id) ?? 0));
    if (left === 0) continue;
    const list = Number(o.price.listUnitNet);
    const terms = termsOf(d);
    const best = d.kind === "BEST_OFFER" ? null : bestDealUnit(terms, list);
    if (d.kind !== "BEST_OFFER" && !(best != null && best < list)) continue; // the buyer's own price is already lower
    out.push({
      id: d.id, number: d.number, kind: d.kind as DealKindKey, title: d.title, note: d.note, startsAt: d.startsAt, endsAt: d.endsAt, left, perBuyerMax: d.perBuyerMax, boughtByMe: mine.get(d.id) ?? 0,
      bestBefore: d.bestBefore, clearance: d.clearance, listUnit: list, bestUnit: best, pct: discountPct(best, list), terms, minBidQty: d.minBidQty,
      offer: o, bid: bids.find((b) => b.dealId === d.id) ?? null,
    });
  }
  return out;
}

const termsOf = (d: { kind: string; dealPrice: unknown; bundleQty: number | null; bundlePrice: unknown; tiers: unknown; maxQty: number | null; lotPrice: unknown }): DealTerms => ({
  kind: d.kind as DealKindKey, dealPrice: N(d.dealPrice), bundleQty: d.bundleQty, bundlePrice: N(d.bundlePrice), tiers: (d.tiers as Tier[] | null) ?? null, maxQty: d.maxQty, lotPrice: N(d.lotPrice),
});

/**
 * Deal prices for cart lines (used by checkout pricing). For each line on a live deal: the unit price,
 * the commission and the deal / bid — or why it doesn't apply (the line keeps its normal price).
 */
export async function dealPricing(buyerCompanyId: string, lines: { offerId: string; qty: number; listUnit: number }[], db: Tx | typeof prisma = prisma) {
  const out = new Map<string, { dealId: string; bidId: string | null; unit: number; commissionPct: number | null; kind: DealKindKey } | { dealId: string; why: string; left?: number | null }>();
  if (!lines.length) return out;
  const deals = await db.clearanceDeal.findMany({ where: { ...liveWhere(), offerId: { in: lines.map((l) => l.offerId) } } });
  if (!deals.length) return out;
  const [sold, mine, bids] = await Promise.all([
    soldOn(deals.map((d) => d.id), undefined, db), soldOn(deals.map((d) => d.id), buyerCompanyId, db),
    db.clearanceBid.findMany({ where: { dealId: { in: deals.map((d) => d.id) }, buyerCompanyId, status: "ACCEPTED", expiresAt: { gt: new Date() } }, orderBy: { decidedAt: "desc" } }),
  ]);
  for (const l of lines) {
    const d = deals.find((x) => x.offerId === l.offerId);
    if (!d) continue;
    const left = d.maxQty == null ? null : d.maxQty - (sold.get(d.id) ?? 0);
    if (left != null && l.qty > left) { out.set(l.offerId, { dealId: d.id, why: "LEFT", left: Math.max(0, left) }); continue; }
    if (d.perBuyerMax != null && (mine.get(d.id) ?? 0) + l.qty > d.perBuyerMax) { out.set(l.offerId, { dealId: d.id, why: "PER_BUYER", left: Math.max(0, d.perBuyerMax - (mine.get(d.id) ?? 0)) }); continue; }
    const commissionPct = d.commissionPct == null ? null : Number(d.commissionPct);
    if (d.kind === "BEST_OFFER") {
      const b = bids.find((x) => x.dealId === d.id);
      if (!b) continue;
      if (l.qty !== b.qty) { out.set(l.offerId, { dealId: d.id, why: "BID_QTY", left: b.qty }); continue; }
      out.set(l.offerId, { dealId: d.id, bidId: b.id, unit: Number(b.counterPrice ?? b.unitPrice), commissionPct, kind: "BEST_OFFER" });
      continue;
    }
    const p = dealUnitPrice(termsOf(d), l.qty, l.listUnit);
    if (!p.ok) { out.set(l.offerId, { dealId: d.id, why: p.reason }); continue; }
    out.set(l.offerId, { dealId: d.id, bidId: null, unit: p.unit, commissionPct, kind: d.kind as DealKindKey });
  }
  return out;
}

/** After an order is placed (inside its transaction): lots sold out, bids used. */
export async function afterDealOrder(tx: Tx, orderId: string) {
  const lines = await tx.orderLine.findMany({ where: { orderId, dealId: { not: null } }, select: { dealId: true, dealBidId: true } });
  for (const l of lines) {
    const d = await tx.clearanceDeal.findUniqueOrThrow({ where: { id: l.dealId! } });
    if (d.maxQty != null && ((await soldOn([d.id], undefined, tx)).get(d.id) ?? 0) >= d.maxQty) await tx.clearanceDeal.update({ where: { id: d.id }, data: { status: "SOLD_OUT" } });
    if (l.dealBidId) await tx.clearanceBid.update({ where: { id: l.dealBidId }, data: { status: "ORDERED", orderId } });
  }
}

// ── best offer ──────────────────────────────────────────────────────────────

export async function placeBid(ctx: Ctx, dealId: string, qty: number, unitPrice: number, message: string | null) {
  if (!isBuyer(ctx) || ctx.company.status !== "APPROVED" || !can(ctx, "buyer.orders.place")) throw new ForbiddenError();
  const [d] = (await liveDeals(ctx, {})).filter((x) => x.id === dealId);
  if (!d || d.kind !== "BEST_OFFER") throw new NotFoundError("Deal");
  if (!Number.isInteger(qty) || qty < Math.max(1, d.minBidQty ?? 1)) throw new ValidationError(`Offer for at least ${Math.max(1, d.minBidQty ?? 1)} units.`);
  if (d.left != null && qty > d.left) throw new ValidationError(`Only ${d.left} units are on this deal.`);
  if (!(unitPrice > 0) || unitPrice >= d.listUnit) throw new ValidationError("Offer a price below the current price.");
  if (await prisma.clearanceBid.findFirst({ where: { dealId, buyerCompanyId: ctx.company.id, status: { in: ["PENDING", "COUNTERED", "ACCEPTED"] } } })) throw new ValidationError("You already have an offer on this deal.");
  const s = await dealSettings();
  const deal = await prisma.clearanceDeal.findUniqueOrThrow({ where: { id: dealId } });
  const floor = N(deal.floorPrice);
  // at or above the supplier's floor → accepted at once
  const auto = floor != null && unitPrice >= floor;
  const bid = await prisma.clearanceBid.create({
    data: {
      dealId, buyerCompanyId: ctx.company.id, userId: ctx.user.id, qty, unitPrice: unitPrice.toFixed(4), message: message?.trim().slice(0, 300) || null,
      status: auto ? "ACCEPTED" : "PENDING", decidedAt: auto ? new Date() : null,
      expiresAt: new Date(Date.now() + (auto ? s.bestOffer.holdHours : s.bestOffer.answerHours) * 3_600_000),
    },
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "deals.bid", entityType: "ClearanceBid", entityId: bid.id, after: { deal: deal.number, qty, unitPrice, auto } });
  if (!auto) await notify("deal.bid", [{ companyId: deal.vendorCompanyId, link: "/vendor/products/deals" }], { number: deal.number, qty, price: unitPrice.toFixed(2) }).catch(() => null);
  return bid;
}

export async function answerBid(ctx: Ctx, bidId: string, decision: "ACCEPT" | "REJECT" | "COUNTER", counterPrice?: number | null) {
  if (!isVendor(ctx) || !can(ctx, ["vendor.promotions.manage", "vendor.pricing.manage"])) throw new ForbiddenError();
  const b = await prisma.clearanceBid.findFirst({ where: { id: bidId, deal: { vendorCompanyId: ctx.company.id } }, include: { deal: true } });
  if (!b) throw new NotFoundError("Offer");
  if (b.status !== "PENDING") throw new ValidationError("This offer was already answered.");
  if (decision === "COUNTER" && !(counterPrice != null && counterPrice > Number(b.unitPrice) && counterPrice < Number(b.deal.listPriceAt ?? Infinity))) throw new ValidationError("Your counter-offer must be between their offer and the list price.");
  const s = await dealSettings();
  const status = decision === "ACCEPT" ? "ACCEPTED" : decision === "REJECT" ? "REJECTED" : "COUNTERED";
  await prisma.clearanceBid.update({ where: { id: b.id }, data: { status, counterPrice: decision === "COUNTER" ? counterPrice!.toFixed(4) : null, decidedAt: new Date(), decidedById: ctx.user.id, expiresAt: new Date(Date.now() + s.bestOffer.holdHours * 3_600_000) } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: `deals.bid_${status.toLowerCase()}`, entityType: "ClearanceBid", entityId: b.id, after: { counterPrice } });
  const price = decision === "COUNTER" ? counterPrice!.toFixed(2) : Number(b.unitPrice).toFixed(2);
  await notify(`deal.bid_${status.toLowerCase()}`, [{ userId: b.userId, link: "/buy/catalogue/clearance" }], { number: b.deal.number, price }).catch(() => null);
}

/** The buyer takes the supplier's counter-offer (or withdraws its own offer). */
export async function respondToCounter(ctx: Ctx, bidId: string, accept: boolean) {
  if (!isBuyer(ctx)) throw new ForbiddenError();
  const b = await prisma.clearanceBid.findFirst({ where: { id: bidId, buyerCompanyId: ctx.company.id } });
  if (!b) throw new NotFoundError("Offer");
  if (accept && b.status !== "COUNTERED") throw new ValidationError("There's no counter-offer to accept.");
  if (!accept && !["PENDING", "COUNTERED", "ACCEPTED"].includes(b.status)) throw new ValidationError("This offer is closed.");
  if (accept && b.expiresAt < new Date()) throw new ValidationError("The counter-offer has expired.");
  const s = await dealSettings();
  await prisma.clearanceBid.update({ where: { id: b.id }, data: accept ? { status: "ACCEPTED", unitPrice: b.counterPrice!, expiresAt: new Date(Date.now() + s.bestOffer.holdHours * 3_600_000) } : { status: "WITHDRAWN", decidedAt: new Date() } });
}

export async function myBids(ctx: Ctx) {
  if (!isBuyer(ctx)) return [];
  return prisma.clearanceBid.findMany({ where: { buyerCompanyId: ctx.company.id }, orderBy: { createdAt: "desc" }, take: 50, include: { deal: { select: { number: true, offerId: true, listPriceAt: true, offer: { select: { packaging: { select: { variant: { select: { product: { select: { name: true } } } } } } } } } } } });
}

// ── watchlist & digest ──────────────────────────────────────────────────────

export async function watch(ctx: Ctx, w: { kind: "PRODUCT" | "CATEGORY" | "SUPPLIER"; id: string }, on: boolean) {
  if (!isBuyer(ctx)) throw new ForbiddenError();
  const where = { userId: ctx.user.id, kind: w.kind, productId: w.kind === "PRODUCT" ? w.id : null, categoryId: w.kind === "CATEGORY" ? w.id : null, vendorCompanyId: w.kind === "SUPPLIER" ? w.id : null };
  const existing = await prisma.clearanceWatch.findFirst({ where });
  if (on && !existing) await prisma.clearanceWatch.create({ data: { ...where, buyerCompanyId: ctx.company.id } });
  if (!on && existing) await prisma.clearanceWatch.delete({ where: { id: existing.id } });
}

export async function myWatches(ctx: Ctx) {
  if (!isBuyer(ctx)) return [];
  const rows = await prisma.clearanceWatch.findMany({ where: { userId: ctx.user.id }, orderBy: { createdAt: "desc" } });
  const [products, categories, vendors] = await Promise.all([
    prisma.product.findMany({ where: { id: { in: rows.map((r) => r.productId).filter((x): x is string => !!x) } }, select: { id: true, name: true } }),
    prisma.category.findMany({ where: { id: { in: rows.map((r) => r.categoryId).filter((x): x is string => !!x) } }, select: { id: true, name: true } }),
    prisma.company.findMany({ where: { id: { in: rows.map((r) => r.vendorCompanyId).filter((x): x is string => !!x) } }, select: { id: true, legalName: true, tradeName: true } }),
  ]);
  return rows.map((r) => ({
    id: r.id, kind: r.kind, targetId: r.productId ?? r.categoryId ?? r.vendorCompanyId ?? "",
    name: r.productId ? (products.find((p) => p.id === r.productId)?.name as Record<string, string> | undefined) ?? null : r.categoryId ? (categories.find((c) => c.id === r.categoryId)?.name as Record<string, string> | undefined) ?? null : null,
    supplier: r.vendorCompanyId ? vendors.find((v) => v.id === r.vendorCompanyId)?.tradeName ?? vendors.find((v) => v.id === r.vendorCompanyId)?.legalName ?? null : null,
  }));
}

export async function setDigest(ctx: Ctx, on: boolean) {
  if (!isBuyer(ctx)) throw new ForbiddenError();
  if (on) await prisma.clearanceDigestOptIn.upsert({ where: { userId: ctx.user.id }, create: { userId: ctx.user.id, buyerCompanyId: ctx.company.id }, update: {} });
  else await prisma.clearanceDigestOptIn.deleteMany({ where: { userId: ctx.user.id } });
}
export const digestOn = async (userId: string) => !!(await prisma.clearanceDigestOptIn.findUnique({ where: { userId } }));

// ── alerts ──────────────────────────────────────────────────────────────────

/**
 * A deal went live: tell buyers who bought the product before (smart — unless they switched
 * "Offers & news" off) and people watching the product, its category or the supplier. One alert per
 * deal and person; at most `maxPerDay` deal alerts a day per person.
 */
export async function alertDeal(dealId: string, now = new Date()) {
  const s = await dealSettings();
  const d = await prisma.clearanceDeal.findUnique({ where: { id: dealId }, include: { offer: { select: { sellerType: true, countryId: true, packaging: { select: { variant: { select: { productId: true, product: { select: { name: true, categoryId: true } } } } } } } }, vendor: { select: { legalName: true, tradeName: true } } } });
  if (!d || d.status !== "APPROVED" || d.startsAt > now || d.endsAt <= now || d.alertedAt) return 0;
  await prisma.clearanceDeal.update({ where: { id: d.id }, data: { alertedAt: now } });
  const productId = d.offer.packaging.variant.productId;
  const buyerType = d.offer.sellerType === "DISTRIBUTOR" ? "WHOLESALER" : "CUSTOMER";
  const people = new Map<string, "SMART" | "WATCH">();
  if (s.alerts.watch) {
    const w = await prisma.clearanceWatch.findMany({ where: { OR: [{ kind: "PRODUCT", productId }, { kind: "CATEGORY", categoryId: d.offer.packaging.variant.product.categoryId }, { kind: "SUPPLIER", vendorCompanyId: d.vendorCompanyId }] }, select: { userId: true } });
    for (const x of w) people.set(x.userId, "WATCH");
  }
  if (s.alerts.smart) {
    const since = new Date(now.getTime() - s.alerts.lookbackDays * DAY);
    const buyers = await prisma.order.findMany({ where: { placedAt: { gte: since }, status: { notIn: ["CANCELLED", "RETURNED"] }, lines: { some: { offer: { packaging: { variant: { productId } } } } }, buyer: { type: buyerType, countryId: d.offer.countryId } }, select: { placedByUserId: true }, distinct: ["placedByUserId"] });
    const optedOut = new Set((await prisma.notificationPreference.findMany({ where: { userId: { in: buyers.map((b) => b.placedByUserId) }, category: "marketing", enabled: false }, select: { userId: true } })).map((x) => x.userId));
    for (const b of buyers) if (!optedOut.has(b.placedByUserId) && !people.has(b.placedByUserId)) people.set(b.placedByUserId, "SMART");
  }
  const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
  const product = (d.offer.packaging.variant.product.name as Record<string, string>);
  let sent = 0;
  for (const [userId, reason] of people) {
    const today = await prisma.clearanceAlert.count({ where: { userId, reason: { in: ["SMART", "WATCH"] }, createdAt: { gte: dayStart } } });
    if (today >= s.alerts.maxPerDay) continue;
    try { await prisma.clearanceAlert.create({ data: { dealId: d.id, userId, reason } }); } catch { continue; } // already told
    const pct = d.discountPct ? `${Number(d.discountPct).toFixed(0)}` : "";
    await notify("deal.alert", [{ userId, link: "/buy/catalogue/clearance" }], { product: product.pt ?? product.en ?? Object.values(product)[0] ?? "", supplier: d.vendor.tradeName ?? d.vendor.legalName, pct, until: d.endsAt.toISOString().slice(0, 10) }, { ref: { type: "ClearanceDeal", id: d.id } }).catch(() => null);
    sent++;
  }
  return sent;
}

/** Daily: end finished deals, expire offers, alert deals that just started, send the digest. */
export async function runDealsJob(now = new Date()) {
  const s = await dealSettings();
  const ended = await prisma.clearanceDeal.updateMany({ where: { status: "APPROVED", endsAt: { lte: now } }, data: { status: "ENDED" } });
  const expired = await prisma.clearanceBid.updateMany({ where: { status: { in: ["PENDING", "COUNTERED", "ACCEPTED"] }, expiresAt: { lte: now } }, data: { status: "EXPIRED" } });
  const starting = await prisma.clearanceDeal.findMany({ where: { ...liveWhere(now), alertedAt: null }, select: { id: true } });
  let alerts = 0;
  for (const d of starting) alerts += await alertDeal(d.id, now);
  let digests = 0;
  if (s.alerts.digest) {
    const day = now.toISOString().slice(0, 10);
    const optIns = await prisma.clearanceDigestOptIn.findMany();
    const live = await prisma.clearanceDeal.findMany({ where: { ...liveWhere(now), createdAt: { gte: new Date(now.getTime() - 2 * DAY) } }, include: { offer: { select: { sellerType: true, countryId: true, packaging: { select: { variant: { select: { product: { select: { name: true } } } } } } } } }, orderBy: { discountPct: "desc" } });
    for (const o of optIns) {
      const buyer = await prisma.company.findUnique({ where: { id: o.buyerCompanyId }, select: { type: true, countryId: true } });
      const mine = live.filter((d) => (d.offer.sellerType === "DISTRIBUTOR" ? "WHOLESALER" : "CUSTOMER") === buyer?.type && d.offer.countryId === buyer?.countryId);
      if (!mine.length) continue;
      try { await prisma.clearanceAlert.create({ data: { userId: o.userId, reason: "DIGEST", day } }); } catch { continue; }
      const names = mine.slice(0, 3).map((d) => { const n = d.offer.packaging.variant.product.name as Record<string, string>; return n.pt ?? n.en ?? Object.values(n)[0]; }).join(", ");
      await notify("deal.digest", [{ userId: o.userId, link: "/buy/catalogue/clearance" }], { count: mine.length, products: names }).catch(() => null);
      digests++;
    }
  }
  return { ended: ended.count, bidsExpired: expired.count, alerts, digests };
}

export type { DealKindKey };

/** Badges for product cards: live deals on these offers (best discount, end). */
export async function dealBadges(offerIds: string[]) {
  if (!offerIds.length) return new Map<string, { pct: number | null; endsAt: Date; kind: string }>();
  const rows = await prisma.clearanceDeal.findMany({ where: { ...liveWhere(), offerId: { in: offerIds } }, select: { offerId: true, discountPct: true, endsAt: true, kind: true } });
  return new Map(rows.map((r) => [r.offerId, { pct: r.discountPct == null ? null : Number(r.discountPct), endsAt: r.endsAt, kind: r.kind as string }]));
}

/** The supplier's active products to put on a deal. */
export async function vendorDealOffers(ctx: Ctx) {
  if (!isVendor(ctx)) throw new ForbiddenError();
  const rows = await prisma.vendorOffer.findMany({ where: { vendorCompanyId: ctx.company.id, status: "ACTIVE" }, select: { id: true, vendorSku: true, packaging: { select: { name: true, variant: { select: { sku: true, product: { select: { name: true } } } } } } }, take: 1000 });
  return rows.map((r) => ({ id: r.id, name: r.packaging.variant.product.name as Record<string, string>, packaging: r.packaging.name as Record<string, string>, sku: r.vendorSku ?? r.packaging.variant.sku }));
}
