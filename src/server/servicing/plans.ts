import "server-only";
/**
 * Services (Phase 68): customers' plans and visits.
 *
 *   • A customer (buyer.services.manage) takes a service: how often (every week, every 2 weeks, twice a month, every
 *     month, or only when requested), which day, morning / afternoon, the address; for used oil the containers and
 *     their size and whether to ask for a collection by itself when they are nearly full. FIRINGI picks the approved
 *     provider for the customer's country (fewest plans first). Visits are planned ahead (FIRINGI's days) and kept in
 *     step when the plan changes, pauses or ends.
 *   • Anyone at the customer (buyer.services.log) can request a collection / visit; the customer can skip or move a
 *     visit. The provider confirms (or moves) it, then records it: quantity (litres, kg, bins), containers taken / left,
 *     who signed, the waste document number, and — when the provider invoices — its own invoice number.
 *   • Money (who invoices is FIRINGI's choice per service and provider): FIRINGI invoices the customer (FIRINGI pays the
 *     provider its amount and the customer for the oil), or the provider invoices the customer and FIRINGI earns a
 *     commission, invoiced to the provider monthly.
 */
import type { Prisma } from "@prisma/client";
import Decimal from "decimal.js";
import { prisma, type Tx } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";
import { nextNumber } from "@/server/services/orders";
import { FREQUENCIES, OPEN_VISIT, WINDOWS, isoDay, localName, visitDates, visitMoney, type Frequency, type InvoicedBy } from "@/lib/services";
import { allowedFrequency, ensureBuiltIns, isStaff, pickProvider, pricingOf } from "./catalogue";
import { customerOn, providerOn, servicesSettings } from "./settings";

const DAY = 86400_000;
const n = (v: { toString(): string } | null | undefined) => (v == null ? 0 : Number(v.toString()));
const nameOf = (c: { legalName: string; tradeName: string | null } | null | undefined) => c?.tradeName ?? c?.legalName ?? "—";
const today = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
const typeName = (t: { name: unknown; code: string }) => String((t.name as Record<string, string>)?.en ?? t.code);

async function assertCustomer(ctx: Ctx, perm: "buyer.services.manage" | "buyer.services.log") {
  if (isStaff(ctx) || !(ctx.company.type === "CUSTOMER" || ctx.company.type === "WHOLESALER")) throw new ForbiddenError();
  if (!can(ctx, perm === "buyer.services.log" ? ["buyer.services.log", "buyer.services.manage"] : perm)) throw new ForbiddenError();
  const s = await servicesSettings();
  if (!customerOn(s, ctx.company)) throw new AppError("FEATURE_OFF", "FIRINGI hasn't switched services on for your company.", 403);
  return s;
}
async function myProviderIds(ctx: Ctx) {
  if (isStaff(ctx) && can(ctx, ["admin.services.manage", "admin.services.view"])) {
    return (await prisma.serviceProvider.findMany({ where: { companyId: ctx.company.id }, select: { id: true } })).map((p) => p.id);
  }
  if (!can(ctx, ["vendor.services.manage", "vendor.services.visit"])) throw new ForbiddenError();
  if (!providerOn(await servicesSettings(), ctx.company)) throw new AppError("FEATURE_OFF", "FIRINGI hasn't switched services on for your company.", 403);
  return (await prisma.serviceProvider.findMany({ where: { companyId: ctx.company.id }, select: { id: true } })).map((p) => p.id);
}

// ── planning visits ─────────────────────────────────────────────────────────

/** Plan the visits of an active plan up to FIRINGI's days ahead (one per date; existing ones stay). */
export async function planVisits(planId: string, now = new Date()) {
  const s = await servicesSettings();
  const p = await prisma.servicePlan.findUnique({ where: { id: planId } });
  if (!p || p.status !== "ACTIVE" || p.frequency === "ON_REQUEST" || !s.parts.scheduled) return 0;
  const from = p.pausedUntil && p.pausedUntil > now ? p.pausedUntil : today(now);
  const dates = visitDates({ frequency: p.frequency as Frequency, weekday: p.weekday, dayA: p.dayA, dayB: p.dayB, startsOn: p.startsOn }, from, new Date(today(now).getTime() + s.daysAhead * DAY));
  const have = new Set((await prisma.serviceVisit.findMany({ where: { planId, origin: "SCHEDULED", date: { in: dates } }, select: { date: true } })).map((v) => isoDay(v.date)));
  let made = 0;
  for (const d of dates.filter((x) => !have.has(isoDay(x)))) {
    await prisma.$transaction(async (tx) => {
      await tx.serviceVisit.create({ data: { number: await nextNumber(tx, "service_visit", "SV"), planId, customerCompanyId: p.customerCompanyId, serviceTypeId: p.serviceTypeId, providerId: p.providerId, origin: "SCHEDULED", status: "SCHEDULED", date: d, timeWindow: p.timeWindow } });
    }).then(() => made++).catch((e: { code?: string }) => { if (e.code !== "P2002") throw e; });
  }
  return made;
}
/** Future planned visits that nobody confirmed go when the plan changes (they are planned again from the new schedule). */
async function dropFutureScheduled(tx: Tx, planId: string, now = new Date()) {
  return tx.serviceVisit.deleteMany({ where: { planId, origin: "SCHEDULED", status: "SCHEDULED", date: { gte: today(now) } } });
}

// ── customer ────────────────────────────────────────────────────────────────

