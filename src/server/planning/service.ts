/**
 * Demand planning (Phase 30): the nightly run (forecasts stored, actuals filled, restock
 * suggestions kept up to date), the supplier's decisions (order → draft purchase orders, dismiss,
 * planning choices, events, overstock / expiry actions) and FIRINGI's views across suppliers.
 * The system suggests; people decide. Maths: ./model.ts, data: ./engine.ts.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";
import { notify } from "@/server/notify/dispatch";
import { requireInventory, VIEW } from "@/server/inventory/service";
import { accuracy, addDays, cleanHistory, eventFactor, fit, isoDay, mondayOf, startOfDay, weekdayProfile } from "./model";
import {
  computeCompanyPlan, DEFAULTS, planningDefaults, plannedCompanies, riskRows, SETTINGS_KEY, sourceLeadTimes, weekdayUnits,
  type CompanyPlan, type PlanningDefaults, type PlanRow,
} from "./engine";

const ORDER = "vendor.purchasing.manage" as const;
const MANAGE = "vendor.inventory.manage" as const;

export const canAdminPlanning = (ctx: Ctx) => ctx.company.type === "ADMIN" && can(ctx, ["admin.inventory.view", "admin.inventory.manage"]);
export const canAdminManagePlanning = (ctx: Ctx) => ctx.company.type === "ADMIN" && can(ctx, "admin.inventory.manage");
export function requireAdminView(ctx: Ctx) { if (!canAdminPlanning(ctx)) throw new ForbiddenError(); }
export function requireAdminManage(ctx: Ctx) { if (!canAdminManagePlanning(ctx)) throw new ForbiddenError(); }

// ── nightly run ────────────────────────────────────────────────────────────

/** Store next weeks' forecasts (a started week is frozen), fill finished weeks' actuals, back-test new series. */
async function storeForecasts(cp: CompanyPlan) {
  const { thisMonday } = cp;
  const rows = cp.rows.filter((r) => r.fit.weeksOfHistory > 0 || r.onHand > 0);
  await prisma.demandForecast.deleteMany({ where: { companyId: cp.companyId, weekStart: { gt: thisMonday }, backtest: false } });
  const mk = (r: PlanRow, i: number) => ({ companyId: cp.companyId, offerId: r.offerId, addressId: r.addressId, weekStart: r.futureMondays[i], qty: r.forecast[i], low: Math.min(r.low[i], r.forecast[i]), high: Math.max(r.high[i], r.forecast[i]), method: r.fit.method });
  await prisma.demandForecast.createMany({ data: rows.map((r) => mk(r, 0)), skipDuplicates: true });
  await prisma.demandForecast.createMany({ data: rows.flatMap((r) => r.futureMondays.slice(1).map((_, j) => mk(r, j + 1))), skipDuplicates: true });

  // actuals of finished weeks
  const open = await prisma.demandForecast.findMany({ where: { companyId: cp.companyId, weekStart: { lt: thisMonday }, actual: null }, select: { id: true, offerId: true, addressId: true, weekStart: true } });
  const byKey = new Map(cp.rows.map((r) => [r.key, r]));
  for (const f of open) {
    const r = byKey.get(`${f.offerId}|${f.addressId}`);
    const idx = r ? r.mondays.findIndex((m) => m.getTime() === f.weekStart.getTime()) : -1;
    await prisma.demandForecast.update({ where: { id: f.id }, data: { actual: r && idx >= 0 ? r.history[idx] : 0 } });
  }

  // back-test series that have no past forecasts yet (made only from the data before each week)
  const past = await prisma.demandForecast.groupBy({ by: ["offerId", "addressId"], where: { companyId: cp.companyId, weekStart: { lt: thisMonday } }, _count: true });
  const has = new Set(past.map((p) => `${p.offerId}|${p.addressId}`));
  const data: Prisma.DemandForecastCreateManyInput[] = [];
  for (const r of rows) {
    if (has.has(r.key) || r.fit.weeksOfHistory < 6) continue;
    const clean = cleanHistory(r.history, r.mondays, r.events);
    const n = r.history.length;
    for (let idx = n - Math.min(8, r.fit.weeksOfHistory - 4); idx < n; idx++) {
      const f = fit(clean.slice(0, idx), 1);
      const k = eventFactor(r.events, r.mondays[idx]);
      const qty = Math.round(f.forecast[0] * k * 100) / 100;
      data.push({ companyId: cp.companyId, offerId: r.offerId, addressId: r.addressId, weekStart: r.mondays[idx], qty, low: Math.min(qty, Math.round(f.low[0] * k * 100) / 100), high: Math.max(qty, Math.round(f.high[0] * k * 100) / 100), method: f.method, actual: r.history[idx], backtest: true, madeAt: r.mondays[idx] });
    }
  }
  if (data.length) await prisma.demandForecast.createMany({ data, skipDuplicates: true });
  return rows.length;
}

