/**
 * Reporting engine — every analytics screen and export reads through here.
 *
 *   basis "placed"    — orders by placement date, all except cancelled (bookings)
 *   basis "delivered" — orders by delivery date, delivered or returned (recognised sales)
 *
 * Dimensions and metrics are whitelisted SQL fragments (never user text). Order-level
 * figures come from the frozen order totals; product / category breakdowns from the lines.
 *   goods margin = goods net − what FIRINGI owes the vendor (= commission − FIRINGI-funded discounts)
 *   FIRINGI revenue = goods margin + delivery fees
 * Who sees what is decided by analyticsScope(): FIRINGI (regional managers only their
 * regions' buyers), a vendor only its own sales, a buyer only its own purchases.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { scopeWhere } from "@/server/services/admin-access";
import { pickLocalized } from "@/i18n/config";

export type Basis = "placed" | "delivered";
export type Filters = {
  from: Date; // inclusive
  to: Date; // exclusive
  basis: Basis;
  countryId?: string | null;
  sellerType?: "WHOLESALER" | "DISTRIBUTOR" | null;
  vendorId?: string | null;
  buyerId?: string | null;
  buyerIds?: string[] | null; // regional scope
  categoryId?: string | null; // line level: this category and below
};

export const DIMENSIONS = ["day", "week", "month", "vendor", "buyer", "country", "sellerCountry", "flow", "deliveryMode", "region", "product", "category", "categoryRoot"] as const;
export type Dim = (typeof DIMENSIONS)[number];
export const METRICS = ["orders", "buyers", "units", "net", "goodsNet", "gross", "vat", "commission", "margin", "fees", "revenue", "discount", "payout", "aov"] as const;
export type Metric = (typeof METRICS)[number];

const LINE_DIMS: Dim[] = ["product", "category", "categoryRoot"];
const ORDER_ONLY: Metric[] = ["gross", "vat", "fees", "revenue", "discount", "goodsNet"];
export const LINE_METRICS: Metric[] = ["orders", "buyers", "units", "net", "commission", "margin", "payout", "aov"];

const DIM_SQL: Record<Dim, Prisma.Sql> = {
  day: Prisma.sql`date_trunc('day', o.d)`,
  week: Prisma.sql`date_trunc('week', o.d)`,
  month: Prisma.sql`date_trunc('month', o.d)`,
  vendor: Prisma.sql`o."sellerCompanyId"`,
  buyer: Prisma.sql`o."buyerCompanyId"`,
  country: Prisma.sql`o."countryId"`,
  sellerCountry: Prisma.sql`(SELECT s."countryId" FROM "Company" s WHERE s.id = o."sellerCompanyId")`,
  flow: Prisma.sql`o.flow::text`,
  deliveryMode: Prisma.sql`coalesce(o."deliveryMode"::text, '-')`,
  region: Prisma.sql`coalesce(o."deliveryAddress"->>'regionId', '-')`,
  product: Prisma.sql`p.id`,
  category: Prisma.sql`c.id`,
  categoryRoot: Prisma.sql`split_part(c.path, '/', 2)`,
};

const qty = Prisma.sql`coalesce(l."qtyDelivered", l."qtyConfirmed", l."qtyOrdered")`;
function metricSql(m: Metric, line: boolean): Prisma.Sql {
  if (line) {
    switch (m) {
      case "orders": return Prisma.sql`count(DISTINCT o.id)::float8`;
      case "buyers": return Prisma.sql`count(DISTINCT o."buyerCompanyId")::float8`;
      case "units": return Prisma.sql`sum(${qty})::float8`;
      case "net": return Prisma.sql`sum(l."lineNet")::float8`;
      case "commission": return Prisma.sql`sum(l."commissionAmount")::float8`;
      case "margin": return Prisma.sql`sum(l."lineNet" - l."vendorLineNet")::float8`;
      case "payout": return Prisma.sql`sum(l."vendorLineNet")::float8`;
      case "aov": return Prisma.sql`(sum(l."lineNet") / nullif(count(DISTINCT o.id), 0))::float8`;
      default: throw new ValidationError(`"${m}" is not available per product or category.`);
    }
  }
  switch (m) {
    case "orders": return Prisma.sql`count(*)::float8`;
    case "buyers": return Prisma.sql`count(DISTINCT o."buyerCompanyId")::float8`;
    case "units": throw new ValidationError("Units are counted per product line — add a product or category dimension.");
    case "net": return Prisma.sql`sum(o."netTotal")::float8`;
    case "goodsNet": return Prisma.sql`sum(o."netTotal" - o."deliveryFeeNet")::float8`;
    case "gross": return Prisma.sql`sum(o."grandTotal")::float8`;
    case "vat": return Prisma.sql`sum(o."vatTotal")::float8`;
    case "commission": return Prisma.sql`sum(o."commissionTotal")::float8`;
    case "margin": return Prisma.sql`sum(o."firingiMarginNet")::float8`;
    case "fees": return Prisma.sql`sum(o."deliveryFeeNet")::float8`;
    // FIRINGI's own income: goods margin + the fees of FIRINGI's fleet (a supplier's flat rate is passed on).
    case "revenue": return Prisma.sql`sum(o."firingiMarginNet" + CASE WHEN o."deliveryMode" = 'FIRINGI_FLEET' THEN o."deliveryFeeNet" ELSE 0 END)::float8`;
    case "discount": return Prisma.sql`sum(o."discountTotal")::float8`;
    case "payout": return Prisma.sql`sum(o."vendorPayableNet")::float8`;
    case "aov": return Prisma.sql`(sum(o."netTotal") / nullif(count(*), 0))::float8`;
  }
}

/** The filtered orders as a CTE "o" with the basis date in column d. */
function baseCte(f: Filters): Prisma.Sql {
  const deliveredAt = Prisma.sql`(SELECT min(h.at) FROM "OrderStatusHistory" h WHERE h."orderId" = ord.id AND h."toStatus" = 'DELIVERED')`;
  const date = f.basis === "delivered" ? deliveredAt : Prisma.sql`ord."placedAt"`;
  const status = f.basis === "delivered" ? Prisma.sql`ord.status IN ('DELIVERED', 'RETURNED')` : Prisma.sql`ord.status <> 'CANCELLED'`;
  const conds: Prisma.Sql[] = [status];
  if (f.countryId) conds.push(Prisma.sql`ord."countryId" = ${f.countryId}`);
  if (f.sellerType) conds.push(Prisma.sql`ord.flow = ${f.sellerType === "WHOLESALER" ? "CUSTOMER_FROM_WHOLESALER" : "WHOLESALER_FROM_DISTRIBUTOR"}::"OrderFlow"`);
  if (f.vendorId) conds.push(Prisma.sql`ord."sellerCompanyId" = ${f.vendorId}`);
  if (f.buyerId) conds.push(Prisma.sql`ord."buyerCompanyId" = ${f.buyerId}`);
  if (f.buyerIds) conds.push(f.buyerIds.length ? Prisma.sql`ord."buyerCompanyId" IN (${Prisma.join(f.buyerIds)})` : Prisma.sql`false`);
  return Prisma.sql`
    WITH o0 AS (SELECT ord.*, ${date} AS d FROM "Order" ord WHERE ${Prisma.join(conds, " AND ")}),
    o AS (SELECT * FROM o0 WHERE d >= ${f.from} AND d < ${f.to})`;
}

