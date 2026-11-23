import "server-only";
/**
 * Pre-order campaigns (Phase 71). Distributors and wholesalers open a campaign (seasonal, launch, short supply) with an
 * order window, delivery dates, tier prices and an optional deposit; FIRINGI approves it (or campaigns open straight
 * away); buyers of the matching type pre-order; at the close, unpaid deposits lapse, the final tier price is set and
 * short supply is shared by the campaign's rule; buyers given less confirm or decline; orders are placed at the final
 * price before each delivery date. Commission stays hidden from buyers; FIRINGI invoices the buyer as usual.
 */
import { prisma } from "@/server/db";
import type { Prisma } from "@prisma/client";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";
import { notify } from "@/server/notify/dispatch";
import { CAMPAIGN_KINDS, ALLOCATION_RULES, allocate, buyerTypeFor, cleanTiers, depositFor, isOpen, nextTier, tierPrice, type Tier } from "@/lib/preorders";
import { ADMIN_VIEW, preSettings, sellerOn, sellerTypeForBuyer } from "./settings";
import { asBuyer, asSeller, buyerCtx, days, depositRequest, depositState, listPrices, nameOf, nextNo, num, offerInfo } from "./common";

const ACTIVE_RES = ["PLACED", "ALLOCATED", "CONFIRMED"];
const EDITABLE = ["DRAFT", "REJECTED"];
export type CampaignInput = {
  kind: string; title: string; description?: string | null; opensAt: Date; closesAt: Date; deliveryDates: Date[];
  allocation: string; depositPct: number;
  items: { offerId: string; unitNet: number; tiers?: Tier[]; minQty?: number; maxQty?: number | null; supplyQty?: number | null }[];
};

// ── supplier ────────────────────────────────────────────────────────────────

export async function saveCampaign(ctx: Ctx, i: CampaignInput, id?: string | null) {
  const s = await asSeller(ctx, "campaigns");
  if (!CAMPAIGN_KINDS.includes(i.kind as never) || !s.kinds[i.kind as (typeof CAMPAIGN_KINDS)[number]]) throw new ValidationError("This kind of pre-order is not available.");
  if (!ALLOCATION_RULES.includes(i.allocation as never)) throw new ValidationError("Choose how short supply is shared.");
  const title = i.title.trim().slice(0, 120);
  if (title.length < 3) throw new ValidationError("Give the pre-order a title.");
  if (!(i.closesAt > i.opensAt)) throw new ValidationError("The pre-order must close after it opens.");
  if (i.closesAt.getTime() - i.opensAt.getTime() > days(s.maxCampaignDays)) throw new ValidationError(`A pre-order can be open for at most ${s.maxCampaignDays} days.`);
  if (i.closesAt <= new Date()) throw new ValidationError("The closing date has passed.");
  const dates = [...new Set(i.deliveryDates.map((d) => d.toISOString().slice(0, 10)))].sort().map((d) => new Date(`${d}T00:00:00Z`));
  if (!dates.length) throw new ValidationError("Add at least one delivery date.");
  if (dates.length > s.maxDeliveryDates) throw new ValidationError(`At most ${s.maxDeliveryDates} delivery dates.`);
  if (dates[0] <= i.closesAt) throw new ValidationError("Delivery dates must be after the pre-order closes.");
  const depositPct = s.parts.deposits ? Math.max(0, Math.min(s.maxDepositPct, Math.round(i.depositPct || 0))) : 0;
  if ((i.depositPct || 0) > s.maxDepositPct && s.parts.deposits) throw new ValidationError(`The deposit can be at most ${s.maxDepositPct}%.`);
  if (!i.items.length || i.items.length > 50) throw new ValidationError("Add between 1 and 50 products.");
  const info = await offerInfo(i.items.map((x) => x.offerId));
  const items = i.items.map((x, k) => {
    const o = info.get(x.offerId);
    if (!o || o.vendorId !== ctx.company.id || o.status !== "ACTIVE") throw new ValidationError("Choose your own active products.");
    if (!(x.unitNet > 0)) throw new ValidationError(`${o.product}: give a price.`);
    const minQty = Math.max(1, Math.round(x.minQty ?? 1)), maxQty = x.maxQty ? Math.max(minQty, Math.round(x.maxQty)) : null;
    const supplyQty = x.supplyQty == null ? null : Math.max(1, Math.round(x.supplyQty));
    return { offerId: x.offerId, unitNet: Math.round(x.unitNet * 10000) / 10000, tiers: cleanTiers(x.unitNet, x.tiers) as unknown as Prisma.InputJsonValue, minQty, maxQty, supplyQty, sort: k, countryId: o.countryId };
  });
  if (new Set(items.map((x) => x.offerId)).size !== items.length) throw new ValidationError("Each product once.");
  const data = {
    kind: i.kind, title, description: i.description?.trim().slice(0, 2000) || null, opensAt: i.opensAt, closesAt: i.closesAt, deliveryDates: dates,
    allocation: i.allocation, depositPct, countryId: items[0].countryId,
  };
  const its = items.map(({ countryId: _c, ...x }) => { void _c; return x; });
  if (id) {
    const c = await prisma.preorderCampaign.findUnique({ where: { id } });
    if (!c || c.vendorCompanyId !== ctx.company.id) throw new NotFoundError("Pre-order");
    if (!EDITABLE.includes(c.status)) throw new ValidationError("Only a draft (or a rejected pre-order) can be changed.");
    await prisma.$transaction([prisma.preorderItem.deleteMany({ where: { campaignId: id } }), prisma.preorderCampaign.update({ where: { id }, data: { ...data, items: { create: its } } })]);
    return prisma.preorderCampaign.findUniqueOrThrow({ where: { id } });
  }
  const number = await nextNo("preorder.campaign", "PRE");
  const c = await prisma.preorderCampaign.create({ data: { ...data, number, vendorCompanyId: ctx.company.id, sellerType: ctx.company.type, createdById: ctx.user.id, items: { create: its } } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "preorders.campaign_created", entityType: "PreorderCampaign", entityId: c.id, after: { number, title } });
  return c;
}

