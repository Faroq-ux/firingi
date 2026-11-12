/** Read models for the back-office allocation pages (allocation managers only). */
import type { AllocationStatus, AllocationTrigger, Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { pickLocalized } from "@/i18n/config";
import { assertAllocationManager } from "./rules";

const name = (c: { legalName: string; tradeName: string | null }) => c.tradeName ?? c.legalName;
const since = (days: number) => new Date(Date.now() - days * 86400_000);
const dayStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const OPEN_STATUSES = ["PENDING_CONFIRMATION", "SUPPLIER_PROCESSING", "READY_FOR_PICKUP", "DISPATCHED", "OUT_FOR_DELIVERY"] as const;

const eventInclude = {
  order: { select: { id: true, number: true, flow: true, buyer: { select: { legalName: true, tradeName: true } } } },
  fromVendor: { select: { legalName: true, tradeName: true } },
} satisfies Prisma.AllocationEventInclude;

export type EventRow = Awaited<ReturnType<typeof listEvents>>["rows"][number];

export async function listEvents(ctx: Ctx, f: { status?: string; trigger?: string; orderId?: string; manualOnly?: boolean; page?: number } = {}) {
  assertAllocationManager(ctx);
  const where: Prisma.AllocationEventWhereInput = {
    ...(f.status ? { status: f.status as AllocationStatus } : {}),
    ...(f.trigger ? { trigger: f.trigger as AllocationTrigger } : {}),
    ...(f.orderId ? { OR: [{ orderId: f.orderId }, { order: { parentOrderId: f.orderId } }] } : {}),
    ...(f.manualOnly ? { OR: [{ automatic: false }, { marginOverride: true }, { status: "DISMISSED" }] } : {}),
  };
  const page = Math.max(1, f.page ?? 1);
  const [rows, total] = await Promise.all([
    prisma.allocationEvent.findMany({ where, include: eventInclude, orderBy: { createdAt: "desc" }, skip: (page - 1) * 50, take: 50 }),
    prisma.allocationEvent.count({ where }),
  ]);
  const userIds = [...new Set(rows.flatMap((r) => [r.byUserId, r.resolvedById]).filter(Boolean) as string[])];
  const users = new Map((await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  return {
    rows: rows.map((r) => ({
      id: r.id, createdAt: r.createdAt, trigger: r.trigger, status: r.status, automatic: r.automatic, note: r.note, marginOverride: r.marginOverride,
      absorbedNet: Number(r.absorbedNet), resolvedAt: r.resolvedAt, by: r.byUserId ? users.get(r.byUserId) ?? "—" : "System", resolvedBy: r.resolvedById ? users.get(r.resolvedById) ?? "—" : null,
      order: { id: r.order.id, number: r.order.number, flow: r.order.flow, buyer: name(r.order.buyer) }, from: name(r.fromVendor),
      newOrders: (r.newOrders ?? []) as { orderId: string; number: string; vendorId: string; goodsNet: number; marginNet: number }[],
      items: (r.items ?? []) as { sku: string; qty: number; name: Record<string, string> }[],
    })),
    total, page, pageCount: Math.max(1, Math.ceil(total / 50)),
  };
}

export async function controlTower(ctx: Ctx) {
  assertAllocationManager(ctx);
  const d30 = since(30);
  const [byStatus, auto, absorbed, needsAction, awaitingBuyer, openCount, waiting, recent] = await Promise.all([
    prisma.allocationEvent.groupBy({ by: ["status"], where: { createdAt: { gte: d30 } }, _count: true }),
    prisma.allocationEvent.count({ where: { createdAt: { gte: d30 }, automatic: true, status: { in: ["MOVED", "PARTIAL"] } } }),
    prisma.allocationEvent.aggregate({ where: { createdAt: { gte: d30 } }, _sum: { absorbedNet: true } }),
    // cases FIRINGI must act on come first (oldest first); cases waiting for the buyer's answer after them (newest first)
    prisma.allocationEvent.findMany({ where: { resolvedAt: null, status: { not: "AWAITING_BUYER" } }, include: eventInclude, orderBy: { createdAt: "asc" }, take: 100 }),
    prisma.allocationEvent.findMany({ where: { resolvedAt: null, status: "AWAITING_BUYER" }, include: eventInclude, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.allocationEvent.count({ where: { resolvedAt: null } }),
    prisma.$queryRaw<{ id: string; number: string; seller: string; buyer: string; since: Date; grand: number }[]>`
      SELECT o.id, o.number, coalesce(s."tradeName", s."legalName") AS seller, coalesce(b."tradeName", b."legalName") AS buyer,
             (SELECT max(h.at) FROM "OrderStatusHistory" h WHERE h."orderId" = o.id AND h."toStatus" = 'PENDING_CONFIRMATION') AS since, o."grandTotal"::float8 AS grand
      FROM "Order" o JOIN "Company" s ON s.id = o."sellerCompanyId" JOIN "Company" b ON b.id = o."buyerCompanyId"
      WHERE o.status = 'PENDING_CONFIRMATION' ORDER BY since ASC LIMIT 50`,
    listEvents(ctx, {}).then((r) => r.rows.filter((x) => x.status === "MOVED" || x.status === "PARTIAL").slice(0, 10)),
  ]);
  const count = (s: AllocationStatus) => byStatus.find((b) => b.status === s)?._count ?? 0;
  const moved = count("MOVED") + count("PARTIAL");
  const open = [...needsAction, ...awaitingBuyer];
  return {
    kpis: { moved, autoShare: moved ? auto / moved : 0, open: openCount, absorbed: Number(absorbed._sum.absorbedNet ?? 0), noCandidate: count("NO_CANDIDATE") },
    open: open.map((r) => ({ id: r.id, createdAt: r.createdAt, trigger: r.trigger, status: r.status, note: r.note, order: { id: r.order.id, number: r.order.number, buyer: name(r.order.buyer) }, from: name(r.fromVendor) })),
    waiting, recent,
  };
}

/** Orders the back office may move by hand (open cases first). */
export async function movableOrders(ctx: Ctx, q?: string) {
  assertAllocationManager(ctx);
  const search = q?.trim();
  return prisma.order.findMany({
    where: {
      ...(search ? { number: { contains: search, mode: "insensitive" } } : {}),
      OR: [
        { status: "PENDING_CONFIRMATION" },
        { allocations: { some: { resolvedAt: null } } },
        { status: { in: ["SUPPLIER_PROCESSING", "READY_FOR_PICKUP"] }, lines: { some: { qtyConfirmed: { not: null } } } },
      ],
    },
    select: {
      id: true, number: true, status: true, placedAt: true, grandTotal: true,
      buyer: { select: { legalName: true, tradeName: true } }, seller: { select: { legalName: true, tradeName: true } },
      lines: { select: { qtyOrdered: true, qtyConfirmed: true } },
      allocations: { where: { resolvedAt: null }, select: { id: true } },
    },
    orderBy: { placedAt: "desc" }, take: 50,
  }).then((rows) => rows
    .map((o) => ({ ...o, short: o.lines.some((l) => l.qtyConfirmed !== null && l.qtyConfirmed < l.qtyOrdered), openCase: o.allocations.length > 0, buyer: name(o.buyer), seller: name(o.seller) }))
    .filter((o) => o.status === "PENDING_CONFIRMATION" || o.openCase || o.short)
    .sort((a, b) => Number(b.openCase) - Number(a.openCase)));
}

/** Suppliers with their allocation profile, today's orders and 90-day reliability. */
export async function suppliers(ctx: Ctx) {
  assertAllocationManager(ctx);
  const d90 = since(90);
  const [companies, today, accepted, declined, open] = await Promise.all([
    prisma.company.findMany({
      where: { type: { in: ["WHOLESALER", "DISTRIBUTOR"] }, status: "APPROVED" },
      select: { id: true, legalName: true, tradeName: true, type: true, country: { select: { code: true, flag: true } }, allocationProfile: true },
      orderBy: { legalName: "asc" },
    }),
    prisma.order.groupBy({ by: ["sellerCompanyId"], where: { placedAt: { gte: dayStart() }, status: { not: "CANCELLED" } }, _count: true }),
    prisma.$queryRaw<{ id: string; n: number }[]>`
      SELECT o."sellerCompanyId" AS id, count(DISTINCT o.id)::int AS n FROM "Order" o JOIN "OrderStatusHistory" h ON h."orderId" = o.id
      WHERE h."toStatus" = 'SUPPLIER_PROCESSING' AND o."placedAt" >= ${d90} GROUP BY 1`,
    prisma.allocationEvent.groupBy({ by: ["fromVendorId"], where: { trigger: { in: ["DECLINED", "NO_RESPONSE"] }, createdAt: { gte: d90 } }, _count: true }),
    prisma.order.groupBy({ by: ["sellerCompanyId"], where: { status: { in: [...OPEN_STATUSES] } }, _count: true }),
  ]);
  const m = <T extends { _count: number }>(rows: T[], key: (r: T) => string) => new Map(rows.map((r) => [key(r), r._count]));
  const t = m(today, (r) => r.sellerCompanyId), dc = m(declined, (r) => r.fromVendorId), op = m(open, (r) => r.sellerCompanyId);
  const ac = new Map(accepted.map((r) => [r.id, Number(r.n)]));
  return companies.map((c) => {
    const a = ac.get(c.id) ?? 0, d = dc.get(c.id) ?? 0;
    return {
      id: c.id, name: name(c), type: c.type, country: `${c.country.flag ?? ""} ${c.country.code}`.trim(),
      priority: c.allocationProfile?.priority ?? 50, excluded: c.allocationProfile?.excluded ?? false, capacity: c.allocationProfile?.dailyOrderCapacity ?? null,
      note: c.allocationProfile?.note ?? null, today: t.get(c.id) ?? 0, open: op.get(c.id) ?? 0, accepted: a, declined: d, reliability: a + d >= 3 ? a / (a + d) : null,
    };
  });
}

/** Free stock of a product across suppliers. */
export async function stockAcrossSuppliers(ctx: Ctx, q: string, locale: string) {
  assertAllocationManager(ctx);
  const s = q.trim();
  if (s.length < 2) return [];
  const offers = await prisma.vendorOffer.findMany({
    where: {
      status: "ACTIVE",
      packaging: { variant: { OR: [{ sku: { contains: s, mode: "insensitive" } }, { product: { name: { path: ["en"], string_contains: s } } }, { product: { name: { path: ["pt"], string_contains: s } } }] } },
    },
    select: {
      id: true, leadTimeDays: true, vendor: { select: { id: true, legalName: true, tradeName: true, type: true, country: { select: { code: true } }, allocationProfile: { select: { excluded: true } } } },
      packaging: { select: { name: true, unitsPerPack: true, variant: { select: { sku: true, product: { select: { name: true } } } } } },
      stockLevels: { select: { onHand: true, reserved: true } },
    },
    take: 200,
  });
  return offers
    .map((o) => ({
      offerId: o.id, product: pickLocalized(o.packaging.variant.product.name, locale), sku: o.packaging.variant.sku, packaging: `${pickLocalized(o.packaging.name, locale)} (${o.packaging.unitsPerPack})`,
      vendor: name(o.vendor), vendorType: o.vendor.type, country: o.vendor.country.code, excluded: o.vendor.allocationProfile?.excluded ?? false, leadTimeDays: o.leadTimeDays,
      onHand: o.stockLevels.reduce((a, l) => a + l.onHand, 0), free: o.stockLevels.reduce((a, l) => a + l.onHand - l.reserved, 0),
    }))
    .sort((a, b) => a.sku.localeCompare(b.sku) || a.packaging.localeCompare(b.packaging) || b.free - a.free);
}

/** Suppliers with goods on the road / being prepared, by delivery region (route matching). */
export async function openDeliveriesByRegion(ctx: Ctx, locale: string) {
  assertAllocationManager(ctx);
  const rows = await prisma.$queryRaw<{ vendor: string; regionId: string | null; n: number }[]>`
    SELECT coalesce(s."tradeName", s."legalName") AS vendor, o."deliveryAddress"->>'regionId' AS "regionId", count(*)::int AS n
    FROM "Order" o JOIN "Company" s ON s.id = o."sellerCompanyId"
    WHERE o.status IN ('SUPPLIER_PROCESSING', 'READY_FOR_PICKUP', 'DISPATCHED', 'OUT_FOR_DELIVERY')
    GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 100`;
  const regions = new Map((await prisma.region.findMany({ where: { id: { in: rows.map((r) => r.regionId).filter(Boolean) as string[] } }, select: { id: true, name: true } })).map((r) => [r.id, pickLocalized(r.name, locale)]));
  return rows.map((r) => ({ vendor: r.vendor, region: r.regionId ? regions.get(r.regionId) ?? "—" : "—", orders: r.n }));
}

/** Buyers with open orders, per supplier (existing order matching). */
export async function openOrdersByBuyer(ctx: Ctx) {
  assertAllocationManager(ctx);
  return prisma.$queryRaw<{ buyer: string; vendor: string; n: number; total: number }[]>`
    SELECT coalesce(b."tradeName", b."legalName") AS buyer, coalesce(s."tradeName", s."legalName") AS vendor, count(*)::int AS n, sum(o."grandTotal")::float8 AS total
    FROM "Order" o JOIN "Company" b ON b.id = o."buyerCompanyId" JOIN "Company" s ON s.id = o."sellerCompanyId"
    WHERE o.status IN ('PENDING_CONFIRMATION', 'SUPPLIER_PROCESSING', 'READY_FOR_PICKUP', 'DISPATCHED', 'OUT_FOR_DELIVERY')
    GROUP BY 1, 2 ORDER BY 1, 3 DESC LIMIT 200`;
}

/** Moves per marketplace and margin impact (last 30 days). */
export async function moveStats(ctx: Ctx) {
  assertAllocationManager(ctx);
  const d30 = since(30);
  const [byFlow, margin] = await Promise.all([
    prisma.$queryRaw<{ flow: string; moved: number; failed: number }[]>`
      SELECT o.flow::text AS flow, count(*) FILTER (WHERE e.status IN ('MOVED', 'PARTIAL'))::int AS moved,
             count(*) FILTER (WHERE e.status IN ('NO_CANDIDATE', 'FAILED'))::int AS failed
      FROM "AllocationEvent" e JOIN "Order" o ON o.id = e."orderId" WHERE e."createdAt" >= ${d30} GROUP BY 1`,
    prisma.allocationEvent.aggregate({ where: { createdAt: { gte: d30 }, status: { in: ["MOVED", "PARTIAL"] } }, _sum: { absorbedNet: true }, _count: true }),
  ]);
  const overrides = await prisma.allocationEvent.count({ where: { createdAt: { gte: d30 }, marginOverride: true } });
  return { byFlow, absorbed: Number(margin._sum.absorbedNet ?? 0), moves: margin._count, overrides };
}

export async function activeCountries(ctx: Ctx, locale: string) {
  assertAllocationManager(ctx);
  const cs = await prisma.country.findMany({ where: { isActive: true }, orderBy: { code: "asc" }, select: { id: true, code: true, flag: true, name: true } });
  return cs.map((c) => ({ id: c.id, label: `${c.flag ?? ""} ${pickLocalized(c.name, locale) || c.code}`.trim() }));
}

/**
 * Small orders FIRINGI's fleet delivers (below the wholesaler's free-delivery minimum, or from
 * the in-house warehouse), not yet given to a driver — grouped by pickup point so one driver can
 * collect them together, with their delivery regions.
 */
export async function smallOrderGroups(ctx: Ctx, locale: string) {
  assertAllocationManager(ctx);
  const deliveries = await prisma.delivery.findMany({
    where: { mode: "FIRINGI_FLEET", status: "UNASSIGNED", order: { status: { in: ["SUPPLIER_PROCESSING", "READY_FOR_PICKUP"] } } },
    select: {
      id: true,
      order: {
        select: {
          id: true, number: true, status: true, netTotal: true, deliveryAddress: true, sellerCompanyId: true,
          seller: { select: { legalName: true, tradeName: true, isInHouse: true } },
          buyer: { select: { legalName: true, tradeName: true } },
          sourceAddress: { select: { label: true, cityName: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });
  const regionIds = [...new Set(deliveries.map((d) => (d.order.deliveryAddress as { regionId?: string | null }).regionId).filter(Boolean) as string[])];
  const regions = new Map((await prisma.region.findMany({ where: { id: { in: regionIds } }, select: { id: true, name: true } })).map((r) => [r.id, pickLocalized(r.name, locale)]));
  const groups = new Map<string, { supplier: string; inHouse: boolean; pickup: string; orders: { deliveryId: string; orderId: string; number: string; status: string; buyer: string; city: string; region: string; net: number }[] }>();
  for (const d of deliveries) {
    const o = d.order;
    const addr = o.deliveryAddress as { city?: string; regionId?: string | null };
    const g = groups.get(o.sellerCompanyId) ?? { supplier: name(o.seller), inHouse: o.seller.isInHouse, pickup: o.sourceAddress ? `${o.sourceAddress.label} · ${o.sourceAddress.cityName}` : "—", orders: [] };
    g.orders.push({ deliveryId: d.id, orderId: o.id, number: o.number, status: o.status, buyer: name(o.buyer), city: addr.city ?? "—", region: (addr.regionId && regions.get(addr.regionId)) || "—", net: Number(o.netTotal) });
    groups.set(o.sellerCompanyId, g);
  }
  const drivers = await prisma.driver.findMany({
    where: { status: "APPROVED", owner: { type: "ADMIN" } },
    select: { id: true, user: { select: { name: true } } },
  });
  return { groups: [...groups.values()].sort((a, b) => b.orders.length - a.orders.length), drivers: drivers.map((d) => ({ id: d.id, name: d.user.name })) };
}

/** Give a group of small orders to one FIRINGI driver (needs multi-order delivery for FIRINGI's fleet). */
export async function assignPickupRun(ctx: Ctx, deliveryIds: string[], driverId: string) {
  assertAllocationManager(ctx);
  const { assignDelivery } = await import("@/server/services/deliveries");
  let n = 0;
  for (const id of deliveryIds) {
    await assignDelivery(ctx, id, { driverId });
    n++;
  }
  return { assigned: n };
}
