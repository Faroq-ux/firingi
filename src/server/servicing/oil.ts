import "server-only";
/**
 * Fryers & used cooking oil (Phase 68). The kitchen keeps a log per fryer — topped up, oil changed (the old oil goes
 * to the used-oil containers), tested (polar compounds %), filtered. FIRINGI shows when each fryer's oil is due
 * (days or the polar limit), the used oil waiting and how full the containers are, litres and cost per fryer, oil
 * collected and paid for — and asks the collector by itself when the containers are nearly full (if the customer
 * wants that).
 */
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { OIL_LOG_KINDS, fryerStatus, storage, type OilLogKind, type OilRules } from "@/lib/services";
import { customerOn, servicesSettings } from "./settings";

const DAY = 86400_000;
const n = (v: { toString(): string } | null | undefined) => (v == null ? 0 : Number(v.toString()));

async function assertOil(ctx: Ctx, manage: boolean) {
  if (!(ctx.company.type === "CUSTOMER" || ctx.company.type === "WHOLESALER")) throw new ForbiddenError();
  if (!can(ctx, manage ? "buyer.services.manage" : ["buyer.services.log", "buyer.services.manage"])) throw new ForbiddenError();
  const s = await servicesSettings();
  if (!customerOn(s, ctx.company) || !s.parts.oil) throw new AppError("FEATURE_OFF", "FIRINGI hasn't switched fryers & oil on for your company.", 403);
  return s;
}

export async function saveFryer(ctx: Ctx, id: string | null, i: { name: string; capacityL: number; oilName?: string | null; oilCostPerL?: number | null; active?: boolean }) {
  await assertOil(ctx, true);
  if (!i.name.trim()) throw new ValidationError("Name the fryer.");
  if (!(i.capacityL > 0 && i.capacityL <= 500)) throw new ValidationError("Capacity: 1 to 500 litres.");
  if (i.oilCostPerL != null && !(i.oilCostPerL >= 0 && i.oilCostPerL < 100)) throw new ValidationError("Oil price per litre: 0 to 100.");
  const data = { name: i.name.trim().slice(0, 60), capacityL: i.capacityL, oilName: i.oilName?.trim().slice(0, 80) || null, oilCostPerL: i.oilCostPerL ?? null, active: i.active ?? true };
  if (id) {
    const f = await prisma.fryer.findFirst({ where: { id, companyId: ctx.company.id } });
    if (!f) throw new NotFoundError("Fryer");
    return prisma.fryer.update({ where: { id }, data });
  }
  return prisma.fryer.create({ data: { ...data, companyId: ctx.company.id } });
}

export async function logFryer(ctx: Ctx, fryerId: string, i: { kind: string; litres?: number | null; polarPct?: number | null; note?: string | null }, now = new Date()) {
  await assertOil(ctx, false);
  const f = await prisma.fryer.findFirst({ where: { id: fryerId, companyId: ctx.company.id, active: true } });
  if (!f) throw new NotFoundError("Fryer");
  if (!(OIL_LOG_KINDS as readonly string[]).includes(i.kind)) throw new ValidationError("Choose what was done.");
  const kind = i.kind as OilLogKind;
  const litres = i.litres == null || Number.isNaN(i.litres) ? null : i.litres;
  if ((kind === "TOP_UP" || kind === "CHANGE") && !(litres != null && litres > 0 && litres <= 500)) throw new ValidationError("Enter the litres.");
  if (kind === "TEST" && !(i.polarPct != null && i.polarPct >= 0 && i.polarPct <= 60)) throw new ValidationError("Enter the tester reading (0–60 %).");
  await prisma.$transaction([
    prisma.fryerLog.create({ data: { fryerId, companyId: ctx.company.id, kind, litres: kind === "TEST" || kind === "FILTER" ? null : litres, polarPct: kind === "TEST" ? i.polarPct : null, note: i.note?.trim().slice(0, 300) || null, at: now, byUserId: ctx.user.id } }),
    prisma.fryer.update({ where: { id: fryerId }, data: kind === "CHANGE" ? { lastChangeAt: now, lastPolarPct: null, alertedAt: null } : kind === "TEST" ? { lastPolarPct: i.polarPct } : {} }),
  ]);
  // a change fills the containers: ask for a collection when they are nearly full (if wanted)
  if (kind === "CHANGE") await autoRequestIfFull(ctx.company.id, now).catch(() => null);
}