export async function submitCampaign(ctx: Ctx, id: string) {
  const s = await asSeller(ctx, "campaigns");
  const c = await prisma.preorderCampaign.findUnique({ where: { id }, include: { _count: { select: { items: true } } } });
  if (!c || c.vendorCompanyId !== ctx.company.id) throw new NotFoundError("Pre-order");
  if (!EDITABLE.includes(c.status)) throw new ValidationError("This pre-order was already sent.");
  if (!c._count.items) throw new ValidationError("Add products first.");
  if (c.closesAt <= new Date()) throw new ValidationError("The closing date has passed — change the dates.");
  const auto = s.approval === "AUTO";
  const u = await prisma.preorderCampaign.update({ where: { id }, data: { status: auto ? "OPEN" : "PENDING", submittedAt: new Date(), reviewNote: null, ...(auto ? { reviewedAt: new Date() } : {}) } });
  if (auto) await announce(u.id).catch(() => null);
  else {
    const admins = await prisma.company.findMany({ where: { type: "ADMIN" }, select: { id: true } });
    for (const a of admins) await notify("preorder.review", [{ companyId: a.id, link: `/admin/orders/preorders/${id}` }], { number: c.number, company: nameOf(ctx.company), title: c.title }).catch(() => null);
  }
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "preorders.campaign_submitted", entityType: "PreorderCampaign", entityId: id, after: { status: u.status } });
  return u;
}

/** Supplier (or FIRINGI) cancels a campaign: active pre-orders end; deposits paid stay as credit on the buyers' accounts. */
export async function cancelCampaign(ctx: Ctx, id: string, reason: string) {
  const c = await prisma.preorderCampaign.findUnique({ where: { id } });
  if (!c) throw new NotFoundError("Pre-order");
  const admin = ctx.company.type === "ADMIN" && can(ctx, ["admin.orders.manage", "admin.pricing.manage", "admin.settings.manage"]);
  if (!admin) { await asSeller(ctx, "campaigns"); if (c.vendorCompanyId !== ctx.company.id) throw new NotFoundError("Pre-order"); }
  if (["DONE", "CANCELLED"].includes(c.status)) throw new ValidationError("This pre-order has ended.");
  const why = reason.trim().slice(0, 300);
  if (why.length < 3) throw new ValidationError("Say why.");
  const res = await prisma.preorderReservation.findMany({ where: { campaignId: id, status: { in: ACTIVE_RES } }, select: { id: true, buyerCompanyId: true, number: true } });
  await prisma.$transaction([
    prisma.preorderReservation.updateMany({ where: { id: { in: res.map((r) => r.id) } }, data: { status: "CANCELLED", cancelReason: why, cancelledAt: new Date() } }),
    prisma.preorderCampaign.update({ where: { id }, data: { status: "CANCELLED", cancelReason: why } }),
  ]);
  for (const r of res) await notify("preorder.cancelled", [{ companyId: r.buyerCompanyId, link: "/buy/orders/preorders?tab=MINE" }], { number: r.number, title: c.title, reason: why }).catch(() => null);
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "preorders.campaign_cancelled", entityType: "PreorderCampaign", entityId: id, after: { reason: why, preorders: res.length } });
  return { cancelled: res.length };
}

/** Totals per product: pre-ordered, current tier price, next tier. */
async function itemTotals(campaignId: string, statuses = ACTIVE_RES) {
  const rows = await prisma.preorderLine.groupBy({ by: ["itemId"], where: { reservation: { campaignId, status: { in: statuses } } }, _sum: { qty: true, allocatedQty: true } });
  return new Map(rows.map((r) => [r.itemId, { qty: r._sum.qty ?? 0, allocated: r._sum.allocatedQty ?? 0 }]));
}

export async function vendorCampaigns(ctx: Ctx) {
  const s = await asSeller(ctx, "campaigns", false);
  const rows = await prisma.preorderCampaign.findMany({ where: { vendorCompanyId: ctx.company.id }, orderBy: { createdAt: "desc" }, take: 200, include: { _count: { select: { items: true } }, reservations: { where: { status: { notIn: ["CANCELLED"] } }, select: { id: true } } } });
  return { settings: s, campaigns: rows.map((c) => ({ id: c.id, number: c.number, title: c.title, kind: c.kind, status: c.status, opensAt: c.opensAt, closesAt: c.closesAt, deliveryDates: c.deliveryDates, items: c._count.items, buyers: c.reservations.length })) };
}

