/**
 * Expiry alerts for goods bought on FIRINGI (Phase 24).
 *
 * Who: wholesalers (buying from distributors) and customers (buying from wholesalers to resell).
 * What: only goods bought on FIRINGI — the lots recorded at delivery (purchased-core.ts).
 * Unsold: for a wholesaler that put the goods into its stock, what is still in that batch; otherwise
 *   delivered − returned − what the buyer marked as sold / used.
 * When: two alerts, FIRINGI sets both (1–30 days before the best-before); one message per buyer and
 *   alert, listing the products. FIRINGI switches it on / off for everyone and per company, and edits
 *   the message (Notification templates › inventory.expiring).
 */
import { Prisma } from "@prisma/client";
import { prisma, type Tx } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";
import { notify } from "@/server/notify/dispatch";
import { pickLocalized } from "@/i18n/config";
import { receive } from "./ledger";

const D = Prisma.Decimal;
const day = 86_400_000;
const todayUtc = () => { const d = new Date(); return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); };
const daysLeft = (d: Date) => Math.round((d.getTime() - todayUtc().getTime()) / day);

export const ALERTS_KEY = "inventory.purchaseAlerts";
export type AlertSettings = { enabled: boolean; firstDays: number; secondDays: number };
export const ALERT_DEFAULTS: AlertSettings = { enabled: true, firstDays: 14, secondDays: 3 };
export const ALERT_EVENT = "inventory.expiring";

export async function alertSettings(tx: Tx = prisma): Promise<AlertSettings> {
  const s = await tx.setting.findUnique({ where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key: ALERTS_KEY } } });
  return { ...ALERT_DEFAULTS, ...((s?.value as Partial<AlertSettings> | null) ?? {}) };
}
/** Per company: true / false = FIRINGI's choice for that company; null = follows the global switch. */
async function companyOverrides(tx: Tx = prisma) {
  const rows = await tx.setting.findMany({ where: { scope: "COMPANY", key: ALERTS_KEY } });
  return new Map(rows.map((r) => [r.scopeId, (r.value as { enabled?: boolean })?.enabled ?? null]));
}

function requireStaff(ctx: Ctx, manage = false) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, manage ? "admin.inventory.manage" : ["admin.inventory.view", "admin.inventory.manage"])) throw new ForbiddenError();
}

export async function setAlertSettings(ctx: Ctx, i: AlertSettings) {
  requireStaff(ctx, true);
  for (const d of [i.firstDays, i.secondDays]) if (!Number.isInteger(d) || d < 1 || d > 30) throw new ValidationError("Alert days must be between 1 and 30 days before the best-before date.");
  if (i.firstDays <= i.secondDays) throw new ValidationError("The first alert must come before the second (more days before the best-before).");
  const value = { enabled: !!i.enabled, firstDays: i.firstDays, secondDays: i.secondDays };
  const before = await alertSettings();
  await prisma.setting.upsert({ where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key: ALERTS_KEY } }, update: { value, updatedById: ctx.user.id }, create: { scope: "GLOBAL", scopeId: "", key: ALERTS_KEY, value, updatedById: ctx.user.id } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "inventory.purchase_alerts", entityType: "Setting", entityId: ALERTS_KEY, before, after: value });
}

/** Switch alerts for one wholesaler / customer (null = back to the global switch). */
export async function setCompanyAlerts(ctx: Ctx, companyId: string, enabled: boolean | null) {
  requireStaff(ctx, true);
  const c = await prisma.company.findFirst({ where: { id: companyId, type: { in: ["WHOLESALER", "CUSTOMER"] } } });
  if (!c) throw new NotFoundError("Company");
  if (enabled === null) await prisma.setting.deleteMany({ where: { scope: "COMPANY", scopeId: companyId, key: ALERTS_KEY } });
  else await prisma.setting.upsert({ where: { scope_scopeId_key: { scope: "COMPANY", scopeId: companyId, key: ALERTS_KEY } }, update: { value: { enabled }, updatedById: ctx.user.id }, create: { scope: "COMPANY", scopeId: companyId, key: ALERTS_KEY, value: { enabled }, updatedById: ctx.user.id } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "inventory.purchase_alerts_company", entityType: "Company", entityId: companyId, after: { enabled } });
}

type LotRow = Prisma.PurchasedLotGetPayload<{ include: { order: { select: { number: true; id: true } } } }> & { ownOnHand?: number | null };

