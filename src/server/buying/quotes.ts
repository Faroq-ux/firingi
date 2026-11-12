/**
 * Quotes / RFQ (Phase 26). A buyer asks one supplier (through FIRINGI) for prices on products and
 * quantities — from the cart, one request per supplier, with an optional target price per line.
 * The supplier answers with a unit price per line (what the buyer pays, excl. VAT) and a date the
 * offer is valid until — it sees what it receives after FIRINGI's usual commission. The buyer
 * accepts (→ an order at exactly those prices, no promotions on top; the buyer's own approval
 * rules still apply) or rejects. FIRINGI's commission is never shown to the buyer.
 */
import Decimal from "decimal.js";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";
import { notify } from "@/server/notify/dispatch";
import { nextNumber, activeCommission } from "@/server/services/orders";
import { pricedOffers } from "@/server/data/catalogue-buyer";
import { pickLocalized } from "@/i18n/config";

const BUY = ["buyer.orders.place"] as const;
const SELL = ["vendor.pricing.manage", "vendor.orders.manage"] as const;
const SELL_SEE = ["vendor.pricing.manage", "vendor.orders.manage", "vendor.orders.view"] as const;
const OPEN = ["REQUESTED", "QUOTED"] as const;
const day = 86_400_000;
const today = () => { const d = new Date(); return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); };
const cname = (c: { legalName: string; tradeName: string | null }) => c.tradeName ?? c.legalName;

function requireBuyer(ctx: Ctx, perms: readonly string[] = ["buyer.orders.place", "buyer.orders.view"]) {
  if ((ctx.company.type !== "CUSTOMER" && ctx.company.type !== "WHOLESALER") || ctx.company.status !== "APPROVED" || !can(ctx, perms as never)) throw new ForbiddenError();
}
function requireSeller(ctx: Ctx, perms: readonly string[] = SELL_SEE) {
  if ((ctx.company.type !== "DISTRIBUTOR" && ctx.company.type !== "WHOLESALER") || ctx.company.status !== "APPROVED" || !can(ctx, perms as never)) throw new ForbiddenError();
}

const OFFER = { select: { id: true, vendorSku: true, vendorCompanyId: true, packaging: { select: { name: true, variant: { select: { product: { select: { name: true } } } } } } } } as const;

/** Ask for quotes: one request per supplier in `items` (defaults to the cart). */
export async function requestQuotes(ctx: Ctx, i: { items?: { offerId: string; qty: number; targetUnitNet?: number | null }[]; note?: string | null; neededBy?: Date | null }) {
  requireBuyer(ctx, BUY);
  let items = i.items;
  if (!items) {
    const cart = await prisma.cart.findUnique({ where: { buyerCompanyId_userId: { buyerCompanyId: ctx.company.id, userId: ctx.user.id } }, include: { items: true } });
    items = (cart?.items ?? []).map((x) => ({ offerId: x.offerId, qty: x.qty }));
  }
  if (!items.length) throw new ValidationError("Add products first.");
  if (items.length > 100) throw new ValidationError("At most 100 products in one request.");
  for (const x of items) {
    if (!Number.isInteger(x.qty) || x.qty <= 0) throw new ValidationError("Quantities must be whole numbers above 0.");
    if (x.targetUnitNet != null && !(x.targetUnitNet > 0)) throw new ValidationError("A target price must be above 0.");
  }
  if (i.neededBy && i.neededBy.getTime() < today().getTime()) throw new ValidationError("The date has passed.");
  const { items: priced, unavailable } = await pricedOffers(ctx, items.map((x) => ({ offerId: x.offerId, qty: x.qty })));
  if (unavailable.length || priced.some((p) => !p.price)) throw new ValidationError("Some products are not available to you.");
  const bySeller = new Map<string, typeof priced>();
  for (const p of priced) bySeller.set(p.vendorCompanyId, [...(bySeller.get(p.vendorCompanyId) ?? []), p]);
  const created = await prisma.$transaction(async (tx) => {
    const out: { id: string; number: string; sellerId: string; lines: number }[] = [];
    for (const [sellerId, lines] of bySeller) {
      const q = await tx.quoteRequest.create({
        data: {
          number: await nextNumber(tx, "quote", "QR"), buyerCompanyId: ctx.company.id, sellerCompanyId: sellerId, requestedById: ctx.user.id, note: i.note?.trim() || null, neededBy: i.neededBy ?? null,
          lines: { create: lines.map((l) => ({ offerId: l.offerId, qty: l.qty, listUnitNet: new Decimal(l.price!.unitPriceNet).toFixed(4), targetUnitNet: items!.find((x) => x.offerId === l.offerId)?.targetUnitNet ?? null })) },
        },
      });
      out.push({ id: q.id, number: q.number, sellerId, lines: lines.length });
    }
    return out;
  });
  const buyer = cname(ctx.company);
  for (const q of created) {
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "quote.requested", entityType: "QuoteRequest", entityId: q.id, after: { number: q.number, lines: q.lines } });
    await notify("quote.requested", [{ companyId: q.sellerId, link: `/vendor/orders/quotes/${q.id}` }], { number: q.number, buyer, lines: q.lines }, { ref: { type: "QuoteRequest", id: q.id } }).catch(() => null);
  }
  return created.map((q) => ({ id: q.id, number: q.number }));
}