export async function campaignDetail(ctx: Ctx, id: string, locale = "en") {
  const c = await prisma.preorderCampaign.findUnique({ where: { id }, include: { items: { orderBy: { sort: "asc" } }, reservations: { orderBy: { createdAt: "asc" }, include: { lines: true } } } });
  if (!c) throw new NotFoundError("Pre-order");
  const admin = ctx.company.type === "ADMIN" && can(ctx, ADMIN_VIEW);
  if (!admin) { await asSeller(ctx, "campaigns", false); if (c.vendorCompanyId !== ctx.company.id) throw new NotFoundError("Pre-order"); }
  const info = await offerInfo(c.items.map((x) => x.offerId), locale);
  const list = await listPrices(c.items.map((x) => x.offerId));
  const totals = await itemTotals(id, ["PLACED", "ALLOCATED", "CONFIRMED", "ORDERED"]);
  const buyers = await prisma.company.findMany({ where: { id: { in: c.reservations.map((r) => r.buyerCompanyId) } }, select: { id: true, legalName: true, tradeName: true } });
  const vendor = await prisma.company.findUnique({ where: { id: c.vendorCompanyId }, select: { legalName: true, tradeName: true } });
  const items = c.items.map((x) => {
    const tiers = cleanTiers(num(x.unitNet), x.tiers), t = totals.get(x.id) ?? { qty: 0, allocated: 0 };
    return { id: x.id, offerId: x.offerId, product: info.get(x.offerId)?.product ?? "—", sku: info.get(x.offerId)?.sku ?? "", pack: info.get(x.offerId)?.pack ?? "", unitNet: num(x.unitNet), listPrice: list.get(x.offerId) ?? null, tiers, minQty: x.minQty, maxQty: x.maxQty, supplyQty: x.supplyQty, total: t.qty, allocated: t.allocated, price: tierPrice(num(x.unitNet), tiers, t.qty), next: nextTier(tiers, t.qty) };
  });
  // demand per delivery date (the supplier's plan)
  const plan = c.deliveryDates.map((d) => ({
    date: d,
    items: items.map((it) => ({ itemId: it.id, product: it.product, qty: c.reservations.filter((r) => r.deliveryDate.getTime() === d.getTime() && ACTIVE_RES.concat("ORDERED").includes(r.status)).reduce((a, r) => a + (r.lines.find((l) => l.itemId === it.id)?.[c.allocatedAt ? "allocatedQty" : "qty"] ?? 0), 0) })),
  }));
  const reservations = await Promise.all(c.reservations.map(async (r) => ({
    id: r.id, number: r.number, buyer: nameOf(buyers.find((b) => b.id === r.buyerCompanyId)), status: r.status, deliveryDate: r.deliveryDate, createdAt: r.createdAt, failReason: r.failReason, cancelReason: r.cancelReason,
    deposit: { amount: num(r.depositAmount), ...(await depositState(r.depositRequestId, num(r.depositAmount))) },
    lines: r.lines.map((l) => ({ itemId: l.itemId, product: items.find((it) => it.id === l.itemId)?.product ?? "—", qty: l.qty, allocatedQty: l.allocatedQty, unitNet: l.unitNet == null ? null : num(l.unitNet) })),
    orders: r.orderIds,
  })));
  const value = reservations.filter((r) => r.status !== "CANCELLED" && r.status !== "DECLINED").reduce((a, r) => a + r.lines.reduce((b, l) => b + (l.allocatedQty ?? l.qty) * (l.unitNet ?? items.find((it) => it.id === l.itemId)?.price ?? 0), 0), 0);
  return {
    campaign: { id: c.id, number: c.number, title: c.title, description: c.description, kind: c.kind, status: c.status, opensAt: c.opensAt, closesAt: c.closesAt, deliveryDates: c.deliveryDates, allocation: c.allocation, depositPct: c.depositPct, reviewNote: c.reviewNote, cancelReason: c.cancelReason, vendor: nameOf(vendor), sellerType: c.sellerType, allocatedAt: c.allocatedAt },
    items, plan, reservations, value: Math.round(value * 100) / 100, editable: EDITABLE.includes(c.status),
  };
}

/** Supplier closes early → allocation runs now. */
export async function closeNow(ctx: Ctx, id: string) {
  await asSeller(ctx, "campaigns");
  const c = await prisma.preorderCampaign.findUnique({ where: { id } });
  if (!c || c.vendorCompanyId !== ctx.company.id) throw new NotFoundError("Pre-order");
  if (c.status !== "OPEN") throw new ValidationError("Only an open pre-order can be closed.");
  return closeCampaign(id, new Date());
}
/** Supplier places the orders for a delivery date now (instead of waiting for the job). */
export async function orderNow(ctx: Ctx, id: string, date: Date) {
  await asSeller(ctx, "campaigns");
  const c = await prisma.preorderCampaign.findUnique({ where: { id } });
  if (!c || c.vendorCompanyId !== ctx.company.id) throw new NotFoundError("Pre-order");
  if (c.status !== "ALLOCATED") throw new ValidationError("Orders are placed after the pre-order is closed and shared out.");
  return placeOrdersFor(id, date);
}

// ── FIRINGI ─────────────────────────────────────────────────────────────────