const LINE_JOIN = Prisma.sql`
  JOIN "OrderLine" l ON l."orderId" = o.id
  JOIN "VendorOffer" vo ON vo.id = l."offerId"
  JOIN "PackagingUnit" pu ON pu.id = vo."packagingUnitId"
  JOIN "ProductVariant" pv ON pv.id = pu."variantId"
  JOIN "Product" p ON p.id = pv."productId"
  JOIN "Category" c ON c.id = p."categoryId"`;

export type Row = { keys: Record<string, string | null>; values: Record<string, number> };

/** Aggregate metrics by dimensions. Sorted by the first metric (desc) unless the first dimension is time. */
export async function report(f: Filters, dims: Dim[], metrics: Metric[], opts: { limit?: number; sortBy?: Metric } = {}): Promise<Row[]> {
  if (dims.some((d) => !DIMENSIONS.includes(d)) || metrics.some((m) => !METRICS.includes(m))) throw new ValidationError("Unknown dimension or metric.");
  if (!metrics.length) throw new ValidationError("Choose at least one figure.");
  const line = dims.some((d) => LINE_DIMS.includes(d)) || metrics.includes("units") || !!f.categoryId;
  if (line) {
    const bad = metrics.filter((m) => ORDER_ONLY.includes(m));
    if (bad.length) throw new ValidationError(`${bad.join(", ")} can't be split by product or category.`);
  }
  const cols = [
    ...dims.map((d, i) => Prisma.sql`${DIM_SQL[d]}::text AS ${Prisma.raw(`"d${i}"`)}`),
    ...metrics.map((m, i) => Prisma.sql`${metricSql(m, line)} AS ${Prisma.raw(`"m${i}"`)}`),
  ];
  const catFilter = f.categoryId
    ? Prisma.sql`AND c.path LIKE (SELECT path FROM "Category" WHERE id = ${f.categoryId}) || '%'`
    : Prisma.empty;
  const group = dims.length ? Prisma.sql`GROUP BY ${Prisma.join(dims.map((_, i) => Prisma.raw(String(i + 1))))}` : Prisma.empty;
  const timeFirst = dims[0] === "day" || dims[0] === "week" || dims[0] === "month";
  const sortIdx = opts.sortBy ? metrics.indexOf(opts.sortBy) : 0;
  const order = dims.length ? (timeFirst ? Prisma.sql`ORDER BY 1` : Prisma.sql`ORDER BY ${Prisma.raw(`"m${Math.max(0, sortIdx)}"`)} DESC NULLS LAST`) : Prisma.empty;
  const limit = opts.limit ? Prisma.sql`LIMIT ${opts.limit}` : Prisma.empty;
  const rows = await prisma.$queryRaw<Record<string, string | number | null>[]>`
    ${baseCte(f)}
    SELECT ${Prisma.join(cols)} FROM o ${line ? LINE_JOIN : Prisma.empty} WHERE true ${catFilter} ${group} ${order} ${limit}`;
  return rows.map((r) => ({
    keys: Object.fromEntries(dims.map((d, i) => [d, (r[`d${i}`] as string | null) ?? null])),
    values: Object.fromEntries(metrics.map((m, i) => [m, Number(r[`m${i}`] ?? 0)])),
  }));
}