/** Keep one open suggestion per product × warehouse in line with the plan; returns what changed. */
async function syncSuggestions(cp: CompanyPlan, today: Date) {
  const [open, snoozed] = await Promise.all([
    prisma.restockSuggestion.findMany({ where: { companyId: cp.companyId, status: "OPEN" } }),
    prisma.restockSuggestion.findMany({ where: { companyId: cp.companyId, status: "DISMISSED", snoozeUntil: { gt: today } }, select: { offerId: true, addressId: true } }),
  ]);
  const quiet = new Set(snoozed.map((s) => `${s.offerId}|${s.addressId}`));
  const created: PlanRow[] = [];
  let updated = 0;
  const keep = new Set<string>();
  for (const r of cp.rows) {
    const p = r.plan;
    if (!p.urgency || p.qty <= 0) continue;
    const data = {
      urgency: p.urgency, qty: p.qty, usable: r.usable, incoming: r.incoming, reorderPoint: p.reorderPoint, orderUpTo: p.orderUpTo, safetyStock: p.safetyStock,
      leadTimeDays: r.leadTimeDays, dailyDemand: p.dailyDemand,
      runsOutOn: p.runsOutInDays === null ? null : addDays(today, p.runsOutInDays), orderBy: p.orderInDays === null ? null : addDays(today, p.orderInDays),
      supplierId: r.source?.kind === "OUTSIDE" ? r.source.id : null, sellerCompanyId: r.source?.kind === "FIRINGI" ? r.source.id : null,
      sourceOfferId: r.source?.kind === "FIRINGI" ? r.source.sourceOfferId : null, unitCost: r.unitCost === null ? null : new Prisma.Decimal(r.unitCost).toDecimalPlaces(4),
    };
    const cur = open.find((s) => s.offerId === r.offerId && s.addressId === r.addressId);
    if (cur) { keep.add(cur.id); await prisma.restockSuggestion.update({ where: { id: cur.id }, data }); updated++; continue; }
    if (quiet.has(r.key)) continue;
    await prisma.restockSuggestion.create({ data: { ...data, companyId: cp.companyId, offerId: r.offerId, addressId: r.addressId } });
    created.push(r);
  }
  const gone = open.filter((s) => !keep.has(s.id)).map((s) => s.id);
  if (gone.length) await prisma.restockSuggestion.updateMany({ where: { id: { in: gone } }, data: { status: "EXPIRED" } });
  return { created, updated, expired: gone.length };
}

export type RunResult = { companies: number; series: number; created: number; updated: number; expired: number; notified: number };

/** Plan one company or all of them. Notifies the supplier about new urgent suggestions. */
export async function runPlanning(opts: { companyId?: string; now?: Date; notify?: boolean } = {}): Promise<RunResult> {
  const now = opts.now ?? new Date();
  const today = startOfDay(now);
  const companies = opts.companyId ? [{ id: opts.companyId }] : await plannedCompanies();
  const defs = await planningDefaults();
  const res: RunResult = { companies: 0, series: 0, created: 0, updated: 0, expired: 0, notified: 0 };
  for (const c of companies) {
    const cp = await computeCompanyPlan(c.id, { now });
    res.series += await storeForecasts(cp);
    const s = await syncSuggestions(cp, today);
    res.companies++; res.created += s.created.length; res.updated += s.updated; res.expired += s.expired;
    const urgent = s.created.filter((r) => r.plan.urgency !== "SOON");
    if (urgent.length && defs.notify && opts.notify !== false) {
      await notify("planning.restock", [{ companyId: c.id, link: "/vendor/inventory/planning/restock" }], { count: urgent.length, late: urgent.filter((r) => r.plan.urgency === "OUT" || r.plan.urgency === "LATE").length }).catch(() => null);
      res.notified++;
    }
  }
  return res;
}

// ── supplier: reading ──────────────────────────────────────────────────────

export async function myPlan(ctx: Ctx) {
  requireInventory(ctx, VIEW);
  return computeCompanyPlan(ctx.company.id);
}

export async function mySuggestions(ctx: Ctx, status: "OPEN" | "DONE" = "OPEN") {
  requireInventory(ctx, VIEW);
  return prisma.restockSuggestion.findMany({
    where: { companyId: ctx.company.id, ...(status === "OPEN" ? { status: "OPEN" } : { status: { in: ["ORDERED", "DISMISSED"] }, updatedAt: { gte: addDays(new Date(), -30) } }) },
    include: { offer: { select: { vendorSku: true, packaging: { select: { name: true, variant: { select: { product: { select: { name: true } } } } } } } }, address: { select: { label: true } } },
    orderBy: status === "OPEN" ? [{ urgency: "asc" }, { runsOutOn: { sort: "asc", nulls: "last" } }] : [{ updatedAt: "desc" }],
    take: 300,
  });
}