export type PlanInput = {
  serviceTypeId: string; frequency: string; weekday: number; dayA: number; dayB: number; timeWindow: string; addressId?: string | null;
  containers?: number; containerLitres?: number; autoRequestWhenFull?: boolean; notes?: string | null; startsOn?: Date | null;
};
function cleanSchedule(i: Pick<PlanInput, "frequency" | "weekday" | "dayA" | "dayB" | "timeWindow">) {
  if (!(FREQUENCIES as readonly string[]).includes(i.frequency)) throw new ValidationError("Choose how often.");
  if (!(WINDOWS as readonly string[]).includes(i.timeWindow)) throw new ValidationError("Choose a time.");
  const weekday = Math.min(7, Math.max(1, Math.round(i.weekday || 1)));
  const dayA = Math.min(31, Math.max(1, Math.round(i.dayA || 1))), dayB = Math.min(31, Math.max(1, Math.round(i.dayB || 15)));
  if (i.frequency === "TWICE_MONTHLY" && dayA === dayB) throw new ValidationError("Choose two different days.");
  return { frequency: i.frequency, weekday, dayA, dayB, timeWindow: i.timeWindow };
}

export async function subscribe(ctx: Ctx, i: PlanInput, now = new Date()) {
  const s = await assertCustomer(ctx, "buyer.services.manage");
  await ensureBuiltIns();
  const t = await prisma.serviceType.findUnique({ where: { id: i.serviceTypeId } });
  if (!t || !t.active || (t.countries.length && !t.countries.includes(ctx.company.countryCode))) throw new NotFoundError("Service");
  const sch = cleanSchedule(i);
  if (!allowedFrequency(t, sch.frequency)) throw new ValidationError("This service isn't offered on that schedule.");
  if (sch.frequency === "ON_REQUEST" ? !s.parts.onRequest : !s.parts.scheduled) throw new ValidationError("This schedule is switched off.");
  if (await prisma.servicePlan.findFirst({ where: { customerCompanyId: ctx.company.id, serviceTypeId: t.id, status: { in: ["ACTIVE", "PAUSED"] } } })) throw new ValidationError("You already have this service — change its plan instead.");
  const provider = await pickProvider(t.id, ctx.company.countryCode, now);
  if (!provider) throw new ValidationError("No provider for this service in your area yet — FIRINGI is working on it.");
  const addr = i.addressId ? await prisma.address.findFirst({ where: { id: i.addressId, companyId: ctx.company.id, isActive: true } }) : await prisma.address.findFirst({ where: { companyId: ctx.company.id, kind: "DELIVERY", isActive: true }, orderBy: { createdAt: "asc" } });
  const start = i.startsOn && i.startsOn > today(now) ? today(i.startsOn) : new Date(today(now).getTime() + s.requestLeadDays * DAY);
  const plan = await prisma.$transaction(async (tx) => tx.servicePlan.create({
    data: {
      number: await nextNumber(tx, "service_plan", "SP"), customerCompanyId: ctx.company.id, serviceTypeId: t.id, providerId: provider.id, addressId: addr?.id ?? null, ...sch,
      containers: Math.max(0, Math.min(50, Math.round(i.containers ?? 1))), containerLitres: Math.max(0, Math.min(5000, Math.round(i.containerLitres ?? 0))),
      autoRequestWhenFull: i.autoRequestWhenFull ?? t.isOil, notes: i.notes?.trim().slice(0, 500) || null, startsOn: start, createdById: ctx.user.id,
    },
  }));
  await planVisits(plan.id, now);
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "services.plan_created", entityType: "ServicePlan", entityId: plan.id, after: { number: plan.number, service: t.code, ...sch, provider: provider.id } });
  const { notify } = await import("@/server/notify/dispatch");
  await notify("service.plan_new", [{ companyId: provider.companyId, link: "/vendor/services" }], { number: plan.number, customer: nameOf(ctx.company), service: typeName(t) }, { ref: { type: "ServicePlan", id: plan.id } }).catch(() => null);
  return plan;
}

async function myPlan(ctx: Ctx, planId: string) {
  const p = await prisma.servicePlan.findFirst({ where: { id: planId, customerCompanyId: ctx.company.id } });
  if (!p) throw new NotFoundError("Plan");
  return p;
}

export async function changePlan(ctx: Ctx, planId: string, i: Omit<PlanInput, "serviceTypeId">, now = new Date()) {
  await assertCustomer(ctx, "buyer.services.manage");
  const p = await myPlan(ctx, planId);
  const t = await prisma.serviceType.findUniqueOrThrow({ where: { id: p.serviceTypeId } });
  const sch = cleanSchedule(i);
  if (!allowedFrequency(t, sch.frequency)) throw new ValidationError("This service isn't offered on that schedule.");
  await prisma.$transaction(async (tx) => {
    await dropFutureScheduled(tx, p.id, now);
    await tx.servicePlan.update({
      where: { id: p.id }, data: {
        ...sch, containers: i.containers != null ? Math.max(0, Math.min(50, Math.round(i.containers))) : undefined, containerLitres: i.containerLitres != null ? Math.max(0, Math.min(5000, Math.round(i.containerLitres))) : undefined,
        autoRequestWhenFull: i.autoRequestWhenFull ?? undefined, notes: i.notes === undefined ? undefined : i.notes?.trim().slice(0, 500) || null, startsOn: today(now),
      },
    });
  });
  await planVisits(p.id, now);
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "services.plan_changed", entityType: "ServicePlan", entityId: p.id, before: { frequency: p.frequency, weekday: p.weekday, dayA: p.dayA, dayB: p.dayB }, after: sch });
  return prisma.servicePlan.findUniqueOrThrow({ where: { id: p.id } });
}