async function loadQuote(id: string) {
  return prisma.quoteRequest.findUnique({
    where: { id },
    include: { buyer: { select: { legalName: true, tradeName: true } }, seller: { select: { legalName: true, tradeName: true } }, lines: { include: { offer: OFFER }, orderBy: { id: "asc" } } },
  });
}
type Loaded = NonNullable<Awaited<ReturnType<typeof loadQuote>>>;
const isExpired = (q: { status: string; validUntil: Date | null }) => q.status === "QUOTED" && !!q.validUntil && q.validUntil.getTime() < today().getTime();

function lineView(l: Loaded["lines"][number], locale: string) {
  return {
    id: l.id, offerId: l.offerId, sku: l.offer.vendorSku, product: pickLocalized(l.offer.packaging.variant.product.name, locale), packaging: pickLocalized(l.offer.packaging.name, locale), qty: l.qty,
    listUnitNet: l.listUnitNet.toString(), targetUnitNet: l.targetUnitNet?.toString() ?? null, quotedUnitNet: l.quotedUnitNet?.toString() ?? null,
  };
}
const total = (lines: { qty: number; quotedUnitNet: string | null }[]) => lines.reduce((a, l) => a.plus(new Decimal(l.quotedUnitNet ?? 0).mul(l.qty)), new Decimal(0)).toFixed(2);
const listTotal = (lines: { qty: number; listUnitNet: string }[]) => lines.reduce((a, l) => a.plus(new Decimal(l.listUnitNet).mul(l.qty)), new Decimal(0)).toFixed(2);

// ───────────────────────────── buyer ─────────────────────────────

export async function buyerQuotes(ctx: Ctx) {
  requireBuyer(ctx);
  const rows = await prisma.quoteRequest.findMany({ where: { buyerCompanyId: ctx.company.id }, include: { seller: { select: { legalName: true, tradeName: true } }, lines: true }, orderBy: { createdAt: "desc" }, take: 300 });
  return rows.map((q) => ({
    id: q.id, number: q.number, status: isExpired(q) ? "EXPIRED" : q.status, supplier: cname(q.seller), createdAt: q.createdAt, validUntil: q.validUntil, lines: q.lines.length,
    total: q.status === "REQUESTED" ? null : total(q.lines.map((l) => ({ qty: l.qty, quotedUnitNet: l.quotedUnitNet?.toString() ?? null }))), orderId: q.orderId,
  }));
}

