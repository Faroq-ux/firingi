/**
 * Price intelligence views (Phase 29): FIRINGI's overview and margin heat-map, suggestions
 * (commission and price reviews — FIRINGI decides, nothing is applied automatically), the
 * supplier's anonymous market position, and the customer's upcoming / recent price changes.
 */
import Decimal from "decimal.js";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { ForbiddenError } from "@/server/errors";
import { pickLocalized } from "@/i18n/config";
import { pickRule } from "@/server/services/performance";
import { orderingMode } from "@/server/allocation/mode";
import { deviationPct, position, stepSeries, type Change } from "./stats";
import { groupMarkets, marketKey, marketOffers, priceSettings, requireView, statsOf } from "./service";

const DAY = 86_400_000;
const nameOf = (n: unknown, locale = "en") => pickLocalized(n as Record<string, string>, locale);
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 10000) / 100 : 0);

// ── FIRINGI overview ────────────────────────────────────────────────────────

export async function priceOverview(ctx: Ctx) {
  requireView(ctx);
  const now = Date.now();
  const since = new Date(now - 84 * DAY);
  const [changes, alerts, pending, approved, offers] = await Promise.all([
    prisma.priceHistory.findMany({ where: { changedAt: { gte: since }, oldPrice: { not: null }, newPrice: { not: null } }, select: { changedAt: true, changePct: true, offerId: true, scope: true } }),
    prisma.priceAlert.groupBy({ by: ["kind"], where: { status: { in: ["OPEN", "ACKNOWLEDGED"] } }, _count: { _all: true } }),
    prisma.priceChangeRequest.count({ where: { status: "PENDING" } }),
    prisma.priceChangeRequest.count({ where: { status: "APPROVED" } }),
    marketOffers(),
  ]);
  const weeks = 12;
  const start = new Date(now - weeks * 7 * DAY);
  const points: string[] = [], up: number[] = [], down: number[] = [];
  for (let w = 0; w < weeks; w++) {
    const a = start.getTime() + w * 7 * DAY, b = a + 7 * DAY;
    points.push(new Date(a).toISOString().slice(0, 10));
    const inWeek = changes.filter((c) => c.changedAt.getTime() >= a && c.changedAt.getTime() < b);
    up.push(inWeek.filter((c) => Number(c.changePct) > 0).length);
    down.push(inWeek.filter((c) => Number(c.changePct) < 0).length);
  }
  const last30 = changes.filter((c) => c.changedAt.getTime() >= now - 30 * DAY);
  const markets = [...groupMarkets(offers).values()].map(statsOf).filter((s) => s && s.n >= 2);
  return {
    kpi: {
      changes30: last30.length, increases30: last30.filter((c) => Number(c.changePct) > 0).length, decreases30: last30.filter((c) => Number(c.changePct) < 0).length,
      avgChange30: last30.length ? Math.round((last30.reduce((a, c) => a + Number(c.changePct ?? 0), 0) / last30.length) * 100) / 100 : 0,
      openAlerts: alerts.reduce((a, g) => a + g._count._all, 0), pending, approved,
      markets: markets.length, avgSpread: markets.length ? Math.round(markets.reduce((a, s) => a + s!.spreadPct, 0) / markets.length) : 0,
    },
    alertsByKind: Object.fromEntries(alerts.map((g) => [g.kind, g._count._all])) as Partial<Record<"JUMP" | "ABOVE_MARKET" | "BELOW_MARKET", number>>,
    weekly: { points, series: [{ key: "up", label: "Increases", values: up }, { key: "down", label: "Decreases", values: down }] },
  };
}

// ── margin heat-map ─────────────────────────────────────────────────────────

