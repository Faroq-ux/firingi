import "server-only";
/**
 * Services & used oil in the AI (Phase 68):
 *   • suggestions for FIRINGI staff (AI Centre): visits missed, a schedule to adjust (containers mostly empty or
 *     overflowing at collection), used oil overflowing with nothing planned, a provider's licence ending with plans;
 *   • the customer's Assistant: "my services" (plans, next visits, oil status) and "request a collection";
 *   • agents and automations: a services overview, and triggers for requests, full containers and missed visits.
 */
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { ForbiddenError } from "@/server/errors";
import { isoDay, OPEN_VISIT } from "@/lib/services";
import type { CentreRec } from "@/server/ai/centre/recs";
import { servicesSettings } from "./settings";

const DAY = 86400_000;
const n = (v: { toString(): string } | null | undefined) => (v == null ? 0 : Number(v.toString()));
const clamp = (x: number) => Math.max(0, Math.min(100, Math.round(x)));
const nameOf = (c: { legalName: string; tradeName: string | null } | null | undefined) => c?.tradeName ?? c?.legalName ?? "—";
const tName = (t: { name: unknown; code: string }) => String((t.name as Record<string, string>)?.en ?? t.code);

export async function serviceRecommendations(now = new Date()): Promise<CentreRec[]> {
  const s = await servicesSettings();
  if (!s.enabled || !s.parts.ai) return [];
  const out: CentreRec[] = [];
  const wk = Math.floor(now.getTime() / (7 * DAY));
  // missed visits in the last 7 days, per customer
  const missed = await prisma.serviceVisit.findMany({ where: { status: "MISSED", date: { gte: new Date(now.getTime() - 7 * DAY) } }, include: { serviceType: true } });
  const byCo = new Map<string, typeof missed>();
  for (const v of missed) byCo.set(v.customerCompanyId, [...(byCo.get(v.customerCompanyId) ?? []), v]);
  const cos = await prisma.company.findMany({ where: { id: { in: [...byCo.keys()] } }, select: { id: true, legalName: true, tradeName: true } });
  for (const [id, vs] of byCo) {
    out.push({ kind: "SERVICE_MISSED", audience: "STAFF", companyId: null, subjectType: "Company", subjectId: id, dedupeKey: `SVCMISSED:${id}:${wk}`, title: `${nameOf(cos.find((c) => c.id === id))}: ${vs.length} service visit${vs.length === 1 ? "" : "s"} missed this week (${[...new Set(vs.map((v) => tName(v.serviceType)))].join(", ")})`, detail: { buyerId: id, buyer: nameOf(cos.find((c) => c.id === id)), visits: vs.map((v) => ({ number: v.number, date: isoDay(v.date), reason: v.missedReason })) }, score: clamp(55 + vs.length * 10) });
  }
  // oil plans: schedule to adjust, containers overflowing
  if (s.parts.oil) {
    const { usedOil } = await import("./oil");
    const plans = await prisma.servicePlan.findMany({ where: { status: "ACTIVE", serviceType: { isOil: true } }, include: { serviceType: true } });
    const pcos = await prisma.company.findMany({ where: { id: { in: plans.map((p) => p.customerCompanyId) } }, select: { id: true, legalName: true, tradeName: true } });
    for (const p of plans) {
      const who = nameOf(pcos.find((c) => c.id === p.customerCompanyId));
      const cap = p.containers * p.containerLitres;
      const done = await prisma.serviceVisit.findMany({ where: { planId: p.id, status: "DONE" }, orderBy: { doneAt: "desc" }, take: 4, select: { quantity: true } });
      if (cap > 0 && done.length >= 3 && p.frequency !== "ON_REQUEST") {
        const avg = done.reduce((a, v) => a + n(v.quantity), 0) / done.length / cap;
        if (avg < 0.3 || avg > 0.95) {
          const less = avg < 0.3;
          out.push({ kind: "SERVICE_FREQUENCY", audience: "STAFF", companyId: null, subjectType: "Company", subjectId: p.customerCompanyId, dedupeKey: `SVCFREQ:${p.id}:${wk}`, title: `${who}: used-oil containers are ${Math.round(avg * 100)}% full at collection — suggest collecting ${less ? "less" : "more"} often (now ${p.frequency.toLowerCase().replace("_", " ")})`, detail: { buyerId: p.customerCompanyId, buyer: who, planId: p.id, number: p.number, frequency: p.frequency, avgPct: Math.round(avg * 100), less }, score: clamp(less ? 35 : 60) });
        }
      }
      const u = await usedOil(p.customerCompanyId, s.oil.fullPct);
      if (u.pct !== null && u.pct >= 100) {
        const open = await prisma.serviceVisit.findFirst({ where: { planId: p.id, status: { in: OPEN_VISIT as string[] }, date: { lte: new Date(now.getTime() + 3 * DAY) } } });
        if (!open) out.push({ kind: "OIL_CONTAINER_FULL", audience: "STAFF", companyId: null, subjectType: "Company", subjectId: p.customerCompanyId, dedupeKey: `OILFULL:${p.id}:${isoDay(now)}`, title: `${who}: used-oil containers at ${u.pct}% (${u.litres} of ${u.capacity} L) and no collection in the next 3 days`, detail: { buyerId: p.customerCompanyId, buyer: who, planId: p.id, serviceTypeId: p.serviceTypeId, litres: u.litres, capacity: u.capacity, pct: u.pct }, score: clamp(70 + Math.min(25, (u.pct - 100) / 2)) });
      }
    }
  }
  // providers whose licence ended (or ends within 14 days) with active plans
  const lic = await prisma.serviceProvider.findMany({ where: { status: "APPROVED", licenceExpiresAt: { lte: new Date(now.getTime() + 14 * DAY) } }, include: { serviceType: true, _count: { select: { plans: { where: { status: "ACTIVE" } } } } } });
  const lcos = await prisma.company.findMany({ where: { id: { in: lic.map((p) => p.companyId) } }, select: { id: true, legalName: true, tradeName: true } });
  for (const p of lic.filter((x) => x._count.plans > 0)) {
    const ended = p.licenceExpiresAt! <= now;
    out.push({ kind: "PROVIDER_LICENCE", audience: "STAFF", companyId: null, subjectType: "Company", subjectId: p.companyId, dedupeKey: `SVCLIC:${p.id}:${isoDay(p.licenceExpiresAt!)}`, title: `${nameOf(lcos.find((c) => c.id === p.companyId))}: ${tName(p.serviceType)} licence ${ended ? "ended" : "ends"} ${isoDay(p.licenceExpiresAt!)} — ${p._count.plans} active plan${p._count.plans === 1 ? "" : "s"}`, detail: { vendorId: p.companyId, vendor: nameOf(lcos.find((c) => c.id === p.companyId)), providerId: p.id, service: tName(p.serviceType), expires: isoDay(p.licenceExpiresAt!), plans: p._count.plans }, score: clamp(ended ? 85 : 60) });
  }
  return out;
}

