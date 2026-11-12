/**
 * Profit & loss for a day, a week, a month or any range (Phase 27):
 *   sales (entered per day + — for suppliers — sales through FIRINGI, from the billing statements)
 * − purchases (on FIRINGI, from FIRINGI's invoices less credit notes, + other suppliers entered)
 * = gross profit − operating expenses (rent, utilities, salaries, social security…) = net profit.
 * Shown with VAT (as paid) or without (entries with a VAT rate are split; FIRINGI documents exactly).
 * Per branch for multi-site buyers; branch staff see their own branches only.
 */
import Decimal from "decimal.js";
import type { AccountingCategory } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { accountingScope, entryWhere, requireAccounting, EXPENSE_CATEGORIES, SALE_CATEGORIES } from "./entries";

export type Basis = "GROSS" | "NET";
export type Granularity = "DAY" | "WEEK" | "MONTH";
const D = (v: Decimal.Value) => new Decimal(v);
const day = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** The period around a date: that day, its week (Monday–Sunday) or its month. */
export function periodOf(g: Granularity, at: Date) {
  const a = day(at);
  if (g === "DAY") return { from: a, to: a };
  if (g === "WEEK") {
    const from = new Date(a.getTime() - ((a.getUTCDay() + 6) % 7) * 86_400_000);
    return { from, to: new Date(from.getTime() + 6 * 86_400_000) };
  }
  return { from: new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), 1)), to: new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + 1, 0)) };
}
/** The period just before (same length). */
export function previousPeriod(g: Granularity, from: Date) {
  return periodOf(g, new Date(from.getTime() - 86_400_000));
}

type Row = { date: Date; amount: Decimal; vat: Decimal; key: string };
const split = (gross: Decimal, rate: Decimal | null) => {
  if (!rate || rate.isZero()) return { net: gross, vat: D(0) };
  const net = gross.div(D(1).plus(rate.div(100))).toDecimalPlaces(2);
  return { net, vat: gross.minus(net) };
};

/** Everything that went in and out in [from, to] for the caller's view. */
async function movements(ctx: Ctx, from: Date, to: Date, branch: string | null | undefined, basis: Basis) {
  const end = new Date(day(to).getTime() + 86_400_000);
  const entries = await prisma.accountingEntry.findMany({ where: { AND: [await entryWhere(ctx, branch), { date: { gte: day(from), lte: day(to) } }] }, select: { date: true, category: true, amount: true, vatRate: true } });
  const sales: Row[] = [], costs: Row[] = [];
  for (const e of entries) {
    const g = D(e.amount.toString());
    const { net, vat } = split(g, e.vatRate ? D(e.vatRate.toString()) : null);
    const r = { date: e.date, amount: basis === "NET" ? net : g, vat, key: e.category };
    if ((SALE_CATEGORIES as readonly string[]).includes(e.category)) sales.push(r); else costs.push(r);
  }
  // Purchases on FIRINGI: its invoices to the company (credit notes take away)
  const s = await accountingScope(ctx);
  const branchFilter = branch === "NONE" ? { OR: [{ orderId: null }, { order: { branchId: null } }] } : branch ? { order: { branchId: branch } } : s ? { order: { branchId: { in: s } } } : {};
  if (branch !== "NONE" || !s) {
    const invoices = await prisma.invoice.findMany({ where: { recipientCompanyId: ctx.company.id, status: { not: "DRAFT" }, issuedAt: { gte: day(from), lt: end }, ...branchFilter }, select: { issuedAt: true, docType: true, netTotal: true, vatTotal: true, grossTotal: true } });
    for (const i of invoices) {
      const sign = i.docType === "CREDIT_NOTE" ? -1 : 1;
      costs.push({ date: day(i.issuedAt!), amount: D((basis === "NET" ? i.netTotal : i.grossTotal).toString()).mul(sign), vat: D(i.vatTotal.toString()).mul(sign), key: "FIRINGI_PURCHASES" });
    }
  }
  // Suppliers: sales through FIRINGI, from FIRINGI's billing statements (what FIRINGI owes them)
  if ((ctx.company.type === "WHOLESALER" || ctx.company.type === "DISTRIBUTOR") && !s && (branch === undefined || branch === null || branch === "NONE")) {
    const st = await prisma.vendorBillingStatement.findMany({ where: { vendorCompanyId: ctx.company.id, createdAt: { gte: day(from), lt: end } }, select: { createdAt: true, isCreditStatement: true, expectedNet: true, expectedVat: true, expectedGross: true } });
    for (const x of st) {
      const sign = x.isCreditStatement ? -1 : 1;
      sales.push({ date: day(x.createdAt), amount: D((basis === "NET" ? x.expectedNet : x.expectedGross).toString()).mul(sign), vat: D(x.expectedVat.toString()).mul(sign), key: "FIRINGI_SALES" });
    }
  }
  return { sales, costs };
}

const sum = (rows: Row[], f: (r: Row) => Decimal = (r) => r.amount) => rows.reduce((a, r) => a.plus(f(r)), D(0));
const PURCHASE_KEYS = ["FIRINGI_PURCHASES", "OTHER_SUPPLIERS"];