export async function setPlanStatus(ctx: Ctx, planId: string, status: "ACTIVE" | "PAUSED" | "CANCELLED", pausedUntil?: Date | null, now = new Date()) {
  await assertCustomer(ctx, "buyer.services.manage");
  const p = await myPlan(ctx, planId);
  if (p.status === "CANCELLED") throw new ValidationError("This plan has ended.");
  await prisma.$transaction(async (tx) => {
    if (status !== "ACTIVE") await dropFutureScheduled(tx, p.id, now);
    if (status === "CANCELLED") await tx.serviceVisit.updateMany({ where: { planId: p.id, status: { in: ["REQUESTED", "CONFIRMED"] }, date: { gte: today(now) } }, data: { status: "CANCELLED" } });
    await tx.servicePlan.update({ where: { id: p.id }, data: { status, pausedUntil: status === "PAUSED" ? pausedUntil ?? null : null } });
  });
  if (status === "ACTIVE") await planVisits(p.id, now);
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "services.plan_status", entityType: "ServicePlan", entityId: p.id, before: { status: p.status }, after: { status, pausedUntil } });
}

/**
 * A collection / visit requested now (by the customer, its Assistant, or by itself when the used-oil containers are
 * nearly full). Without a plan for this service an "only when requested" plan is made first.
 */
export async function requestVisit(ctx: Ctx | null, i: { companyId?: string; serviceTypeId: string; date?: Date | null; note?: string | null; reason: "CUSTOMER" | "CONTAINER_FULL" | "ASSISTANT" }, now = new Date()) {
  const s = ctx ? await assertCustomer(ctx, "buyer.services.log") : await servicesSettings();
  if (!s.parts.onRequest) throw new ValidationError("Requests are switched off.");
  const companyId = ctx ? ctx.company.id : i.companyId!;
  let plan = await prisma.servicePlan.findFirst({ where: { customerCompanyId: companyId, serviceTypeId: i.serviceTypeId, status: { in: ["ACTIVE", "PAUSED"] } } });
  if (!plan) {
    if (!ctx) throw new ValidationError("No plan for this service.");
    const t = await prisma.serviceType.findUnique({ where: { id: i.serviceTypeId } });
    if (!t || !allowedFrequency(t, "ON_REQUEST")) throw new ValidationError("This service can't be requested — take a plan first.");
    plan = await subscribe(ctx, { serviceTypeId: i.serviceTypeId, frequency: "ON_REQUEST", weekday: 1, dayA: 1, dayB: 15, timeWindow: "ANY" }, now);
  }
  const open = await prisma.serviceVisit.findFirst({ where: { planId: plan.id, origin: "REQUESTED", status: { in: ["REQUESTED", "SCHEDULED", "CONFIRMED"] } } });
  if (open) {
    if (!ctx) return open;
    throw new ValidationError(`A request is already open (${open.number}, ${isoDay(open.date)}).`);
  }
  const earliest = new Date(today(now).getTime() + s.requestLeadDays * DAY);
  const date = i.date && i.date > earliest ? today(i.date) : earliest;
  const v = await prisma.$transaction(async (tx) => tx.serviceVisit.create({
    data: { number: await nextNumber(tx, "service_visit", "SV"), planId: plan!.id, customerCompanyId: companyId, serviceTypeId: plan!.serviceTypeId, providerId: plan!.providerId, origin: "REQUESTED", status: "REQUESTED", date, timeWindow: plan!.timeWindow, requestReason: i.reason, requestedById: ctx?.user.id ?? null, requestNote: i.note?.trim().slice(0, 500) || null },
  }));
  const prov = plan.providerId ? await prisma.serviceProvider.findUnique({ where: { id: plan.providerId } }) : null;
  const t = await prisma.serviceType.findUniqueOrThrow({ where: { id: plan.serviceTypeId } });
  const co = await prisma.company.findUnique({ where: { id: companyId }, select: { legalName: true, tradeName: true } });
  const { notify } = await import("@/server/notify/dispatch");
  if (prov) await notify("service.request_new", [{ companyId: prov.companyId, link: "/vendor/services" }], { number: v.number, customer: nameOf(co), service: typeName(t), date: isoDay(date) }, { ref: { type: "ServiceVisit", id: v.id } }).catch(() => null);
  if (i.reason === "CONTAINER_FULL") await notify("service.container_full", [{ companyId, link: "/buy/services" }], { number: v.number, date: isoDay(date) }, { ref: { type: "ServiceVisit", id: v.id } }).catch(() => null);
  if (ctx) await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "services.requested", entityType: "ServiceVisit", entityId: v.id, after: { number: v.number, date: isoDay(date), reason: i.reason } });
  return prisma.serviceVisit.findUniqueOrThrow({ where: { id: v.id } });
}

async function visitFor(ctx: Ctx, id: string, side: "CUSTOMER" | "PROVIDER") {
  const v = await prisma.serviceVisit.findUnique({ where: { id }, include: { serviceType: true, provider: true } });
  if (!v) throw new NotFoundError("Visit");
  if (side === "CUSTOMER" && v.customerCompanyId !== ctx.company.id) throw new NotFoundError("Visit");
  if (side === "PROVIDER" && (!v.providerId || !(await myProviderIds(ctx)).includes(v.providerId))) throw new NotFoundError("Visit");
  return v;
}

