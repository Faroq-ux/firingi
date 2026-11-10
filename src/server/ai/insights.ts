/**
 * AI insights computed from FIRINGI's own orders, stock, prices and supplier records.
 * Every function is scoped by the caller:
 *   staff    — needs admin.ai.view plus the data right of that insight (orders, finance…)
 *   supplier — only its own offers / customers
 *   buyer    — only its own orders (never commission, supplier payouts or other buyers)
 * AI only suggests; nothing here changes an order, a price or stock.
 */
import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { ForbiddenError } from "@/server/errors";
import type { PermissionCode } from "@/server/rbac/permissions";
import { pickLocalized } from "@/i18n/config";
import { daysOfCover, holtForecast, median, nextOrder, trendOf, type CoverStatus } from "./forecast";
import type { RiskReason } from "@/lib/ai";

const DAY = 86400_000;
const LIVE: Prisma.Sql = Prisma.sql`o.status NOT IN ('CANCELLED', 'ON_HOLD')`;
const qty = Prisma.sql`COALESCE(l."qtyDelivered", l."qtyConfirmed", l."qtyOrdered")`;

export type Side = "STAFF" | "VENDOR" | "BUYER";
const SELLERS = ["DISTRIBUTOR", "WHOLESALER"];
const BUYERS = ["CUSTOMER", "WHOLESALER"];

/** Who may see what. Staff need the AI right and the right to the underlying data. */
export function aiScope(ctx: Ctx, side: Side, data: PermissionCode[] = []) {
  if (side === "STAFF") {
    if (ctx.company.type !== "ADMIN" || !can(ctx, "admin.ai.view") || (data.length && !can(ctx, data))) throw new ForbiddenError();
    return { sellerId: null as string | null, buyerId: null as string | null };
  }
  if (side === "VENDOR") {
    if (!SELLERS.includes(ctx.company.type) || !can(ctx, ["vendor.reports.view", "vendor.stock.manage", "vendor.products.manage", "vendor.dashboard.view"])) throw new ForbiddenError();
    return { sellerId: ctx.company.id, buyerId: null };
  }
  if (!BUYERS.includes(ctx.company.type) || !can(ctx, ["buyer.orders.view", "buyer.orders.place"])) throw new ForbiddenError();
  return { sellerId: null, buyerId: ctx.company.id };
}
export const canAi = (ctx: Ctx, side: Side, data: PermissionCode[] = []) => { try { aiScope(ctx, side, data); return true; } catch { return false; } };

const where = (s: { sellerId: string | null; buyerId: string | null }) => Prisma.sql`
  ${s.sellerId ? Prisma.sql`AND o."sellerCompanyId" = ${s.sellerId}` : Prisma.empty}
  ${s.buyerId ? Prisma.sql`AND o."buyerCompanyId" = ${s.buyerId}` : Prisma.empty}`;

async function offerInfo(ids: string[], locale: string) {
  if (!ids.length) return new Map<string, { product: string; pack: string; sku: string; vendorId: string; vendor: string; status: string }>();
  const rows = await prisma.vendorOffer.findMany({
    where: { id: { in: ids } },
    select: { id: true, status: true, vendorCompanyId: true, vendor: { select: { legalName: true, tradeName: true } }, packaging: { select: { name: true, variant: { select: { sku: true, product: { select: { name: true } } } } } } },
  });
  return new Map(rows.map((o) => [o.id, {
    product: pickLocalized(o.packaging.variant.product.name, locale), pack: pickLocalized(o.packaging.name, locale), sku: o.packaging.variant.sku,
    vendorId: o.vendorCompanyId, vendor: o.vendor.tradeName ?? o.vendor.legalName, status: o.status,
  }]));
}

