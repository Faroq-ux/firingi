/**
 * FIRINGI's profit (accrual basis — by invoice date):
 *   Sales (goods)             = invoiced goods, excl. VAT (FIRINGI is the seller of record)
 * + Delivery fees (FIRINGI)   = FIRINGI's own fleet's fees
 * + Supplier delivery fees    = suppliers' flat rates FIRINGI invoices …
 * − Cost of goods             = what FIRINGI owes the suppliers for the goods (vendor price)
 * − Supplier delivery fees    = … and pays on
 * − Credit notes (net of the suppliers' credit statements)
 * = Gross profit
 * − Driver pay (routes: per route + per delivered order + per km), absorbed price differences
 *   (orders moved to a dearer supplier at the buyer's price), recorded costs (fleet, warehouse,
 *   staff, …; monthly costs repeat)
 * = Net profit
 * Cash flow is on cash basis (payments received / paid, costs marked paid) with a forecast of
 * what is due in the coming weeks.
 */
import { Prisma, type CostCategory } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { routingSettings } from "./routes";
import { writeAudit } from "./audit";

export function assertFinanceView(ctx: Ctx) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, ["admin.finance.view", "admin.finance.manage", "admin.analytics.view"])) throw new ForbiddenError();
}
const r2 = (n: number) => Math.round(n * 100) / 100;
export const COST_CATEGORIES: CostCategory[] = ["DRIVERS", "FLEET", "WAREHOUSE", "STAFF", "MARKETING", "IT", "PAYMENT_FEES", "OTHER"];

/** First day of each month, oldest first, ending with the current month. */
export function lastMonths(n: number, now = new Date()) {
  return Array.from({ length: n }, (_, i) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (n - 1 - i), 1)));
}
const key = (d: Date) => d.toISOString().slice(0, 7);
const countryFilter = (countryId: string | null | undefined, col = Prisma.sql`o."countryId"`) => (countryId ? Prisma.sql`AND ${col} = ${countryId}` : Prisma.empty);

// ── costs ───────────────────────────────────────────────────────────────────

export type CostInput = { date: Date; endDate?: Date | null; monthly?: boolean; category: CostCategory; description: string; amountNet: number; vatAmount?: number; countryCode?: string | null; paid?: boolean };

export async function listCosts(ctx: Ctx) {
  assertFinanceView(ctx);
  return prisma.costEntry.findMany({ orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 500 });
}

export async function saveCost(ctx: Ctx, id: string | null, i: CostInput) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, "admin.finance.manage")) throw new ForbiddenError();
  if (!i.description.trim()) throw new ValidationError("Describe the cost.");
  if (!(i.amountNet > 0)) throw new ValidationError("Enter the amount (excl. VAT).");
  if (i.endDate && i.endDate < i.date) throw new ValidationError("The end is before the start.");
  if (!COST_CATEGORIES.includes(i.category)) throw new ValidationError("Choose a category.");
  const country = i.countryCode ? await prisma.country.findUnique({ where: { code: i.countryCode } }) : null;
  const data = {
    date: i.date, endDate: i.monthly ? i.endDate ?? null : null, monthly: !!i.monthly, category: i.category, description: i.description.trim(),
    amountNet: r2(i.amountNet), vatAmount: r2(i.vatAmount ?? 0), countryId: country?.id ?? null, paid: i.paid ?? true,
  };
  const c = id ? await prisma.costEntry.update({ where: { id }, data }) : await prisma.costEntry.create({ data: { ...data, createdById: ctx.user.id } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: id ? "cost.updated" : "cost.recorded", entityType: "CostEntry", entityId: c.id, after: data });
  return c;
}

export async function deleteCost(ctx: Ctx, id: string) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, "admin.finance.manage")) throw new ForbiddenError();
  const c = await prisma.costEntry.findUnique({ where: { id } });
  if (!c) throw new NotFoundError("Cost");
  await prisma.costEntry.delete({ where: { id } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "cost.deleted", entityType: "CostEntry", entityId: id, before: c });
}