export async function skipVisit(ctx: Ctx, id: string, now = new Date()) {
  await assertCustomer(ctx, "buyer.services.manage");
  const v = await visitFor(ctx, id, "CUSTOMER");
  if (!OPEN_VISIT.includes(v.status as never) || v.date < today(now)) throw new ValidationError("Only coming visits can be skipped.");
  await prisma.serviceVisit.update({ where: { id }, data: { status: v.origin === "REQUESTED" ? "CANCELLED" : "SKIPPED" } });
  if (v.provider) {
    const { notify } = await import("@/server/notify/dispatch");
    await notify("service.visit_changed", [{ companyId: v.provider.companyId, link: "/vendor/services" }], { number: v.number, date: isoDay(v.date), change: v.origin === "REQUESTED" ? "CANCELLED" : "SKIPPED" }).catch(() => null);
  }
}

/** Move a visit to another day (the customer, or the provider). */
export async function moveVisit(ctx: Ctx, id: string, date: Date, now = new Date()) {
  // the visit decides the side: a wholesaler can be a customer of one service and the provider of another
  const own = await prisma.serviceVisit.findUnique({ where: { id }, select: { customerCompanyId: true } });
  const side = own?.customerCompanyId === ctx.company.id ? "CUSTOMER" : "PROVIDER";
  if (side === "CUSTOMER") await assertCustomer(ctx, "buyer.services.log");
  const v = await visitFor(ctx, id, side);
  if (!OPEN_VISIT.includes(v.status as never)) throw new ValidationError("This visit is closed.");
  const d = today(date);
  if (d < today(now)) throw new ValidationError("Choose today or a later day.");
  if (v.planId && (await prisma.serviceVisit.findFirst({ where: { planId: v.planId, origin: v.origin, date: d, id: { not: v.id } } }))) throw new ValidationError("There is already a visit that day.");
  await prisma.serviceVisit.update({ where: { id }, data: { date: d, status: side === "PROVIDER" ? "CONFIRMED" : v.status === "CONFIRMED" ? "SCHEDULED" : v.status, remindedAt: null } });
  const { notify } = await import("@/server/notify/dispatch");
  const target = side === "PROVIDER" ? [{ companyId: v.customerCompanyId, link: "/buy/services" }] : v.provider ? [{ companyId: v.provider.companyId, link: "/vendor/services" }] : [];
  if (target.length) await notify("service.visit_changed", target, { number: v.number, date: isoDay(d), change: "MOVED" }).catch(() => null);
}

export async function myServices(ctx: Ctx, now = new Date(), locale = "en") {
  const ln = (t: { name: unknown; code: string }) => localName(t.name, t.code, locale);
  const s = await assertCustomer(ctx, "buyer.services.log");
  await ensureBuiltIns();
  const types = (await prisma.serviceType.findMany({ where: { active: true }, orderBy: [{ sort: "asc" }, { createdAt: "asc" }] })).filter((t) => !t.countries.length || t.countries.includes(ctx.company.countryCode));
  const providers = await prisma.serviceProvider.findMany({ where: { status: "APPROVED", serviceTypeId: { in: types.map((t) => t.id) } }, select: { serviceTypeId: true, countries: true } });
  const plans = await prisma.servicePlan.findMany({ where: { customerCompanyId: ctx.company.id, status: { not: "CANCELLED" } }, include: { serviceType: true, provider: true }, orderBy: { createdAt: "asc" } });
  const visits = await prisma.serviceVisit.findMany({
    where: { customerCompanyId: ctx.company.id, OR: [{ status: { in: OPEN_VISIT as string[] }, date: { gte: new Date(today(now).getTime() - 7 * DAY) } }, { status: { in: ["DONE", "MISSED", "SKIPPED", "CANCELLED"] }, date: { gte: new Date(now.getTime() - 120 * DAY) } }] },
    include: { serviceType: true }, orderBy: { date: "asc" }, take: 200,
  });
  const provCos = await prisma.company.findMany({ where: { id: { in: plans.map((p) => p.provider?.companyId).filter((x): x is string => !!x) } }, select: { id: true, legalName: true, tradeName: true } });
  const addresses = await prisma.address.findMany({ where: { companyId: ctx.company.id, isActive: true, kind: "DELIVERY" }, select: { id: true, label: true, line1: true, cityName: true } }).catch(() => []);
  // only what the customer may see: prices to the customer, never the provider's amount or FIRINGI's commission
  const visit = (v: (typeof visits)[number]) => ({
    id: v.id, number: v.number, planId: v.planId, serviceTypeId: v.serviceTypeId, service: ln(v.serviceType), unit: v.serviceType.unit, isCollection: v.serviceType.kind === "COLLECTION",
    origin: v.origin, status: v.status, date: v.date, timeWindow: v.timeWindow, requestReason: v.requestReason, requestNote: v.requestNote, quantity: v.quantity == null ? null : n(v.quantity),
    docNumber: v.docNumber, missedReason: v.missedReason, signedBy: v.signedBy, doneAt: v.doneAt, invoicedBy: v.invoicedBy, feeNet: v.feeNet == null ? null : n(v.feeNet), buybackNet: v.buybackNet == null ? null : n(v.buybackNet),
  });
  return {
    settings: { parts: s.parts, requestLeadDays: s.requestLeadDays },
    types: types.map((t) => {
      const pr = pricingOf(t);
      return {
        id: t.id, code: t.code, name: ln(t), description: String((t.description as Record<string, string> | null)?.en ?? ""), kind: t.kind, unit: t.unit, isOil: t.isOil, wasteCode: t.wasteCode, frequencies: t.frequencies,
        feeNet: pr.feeNet, pricePerUnit: pr.pricePerUnit, buybackPerUnit: s.parts.buyback ? pr.buybackPerUnit : 0, invoicedBy: pr.invoicedBy,
        available: providers.some((p) => p.serviceTypeId === t.id && (!p.countries.length || p.countries.includes(ctx.company.countryCode))), planId: plans.find((p) => p.serviceTypeId === t.id)?.id ?? null,
      };
    }),
    plans: plans.map((p) => {
      const next = visits.find((v) => v.planId === p.id && OPEN_VISIT.includes(v.status as never) && v.date >= today(now));
      return {
        id: p.id, number: p.number, serviceTypeId: p.serviceTypeId, service: ln(p.serviceType), isOil: p.serviceType.isOil, isCollection: p.serviceType.kind === "COLLECTION", frequencies: p.serviceType.frequencies,
        frequency: p.frequency as Frequency, weekday: p.weekday, dayA: p.dayA, dayB: p.dayB, timeWindow: p.timeWindow, status: p.status, pausedUntil: p.pausedUntil, addressId: p.addressId,
        containers: p.containers, containerLitres: p.containerLitres, autoRequestWhenFull: p.autoRequestWhenFull, notes: p.notes, providerName: nameOf(provCos.find((c) => c.id === p.provider?.companyId)),
        next: next ? { id: next.id, date: next.date, status: next.status } : null,
      };
    }),
    upcoming: visits.filter((v) => OPEN_VISIT.includes(v.status as never)).map(visit),
    history: visits.filter((v) => !OPEN_VISIT.includes(v.status as never)).reverse().map(visit),
    addresses: addresses.map((a) => ({ id: a.id, label: [a.label, a.line1, a.cityName].filter(Boolean).join(" · ") })),
  };
}