function statement(sales: Row[], costs: Row[]) {
  const salesTotal = sum(sales);
  const purchases = costs.filter((r) => PURCHASE_KEYS.includes(r.key));
  const opex = costs.filter((r) => !PURCHASE_KEYS.includes(r.key));
  const purchasesTotal = sum(purchases);
  const grossProfit = salesTotal.minus(purchasesTotal);
  const opexTotal = sum(opex);
  const netProfit = grossProfit.minus(opexTotal);
  const by = (rows: Row[], keys: readonly string[]) => keys.map((k) => ({ key: k, amount: sum(rows.filter((r) => r.key === k)).toFixed(2) })).filter((x) => !D(x.amount).isZero());
  return {
    sales: { lines: by(sales, ["FIRINGI_SALES", ...SALE_CATEGORIES]), total: salesTotal.toFixed(2) },
    purchases: { lines: by(purchases, PURCHASE_KEYS), total: purchasesTotal.toFixed(2) },
    grossProfit: grossProfit.toFixed(2),
    expenses: { lines: by(opex, EXPENSE_CATEGORIES.filter((c) => c !== "OTHER_SUPPLIERS")), total: opexTotal.toFixed(2) },
    netProfit: netProfit.toFixed(2),
    margin: salesTotal.isZero() ? null : netProfit.div(salesTotal).mul(100).toDecimalPlaces(1).toNumber(),
    vat: { onSales: sum(sales, (r) => r.vat).toFixed(2), onPurchases: sum(costs, (r) => r.vat).toFixed(2), balance: sum(sales, (r) => r.vat).minus(sum(costs, (r) => r.vat)).toFixed(2) },
  };
}

/** Buckets for the chart: days for up to 62 days, else months. */
function series(sales: Row[], costs: Row[], from: Date, to: Date) {
  const byMonth = (to.getTime() - from.getTime()) / 86_400_000 > 62;
  const keyOf = (d: Date) => (byMonth ? iso(d).slice(0, 7) : iso(d));
  const keys: string[] = [];
  for (let d = day(from); d <= day(to); d = new Date(d.getTime() + 86_400_000)) { const k = keyOf(d); if (!keys.includes(k)) keys.push(k); }
  return keys.map((k) => {
    const s = sum(sales.filter((r) => keyOf(r.date) === k)), c = sum(costs.filter((r) => keyOf(r.date) === k));
    return { key: k, sales: s.toNumber(), costs: c.toNumber(), profit: s.minus(c).toNumber() };
  });
}

export async function profitAndLoss(ctx: Ctx, f: { from: Date; to: Date; branch?: string | null; basis?: Basis; compare?: { from: Date; to: Date } | null }) {
  await requireAccounting(ctx);
  const basis = f.basis ?? "GROSS";
  const { sales, costs } = await movements(ctx, f.from, f.to, f.branch, basis);
  const cur = statement(sales, costs);
  let previous: { sales: string; costs: string; netProfit: string } | null = null;
  if (f.compare) {
    const p = await movements(ctx, f.compare.from, f.compare.to, f.branch, basis);
    const st = statement(p.sales, p.costs);
    previous = { sales: st.sales.total, costs: D(st.purchases.total).plus(st.expenses.total).toFixed(2), netProfit: st.netProfit };
  }
  return { from: day(f.from), to: day(f.to), basis, ...cur, costsTotal: D(cur.purchases.total).plus(cur.expenses.total).toFixed(2), series: series(sales, costs, f.from, f.to), previous };
}

/** Dashboard: today / this week / this month, 6-month trend, this month's costs by category, branches. */
export async function accountingDashboard(ctx: Ctx, basis: Basis = "GROSS", branch?: string | null) {
  await requireAccounting(ctx);
  const now = new Date();
  const kpi = async (g: Granularity) => {
    const p = periodOf(g, now), prev = previousPeriod(g, p.from);
    const r = await profitAndLoss(ctx, { ...p, basis, branch, compare: prev });
    return { from: p.from, to: p.to, sales: r.sales.total, costs: r.costsTotal, profit: r.netProfit, margin: r.margin, previous: r.previous };
  };
  const [today, week, month] = [await kpi("DAY"), await kpi("WEEK"), await kpi("MONTH")];
  const trendFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));
  const trend = await profitAndLoss(ctx, { from: trendFrom, to: periodOf("MONTH", now).to, basis, branch });
  const m = periodOf("MONTH", now);
  const thisMonth = await profitAndLoss(ctx, { ...m, basis, branch });
  // per branch this month (multi-site buyers, people who see several branches)
  const branches: { id: string | null; name: string | null; sales: string; costs: string; profit: string }[] = [];
  if (!branch && (ctx.company.type === "CUSTOMER" || ctx.company.type === "WHOLESALER")) {
    const s = await accountingScope(ctx);
    const rows = await prisma.branch.findMany({ where: { companyId: ctx.company.id, ...(s ? { id: { in: s } } : {}) }, select: { id: true, name: true }, orderBy: { name: "asc" } });
    if (rows.length) {
      for (const b of [...rows.map((r) => ({ id: r.id as string | null, name: r.name as string | null })), ...(s ? [] : [{ id: null, name: null }])]) {
        const r = await profitAndLoss(ctx, { ...m, basis, branch: b.id ?? "NONE" });
        if (b.id === null && D(r.sales.total).isZero() && D(r.costsTotal).isZero()) continue;
        branches.push({ id: b.id, name: b.name, sales: r.sales.total, costs: r.costsTotal, profit: r.netProfit });
      }
    }
  }
  const costLines = [...thisMonth.purchases.lines, ...thisMonth.expenses.lines].sort((a, b) => D(b.amount).cmp(a.amount));
  return { basis, today, week, month, trend: trend.series, costLines, branches, recent: await recentEntries(ctx, branch) };
}

async function recentEntries(ctx: Ctx, branch?: string | null) {
  const rows = await prisma.accountingEntry.findMany({ where: await entryWhere(ctx, branch), orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 8, include: { branch: { select: { name: true } } } });
  return rows.map((r) => ({ id: r.id, kind: r.kind, category: r.category as AccountingCategory, date: r.date, amount: r.amount.toString(), branch: r.branch?.name ?? null, payee: r.payee }));
}