export async function reviewCampaign(ctx: Ctx, id: string, approve: boolean, note?: string | null) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, ["admin.orders.manage", "admin.pricing.manage", "admin.settings.manage"])) throw new ForbiddenError();
  const c = await prisma.preorderCampaign.findUnique({ where: { id } });
  if (!c) throw new NotFoundError("Pre-order");
  if (c.status !== "PENDING") throw new ValidationError("This pre-order is not waiting for review.");
  if (!approve && !(note ?? "").trim()) throw new ValidationError("Give a reason.");
  const u = await prisma.preorderCampaign.update({ where: { id }, data: { status: approve ? "OPEN" : "REJECTED", reviewNote: note?.trim().slice(0, 500) || null, reviewedAt: new Date(), reviewedById: ctx.user.id } });
  await notify("preorder.reviewed", [{ companyId: c.vendorCompanyId, link: `/vendor/orders/preorders/${id}` }], { number: c.number, title: c.title, decision: approve ? "APPROVED" : "REJECTED", reason: note ?? "" }).catch(() => null);
  if (approve) await announce(id).catch(() => null);
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: approve ? "preorders.campaign_approved" : "preorders.campaign_rejected", entityType: "PreorderCampaign", entityId: id, after: { note } });
  return u;
}

export async function adminOverview(ctx: Ctx) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, ADMIN_VIEW)) throw new ForbiddenError();
  const [campaigns, byStatus, res, locks] = await Promise.all([
    prisma.preorderCampaign.findMany({ orderBy: [{ createdAt: "desc" }], take: 300, include: { _count: { select: { items: true } }, reservations: { where: { status: { notIn: ["CANCELLED", "DECLINED"] } }, select: { id: true, lines: { select: { qty: true, allocatedQty: true, unitNet: true, item: { select: { unitNet: true } } } } } } } }),
    prisma.preorderCampaign.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.preorderReservation.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.priceLock.findMany({ orderBy: { createdAt: "desc" }, take: 300 }),
  ]);
  const cos = await prisma.company.findMany({ where: { id: { in: [...new Set([...campaigns.map((c) => c.vendorCompanyId), ...locks.flatMap((l) => [l.vendorCompanyId, l.buyerCompanyId])])] } }, select: { id: true, legalName: true, tradeName: true } });
  const nm = (id: string) => nameOf(cos.find((c) => c.id === id));
  const linesValue = (ls: { qty: number; allocatedQty: number | null; unitNet: unknown; item: { unitNet: unknown } }[]) => ls.reduce((a, l) => a + (l.allocatedQty ?? l.qty) * num(l.unitNet ?? l.item.unitNet), 0);
  return {
    counts: Object.fromEntries(byStatus.map((x) => [x.status, x._count._all])) as Record<string, number>,
    reservations: Object.fromEntries(res.map((x) => [x.status, x._count._all])) as Record<string, number>,
    campaigns: campaigns.map((c) => ({ id: c.id, number: c.number, title: c.title, kind: c.kind, status: c.status, vendor: nm(c.vendorCompanyId), sellerType: c.sellerType, closesAt: c.closesAt, items: c._count.items, buyers: c.reservations.length, value: Math.round(c.reservations.reduce((a, r) => a + linesValue(r.lines), 0) * 100) / 100 })),
    locks: locks.map((l) => ({ id: l.id, number: l.number, status: l.status, vendor: nm(l.vendorCompanyId), buyer: nm(l.buyerCompanyId), qtyTotal: l.qtyTotal, qtyTaken: l.qtyTaken, unitNet: num(l.unitNet), value: Math.round(l.qtyTotal * num(l.unitNet) * 100) / 100, validUntil: l.validUntil, createdAt: l.createdAt })),
  };
}

// ── buyer ───────────────────────────────────────────────────────────────────

/** Sellers this buyer may pre-order from: the right type, same country, switched on. */
async function liveForBuyer(ctx: Ctx, now: Date) {
  const s = await preSettings();
  const rows = await prisma.preorderCampaign.findMany({ where: { status: "OPEN", sellerType: sellerTypeForBuyer(ctx.company.type), countryId: ctx.company.countryId, opensAt: { lte: now }, closesAt: { gt: now } }, orderBy: { closesAt: "asc" }, include: { items: { orderBy: { sort: "asc" } } } });
  const vendors = await prisma.company.findMany({ where: { id: { in: rows.map((r) => r.vendorCompanyId) } }, select: { id: true, type: true, legalName: true, tradeName: true, status: true } });
  return rows.filter((r) => { const v = vendors.find((x) => x.id === r.vendorCompanyId); return v && v.status === "APPROVED" && sellerOn(s, { id: v.id, type: v.type }, "campaigns"); }).map((r) => ({ ...r, vendor: nameOf(vendors.find((v) => v.id === r.vendorCompanyId)) }));
}

