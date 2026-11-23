import "server-only";
/**
 * Phase 67: what an automation's trigger picks up — new orders, fraud holds, overdue customers,
 * failed deliveries, quality claims, support requests, registrations and new AI suggestions. Read
 * from FIRINGI's own tables after the workflow's cursor (so nothing in the order flow had to change);
 * each event has a stable key, so a workflow runs once per event.
 */
import { prisma } from "@/server/db";
import type { Payload, TriggerKind } from "@/lib/ai-ops";
import { KIND_AREA, type AnyRecKind } from "@/lib/ai-centre";

export type AutoEvent = { key: string; at: Date; subjectType: string; subjectId: string; companyId: string | null; link: string; payload: Payload };

const name = (c: { legalName: string; tradeName: string | null } | null | undefined) => (c ? c.tradeName ?? c.legalName : "—");
const co = { select: { legalName: true, tradeName: true } } as const;
const money = (d: unknown) => Math.round(Number(d) * 100) / 100;

/** Events of this trigger after `since` (oldest first), at most `take`. */
export async function eventsSince(trigger: TriggerKind, since: Date, now = new Date(), take = 100): Promise<AutoEvent[]> {
  const after = { gt: since, lte: now };
  switch (trigger) {
    case "ORDER_PLACED": {
      const rows = await prisma.order.findMany({ where: { placedAt: after }, orderBy: { placedAt: "asc" }, take, include: { buyer: co, seller: co, country: { select: { code: true } } } });
      return rows.map((o) => ({ key: `order:${o.id}`, at: o.placedAt, subjectType: "Order", subjectId: o.id, companyId: o.buyerCompanyId, link: `/admin/orders/${o.id}`, payload: { number: o.number, total: money(o.netTotal), gross: money(o.grandTotal), buyer: name(o.buyer), supplier: name(o.seller), country: o.country.code, via: o.placedVia, status: o.status } }));
    }
    case "ORDER_HELD": {
      const rows = await prisma.riskAssessment.findMany({ where: { createdAt: after, held: true }, orderBy: { createdAt: "asc" }, take, include: { order: { select: { id: true, number: true, netTotal: true, buyer: co } } } });
      return rows.map((r) => ({ key: `held:${r.id}`, at: r.createdAt, subjectType: "Order", subjectId: r.orderId, companyId: r.buyerCompanyId, link: `/admin/risk/suspicious-orders`, payload: { number: r.order.number, score: r.score, level: r.level, buyer: name(r.order.buyer), total: money(r.order.netTotal) } }));
    }
    case "INVOICE_OVERDUE": {
      const { overdueByCustomer } = await import("../centre/recs");
      const rows = (await overdueByCustomer(now, 0)).sort((a, b) => b.open - a.open).slice(0, take);
      return rows.map((r) => ({ key: `overdue:${r.buyerId}:${r.oldestDue}`, at: now, subjectType: "Company", subjectId: r.buyerId, companyId: r.buyerId, link: `/admin/companies/${r.buyerId}`, payload: { buyer: r.buyer, open: r.open, invoices: r.invoices, daysLate: r.daysLate, oldestDue: r.oldestDue } }));
    }
    case "DELIVERY_FAILED": {
      const rows = await prisma.deliveryAttempt.findMany({ where: { at: after, succeeded: false }, orderBy: { at: "asc" }, take, include: { delivery: { select: { orderId: true, executor: co, order: { select: { number: true, buyerCompanyId: true } } } } } });
      return rows.map((a) => ({ key: `failed:${a.id}`, at: a.at, subjectType: "Order", subjectId: a.delivery.orderId, companyId: a.delivery.order.buyerCompanyId, link: `/admin/orders/${a.delivery.orderId}`, payload: { number: a.delivery.order.number, reason: a.failureReason ?? a.reasonCode ?? "", supplier: name(a.delivery.executor) } }));
    }
    case "CLAIM_OPENED": {
      const rows = await prisma.qualityClaim.findMany({ where: { createdAt: after }, orderBy: { createdAt: "asc" }, take, include: { buyer: co, seller: co } });
      return rows.map((c) => ({ key: `claim:${c.id}`, at: c.createdAt, subjectType: "QualityClaim", subjectId: c.id, companyId: c.buyerCompanyId, link: `/admin/orders/claims/${c.id}`, payload: { number: c.number, reason: c.reason, buyer: name(c.buyer), supplier: name(c.seller) } }));
    }
    case "TICKET_OPENED": {
      const rows = await prisma.supportTicket.findMany({ where: { createdAt: after }, orderBy: { createdAt: "asc" }, take, include: { company: co } });
      return rows.map((t) => ({ key: `ticket:${t.id}`, at: t.createdAt, subjectType: "SupportTicket", subjectId: t.id, companyId: t.companyId, link: `/admin/customers/support/${t.id}`, payload: { number: t.number, subject: t.subject, category: t.category, priority: t.priority, company: name(t.company) } }));
    }
    case "COMPANY_REGISTERED": {
      const rows = await prisma.company.findMany({ where: { createdAt: after, type: { not: "ADMIN" } }, orderBy: { createdAt: "asc" }, take, include: { country: { select: { code: true } } } });
      return rows.map((c) => ({ key: `company:${c.id}`, at: c.createdAt, subjectType: "Company", subjectId: c.id, companyId: c.id, link: `/admin/companies/${c.id}`, payload: { name: name(c), type: c.type, country: c.country.code, status: c.status } }));
    }
    case "AI_SUGGESTION": {
      const rows = await prisma.aiRecommendation.findMany({ where: { createdAt: after, audience: "STAFF", status: "OPEN" }, orderBy: { createdAt: "asc" }, take });
      return rows.map((r) => {
        const area = KIND_AREA[r.kind as AnyRecKind] ?? "SALES";
        return { key: `rec:${r.id}`, at: r.createdAt, subjectType: "AiRecommendation", subjectId: r.id, companyId: r.subjectType === "Company" ? r.subjectId : null, link: `/admin/ai/recommendations?area=${area}`, payload: { title: r.title, kind: r.kind, area, score: r.score } };
      });
    }
    case "SCHEDULE":
    case "MANUAL":
      return [];
  }
}

/** The most recent event of a trigger (for "Test" and "Run now" on event workflows). */
export async function latestEvents(trigger: TriggerKind, now = new Date(), take = 20) {
  const all = await eventsSince(trigger, new Date(now.getTime() - 90 * 86400_000), now, 500);
  return all.slice(-take).reverse();
}