// ── labels for dimension keys ───────────────────────────────────────────────

export async function labelsFor(dim: Dim, keys: (string | null)[], pick: (v: unknown) => string): Promise<Map<string, string>> {
  const ids = [...new Set(keys.filter((k): k is string => !!k && k !== "-"))];
  const out = new Map<string, string>();
  if (!ids.length) return out;
  if (dim === "vendor" || dim === "buyer") for (const c of await prisma.company.findMany({ where: { id: { in: ids } }, select: { id: true, legalName: true, tradeName: true } })) out.set(c.id, c.tradeName ?? c.legalName);
  else if (dim === "country" || dim === "sellerCountry") for (const c of await prisma.country.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, flag: true, name: true } })) out.set(c.id, `${c.flag ?? ""} ${pick(c.name)}`.trim());
  else if (dim === "region") for (const r of await prisma.region.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })) out.set(r.id, pick(r.name));
  else if (dim === "product") for (const p of await prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })) out.set(p.id, pick(p.name));
  else if (dim === "category" || dim === "categoryRoot") for (const c of await prisma.category.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })) out.set(c.id, pick(c.name));
  return out;
}

// ── special views ───────────────────────────────────────────────────────────

export type Kpis = Record<"orders" | "buyers" | "net" | "gross" | "commission" | "margin" | "fees" | "revenue" | "payout" | "aov", number> & { cancelled: number; credited: number };