export async function deleteLog(ctx: Ctx, id: string) {
  await assertOil(ctx, false);
  const l = await prisma.fryerLog.findFirst({ where: { id, companyId: ctx.company.id } });
  if (!l) throw new NotFoundError("Entry");
  if (l.byUserId !== ctx.user.id && !can(ctx, "buyer.services.manage")) throw new ForbiddenError("Only a manager can take back someone else's entry.");
  if (Date.now() - l.at.getTime() > DAY && !can(ctx, "buyer.services.manage")) throw new ValidationError("Entries can be taken back the same day.");
  await prisma.fryerLog.delete({ where: { id } });
  const last = await prisma.fryerLog.findFirst({ where: { fryerId: l.fryerId, kind: "CHANGE" }, orderBy: { at: "desc" } });
  const test = await prisma.fryerLog.findFirst({ where: { fryerId: l.fryerId, kind: "TEST", ...(last ? { at: { gt: last.at } } : {}) }, orderBy: { at: "desc" } });
  await prisma.fryer.update({ where: { id: l.fryerId }, data: { lastChangeAt: last?.at ?? null, lastPolarPct: test?.polarPct ?? null } });
}

/** The oil plan (collection service) of a company, its last collection and the used oil since then. */
export async function usedOil(companyId: string, fullPct: number) {
  const plan = await prisma.servicePlan.findFirst({ where: { customerCompanyId: companyId, status: { in: ["ACTIVE", "PAUSED"] }, serviceType: { isOil: true } }, include: { serviceType: true } });
  const last = await prisma.serviceVisit.findFirst({ where: { customerCompanyId: companyId, status: "DONE", serviceType: { isOil: true } }, orderBy: { doneAt: "desc" } });
  const since = last?.doneAt ?? new Date(0);
  const changed = await prisma.fryerLog.aggregate({ where: { companyId, kind: "CHANGE", at: { gt: since } }, _sum: { litres: true } });
  const capacity = plan && plan.containerLitres > 0 ? plan.containers * plan.containerLitres : null;
  return { plan, lastCollection: last, ...storage(n(changed._sum.litres), capacity, fullPct) };
}

/** Ask for a collection by itself when the containers are nearly full (once per open request). */
export async function autoRequestIfFull(companyId: string, now = new Date()) {
  const s = await servicesSettings();
  if (!s.parts.oil || !s.parts.onRequest) return null;
  const co = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true, type: true } });
  if (!co || !customerOn(s, co)) return null;
  const u = await usedOil(companyId, s.oil.fullPct);
  if (!u.plan || !u.full || !u.plan.autoRequestWhenFull || u.plan.status !== "ACTIVE") return null;
  // a visit in the next 2 days will empty them anyway
  const soon = await prisma.serviceVisit.findFirst({ where: { planId: u.plan.id, status: { in: ["REQUESTED", "SCHEDULED", "CONFIRMED"] }, date: { lte: new Date(now.getTime() + 2 * DAY) } } });
  if (soon) return null;
  const { requestVisit } = await import("./plans");
  return requestVisit(null, { companyId, serviceTypeId: u.plan.serviceTypeId, reason: "CONTAINER_FULL" }, now);
}

export type OilInsight = { code: "CHANGE_NOW" | "CHANGE_SOON" | "FULL" | "NO_TEST" | "OFTEN" | "LESS_OFTEN" | "MORE_OFTEN"; fryer?: string; n?: number };