/** The buyer's view: open pre-orders (suggested first: products it bought around this time last year), its own pre-orders. */
export async function buyerPreorders(ctx: Ctx, locale = "en", now = new Date()) {
  const s = await asBuyer(ctx, "campaigns", false);
  const live = await liveForBuyer(ctx, now);
  const mine = await prisma.preorderReservation.findMany({ where: { buyerCompanyId: ctx.company.id }, orderBy: { createdAt: "desc" }, take: 100, include: { lines: true, campaign: { include: { items: true } } } });
  const offerIds = [...live.flatMap((c) => c.items.map((x) => x.offerId)), ...mine.flatMap((r) => r.campaign.items.map((x) => x.offerId))];
  const info = await offerInfo(offerIds, locale);
  const totals = new Map<string, Map<string, { qty: number; allocated: number }>>();
  for (const c of [...new Set([...live.map((x) => x.id), ...mine.map((r) => r.campaignId)])]) totals.set(c, await itemTotals(c));
  // suggestions: variants this buyer bought in the same months last year
  const from = new Date(now.getTime() - days(400)), to = new Date(now.getTime() - days(300));
  const bought = new Set((await prisma.orderLine.findMany({ where: { order: { buyerCompanyId: ctx.company.id, placedAt: { gte: from, lte: to } } }, select: { offer: { select: { packaging: { select: { variantId: true } } } } }, take: 2000 })).map((l) => l.offer?.packaging.variantId).filter(Boolean));
  const recent = new Set((await prisma.orderLine.findMany({ where: { order: { buyerCompanyId: ctx.company.id, placedAt: { gte: new Date(now.getTime() - days(90)) } } }, select: { offer: { select: { packaging: { select: { variantId: true } } } } }, take: 2000 })).map((l) => l.offer?.packaging.variantId).filter(Boolean));
  const itemView = (campaignId: string, x: { id: string; offerId: string; unitNet: unknown; tiers: unknown; minQty: number; maxQty: number | null; supplyQty: number | null }) => {
    const tiers = cleanTiers(num(x.unitNet), x.tiers), t = totals.get(campaignId)?.get(x.id) ?? { qty: 0, allocated: 0 }, o = info.get(x.offerId);
    return { id: x.id, offerId: x.offerId, product: o?.product ?? "—", pack: o?.pack ?? "", sku: o?.sku ?? "", unitNet: num(x.unitNet), tiers, price: tierPrice(num(x.unitNet), tiers, t.qty), next: nextTier(tiers, t.qty), minQty: x.minQty, maxQty: x.maxQty, short: x.supplyQty != null && t.qty > x.supplyQty, variantId: o?.variantId ?? "" };
  };
  const campaigns = live.map((c) => {
    const items = c.items.map((x) => itemView(c.id, x));
    const suggested = items.some((it) => bought.has(it.variantId) || recent.has(it.variantId));
    return { id: c.id, number: c.number, title: c.title, description: c.description, kind: c.kind, vendor: c.vendor, closesAt: c.closesAt, deliveryDates: c.deliveryDates, depositPct: c.depositPct, allocation: c.allocation, items, suggested, mine: mine.find((r) => r.campaignId === c.id && r.status !== "CANCELLED")?.id ?? null };
  }).sort((a, b) => Number(b.suggested) - Number(a.suggested));
  const reservations = await Promise.all(mine.map(async (r) => {
    const items = r.campaign.items.map((x) => itemView(r.campaignId, x));
    const orders = r.orderIds.length ? await prisma.order.findMany({ where: { id: { in: r.orderIds } }, select: { id: true, number: true, status: true } }) : [];
    return {
      id: r.id, number: r.number, status: r.status, campaignId: r.campaignId, title: r.campaign.title, campaignNumber: r.campaign.number, campaignStatus: r.campaign.status, closesAt: r.campaign.closesAt, deliveryDate: r.deliveryDate,
      deposit: { amount: num(r.depositAmount), ...(await depositState(r.depositRequestId, num(r.depositAmount))) }, failReason: r.failReason, cancelReason: r.cancelReason, addressId: r.addressId,
      lines: r.lines.map((l) => { const it = items.find((x) => x.id === l.itemId); return { itemId: l.itemId, product: it?.product ?? "—", pack: it?.pack ?? "", qty: l.qty, allocatedQty: l.allocatedQty, unitNet: l.unitNet == null ? it?.price ?? 0 : num(l.unitNet) }; }),
      canEdit: r.status === "PLACED" && isOpen(r.campaign, now), orders,
    };
  }));
  return { settings: s, campaigns, reservations };
}