/** Units sold per offer per week, oldest week first (index weeks-1 = the last 7 days). */
async function weeklyUnits(s: { sellerId: string | null; buyerId: string | null }, weeks: number, now: Date, offerIds?: string[]) {
  const from = new Date(now.getTime() - weeks * 7 * DAY);
  const rows = await prisma.$queryRaw<{ offerId: string; w: number; units: number }[]>`
    SELECT l."offerId", floor(EXTRACT(EPOCH FROM (${now}::timestamptz - o."placedAt")) / 604800)::int AS w, sum(${qty})::float8 AS units
    FROM "OrderLine" l JOIN "Order" o ON o.id = l."orderId"
    WHERE ${LIVE} AND o."placedAt" > ${from} AND o."placedAt" <= ${now} ${where(s)}
      ${offerIds ? Prisma.sql`AND l."offerId" IN (${Prisma.join(offerIds.length ? offerIds : ["-"])})` : Prisma.empty}
    GROUP BY 1, 2`;
  const out = new Map<string, number[]>();
  for (const r of rows) {
    if (r.w < 0 || r.w >= weeks) continue;
    const arr = out.get(r.offerId) ?? Array(weeks).fill(0);
    arr[weeks - 1 - r.w] += r.units;
    out.set(r.offerId, arr);
  }
  return out;
}

// ── demand forecast ─────────────────────────────────────────────────────────

export type DemandRow = { offerId: string; product: string; pack: string; sku: string; vendor: string; history: number[]; forecast: number[]; nextWeeks: number; lastWeeks: number; trend: number | null };

/** Next weeks' units per product (Holt smoothing over the last `weeks` weeks of orders). */
export async function demandForecast(ctx: Ctx, side: Side, opts: { weeks?: number; ahead?: number; limit?: number; locale?: string; now?: Date } = {}): Promise<DemandRow[]> {
  const s = aiScope(ctx, side, ["admin.orders.view", "admin.analytics.view", "admin.catalogue.view"]);
  const weeks = opts.weeks ?? 12, ahead = opts.ahead ?? 4, now = opts.now ?? new Date();
  const series = await weeklyUnits(s, weeks, now);
  const info = await offerInfo([...series.keys()], opts.locale ?? "en");
  const rows: DemandRow[] = [];
  for (const [offerId, history] of series) {
    const i = info.get(offerId);
    if (!i) continue;
    const forecast = holtForecast(history, ahead);
    const n = Math.min(ahead, weeks);
    rows.push({ offerId, product: i.product, pack: i.pack, sku: i.sku, vendor: i.vendor, history: history.map((v) => Math.round(v)), forecast, nextWeeks: Math.round(forecast.reduce((a, v) => a + v, 0)), lastWeeks: Math.round(history.slice(-n).reduce((a, v) => a + v, 0)), trend: trendOf(history, forecast) });
  }
  return rows.sort((a, b) => b.nextWeeks - a.nextWeeks).slice(0, opts.limit ?? 200);
}

// ── stock predictions ───────────────────────────────────────────────────────

export type StockRow = { offerId: string; product: string; pack: string; sku: string; vendorId: string; vendor: string; available: number; dailyUnits: number; days: number | null; status: CoverStatus; runsOutOn: string | null; nextTwoWeeks: number };

/** Days of stock left at the recent rate (last 28 days, or the forecast if it is higher). */
export async function stockPredictions(ctx: Ctx, side: Exclude<Side, "BUYER">, opts: { locale?: string; now?: Date; onlyAtRisk?: boolean } = {}): Promise<StockRow[]> {
  const s = aiScope(ctx, side, ["admin.catalogue.view", "admin.orders.view", "admin.allocation.manage"]);
  const now = opts.now ?? new Date();
  const stock = await prisma.$queryRaw<{ offerId: string; available: number }[]>`
    SELECT sl."offerId", sum(sl."onHand" - sl."reserved")::int AS available
    FROM "StockLevel" sl JOIN "VendorOffer" v ON v.id = sl."offerId"
    WHERE v.status = 'ACTIVE' ${s.sellerId ? Prisma.sql`AND v."vendorCompanyId" = ${s.sellerId}` : Prisma.empty}
    GROUP BY 1`;
  const ids = stock.map((r) => r.offerId);
  const series = await weeklyUnits(s, 8, now, ids);
  const info = await offerInfo(ids, opts.locale ?? "en");
  const rows: StockRow[] = [];
  for (const r of stock) {
    const i = info.get(r.offerId);
    if (!i) continue;
    const hist = series.get(r.offerId) ?? Array(8).fill(0);
    const recent = hist.slice(-4).reduce((a, v) => a + v, 0) / 28;
    const fc = holtForecast(hist, 2);
    const daily = Math.max(recent, (fc[0] ?? 0) / 7);
    const cover = daysOfCover(r.available, daily);
    if (opts.onlyAtRisk && !(cover.status === "OUT" || cover.status === "CRITICAL" || cover.status === "LOW")) continue;
    if (cover.status === "OUT" && daily === 0 && opts.onlyAtRisk) continue; // out of stock but nobody buys it
    rows.push({
      offerId: r.offerId, product: i.product, pack: i.pack, sku: i.sku, vendorId: i.vendorId, vendor: i.vendor, available: r.available, dailyUnits: Math.round(daily * 10) / 10,
      days: cover.days, status: cover.status, runsOutOn: cover.days === null ? null : new Date(now.getTime() + cover.days * DAY).toISOString().slice(0, 10), nextTwoWeeks: Math.round(fc.reduce((a, v) => a + v, 0)),
    });
  }
  const rank: Record<CoverStatus, number> = { OUT: 0, CRITICAL: 1, LOW: 2, OK: 3, NO_SALES: 4 };
  return rows.sort((a, b) => rank[a.status] - rank[b.status] || (a.days ?? 1e9) - (b.days ?? 1e9) || b.dailyUnits - a.dailyUnits);
}

