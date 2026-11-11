/**
 * Live activity feed: what just happened that the caller may see — order status changes, payments
 * received / payouts sent, invoices issued. Read from the existing history tables (no extra
 * writes); the dashboard stream (/api/live) polls this every few seconds.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can, portalsFor, type Portal } from "@/server/rbac/guard";
import { scopeWhere } from "@/server/services/admin-access";

export type LiveEvent = { id: string; at: string; kind: "order" | "payment" | "payout" | "invoice"; status?: string; number?: string; who?: string; amount?: string; href: string };

export async function liveEvents(ctx: Ctx, portal: Portal, since: Date, take = 20): Promise<LiveEvent[]> {
  if (!portalsFor(ctx).includes(portal)) return [];
  let orderWhere: Prisma.OrderWhereInput | null = null, payWhere: Prisma.PaymentWhereInput | null = null, invWhere: Prisma.InvoiceWhereInput | null = null;
  let base = "/buy";
  if (portal === "admin") {
    base = "/admin";
    if (can(ctx, ["admin.orders.view", "admin.orders.manage"])) orderWhere = { buyer: scopeWhere(ctx) };
    if (can(ctx, ["admin.finance.view", "admin.finance.manage"])) payWhere = { company: scopeWhere(ctx) };
    if (can(ctx, ["admin.invoices.view", "admin.finance.view"])) invWhere = { recipient: scopeWhere(ctx) };
  } else if (portal === "vendor") {
    base = "/vendor";
    if (can(ctx, ["vendor.orders.view", "vendor.orders.manage"])) orderWhere = { sellerCompanyId: ctx.company.id };
    if (can(ctx, "vendor.payments.view")) payWhere = { companyId: ctx.company.id, direction: "OUTBOUND" };
  } else if (portal === "buy") {
    if (can(ctx, ["buyer.orders.view", "buyer.orders.place"])) orderWhere = { buyerCompanyId: ctx.company.id };
    if (can(ctx, ["buyer.payments.view", "buyer.invoices.view"])) payWhere = { companyId: ctx.company.id, direction: "INBOUND" };
    if (can(ctx, "buyer.invoices.view")) invWhere = { recipientCompanyId: ctx.company.id };
  } else return [];

  const [hist, pays, invs] = await Promise.all([
    orderWhere ? prisma.orderStatusHistory.findMany({
      // A supplier doesn't see FIRINGI's hold (nor the order while held).
      where: { at: { gt: since }, order: orderWhere, ...(portal === "vendor" ? { toStatus: { notIn: ["ON_HOLD", "NEW"] } } : {}) },
      include: { order: { select: { id: true, number: true, grandTotal: true, routedByFiringi: true, buyer: { select: { legalName: true, tradeName: true } }, seller: { select: { legalName: true, tradeName: true } } } } },
      orderBy: { at: "desc" }, take,
    }) : [],
    payWhere ? prisma.payment.findMany({ where: { ...payWhere, status: "CONFIRMED", createdAt: { gt: since } }, include: { company: { select: { legalName: true, tradeName: true } } }, orderBy: { createdAt: "desc" }, take }) : [],
    invWhere ? prisma.invoice.findMany({ where: { ...invWhere, status: { not: "DRAFT" }, issuedAt: { gt: since } }, include: { recipient: { select: { legalName: true, tradeName: true } } }, orderBy: { issuedAt: "desc" }, take }) : [],
  ]);
  const name = (c: { legalName: string; tradeName: string | null }) => c.tradeName ?? c.legalName;
  const out: LiveEvent[] = [
    ...hist.map((h) => ({
      id: `o:${h.id}`, at: h.at.toISOString(), kind: "order" as const, status: h.toStatus, number: h.order.number,
      // Each side sees the other party; a buyer of a FIRINGI-routed order sees FIRINGI.
      who: portal === "buy" ? (h.order.routedByFiringi ? "FIRINGI" : name(h.order.seller)) : name(h.order.buyer),
      amount: h.order.grandTotal.toFixed(2), href: `${base}/orders/${h.order.id}`,
    })),
    ...pays.map((p) => ({
      id: `p:${p.id}`, at: p.createdAt.toISOString(), kind: p.direction === "INBOUND" ? ("payment" as const) : ("payout" as const), who: portal === "admin" ? name(p.company) : undefined,
      amount: p.amount.toFixed(2), href: portal === "admin" ? `/admin/finance/${p.direction === "INBOUND" ? "customer-payments" : "vendor-payments"}` : portal === "vendor" ? "/vendor/finance/payments" : "/buy/finance/payments",
    })),
    ...invs.map((i) => ({
      id: `i:${i.id}`, at: i.issuedAt!.toISOString(), kind: "invoice" as const, number: i.providerNumber ?? i.fullNumber ?? "", who: portal === "admin" ? name(i.recipient) : undefined,
      amount: i.grossTotal.toFixed(2), href: portal === "admin" ? `/admin/invoices/${i.id}` : `/buy/finance/invoices`,
    })),
  ];
  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, take);
}
