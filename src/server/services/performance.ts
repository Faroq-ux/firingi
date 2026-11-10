/**
 * Margin rules, contract pricing overview, customer ratings, supplier scorecards and KPI targets.
 *
 * Margin: a supplier's offer earns FIRINGI its commission (the buyer pays the supplier's price,
 * FIRINGI pays the supplier price − commission), less FIRINGI-funded discounts. Margin rules
 * set the minimum (and target) margin per country, category or supplier — the most specific
 * rule wins. Supplier allocation uses the floor; offers below it are flagged.
 */
import { Prisma, type MarginScope } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "./audit";
import { computePnl, lastMonths } from "./profit";

const isAdmin = (ctx: Ctx, perms: Parameters<typeof can>[1]) => ctx.company.type === "ADMIN" && can(ctx, perms);
const r2 = (n: number) => Math.round(n * 100) / 100;

// ── margin rules ────────────────────────────────────────────────────────────

export type MarginRuleInput = { scope: MarginScope; countryId?: string | null; categoryId?: string | null; vendorCompanyId?: string | null; minMarginPercent: number; targetMarginPercent?: number | null; note?: string | null };

export async function listMarginRules(ctx: Ctx) {
  if (!isAdmin(ctx, ["admin.pricing.view", "admin.pricing.manage", "admin.finance.view"])) throw new ForbiddenError();
  const rules = await prisma.marginRule.findMany({ where: { isActive: true }, orderBy: [{ scope: "asc" }, { createdAt: "asc" }] });
  const [countries, cats, vendors] = await Promise.all([
    prisma.country.findMany({ where: { id: { in: rules.map((r) => r.countryId).filter(Boolean) as string[] } }, select: { id: true, code: true, flag: true } }),
    prisma.category.findMany({ where: { id: { in: rules.map((r) => r.categoryId).filter(Boolean) as string[] } }, select: { id: true, name: true } }),
    prisma.company.findMany({ where: { id: { in: rules.map((r) => r.vendorCompanyId).filter(Boolean) as string[] } }, select: { id: true, legalName: true } }),
  ]);
  const name = (r: (typeof rules)[number]) =>
    r.scope === "GLOBAL" ? "Everything" : r.scope === "COUNTRY" ? countries.find((c) => c.id === r.countryId)?.code ?? "?" : r.scope === "CATEGORY"
      ? ((cats.find((c) => c.id === r.categoryId)?.name as Record<string, string> | undefined)?.en ?? "?") : vendors.find((v) => v.id === r.vendorCompanyId)?.legalName ?? "?";
  return rules.map((r) => ({ ...r, target: name(r), min: Number(r.minMarginPercent), goal: r.targetMarginPercent === null ? null : Number(r.targetMarginPercent) }));
}

export async function saveMarginRule(ctx: Ctx, i: MarginRuleInput) {
  if (!isAdmin(ctx, "admin.pricing.manage")) throw new ForbiddenError();
  const min = Number(i.minMarginPercent), goal = i.targetMarginPercent == null ? null : Number(i.targetMarginPercent);
  if (!Number.isFinite(min) || min < -50 || min > 60) throw new ValidationError("Minimum margin must be between −50 % and 60 %.");
  if (goal !== null && (!Number.isFinite(goal) || goal < min)) throw new ValidationError("The target can't be below the minimum.");
  const where = {
    scope: i.scope,
    countryId: i.scope === "COUNTRY" ? i.countryId ?? null : null,
    categoryId: i.scope === "CATEGORY" ? i.categoryId ?? null : null,
    vendorCompanyId: i.scope === "VENDOR" ? i.vendorCompanyId ?? null : null,
  };
  if (i.scope === "COUNTRY" && !where.countryId) throw new ValidationError("Choose a country.");
  if (i.scope === "CATEGORY" && !where.categoryId) throw new ValidationError("Choose a category.");
  if (i.scope === "VENDOR" && !where.vendorCompanyId) throw new ValidationError("Choose a supplier.");
  const cur = await prisma.marginRule.findFirst({ where: { ...where, isActive: true } });
  const data = { minMarginPercent: min, targetMarginPercent: goal, note: i.note?.trim() || null, updatedById: ctx.user.id };
  const r = cur ? await prisma.marginRule.update({ where: { id: cur.id }, data }) : await prisma.marginRule.create({ data: { ...where, ...data } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "margin_rule.saved", entityType: "MarginRule", entityId: r.id, before: cur, after: { ...where, ...data } });
  return r;
}