export type ReservationInput = { campaignId: string; addressId: string; deliveryDate: Date; note?: string | null; lines: { itemId: string; qty: number }[] };
export async function placeReservation(ctx: Ctx, i: ReservationInput, now = new Date()) {
  const s = await asBuyer(ctx, "campaigns");
  const c = await prisma.preorderCampaign.findUnique({ where: { id: i.campaignId }, include: { items: true } });
  if (!c || c.countryId !== ctx.company.countryId || buyerTypeFor(c.sellerType) !== ctx.company.type) throw new NotFoundError("Pre-order");
  if (!isOpen(c, now)) throw new ValidationError("This pre-order is closed.");
  if (!(await liveForBuyer(ctx, now)).some((x) => x.id === c.id)) throw new NotFoundError("Pre-order");
  const { canOrderTo } = await import("@/server/multisite/branches");
  const addr = await prisma.address.findFirst({ where: { id: i.addressId, companyId: ctx.company.id, kind: "DELIVERY", isActive: true } });
  if (!addr || !(await canOrderTo(ctx, i.addressId))) throw new ValidationError("Choose one of your delivery addresses.");
  const date = c.deliveryDates.find((d) => d.toISOString().slice(0, 10) === i.deliveryDate.toISOString().slice(0, 10));
  if (!date) throw new ValidationError("Choose one of the delivery dates.");
  const lines = i.lines.filter((l) => l.qty > 0).map((l) => {
    const it = c.items.find((x) => x.id === l.itemId);
    if (!it) throw new ValidationError("Unknown product.");
    const qty = Math.round(l.qty);
    if (qty < it.minQty) throw new ValidationError(`At least ${it.minQty} of each product you pre-order.`);
    if (it.maxQty && qty > it.maxQty) throw new ValidationError(`At most ${it.maxQty} of a product.`);
    return { itemId: it.id, qty, base: num(it.unitNet) };
  });
  if (!lines.length) throw new ValidationError("Choose at least one product.");
  const value = lines.reduce((a, l) => a + l.qty * l.base, 0);
  const deposit = s.parts.deposits ? depositFor(c.depositPct, value) : 0;
  const existing = await prisma.preorderReservation.findUnique({ where: { campaignId_buyerCompanyId: { campaignId: c.id, buyerCompanyId: ctx.company.id } } });
  let r;
  if (existing && existing.status !== "CANCELLED") {
    if (existing.status !== "PLACED") throw new ValidationError("This pre-order can't be changed any more.");
    const paid = (await depositState(existing.depositRequestId, num(existing.depositAmount))).paid;
    if (paid && deposit > num(existing.depositAmount) + 0.004) throw new ValidationError("The deposit is paid — you can lower the quantities, not raise them.");
    r = await prisma.$transaction(async (tx) => {
      await tx.preorderLine.deleteMany({ where: { reservationId: existing.id } });
      return tx.preorderReservation.update({ where: { id: existing.id }, data: { addressId: i.addressId, deliveryDate: date, note: i.note?.trim().slice(0, 500) || null, ...(paid ? {} : { depositAmount: deposit }), lines: { create: lines.map(({ base: _b, ...l }) => { void _b; return l; }) } } });
    });
  } else {
    const number = existing?.number ?? (await nextNo("preorder.reservation", "PR"));
    r = await prisma.$transaction(async (tx) => {
      if (existing) { await tx.preorderLine.deleteMany({ where: { reservationId: existing.id } }); await tx.preorderReservation.delete({ where: { id: existing.id } }); }
      return tx.preorderReservation.create({ data: { number, campaignId: c.id, buyerCompanyId: ctx.company.id, addressId: i.addressId, deliveryDate: date, note: i.note?.trim().slice(0, 500) || null, depositAmount: deposit, createdById: ctx.user.id, lines: { create: lines.map(({ base: _b, ...l }) => { void _b; return l; }) } } });
    });
  }
  // the deposit (if any and not paid yet): a payment request open until the pre-order closes
  let payLink: string | null = null;
  const st = await depositState(r.depositRequestId, num(r.depositAmount));
  if (num(r.depositAmount) > 0 && !st.paid) {
    const req = await depositRequest(ctx.company.id, num(r.depositAmount), r.id, ctx.user.id, (c.closesAt.getTime() - now.getTime()) / 3600_000);
    if (req) { await prisma.preorderReservation.update({ where: { id: r.id }, data: { depositRequestId: req.id } }); payLink = `/pay/${req.token}`; }
  }
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "preorders.placed", entityType: "PreorderReservation", entityId: r.id, after: { campaign: c.number, lines: lines.map((l) => ({ itemId: l.itemId, qty: l.qty })), deposit } });
  return { id: r.id, number: r.number, deposit, payLink };
}

export async function cancelReservation(ctx: Ctx, id: string, now = new Date()) {
  await asBuyer(ctx, "campaigns");
  const r = await prisma.preorderReservation.findUnique({ where: { id }, include: { campaign: true } });
  if (!r || r.buyerCompanyId !== ctx.company.id) throw new NotFoundError("Pre-order");
  if (r.status !== "PLACED" || !isOpen(r.campaign, now)) throw new ValidationError("This pre-order can't be cancelled any more.");
  await prisma.preorderReservation.update({ where: { id }, data: { status: "CANCELLED", cancelledAt: now, cancelReason: "Cancelled by the buyer" } });
  if (r.depositRequestId) await prisma.paymentRequest.updateMany({ where: { id: r.depositRequestId, status: "OPEN" }, data: { status: "CANCELLED" } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "preorders.cancelled", entityType: "PreorderReservation", entityId: id });
  return { ok: true };
}

/** Given less than asked: take it or leave it. */
export async function answerAllocation(ctx: Ctx, id: string, accept: boolean) {
  await asBuyer(ctx, "campaigns");
  const r = await prisma.preorderReservation.findUnique({ where: { id }, include: { campaign: true } });
  if (!r || r.buyerCompanyId !== ctx.company.id) throw new NotFoundError("Pre-order");
  if (r.status !== "ALLOCATED") throw new ValidationError("Nothing to confirm.");
  await prisma.preorderReservation.update({ where: { id }, data: accept ? { status: "CONFIRMED", confirmedAt: new Date() } : { status: "DECLINED", cancelReason: "Declined the quantity offered", cancelledAt: new Date() } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: accept ? "preorders.allocation_accepted" : "preorders.allocation_declined", entityType: "PreorderReservation", entityId: id });
  return { ok: true };
}

// ── processing (job) ────────────────────────────────────────────────────────

