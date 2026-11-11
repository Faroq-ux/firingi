/** FIRINGI finance views of online payments (regional scope applies to customers). */
import "server-only";
import type { PaymentRequestStatus } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { ForbiddenError } from "@/server/errors";
import { scopeWhere } from "@/server/services/admin-access";
import { activeProvider } from "./provider";
import { customerCredit, payLinkUrl } from "./service";

function assertStaff(ctx: Ctx) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, ["admin.finance.view", "admin.finance.manage"])) throw new ForbiddenError();
}

export async function onlinePaymentsOverview(ctx: Ctx, f: { status?: PaymentRequestStatus } = {}) {
  assertStaff(ctx);
  const scope = { company: scopeWhere(ctx) };
  const since = new Date(Date.now() - 30 * 86400_000);
  const [requests, byStatus, paid30, events, failedEvents, creditCompanies] = await Promise.all([
    prisma.paymentRequest.findMany({
      where: { ...scope, ...(f.status ? { status: f.status } : {}) },
      include: { company: { select: { legalName: true } }, order: { select: { number: true } }, items: { include: { invoice: { select: { fullNumber: true, providerNumber: true } } } } },
      orderBy: { updatedAt: "desc" }, take: 100,
    }),
    prisma.paymentRequest.groupBy({ by: ["status"], where: { ...scope, updatedAt: { gt: since } }, _count: true, _sum: { amount: true } }),
    prisma.paymentRequest.groupBy({ by: ["method"], where: { ...scope, status: "PAID", paidAt: { gt: since } }, _count: true, _sum: { paidAmount: true } }),
    prisma.paymentEvent.findMany({ orderBy: { receivedAt: "desc" }, take: 25 }),
    prisma.paymentEvent.count({ where: { processedAt: null, error: { not: null } } }),
    prisma.$queryRaw<{ companyId: string }[]>`
      SELECT DISTINCT p."companyId" FROM "Payment" p
      LEFT JOIN (SELECT "paymentId", sum(amount) AS a FROM "PaymentAllocation" GROUP BY 1) x ON x."paymentId" = p.id
      WHERE p.direction = 'INBOUND' AND p.status = 'CONFIRMED' AND p.amount - p."refundedAmount" - coalesce(x.a, 0) > 0.004 LIMIT 200`,
  ]);
  const credits = [];
  for (const { companyId } of creditCompanies) {
    const c = await prisma.company.findFirst({ where: { id: companyId, ...scopeWhere(ctx) }, select: { legalName: true } });
    if (!c) continue;
    for (const p of await customerCredit(companyId)) credits.push({ paymentId: p.id, company: c.legalName, companyId, free: p.free.toFixed(2), paidAt: p.paidAt, method: p.method, order: p.orderNumber, waitingForOrder: !!p.orderId && p.orderStatus !== "CANCELLED" && p.orderStatus !== "RETURNED" && p.orderStatus !== "DELIVERED" });
  }
  const provider = activeProvider();
  return {
    provider: provider ? { key: provider.key, label: provider.label, mode: provider.mode, methods: provider.methods } : null,
    webhookUrl: provider ? `${(process.env.APP_URL ?? process.env.BETTER_AUTH_URL ?? "").replace(/\/$/, "")}/api/webhooks/payments/${provider.key}` : null,
    byStatus: Object.fromEntries(byStatus.map((b) => [b.status, { count: b._count, amount: Number(b._sum.amount ?? 0) }])),
    paid30: paid30.map((p) => ({ method: p.method ?? "OTHER", count: p._count, amount: Number(p._sum.paidAmount ?? 0) })),
    requests: requests.map((r) => ({
      id: r.id, company: r.company.legalName, companyId: r.companyId, status: r.status, source: r.source, method: r.method, amount: r.amount.toFixed(2), paidAmount: r.paidAmount?.toFixed(2) ?? null,
      docs: r.order ? `Order ${r.order.number}` : r.items.map((i) => i.invoice.providerNumber ?? i.invoice.fullNumber ?? "?").join(", "), failureReason: r.failureReason,
      updatedAt: r.updatedAt, expiresAt: r.expiresAt, link: r.status === "OPEN" || r.status === "FAILED" ? payLinkUrl(r.token) : null,
      multibanco: r.method === "MULTIBANCO" && r.status === "PROCESSING",
    })),
    credits, events: events.map((e) => ({ id: e.id, provider: e.provider, type: e.type, eventId: e.eventId, receivedAt: e.receivedAt, processed: !!e.processedAt, error: e.error })), failedEvents,
  };
}

export async function mandatesOverview(ctx: Ctx) {
  assertStaff(ctx);
  const mandates = await prisma.sepaMandate.findMany({ where: { company: scopeWhere(ctx) }, include: { company: { select: { legalName: true } } }, orderBy: { createdAt: "desc" }, take: 200 });
  const collections = await prisma.paymentRequest.findMany({ where: { source: "DIRECT_DEBIT", company: scopeWhere(ctx) }, include: { company: { select: { legalName: true } } }, orderBy: { createdAt: "desc" }, take: 50 });
  return { mandates, collections };
}

/** For a customer's page in the back office. */
export async function customerPaymentSettings(companyId: string) {
  const [c, mandate, credit] = await Promise.all([
    prisma.company.findUnique({ where: { id: companyId }, select: { payBeforeShipping: true, type: true } }),
    prisma.sepaMandate.findFirst({ where: { companyId, status: "ACTIVE" }, select: { ibanLast4: true, autoCollect: true, signedAt: true } }),
    customerCredit(companyId),
  ]);
  return { payBeforeShipping: !!c?.payBeforeShipping, buys: c?.type === "CUSTOMER" || c?.type === "WHOLESALER", mandate, credit: credit.reduce((a, x) => a + x.free.toNumber(), 0) };
}

export async function payFirstCompanies(ids: string[]) {
  const rows = await prisma.company.findMany({ where: { id: { in: ids }, payBeforeShipping: true }, select: { id: true } });
  return new Set(rows.map((r) => r.id));
}