export async function removeMarginRule(ctx: Ctx, id: string) {
  if (!isAdmin(ctx, "admin.pricing.manage")) throw new ForbiddenError();
  await prisma.marginRule.update({ where: { id }, data: { isActive: false, updatedById: ctx.user.id } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "margin_rule.removed", entityType: "MarginRule", entityId: id });
}

type Rule = { scope: MarginScope; countryId: string | null; categoryId: string | null; vendorCompanyId: string | null; minMarginPercent: Prisma.Decimal; targetMarginPercent: Prisma.Decimal | null };
/** The rule that applies (vendor > category > country > global); null = none. */
export function pickRule(rules: Rule[], at: { vendorId?: string | null; categoryIds?: string[]; countryId?: string | null }) {
  return rules.find((r) => r.scope === "VENDOR" && r.vendorCompanyId === at.vendorId)
    ?? rules.find((r) => r.scope === "CATEGORY" && at.categoryIds?.includes(r.categoryId ?? ""))
    ?? rules.find((r) => r.scope === "COUNTRY" && r.countryId === at.countryId)
    ?? rules.find((r) => r.scope === "GLOBAL") ?? null;
}

/** Minimum margin % for a supplier selling these categories in this country (null = no rule). */
export async function marginFloor(at: { vendorId: string; categoryIds: string[]; countryId: string }) {
  const rules = await prisma.marginRule.findMany({ where: { isActive: true } });
  const r = pickRule(rules, at);
  return r ? Number(r.minMarginPercent) : null;
}

/** Category → its ancestors (a rule on "Drinks" applies to "Soft drinks"). */
async function categoryLineage() {
  const cats = await prisma.category.findMany({ select: { id: true, parentId: true } });
  const parent = new Map(cats.map((c) => [c.id, c.parentId]));
  return (id: string) => { const out: string[] = []; for (let c: string | null | undefined = id; c; c = parent.get(c)) out.push(c); return out; };
}

/** Active offers whose margin (commission − FIRINGI-funded discounts ignored) is below the applicable floor or target. */
export async function marginWatch(ctx: Ctx) {
  if (!isAdmin(ctx, ["admin.pricing.view", "admin.pricing.manage", "admin.finance.view"])) throw new ForbiddenError();
  const rules = await prisma.marginRule.findMany({ where: { isActive: true } });
  if (!rules.length) return [];
  const lineage = await categoryLineage();
  const now = new Date();
  const [offers, commissions] = await Promise.all([
    prisma.vendorOffer.findMany({
      where: { status: "ACTIVE", vendor: { status: "APPROVED" } },
      select: { id: true, vendorCompanyId: true, countryId: true, vendor: { select: { legalName: true } }, packaging: { select: { name: true, variant: { select: { sku: true, product: { select: { name: true, categoryId: true } } } } } } },
      take: 3000,
    }),
    prisma.commissionRule.findMany({ where: { validFrom: { lte: now }, OR: [{ validTo: null }, { validTo: { gt: now } }], type: "PERCENT" }, orderBy: { validFrom: "desc" } }),
  ]);
  const rate = new Map<string, number>();
  for (const c of commissions) if (!rate.has(c.vendorCompanyId)) rate.set(c.vendorCompanyId, Number(c.rate));
  const out = [];
  for (const o of offers) {
    const r = pickRule(rules, { vendorId: o.vendorCompanyId, categoryIds: lineage(o.packaging.variant.product.categoryId), countryId: o.countryId });
    if (!r) continue;
    const margin = rate.get(o.vendorCompanyId) ?? 0;
    const min = Number(r.minMarginPercent), goal = r.targetMarginPercent === null ? null : Number(r.targetMarginPercent);
    if (margin < min || (goal !== null && margin < goal))
      out.push({ offerId: o.id, vendor: o.vendor.legalName, sku: o.packaging.variant.sku, product: (o.packaging.variant.product.name as Record<string, string>).en ?? o.packaging.variant.sku, margin, min, goal, below: margin < min ? ("MIN" as const) : ("TARGET" as const), scope: r.scope });
  }
  return out.sort((a, b) => (a.below === b.below ? a.margin - b.margin : a.below === "MIN" ? -1 : 1));
}

// ── contract pricing ────────────────────────────────────────────────────────

