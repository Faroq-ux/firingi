/**
 * FIRINGI back office — coupons, customer offers and marketing analytics.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { ForbiddenError } from "@/server/errors";
import { campaignStats } from "./campaigns";

function assertView(ctx: Ctx) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, ["admin.marketing.view", "admin.marketing.manage", "admin.pricing.view", "admin.pricing.manage"])) throw new ForbiddenError();
}

const live = { order: { status: { not: "CANCELLED" as const } } };

/**
 * Coupons (with a code) or customer offers (automatic, aimed at someone, or € off / free delivery),
 * FIRINGI's and suppliers', with use and cost so far.
 */
export async function listOffers(ctx: Ctx, kind: "COUPONS" | "OFFERS") {
  assertView(ctx);
  const where: Prisma.PromotionWhereInput = kind === "COUPONS"
    ? { code: { not: null } }
    : { code: null, OR: [{ kind: { in: ["ORDER_AMOUNT", "FREE_DELIVERY", "BUY_X_GET_Y"] } }, { targets: { some: { OR: [{ buyerCompanyId: { not: null } }, { crmSegmentId: { not: null } }] } } }, { firstOrderOnly: true }] };
  const rows = await prisma.promotion.findMany({
    where, orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    include: {
      owner: { select: { legalName: true, tradeName: true } },
      targets: { include: { buyer: { select: { legalName: true } }, segment: { select: { name: true } }, customerGroup: { select: { name: true } }, category: { select: { name: true } }, vendor: { select: { legalName: true } } } },
      acceptances: { include: { vendor: { select: { legalName: true } } } },
    },
  });
  const used = await prisma.promotionRedemption.groupBy({ by: ["promotionId"], where: { promotionId: { in: rows.map((r) => r.id) }, ...live }, _count: { _all: true }, _sum: { amount: true, firingiAmount: true, vendorAmount: true } });
  return rows.map((r) => {
    const u = used.find((x) => x.promotionId === r.id);
    return { ...r, uses: u?._count._all ?? 0, given: Number(u?._sum.amount ?? 0), firingiPaid: Number(u?._sum.firingiAmount ?? 0), vendorPaid: Number(u?._sum.vendorAmount ?? 0) };
  });
}