export type HeatBy = "SUPPLIER" | "BUSINESS_TYPE" | "COUNTRY";
/** FIRINGI's margin (what the customer paid − what FIRINGI pays the supplier) per top category × supplier / customer type / country. */
export async function marginHeatmap(ctx: Ctx, f: { from: Date; to: Date; by: HeatBy }) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, ["admin.pricing.view", "admin.pricing.manage", "admin.finance.view"])) throw new ForbiddenError();
  const dim = f.by === "SUPPLIER" ? Prisma.sql`o."sellerCompanyId"` : f.by === "COUNTRY" ? Prisma.sql`b."countryId"` : Prisma.sql`COALESCE(b."businessType", lower(b.type::text))`;
  const rows = await prisma.$queryRaw<{ root: string; dim: string; sales: Prisma.Decimal; margin: Prisma.Decimal; lines: bigint }[]>`
    SELECT split_part(c.path, '/', 2) AS root, ${dim} AS dim, SUM(l."lineNet") AS sales, SUM(l."lineNet" - l."vendorLineNet") AS margin, COUNT(*) AS lines
    FROM "OrderLine" l JOIN "Order" o ON o.id = l."orderId" JOIN "Company" b ON b.id = o."buyerCompanyId"
    JOIN "VendorOffer" vo ON vo.id = l."offerId" JOIN "PackagingUnit" pp ON pp.id = vo."packagingUnitId"
    JOIN "ProductVariant" pv ON pv.id = pp."variantId" JOIN "Product" p ON p.id = pv."productId" JOIN "Category" c ON c.id = p."categoryId"
    WHERE o.status <> 'CANCELLED' AND o."placedAt" >= ${f.from} AND o."placedAt" < ${f.to}
    GROUP BY 1, 2`;
  const catIds = [...new Set(rows.map((r) => r.root))];
  const dimIds = [...new Set(rows.map((r) => r.dim))];
  const [cats, names] = await Promise.all([
    prisma.category.findMany({ where: { id: { in: catIds } }, select: { id: true, name: true, sortOrder: true } }),
    f.by === "SUPPLIER" ? prisma.company.findMany({ where: { id: { in: dimIds } }, select: { id: true, legalName: true, tradeName: true } }).then((c) => new Map(c.map((x) => [x.id, x.tradeName ?? x.legalName])))
      : f.by === "COUNTRY" ? prisma.country.findMany({ where: { id: { in: dimIds } }, select: { id: true, code: true, flag: true } }).then((c) => new Map(c.map((x) => [x.id, `${x.flag ?? ""} ${x.code}`])))
        : Promise.resolve(new Map<string, string>()),
  ]);
  const colTotals = new Map<string, number>();
  for (const r of rows) colTotals.set(r.dim, (colTotals.get(r.dim) ?? 0) + Number(r.sales));
  const cols = [...colTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id]) => ({ id, label: names.get(id) ?? id }));
  const cell = (cat: string, col: string) => {
    const r = rows.filter((x) => x.root === cat && (col === "*" ? true : x.dim === col));
    const sales = r.reduce((a, x) => a + Number(x.sales), 0), margin = r.reduce((a, x) => a + Number(x.margin), 0);
    return { sales: Math.round(sales * 100) / 100, margin: Math.round(margin * 100) / 100, pct: pct(margin, sales) };
  };
  const catRows = cats.sort((a, b) => a.sortOrder - b.sortOrder).map((c) => ({ id: c.id, label: nameOf(c.name), cells: cols.map((col) => cell(c.id, col.id)), total: cell(c.id, "*") }));
  const totalSales = rows.reduce((a, x) => a + Number(x.sales), 0), totalMargin = rows.reduce((a, x) => a + Number(x.margin), 0);
  return { cols, rows: catRows, colTotals: cols.map((col) => { const r = rows.filter((x) => x.dim === col.id); const s = r.reduce((a, x) => a + Number(x.sales), 0), m = r.reduce((a, x) => a + Number(x.margin), 0); return { sales: s, margin: m, pct: pct(m, s) }; }), total: { sales: totalSales, margin: totalMargin, pct: pct(totalMargin, totalSales) } };
}

// ── suggestions ─────────────────────────────────────────────────────────────

/**
 * Suggestions for FIRINGI (rule-based, explained; nothing is applied until someone decides):
 *  • commission — suppliers whose achieved margin over 90 days is under the margin rule's minimum:
 *    suggest the rule's target (or minimum) and what it would have earned;
 *  • price reviews — offers far above the market median (ask the supplier to review) or far below
 *    (a possible typo).
 */