export async function kpis(f: Filters): Promise<Kpis> {
  const [r] = await report(f, [], ["orders", "buyers", "net", "gross", "commission", "margin", "fees", "revenue", "payout", "aov"]);
  const scope = { ...f, basis: "placed" as const };
  const [cancelled] = await prisma.$queryRaw<{ n: number }[]>`
    SELECT count(*)::float8 AS n FROM "Order" ord WHERE ord.status = 'CANCELLED' AND ord."placedAt" >= ${f.from} AND ord."placedAt" < ${f.to}
    ${scope.countryId ? Prisma.sql`AND ord."countryId" = ${scope.countryId}` : Prisma.empty}
    ${scope.vendorId ? Prisma.sql`AND ord."sellerCompanyId" = ${scope.vendorId}` : Prisma.empty}
    ${scope.buyerId ? Prisma.sql`AND ord."buyerCompanyId" = ${scope.buyerId}` : Prisma.empty}
    ${scope.buyerIds ? (scope.buyerIds.length ? Prisma.sql`AND ord."buyerCompanyId" IN (${Prisma.join(scope.buyerIds)})` : Prisma.sql`AND false`) : Prisma.empty}
    ${scope.sellerType ? Prisma.sql`AND ord.flow = ${scope.sellerType === "WHOLESALER" ? "CUSTOMER_FROM_WHOLESALER" : "WHOLESALER_FROM_DISTRIBUTOR"}::"OrderFlow"` : Prisma.empty}`;
  const [credited] = await prisma.$queryRaw<{ n: number }[]>`
    SELECT coalesce(sum(i."netTotal"), 0)::float8 AS n FROM "Invoice" i JOIN "Order" ord ON ord.id = i."orderId"
    WHERE i."docType" = 'CREDIT_NOTE' AND i."issuedAt" >= ${f.from} AND i."issuedAt" < ${f.to}
    ${f.countryId ? Prisma.sql`AND ord."countryId" = ${f.countryId}` : Prisma.empty}
    ${f.vendorId ? Prisma.sql`AND ord."sellerCompanyId" = ${f.vendorId}` : Prisma.empty}
    ${f.buyerId ? Prisma.sql`AND ord."buyerCompanyId" = ${f.buyerId}` : Prisma.empty}
    ${f.buyerIds ? (f.buyerIds.length ? Prisma.sql`AND ord."buyerCompanyId" IN (${Prisma.join(f.buyerIds)})` : Prisma.sql`AND false`) : Prisma.empty}`;
  const v = r?.values ?? {};
  return { orders: v.orders ?? 0, buyers: v.buyers ?? 0, net: v.net ?? 0, gross: v.gross ?? 0, commission: v.commission ?? 0, margin: v.margin ?? 0, fees: v.fees ?? 0, revenue: v.revenue ?? 0, payout: v.payout ?? 0, aov: v.aov ?? 0, cancelled: cancelled.n, credited: credited.n };
}

/** The same-length period just before (for deltas). */
export function previousPeriod(f: Filters): Filters {
  const len = f.to.getTime() - f.from.getTime();
  return { ...f, from: new Date(f.from.getTime() - len), to: new Date(f.from) };
}

/** Orders placed in the period, by current status (incl. cancelled). */
export async function statusFunnel(f: Filters) {
  return prisma.$queryRaw<{ status: string; n: number; net: number }[]>`
    SELECT ord.status::text AS status, count(*)::float8 AS n, sum(ord."netTotal")::float8 AS net FROM "Order" ord
    WHERE ord."placedAt" >= ${f.from} AND ord."placedAt" < ${f.to}
    ${f.countryId ? Prisma.sql`AND ord."countryId" = ${f.countryId}` : Prisma.empty}
    ${f.vendorId ? Prisma.sql`AND ord."sellerCompanyId" = ${f.vendorId}` : Prisma.empty}
    ${f.buyerId ? Prisma.sql`AND ord."buyerCompanyId" = ${f.buyerId}` : Prisma.empty}
    ${f.buyerIds ? (f.buyerIds.length ? Prisma.sql`AND ord."buyerCompanyId" IN (${Prisma.join(f.buyerIds)})` : Prisma.sql`AND false`) : Prisma.empty}
    ${f.sellerType ? Prisma.sql`AND ord.flow = ${f.sellerType === "WHOLESALER" ? "CUSTOMER_FROM_WHOLESALER" : "WHOLESALER_FROM_DISTRIBUTOR"}::"OrderFlow"` : Prisma.empty}
    GROUP BY 1 ORDER BY 2 DESC`;
}