/** Accepting one of these: a CRM task (missed, schedule, licence) or a collection request (overflowing). */
export async function acceptServiceKind(ctx: Ctx, r: { kind: string; detail: unknown }) {
  const d = r.detail as Record<string, unknown>;
  if (r.kind === "OIL_CONTAINER_FULL") {
    const { requestVisit } = await import("./plans");
    const v = await requestVisit(null, { companyId: String(d.buyerId), serviceTypeId: String(d.serviceTypeId), reason: "CONTAINER_FULL", note: "Requested by FIRINGI (AI Centre)" }).catch(() => null);
    return v ? { visit: v.number } : {};
  }
  if (!can(ctx, "admin.crm.manage")) return {};
  const { createTask } = await import("@/server/services/crm");
  const companyId = String(d.buyerId ?? d.vendorId ?? "");
  if (!companyId) return {};
  const owner = (await prisma.crmAccount.findUnique({ where: { companyId }, select: { ownerId: true } }))?.ownerId;
  const title = r.kind === "SERVICE_MISSED" ? `Call ${d.buyer}: service visits missed` : r.kind === "SERVICE_FREQUENCY" ? `Suggest ${d.buyer} collects ${d.less ? "less" : "more"} often (oil)` : `Ask ${d.vendor} for the renewed ${d.service} licence`;
  const t = await createTask(ctx, { kind: "FOLLOW_UP", companyId, assigneeId: owner ?? ctx.user.id, dueAt: new Date(), title, notes: `${JSON.stringify(d).slice(0, 800)} (AI suggestion)` }).catch(() => null);
  return t ? { taskId: t.id } : {};
}

// ── the customer's Assistant & agents ───────────────────────────────────────