/** Accuracy of the frozen forecasts over the last `weeks` finished weeks (all products, per week, per product). */
export async function accuracyOf(companyId: string | null, weeks = 12, now = new Date()) {
  const thisMonday = mondayOf(now);
  const rows = await prisma.demandForecast.findMany({
    where: { ...(companyId ? { companyId } : {}), actual: { not: null }, weekStart: { gte: addDays(thisMonday, -7 * weeks), lt: thisMonday } },
    select: { companyId: true, offerId: true, addressId: true, weekStart: true, qty: true, actual: true, backtest: true },
  });
  const pairs = rows.map((r) => ({ ...r, actual: r.actual ?? 0 }));
  const perWeek = new Map<string, { qty: number; actual: number }>();
  for (const r of pairs) { const k = isoDay(r.weekStart); const w = perWeek.get(k) ?? { qty: 0, actual: 0 }; w.qty += r.qty; w.actual += r.actual; perWeek.set(k, w); }
  const perSeries = new Map<string, typeof pairs>();
  for (const r of pairs) { const k = `${r.offerId}|${r.addressId}`; perSeries.set(k, [...(perSeries.get(k) ?? []), r]); }
  return {
    overall: accuracy(pairs), backtested: pairs.filter((p) => p.backtest).length, total: pairs.length,
    weeks: [...perWeek.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([week, v]) => ({ week, qty: Math.round(v.qty * 10) / 10, actual: Math.round(v.actual * 10) / 10 })),
    series: new Map([...perSeries.entries()].map(([k, v]) => [k, accuracy(v)])),
    byCompany: new Map([...new Set(pairs.map((p) => p.companyId))].map((c) => [c, accuracy(pairs.filter((p) => p.companyId === c))])),
  };
}

/** One product in one warehouse: history, forecast with range, frozen past forecasts vs actuals, weekdays, plan. */
export async function forecastDetail(ctx: Ctx, offerId: string, address?: string | null) {
  requireInventory(ctx, VIEW);
  const cp = await computeCompanyPlan(ctx.company.id, { offerId });
  const row = (address ? cp.rows.find((r) => r.addressId === address) : null) ?? cp.rows.sort((a, b) => b.fit.weeksOfHistory - a.fit.weeksOfHistory)[0];
  if (!row) throw new NotFoundError("Product");
  const addressId = row.addressId;
  const thisMonday = cp.thisMonday;
  const [past, weekday, item] = await Promise.all([
    prisma.demandForecast.findMany({ where: { offerId, addressId, weekStart: { gte: addDays(thisMonday, -7 * 12), lt: thisMonday } }, orderBy: { weekStart: "asc" } }),
    weekdayUnits(ctx.company.id, offerId, addressId),
    prisma.planningItem.findUnique({ where: { offerId_addressId: { offerId, addressId } } }),
  ]);
  return {
    cp, row, item, weekday: weekdayProfile(weekday),
    past: past.map((p) => ({ week: p.weekStart, qty: p.qty, actual: p.actual, backtest: p.backtest })),
    accuracy: accuracy(past.filter((p) => p.actual !== null).map((p) => ({ qty: p.qty, actual: p.actual! }))),
  };
}

// ── supplier: decisions ────────────────────────────────────────────────────

export type OrderPick = { id: string; qty: number; supplierId?: string | null; sellerCompanyId?: string | null; sourceOfferId?: string | null; unitCost?: number | null };