/** Active buyers in the period, split into first-time and returning. */
export async function buyerMix(f: Filters) {
  const [r] = await prisma.$queryRaw<{ active: number; fresh: number }[]>`
    ${baseCte(f)}
    SELECT count(DISTINCT o."buyerCompanyId")::float8 AS active,
           count(DISTINCT o."buyerCompanyId") FILTER (WHERE NOT EXISTS (
             SELECT 1 FROM "Order" e WHERE e."buyerCompanyId" = o."buyerCompanyId" AND e.status <> 'CANCELLED' AND e."placedAt" < ${f.from}))::float8 AS fresh
    FROM o`;
  return { active: r.active, fresh: r.fresh, returning: r.active - r.fresh };
}

/** Deliveries finished (delivered / failed / returned) in the period. */
export async function deliveryStats(f: Filters) {
  const where = Prisma.sql`
    d."updatedAt" >= ${f.from} AND d."updatedAt" < ${f.to} AND d.status IN ('DELIVERED', 'FAILED', 'RETURNED')
    ${f.countryId ? Prisma.sql`AND ord."countryId" = ${f.countryId}` : Prisma.empty}
    ${f.vendorId ? Prisma.sql`AND (ord."sellerCompanyId" = ${f.vendorId})` : Prisma.empty}
    ${f.buyerIds ? (f.buyerIds.length ? Prisma.sql`AND ord."buyerCompanyId" IN (${Prisma.join(f.buyerIds)})` : Prisma.sql`AND false`) : Prisma.empty}`;
  const [totals] = await prisma.$queryRaw<{ delivered: number; failed: number; returned: number; scheduled: number; on_time: number; avg_minutes: number | null; attempts: number }[]>`
    SELECT count(*) FILTER (WHERE d.status = 'DELIVERED')::float8 AS delivered,
           count(*) FILTER (WHERE d.status = 'FAILED')::float8 AS failed,
           count(*) FILTER (WHERE d.status = 'RETURNED')::float8 AS returned,
           count(*) FILTER (WHERE d.status = 'DELIVERED' AND d."scheduledFor" IS NOT NULL)::float8 AS scheduled,
           count(*) FILTER (WHERE d.status = 'DELIVERED' AND d."scheduledFor" IS NOT NULL AND d."completedAt"::date <= d."scheduledFor"::date)::float8 AS on_time,
           (avg(extract(epoch FROM d."completedAt" - d."pickedUpAt")) FILTER (WHERE d.status = 'DELIVERED' AND d."pickedUpAt" IS NOT NULL) / 60)::float8 AS avg_minutes,
           coalesce(sum((SELECT count(*) FROM "DeliveryAttempt" a WHERE a."deliveryId" = d.id)), 0)::float8 AS attempts
    FROM "Delivery" d JOIN "Order" ord ON ord.id = d."orderId" WHERE ${where}`;
  const byMode = await prisma.$queryRaw<{ key: string; delivered: number; failed: number }[]>`
    SELECT d.mode::text AS key, count(*) FILTER (WHERE d.status = 'DELIVERED')::float8 AS delivered, count(*) FILTER (WHERE d.status <> 'DELIVERED')::float8 AS failed
    FROM "Delivery" d JOIN "Order" ord ON ord.id = d."orderId" WHERE ${where} GROUP BY 1 ORDER BY 2 DESC`;
  const byExecutor = await prisma.$queryRaw<{ key: string; delivered: number; failed: number }[]>`
    SELECT coalesce(x."tradeName", x."legalName") AS key, count(*) FILTER (WHERE d.status = 'DELIVERED')::float8 AS delivered, count(*) FILTER (WHERE d.status <> 'DELIVERED')::float8 AS failed
    FROM "Delivery" d JOIN "Order" ord ON ord.id = d."orderId" JOIN "Company" x ON x.id = d."executingCompanyId" WHERE ${where} GROUP BY 1 ORDER BY 2 DESC LIMIT 20`;
  const byDriver = await prisma.$queryRaw<{ key: string; delivered: number; failed: number }[]>`
    SELECT u.name AS key, count(*) FILTER (WHERE d.status = 'DELIVERED')::float8 AS delivered, count(*) FILTER (WHERE d.status <> 'DELIVERED')::float8 AS failed
    FROM "Delivery" d JOIN "Order" ord ON ord.id = d."orderId" JOIN "Driver" dr ON dr.id = d."driverId" JOIN "User" u ON u.id = dr."userId" WHERE ${where} GROUP BY 1 ORDER BY 2 DESC LIMIT 20`;
  const reasons = await prisma.$queryRaw<{ key: string; n: number }[]>`
    SELECT coalesce(a."reasonCode", 'OTHER') AS key, count(*)::float8 AS n FROM "DeliveryAttempt" a JOIN "Delivery" d ON d.id = a."deliveryId" JOIN "Order" ord ON ord.id = d."orderId"
    WHERE NOT a.succeeded AND a.at >= ${f.from} AND a.at < ${f.to}
    ${f.countryId ? Prisma.sql`AND ord."countryId" = ${f.countryId}` : Prisma.empty}
    ${f.vendorId ? Prisma.sql`AND ord."sellerCompanyId" = ${f.vendorId}` : Prisma.empty}
    ${f.buyerIds ? (f.buyerIds.length ? Prisma.sql`AND ord."buyerCompanyId" IN (${Prisma.join(f.buyerIds)})` : Prisma.sql`AND false`) : Prisma.empty}
    GROUP BY 1 ORDER BY 2 DESC`;
  return { ...totals, byMode, byExecutor, byDriver, reasons };
}