export async function priceSuggestions(ctx: Ctx) {
  requireView(ctx);
  const s = await priceSettings();
  const since = new Date(Date.now() - 90 * DAY);
  const [byVendor, rules, commissions, vendors, offers] = await Promise.all([
    prisma.$queryRaw<{ vendor: string; sales: Prisma.Decimal; margin: Prisma.Decimal }[]>`
      SELECT o."sellerCompanyId" AS vendor, SUM(l."lineNet") AS sales, SUM(l."lineNet" - l."vendorLineNet") AS margin
      FROM "OrderLine" l JOIN "Order" o ON o.id = l."orderId"
      WHERE o.status <> 'CANCELLED' AND o."placedAt" >= ${since} GROUP BY 1`,
    prisma.marginRule.findMany({ where: { isActive: true } }),
    prisma.commissionRule.findMany({ where: { validTo: null, categoryId: null } }),
    prisma.company.findMany({ where: { type: { in: ["DISTRIBUTOR", "WHOLESALER"] }, status: "APPROVED", isInHouse: false }, select: { id: true, legalName: true, tradeName: true, countryId: true, type: true } }),
    marketOffers(),
  ]);
  const commission = [];
  for (const v of vendors) {
    const row = byVendor.find((x) => x.vendor === v.id);
    const sales = Number(row?.sales ?? 0), margin = Number(row?.margin ?? 0);
    if (sales <= 0) continue;
    const achieved = pct(margin, sales);
    const rule = pickRule(rules, { vendorId: v.id, countryId: v.countryId });
    const current = commissions.find((c) => c.vendorCompanyId === v.id);
    if (!rule) continue;
    const min = Number(rule.minMarginPercent), target = rule.targetMarginPercent === null ? null : Number(rule.targetMarginPercent);
    if (achieved >= min && (target === null || achieved >= target)) continue;
    const suggested = target ?? min;
    commission.push({
      vendorId: v.id, vendor: v.tradeName ?? v.legalName, type: v.type, sales: Math.round(sales * 100) / 100, achieved, currentRate: current ? Number(current.rate) : null, min, target, suggested,
      extra: Math.round(((suggested - achieved) / 100) * sales * 100) / 100, below: achieved < min ? ("MIN" as const) : ("TARGET" as const), ruleScope: rule.scope,
      why: `Margin over the last 90 days is ${achieved.toFixed(1)} % on ${sales.toFixed(0)} € sales; the ${rule.scope.toLowerCase()} margin rule asks for at least ${min} %${target !== null ? ` (target ${target} %)` : ""}.`,
    });
  }
  const reviews = [];
  for (const list of groupMarkets(offers).values()) {
    const st = statsOf(list);
    if (!st || st.n < s.minSuppliers) continue;
    for (const o of list) {
      const dev = deviationPct(o.unitPrice, st.median);
      if (Math.abs(dev) < s.outlierPct) continue;
      reviews.push({
        offerId: o.offerId, vendorId: o.vendorId, vendor: o.vendor, product: nameOf(o.product), sku: o.sku, variantId: o.variantId, price: o.price, unitsPerPack: o.unitsPerPack,
        median: st.median * o.unitsPerPack, p75: st.p75 * o.unitsPerPack, dev, kind: dev > 0 ? ("ABOVE" as const) : ("BELOW" as const), suppliers: st.n,
        why: dev > 0 ? `${dev.toFixed(0)} % above the median of ${st.n} suppliers — customers will pick others; suggest asking for ≤ ${(st.p75 * o.unitsPerPack).toFixed(2)} €.` : `${Math.abs(dev).toFixed(0)} % below the median of ${st.n} suppliers — check it isn't a typo.`,
      });
    }
  }
  return { commission: commission.sort((a, b) => b.extra - a.extra), reviews: reviews.sort((a, b) => Math.abs(b.dev) - Math.abs(a.dev)) };
}

// ── supplier: anonymous market position ─────────────────────────────────────