/** Recorded costs per month and category (monthly costs repeated in every month they run). */
async function costsByMonth(months: Date[], countryId?: string | null) {
  const from = months[0], to = new Date(Date.UTC(months[months.length - 1].getUTCFullYear(), months[months.length - 1].getUTCMonth() + 1, 1));
  const rows = await prisma.costEntry.findMany({
    where: { ...(countryId ? { OR: [{ countryId }, { countryId: null }] } : {}), OR: [{ monthly: false, date: { gte: from, lt: to } }, { monthly: true, date: { lt: to }, OR: [{ endDate: null }, { endDate: { gte: from } }] }] },
  });
  const out = new Map<string, Record<string, number>>(months.map((m) => [key(m), {}]));
  for (const c of rows) {
    for (const m of months) {
      const mEnd = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1));
      const inMonth = c.monthly ? c.date < mEnd && (!c.endDate || c.endDate >= m) : c.date >= m && c.date < mEnd;
      if (!inMonth) continue;
      const b = out.get(key(m))!;
      b[c.category] = (b[c.category] ?? 0) + Number(c.amountNet);
    }
  }
  return out;
}

// ── profit & loss ───────────────────────────────────────────────────────────

/** Driver pay (FIRINGI's own fleet) per month, from completed routes and the pay rates. */
async function driverPayByMonth(months: Date[]) {
  const { pay } = await routingSettings();
  const rows = await prisma.$queryRaw<{ m: Date; routes: number; km: number; delivered: number }[]>`
    WITH r AS (
      SELECT r.id, r."plannedKm", date_trunc('month', r."completedAt") AS m FROM "Route" r JOIN "Company" c ON c.id = r."executingCompanyId"
      WHERE c.type = 'ADMIN' AND r.status = 'COMPLETED' AND r."completedAt" >= ${months[0]}
    )
    SELECT r.m, count(*)::int AS routes, sum(r."plannedKm")::float8 AS km,
      sum((SELECT count(*) FROM "RouteStop" s JOIN "Delivery" d ON d.id = s."deliveryId" WHERE s."routeId" = r.id AND s.kind = 'DROP' AND d.status = 'DELIVERED' AND EXISTS (SELECT 1 FROM "Order" o WHERE o.id = d."orderId" AND o."deliveryFeeNet" > 0)))::int AS delivered
    FROM r GROUP BY r.m`;
  return new Map(rows.map((r) => [key(r.m), r2(r.routes * pay.perRoute + r.delivered * pay.perDelivery + r.km * pay.perKm)]));
}

export type PnlMonth = {
  month: string; goods: number; firingiFees: number; supplierFees: number; revenue: number; cogs: number; credits: number; vendorCredits: number;
  gross: number; marginPct: number | null; commission: number; driverPay: number; absorbed: number; costs: Record<string, number>; costTotal: number; net: number; orders: number;
};

export async function profitAndLoss(ctx: Ctx, opts: { months?: number; countryId?: string | null } = {}) {
  assertFinanceView(ctx);
  return computePnl(opts);
}