/** Unsold = in the wholesaler's own stock from it, otherwise delivered − used. */
export function unsold(l: { qty: number; usedQty: number; ownBatchId: string | null }, ownOnHand: number | null | undefined) {
  const open = Math.max(0, l.qty - l.usedQty);
  return l.ownBatchId ? Math.min(open, Math.max(0, ownOnHand ?? 0)) : open;
}

async function withOwnStock<T extends { ownBatchId: string | null }>(rows: T[]) {
  const ids = rows.map((r) => r.ownBatchId).filter((x): x is string => !!x);
  const own = ids.length ? await prisma.stockBatch.findMany({ where: { id: { in: ids } }, select: { id: true, onHand: true, writtenOffAt: true } }) : [];
  return rows.map((r) => {
    const b = own.find((x) => x.id === r.ownBatchId);
    return { ...r, ownOnHand: b ? (b.writtenOffAt ? 0 : b.onHand) : null };
  });
}

// ───────────────────────────── buyer ─────────────────────────────

function requireBuyer(ctx: Ctx) {
  if ((ctx.company.type !== "WHOLESALER" && ctx.company.type !== "CUSTOMER") || !can(ctx, ["buyer.orders.view", "buyer.orders.place"])) throw new ForbiddenError();
}

/** Goods bought on FIRINGI with a best-before date that are still unsold (expired up to 30 days ago included). */
export async function myPurchasedLots(ctx: Ctx, locale: string) {
  requireBuyer(ctx);
  const rows = await prisma.purchasedLot.findMany({
    where: { buyerCompanyId: ctx.company.id, expiresOn: { gte: new Date(todayUtc().getTime() - 30 * day) } },
    include: { order: { select: { id: true, number: true } } }, orderBy: { expiresOn: "asc" },
  });
  const offers = await prisma.vendorOffer.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.offerId))] } }, select: { id: true, packaging: { select: { name: true, variant: { select: { product: { select: { name: true } } } } } } } });
  return (await withOwnStock(rows))
    .map((r) => {
      const o = offers.find((x) => x.id === r.offerId);
      return {
        id: r.id, order: r.order, lotCode: r.lotCode, expiresOn: r.expiresOn, daysLeft: daysLeft(r.expiresOn), qty: r.qty, usedQty: r.usedQty, inStock: !!r.ownBatchId,
        unsold: unsold(r, r.ownOnHand), product: o ? `${pickLocalized(o.packaging.variant.product.name, locale)} · ${pickLocalized(o.packaging.name, locale)}` : "—",
      };
    })
    .filter((r) => r.unsold > 0);
}

/** The buyer sold / used some of it (goods not in a wholesaler's stock). */
export async function markUsed(ctx: Ctx, lotId: string, qty: number) {
  requireBuyer(ctx);
  const l = await prisma.purchasedLot.findFirst({ where: { id: lotId, buyerCompanyId: ctx.company.id } });
  if (!l) throw new NotFoundError("Goods");
  if (l.ownBatchId) throw new ValidationError("These goods are in your stock — they count down as you sell them.");
  if (!Number.isInteger(qty) || qty < 1 || qty > l.qty - l.usedQty) throw new ValidationError(`Enter 1 to ${l.qty - l.usedQty}.`);
  await prisma.purchasedLot.update({ where: { id: l.id }, data: { usedQty: { increment: qty } } });
}

// ───────────────────────────── wholesaler: into own stock ─────────────────────────────

/**
 * Book goods bought on FIRINGI into the wholesaler's stock with the distributor's lots and dates
 * (soonest first), each lot its own batch. Returns how much of `qty` had no dated lot (booked
 * without a lot by the caller).
 */
export async function stockPurchased(tx: Tx, i: { buyerCompanyId: string; orderId: string; sellerOfferId: string; ownOfferId: string; addressId: string; qty: number; unitCost: Prisma.Decimal; refType: string; refId: string; byUserId: string; note: string }) {
  const lots = await tx.purchasedLot.findMany({ where: { orderId: i.orderId, offerId: i.sellerOfferId, buyerCompanyId: i.buyerCompanyId, stockedAt: null }, orderBy: { expiresOn: "asc" } });
  let left = i.qty;
  const made: { batchId: string; qty: number; lotCode: string | null; expiresOn: Date }[] = [];
  for (const l of lots) {
    if (!left) break;
    const q = Math.min(left, l.qty - l.usedQty);
    if (q <= 0) continue;
    const r = await receive(tx, { offerId: i.ownOfferId, addressId: i.addressId, qty: q, unitCost: i.unitCost, lotCode: l.lotCode, expiresOn: l.expiresOn, source: "RECEIPT", refType: i.refType, refId: i.refId, byUserId: i.byUserId, note: i.note, separate: true });
    await tx.purchasedLot.update({ where: { id: l.id }, data: { ownBatchId: r.batchId, stockedAt: new Date() } });
    made.push({ batchId: r.batchId, qty: q, lotCode: l.lotCode, expiresOn: l.expiresOn });
    left -= q;
  }
  return { rest: left, made };
}

