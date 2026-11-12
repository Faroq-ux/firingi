/**
 * Branch reports for head office (Phase 27): spend per branch against its budget, the price each
 * branch paid for the same product, and FIRINGI's invoices of a month per branch / cost centre
 * (the monthly summary accounts payable uses — FIRINGI still issues one invoice per delivered order).
 */
import Decimal from "decimal.js";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { ForbiddenError } from "@/server/errors";
import { pickLocalized } from "@/i18n/config";
import { branchScope, MANAGE } from "./branches";
import { periodBounds, spentFor } from "./budgets";

const D = (v: Decimal.Value) => new Decimal(v);
function requireReports(ctx: Ctx) {
  if ((ctx.company.type !== "CUSTOMER" && ctx.company.type !== "WHOLESALER") || ctx.company.status !== "APPROVED" || !can(ctx, ["buyer.reports.view", MANAGE])) throw new ForbiddenError();
}

async function visibleBranches(ctx: Ctx) {
  const s = await branchScope(ctx);
  const rows = await prisma.branch.findMany({ where: { companyId: ctx.company.id, ...(s ? { id: { in: s } } : {}) }, select: { id: true, name: true, code: true, costCentre: true, isActive: true }, orderBy: { name: "asc" } });
  return { scoped: !!s, rows };
}

/** Per branch in [from, to): orders, spend, average order, open approvals, budget use this period, top products. */
export async function branchComparison(ctx: Ctx, from: Date, to: Date, locale: string) {
  requireReports(ctx);
  const { scoped, rows } = await visibleBranches(ctx);
  const ids: (string | null)[] = [...rows.map((r) => r.id), ...(scoped ? [] : [null])];
  const orders = await prisma.order.groupBy({ by: ["branchId"], where: { buyerCompanyId: ctx.company.id, placedAt: { gte: from, lt: to }, status: { not: "CANCELLED" }, branchId: scoped ? { in: rows.map((r) => r.id) } : undefined }, _sum: { grandTotal: true }, _count: { _all: true } });
  const pending = await prisma.buyerApproval.findMany({ where: { companyId: ctx.company.id, status: "PENDING" }, select: { deliveryAddressId: true } });
  const addrBranch = new Map((await prisma.address.findMany({ where: { id: { in: pending.map((p) => p.deliveryAddressId) } }, select: { id: true, branchId: true } })).map((a) => [a.id, a.branchId]));
  const budgets = await prisma.budget.findMany({ where: { companyId: ctx.company.id, isActive: true, branchId: { not: null } } });
  const lines = await prisma.orderLine.findMany({
    where: { order: { buyerCompanyId: ctx.company.id, placedAt: { gte: from, lt: to }, status: { not: "CANCELLED" }, ...(scoped ? { branchId: { in: rows.map((r) => r.id) } } : {}) } },
    select: { productName: true, offerId: true, qtyOrdered: true, lineNet: true, lineVat: true, order: { select: { branchId: true } } },
  });
  const out = [];
  for (const id of ids) {
    const b = rows.find((r) => r.id === id);
    const o = orders.find((x) => x.branchId === id);
    const spend = D(o?._sum.grandTotal?.toString() ?? 0);
    const count = o?._count._all ?? 0;
    if (id === null && count === 0) continue;
    const own = budgets.filter((x) => x.branchId === id);
    let budget: { name: string; amount: string; spent: string; pct: number; period: string } | null = null;
    if (own.length) {
      const x = own.find((y) => !((y.categoryIds as string[]) ?? []).length) ?? own[0];
      const spent = await spentFor(x);
      budget = { name: x.name, amount: x.amount.toString(), spent: spent.toFixed(2), pct: D(x.amount.toString()).isZero() ? 0 : spent.div(x.amount.toString()).mul(100).toDecimalPlaces(0).toNumber(), period: x.period };
    }
    const products = new Map<string, { name: string; gross: Decimal; qty: number }>();
    for (const l of lines.filter((x) => x.order.branchId === id)) {
      const k = l.offerId;
      const p = products.get(k) ?? { name: pickLocalized(l.productName, locale), gross: D(0), qty: 0 };
      p.gross = p.gross.plus(l.lineNet.toString()).plus(l.lineVat.toString()); p.qty += l.qtyOrdered;
      products.set(k, p);
    }
    out.push({
      id, name: b?.name ?? null, code: b?.code ?? null, costCentre: b?.costCentre ?? null, isActive: b?.isActive ?? true,
      orders: count, spend: spend.toFixed(2), avgOrder: count ? spend.div(count).toFixed(2) : "0.00",
      pendingApprovals: pending.filter((p) => (addrBranch.get(p.deliveryAddressId) ?? null) === id).length, budget,
      top: [...products.values()].sort((a, c) => c.gross.cmp(a.gross)).slice(0, 3).map((p) => ({ name: p.name, gross: p.gross.toFixed(2), qty: p.qty })),
    });
  }
  const total = out.reduce((a, r) => a.plus(r.spend), D(0));
  return { rows: out.map((r) => ({ ...r, share: total.isZero() ? 0 : D(r.spend).div(total).mul(100).toDecimalPlaces(1).toNumber() })), total: total.toFixed(2), orders: out.reduce((a, r) => a + r.orders, 0) };
}