// ── reorder predictions ─────────────────────────────────────────────────────

export type BasketLine = { offerId: string; product: string; pack: string; sku: string; qty: number; available: boolean };
export type ReorderRow = {
  buyerId: string; buyer: string; sellerId: string; seller: string; orders: number; gapDays: number; lastOrder: string; expected: string; overdueDays: number; due: boolean;
  usualNet: number; basket: BasketLine[];
};

/** When each customer usually orders again from each supplier, and what it usually buys. */
export async function reorderPredictions(ctx: Ctx, side: Side, opts: { locale?: string; now?: Date; onlyDue?: boolean; dueWithinDays?: number } = {}): Promise<ReorderRow[]> {
  const s = aiScope(ctx, side, ["admin.customers.view", "admin.crm.view", "admin.orders.view"]);
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - 180 * DAY);
  const orders = await prisma.$queryRaw<{ id: string; buyerId: string; sellerId: string; placedAt: Date; net: number; routed: boolean }[]>`
    SELECT o.id, o."buyerCompanyId" AS "buyerId", o."sellerCompanyId" AS "sellerId", o."placedAt", o."netTotal"::float8 AS net, o."routedByFiringi" AS routed
    FROM "Order" o WHERE ${LIVE} AND o."placedAt" > ${since} ${where(s)} ORDER BY o."placedAt"`;
  const pairs = new Map<string, typeof orders>();
  for (const o of orders) {
    const k = `${o.buyerId}|${o.sellerId}`;
    pairs.set(k, [...(pairs.get(k) ?? []), o]);
  }
  const candidates: { k: string; list: typeof orders; nx: NonNullable<ReturnType<typeof nextOrder>> }[] = [];
  for (const [k, list] of pairs) {
    // Several orders on one day (a split cart, a correction) count as one.
    const days = [...new Map(list.map((o) => [o.placedAt.toISOString().slice(0, 10), o.placedAt])).values()];
    const nx = nextOrder(days, now);
    if (!nx || days.length < 3) continue;
    if (opts.onlyDue && nx.overdueDays < -(opts.dueWithinDays ?? 0)) continue;
    candidates.push({ k, list, nx });
  }
  if (!candidates.length) return [];
  const lastIds = candidates.flatMap((c) => c.list.slice(-6).map((o) => o.id));
  const lines = await prisma.orderLine.findMany({ where: { orderId: { in: lastIds } }, select: { orderId: true, offerId: true, qtyOrdered: true, qtyDelivered: true, qtyConfirmed: true } });
  const companies = await prisma.company.findMany({ where: { id: { in: [...new Set(candidates.flatMap((c) => c.k.split("|")))] } }, select: { id: true, legalName: true, tradeName: true } });
  const cname = new Map(companies.map((c) => [c.id, c.tradeName ?? c.legalName]));
  const offerIds = [...new Set(lines.map((l) => l.offerId))];
  const [info, live] = await Promise.all([
    offerInfo(offerIds, opts.locale ?? "en"),
    prisma.vendorOffer.findMany({ where: { id: { in: offerIds }, status: "ACTIVE", vendor: { status: "APPROVED" } }, select: { id: true } }),
  ]);
  const active = new Set(live.map((o) => o.id));
  return candidates.map(({ k, list, nx }) => {
    const [buyerId, sellerId] = k.split("|");
    const recent = list.slice(-6);
    const per = new Map<string, number[]>();
    for (const o of recent) for (const l of lines.filter((x) => x.orderId === o.id)) per.set(l.offerId, [...(per.get(l.offerId) ?? []), l.qtyDelivered ?? l.qtyConfirmed ?? l.qtyOrdered]);
    const basket = [...per.entries()]
      .filter(([, q]) => q.length >= Math.ceil(recent.length / 2)) // in at least half of the recent orders
      .map(([offerId, q]) => { const i = info.get(offerId); return { offerId, product: i?.product ?? "?", pack: i?.pack ?? "", sku: i?.sku ?? "", qty: Math.max(1, Math.round(median(q))), available: active.has(offerId) }; })
      .sort((a, b) => b.qty - a.qty);
    return {
      // A buyer ordering from FIRINGI never sees which supplier FIRINGI picked.
      buyerId, buyer: cname.get(buyerId) ?? "?", sellerId, seller: side === "BUYER" && list.some((o) => o.routed) ? "FIRINGI" : cname.get(sellerId) ?? "?", orders: list.length, gapDays: nx.gapDays,
      lastOrder: nx.last.toISOString().slice(0, 10), expected: nx.expected.toISOString().slice(0, 10), overdueDays: nx.overdueDays, due: nx.due,
      usualNet: Math.round(median(recent.map((o) => o.net)) * 100) / 100, basket,
    };
  }).sort((a, b) => b.overdueDays - a.overdueDays);
}