// ── provider ────────────────────────────────────────────────────────────────

export async function providerBoard(ctx: Ctx, now = new Date()) {
  const ids = await myProviderIds(ctx);
  const provs = await prisma.serviceProvider.findMany({ where: { companyId: ctx.company.id }, include: { serviceType: true } });
  const visits = await prisma.serviceVisit.findMany({
    where: { providerId: { in: ids }, OR: [{ status: { in: OPEN_VISIT as string[] }, date: { lte: new Date(today(now).getTime() + 31 * DAY) } }, { status: { in: ["DONE", "MISSED"] }, date: { gte: new Date(now.getTime() - 60 * DAY) } }] },
    include: { serviceType: true, plan: { select: { number: true, frequency: true, containers: true, containerLitres: true, addressId: true } } }, orderBy: { date: "asc" }, take: 300,
  });
  const plans = await prisma.servicePlan.findMany({ where: { providerId: { in: ids }, status: { in: ["ACTIVE", "PAUSED"] } }, include: { serviceType: true }, orderBy: { createdAt: "desc" } });
  const cos = await prisma.company.findMany({ where: { id: { in: [...new Set([...visits, ...plans].map((x) => x.customerCompanyId))] } }, select: { id: true, legalName: true, tradeName: true } });
  const addrIds = [...new Set(visits.map((v) => v.plan?.addressId).concat(plans.map((p) => p.addressId)).filter((x): x is string => !!x))];
  const addrs = await prisma.address.findMany({ where: { id: { in: addrIds } }, select: { id: true, line1: true, postalCode: true, cityName: true } }).catch(() => []);
  const who = (id: string) => nameOf(cos.find((c) => c.id === id));
  const where = (id: string | null | undefined) => { const a = addrs.find((x) => x.id === id); return a ? `${a.line1}, ${a.postalCode} ${a.cityName}` : null; };
  return {
    providers: provs.map((p) => ({ ...p, pricing: pricingOf(p.serviceType, p) })),
    requests: visits.filter((v) => v.status === "REQUESTED").map((v) => ({ ...v, customer: who(v.customerCompanyId), address: where(v.plan?.addressId) })),
    upcoming: visits.filter((v) => v.status === "SCHEDULED" || v.status === "CONFIRMED").map((v) => ({ ...v, customer: who(v.customerCompanyId), address: where(v.plan?.addressId) })),
    recent: visits.filter((v) => v.status === "DONE" || v.status === "MISSED").reverse().map((v) => ({ ...v, customer: who(v.customerCompanyId), address: where(v.plan?.addressId) })),
    plans: plans.map((p) => ({ ...p, customer: who(p.customerCompanyId), address: where(p.addressId) })),
  };
}

export async function confirmVisit(ctx: Ctx, id: string, date?: Date | null) {
  const v = await visitFor(ctx, id, "PROVIDER");
  if (!OPEN_VISIT.includes(v.status as never)) throw new ValidationError("This visit is closed.");
  const d = date ? today(date) : v.date;
  await prisma.serviceVisit.update({ where: { id }, data: { status: "CONFIRMED", date: d } });
  const { notify } = await import("@/server/notify/dispatch");
  await notify("service.visit_confirmed", [{ companyId: v.customerCompanyId, link: "/buy/services" }], { number: v.number, date: isoDay(d) }, { ref: { type: "ServiceVisit", id } }).catch(() => null);
}