/** Turn chosen suggestions into draft purchase orders (one per source × warehouse). Nothing is sent. */
export async function orderSuggestions(ctx: Ctx, picks: OrderPick[]) {
  requireInventory(ctx, ORDER);
  if (!picks.length) throw new ValidationError("Choose at least one product.");
  if (picks.length > 200) throw new ValidationError("At most 200 products at once.");
  const sugg = await prisma.restockSuggestion.findMany({ where: { id: { in: picks.map((p) => p.id) }, companyId: ctx.company.id, status: "OPEN" } });
  if (sugg.length !== picks.length) throw new ValidationError("Some suggestions changed meanwhile — reload the page.");
  const full = picks.map((p) => {
    const s = sugg.find((x) => x.id === p.id)!;
    if (!Number.isInteger(p.qty) || p.qty < 1 || p.qty > 1_000_000) throw new ValidationError("Quantities must be whole numbers from 1.");
    const supplierId = p.supplierId !== undefined ? p.supplierId : s.supplierId;
    const sellerCompanyId = p.sellerCompanyId !== undefined ? p.sellerCompanyId : s.sellerCompanyId;
    return { s, offerId: s.offerId, addressId: s.addressId, qty: p.qty, supplierId: supplierId || null, sellerCompanyId: sellerCompanyId || null,
      sourceOfferId: (p.sourceOfferId !== undefined ? p.sourceOfferId : s.sourceOfferId) || null, unitCost: p.unitCost ?? (s.unitCost ? Number(s.unitCost) : null) };
  });
  const { draftFromSuggestions } = await import("@/server/inventory/purchasing");
  const made = await draftFromSuggestions(ctx, full);
  // map back: draftFromSuggestions makes one purchase order per source × warehouse, in first-seen order
  const groups: string[] = [];
  for (const f of full) { const k = `${f.supplierId ?? ""}|${f.sellerCompanyId ?? ""}|${f.addressId}`; if (!groups.includes(k)) groups.push(k); }
  for (const f of full) {
    const po = made[groups.indexOf(`${f.supplierId ?? ""}|${f.sellerCompanyId ?? ""}|${f.addressId}`)];
    await prisma.restockSuggestion.update({ where: { id: f.s.id }, data: { status: "ORDERED", poId: po.id, decidedById: ctx.user.id, decidedAt: new Date(), qty: f.qty } });
    // remember the source for next time when none was chosen yet
    await prisma.planningItem.upsert({
      where: { offerId_addressId: { offerId: f.offerId, addressId: f.addressId } },
      create: { offerId: f.offerId, addressId: f.addressId, supplierId: f.supplierId, sellerCompanyId: f.sellerCompanyId, sourceOfferId: f.sourceOfferId, updatedById: ctx.user.id },
      update: {},
    });
  }
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "planning.ordered", entityType: "RestockSuggestion", entityId: full[0].s.id, after: { suggestions: full.length, purchaseOrders: made.map((m) => m.number), suggestedBy: "PLANNING" } });
  return made;
}

export async function dismissSuggestion(ctx: Ctx, id: string, i: { reason?: string | null; snoozeDays: number }) {
  requireInventory(ctx, [ORDER, MANAGE]);
  if (!Number.isInteger(i.snoozeDays) || i.snoozeDays < 1 || i.snoozeDays > 90) throw new ValidationError("Choose 1–90 days.");
  const s = await prisma.restockSuggestion.findFirst({ where: { id, companyId: ctx.company.id, status: "OPEN" } });
  if (!s) throw new NotFoundError("Suggestion");
  await prisma.restockSuggestion.update({ where: { id }, data: { status: "DISMISSED", dismissReason: i.reason?.trim().slice(0, 300) || null, snoozeUntil: addDays(startOfDay(new Date()), i.snoozeDays), decidedById: ctx.user.id, decidedAt: new Date() } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "planning.dismissed", entityType: "RestockSuggestion", entityId: id, after: { snoozeDays: i.snoozeDays, reason: i.reason ?? null } });
}

/** Run the plan for this supplier now (instead of waiting for the night). */
export async function recalculate(ctx: Ctx) {
  requireInventory(ctx, [ORDER, MANAGE]);
  return runPlanning({ companyId: ctx.company.id, notify: false });
}

export type ItemInput = {
  offerId: string; addressId: string; serviceLevel?: number | null; leadTimeDays?: number | null; minOrderQty: number; packMultiple: number;
  supplierId?: string | null; sellerCompanyId?: string | null; sourceOfferId?: string | null; unitCost?: number | null; excluded: boolean; note?: string | null;
};
export async function saveItem(ctx: Ctx, i: ItemInput) {
  requireInventory(ctx, MANAGE);
  const { ownOffer, ownWarehouse } = await import("@/server/inventory/service");
  await ownOffer(ctx, i.offerId); await ownWarehouse(ctx, i.addressId);
  const int = (v: number | null | undefined, lo: number, hi: number, what: string) => { if (v == null) return null; if (!Number.isInteger(v) || v < lo || v > hi) throw new ValidationError(`${what} must be ${lo}–${hi}.`); return v; };
  int(i.serviceLevel, 50, 99, "Service level"); int(i.leadTimeDays, 0, 180, "Lead time"); int(i.minOrderQty, 1, 100000, "Minimum order"); int(i.packMultiple, 1, 10000, "Order in multiples of");
  if (i.unitCost != null && !(i.unitCost >= 0 && i.unitCost < 1e7)) throw new ValidationError("Enter a valid cost.");
  if (i.supplierId && i.sellerCompanyId) throw new ValidationError("Choose one source.");
  if (i.supplierId && !(await prisma.purchaseSupplier.findFirst({ where: { id: i.supplierId, ownerCompanyId: ctx.company.id } }))) throw new ValidationError("Choose one of your suppliers.");
  if (i.sellerCompanyId) {
    if (ctx.company.type !== "WHOLESALER") throw new ValidationError("Only wholesalers buy from distributors on FIRINGI.");
    if (!i.sourceOfferId || !(await prisma.vendorOffer.findFirst({ where: { id: i.sourceOfferId, vendorCompanyId: i.sellerCompanyId, status: "ACTIVE" } }))) throw new ValidationError("Choose the distributor's product.");
  }
  const data = {
    serviceLevel: i.serviceLevel ?? null, leadTimeDays: i.leadTimeDays ?? null, minOrderQty: i.minOrderQty, packMultiple: i.packMultiple,
    supplierId: i.supplierId || null, sellerCompanyId: i.sellerCompanyId || null, sourceOfferId: i.sellerCompanyId ? i.sourceOfferId || null : null,
    unitCost: i.unitCost == null ? null : new Prisma.Decimal(i.unitCost).toDecimalPlaces(4), excluded: i.excluded, note: i.note?.trim().slice(0, 300) || null, updatedById: ctx.user.id,
  };
  const row = await prisma.planningItem.upsert({ where: { offerId_addressId: { offerId: i.offerId, addressId: i.addressId } }, create: { offerId: i.offerId, addressId: i.addressId, ...data }, update: data });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "planning.item_saved", entityType: "PlanningItem", entityId: row.id, after: { ...data, unitCost: data.unitCost?.toString() ?? null } });
  return row;
}