// ── supplier recommendations (staff) ────────────────────────────────────────

export type SupplierRec = {
  product: string; pack: string; sku: string; currentOfferId: string; current: string; currentPrice: number; currentScore: number | null;
  betterOfferId: string; better: string; betterPrice: number; betterScore: number | null; betterStock: number; weeklyUnits: number; weeklySaving: number; reason: "CHEAPER" | "BETTER_SERVICE" | "BOTH";
};

/** The same product from another supplier that is cheaper (with stock) or clearly more reliable. */
export async function supplierRecommendations(ctx: Ctx, opts: { locale?: string; now?: Date } = {}): Promise<SupplierRec[]> {
  aiScope(ctx, "STAFF", ["admin.vendors.view", "admin.allocation.manage", "admin.pricing.view"]);
  const now = opts.now ?? new Date();
  const offers = await prisma.$queryRaw<{ offerId: string; packagingUnitId: string; vendorId: string; countryId: string; sellerType: string; price: number | null; stock: number }[]>`
    SELECT v.id AS "offerId", v."packagingUnitId", v."vendorCompanyId" AS "vendorId", v."countryId", v."sellerType"::text AS "sellerType",
      (SELECT min(pi."unitPriceNet") FROM "PriceListItem" pi JOIN "PriceList" pl ON pl.id = pi."priceListId"
         WHERE pi."offerId" = v.id AND pl.scope = 'BASE' AND pl."isActive" AND pi."minQty" = 1)::float8 AS price,
      COALESCE((SELECT sum(sl."onHand" - sl."reserved") FROM "StockLevel" sl WHERE sl."offerId" = v.id), 0)::int AS stock
    FROM "VendorOffer" v JOIN "Company" c ON c.id = v."vendorCompanyId"
    WHERE v.status = 'ACTIVE' AND c.status = 'APPROVED' AND NOT c."isInHouse"`;
  const groups = new Map<string, typeof offers>();
  for (const o of offers) if (o.price !== null) { const k = `${o.packagingUnitId}|${o.sellerType}|${o.sellerType === "WHOLESALER" ? o.countryId : ""}`; groups.set(k, [...(groups.get(k) ?? []), o]); }
  const multi = [...groups.values()].filter((g) => g.length > 1);
  if (!multi.length) return [];
  const ids = multi.flat().map((o) => o.offerId);
  const series = await weeklyUnits({ sellerId: null, buyerId: null }, 8, now, ids);
  const weekly = (id: string) => (series.get(id) ?? []).reduce((a, v) => a + v, 0) / 8;
  const scores = new Map<string, number | null>();
  if (can(ctx, ["admin.vendors.view", "admin.vendors.approve"])) {
    const { supplierScorecards } = await import("@/server/services/performance");
    for (const sc of await supplierScorecards(ctx, "ALL", { from: new Date(now.getTime() - 90 * DAY), to: now })) scores.set(sc.id, sc.score);
  }
  const info = await offerInfo(ids, opts.locale ?? "en");
  const out: SupplierRec[] = [];
  for (const g of multi) for (const cur of g) {
    const units = weekly(cur.offerId);
    if (units <= 0) continue;
    const curScore = scores.get(cur.vendorId) ?? null;
    const alts = g.filter((a) => a.offerId !== cur.offerId && a.stock >= units).map((a) => {
      const cheaper = a.price! < cur.price! * 0.98;
      const better = (scores.get(a.vendorId) ?? -1) >= (curScore ?? 101) + 15 && a.price! <= cur.price! * 1.03;
      return { a, cheaper, better, saving: (cur.price! - a.price!) * units };
    }).filter((x) => x.cheaper || x.better).sort((x, y) => y.saving - x.saving);
    const best = alts[0];
    if (!best) continue;
    const ci = info.get(cur.offerId)!, bi = info.get(best.a.offerId)!;
    out.push({
      product: ci.product, pack: ci.pack, sku: ci.sku, currentOfferId: cur.offerId, current: ci.vendor, currentPrice: cur.price!, currentScore: curScore,
      betterOfferId: best.a.offerId, better: bi.vendor, betterPrice: best.a.price!, betterScore: scores.get(best.a.vendorId) ?? null, betterStock: best.a.stock,
      weeklyUnits: Math.round(units * 10) / 10, weeklySaving: Math.round(Math.max(0, best.saving) * 100) / 100, reason: best.cheaper && best.better ? "BOTH" : best.cheaper ? "CHEAPER" : "BETTER_SERVICE",
    });
  }
  return out.sort((a, b) => b.weeklySaving - a.weeklySaving);
}