/** Products bought by two or more branches in [from, to): the average price each paid (excl. VAT). */
export async function priceComparison(ctx: Ctx, from: Date, to: Date, locale: string) {
  requireReports(ctx);
  const { scoped, rows } = await visibleBranches(ctx);
  const lines = await prisma.orderLine.findMany({
    where: { order: { buyerCompanyId: ctx.company.id, placedAt: { gte: from, lt: to }, status: { not: "CANCELLED" }, branchId: scoped ? { in: rows.map((r) => r.id) } : { not: null } } },
    select: { offerId: true, productName: true, packagingName: true, sku: true, qtyOrdered: true, unitSalePriceNet: true, order: { select: { branchId: true } } },
  });
  const by = new Map<string, { name: string; packaging: string; sku: string | null; branches: Map<string, { qty: number; value: Decimal }> }>();
  for (const l of lines) {
    const p = by.get(l.offerId) ?? { name: pickLocalized(l.productName, locale), packaging: pickLocalized(l.packagingName, locale), sku: l.sku, branches: new Map() };
    const b = p.branches.get(l.order.branchId!) ?? { qty: 0, value: D(0) };
    b.qty += l.qtyOrdered; b.value = b.value.plus(D(l.unitSalePriceNet.toString()).mul(l.qtyOrdered));
    p.branches.set(l.order.branchId!, b);
    by.set(l.offerId, p);
  }
  const name = (id: string) => rows.find((r) => r.id === id)?.name ?? "—";
  return [...by.entries()].filter(([, p]) => p.branches.size >= 2).map(([offerId, p]) => {
    const prices = [...p.branches.entries()].map(([bid, b]) => ({ branchId: bid, branch: name(bid), qty: b.qty, avgUnitNet: b.value.div(b.qty).toDecimalPlaces(4) }));
    const min = Decimal.min(...prices.map((x) => x.avgUnitNet)), max = Decimal.max(...prices.map((x) => x.avgUnitNet));
    return { offerId, product: p.name, packaging: p.packaging, sku: p.sku, prices: prices.map((x) => ({ ...x, avgUnitNet: x.avgUnitNet.toFixed(4) })).sort((a, b) => a.branch.localeCompare(b.branch)), min: min.toFixed(4), max: max.toFixed(4), spreadPct: min.isZero() ? 0 : max.minus(min).div(min).mul(100).toDecimalPlaces(1).toNumber() };
  }).sort((a, b) => b.spreadPct - a.spreadPct);
}

/** FIRINGI's invoices and credit notes of a month per branch and cost centre (for accounts payable). */
export async function invoiceSummary(ctx: Ctx, month: Date) {
  if ((ctx.company.type !== "CUSTOMER" && ctx.company.type !== "WHOLESALER") || !can(ctx, ["buyer.invoices.view", MANAGE])) throw new ForbiddenError();
  const { start, end } = periodBounds("MONTHLY", month);
  const { scoped, rows } = await visibleBranches(ctx);
  const inv = await prisma.invoice.findMany({
    where: { recipientCompanyId: ctx.company.id, status: { not: "DRAFT" }, issuedAt: { gte: start, lt: end }, ...(scoped ? { order: { branchId: { in: rows.map((r) => r.id) } } } : {}) },
    select: { id: true, fullNumber: true, providerNumber: true, docType: true, issuedAt: true, dueAt: true, netTotal: true, vatTotal: true, grossTotal: true, order: { select: { number: true, branchId: true, costCentre: true, poReference: true } } },
    orderBy: { issuedAt: "asc" },
  });
  const groups = new Map<string, { branchId: string | null; branch: string | null; costCentre: string | null; count: number; net: Decimal; vat: Decimal; gross: Decimal }>();
  for (const i of inv) {
    const bid = i.order?.branchId ?? null;
    const k = `${bid ?? "-"}|${i.order?.costCentre ?? ""}`;
    const sign = i.docType === "CREDIT_NOTE" ? -1 : 1;
    const g = groups.get(k) ?? { branchId: bid, branch: rows.find((r) => r.id === bid)?.name ?? null, costCentre: i.order?.costCentre ?? null, count: 0, net: D(0), vat: D(0), gross: D(0) };
    g.count++; g.net = g.net.plus(D(i.netTotal.toString()).mul(sign)); g.vat = g.vat.plus(D(i.vatTotal.toString()).mul(sign)); g.gross = g.gross.plus(D(i.grossTotal.toString()).mul(sign));
    groups.set(k, g);
  }
  const fmt = (g: { net: Decimal; vat: Decimal; gross: Decimal }) => ({ net: g.net.toFixed(2), vat: g.vat.toFixed(2), gross: g.gross.toFixed(2) });
  const groupRows = [...groups.values()].map((g) => ({ branchId: g.branchId, branch: g.branch, costCentre: g.costCentre, count: g.count, ...fmt(g) })).sort((a, b) => (a.branch ?? "~").localeCompare(b.branch ?? "~"));
  const tot = [...groups.values()].reduce((a, g) => ({ net: a.net.plus(g.net), vat: a.vat.plus(g.vat), gross: a.gross.plus(g.gross) }), { net: D(0), vat: D(0), gross: D(0) });
  return {
    month: start, groups: groupRows, total: { count: inv.length, ...fmt(tot) },
    invoices: inv.map((i) => {
      const sign = i.docType === "CREDIT_NOTE" ? -1 : 1;
      return { id: i.id, number: i.providerNumber ?? i.fullNumber, docType: i.docType, issuedAt: i.issuedAt, dueAt: i.dueAt, order: i.order?.number ?? null, branch: rows.find((r) => r.id === i.order?.branchId)?.name ?? null, costCentre: i.order?.costCentre ?? null, poReference: i.order?.poReference ?? null, net: D(i.netTotal.toString()).mul(sign).toFixed(2), vat: D(i.vatTotal.toString()).mul(sign).toFixed(2), gross: D(i.grossTotal.toString()).mul(sign).toFixed(2) };
    }),
  };
}