/** Special prices suppliers give individual customers (contract / customer lists) and groups. */
export async function contractPricing(ctx: Ctx, f: { vendorType?: "DISTRIBUTOR" | "WHOLESALER"; status?: "ACTIVE" | "EXPIRING" | "EXPIRED" | "ALL" } = {}) {
  if (!isAdmin(ctx, ["admin.pricing.view", "admin.pricing.manage", "admin.vendors.view"])) throw new ForbiddenError();
  const lists = await prisma.priceList.findMany({
    where: { scope: { in: ["CONTRACT", "CUSTOMER", "CUSTOMER_GROUP"] }, ...(f.vendorType ? { vendor: { type: f.vendorType } } : {}) },
    include: {
      vendor: { select: { id: true, legalName: true, type: true } }, targetCompany: { select: { id: true, legalName: true } }, targetGroup: { select: { id: true, name: true } },
      items: { select: { offerId: true, minQty: true, unitPriceNet: true } },
    },
    orderBy: [{ validTo: { sort: "asc", nulls: "last" } }],
  });
  // Discount against the supplier's base price for the same offer (minimum quantity 1).
  const offerIds = [...new Set(lists.flatMap((l) => l.items.map((i) => i.offerId)))];
  const base = await prisma.priceListItem.findMany({ where: { offerId: { in: offerIds }, minQty: 1, priceList: { scope: "BASE", isActive: true } }, select: { offerId: true, unitPriceNet: true } });
  const baseBy = new Map(base.map((b) => [b.offerId, Number(b.unitPriceNet)]));
  const now = Date.now(), soon = now + 30 * 86400_000;
  const rows = lists.map((l) => {
    const discounts = l.items.map((i) => { const b = baseBy.get(i.offerId); return b && b > 0 ? 1 - Number(i.unitPriceNet) / b : null; }).filter((x): x is number => x !== null);
    const status = !l.isActive || (l.validTo && l.validTo.getTime() < now) ? "EXPIRED" : l.validFrom.getTime() > now ? "FUTURE" : l.validTo && l.validTo.getTime() < soon ? "EXPIRING" : "ACTIVE";
    return {
      id: l.id, name: l.name, scope: l.scope, vendor: l.vendor, target: l.targetCompany?.legalName ?? l.targetGroup?.name ?? "—", targetId: l.targetCompany?.id ?? null,
      items: l.items.length, avgDiscount: discounts.length ? discounts.reduce((a, x) => a + x, 0) / discounts.length : null,
      maxDiscount: discounts.length ? Math.max(...discounts) : null, validFrom: l.validFrom, validTo: l.validTo, status,
    };
  });
  return f.status && f.status !== "ALL" ? rows.filter((r) => r.status === f.status) : rows;
}

// ── ratings ─────────────────────────────────────────────────────────────────

/** The customer rates a delivered order (and its delivery); can change it within 30 days. */
export async function rateOrder(ctx: Ctx, orderId: string, i: { stars: number; deliveryStars?: number | null; comment?: string | null }) {
  if (!can(ctx, ["buyer.orders.view", "buyer.orders.place"])) throw new ForbiddenError();
  const o = await prisma.order.findFirst({ where: { id: orderId, buyerCompanyId: ctx.company.id }, include: { rating: true } });
  if (!o) throw new NotFoundError("Order");
  if (o.status !== "DELIVERED") throw new ValidationError("You can rate an order once it's delivered.");
  const stars = Math.round(Number(i.stars)), ds = i.deliveryStars == null ? null : Math.round(Number(i.deliveryStars));
  if (!(stars >= 1 && stars <= 5) || (ds !== null && !(ds >= 1 && ds <= 5))) throw new ValidationError("Choose 1 to 5 stars.");
  if (o.rating && Date.now() - o.rating.createdAt.getTime() > 30 * 86400_000) throw new ValidationError("Ratings can be changed for 30 days.");
  const data = { stars, deliveryStars: ds, comment: i.comment?.trim().slice(0, 1000) || null };
  return o.rating
    ? prisma.orderRating.update({ where: { id: o.rating.id }, data })
    : prisma.orderRating.create({ data: { ...data, orderId, buyerCompanyId: o.buyerCompanyId, sellerCompanyId: o.sellerCompanyId, byUserId: ctx.user.id } });
}