// ── margin opportunities (staff, finance) ───────────────────────────────────

export type MarginRow = { offerId: string; vendor: string; product: string; sku: string; margin: number; goal: number; below: "MIN" | "TARGET"; netLast8Weeks: number; yearlyGap: number };

/** Offers below the margin floor / target (margin rules), sized by what they sell: € a year missed. */
export async function marginOpportunities(ctx: Ctx, opts: { now?: Date } = {}): Promise<MarginRow[]> {
  aiScope(ctx, "STAFF", ["admin.finance.view", "admin.pricing.view", "admin.pricing.manage"]);
  const now = opts.now ?? new Date();
  const { marginWatch } = await import("@/server/services/performance");
  const watch = await marginWatch(ctx);
  if (!watch.length) return [];
  const since = new Date(now.getTime() - 56 * DAY);
  const net = await prisma.$queryRaw<{ offerId: string; net: number }[]>`
    SELECT l."offerId", sum(l."lineNet")::float8 AS net FROM "OrderLine" l JOIN "Order" o ON o.id = l."orderId"
    WHERE ${LIVE} AND o."placedAt" > ${since} AND l."offerId" IN (${Prisma.join(watch.map((w) => w.offerId))}) GROUP BY 1`;
  const by = new Map(net.map((r) => [r.offerId, r.net]));
  return watch.map((w) => {
    const goal = w.below === "MIN" ? w.min : (w.goal ?? w.min);
    const n = by.get(w.offerId) ?? 0;
    return { offerId: w.offerId, vendor: w.vendor, product: w.product, sku: w.sku, margin: w.margin, goal, below: w.below, netLast8Weeks: Math.round(n * 100) / 100, yearlyGap: Math.round(((n / 8) * 52 * (goal - w.margin)) / 100) };
  }).sort((a, b) => b.yearlyGap - a.yearlyGap || (a.below === "MIN" ? -1 : 1));
}

// ── delivery risk ───────────────────────────────────────────────────────────

export type DeliveryRiskRow = { orderId: string; number: string; buyer: string; seller: string; status: string; requested: string | null; score: number; level: "HIGH" | "MEDIUM" | "LOW"; reasons: RiskReason[] };

