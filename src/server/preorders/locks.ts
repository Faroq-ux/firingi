import "server-only";
/**
 * Price locks (Phase 71). A buyer asks to keep today's price for a quantity of one product over coming months; the
 * seller accepts (optionally at another price, with a deposit) or declines; above FIRINGI's limit FIRINGI approves too.
 * Each call-off is a normal order at the locked price; a reminder comes before it ends; what is not taken lapses.
 */
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";
import { notify } from "@/server/notify/dispatch";
import { buyerTypeFor, depositFor, lockEnd, lockSums, perMonth } from "@/lib/preorders";
import { preSettings, sellerOn } from "./settings";
import { asBuyer, asSeller, days, depositRequest, depositState, listPrices, nameOf, nextNo, num, offerInfo } from "./common";

const OPEN = ["REQUESTED", "REVIEW", "ACTIVE"];

export async function requestLock(ctx: Ctx, i: { offerId: string; qty: number; months: number; note?: string | null }) {
  const s = await asBuyer(ctx, "priceLocks");
  const o = (await offerInfo([i.offerId])).get(i.offerId);
  if (!o || o.status !== "ACTIVE" || o.countryId !== ctx.company.countryId || buyerTypeFor(o.sellerType) !== ctx.company.type) throw new NotFoundError("Product");
  const vendor = await prisma.company.findUnique({ where: { id: o.vendorId }, select: { id: true, type: true, status: true, legalName: true, tradeName: true } });
  if (!vendor || vendor.status !== "APPROVED" || !sellerOn(s, { id: vendor.id, type: vendor.type }, "priceLocks")) throw new ValidationError("This supplier doesn't offer price locks.");
  const months = Math.round(i.months), qty = Math.round(i.qty);
  if (months < 1 || months > s.maxLockMonths) throw new ValidationError(`Choose 1 to ${s.maxLockMonths} months.`);
  if (qty < 1 || qty > 100000) throw new ValidationError("Choose how many packs.");
  if (await prisma.priceLock.findFirst({ where: { buyerCompanyId: ctx.company.id, offerId: i.offerId, status: { in: OPEN } } })) throw new ValidationError("You already have a price lock for this product.");
  const price = (await listPrices([i.offerId])).get(i.offerId);
  if (!price) throw new ValidationError("This product has no price today.");
  const number = await nextNo("preorder.lock", "PL");
  const l = await prisma.priceLock.create({ data: { number, vendorCompanyId: o.vendorId, buyerCompanyId: ctx.company.id, offerId: i.offerId, unitNet: price, listUnitNet: price, qtyTotal: qty, months, note: i.note?.trim().slice(0, 500) || null, createdById: ctx.user.id } });
  await notify("pricelock.requested", [{ companyId: o.vendorId, link: "/vendor/orders/preorders?tab=LOCKS" }], { number, company: nameOf(ctx.company), product: o.product, qty, months }).catch(() => null);
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "pricelock.requested", entityType: "PriceLock", entityId: l.id, after: { offerId: i.offerId, qty, months, price } });
  return l;
}

/** Activate: dates and the deposit request. */
async function activate(id: string, actorId: string) {
  const l = await prisma.priceLock.findUniqueOrThrow({ where: { id } });
  const now = new Date(), validUntil = lockEnd(now, l.months);
  const deposit = depositFor(l.depositPct, l.qtyTotal * num(l.unitNet));
  let reqId: string | null = null;
  if (deposit > 0) reqId = (await depositRequest(l.buyerCompanyId, deposit, l.id, actorId, 24 * 14))?.id ?? null;
  return prisma.priceLock.update({ where: { id }, data: { status: "ACTIVE", validUntil, depositAmount: deposit, depositRequestId: reqId } });
}