export async function saveCompanySettings(ctx: Ctx, i: { serviceLevel: number | null; reviewDays: number | null; overstockDays: number | null }) {
  requireInventory(ctx, MANAGE);
  const chk = (v: number | null, lo: number, hi: number, what: string) => { if (v !== null && (!Number.isInteger(v) || v < lo || v > hi)) throw new ValidationError(`${what} must be ${lo}–${hi}.`); };
  chk(i.serviceLevel, 50, 99, "Service level"); chk(i.reviewDays, 1, 60, "Order every"); chk(i.overstockDays, 14, 365, "Overstock after");
  await prisma.planningSettings.upsert({ where: { companyId: ctx.company.id }, create: { companyId: ctx.company.id, ...i, updatedById: ctx.user.id }, update: { ...i, updatedById: ctx.user.id } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "planning.settings_saved", entityType: "PlanningSettings", entityId: ctx.company.id, after: i });
}

export async function setUseMeasured(ctx: Ctx, supplierId: string, on: boolean) {
  requireInventory(ctx, ORDER);
  const s = await prisma.purchaseSupplier.findFirst({ where: { id: supplierId, ownerCompanyId: ctx.company.id } });
  if (!s) throw new NotFoundError("Supplier");
  await prisma.purchaseSupplier.update({ where: { id: s.id }, data: { useMeasuredLeadTime: on } });
}

export async function myLeadTimes(ctx: Ctx) {
  requireInventory(ctx, VIEW);
  return sourceLeadTimes(ctx.company.id, await planningDefaults());
}

// ── events ─────────────────────────────────────────────────────────────────

export type EventInput = { id?: string | null; name: string; startsOn: string; endsOn: string; upliftPct: number; countryId?: string | null; categoryIds?: string[]; offerIds?: string[]; isActive?: boolean };
const dateOf = (s: string) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new ValidationError("Enter the dates."); return new Date(`${s}T00:00:00Z`); };

async function writeEvent(ctx: Ctx, companyId: string | null, i: EventInput) {
  const name = i.name?.trim();
  if (!name || name.length > 80) throw new ValidationError("Give the event a name (up to 80 characters).");
  const startsOn = dateOf(i.startsOn), endsOn = dateOf(i.endsOn);
  if (endsOn < startsOn) throw new ValidationError("The end can't be before the start.");
  if (endsOn.getTime() - startsOn.getTime() > 366 * 86_400_000) throw new ValidationError("An event lasts at most a year.");
  if (!Number.isInteger(i.upliftPct) || i.upliftPct < -90 || i.upliftPct > 300 || i.upliftPct === 0) throw new ValidationError("The effect must be −90 % to +300 % (not 0).");
  const offerIds = [...new Set(i.offerIds ?? [])];
  if (companyId && offerIds.length && (await prisma.vendorOffer.count({ where: { id: { in: offerIds }, vendorCompanyId: companyId } })) !== offerIds.length) throw new ValidationError("Choose your own products.");
  const categoryIds = [...new Set(i.categoryIds ?? [])];
  if (categoryIds.length && (await prisma.category.count({ where: { id: { in: categoryIds } } })) !== categoryIds.length) throw new ValidationError("Unknown category.");
  const data = { name, startsOn, endsOn, upliftPct: i.upliftPct, offerIds, categoryIds, countryId: companyId ? null : i.countryId || null, isActive: i.isActive ?? true };
  if (i.id) {
    const cur = await prisma.planningEvent.findFirst({ where: { id: i.id, companyId } });
    if (!cur) throw new NotFoundError("Event");
    await prisma.planningEvent.update({ where: { id: cur.id }, data });
  } else await prisma.planningEvent.create({ data: { ...data, companyId, createdById: ctx.user.id } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: i.id ? "planning.event_updated" : "planning.event_created", entityType: "PlanningEvent", entityId: i.id ?? name, after: { ...data, startsOn: i.startsOn, endsOn: i.endsOn } });
}