/** A wholesaler puts a delivered FIRINGI order (bought in the shop, not by purchase order) into its stock. */
export async function stockDeliveredOrder(ctx: Ctx, orderId: string, addressId: string) {
  if (ctx.company.type !== "WHOLESALER" || !can(ctx, ["vendor.inventory.manage", "vendor.purchasing.manage"])) throw new ForbiddenError();
  const order = await prisma.order.findFirst({ where: { id: orderId, buyerCompanyId: ctx.company.id }, include: { lines: { include: { offer: { select: { packagingUnitId: true } } } }, purchaseOrder: { select: { number: true } } } });
  if (!order) throw new NotFoundError("Order");
  if (order.status !== "DELIVERED") throw new ValidationError("Put the goods into stock once the order is delivered.");
  if (order.purchaseOrder) throw new ValidationError(`This order belongs to purchase order ${order.purchaseOrder.number} — receive it there.`);
  if (order.buyerStockedAt) throw new ValidationError("This order is already in your stock.");
  const wh = await prisma.address.findFirst({ where: { id: addressId, companyId: ctx.company.id, isActive: true, kind: { in: ["WAREHOUSE", "PICKUP"] } } });
  if (!wh) throw new ValidationError("Choose one of your warehouses.");
  const own = await prisma.vendorOffer.findMany({ where: { vendorCompanyId: ctx.company.id, status: { not: "ARCHIVED" }, packagingUnitId: { in: order.lines.map((l) => l.offer.packagingUnitId) } }, select: { id: true, packagingUnitId: true } });
  const missing = order.lines.filter((l) => !own.some((o) => o.packagingUnitId === l.offer.packagingUnitId)).length;
  let stocked = 0;
  await prisma.$transaction(async (tx) => {
    for (const l of order.lines) {
      const mine = own.find((o) => o.packagingUnitId === l.offer.packagingUnitId);
      const qty = l.qtyDelivered ?? l.qtyConfirmed ?? l.qtyOrdered;
      if (!mine || qty <= 0) continue;
      const { rest } = await stockPurchased(tx, { buyerCompanyId: ctx.company.id, orderId: order.id, sellerOfferId: l.offerId, ownOfferId: mine.id, addressId: wh.id, qty, unitCost: new D(l.unitSalePriceNet.toString()), refType: "ORDER", refId: order.id, byUserId: ctx.user.id, note: order.number });
      if (rest > 0) await receive(tx, { offerId: mine.id, addressId: wh.id, qty: rest, unitCost: l.unitSalePriceNet, source: "RECEIPT", refType: "ORDER", refId: order.id, byUserId: ctx.user.id, note: order.number });
      stocked++;
    }
    await tx.order.update({ where: { id: order.id }, data: { buyerStockedAt: new Date() } });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "inventory.order_stocked", entityType: "Order", entityId: order.id, after: { lines: stocked, notInCatalogue: missing } }, tx);
  });
  return { lines: stocked, missing };
}

// ───────────────────────────── daily job ─────────────────────────────

/**
 * Two alerts per lot (FIRINGI's days before the best-before) for unsold goods bought on FIRINGI.
 * A lot that arrives already inside the second window only gets the second alert.
 */