export type DoneInput = { quantity?: number | null; containersTaken?: number | null; containersLeft?: number | null; signedBy?: string | null; docNumber?: string | null; providerInvoiceNo?: string | null; note?: string | null };
/** The provider records the visit: quantity, containers, signature, waste document; FIRINGI's invoice / the commission follow. */
export async function completeVisit(ctx: Ctx, id: string, i: DoneInput, now = new Date()) {
  const v = await visitFor(ctx, id, "PROVIDER");
  if (!OPEN_VISIT.includes(v.status as never)) throw new ValidationError("This visit is closed.");
  if (v.date.getTime() > today(now).getTime() + DAY) throw new ValidationError("This visit is in the future — move it to today first.");
  const s = await servicesSettings();
  const t = v.serviceType;
  const qty = t.kind === "COLLECTION" ? Number(i.quantity ?? NaN) : 1;
  if (t.kind === "COLLECTION" && !(qty >= 0 && qty < 100000)) throw new ValidationError(`Enter how much was collected (${t.unit}).`);
  if (t.needsDocument && s.parts.documents && !i.signedBy?.trim()) throw new ValidationError("Write who signed for it at the customer.");
  const pricing = pricingOf(t, v.provider);
  const by: InvoicedBy = v.provider && (await prisma.company.findUnique({ where: { id: v.provider.companyId }, select: { type: true } }))?.type === "ADMIN" ? "FIRINGI" : pricing.invoicedBy;
  if (by === "PROVIDER" && !i.providerInvoiceNo?.trim() && pricing.feeNet + pricing.pricePerUnit > 0) throw new ValidationError("You invoice this customer yourself — enter your invoice number.");
  const m = visitMoney(pricing, qty, by);
  const buyback = s.parts.buyback ? m.buyback : 0;
  await prisma.$transaction(async (tx) => {
    let invoiceId: string | null = null;
    if (by === "FIRINGI" && s.parts.invoicing && m.fee > 0) {
      const { issueServiceInvoice } = await import("@/server/invoicing/service");
      const inv = await issueServiceInvoice(tx, { recipientCompanyId: v.customerCompanyId, docType: "INVOICE", dueDays: 15, actorUserId: ctx.user.id, lines: [{ description: `${typeName(t)} — ${v.number} (${isoDay(v.date)})${t.kind === "COLLECTION" ? ` · ${qty} ${t.unit}` : ""}`, net: new Decimal(m.fee) }] });
      invoiceId = inv.id;
    }
    await tx.serviceVisit.update({
      where: { id }, data: {
        status: "DONE", quantity: t.kind === "COLLECTION" ? qty : null, containersTaken: i.containersTaken ?? null, containersLeft: i.containersLeft ?? null,
        signedBy: i.signedBy?.trim().slice(0, 120) || null, docNumber: i.docNumber?.trim().slice(0, 60) || null, providerInvoiceNo: i.providerInvoiceNo?.trim().slice(0, 60) || null, providerNote: i.note?.trim().slice(0, 1000) || null,
        doneAt: now, doneById: ctx.user.id, invoicedBy: by, feeNet: m.fee, buybackNet: buyback, providerAmount: m.provider, commissionNet: m.commission, invoiceId,
      },
    });
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "services.visit_done", entityType: "ServiceVisit", entityId: id, after: { number: v.number, qty, by, fee: m.fee, buyback, provider: m.provider, commission: m.commission } });
  const { notify } = await import("@/server/notify/dispatch");
  await notify("service.visit_done", [{ companyId: v.customerCompanyId, link: "/buy/services" }], { number: v.number, service: typeName(t), qty: t.kind === "COLLECTION" ? `${qty} ${t.unit}` : "—" }, { ref: { type: "ServiceVisit", id } }).catch(() => null);
  return prisma.serviceVisit.findUniqueOrThrow({ where: { id } });
}

export async function missVisit(ctx: Ctx, id: string, reason: string) {
  const v = await visitFor(ctx, id, "PROVIDER");
  if (!OPEN_VISIT.includes(v.status as never)) throw new ValidationError("This visit is closed.");
  if (!reason.trim()) throw new ValidationError("Say why it couldn't be done.");
  await prisma.serviceVisit.update({ where: { id }, data: { status: "MISSED", missedReason: reason.trim().slice(0, 300) } });
  const { notify } = await import("@/server/notify/dispatch");
  await notify("service.visit_missed", [{ companyId: v.customerCompanyId, link: "/buy/services" }], { number: v.number, reason: reason.trim().slice(0, 200) }, { ref: { type: "ServiceVisit", id } }).catch(() => null);
}

// ── FIRINGI ─────────────────────────────────────────────────────────────────

function assertStaff(ctx: Ctx, manage = false) {
  if (!isStaff(ctx) || !can(ctx, manage ? ["admin.services.manage"] : ["admin.services.view", "admin.services.manage"])) throw new ForbiddenError();
}