/** The supplier answers a rating of one of its orders. */
export async function replyRating(ctx: Ctx, ratingId: string, reply: string) {
  if (!can(ctx, ["vendor.orders.manage", "vendor.orders.view"])) throw new ForbiddenError();
  const r = await prisma.orderRating.findFirst({ where: { id: ratingId, sellerCompanyId: ctx.company.id } });
  if (!r) throw new NotFoundError("Rating");
  if (!reply.trim()) throw new ValidationError("Write your answer.");
  return prisma.orderRating.update({ where: { id: ratingId }, data: { reply: reply.trim().slice(0, 1000), repliedAt: new Date() } });
}

export async function moderateRating(ctx: Ctx, ratingId: string, hidden: boolean) {
  if (!isAdmin(ctx, ["admin.vendors.approve", "admin.customers.manage"])) throw new ForbiddenError();
  const r = await prisma.orderRating.update({ where: { id: ratingId }, data: { hidden } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: hidden ? "rating.hidden" : "rating.shown", entityType: "OrderRating", entityId: ratingId });
  return r;
}

/** Ratings list: FIRINGI sees all (incl. hidden); a supplier sees its own visible ones. */
export async function listRatings(ctx: Ctx, f: { vendorId?: string; maxStars?: number } = {}) {
  const admin = ctx.company.type === "ADMIN";
  if (admin ? !can(ctx, ["admin.vendors.view", "admin.customers.view"]) : !can(ctx, ["vendor.orders.view", "vendor.orders.manage"])) throw new ForbiddenError();
  const rows = await prisma.orderRating.findMany({
    where: { ...(admin ? (f.vendorId ? { sellerCompanyId: f.vendorId } : {}) : { sellerCompanyId: ctx.company.id, hidden: false }), ...(f.maxStars ? { stars: { lte: f.maxStars } } : {}) },
    include: { order: { select: { id: true, number: true, routedByFiringi: true, buyer: { select: { legalName: true, tradeName: true } }, seller: { select: { id: true, legalName: true } } } } },
    orderBy: { createdAt: "desc" }, take: 300,
  });
  return rows;
}

/** Average stars per supplier (visible ratings). */
export async function ratingSummary(vendorIds?: string[]) {
  const rows = await prisma.orderRating.groupBy({ by: ["sellerCompanyId"], where: { hidden: false, ...(vendorIds ? { sellerCompanyId: { in: vendorIds } } : {}) }, _avg: { stars: true, deliveryStars: true }, _count: true });
  return new Map(rows.map((r) => [r.sellerCompanyId, { avg: r._avg.stars ?? null, delivery: r._avg.deliveryStars ?? null, count: r._count }]));
}

// ── supplier scorecards ─────────────────────────────────────────────────────

/**
 * Score 0–100 from: confirmation speed (≤ 2 h best), fill rate, declines / no answer,
 * on-time delivery (own fleet), returns and customer rating. Missing parts don't count.
 */