export async function supplierPriceInsights(ctx: Ctx) {
  if ((ctx.company.type !== "DISTRIBUTOR" && ctx.company.type !== "WHOLESALER") || !can(ctx, ["vendor.pricing.manage", "vendor.products.view", "vendor.products.manage"])) throw new ForbiddenError();
  const s = await priceSettings();
  const own = await marketOffers({ vendorCompanyId: ctx.company.id });
  const all = await marketOffers({ packaging: { variantId: { in: [...new Set(own.map((o) => o.variantId))] } } });
  const markets = groupMarkets(all);
  const now = new Date(), from = new Date(now.getTime() - 182 * DAY);
  const hist = await prisma.priceHistory.findMany({ where: { offerId: { in: own.map((o) => o.offerId) }, scope: "BASE", minQty: 1 }, orderBy: { changedAt: "asc" } });
  const rows = own.map((o) => {
    const st = statsOf(markets.get(marketKey(o)) ?? []);
    const comparable = !!st && st.n >= s.minSuppliers;
    const log: Change[] = hist.filter((h) => h.offerId === o.offerId).map((h) => ({ changedAt: h.changedAt, newPrice: h.newPrice === null ? null : Number(h.newPrice) }));
    const pos = comparable ? position(o.unitPrice, st!) : null;
    return {
      offerId: o.offerId, product: o.product, packaging: o.packaging, sku: o.sku, price: o.price, unitsPerPack: o.unitsPerPack,
      market: comparable ? { suppliers: st!.n, median: st!.median * o.unitsPerPack, cheapestQuarter: st!.p25 * o.unitsPerPack, dearestQuarter: st!.p75 * o.unitsPerPack, devPct: deviationPct(o.unitPrice, st!.median), position: pos } : null,
      suggestion: pos === "MOST_EXPENSIVE" ? { kind: "LOWER" as const, to: Math.floor(st!.p75 * o.unitsPerPack * 100) / 100 } : pos === "CHEAPEST" ? { kind: "BEST" as const, to: null } : null,
      history: stepSeries(log, from, now).map((p) => p.v).filter((v): v is number => v !== null),
      changes: log.filter((c) => c.changedAt >= from).length,
    };
  });
  const requests = await prisma.priceChangeRequest.findMany({
    where: { vendorCompanyId: ctx.company.id, OR: [{ status: { in: ["PENDING", "APPROVED"] } }, { updatedAt: { gte: new Date(Date.now() - 60 * DAY) } }] },
    include: { offer: { select: { packaging: { select: { name: true, variant: { select: { product: { select: { name: true } } } } } } } }, priceList: { select: { name: true, scope: true } } },
    orderBy: { createdAt: "desc" },
  });
  const count = (p: string) => rows.filter((r) => r.market?.position === p).length;
  return {
    settings: { approvalThresholdPct: s.approvalThresholdPct, noticeDays: s.noticeDays, minSuppliers: s.minSuppliers },
    summary: { offers: rows.length, compared: rows.filter((r) => r.market).length, cheapest: count("CHEAPEST"), belowMedian: count("BELOW_MEDIAN"), aboveMedian: count("ABOVE_MEDIAN"), dearest: count("MOST_EXPENSIVE") },
    rows: rows.sort((a, b) => (b.market?.devPct ?? -999) - (a.market?.devPct ?? -999)),
    requests: requests.map((r) => ({ id: r.id, product: r.offer.packaging.variant.product.name, packaging: r.offer.packaging.name, list: r.priceList.scope === "BASE" ? null : r.priceList.name, minQty: r.minQty, old: Number(r.oldPrice), new: Number(r.newPrice), pct: Number(r.changePct), status: r.status, effectiveAt: r.effectiveAt, note: r.decisionNote, createdAt: r.createdAt })),
  };
}

// ── customer: upcoming and recent price changes ─────────────────────────────