/** Tell buyers who bought these products in the last year that the pre-order is open (once). */
export async function announce(id: string, now = new Date()) {
  const c = await prisma.preorderCampaign.findUnique({ where: { id }, include: { items: true } });
  if (!c || c.status !== "OPEN" || c.announcedAt || c.opensAt > now) return 0;
  const info = await offerInfo(c.items.map((x) => x.offerId));
  const variants = [...new Set([...info.values()].map((o) => o.variantId))];
  const buyers = await prisma.order.findMany({
    where: { countryId: c.countryId, placedAt: { gte: new Date(now.getTime() - days(365)) }, lines: { some: { offer: { packaging: { variantId: { in: variants } } } } }, buyer: { type: buyerTypeFor(c.sellerType) as "CUSTOMER" | "WHOLESALER", status: "APPROVED" } },
    select: { buyerCompanyId: true }, distinct: ["buyerCompanyId"], take: 500,
  });
  const vendor = await prisma.company.findUnique({ where: { id: c.vendorCompanyId }, select: { legalName: true, tradeName: true } });
  for (const b of buyers) await notify("preorder.campaign_open", [{ companyId: b.buyerCompanyId, link: "/buy/orders/preorders" }], { title: c.title, supplier: nameOf(vendor), date: c.closesAt.toISOString().slice(0, 10) }).catch(() => null);
  await prisma.preorderCampaign.update({ where: { id }, data: { announcedAt: now } });
  return buyers.length;
}

/** The close: unpaid deposits lapse, the final tier price is set, short supply is shared, buyers told. */
export async function closeCampaign(id: string, now = new Date()) {
  const c = await prisma.preorderCampaign.findUnique({ where: { id }, include: { items: true, reservations: { where: { status: "PLACED" }, include: { lines: true } } } });
  if (!c || c.status !== "OPEN") return { allocated: 0, lapsed: 0 };
  let lapsed = 0;
  const live: typeof c.reservations = [];
  for (const r of c.reservations) {
    const dep = await depositState(r.depositRequestId, num(r.depositAmount));
    if (num(r.depositAmount) > 0 && !dep.paid) {
      await prisma.preorderReservation.update({ where: { id: r.id }, data: { status: "CANCELLED", cancelReason: "Deposit not paid before the close", cancelledAt: now } });
      if (r.depositRequestId) await prisma.paymentRequest.updateMany({ where: { id: r.depositRequestId, status: "OPEN" }, data: { status: "CANCELLED" } });
      await notify("preorder.cancelled", [{ companyId: r.buyerCompanyId, link: "/buy/orders/preorders?tab=MINE" }], { number: r.number, title: c.title, reason: "Deposit not paid before the close" }).catch(() => null);
      lapsed++;
    } else live.push(r);
  }
  // loyalty: what each buyer bought from this supplier in the last year
  const loyalty = new Map<string, number>();
  if (c.allocation === "LOYAL_FIRST") {
    const rows = await prisma.order.groupBy({ by: ["buyerCompanyId"], where: { sellerCompanyId: c.vendorCompanyId, buyerCompanyId: { in: live.map((r) => r.buyerCompanyId) }, placedAt: { gte: new Date(now.getTime() - days(365)) }, status: { notIn: ["CANCELLED"] } }, _sum: { grandTotal: true } });
    for (const r of rows) loyalty.set(r.buyerCompanyId, num(r._sum.grandTotal));
  }
  const alloc = new Map<string, number>(); // lineId → packs
  const price = new Map<string, number>(); // itemId → final price
  for (const it of c.items) {
    const reqs = live.flatMap((r) => r.lines.filter((l) => l.itemId === it.id).map((l) => ({ id: l.id, qty: l.qty, at: r.createdAt.getTime(), loyalty: loyalty.get(r.buyerCompanyId) ?? 0 })));
    const got = allocate(c.allocation, it.supplyQty, reqs);
    for (const [k, v] of got) alloc.set(k, v);
    const total = [...got.values()].reduce((a, v) => a + v, 0);
    price.set(it.id, tierPrice(num(it.unitNet), cleanTiers(num(it.unitNet), it.tiers), total));
  }
  let allocated = 0;
  for (const r of live) {
    await prisma.$transaction(r.lines.map((l) => prisma.preorderLine.update({ where: { id: l.id }, data: { allocatedQty: alloc.get(l.id) ?? 0, unitNet: price.get(l.itemId) ?? null } })));
    const full = r.lines.every((l) => (alloc.get(l.id) ?? 0) >= l.qty), none = r.lines.every((l) => (alloc.get(l.id) ?? 0) === 0);
    const status = none ? "DECLINED" : full ? "CONFIRMED" : "ALLOCATED";
    await prisma.preorderReservation.update({ where: { id: r.id }, data: { status, ...(status === "CONFIRMED" ? { confirmedAt: now } : {}), ...(none ? { cancelReason: "Nothing left to share", cancelledAt: now } : {}) } });
    const lines = r.lines.map((l) => `${alloc.get(l.id) ?? 0}/${l.qty}`).join(", ");
    await notify("preorder.allocated", [{ companyId: r.buyerCompanyId, link: "/buy/orders/preorders?tab=MINE" }], { number: r.number, title: c.title, result: status, lines }).catch(() => null);
    allocated++;
  }
  await prisma.preorderCampaign.update({ where: { id }, data: { status: "ALLOCATED", closedAt: now, allocatedAt: now } });
  await writeAudit({ actorUserId: null, actorCompanyId: c.vendorCompanyId, action: "preorders.campaign_allocated", entityType: "PreorderCampaign", entityId: id, after: { allocated, lapsed } });
  return { allocated, lapsed };
}