/** The buyer's view: the supplier's prices next to the buyer's normal price. Never commission. */
export async function buyerQuote(ctx: Ctx, id: string, locale: string) {
  requireBuyer(ctx);
  const q = await loadQuote(id);
  if (!q || q.buyerCompanyId !== ctx.company.id) throw new NotFoundError("Quote");
  const lines = q.lines.map((l) => lineView(l, locale));
  const status = isExpired(q) ? "EXPIRED" : q.status;
  return {
    id: q.id, number: q.number, status, supplier: cname(q.seller), note: q.note, neededBy: q.neededBy, supplierNote: q.supplierNote, validUntil: q.validUntil, createdAt: q.createdAt, quotedAt: q.quotedAt,
    decidedAt: q.decidedAt, decisionNote: q.decisionNote, orderId: q.orderId, lines, total: total(lines), listTotal: listTotal(lines),
    canAccept: status === "QUOTED" && can(ctx, "buyer.orders.place"), canReject: status === "QUOTED", canCancel: status === "REQUESTED" || status === "QUOTED",
  };
}

export async function acceptQuote(ctx: Ctx, id: string, i: { deliveryAddressId: string; notes?: string | null; requestedDeliveryDate?: Date | null }) {
  requireBuyer(ctx, BUY);
  const q = await loadQuote(id);
  if (!q || q.buyerCompanyId !== ctx.company.id) throw new NotFoundError("Quote");
  if (q.status !== "QUOTED" || isExpired(q)) throw new ValidationError(isExpired(q) ? "This quote has expired — ask for a new one." : "This quote can't be accepted now.");
  const { placeOrder } = await import("@/server/services/orders");
  const placed = await placeOrder(ctx, {
    deliveryAddressId: i.deliveryAddressId, notes: [`${q.number}`, i.notes?.trim()].filter(Boolean).join(" — "), requestedDeliveryDate: i.requestedDeliveryDate ?? null,
    items: q.lines.map((l) => ({ offerId: l.offerId, qty: l.qty })), fixedPrices: new Map(q.lines.map((l) => [l.offerId, l.quotedUnitNet!.toString()])), source: { type: "QUOTE", id: q.id },
  });
  if (placed.approval) return { approval: placed.approval, orders: [] as { id: string; number: string }[] };
  await markAccepted(ctx, q.id, placed.orders);
  return { orders: placed.orders };
}

async function markAccepted(ctx: Ctx, id: string, orders: { id: string; number: string }[]) {
  await prisma.quoteRequest.update({ where: { id }, data: { status: "ACCEPTED", decidedAt: new Date(), decidedById: ctx.user.id, orderId: orders[0]?.id ?? null } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "quote.accepted", entityType: "QuoteRequest", entityId: id, after: { orders } });
}

/** The buyer's manager approved an accepted quote: place it at the quoted prices (even if the date passed meanwhile). */
export async function acceptQuoteApproved(ctx: Ctx, id: string, i: { deliveryAddressId: string; notes?: string | null; requestedDeliveryDate?: Date | null }) {
  const q = await loadQuote(id);
  if (!q || q.buyerCompanyId !== ctx.company.id) throw new NotFoundError("Quote");
  if (q.status !== "QUOTED") throw new ValidationError("This quote can no longer be accepted.");
  const { placeOrder } = await import("@/server/services/orders");
  const placed = await placeOrder(ctx, {
    deliveryAddressId: i.deliveryAddressId, notes: i.notes ?? q.number, requestedDeliveryDate: i.requestedDeliveryDate ?? null,
    items: q.lines.map((l) => ({ offerId: l.offerId, qty: l.qty })), fixedPrices: new Map(q.lines.map((l) => [l.offerId, l.quotedUnitNet!.toString()])), approved: true, source: { type: "QUOTE", id: q.id },
  });
  await markAccepted(ctx, q.id, placed.orders);
  return placed.orders;
}