export async function decideLock(ctx: Ctx, id: string, i: { accept: boolean; unitNet?: number | null; depositPct?: number | null; note?: string | null }) {
  const s = await asSeller(ctx, "priceLocks");
  const l = await prisma.priceLock.findUnique({ where: { id } });
  if (!l || l.vendorCompanyId !== ctx.company.id) throw new NotFoundError("Price lock");
  if (l.status !== "REQUESTED") throw new ValidationError("This request was already answered.");
  const note = i.note?.trim().slice(0, 500) || null;
  if (!i.accept) {
    await prisma.priceLock.update({ where: { id }, data: { status: "REJECTED", reviewNote: note, decidedAt: new Date(), decidedById: ctx.user.id } });
    await notify("pricelock.decided", [{ companyId: l.buyerCompanyId, link: "/buy/orders/preorders?tab=LOCKS" }], { number: l.number, decision: "REJECTED", price: "", reason: note ?? "" }).catch(() => null);
    return { status: "REJECTED" };
  }
  const unitNet = i.unitNet != null ? Math.round(i.unitNet * 10000) / 10000 : num(l.unitNet);
  if (!(unitNet > 0)) throw new ValidationError("Give a price.");
  const depositPct = s.parts.deposits ? Math.max(0, Math.min(s.maxDepositPct, Math.round(i.depositPct ?? 0))) : 0;
  const value = unitNet * l.qtyTotal;
  const review = s.lockReviewAbove > 0 && value > s.lockReviewAbove;
  await prisma.priceLock.update({ where: { id }, data: { unitNet, depositPct, reviewNote: note, decidedAt: new Date(), decidedById: ctx.user.id, status: review ? "REVIEW" : "REQUESTED" } });
  if (review) {
    const admins = await prisma.company.findMany({ where: { type: "ADMIN" }, select: { id: true } });
    for (const a of admins) await notify("pricelock.review", [{ companyId: a.id, link: "/admin/orders/preorders?tab=LOCKS" }], { number: l.number, company: nameOf(ctx.company), value: value.toFixed(2) }).catch(() => null);
  } else {
    await activate(id, ctx.user.id);
    await notify("pricelock.decided", [{ companyId: l.buyerCompanyId, link: "/buy/orders/preorders?tab=LOCKS" }], { number: l.number, decision: "ACTIVE", price: unitNet.toFixed(2), reason: note ?? "" }).catch(() => null);
  }
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "pricelock.accepted", entityType: "PriceLock", entityId: id, after: { unitNet, depositPct, review } });
  return { status: review ? "REVIEW" : "ACTIVE" };
}

export async function reviewLock(ctx: Ctx, id: string, approve: boolean, note?: string | null) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, ["admin.orders.manage", "admin.pricing.manage", "admin.settings.manage"])) throw new ForbiddenError();
  const l = await prisma.priceLock.findUnique({ where: { id } });
  if (!l) throw new NotFoundError("Price lock");
  if (l.status !== "REVIEW") throw new ValidationError("This price lock is not waiting for FIRINGI.");
  if (approve) await activate(id, ctx.user.id);
  else await prisma.priceLock.update({ where: { id }, data: { status: "REJECTED", reviewNote: note?.trim().slice(0, 500) || "Not approved by FIRINGI" } });
  await notify("pricelock.decided", [{ companyId: l.buyerCompanyId, link: "/buy/orders/preorders?tab=LOCKS" }], { number: l.number, decision: approve ? "ACTIVE" : "REJECTED", price: num(l.unitNet).toFixed(2), reason: note ?? "" }).catch(() => null);
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: approve ? "pricelock.approved" : "pricelock.rejected", entityType: "PriceLock", entityId: id, after: { note } });
  return { ok: true };
}

export async function cancelLock(ctx: Ctx, id: string) {
  const l = await prisma.priceLock.findUnique({ where: { id } });
  if (!l) throw new NotFoundError("Price lock");
  const admin = ctx.company.type === "ADMIN" && can(ctx, ["admin.orders.manage", "admin.pricing.manage", "admin.settings.manage"]);
  if (!admin) {
    await asBuyer(ctx, "priceLocks");
    if (l.buyerCompanyId !== ctx.company.id) throw new NotFoundError("Price lock");
    if (!["REQUESTED", "REVIEW"].includes(l.status)) throw new ValidationError("An active price lock can't be cancelled — take what you need or let it end.");
  } else if (!OPEN.includes(l.status)) throw new ValidationError("This price lock has ended.");
  await prisma.priceLock.update({ where: { id }, data: { status: "CANCELLED" } });
  if (l.depositRequestId) await prisma.paymentRequest.updateMany({ where: { id: l.depositRequestId, status: "OPEN" }, data: { status: "CANCELLED" } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "pricelock.cancelled", entityType: "PriceLock", entityId: id });
  return { ok: true };
}