export async function saveMyEvent(ctx: Ctx, i: EventInput) { requireInventory(ctx, MANAGE); await writeEvent(ctx, ctx.company.id, i); }
export async function saveGlobalEvent(ctx: Ctx, i: EventInput) { requireAdminManage(ctx); await writeEvent(ctx, null, i); }

export async function setEventActive(ctx: Ctx, id: string, active: boolean) {
  const admin = ctx.company.type === "ADMIN";
  if (admin) requireAdminManage(ctx); else requireInventory(ctx, MANAGE);
  const e = await prisma.planningEvent.findFirst({ where: { id, companyId: admin ? null : ctx.company.id } });
  if (!e) throw new NotFoundError("Event");
  await prisma.planningEvent.update({ where: { id }, data: { isActive: active } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: active ? "planning.event_on" : "planning.event_off", entityType: "PlanningEvent", entityId: id });
}

export async function myEvents(ctx: Ctx) {
  requireInventory(ctx, VIEW);
  const c = await prisma.company.findUniqueOrThrow({ where: { id: ctx.company.id }, select: { countryId: true } });
  return prisma.planningEvent.findMany({ where: { OR: [{ companyId: ctx.company.id }, { companyId: null, isActive: true, OR: [{ countryId: null }, ...(c.countryId ? [{ countryId: c.countryId }] : [])] }] }, orderBy: [{ startsOn: "asc" }] });
}

/** The supplier's own planning settings row (null fields = FIRINGI's default). */
export async function mySettings(ctx: Ctx) {
  requireInventory(ctx, VIEW);
  return prisma.planningSettings.findUnique({ where: { companyId: ctx.company.id } });
}

/** Choice lists for FIRINGI-wide events: Schengen countries, top categories, and how many supplier events are on. */
export async function eventOptions(ctx: Ctx) {
  requireAdminView(ctx);
  const [countries, categories, supplierEvents] = await Promise.all([
    prisma.country.findMany({ where: { isActive: true, isSchengen: true }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } }),
    prisma.category.findMany({ where: { isActive: true, depth: { lte: 1 } }, select: { id: true, name: true, depth: true }, orderBy: [{ path: "asc" }] }),
    prisma.planningEvent.count({ where: { companyId: { not: null }, isActive: true } }),
  ]);
  return { countries, categories, supplierEvents };
}

export async function globalEvents(ctx: Ctx) {
  requireAdminView(ctx);
  return prisma.planningEvent.findMany({ where: { companyId: null }, orderBy: { startsOn: "asc" } });
}

/** The supplier's planning dashboard: plan, open suggestions, risk lines and accuracy in one go. */
export async function myDashboard(ctx: Ctx) {
  requireInventory(ctx, VIEW);
  const [cp, open, acc, off] = await Promise.all([computeCompanyPlan(ctx.company.id), mySuggestions(ctx), accuracyOf(ctx.company.id), liveDismissals(ctx.company.id)]);
  return { cp, open, accuracy: acc, risk: riskRows(cp).filter((r) => !off.has(r.key)) };
}

// ── overstock & expiry risk ────────────────────────────────────────────────

async function liveDismissals(companyId: string) {
  const rows = await prisma.stockRiskDismissal.findMany({ where: { companyId, until: { gt: startOfDay(new Date()) } }, select: { key: true } });
  return new Set(rows.map((r) => r.key));
}

export async function myRisk(ctx: Ctx) {
  requireInventory(ctx, VIEW);
  const cp = await computeCompanyPlan(ctx.company.id);
  const off = await liveDismissals(ctx.company.id);
  return { cp, rows: riskRows(cp).filter((r) => !off.has(r.key)), hidden: off.size };
}

export async function dismissRisk(ctx: Ctx, key: string, days: number, reason?: string | null) {
  requireInventory(ctx, MANAGE);
  if (!/^(EXPIRY:[\w-]+|OVERSTOCK:[\w-]+:[\w-]+)$/.test(key)) throw new ValidationError("Unknown line.");
  if (!Number.isInteger(days) || days < 1 || days > 90) throw new ValidationError("Choose 1–90 days.");
  const until = addDays(startOfDay(new Date()), days);
  await prisma.stockRiskDismissal.upsert({ where: { companyId_key: { companyId: ctx.company.id, key } }, create: { companyId: ctx.company.id, key, until, reason: reason?.trim().slice(0, 300) || null, createdById: ctx.user.id }, update: { until, reason: reason?.trim().slice(0, 300) || null, createdById: ctx.user.id } });
}