// ── who may see what ────────────────────────────────────────────────────────

export type Audience = "ADMIN" | "VENDOR" | "BUYER";

/** Fixed filters for the caller; throws if they may not see this audience's reports. */
export async function analyticsScope(ctx: Ctx, audience: Audience): Promise<Partial<Filters>> {
  if (audience === "ADMIN") {
    if (ctx.company.type !== "ADMIN" || !can(ctx, ["admin.analytics.view", "admin.finance.view"])) throw new ForbiddenError();
    if (!ctx.scopes.length) return {};
    const buyers = await prisma.company.findMany({ where: { type: { in: ["CUSTOMER", "WHOLESALER"] }, ...scopeWhere(ctx) }, select: { id: true } });
    return { buyerIds: buyers.map((b) => b.id) };
  }
  if (audience === "VENDOR") {
    if ((ctx.company.type !== "DISTRIBUTOR" && ctx.company.type !== "WHOLESALER") || !can(ctx, "vendor.reports.view")) throw new ForbiddenError();
    return { vendorId: ctx.company.id };
  }
  if ((ctx.company.type !== "CUSTOMER" && ctx.company.type !== "WHOLESALER") || !can(ctx, "buyer.reports.view")) throw new ForbiddenError();
  return { buyerId: ctx.company.id };
}