/** Everything on the Fryers & Oil page. */
export async function oilSummary(ctx: Ctx, now = new Date()) {
  const s = await assertOil(ctx, false);
  return oilFor(ctx.company.id, s.oil, now);
}
export async function oilFor(companyId: string, rules: OilRules, now = new Date()) {
  const since30 = new Date(now.getTime() - 30 * DAY), since90 = new Date(now.getTime() - 90 * DAY);
  const fryers = await prisma.fryer.findMany({ where: { companyId }, orderBy: [{ active: "desc" }, { name: "asc" }] });
  const logs = await prisma.fryerLog.findMany({ where: { companyId, at: { gte: since30 } }, orderBy: { at: "desc" } });
  const s = await servicesSettings();
  const u = await usedOil(companyId, rules.fullPct);
  const collected = await prisma.serviceVisit.findMany({ where: { customerCompanyId: companyId, status: "DONE", serviceType: { isOil: true }, doneAt: { gte: since90 } }, select: { quantity: true, buybackNet: true, doneAt: true, invoicedBy: true } });
  const rows = fryers.map((f) => {
    const st = fryerStatus({ lastChangeAt: f.lastChangeAt, lastPolarPct: f.lastPolarPct == null ? null : n(f.lastPolarPct) }, rules, now);
    const mine = logs.filter((l) => l.fryerId === f.id);
    const litres = mine.filter((l) => l.kind === "TOP_UP" || l.kind === "CHANGE").reduce((a, l) => a + n(l.litres), 0);
    const changes = mine.filter((l) => l.kind === "CHANGE").length;
    const lastTest = mine.find((l) => l.kind === "TEST")?.at ?? null;
    return { ...f, capacityL: n(f.capacityL), oilCostPerL: f.oilCostPerL == null ? null : n(f.oilCostPerL), lastPolarPct: f.lastPolarPct == null ? null : n(f.lastPolarPct), ...st, litres30: Math.round(litres * 10) / 10, changes30: changes, cost30: f.oilCostPerL == null ? null : Math.round(litres * n(f.oilCostPerL) * 100) / 100, lastTest };
  });
  const insights: OilInsight[] = [];
  for (const f of rows.filter((x) => x.active)) {
    if (f.status === "CHANGE") insights.push({ code: "CHANGE_NOW", fryer: f.name, n: f.days ?? undefined });
    else if (f.status === "SOON") insights.push({ code: "CHANGE_SOON", fryer: f.name });
    if (!f.lastTest || now.getTime() - f.lastTest.getTime() > 14 * DAY) insights.push({ code: "NO_TEST", fryer: f.name });
    // more than twice the change interval suggests (e.g. every 7 days → more than 9 changes in 30 days)
    if (f.changes30 > Math.ceil((30 / rules.changeDays) * 2)) insights.push({ code: "OFTEN", fryer: f.name, n: f.changes30 });
  }
  if (u.full) insights.push({ code: "FULL", n: u.pct ?? undefined });
  // the collections: containers mostly empty → less often; overflowing → more often
  const lastFew = collected.slice(-4);
  if (u.plan && u.capacity && lastFew.length >= 3 && u.plan.frequency !== "ON_REQUEST") {
    const avg = lastFew.reduce((a, v) => a + n(v.quantity), 0) / lastFew.length / u.capacity;
    if (avg < 0.3) insights.push({ code: "LESS_OFTEN", n: Math.round(avg * 100) });
    else if (avg > 0.95) insights.push({ code: "MORE_OFTEN", n: Math.round(avg * 100) });
  }
  return {
    rules, fryers: rows, logs: logs.slice(0, 60), storage: u, insights,
    totals: {
      fresh30: Math.round(rows.reduce((a, f) => a + f.litres30, 0) * 10) / 10, cost30: Math.round(rows.reduce((a, f) => a + (f.cost30 ?? 0), 0) * 100) / 100,
      changed30: Math.round(logs.filter((l) => l.kind === "CHANGE").reduce((a, l) => a + n(l.litres), 0) * 10) / 10,
      collected90: Math.round(collected.reduce((a, v) => a + n(v.quantity), 0) * 10) / 10, paid90: Math.round(collected.reduce((a, v) => a + n(v.buybackNet), 0) * 100) / 100,
      // CO₂ avoided when used cooking oil becomes biodiesel (≈ 2.5 kg CO₂e per litre, conservative)
      co2Saved90: Math.round(collected.reduce((a, v) => a + n(v.quantity), 0) * 2.5),
    },
    buybackOn: s.parts.buyback,
  };
}

/** Daily: "change the oil" to the kitchen once a day per fryer that is due. */
export async function oilChangeAlerts(now = new Date()) {
  const s = await servicesSettings();
  if (!s.enabled || !s.parts.oil) return 0;
  const fryers = await prisma.fryer.findMany({ where: { active: true, OR: [{ alertedAt: null }, { alertedAt: { lt: new Date(now.getTime() - 20 * 3600_000) } }] } });
  let sent = 0;
  const { notify } = await import("@/server/notify/dispatch");
  for (const f of fryers) {
    const st = fryerStatus({ lastChangeAt: f.lastChangeAt, lastPolarPct: f.lastPolarPct == null ? null : n(f.lastPolarPct) }, s.oil, now);
    if (st.status !== "CHANGE" || !f.lastChangeAt) continue;
    await notify("service.oil_change_due", [{ companyId: f.companyId, link: "/buy/services/oil" }], { fryer: f.name, days: String(st.days ?? "—") }).catch(() => null);
    await prisma.fryer.update({ where: { id: f.id }, data: { alertedAt: now } });
    sent++;
  }
  return sent;
}