export async function buyerPriceChanges(ctx: Ctx) {
  if ((ctx.company.type !== "CUSTOMER" && ctx.company.type !== "WHOLESALER") || ctx.company.status !== "APPROVED" || !can(ctx, ["buyer.catalogue.view", "buyer.orders.place", "buyer.orders.view"])) throw new ForbiddenError();
  const s = await priceSettings();
  const since = new Date(Date.now() - Math.max(s.notifyBuyersDays, 90) * DAY);
  const [ordered, lists, recurring, groups] = await Promise.all([
    prisma.orderLine.findMany({ where: { order: { buyerCompanyId: ctx.company.id, placedAt: { gte: since }, status: { not: "CANCELLED" } } }, select: { offerId: true }, distinct: ["offerId"] }),
    prisma.orderListItem.findMany({ where: { list: { companyId: ctx.company.id } }, select: { offerId: true } }),
    prisma.recurringOrderItem.findMany({ where: { recurring: { buyerCompanyId: ctx.company.id, status: { not: "ENDED" } } }, select: { offerId: true } }),
    prisma.customerGroupMember.findMany({ where: { companyId: ctx.company.id }, select: { groupId: true } }),
  ]);
  const mine = [...new Set([...ordered, ...lists, ...recurring].map((x) => x.offerId))];
  const listWhere: Prisma.PriceListWhereInput = { OR: [{ scope: "BASE" }, { scope: "CUSTOMER_GROUP", targetGroupId: { in: groups.map((g) => g.groupId) } }, { scope: { in: ["CUSTOMER", "CONTRACT"] }, targetCompanyId: ctx.company.id }] };
  const firingi = (await orderingMode(ctx)) === "FIRINGI";
  const offerSelect = { packaging: { select: { name: true, variant: { select: { product: { select: { name: true } } } } } }, vendor: { select: { legalName: true, tradeName: true } } } as const;
  const [upcoming, recent] = await Promise.all([
    prisma.priceChangeRequest.findMany({
      where: { status: "APPROVED", effectiveAt: { gt: new Date() }, offerId: { in: mine }, priceList: listWhere },
      include: { offer: { select: offerSelect }, priceList: { select: { scope: true } } }, orderBy: { effectiveAt: "asc" },
    }),
    prisma.priceHistory.findMany({ where: { offerId: { in: mine }, changedAt: { gte: new Date(Date.now() - 30 * DAY) }, oldPrice: { not: null }, newPrice: { not: null } }, orderBy: { changedAt: "desc" }, take: 200 }),
  ]);
  const okLists = new Set((await prisma.priceList.findMany({ where: { id: { in: recent.map((r) => r.priceListId) }, ...listWhere }, select: { id: true } })).map((l) => l.id));
  const offers = new Map((await prisma.vendorOffer.findMany({ where: { id: { in: recent.map((r) => r.offerId) } }, select: { id: true, ...offerSelect } })).map((o) => [o.id, o]));
  const supplier = (v: { legalName: string; tradeName: string | null }) => (firingi ? "FIRINGI" : v.tradeName ?? v.legalName);
  return {
    upcoming: upcoming.map((r) => ({ id: r.id, product: r.offer.packaging.variant.product.name, packaging: r.offer.packaging.name, supplier: supplier(r.offer.vendor), minQty: r.minQty, old: Number(r.oldPrice), new: Number(r.newPrice), pct: Number(r.changePct), effectiveAt: r.effectiveAt!, offerId: r.offerId })),
    recent: recent.filter((r) => okLists.has(r.priceListId) && offers.has(r.offerId)).map((r) => {
      const o = offers.get(r.offerId)!;
      return { id: r.id, product: o.packaging.variant.product.name, packaging: o.packaging.name, supplier: supplier(o.vendor), minQty: r.minQty, old: Number(r.oldPrice), new: Number(r.newPrice), pct: Number(r.changePct ?? 0), at: r.changedAt, offerId: r.offerId };
    }),
    noticeDays: s.noticeDays,
  };
}

/** Change a supplier's commission to the suggested rate (goes through the usual commission rules, incl. four-eyes). */
export async function applyCommissionSuggestion(ctx: Ctx, vendorId: string, rate: number) {
  const { setCommissionRate } = await import("@/server/services/company");
  await setCommissionRate(ctx, vendorId, rate, "Suggested by Price Intelligence (margin below the margin rule)");
  return new Decimal(rate).toFixed(2);
}