/** For the customer's Assistant: plans, next visits, oil status (its own company only). */
export async function myServicesForAi(ctx: Ctx, now = new Date()) {
  if (!can(ctx, ["buyer.services.manage", "buyer.services.log"])) throw new ForbiddenError();
  const s = await servicesSettings();
  const plans = await prisma.servicePlan.findMany({ where: { customerCompanyId: ctx.company.id, status: { in: ["ACTIVE", "PAUSED"] } }, include: { serviceType: true } });
  const visits = await prisma.serviceVisit.findMany({ where: { customerCompanyId: ctx.company.id, status: { in: OPEN_VISIT as string[] }, date: { gte: new Date(now.getTime() - DAY) } }, orderBy: { date: "asc" }, take: 10, include: { serviceType: true } });
  const last = await prisma.serviceVisit.findMany({ where: { customerCompanyId: ctx.company.id, status: "DONE" }, orderBy: { doneAt: "desc" }, take: 5, include: { serviceType: true } });
  let oil: unknown = null;
  if (s.parts.oil) {
    const { oilFor } = await import("./oil");
    const o = await oilFor(ctx.company.id, s.oil, now);
    oil = { usedOilLitres: o.storage.litres, containersFullPct: o.storage.pct, fryers: o.fryers.filter((f) => f.active).map((f) => ({ name: f.name, status: f.status, daysSinceChange: f.days, lastPolarPct: f.lastPolarPct })), insights: o.insights };
  }
  return {
    services: plans.map((p) => ({ serviceTypeId: p.serviceTypeId, service: tName(p.serviceType), plan: p.number, frequency: p.frequency, status: p.status })),
    nextVisits: visits.map((v) => ({ number: v.number, service: tName(v.serviceType), date: isoDay(v.date), status: v.status })),
    lastVisits: last.map((v) => ({ number: v.number, service: tName(v.serviceType), date: isoDay(v.date), quantity: v.quantity == null ? null : n(v.quantity), unit: v.serviceType.unit })),
    oil,
  };
}

/** For staff agents and the staff Assistant: requests waiting, visits this week, missed, overflowing containers, money open. */
export async function servicesOverviewForAi(ctx: Ctx, now = new Date()) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, ["admin.services.view", "admin.services.manage", "admin.customers.view"])) throw new ForbiddenError();
  const [requested, week, missed, done30] = await Promise.all([
    prisma.serviceVisit.findMany({ where: { status: "REQUESTED" }, take: 30, orderBy: { date: "asc" }, include: { serviceType: true } }),
    prisma.serviceVisit.count({ where: { status: { in: ["SCHEDULED", "CONFIRMED"] }, date: { lte: new Date(now.getTime() + 7 * DAY) } } }),
    prisma.serviceVisit.findMany({ where: { status: "MISSED", date: { gte: new Date(now.getTime() - 14 * DAY) } }, take: 30, include: { serviceType: true } }),
    prisma.serviceVisit.findMany({ where: { status: "DONE", doneAt: { gte: new Date(now.getTime() - 30 * DAY) } }, select: { quantity: true, serviceType: { select: { isOil: true } }, feeNet: true, commissionNet: true } }),
  ]);
  const cos = await prisma.company.findMany({ where: { id: { in: [...requested, ...missed].map((v) => v.customerCompanyId) } }, select: { id: true, legalName: true, tradeName: true } });
  const who = (id: string) => nameOf(cos.find((c) => c.id === id));
  const { moneyOpen } = await import("./plans");
  const m = await moneyOpen();
  return {
    requestsWaiting: requested.map((v) => ({ number: v.number, customer: who(v.customerCompanyId), customerId: v.customerCompanyId, service: tName(v.serviceType), date: isoDay(v.date), reason: v.requestReason })),
    visitsNext7Days: week,
    missedLast14Days: missed.map((v) => ({ number: v.number, customer: who(v.customerCompanyId), customerId: v.customerCompanyId, service: tName(v.serviceType), date: isoDay(v.date), reason: v.missedReason })),
    last30Days: { visitsDone: done30.length, usedOilLitres: Math.round(done30.filter((v) => v.serviceType.isOil).reduce((a, v) => a + n(v.quantity), 0)), feesEUR: Math.round(done30.reduce((a, v) => a + n(v.feeNet), 0)), commissionEUR: Math.round(done30.reduce((a, v) => a + n(v.commissionNet), 0)) },
    moneyOpenEUR: { oilToPayCustomers: m.buyback, toPayProviders: m.provider, commissionToInvoice: m.commission },
  };
}