/** Period presets → [from, to) in UTC days. */
export function periodFrom(preset: string | undefined, fromStr?: string, toStr?: string, now = new Date()): { from: Date; to: Date; preset: string } {
  const day = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const today = day(now);
  const tomorrow = new Date(today.getTime() + 86400_000);
  const back = (n: number) => new Date(tomorrow.getTime() - n * 86400_000);
  switch (preset) {
    case "7d": return { from: back(7), to: tomorrow, preset };
    case "90d": return { from: back(90), to: tomorrow, preset };
    case "12m": return { from: back(365), to: tomorrow, preset };
    case "mtd": return { from: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)), to: tomorrow, preset };
    case "lastmonth": return { from: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1)), to: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)), preset };
    case "ytd": return { from: new Date(Date.UTC(today.getUTCFullYear(), 0, 1)), to: tomorrow, preset };
    case "custom": {
      const f = fromStr ? new Date(`${fromStr}T00:00:00Z`) : back(30);
      const t = toStr ? new Date(new Date(`${toStr}T00:00:00Z`).getTime() + 86400_000) : tomorrow;
      if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime()) || t <= f) return { from: back(30), to: tomorrow, preset: "30d" };
      if (t.getTime() - f.getTime() > 3 * 366 * 86400_000) throw new ValidationError("Choose a period of at most 3 years.");
      return { from: f, to: t, preset };
    }
    default: return { from: back(30), to: tomorrow, preset: "30d" };
  }
}

/** Time grain that keeps a chart readable for the period. */
export function grainFor(from: Date, to: Date): "day" | "week" | "month" {
  const days = (to.getTime() - from.getTime()) / 86400_000;
  return days <= 45 ? "day" : days <= 200 ? "week" : "month";
}

/** Credit notes issued per month (net), for revenue after returns. */
export async function creditNotesByMonth(f: Filters) {
  return prisma.$queryRaw<{ month: string; net: number; n: number }[]>`
    SELECT to_char(date_trunc('month', i."issuedAt"), 'YYYY-MM-DD') AS month, sum(i."netTotal")::float8 AS net, count(*)::float8 AS n
    FROM "Invoice" i JOIN "Order" ord ON ord.id = i."orderId"
    WHERE i."docType" = 'CREDIT_NOTE' AND i."issuedAt" >= ${f.from} AND i."issuedAt" < ${f.to}
    ${f.countryId ? Prisma.sql`AND ord."countryId" = ${f.countryId}` : Prisma.empty}
    ${f.vendorId ? Prisma.sql`AND ord."sellerCompanyId" = ${f.vendorId}` : Prisma.empty}
    ${f.buyerId ? Prisma.sql`AND ord."buyerCompanyId" = ${f.buyerId}` : Prisma.empty}
    ${f.buyerIds ? (f.buyerIds.length ? Prisma.sql`AND ord."buyerCompanyId" IN (${Prisma.join(f.buyerIds)})` : Prisma.sql`AND false`) : Prisma.empty}
    GROUP BY 1 ORDER BY 1`;
}

/** What each audience may break down and see. FIRINGI's own margin/revenue stays internal. */
export const AUDIENCE_DIMS: Record<Audience, Dim[]> = {
  ADMIN: [...DIMENSIONS],
  VENDOR: ["day", "week", "month", "buyer", "region", "deliveryMode", "product", "category", "categoryRoot"],
  BUYER: ["day", "week", "month", "vendor", "deliveryMode", "product", "category", "categoryRoot"],
};
export const AUDIENCE_METRICS: Record<Audience, Metric[]> = {
  ADMIN: [...METRICS],
  VENDOR: ["orders", "buyers", "units", "goodsNet", "net", "commission", "payout", "discount", "aov"],
  BUYER: ["orders", "units", "net", "gross", "vat", "discount", "aov"],
};
export function assertAllowed(audience: Audience, dims: Dim[], metrics: Metric[]) {
  if (dims.some((d) => !AUDIENCE_DIMS[audience].includes(d)) || metrics.some((m) => !AUDIENCE_METRICS[audience].includes(m))) throw new ForbiddenError();
}

/** Active countries for the report filter. */
export async function countryOptions(locale: string) {
  const cs = await prisma.country.findMany({ where: { isActive: true }, orderBy: { code: "asc" }, select: { id: true, code: true, flag: true, name: true } });
  return cs.map((c) => ({ id: c.id, label: `${c.flag ?? ""} ${pickLocalized(c.name, locale) || c.code}`.trim() }));
}