export async function supplierScorecards(ctx: Ctx, type: "DISTRIBUTOR" | "WHOLESALER" | "ALL", p: { from: Date; to: Date }, vendorId?: string) {
  const admin = ctx.company.type === "ADMIN";
  if (admin ? !can(ctx, ["admin.vendors.view", "admin.vendors.approve"]) : vendorId !== ctx.company.id) throw new ForbiddenError();
  const vendors = await prisma.company.findMany({
    where: { ...(vendorId ? { id: vendorId } : { type: type === "ALL" ? { in: ["DISTRIBUTOR", "WHOLESALER"] } : type }), status: "APPROVED", isInHouse: false },
    select: { id: true, legalName: true, tradeName: true, type: true, country: { select: { flag: true } } },
  });
  if (!vendors.length) return [];
  const ids = vendors.map((v) => v.id);
  const stats = await prisma.$queryRaw<{ id: string; orders: number; confirmH: number | null; ordered: number; confirmed: number; declined: number; delivered: number; ontime: number; timed: number; returns: number }[]>`
    SELECT c.id,
      (SELECT count(*) FROM "Order" o WHERE o."sellerCompanyId" = c.id AND o."placedAt" BETWEEN ${p.from} AND ${p.to})::int AS orders,
      (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM h."at" - o."placedAt") / 3600)
         FROM "Order" o JOIN "OrderStatusHistory" h ON h."orderId" = o.id AND h."toStatus" = 'SUPPLIER_PROCESSING'
         WHERE o."sellerCompanyId" = c.id AND o."placedAt" BETWEEN ${p.from} AND ${p.to})::float8 AS "confirmH",
      COALESCE((SELECT sum(l."qtyOrdered") FROM "OrderLine" l JOIN "Order" o ON o.id = l."orderId" WHERE o."sellerCompanyId" = c.id AND l."qtyConfirmed" IS NOT NULL AND o."placedAt" BETWEEN ${p.from} AND ${p.to}), 0)::float8 AS ordered,
      COALESCE((SELECT sum(l."qtyConfirmed") FROM "OrderLine" l JOIN "Order" o ON o.id = l."orderId" WHERE o."sellerCompanyId" = c.id AND l."qtyConfirmed" IS NOT NULL AND o."placedAt" BETWEEN ${p.from} AND ${p.to}), 0)::float8 AS confirmed,
      (SELECT count(*) FROM "AllocationEvent" e WHERE e."fromVendorId" = c.id AND e.trigger IN ('DECLINED', 'NO_RESPONSE') AND e."createdAt" BETWEEN ${p.from} AND ${p.to})::int AS declined,
      (SELECT count(*) FROM "Order" o WHERE o."sellerCompanyId" = c.id AND o.status = 'DELIVERED' AND o."placedAt" BETWEEN ${p.from} AND ${p.to})::int AS delivered,
      (SELECT count(*) FROM "Delivery" d JOIN "Order" o ON o.id = d."orderId" WHERE d."executingCompanyId" = c.id AND d.status = 'DELIVERED' AND o."placedAt" BETWEEN ${p.from} AND ${p.to}
         AND o."requestedDeliveryDate" IS NOT NULL AND d."completedAt" < o."requestedDeliveryDate" + interval '1 day')::int AS ontime,
      (SELECT count(*) FROM "Delivery" d JOIN "Order" o ON o.id = d."orderId" WHERE d."executingCompanyId" = c.id AND d.status = 'DELIVERED' AND o."placedAt" BETWEEN ${p.from} AND ${p.to}
         AND o."requestedDeliveryDate" IS NOT NULL)::int AS timed,
      (SELECT count(*) FROM "ReturnRequest" r JOIN "Order" o ON o.id = r."orderId" WHERE o."sellerCompanyId" = c.id AND r.status <> 'REJECTED' AND o."placedAt" BETWEEN ${p.from} AND ${p.to})::int AS returns
    FROM "Company" c WHERE c.id IN (${Prisma.join(ids)})`;
  const ratings = await ratingSummary(ids);
  const by = new Map(stats.map((s) => [s.id, s]));
  return vendors.map((v) => {
    const s = by.get(v.id)!;
    const rt = ratings.get(v.id);
    const fill = s.ordered > 0 ? s.confirmed / s.ordered : null;
    const declineRate = s.orders > 0 ? s.declined / s.orders : null;
    const onTime = s.timed > 0 ? s.ontime / s.timed : null;
    const returnRate = s.delivered > 0 ? s.returns / s.delivered : null;
    const parts: [number, number][] = []; // [score 0–1, weight]
    if (s.confirmH !== null) parts.push([Math.max(0, Math.min(1, 1 - (s.confirmH - 2) / 22)), 15]);
    if (fill !== null) parts.push([fill, 25]);
    if (declineRate !== null) parts.push([1 - Math.min(1, declineRate * 3), 20]);
    if (onTime !== null) parts.push([onTime, 15]);
    if (returnRate !== null) parts.push([1 - Math.min(1, returnRate * 5), 10]);
    if (rt?.avg) parts.push([(rt.avg - 1) / 4, 15]);
    const w = parts.reduce((a, [, x]) => a + x, 0);
    const score = w ? Math.round((parts.reduce((a, [sc, x]) => a + sc * x, 0) / w) * 100) : null;
    return {
      id: v.id, name: v.tradeName ?? v.legalName, type: v.type, flag: v.country.flag, orders: s.orders, confirmHours: s.confirmH === null ? null : r2(s.confirmH),
      fillRate: fill, declineRate, onTime, returnRate, rating: rt?.avg ?? null, ratingCount: rt?.count ?? 0, score,
    };
  }).sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
}

// ── KPI targets ─────────────────────────────────────────────────────────────