/** Open orders likely to arrive late or short: slow confirmation, date close or passed, not enough stock, late ETA, supplier history. */
export async function deliveryRisk(ctx: Ctx, side: Exclude<Side, "BUYER">, opts: { now?: Date; limit?: number } = {}): Promise<DeliveryRiskRow[]> {
  const s = aiScope(ctx, side, ["admin.orders.view", "admin.delivery.view"]);
  const now = opts.now ?? new Date();
  const open = await prisma.order.findMany({
    where: { status: { in: ["PENDING_CONFIRMATION", "SUPPLIER_PROCESSING", "READY_FOR_PICKUP", "DISPATCHED", "OUT_FOR_DELIVERY"] }, ...(s.sellerId ? { sellerCompanyId: s.sellerId } : {}) },
    select: {
      id: true, number: true, status: true, placedAt: true, requestedDeliveryDate: true, sellerCompanyId: true,
      buyer: { select: { legalName: true, tradeName: true } }, seller: { select: { legalName: true, tradeName: true } },
      delivery: { select: { eta: true, status: true } }, lines: { select: { offerId: true, qtyOrdered: true } },
    },
    orderBy: { placedAt: "asc" }, take: 500,
  });
  if (!open.length) return [];
  const sellerIds = [...new Set(open.map((o) => o.sellerCompanyId))];
  const [declines, stock] = await Promise.all([
    prisma.allocationEvent.groupBy({ by: ["fromVendorId"], where: { fromVendorId: { in: sellerIds }, trigger: { in: ["DECLINED", "NO_RESPONSE", "SHORTFALL"] }, createdAt: { gt: new Date(now.getTime() - 60 * DAY) } }, _count: { _all: true } }),
    prisma.stockLevel.groupBy({ by: ["offerId"], where: { offerId: { in: [...new Set(open.flatMap((o) => o.lines.map((l) => l.offerId)))] } }, _sum: { onHand: true } }),
  ]);
  const dec = new Map(declines.map((d) => [d.fromVendorId, d._count._all]));
  const onHand = new Map(stock.map((x) => [x.offerId, x._sum.onHand ?? 0]));
  const rows: DeliveryRiskRow[] = [];
  for (const o of open) {
    const reasons: RiskReason[] = [];
    let score = 0;
    const hours = (now.getTime() - o.placedAt.getTime()) / 3600_000;
    if (o.status === "PENDING_CONFIRMATION" && hours > 4) { score += hours > 24 ? 35 : 20; reasons.push({ code: "NOT_CONFIRMED", n: Math.round(hours) }); }
    const req = o.requestedDeliveryDate;
    if (req) {
      const left = (req.getTime() + DAY - now.getTime()) / 3600_000; // until the end of the requested day
      const notMoving = ["PENDING_CONFIRMATION", "SUPPLIER_PROCESSING"].includes(o.status);
      if (left < 0) { score += 45; reasons.push({ code: "DATE_PASSED" }); }
      else if (left < 24 && notMoving) { score += 30; reasons.push({ code: "DUE_SOON" }); }
      if (o.delivery?.eta && o.delivery.eta.getTime() > req.getTime() + DAY) { score += 25; reasons.push({ code: "LATE_ETA" }); }
    }
    if (o.status === "PENDING_CONFIRMATION") {
      const short = o.lines.filter((l) => onHand.has(l.offerId) && (onHand.get(l.offerId) ?? 0) < l.qtyOrdered).length;
      if (short) { score += 25; reasons.push({ code: "SHORT_STOCK", n: short }); }
    }
    const d = dec.get(o.sellerCompanyId) ?? 0;
    if (d >= 3) { score += 15; reasons.push({ code: "SUPPLIER_DECLINES", n: d }); }
    if (!score) continue;
    score = Math.min(100, score);
    rows.push({
      orderId: o.id, number: o.number, buyer: o.buyer.tradeName ?? o.buyer.legalName, seller: o.seller.tradeName ?? o.seller.legalName, status: o.status,
      requested: req?.toISOString().slice(0, 10) ?? null, score, level: score >= 50 ? "HIGH" : score >= 25 ? "MEDIUM" : "LOW", reasons,
    });
  }
  return rows.sort((a, b) => b.score - a.score).slice(0, opts.limit ?? 200);
}