export async function runPurchaseExpiryAlerts() {
  const s = await alertSettings();
  if (!s.enabled) return { enabled: false, messages: 0, lots: 0 };
  const today = todayUtc();
  const lots = await prisma.purchasedLot.findMany({
    where: { expiresOn: { gte: today, lte: new Date(today.getTime() + s.firstDays * day) }, OR: [{ firstAlertAt: null }, { secondAlertAt: null }] },
    include: { order: { select: { number: true, id: true } } },
  });
  if (!lots.length) return { enabled: true, messages: 0, lots: 0 };
  const overrides = await companyOverrides();
  const rows = await withOwnStock(lots);
  const offers = await prisma.vendorOffer.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.offerId))] } }, select: { id: true, packaging: { select: { name: true, variant: { select: { product: { select: { name: true } } } } } } } });
  const buyers = await prisma.company.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.buyerCompanyId))] } }, select: { id: true, type: true, country: { select: { defaultLanguageCode: true } } } });
  const groups = new Map<string, { companyId: string; days: number; lots: typeof rows }>();
  let touched = 0;
  for (const l of rows) {
    if (overrides.get(l.buyerCompanyId) === false) continue;
    if (unsold(l, l.ownOnHand) <= 0) continue;
    const d = daysLeft(l.expiresOn);
    let which: "first" | "second" | null = null;
    if (d <= s.secondDays && !l.secondAlertAt) which = "second";
    else if (d <= s.firstDays && !l.firstAlertAt) which = "first";
    if (!which) continue;
    const days = which === "second" ? s.secondDays : s.firstDays;
    const k = `${l.buyerCompanyId}|${days}`;
    const g = groups.get(k) ?? { companyId: l.buyerCompanyId, days, lots: [] };
    g.lots.push(l);
    groups.set(k, g);
    await prisma.purchasedLot.update({ where: { id: l.id }, data: which === "second" ? { secondAlertAt: new Date(), firstAlertAt: l.firstAlertAt ?? new Date() } : { firstAlertAt: new Date() } });
    touched++;
  }
  let messages = 0;
  for (const g of groups.values()) {
    const locale = buyers.find((b) => b.id === g.companyId)?.country.defaultLanguageCode ?? "en";
    const names = [...new Set(g.lots.map((l) => { const o = offers.find((x) => x.id === l.offerId); return o ? pickLocalized(o.packaging.variant.product.name, locale) : "—"; }))];
    const products = names.slice(0, 3).join(", ") + (names.length > 3 ? ` (+${names.length - 3})` : "");
    await notify(ALERT_EVENT, [{ companyId: g.companyId, link: "/buy/orders/expiring" }], { count: String(names.length), days: String(g.days), products }, { ref: { type: "Company", id: g.companyId } });
    messages++;
  }
  return { enabled: true, messages, lots: touched };
}

// ───────────────────────────── FIRINGI view ─────────────────────────────

export async function adminPurchaseAlerts(ctx: Ctx) {
  requireStaff(ctx);
  const [s, overrides, companies, open, sent] = await Promise.all([
    alertSettings(), companyOverrides(),
    prisma.company.findMany({ where: { type: { in: ["WHOLESALER", "CUSTOMER"] }, status: "APPROVED" }, select: { id: true, legalName: true, tradeName: true, type: true, isInHouse: true }, orderBy: [{ type: "asc" }, { legalName: "asc" }] }),
    prisma.purchasedLot.groupBy({ by: ["buyerCompanyId"], where: { expiresOn: { gte: todayUtc(), lte: new Date(todayUtc().getTime() + 30 * day) } }, _count: { _all: true } }),
    prisma.notification.count({ where: { type: ALERT_EVENT, createdAt: { gte: new Date(Date.now() - 30 * day) } } }),
  ]);
  return {
    settings: s, sentLast30: sent,
    companies: companies.filter((c) => !c.isInHouse).map((c) => {
      const o = overrides.get(c.id) ?? null;
      return { id: c.id, name: c.tradeName ?? c.legalName, type: c.type, override: o, enabled: o ?? s.enabled, expiringLots: open.find((x) => x.buyerCompanyId === c.id)?._count._all ?? 0 };
    }),
  };
}

/** Can this wholesaler still put this delivered order into its stock? (shown on the order page) */
export async function stockInStatus(ctx: Ctx, orderId: string) {
  if (ctx.company.type !== "WHOLESALER" || !can(ctx, ["vendor.inventory.manage", "vendor.purchasing.manage"])) return null;
  const o = await prisma.order.findFirst({ where: { id: orderId, buyerCompanyId: ctx.company.id }, select: { status: true, buyerStockedAt: true, purchaseOrder: { select: { id: true, number: true } } } });
  if (!o || o.status !== "DELIVERED") return null;
  const warehouses = await prisma.address.findMany({ where: { companyId: ctx.company.id, isActive: true, kind: { in: ["WAREHOUSE", "PICKUP"] } }, select: { id: true, label: true }, orderBy: [{ kind: "asc" }, { label: "asc" }] });
  return { stocked: !!o.buyerStockedAt, purchaseOrder: o.purchaseOrder, warehouses };
}