export const KPI_METRICS = [
  { key: "revenue", label: "Revenue (excl. VAT)", fmt: "money" },
  { key: "gross", label: "Gross profit", fmt: "money" },
  { key: "marginPct", label: "Gross margin", fmt: "percent" },
  { key: "net", label: "Net profit", fmt: "money" },
  { key: "orders", label: "Invoiced orders", fmt: "number" },
  { key: "aov", label: "Average order", fmt: "money" },
  { key: "activeBuyers", label: "Buying customers", fmt: "number" },
  { key: "newBuyers", label: "New customers approved", fmt: "number" },
  { key: "fillRate", label: "Supplier fill rate", fmt: "percent" },
  { key: "rating", label: "Customer rating", fmt: "number" },
] as const;
export type KpiKey = (typeof KPI_METRICS)[number]["key"];

export async function setKpiTarget(ctx: Ctx, month: Date, metric: KpiKey, target: number | null) {
  if (!isAdmin(ctx, ["admin.finance.manage", "admin.settings.manage"])) throw new ForbiddenError();
  if (!KPI_METRICS.some((m) => m.key === metric)) throw new ValidationError("Unknown KPI.");
  const m = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1));
  if (target === null) { await prisma.kpiTarget.deleteMany({ where: { month: m, metric } }); return; }
  if (!Number.isFinite(target)) throw new ValidationError("Enter a number.");
  await prisma.kpiTarget.upsert({ where: { month_metric: { month: m, metric } }, update: { target, updatedById: ctx.user.id }, create: { month: m, metric, target, updatedById: ctx.user.id } });
}

/** This month vs last month vs target, for every KPI. */
export async function kpiBoard(ctx: Ctx) {
  if (!isAdmin(ctx, ["admin.dashboard.view", "admin.finance.view", "admin.analytics.view"])) throw new ForbiddenError();
  const months = lastMonths(2);
  const [pnl, targets, buyers, newBuyers, fill, rating] = await Promise.all([
    computePnl({ months: 2 }),
    prisma.kpiTarget.findMany({ where: { month: { in: months } } }),
    prisma.$queryRaw<{ m: Date; n: number }[]>`SELECT date_trunc('month', "placedAt") AS m, count(DISTINCT "buyerCompanyId")::int AS n FROM "Order" WHERE status <> 'CANCELLED' AND "placedAt" >= ${months[0]} GROUP BY 1`,
    prisma.$queryRaw<{ m: Date; n: number }[]>`SELECT date_trunc('month', "approvedAt") AS m, count(*)::int AS n FROM "Company" WHERE type = 'CUSTOMER' AND "approvedAt" >= ${months[0]} GROUP BY 1`,
    prisma.$queryRaw<{ m: Date; f: number | null }[]>`SELECT date_trunc('month', o."placedAt") AS m, (sum(l."qtyConfirmed")::float8 / NULLIF(sum(l."qtyOrdered"), 0)) AS f FROM "OrderLine" l JOIN "Order" o ON o.id = l."orderId" WHERE l."qtyConfirmed" IS NOT NULL AND o."placedAt" >= ${months[0]} GROUP BY 1`,
    prisma.$queryRaw<{ m: Date; a: number | null }[]>`SELECT date_trunc('month', "createdAt") AS m, avg(stars)::float8 AS a FROM "OrderRating" WHERE NOT hidden AND "createdAt" >= ${months[0]} GROUP BY 1`,
  ]);
  const k = (d: Date) => d.toISOString().slice(0, 7);
  const val = (mi: number, metric: KpiKey): number | null => {
    const mk = k(months[mi]);
    const p = pnl.rows.find((x) => x.month === mk);
    switch (metric) {
      case "revenue": return p?.revenue ?? 0;
      case "gross": return p?.gross ?? 0;
      case "marginPct": return p?.marginPct ?? null;
      case "net": return p?.net ?? 0;
      case "orders": return p?.orders ?? 0;
      case "aov": return p && p.orders ? p.revenue / p.orders : null;
      case "activeBuyers": return buyers.find((x) => k(x.m) === mk)?.n ?? 0;
      case "newBuyers": return newBuyers.find((x) => k(x.m) === mk)?.n ?? 0;
      case "fillRate": return fill.find((x) => k(x.m) === mk)?.f ?? null;
      case "rating": return rating.find((x) => k(x.m) === mk)?.a ?? null;
    }
  };
  return {
    month: k(months[1]),
    rows: KPI_METRICS.map((m) => {
      const t = targets.find((x) => x.metric === m.key && k(x.month) === k(months[1]));
      const cur = val(1, m.key), prev = val(0, m.key);
      const target = t ? Number(t.target) : null;
      return { ...m, current: cur, previous: prev, target, progress: target && cur !== null && target !== 0 ? cur / target : null };
    }),
  };
}