/** P&L numbers without the permission check (callers check). */
export async function computePnl(opts: { months?: number; countryId?: string | null } = {}) {
  const months = lastMonths(Math.min(Math.max(opts.months ?? 12, 1), 24));
  const from = months[0];
  const cf = countryFilter(opts.countryId);
  const [sales, credits, vcredits, absorbed, costs, drivers] = await Promise.all([
    prisma.$queryRaw<{ m: Date; goods: number; ffee: number; sfee: number; cogs: number; commission: number; n: number }[]>`
      SELECT date_trunc('month', i."issuedAt") AS m,
        sum(o."netTotal" - o."deliveryFeeNet")::float8 AS goods,
        sum(CASE WHEN o."deliveryMode" = 'FIRINGI_FLEET' THEN o."deliveryFeeNet" ELSE 0 END)::float8 AS ffee,
        sum(CASE WHEN o."deliveryMode" <> 'FIRINGI_FLEET' THEN o."deliveryFeeNet" ELSE 0 END)::float8 AS sfee,
        sum(o."vendorPayableNet" - CASE WHEN o."deliveryMode" <> 'FIRINGI_FLEET' THEN o."deliveryFeeNet" ELSE 0 END)::float8 AS cogs,
        sum(o."commissionTotal")::float8 AS commission, count(*)::int AS n
      FROM "Invoice" i JOIN "Order" o ON o.id = i."orderId"
      WHERE i."docType" = 'INVOICE' AND i."issuedAt" >= ${from} ${cf}
      GROUP BY 1`,
    prisma.$queryRaw<{ m: Date; net: number }[]>`
      SELECT date_trunc('month', i."issuedAt") AS m, sum(i."netTotal")::float8 AS net FROM "Invoice" i LEFT JOIN "Order" o ON o.id = i."orderId"
      WHERE i."docType" = 'CREDIT_NOTE' AND i."issuedAt" >= ${from} ${cf} GROUP BY 1`,
    prisma.$queryRaw<{ m: Date; net: number }[]>`
      SELECT date_trunc('month', s."createdAt") AS m, sum(s."expectedNet")::float8 AS net FROM "VendorBillingStatement" s JOIN "Order" o ON o.id = s."orderId"
      WHERE s."isCreditStatement" AND s."createdAt" >= ${from} ${cf} GROUP BY 1`,
    prisma.$queryRaw<{ m: Date; net: number }[]>`
      SELECT date_trunc('month', e."createdAt") AS m, sum(e."absorbedNet")::float8 AS net FROM "AllocationEvent" e JOIN "Order" o ON o.id = e."orderId"
      WHERE e.status IN ('MOVED', 'PARTIAL') AND e."createdAt" >= ${from} ${cf} GROUP BY 1`,
    costsByMonth(months, opts.countryId),
    opts.countryId ? Promise.resolve(new Map<string, number>()) : driverPayByMonth(months),
  ]);
  const by = <T extends { m: Date }>(rows: T[]) => new Map(rows.map((r) => [key(r.m), r]));
  const S = by(sales), C = by(credits), V = by(vcredits), A = by(absorbed);
  const rows: PnlMonth[] = months.map((m) => {
    const k = key(m), s = S.get(k);
    const goods = s?.goods ?? 0, firingiFees = s?.ffee ?? 0, supplierFees = s?.sfee ?? 0, cogs = (s?.cogs ?? 0) + supplierFees;
    const cr = C.get(k)?.net ?? 0, vcr = V.get(k)?.net ?? 0;
    const revenue = goods + firingiFees + supplierFees;
    const gross = revenue - cogs - cr + vcr;
    const cm = costs.get(k) ?? {};
    const driverPay = drivers.get(k) ?? 0, abs = A.get(k)?.net ?? 0;
    const costTotal = Object.values(cm).reduce((a, x) => a + x, 0);
    return {
      month: k, goods: r2(goods), firingiFees: r2(firingiFees), supplierFees: r2(supplierFees), revenue: r2(revenue), cogs: r2(cogs), credits: r2(cr), vendorCredits: r2(vcr),
      gross: r2(gross), marginPct: revenue - cr > 0 ? gross / (revenue - cr) : null, commission: r2(s?.commission ?? 0), driverPay, absorbed: r2(abs),
      costs: cm, costTotal: r2(costTotal), net: r2(gross - driverPay - abs - costTotal), orders: s?.n ?? 0,
    };
  });
  const sum = (f: (x: PnlMonth) => number) => r2(rows.reduce((a, x) => a + f(x), 0));
  const total = {
    revenue: sum((x) => x.revenue), goods: sum((x) => x.goods), firingiFees: sum((x) => x.firingiFees), supplierFees: sum((x) => x.supplierFees), cogs: sum((x) => x.cogs),
    credits: sum((x) => x.credits), vendorCredits: sum((x) => x.vendorCredits), gross: sum((x) => x.gross), commission: sum((x) => x.commission), driverPay: sum((x) => x.driverPay),
    absorbed: sum((x) => x.absorbed), costTotal: sum((x) => x.costTotal), net: sum((x) => x.net), orders: rows.reduce((a, x) => a + x.orders, 0),
    costs: Object.fromEntries(COST_CATEGORIES.map((c) => [c, sum((x) => x.costs[c] ?? 0)])) as Record<string, number>,
  };
  return { rows, total: { ...total, marginPct: total.revenue - total.credits > 0 ? total.gross / (total.revenue - total.credits) : null } };
}