/** Options for the offer / campaign forms. */
export async function marketingOptions(ctx: Ctx) {
  assertView(ctx);
  const [vendors, categories, groups, segments, buyers, promos, countries] = await Promise.all([
    prisma.company.findMany({ where: { type: { in: ["DISTRIBUTOR", "WHOLESALER"] }, status: "APPROVED" }, select: { id: true, legalName: true, type: true }, orderBy: { legalName: "asc" } }),
    prisma.category.findMany({ where: { isActive: true }, select: { id: true, name: true, depth: true }, orderBy: { path: "asc" } }),
    prisma.customerGroup.findMany({ where: { ownerCompanyId: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.crmSegment.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.company.findMany({ where: { type: { in: ["CUSTOMER", "WHOLESALER"] }, status: "APPROVED", isInHouse: false }, select: { id: true, legalName: true, type: true }, orderBy: { legalName: "asc" } }),
    prisma.promotion.findMany({ where: { status: "ACTIVE" }, select: { id: true, name: true, code: true }, orderBy: { createdAt: "desc" } }),
    prisma.country.findMany({ where: { companies: { some: { status: "APPROVED" } } }, select: { code: true, name: true }, orderBy: { code: "asc" } }),
  ]);
  const en = (n: unknown) => (n as { en?: string }).en ?? "";
  return {
    vendors: vendors.map((v) => ({ id: v.id, label: `${v.legalName} (${v.type.toLowerCase()})` })),
    categories: categories.map((c) => ({ id: c.id, label: `${"— ".repeat(c.depth)}${en(c.name)}` })),
    groups: groups.map((g) => ({ id: g.id, label: g.name })),
    segments: segments.map((s) => ({ id: s.id, label: s.name })),
    buyers: buyers.map((b) => ({ id: b.id, label: `${b.legalName} (${b.type.toLowerCase()})` })),
    promotions: promos.map((p) => ({ id: p.id, label: p.code ? `${p.code} — ${en(p.name)}` : en(p.name) })),
    countries: countries.map((c) => ({ id: c.code, label: `${c.code} — ${typeof c.name === "string" ? c.name : en(c.name)}` })),
  };
}

/**
 * Marketing analytics for a period: what offers cost and who paid, orders and goods sold with an
 * offer, coupon uses, by kind of offer, top offers, and campaign results.
 */
export async function marketingAnalytics(ctx: Ctx, p: { from: Date; to: Date }) {
  assertView(ctx);
  const inPeriod = { order: { status: { not: "CANCELLED" as const }, placedAt: { gte: p.from, lt: p.to } } };
  const [red, orders, all, campaigns] = await Promise.all([
    prisma.promotionRedemption.findMany({ where: inPeriod, select: { orderId: true, promotionId: true, code: true, amount: true, firingiAmount: true, vendorAmount: true, promotion: { select: { name: true, kind: true, code: true, ownerType: true, owner: { select: { legalName: true } } } } } }),
    prisma.order.findMany({ where: { status: { not: "CANCELLED" }, placedAt: { gte: p.from, lt: p.to }, redemptions: { some: {} } }, select: { id: true, netTotal: true, deliveryFeeNet: true } }),
    prisma.order.aggregate({ where: { status: { not: "CANCELLED" }, placedAt: { gte: p.from, lt: p.to } }, _count: { _all: true }, _sum: { netTotal: true, deliveryFeeNet: true } }),
    prisma.marketingCampaign.findMany({ where: { sentAt: { gte: p.from, lt: p.to } }, select: { id: true, name: true, channels: true, sentAt: true }, orderBy: { sentAt: "desc" } }),
  ]);
  const sum = (f: (r: (typeof red)[number]) => unknown) => red.reduce((a, r) => a + Number(f(r)), 0);
  const goodsWith = orders.reduce((a, o) => a + Number(o.netTotal) - Number(o.deliveryFeeNet), 0);
  const goodsAll = Number(all._sum.netTotal ?? 0) - Number(all._sum.deliveryFeeNet ?? 0);
  const byKind = new Map<string, { kind: string; uses: number; amount: number }>();
  const byPromo = new Map<string, { id: string; name: string; code: string | null; owner: string; kind: string; orders: Set<string>; amount: number; firingi: number; vendor: number }>();
  for (const r of red) {
    const k = byKind.get(r.promotion.kind) ?? { kind: r.promotion.kind, uses: 0, amount: 0 };
    k.uses++; k.amount += Number(r.amount); byKind.set(r.promotion.kind, k);
    const b = byPromo.get(r.promotionId) ?? { id: r.promotionId, name: (r.promotion.name as { en?: string }).en ?? "", code: r.promotion.code, owner: r.promotion.ownerType === "ADMIN" ? "FIRINGI" : r.promotion.owner?.legalName ?? "", kind: r.promotion.kind, orders: new Set(), amount: 0, firingi: 0, vendor: 0 };
    b.orders.add(r.orderId); b.amount += Number(r.amount); b.firingi += Number(r.firingiAmount); b.vendor += Number(r.vendorAmount);
    byPromo.set(r.promotionId, b);
  }
  const stats = await campaignStats(campaigns.map((c) => c.id));
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    discount: r2(sum((r) => r.amount)), firingiPaid: r2(sum((r) => r.firingiAmount)), vendorPaid: r2(sum((r) => r.vendorAmount)),
    ordersWithOffer: orders.length, orders: all._count._all, goodsWithOffer: r2(goodsWith), goods: r2(goodsAll),
    couponUses: new Set(red.filter((r) => r.code).map((r) => r.orderId)).size,
    byKind: [...byKind.values()].map((k) => ({ ...k, amount: r2(k.amount) })).sort((a, b) => b.amount - a.amount),
    top: [...byPromo.values()].map((b) => ({ ...b, orders: b.orders.size, amount: r2(b.amount), firingi: r2(b.firingi), vendor: r2(b.vendor) })).sort((a, b) => b.amount - a.amount).slice(0, 15),
    campaigns: campaigns.map((c) => ({ ...c, stats: stats.get(c.id)! })),
  };
}