/** Draft a transfer to the warehouse that will sell it (the supplier sends it from Transfers). */
export async function transferForRisk(ctx: Ctx, i: { offerId: string; fromAddressId: string; toAddressId: string; qty: number; kind: "EXPIRY" | "OVERSTOCK" }) {
  requireInventory(ctx, MANAGE);
  const { createTransfer } = await import("@/server/inventory/warehouse");
  const t = await createTransfer(ctx, { fromAddressId: i.fromAddressId, toAddressId: i.toAddressId, note: i.kind === "EXPIRY" ? "Planning: sells before its best-before there" : "Planning: overstock moved to where it sells", lines: [{ offerId: i.offerId, qty: i.qty }] });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "planning.transfer_drafted", entityType: "StockTransfer", entityId: t.id, after: { ...i, suggestedBy: "PLANNING" } });
  return t;
}

// ── FIRINGI ────────────────────────────────────────────────────────────────

export async function savePlanningDefaults(ctx: Ctx, d: PlanningDefaults) {
  requireAdminManage(ctx);
  const chk = (v: number, lo: number, hi: number, what: string) => { if (!Number.isInteger(v) || v < lo || v > hi) throw new ValidationError(`${what} must be ${lo}–${hi}.`); };
  chk(d.serviceLevel, 50, 99, "Service level"); chk(d.reviewDays, 1, 60, "Order every"); chk(d.overstockDays, 14, 365, "Overstock after");
  chk(d.leadTimeDays, 0, 60, "Default lead time"); chk(d.historyWeeks, 8, 104, "History"); chk(d.horizonWeeks, 4, 26, "Forecast ahead");
  const before = await planningDefaults();
  const value = { ...DEFAULTS, ...d, notify: !!d.notify };
  await prisma.setting.upsert({ where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key: SETTINGS_KEY } }, create: { scope: "GLOBAL", key: SETTINGS_KEY, value, updatedById: ctx.user.id }, update: { value, updatedById: ctx.user.id } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "planning.defaults_updated", entityType: "Setting", entityId: SETTINGS_KEY, before, after: value });
}

/** Every stock-holding supplier's plan (FIRINGI views). */
export async function allPlans(ctx: Ctx) {
  requireAdminView(ctx);
  const cs = await plannedCompanies();
  const out: CompanyPlan[] = [];
  for (const c of cs) out.push(await computeCompanyPlan(c.id));
  return out;
}

export async function adminOverview(ctx: Ctx) {
  const plans = await allPlans(ctx);
  const acc = await accuracyOf(null);
  const [open, lastRun] = await Promise.all([
    prisma.restockSuggestion.groupBy({ by: ["companyId", "urgency"], where: { status: "OPEN" }, _count: true }),
    prisma.jobRun.findFirst({ where: { job: "planning" }, orderBy: { startedAt: "desc" } }).catch(() => null),
  ]);
  const suppliers = plans.map((p) => {
    const risk = riskRows(p);
    const o = open.filter((x) => x.companyId === p.companyId);
    const n = (u: string) => o.find((x) => x.urgency === u)?._count ?? 0;
    return {
      id: p.companyId, name: p.name, type: p.type, inHouse: p.inHouse, products: p.rows.length,
      out: n("OUT"), late: n("LATE"), orderNow: n("ORDER_NOW"), soon: n("SOON"),
      expiryValue: Math.round(risk.filter((r) => r.kind === "EXPIRY").reduce((a, r) => a + r.value, 0) * 100) / 100,
      overstockValue: Math.round(risk.filter((r) => r.kind === "OVERSTOCK").reduce((a, r) => a + r.value, 0) * 100) / 100,
      accuracy: acc.byCompany.get(p.companyId) ?? null,
      stockValue: Math.round(p.rows.reduce((a, r) => a + r.onHand * r.avgCost, 0) * 100) / 100,
      methods: p.rows.reduce((m, r) => ({ ...m, [r.fit.method]: (m[r.fit.method] ?? 0) + (r.fit.weeksOfHistory ? 1 : 0) }), {} as Record<string, number>),
    };
  });
  return { suppliers, accuracy: acc, lastRun };
}