// ── cash flow ───────────────────────────────────────────────────────────────

export async function cashFlow(ctx: Ctx, opts: { months?: number; weeksAhead?: number } = {}) {
  assertFinanceView(ctx);
  const months = lastMonths(Math.min(Math.max(opts.months ?? 6, 1), 24));
  const from = months[0];
  const [pays, costs] = await Promise.all([
    prisma.$queryRaw<{ m: Date; dir: string; amt: number }[]>`
      SELECT date_trunc('month', COALESCE("paidAt", "createdAt")) AS m, direction AS dir, sum(amount)::float8 AS amt FROM "Payment"
      WHERE status = 'CONFIRMED' AND COALESCE("paidAt", "createdAt") >= ${from} GROUP BY 1, 2`,
    prisma.costEntry.findMany({ where: { paid: true, OR: [{ monthly: false, date: { gte: from } }, { monthly: true, OR: [{ endDate: null }, { endDate: { gte: from } }] }] } }),
  ]);
  const rows = months.map((m) => {
    const k = key(m);
    const mEnd = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1));
    const inn = pays.filter((p) => key(p.m) === k && p.dir === "INBOUND").reduce((a, p) => a + p.amt, 0);
    const out = pays.filter((p) => key(p.m) === k && p.dir === "OUTBOUND").reduce((a, p) => a + p.amt, 0);
    const cost = costs.filter((c) => (c.monthly ? c.date < mEnd && (!c.endDate || c.endDate >= m) : c.date >= m && c.date < mEnd)).reduce((a, c) => a + Number(c.amountNet) + Number(c.vatAmount), 0);
    return { month: k, inflow: r2(inn), suppliers: r2(out), costs: r2(cost), net: r2(inn - out - cost) };
  });
  let running = 0;
  const withBalance = rows.map((r) => ({ ...r, cumulative: r2((running += r.net)) }));

  // Forecast: what customers owe (by due date), what FIRINGI owes suppliers, running monthly costs.
  const weeks = Math.min(Math.max(opts.weeksAhead ?? 8, 1), 26);
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + weeks * 7 * 86400_000);
  const [recv, payb, monthly] = await Promise.all([
    prisma.$queryRaw<{ due: Date | null; open: number }[]>`
      SELECT i."dueAt" AS due, (i."grossTotal" - COALESCE((SELECT sum(a.amount) FROM "PaymentAllocation" a JOIN "Payment" p ON p.id = a."paymentId" WHERE a."invoiceId" = i.id AND p.status = 'CONFIRMED'), 0)
        - COALESCE((SELECT sum(c."grossTotal") FROM "Invoice" c WHERE c."originalInvoiceId" = i.id AND c.status <> 'DRAFT'), 0))::float8 AS open
      FROM "Invoice" i WHERE i."docType" = 'INVOICE' AND i.status <> 'DRAFT'`,
    prisma.$queryRaw<{ due: Date | null; open: number }[]>`
      SELECT v."dueDate" AS due, (v."grossTotal" - COALESCE((SELECT sum(a.amount) FROM "PaymentAllocation" a JOIN "Payment" p ON p.id = a."paymentId" WHERE a."vendorInvoiceId" = v.id AND p.status = 'CONFIRMED'), 0))::float8 AS open
      FROM "VendorInvoice" v WHERE v.status IN ('APPROVED', 'MATCHED') AND v."docType" = 'INVOICE'`,
    prisma.costEntry.findMany({ where: { monthly: true, OR: [{ endDate: null }, { endDate: { gte: start } }] } }),
  ]);
  const weekOf = (d: Date | null) => (!d || d < start ? 0 : Math.min(weeks - 1, Math.floor((d.getTime() - start.getTime()) / (7 * 86400_000))));
  const forecast = Array.from({ length: weeks }, (_, w) => ({ week: new Date(start.getTime() + w * 7 * 86400_000).toISOString().slice(0, 10), receivable: 0, payable: 0, costs: 0, net: 0 }));
  for (const r of recv) if (r.open > 0.005 && (!r.due || r.due < end)) forecast[weekOf(r.due)].receivable += r.open;
  for (const p of payb) if (p.open > 0.005 && (!p.due || p.due < end)) forecast[weekOf(p.due)].payable += p.open;
  for (const c of monthly) {
    // a monthly cost falls on its day of the month
    for (let d = new Date(start.getFullYear(), start.getMonth(), c.date.getUTCDate()); d < end; d = new Date(d.getFullYear(), d.getMonth() + 1, c.date.getUTCDate())) {
      if (d >= start && (!c.endDate || d <= c.endDate)) forecast[weekOf(d)].costs += Number(c.amountNet) + Number(c.vatAmount);
    }
  }
  let bal = 0;
  const fc = forecast.map((f) => ({ ...f, receivable: r2(f.receivable), payable: r2(f.payable), costs: r2(f.costs), net: r2(f.receivable - f.payable - f.costs), cumulative: r2((bal += f.receivable - f.payable - f.costs)) }));
  const overdueReceivable = r2(recv.filter((r) => r.due && r.due < start && r.open > 0.005).reduce((a, r) => a + r.open, 0));
  return { rows: withBalance, forecast: fc, overdueReceivable };
}