export async function rejectQuote(ctx: Ctx, id: string, reason?: string | null) {
  requireBuyer(ctx);
  const q = await prisma.quoteRequest.findFirst({ where: { id, buyerCompanyId: ctx.company.id } });
  if (!q) throw new NotFoundError("Quote");
  if (q.status !== "QUOTED" && q.status !== "REQUESTED") throw new ValidationError("This quote is closed.");
  const to = q.status === "QUOTED" ? "REJECTED" : "CANCELLED";
  await prisma.quoteRequest.update({ where: { id }, data: { status: to, decidedAt: new Date(), decidedById: ctx.user.id, decisionNote: reason?.trim() || null } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: `quote.${to.toLowerCase()}`, entityType: "QuoteRequest", entityId: id, after: { reason } });
}

// ───────────────────────────── supplier ─────────────────────────────

export async function supplierQuotes(ctx: Ctx) {
  requireSeller(ctx);
  const rows = await prisma.quoteRequest.findMany({ where: { sellerCompanyId: ctx.company.id }, include: { buyer: { select: { legalName: true, tradeName: true } }, lines: true }, orderBy: { createdAt: "desc" }, take: 300 });
  return rows.map((q) => ({
    id: q.id, number: q.number, status: isExpired(q) ? "EXPIRED" : q.status, buyer: cname(q.buyer), createdAt: q.createdAt, neededBy: q.neededBy, validUntil: q.validUntil, lines: q.lines.length,
    total: q.status === "REQUESTED" ? null : total(q.lines.map((l) => ({ qty: l.qty, quotedUnitNet: l.quotedUnitNet?.toString() ?? null }))),
  }));
}

/** The supplier's view: what the buyer asked for, and what the supplier receives at each price (after FIRINGI's commission). */
export async function supplierQuote(ctx: Ctx, id: string, locale: string) {
  requireSeller(ctx);
  const q = await loadQuote(id);
  if (!q || q.sellerCompanyId !== ctx.company.id) throw new NotFoundError("Quote");
  const commission = await activeCommission(prisma as never, ctx.company.id);
  const rate = commission ? new Decimal(commission.rate.toString()) : new Decimal(0);
  const lines = q.lines.map((l) => lineView(l, locale));
  const status = isExpired(q) ? "EXPIRED" : q.status;
  return {
    id: q.id, number: q.number, status, buyer: cname(q.buyer), note: q.note, neededBy: q.neededBy, supplierNote: q.supplierNote, validUntil: q.validUntil, createdAt: q.createdAt, quotedAt: q.quotedAt,
    decisionNote: q.decisionNote, orderId: q.orderId, commissionRate: rate.toString(), lines, total: total(lines), listTotal: listTotal(lines),
    payout: lines.reduce((a, l) => a.plus(new Decimal(l.quotedUnitNet ?? 0).mul(l.qty).mul(new Decimal(100).minus(rate)).div(100)), new Decimal(0)).toFixed(2),
    canAnswer: (status === "REQUESTED" || status === "QUOTED") && can(ctx, SELL as never),
  };
}

export async function answerQuote(ctx: Ctx, id: string, i: { lines: { lineId: string; unitNet: number }[]; validUntil: Date; note?: string | null }) {
  requireSeller(ctx, SELL);
  const q = await prisma.quoteRequest.findFirst({ where: { id, sellerCompanyId: ctx.company.id }, include: { lines: true } });
  if (!q) throw new NotFoundError("Quote");
  if (!OPEN.includes(q.status as (typeof OPEN)[number])) throw new ValidationError("This request is closed.");
  if (i.validUntil.getTime() < today().getTime() || i.validUntil.getTime() > today().getTime() + 90 * day) throw new ValidationError("Valid until: today up to 90 days ahead.");
  if (i.lines.length !== q.lines.length) throw new ValidationError("Give a price for every product.");
  for (const l of i.lines) {
    if (!q.lines.some((x) => x.id === l.lineId)) throw new ValidationError("Unknown line.");
    if (!(l.unitNet > 0) || l.unitNet > 1_000_000) throw new ValidationError("Prices must be above 0.");
  }
  await prisma.$transaction(async (tx) => {
    for (const l of i.lines) await tx.quoteLine.update({ where: { id: l.lineId }, data: { quotedUnitNet: new Decimal(l.unitNet).toFixed(4) } });
    await tx.quoteRequest.update({ where: { id }, data: { status: "QUOTED", validUntil: i.validUntil, supplierNote: i.note?.trim() || null, quotedAt: new Date(), quotedById: ctx.user.id } });
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "quote.answered", entityType: "QuoteRequest", entityId: id, after: { lines: i.lines, validUntil: i.validUntil } });
  await notify("quote.answered", [{ companyId: q.buyerCompanyId, link: `/buy/orders/quotes/${id}` }], { number: q.number, supplier: cname(ctx.company), until: i.validUntil.toISOString().slice(0, 10) }, { ref: { type: "QuoteRequest", id } }).catch(() => null);
}