/** Orders for one delivery date: each confirmed pre-order becomes an order at the final price. */
export async function placeOrdersFor(campaignId: string, date: Date) {
  const c = await prisma.preorderCampaign.findUniqueOrThrow({ where: { id: campaignId }, include: { items: true } });
  const day = date.toISOString().slice(0, 10);
  const res = await prisma.preorderReservation.findMany({ where: { campaignId, status: "CONFIRMED" }, include: { lines: true } });
  const { placeOrder } = await import("@/server/services/orders");
  let placed = 0, failed = 0;
  for (const r of res.filter((x) => x.deliveryDate.toISOString().slice(0, 10) === day)) {
    const lines = r.lines.filter((l) => (l.allocatedQty ?? 0) > 0);
    try {
      const bctx = await buyerCtx(r.createdById, r.buyerCompanyId);
      const items = lines.map((l) => ({ offerId: c.items.find((it) => it.id === l.itemId)!.offerId, qty: l.allocatedQty! }));
      const fixed = new Map(lines.map((l) => [c.items.find((it) => it.id === l.itemId)!.offerId, (l.unitNet ?? c.items.find((it) => it.id === l.itemId)!.unitNet).toString()]));
      const deliveryDay = r.deliveryDate > new Date() ? r.deliveryDate : null;
      const p = await placeOrder(bctx, { deliveryAddressId: r.addressId, requestedDeliveryDate: deliveryDay, items, fixedPrices: fixed, approved: true, preorder: true, notes: `Pre-order ${r.number} (${c.number}): ${c.title}`.slice(0, 500) });
      const ids = (p.orders ?? []).map((o) => o.id);
      await prisma.preorderReservation.update({ where: { id: r.id }, data: { status: "ORDERED", orderIds: ids.length ? ids : [p.id].filter(Boolean) as string[] } });
      const first = p.orders?.[0];
      await notify("preorder.ordered", [{ companyId: r.buyerCompanyId, link: first ? `/buy/orders/${first.id}` : "/buy/orders/preorders?tab=MINE" }], { number: r.number, title: c.title, order: first?.number ?? "" }).catch(() => null);
      placed++;
    } catch (e) {
      const why = (e instanceof Error ? e.message : String(e)).slice(0, 300);
      await prisma.preorderReservation.update({ where: { id: r.id }, data: { status: "FAILED", failReason: why } });
      for (const to of [{ companyId: r.buyerCompanyId, link: "/buy/orders/preorders?tab=MINE" }, { companyId: c.vendorCompanyId, link: `/vendor/orders/preorders/${c.id}` }]) await notify("preorder.failed", [to], { number: r.number, title: c.title, reason: why }).catch(() => null);
      failed++;
    }
  }
  return { placed, failed };
}

/** Campaigns: announce, close, auto-confirm, order before delivery, finish. */
export async function processCampaigns(now = new Date()) {
  const s = await preSettings();
  const out = { announced: 0, closed: 0, confirmed: 0, ordered: 0, failed: 0, done: 0 };
  if (!s.enabled || !s.parts.campaigns) return out;
  for (const c of await prisma.preorderCampaign.findMany({ where: { status: "OPEN", announcedAt: null, opensAt: { lte: now } }, select: { id: true } })) out.announced += (await announce(c.id, now)) > 0 ? 1 : 0;
  for (const c of await prisma.preorderCampaign.findMany({ where: { status: "OPEN", closesAt: { lte: now } }, select: { id: true } })) { await closeCampaign(c.id, now); out.closed++; }
  const auto = await prisma.preorderReservation.updateMany({ where: { status: "ALLOCATED", campaign: { allocatedAt: { lte: new Date(now.getTime() - days(s.confirmDays)) } } }, data: { status: "CONFIRMED", confirmedAt: now } });
  out.confirmed = auto.count;
  for (const c of await prisma.preorderCampaign.findMany({ where: { status: "ALLOCATED" }, select: { id: true, deliveryDates: true } })) {
    for (const d of c.deliveryDates) if (now.getTime() >= d.getTime() - days(s.orderDaysBefore)) { const r = await placeOrdersFor(c.id, d); out.ordered += r.placed; out.failed += r.failed; }
    const left = await prisma.preorderReservation.count({ where: { campaignId: c.id, status: { in: ACTIVE_RES } } });
    if (!left && c.deliveryDates.every((d) => now.getTime() >= d.getTime() - days(s.orderDaysBefore))) { await prisma.preorderCampaign.update({ where: { id: c.id }, data: { status: "DONE" } }); out.done++; }
  }
  return out;
}

/** The supplier's active products for the campaign editor (name · pack · SKU, today's price). */
export async function vendorOfferOptions(ctx: Ctx, locale = "en") {
  await asSeller(ctx, "campaigns", false);
  const offers = await prisma.vendorOffer.findMany({ where: { vendorCompanyId: ctx.company.id, status: "ACTIVE" }, select: { id: true }, take: 2000 });
  const info = await offerInfo(offers.map((o) => o.id), locale);
  const prices = await listPrices(offers.map((o) => o.id));
  return [...info.values()].map((o) => ({ id: o.id, label: `${o.product} · ${o.pack} · ${o.sku}`, price: prices.get(o.id) ?? null })).sort((a, b) => a.label.localeCompare(b.label));
}

/** The buyer's delivery addresses (for pre-orders and call-offs). */
export async function buyerAddresses(ctx: Ctx) {
  const rows = await prisma.address.findMany({ where: { companyId: ctx.company.id, kind: "DELIVERY", isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true, label: true, line1: true, cityName: true } });
  return rows.map((x) => ({ id: x.id, label: `${x.label} — ${x.line1}, ${x.cityName}` }));
}