// ── net profit by dimension ─────────────────────────────────────────────────

export type ProfitDim = "vendor" | "buyer" | "country";

/** Per supplier / customer / country: gross margin + own fees − delivery cost share − price differences − credits. */
export async function netProfitBy(ctx: Ctx, dim: ProfitDim, p: { from: Date; to: Date }) {
  assertFinanceView(ctx);
  const { pay } = await routingSettings();
  const col = dim === "vendor" ? Prisma.sql`o."sellerCompanyId"` : dim === "buyer" ? Prisma.sql`o."buyerCompanyId"` : Prisma.sql`o."countryId"`;
  const rows = await prisma.$queryRaw<{ id: string; orders: number; revenue: number; margin: number; ffee: number; credits: number; absorbed: number; fleet: number; routeShare: number }[]>`
    WITH o AS (
      SELECT o.* FROM "Order" o JOIN "Invoice" i ON i."orderId" = o.id AND i."docType" = 'INVOICE'
      WHERE i."issuedAt" >= ${p.from} AND i."issuedAt" <= ${p.to}
    ), shares AS (
      -- each FIRINGI route's fixed part (per route + per km) shared equally by its deliveries
      SELECT d."orderId", (${pay.perRoute} + r."plannedKm" * ${pay.perKm}) / NULLIF((SELECT count(DISTINCT s."deliveryId") FROM "RouteStop" s WHERE s."routeId" = r.id), 0) AS share
      FROM "Delivery" d JOIN "RouteStop" st ON st."deliveryId" = d.id AND st.kind = 'DROP' JOIN "Route" r ON r.id = st."routeId" AND r.status = 'COMPLETED'
    )
    SELECT ${col} AS id, count(*)::int AS orders,
      sum(o."netTotal")::float8 AS revenue, sum(o."firingiMarginNet")::float8 AS margin,
      sum(CASE WHEN o."deliveryMode" = 'FIRINGI_FLEET' THEN o."deliveryFeeNet" ELSE 0 END)::float8 AS ffee,
      COALESCE(sum((SELECT sum(c."netTotal") FROM "Invoice" c WHERE c."orderId" = o.id AND c."docType" = 'CREDIT_NOTE')), 0)::float8 AS credits,
      COALESCE(sum((SELECT sum(e."absorbedNet") FROM "AllocationEvent" e WHERE e."orderId" = o."parentOrderId" OR e."orderId" = o.id)), 0)::float8 AS absorbed,
      sum(CASE WHEN o."deliveryMode" = 'FIRINGI_FLEET' AND o."deliveryFeeNet" > 0 THEN 1 ELSE 0 END)::int AS fleet,
      COALESCE(sum((SELECT max(sh.share) FROM shares sh WHERE sh."orderId" = o.id)), 0)::float8 AS "routeShare"
    FROM o GROUP BY 1`;
  const ids = rows.map((r) => r.id);
  const names = dim === "country"
    ? new Map((await prisma.country.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, flag: true } })).map((c) => [c.id, `${c.flag ?? ""} ${c.code}`.trim()]))
    : new Map((await prisma.company.findMany({ where: { id: { in: ids } }, select: { id: true, legalName: true, tradeName: true } })).map((c) => [c.id, c.tradeName ?? c.legalName]));
  return rows.map((r) => {
    const deliveryCost = r.fleet * pay.perDelivery + r.routeShare;
    const gross = r.margin + r.ffee;
    const net = gross - deliveryCost - r.absorbed - Math.max(0, r.credits) * (r.revenue > 0 ? r.margin / r.revenue : 0);
    return {
      id: r.id, name: names.get(r.id) ?? "—", orders: r.orders, revenue: r2(r.revenue), margin: r2(r.margin), fees: r2(r.ffee), deliveryCost: r2(deliveryCost),
      absorbed: r2(r.absorbed), credits: r2(r.credits), net: r2(net), netPct: r.revenue > 0 ? net / r.revenue : null,
    };
  }).sort((a, b) => b.net - a.net);
}