/** A call-off: a normal order at the locked price. */
export async function callOff(ctx: Ctx, id: string, i: { qty: number; addressId: string; deliveryDate?: Date | null }, now = new Date()) {
  await asBuyer(ctx, "priceLocks");
  const l = await prisma.priceLock.findUnique({ where: { id } });
  if (!l || l.buyerCompanyId !== ctx.company.id) throw new NotFoundError("Price lock");
  if (l.status !== "ACTIVE" || (l.validUntil && l.validUntil <= now)) throw new ValidationError("This price lock is not active.");
  const qty = Math.round(i.qty), left = l.qtyTotal - l.qtyTaken;
  if (qty < 1 || qty > left) throw new ValidationError(`Choose 1 to ${left} packs.`);
  const dep = await depositState(l.depositRequestId, num(l.depositAmount));
  if (num(l.depositAmount) > 0 && !dep.paid) throw new ValidationError("Pay the deposit first.");
  const { placeOrder } = await import("@/server/services/orders");
  const p = await placeOrder(ctx, { deliveryAddressId: i.addressId, requestedDeliveryDate: i.deliveryDate ?? null, items: [{ offerId: l.offerId, qty }], fixedPrices: new Map([[l.offerId, l.unitNet.toString()]]), approved: true, notes: `Price lock ${l.number}` });
  const order = p.orders?.[0] ?? { id: p.id, number: p.number };
  const taken = l.qtyTaken + qty;
  await prisma.$transaction([
    prisma.priceLockCalloff.create({ data: { lockId: id, qty, orderId: order.id, orderNumber: order.number, createdById: ctx.user.id } }),
    prisma.priceLock.update({ where: { id }, data: { qtyTaken: taken, ...(taken >= l.qtyTotal ? { status: "DONE" } : {}) } }),
  ]);
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "pricelock.calloff", entityType: "PriceLock", entityId: id, after: { qty, order: order.number } });
  return { order, left: l.qtyTotal - taken };
}

function view(l: Awaited<ReturnType<typeof prisma.priceLock.findMany>>[number] & { calloffs?: { qty: number; orderId: string; orderNumber: string; createdAt: Date }[] }, info: Awaited<ReturnType<typeof offerInfo>>, names: Map<string, string>, now: Date) {
  const sums = lockSums({ unitNet: num(l.unitNet), listUnitNet: num(l.listUnitNet), qtyTotal: l.qtyTotal, qtyTaken: l.qtyTaken });
  const o = info.get(l.offerId);
  return {
    id: l.id, number: l.number, status: l.status, product: o?.product ?? "—", pack: o?.pack ?? "", sku: o?.sku ?? "", offerId: l.offerId,
    vendor: names.get(l.vendorCompanyId) ?? "—", buyer: names.get(l.buyerCompanyId) ?? "—",
    unitNet: num(l.unitNet), listUnitNet: num(l.listUnitNet), qtyTotal: l.qtyTotal, qtyTaken: l.qtyTaken, months: l.months, validUntil: l.validUntil, note: l.note, reviewNote: l.reviewNote, createdAt: l.createdAt,
    depositPct: l.depositPct, ...sums, perMonth: perMonth(sums.left, l.validUntil, now), calloffs: l.calloffs ?? [],
  };
}
async function names(ids: string[]) {
  const cos = await prisma.company.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, legalName: true, tradeName: true } });
  return new Map(cos.map((c) => [c.id, nameOf(c)]));
}