export async function adminOverview(ctx: Ctx, now = new Date()) {
  assertStaff(ctx);
  const since30 = new Date(now.getTime() - 30 * DAY);
  const [plans, open, requested, missed30, done30, money] = await Promise.all([
    prisma.servicePlan.count({ where: { status: "ACTIVE" } }),
    prisma.serviceVisit.count({ where: { status: { in: ["SCHEDULED", "CONFIRMED"] }, date: { lte: new Date(today(now).getTime() + 7 * DAY) } } }),
    prisma.serviceVisit.count({ where: { status: "REQUESTED" } }),
    prisma.serviceVisit.count({ where: { status: "MISSED", date: { gte: since30 } } }),
    prisma.serviceVisit.findMany({ where: { status: "DONE", doneAt: { gte: since30 } }, select: { quantity: true, feeNet: true, commissionNet: true, invoicedBy: true, serviceType: { select: { isOil: true, unit: true } } } }),
    moneyOpen(),
  ]);
  const litres = done30.filter((v) => v.serviceType.isOil).reduce((a, v) => a + n(v.quantity), 0);
  return {
    plans, open, requested, missed30, done30: done30.length, oilLitres30: Math.round(litres), revenue30: Math.round(done30.filter((v) => v.invoicedBy === "FIRINGI").reduce((a, v) => a + n(v.feeNet), 0) * 100) / 100,
    commission30: Math.round(done30.reduce((a, v) => a + n(v.commissionNet), 0) * 100) / 100, money,
  };
}

/** What FIRINGI still owes (oil to customers, providers' amounts) and commission not yet invoiced. */
export async function moneyOpen() {
  const rows = await prisma.serviceVisit.findMany({
    where: { status: "DONE", OR: [{ invoicedBy: "FIRINGI", buybackNet: { gt: 0 }, buybackPaidAt: null }, { invoicedBy: "FIRINGI", providerAmount: { gt: 0 }, providerPaidAt: null }, { invoicedBy: "PROVIDER", commissionNet: { gt: 0 }, commissionInvoiceId: null }] },
    select: { id: true, number: true, customerCompanyId: true, providerId: true, invoicedBy: true, buybackNet: true, buybackPaidAt: true, providerAmount: true, providerPaidAt: true, commissionNet: true, commissionInvoiceId: true, doneAt: true, quantity: true, serviceType: { select: { code: true, name: true, unit: true } } },
    orderBy: { doneAt: "asc" }, take: 500,
  });
  const provs = await prisma.serviceProvider.findMany({ where: { id: { in: rows.map((r) => r.providerId).filter((x): x is string => !!x) } }, select: { id: true, companyId: true } });
  const cos = await prisma.company.findMany({ where: { id: { in: [...rows.map((r) => r.customerCompanyId), ...provs.map((p) => p.companyId)] } }, select: { id: true, legalName: true, tradeName: true } });
  const nm = (id: string | undefined) => nameOf(cos.find((c) => c.id === id));
  const list = rows.map((r) => ({ ...r, customer: nm(r.customerCompanyId), provider: nm(provs.find((p) => p.id === r.providerId)?.companyId), service: typeName(r.serviceType) }));
  const sum = (f: (r: (typeof list)[number]) => number) => Math.round(list.reduce((a, r) => a + f(r), 0) * 100) / 100;
  return {
    rows: list,
    buyback: sum((r) => (r.invoicedBy === "FIRINGI" && !r.buybackPaidAt ? n(r.buybackNet) : 0)),
    provider: sum((r) => (r.invoicedBy === "FIRINGI" && !r.providerPaidAt ? n(r.providerAmount) : 0)),
    commission: sum((r) => (r.invoicedBy === "PROVIDER" && !r.commissionInvoiceId ? n(r.commissionNet) : 0)),
  };
}

export async function markPaid(ctx: Ctx, ids: string[], what: "BUYBACK" | "PROVIDER", now = new Date()) {
  assertStaff(ctx, true);
  if (!can(ctx, ["admin.finance.manage"])) throw new ForbiddenError("Recording payments needs the Finance right.");
  const r = await prisma.serviceVisit.updateMany({ where: { id: { in: ids }, status: "DONE", invoicedBy: "FIRINGI", ...(what === "BUYBACK" ? { buybackPaidAt: null } : { providerPaidAt: null }) }, data: what === "BUYBACK" ? { buybackPaidAt: now } : { providerPaidAt: now } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "services.paid", entityType: "ServiceVisit", entityId: ids[0] ?? "-", after: { what, ids, count: r.count } });
  return r.count;
}

/**
 * FIRINGI's commission on visits the provider invoiced: one invoice per provider for the visits done before
 * `before` (the job: before this month; "now" from the Money tab).
 */
export async function invoiceCommissions(actorUserId: string | null, before: Date) {
  const rows = await prisma.serviceVisit.findMany({ where: { status: "DONE", invoicedBy: "PROVIDER", commissionNet: { gt: 0 }, commissionInvoiceId: null, doneAt: { lt: before } }, include: { serviceType: true, provider: true } });
  const byCo = new Map<string, typeof rows>();
  for (const r of rows) if (r.provider) byCo.set(r.provider.companyId, [...(byCo.get(r.provider.companyId) ?? []), r]);
  let invoices = 0;
  const { issueServiceInvoice } = await import("@/server/invoicing/service");
  for (const [companyId, vs] of byCo) {
    const byType = new Map<string, typeof vs>();
    for (const v of vs) byType.set(v.serviceTypeId, [...(byType.get(v.serviceTypeId) ?? []), v]);
    await prisma.$transaction(async (tx) => {
      const inv = await issueServiceInvoice(tx, {
        recipientCompanyId: companyId, docType: "INVOICE", dueDays: 15, actorUserId,
        lines: [...byType.values()].map((g) => ({ description: `Comissão FIRINGI — ${typeName(g[0].serviceType)}: ${g.length} serviço(s) (${g.map((x) => x.number).slice(0, 6).join(", ")}${g.length > 6 ? "…" : ""})`, net: g.reduce((a, x) => a.plus(x.commissionNet.toString()), new Decimal(0)) })),
      });
      await tx.serviceVisit.updateMany({ where: { id: { in: vs.map((v) => v.id) } }, data: { commissionInvoiceId: inv.id } });
    });
    invoices++;
  }
  return invoices;
}