/** Products that run out across suppliers (open suggestions), most urgent first. */
export async function adminStockoutRisk(ctx: Ctx, opts: { urgency?: string; companyId?: string } = {}) {
  requireAdminView(ctx);
  const rows = await prisma.restockSuggestion.findMany({
    where: { status: "OPEN", ...(opts.urgency ? { urgency: opts.urgency as never } : { urgency: { in: ["OUT", "LATE", "ORDER_NOW"] } }), ...(opts.companyId ? { companyId: opts.companyId } : {}) },
    include: { company: { select: { id: true, legalName: true, tradeName: true, isInHouse: true } }, offer: { select: { id: true, vendorSku: true, packaging: { select: { name: true, variant: { select: { product: { select: { name: true } } } } } } } }, address: { select: { label: true } } },
    orderBy: [{ urgency: "asc" }, { runsOutOn: { sort: "asc", nulls: "last" } }], take: 300,
  });
  const flagged = await prisma.auditLog.findMany({ where: { action: "planning.flagged", entityId: { in: rows.map((r) => r.id) } }, select: { entityId: true, at: true }, orderBy: { at: "desc" } });
  return rows.map((r) => ({ ...r, flaggedAt: flagged.find((f) => f.entityId === r.id)?.at ?? null }));
}

/** FIRINGI asks the supplier to restock (in-app + e-mail). At most once every 3 days per suggestion. */
export async function flagSupplier(ctx: Ctx, suggestionId: string, message?: string | null) {
  requireAdminManage(ctx);
  const s = await prisma.restockSuggestion.findFirst({ where: { id: suggestionId, status: "OPEN" }, include: { offer: { select: { packaging: { select: { name: true, variant: { select: { product: { select: { name: true } } } } } } } }, address: { select: { label: true } } } });
  if (!s) throw new NotFoundError("Suggestion");
  const recent = await prisma.auditLog.findFirst({ where: { action: "planning.flagged", entityId: s.id, at: { gte: addDays(new Date(), -3) } } });
  if (recent) throw new ValidationError("The supplier was already asked in the last 3 days.");
  const { pickLocalized } = await import("@/i18n/config");
  const product = `${pickLocalized(s.offer.packaging.variant.product.name as never, "pt")} · ${pickLocalized(s.offer.packaging.name as never, "pt")}`;
  await notify("planning.flagged", [{ companyId: s.companyId, link: "/vendor/inventory/planning/restock" }], { product, warehouse: s.address.label, message: message?.trim().slice(0, 300) || "—" }).catch(() => null);
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "planning.flagged", entityType: "RestockSuggestion", entityId: s.id, after: { companyId: s.companyId, message: message ?? null } });
}

/** Accuracy across suppliers: overall, per supplier, and the series the forecast misses most. */
export async function adminAccuracy(ctx: Ctx) {
  requireAdminView(ctx);
  const acc = await accuracyOf(null);
  const cs = await plannedCompanies();
  const keys = [...acc.series.entries()].filter(([, a]) => a.wape !== null).sort((a, b) => (b[1].wape ?? 0) - (a[1].wape ?? 0)).slice(0, 25);
  const offers = await prisma.vendorOffer.findMany({
    where: { id: { in: keys.map(([k]) => k.split("|")[0]) } },
    select: { id: true, vendorSku: true, vendor: { select: { legalName: true, tradeName: true } }, packaging: { select: { name: true, variant: { select: { product: { select: { name: true } } } } } } },
  });
  const wh = await prisma.address.findMany({ where: { id: { in: keys.map(([k]) => k.split("|")[1]) } }, select: { id: true, label: true } });
  return {
    overall: acc.overall, weeks: acc.weeks, total: acc.total, backtested: acc.backtested,
    suppliers: cs.map((c) => ({ id: c.id, name: c.tradeName ?? c.legalName, inHouse: c.isInHouse, ...(acc.byCompany.get(c.id) ?? { weeks: 0, wape: null, accuracyPct: null, biasPct: null }) })),
    worst: keys.map(([k, a]) => {
      const [offerId, addressId] = k.split("|");
      const o = offers.find((x) => x.id === offerId);
      return { key: k, offerId, supplier: o ? o.vendor.tradeName ?? o.vendor.legalName : "—", product: o ? { product: o.packaging.variant.product.name, packaging: o.packaging.name, sku: o.vendorSku } : null, warehouse: wh.find((w) => w.id === addressId)?.label ?? "—", ...a };
    }),
  };
}

export async function adminLeadTimes(ctx: Ctx) {
  requireAdminView(ctx);
  const defs = await planningDefaults();
  const cs = await plannedCompanies();
  const out = [];
  for (const c of cs) for (const s of await sourceLeadTimes(c.id, defs)) out.push({ company: c.tradeName ?? c.legalName, companyId: c.id, inHouse: c.isInHouse, ...s });
  return out;
}

export async function adminStockRisk(ctx: Ctx) {
  const plans = await allPlans(ctx);
  return plans.flatMap((p) => riskRows(p).map((r) => ({ ...r, company: p.name, companyId: p.companyId, inHouse: p.inHouse, markdown: p.markdown })));
}

export { planningDefaults, computeCompanyPlan, riskRows };