/** The buyer's locks (+ deposit state) and suggestions: products it buys often from sellers that offer locks. */
export async function myLocks(ctx: Ctx, locale = "en", now = new Date()) {
  const s = await asBuyer(ctx, "priceLocks", false);
  const rows = await prisma.priceLock.findMany({ where: { buyerCompanyId: ctx.company.id }, orderBy: { createdAt: "desc" }, take: 100, include: { calloffs: { orderBy: { createdAt: "desc" } } } });
  const recent = await prisma.orderLine.groupBy({ by: ["offerId"], where: { order: { buyerCompanyId: ctx.company.id, placedAt: { gte: new Date(now.getTime() - days(90)) }, status: { notIn: ["CANCELLED"] } } }, _sum: { qtyOrdered: true }, orderBy: { _sum: { qtyOrdered: "desc" } }, take: 12 });
  const info = await offerInfo([...rows.map((r) => r.offerId), ...recent.map((r) => r.offerId)], locale);
  const nm = await names([...rows.flatMap((r) => [r.vendorCompanyId, r.buyerCompanyId]), ...[...info.values()].map((o) => o.vendorId)]);
  const vendors = await prisma.company.findMany({ where: { id: { in: [...new Set([...info.values()].map((o) => o.vendorId))] } }, select: { id: true, type: true, status: true } });
  const prices = await listPrices(recent.map((r) => r.offerId));
  const locked = new Set(rows.filter((r) => ["REQUESTED", "REVIEW", "ACTIVE"].includes(r.status)).map((r) => r.offerId));
  const suggestions = recent.map((r) => ({ r, o: info.get(r.offerId) })).filter(({ r, o }) => {
    const v = o && vendors.find((x) => x.id === o.vendorId);
    return o && v && v.status === "APPROVED" && o.status === "ACTIVE" && !locked.has(r.offerId) && sellerOn(s, { id: v.id, type: v.type }, "priceLocks") && prices.has(r.offerId);
  }).slice(0, 5).map(({ r, o }) => ({ offerId: r.offerId, product: o!.product, pack: o!.pack, vendor: nm.get(o!.vendorId) ?? "—", price: prices.get(r.offerId)!, perMonth: Math.max(1, Math.round(((r._sum?.qtyOrdered ?? 0) / 3))) }));
  return { settings: s, locks: await Promise.all(rows.map(async (l) => ({ ...view(l, info, nm, now), deposit: { amount: num(l.depositAmount), ...(await depositState(l.depositRequestId, num(l.depositAmount))) } }))), suggestions };
}

export async function vendorLocks(ctx: Ctx, locale = "en", now = new Date()) {
  const s = await asSeller(ctx, "priceLocks", false);
  const rows = await prisma.priceLock.findMany({ where: { vendorCompanyId: ctx.company.id }, orderBy: [{ createdAt: "desc" }], take: 300, include: { calloffs: { orderBy: { createdAt: "desc" } } } });
  const info = await offerInfo(rows.map((r) => r.offerId), locale);
  const nm = await names(rows.flatMap((r) => [r.vendorCompanyId, r.buyerCompanyId]));
  const locks = rows.map((l) => view(l, info, nm, now));
  // committed demand: packs still to be called off per product (for planning)
  const committed = new Map<string, { product: string; left: number; perMonth: number }>();
  for (const l of locks.filter((x) => x.status === "ACTIVE")) { const c = committed.get(l.offerId) ?? { product: l.product, left: 0, perMonth: 0 }; c.left += l.left; c.perMonth += l.perMonth; committed.set(l.offerId, c); }
  return { settings: s, locks, committed: [...committed.entries()].map(([offerId, v]) => ({ offerId, ...v })) };
}

/** Reminders before the end, expiry. */
export async function processLocks(now = new Date()) {
  const s = await preSettings();
  const out = { reminded: 0, expired: 0 };
  if (!s.enabled || !s.parts.priceLocks) return out;
  const soon = await prisma.priceLock.findMany({ where: { status: "ACTIVE", remindedAt: null, validUntil: { lte: new Date(now.getTime() + days(s.lockRemindDays)), gt: now } } });
  const info = await offerInfo(soon.map((l) => l.offerId));
  for (const l of soon) {
    const left = l.qtyTotal - l.qtyTaken;
    if (left > 0) await notify("pricelock.ending", [{ companyId: l.buyerCompanyId, link: "/buy/orders/preorders?tab=LOCKS" }], { number: l.number, product: info.get(l.offerId)?.product ?? "", left, date: l.validUntil!.toISOString().slice(0, 10) }).catch(() => null);
    await prisma.priceLock.update({ where: { id: l.id }, data: { remindedAt: now } });
    out.reminded++;
  }
  const ended = await prisma.priceLock.findMany({ where: { status: "ACTIVE", validUntil: { lte: now } } });
  for (const l of ended) {
    await prisma.priceLock.update({ where: { id: l.id }, data: { status: "EXPIRED" } });
    if (l.qtyTotal > l.qtyTaken) await notify("pricelock.expired", [{ companyId: l.buyerCompanyId, link: "/buy/orders/preorders?tab=LOCKS" }], { number: l.number, left: l.qtyTotal - l.qtyTaken }).catch(() => null);
    out.expired++;
  }
  return out;
}