export async function adminVisits(ctx: Ctx, f: { status?: string | null; serviceTypeId?: string | null; page?: number }) {
  assertStaff(ctx);
  const size = 50, page = Math.max(1, f.page ?? 1);
  const where = { ...(f.status ? { status: f.status } : {}), ...(f.serviceTypeId ? { serviceTypeId: f.serviceTypeId } : {}) };
  const [rows, total] = await Promise.all([
    prisma.serviceVisit.findMany({ where, include: { serviceType: true, provider: true }, orderBy: { date: "desc" }, skip: (page - 1) * size, take: size }),
    prisma.serviceVisit.count({ where }),
  ]);
  const cos = await prisma.company.findMany({ where: { id: { in: [...rows.map((r) => r.customerCompanyId), ...rows.map((r) => r.provider?.companyId).filter((x): x is string => !!x)] } }, select: { id: true, legalName: true, tradeName: true } });
  return { rows: rows.map((r) => ({ ...r, customer: nameOf(cos.find((c) => c.id === r.customerCompanyId)), providerName: nameOf(cos.find((c) => c.id === r.provider?.companyId)) })), total, page, pages: Math.max(1, Math.ceil(total / size)) };
}

export async function adminPlans(ctx: Ctx) {
  assertStaff(ctx);
  const rows = await prisma.servicePlan.findMany({ where: { status: { not: "CANCELLED" } }, include: { serviceType: true, provider: true, _count: { select: { visits: { where: { status: "DONE" } } } } }, orderBy: { createdAt: "desc" }, take: 300 });
  const cos = await prisma.company.findMany({ where: { id: { in: [...rows.map((r) => r.customerCompanyId), ...rows.map((r) => r.provider?.companyId).filter((x): x is string => !!x)] } }, select: { id: true, legalName: true, tradeName: true } });
  return rows.map((r) => ({ ...r, customer: nameOf(cos.find((c) => c.id === r.customerCompanyId)), providerName: nameOf(cos.find((c) => c.id === r.provider?.companyId)) }));
}

/** FIRINGI moves a plan to another approved provider (future visits follow). */
export async function reassignPlan(ctx: Ctx, planId: string, providerId: string) {
  assertStaff(ctx, true);
  const [p, prov] = await Promise.all([prisma.servicePlan.findUnique({ where: { id: planId } }), prisma.serviceProvider.findUnique({ where: { id: providerId } })]);
  if (!p || !prov || prov.serviceTypeId !== p.serviceTypeId || prov.status !== "APPROVED") throw new ValidationError("Choose an approved provider of this service.");
  await prisma.$transaction([
    prisma.servicePlan.update({ where: { id: planId }, data: { providerId } }),
    prisma.serviceVisit.updateMany({ where: { planId, status: { in: OPEN_VISIT as string[] } }, data: { providerId } }),
  ]);
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "services.plan_reassigned", entityType: "ServicePlan", entityId: planId, before: { providerId: p.providerId }, after: { providerId } });
}

/** The visit document (collection note / service certificate) — the customer, the provider or FIRINGI. */
export async function visitDocument(ctx: Ctx, id: string) {
  const v = await prisma.serviceVisit.findUnique({ where: { id }, include: { serviceType: true, provider: true, plan: { select: { addressId: true } } } });
  if (!v || v.status !== "DONE") throw new NotFoundError("Document");
  const mine = v.customerCompanyId === ctx.company.id || v.provider?.companyId === ctx.company.id || (isStaff(ctx) && can(ctx, ["admin.services.view", "admin.services.manage"]));
  if (!mine) throw new NotFoundError("Document");
  const [cust, prov, addr] = await Promise.all([
    prisma.company.findUnique({ where: { id: v.customerCompanyId }, select: { legalName: true, tradeName: true, taxId: true, vatNumber: true } }),
    v.provider ? prisma.company.findUnique({ where: { id: v.provider.companyId }, select: { legalName: true, tradeName: true, taxId: true, vatNumber: true } }) : null,
    v.plan?.addressId ? prisma.address.findUnique({ where: { id: v.plan.addressId }, select: { line1: true, postalCode: true, cityName: true } }) : null,
  ]);
  return {
    number: v.number, service: [...new Set([localName(v.serviceType.name, v.serviceType.code, "pt-PT"), typeName(v.serviceType)])].join(" / "), isCollection: v.serviceType.kind === "COLLECTION", unit: v.serviceType.unit, wasteCode: v.serviceType.wasteCode, date: v.date, doneAt: v.doneAt,
    quantity: v.quantity == null ? null : n(v.quantity), containersTaken: v.containersTaken, containersLeft: v.containersLeft, docNumber: v.docNumber, signedBy: v.signedBy, note: v.providerNote,
    customer: { name: nameOf(cust), taxId: cust?.vatNumber ?? cust?.taxId ?? null, address: addr ? `${addr.line1}, ${addr.postalCode} ${addr.cityName}` : "—" },
    provider: { name: nameOf(prov), taxId: prov?.vatNumber ?? prov?.taxId ?? null, licence: v.provider?.licenceNumber ?? null, licenceExpires: v.provider?.licenceExpiresAt ?? null },
    invoicedBy: v.invoicedBy as InvoicedBy, providerInvoiceNo: v.providerInvoiceNo,
  };
}

export type { Prisma };