// ── route profitability ─────────────────────────────────────────────────────

/** Completed FIRINGI routes: fees collected (+ the goods margin of its orders) against driver pay and vehicle cost. */
export async function routeProfitability(ctx: Ctx, p: { from: Date; to: Date }) {
  assertFinanceView(ctx);
  const { pay, vehicleCostPerKm } = await routingSettings();
  const routes = await prisma.route.findMany({
    where: { status: "COMPLETED", completedAt: { gte: p.from, lte: p.to }, executor: { type: "ADMIN" } },
    include: {
      driver: { select: { user: { select: { name: true } } } },
      stops: { where: { kind: "DROP" }, select: { delivery: { select: { status: true, order: { select: { deliveryFeeNet: true, firingiMarginNet: true, deliveryMode: true } } } } } },
    },
    orderBy: { completedAt: "desc" }, take: 300,
  });
  return routes.map((r) => {
    const delivered = r.stops.filter((s) => s.delivery.status === "DELIVERED");
    const fees = delivered.reduce((a, s) => a + (s.delivery.order.deliveryMode === "FIRINGI_FLEET" ? Number(s.delivery.order.deliveryFeeNet) : 0), 0);
    const margin = delivered.reduce((a, s) => a + Number(s.delivery.order.firingiMarginNet), 0);
    const km = Number(r.plannedKm);
    const driverPay = pay.perRoute + delivered.filter((s) => Number(s.delivery.order.deliveryFeeNet) > 0).length * pay.perDelivery + km * pay.perKm;
    const vehicle = km * vehicleCostPerKm;
    const cost = driverPay + vehicle;
    return {
      id: r.id, number: r.number, date: r.date, driver: r.driver?.user.name ?? "—", stops: r.stops.length, delivered: delivered.length, km: r2(km),
      fees: r2(fees), margin: r2(margin), driverPay: r2(driverPay), vehicle: r2(vehicle), cost: r2(cost),
      deliveryProfit: r2(fees - cost), totalProfit: r2(fees + margin - cost), perStop: delivered.length ? r2((fees + margin - cost) / delivered.length) : null, perKm: km > 0 ? r2((fees + margin - cost) / km) : null,
    };
  });
}