export async function declineQuote(ctx: Ctx, id: string, reason: string) {
  requireSeller(ctx, SELL);
  if (!reason.trim()) throw new ValidationError("Please give a reason.");
  const q = await prisma.quoteRequest.findFirst({ where: { id, sellerCompanyId: ctx.company.id } });
  if (!q) throw new NotFoundError("Quote");
  if (!OPEN.includes(q.status as (typeof OPEN)[number])) throw new ValidationError("This request is closed.");
  await prisma.quoteRequest.update({ where: { id }, data: { status: "DECLINED", decidedAt: new Date(), decidedById: ctx.user.id, decisionNote: reason.trim() } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "quote.declined", entityType: "QuoteRequest", entityId: id, after: { reason } });
  await notify("quote.declined", [{ companyId: q.buyerCompanyId, link: `/buy/orders/quotes/${id}` }], { number: q.number, supplier: cname(ctx.company), reason: reason.trim() }, { ref: { type: "QuoteRequest", id } }).catch(() => null);
}

// ───────────────────────────── FIRINGI ─────────────────────────────

export async function adminQuotes(ctx: Ctx) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, ["admin.orders.view", "admin.orders.manage"])) throw new ForbiddenError();
  const rows = await prisma.quoteRequest.findMany({ include: { buyer: { select: { legalName: true, tradeName: true } }, seller: { select: { legalName: true, tradeName: true } }, lines: true }, orderBy: { createdAt: "desc" }, take: 500 });
  const rates = new Map<string, Decimal>();
  for (const sid of new Set(rows.map((r) => r.sellerCompanyId))) {
    const c = await activeCommission(prisma as never, sid);
    rates.set(sid, c ? new Decimal(c.rate.toString()) : new Decimal(0));
  }
  return rows.map((q) => {
    const lines = q.lines.map((l) => ({ qty: l.qty, quotedUnitNet: l.quotedUnitNet?.toString() ?? null, listUnitNet: l.listUnitNet.toString() }));
    const t = q.status === "REQUESTED" ? null : new Decimal(total(lines));
    const list = new Decimal(listTotal(lines));
    return {
      id: q.id, number: q.number, status: isExpired(q) ? "EXPIRED" : q.status, buyer: cname(q.buyer), supplier: cname(q.seller), createdAt: q.createdAt, quotedAt: q.quotedAt, validUntil: q.validUntil,
      lines: q.lines.length, listTotal: list.toFixed(2), total: t?.toFixed(2) ?? null, discountPct: t && list.gt(0) ? list.minus(t).div(list).mul(100).toDecimalPlaces(1).toString() : null,
      commission: t ? t.mul(rates.get(q.sellerCompanyId)!).div(100).toFixed(2) : null, orderId: q.orderId,
    };
  });
}

/** Daily: quotes past their date expire. */
export async function expireQuotes() {
  const r = await prisma.quoteRequest.updateMany({ where: { status: "QUOTED", validUntil: { lt: today() } }, data: { status: "EXPIRED", decidedAt: new Date() } });
  return r.count;
}
