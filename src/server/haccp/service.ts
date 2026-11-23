import "server-only";
/**
 * Food safety (HACCP) logbook — Phase 69.
 *
 *   • Setup (buyer.haccp.manage): fridges / freezers / hot-holding units with their limits and check times;
 *     opening / closing checklists and cleaning tasks (daily, weekly, monthly); a ready-made template per kind of
 *     business (restaurant, café, shop) in the business's language.
 *   • Logging (buyer.haccp.log): temperature readings for each check time, checklists and cleaning done (items,
 *     optional photo), deliveries received (temperature, packaging, dates — a failed FIRINGI delivery leads to a
 *     claim), cooling. Anything out of range or not ok needs the corrective action taken.
 *   • Today, history, completion (done ÷ due), tips (fridges drifting, checks often missed), training records and
 *     the inspector-ready report (PDF).
 */
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";
import {
  TASK_FREQUENCIES, TASK_KINDS, TEMPLATES, UNIT_DEFAULTS, UNIT_KINDS, completion, coolingOk, dayKey, deliveryOk, drift, inRange, limitText, slotsFor, taskDue, utcDay, validTime,
  type UnitKind,
} from "@/lib/haccp";
import { haccpOn, haccpSettings, type HaccpPart, type HaccpSettings } from "./settings";

const DAY = 86400_000;
const n = (v: { toString(): string } | null | undefined) => (v == null ? null : Number(v.toString()));
const clean = (s: string | null | undefined, max: number) => (s?.trim() ? s.trim().slice(0, max) : null);

async function access(ctx: Ctx, need: "log" | "manage", part?: HaccpPart) {
  if (!(ctx.company.type === "CUSTOMER" || ctx.company.type === "WHOLESALER")) throw new ForbiddenError();
  if (!can(ctx, need === "manage" ? "buyer.haccp.manage" : ["buyer.haccp.log", "buyer.haccp.manage"])) throw new ForbiddenError();
  const s = await haccpSettings();
  if (!haccpOn(s, ctx.company)) throw new AppError("FEATURE_OFF", "FIRINGI hasn't switched the food safety logbook on for your company.", 403);
  if (part && !s.parts[part]) throw new AppError("FEATURE_OFF", "This part of the logbook is switched off.", 403);
  return s;
}
export async function haccpAccess(c: { id: string; type: string }) {
  const s = await haccpSettings();
  return { on: haccpOn(s, c), s };
}

// ── setup ───────────────────────────────────────────────────────────────────

export async function setup(ctx: Ctx) {
  const s = await access(ctx, "log");
  const [units, tasks] = await Promise.all([
    prisma.haccpUnit.findMany({ where: { companyId: ctx.company.id }, orderBy: [{ active: "desc" }, { sort: "asc" }, { createdAt: "asc" }] }),
    prisma.haccpTask.findMany({ where: { companyId: ctx.company.id }, orderBy: [{ active: "desc" }, { sort: "asc" }, { createdAt: "asc" }] }),
  ]);
  return {
    settings: s, manage: can(ctx, "buyer.haccp.manage"),
    units: units.map((u) => ({ ...u, minC: n(u.minC), maxC: n(u.maxC), limit: limitText(n(u.minC), n(u.maxC)) })),
    tasks, templates: TEMPLATES.filter((t) => s.templates[t.key] !== false).map((t) => t.key),
  };
}

export type UnitInput = { name: string; kind: string; minC: number | null; maxC: number | null; times: string[]; active?: boolean };
export async function saveUnit(ctx: Ctx, id: string | null, i: UnitInput) {
  await access(ctx, "manage", "temperatures");
  if (!(UNIT_KINDS as readonly string[]).includes(i.kind)) throw new ValidationError("Choose the kind of equipment.");
  const name = clean(i.name, 60);
  if (!name) throw new ValidationError("Name the equipment.");
  const times = [...new Set(i.times.map((t) => t.trim()).filter(Boolean))].sort();
  if (times.some((t) => !validTime(t))) throw new ValidationError("Times as HH:MM, e.g. 09:00.");
  if (times.length > 6) throw new ValidationError("At most 6 checks a day.");
  if (i.minC !== null && i.maxC !== null && i.minC > i.maxC) throw new ValidationError("The lowest temperature is above the highest.");
  const data = { name, kind: i.kind, minC: i.minC, maxC: i.maxC, times, active: i.active ?? true };
  if (id) {
    const u = await prisma.haccpUnit.findFirst({ where: { id, companyId: ctx.company.id } });
    if (!u) throw new NotFoundError("Equipment");
    return prisma.haccpUnit.update({ where: { id }, data });
  }
  const sort = await prisma.haccpUnit.count({ where: { companyId: ctx.company.id } });
  return prisma.haccpUnit.create({ data: { ...data, companyId: ctx.company.id, sort } });
}

export type TaskInput = { name: string; kind: string; frequency: string; weekday?: number | null; dayOfMonth?: number | null; items: string[]; needsPhoto?: boolean; active?: boolean };
export async function saveTask(ctx: Ctx, id: string | null, i: TaskInput) {
  const s = await access(ctx, "manage");
  if (!(TASK_KINDS as readonly string[]).includes(i.kind)) throw new ValidationError("Choose checklist or cleaning.");
  if (!s.parts[i.kind === "CLEANING" ? "cleaning" : "checklists"]) throw new AppError("FEATURE_OFF", "This part of the logbook is switched off.", 403);
  if (!(TASK_FREQUENCIES as readonly string[]).includes(i.frequency)) throw new ValidationError("Choose how often.");
  const name = clean(i.name, 80);
  if (!name) throw new ValidationError("Name the checklist.");
  const items = i.items.map((x) => x.trim().slice(0, 120)).filter(Boolean).slice(0, 30);
  if (!items.length) throw new ValidationError("Add at least one item to check.");
  const data = {
    name, kind: i.kind, frequency: i.frequency, items, needsPhoto: !!i.needsPhoto && s.parts.photos, active: i.active ?? true,
    weekday: i.frequency === "WEEKLY" ? Math.min(7, Math.max(1, Math.round(i.weekday ?? 1))) : null,
    dayOfMonth: i.frequency === "MONTHLY" ? Math.min(31, Math.max(1, Math.round(i.dayOfMonth ?? 1))) : null,
  };
  if (id) {
    const t = await prisma.haccpTask.findFirst({ where: { id, companyId: ctx.company.id } });
    if (!t) throw new NotFoundError("Checklist");
    return prisma.haccpTask.update({ where: { id }, data });
  }
  const sort = await prisma.haccpTask.count({ where: { companyId: ctx.company.id } });
  return prisma.haccpTask.create({ data: { ...data, companyId: ctx.company.id, sort } });
}

/** A ready-made logbook (names in the business's language); equipment / checklists with the same name are kept. */
export async function applyTemplate(ctx: Ctx, key: string, label: (k: string) => string) {
  const s = await access(ctx, "manage");
  const t = TEMPLATES.find((x) => x.key === key);
  if (!t || s.templates[key] === false) throw new NotFoundError("Template");
  const [units, tasks] = await Promise.all([prisma.haccpUnit.findMany({ where: { companyId: ctx.company.id }, select: { name: true } }), prisma.haccpTask.findMany({ where: { companyId: ctx.company.id }, select: { name: true } })]);
  const haveU = new Set(units.map((u) => u.name)), haveT = new Set(tasks.map((x) => x.name));
  let made = 0;
  if (s.parts.temperatures) for (const [i, u] of t.units.entries()) {
    const name = label(`tpl.unit.${u.key}`);
    if (haveU.has(name)) continue;
    const d = UNIT_DEFAULTS[u.kind as UnitKind];
    await prisma.haccpUnit.create({ data: { companyId: ctx.company.id, name, kind: u.kind, minC: d.minC, maxC: d.maxC, times: u.times, sort: units.length + i } });
    made++;
  }
  for (const [i, x] of t.tasks.entries()) {
    if (!s.parts[x.kind === "CLEANING" ? "cleaning" : "checklists"]) continue;
    const name = label(`tpl.task.${x.key}`);
    if (haveT.has(name)) continue;
    await prisma.haccpTask.create({ data: { companyId: ctx.company.id, name, kind: x.kind, frequency: x.frequency, weekday: x.weekday ?? null, dayOfMonth: x.dayOfMonth ?? null, items: x.items.map((it) => label(`tpl.item.${it}`)), sort: tasks.length + i } });
    made++;
  }
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "haccp.template", entityType: "Company", entityId: ctx.company.id, after: { template: key, made } });
  return made;
}

// ── what is due ─────────────────────────────────────────────────────────────

type UnitRow = { id: string; name: string; times: string[]; createdAt: Date; minC: number | null; maxC: number | null; kind: string };
type TaskRow = { id: string; name: string; kind: string; frequency: string; weekday: number | null; dayOfMonth: number | null; createdAt: Date; items: string[]; needsPhoto: boolean };
type EntryRow = { kind: string; unitId: string | null; taskId: string | null; slot: string | null; ok: boolean; forDate: Date };

/** Due and done for each day of a period (temperature checks + checklists / cleaning). */
export function dueAndDone(units: UnitRow[], tasks: TaskRow[], entries: EntryRow[], from: Date, to: Date, now: Date, s: Pick<HaccpSettings, "parts" | "rules">) {
  const days: { day: string; due: number; done: number; late: number; out: number; missed: { what: string; at: string | null }[] }[] = [];
  for (let t = utcDay(from).getTime(); t <= utcDay(to).getTime() && t <= utcDay(now).getTime(); t += DAY) {
    const d = new Date(t), k = dayKey(d);
    const es = entries.filter((e) => dayKey(e.forDate) === k);
    const us = s.parts.temperatures ? units.filter((u) => utcDay(u.createdAt).getTime() <= t) : [];
    const slots = slotsFor(us, es.filter((e) => e.kind === "TEMP"), d, now, s.rules.graceMinutes);
    const ts = tasks.filter((x) => utcDay(x.createdAt).getTime() <= t && s.parts[x.kind === "CLEANING" ? "cleaning" : "checklists"] && taskDue(x, d));
    const past = t < utcDay(now).getTime();
    const tDone = ts.filter((x) => es.some((e) => e.taskId === x.id));
    const missed = [
      ...slots.filter((x) => x.state === "LATE").map((x) => ({ what: us.find((u) => u.id === x.unitId)?.name ?? "—", at: x.time })),
      ...(past ? ts.filter((x) => !tDone.includes(x)).map((x) => ({ what: x.name, at: null })) : []),
    ];
    // today's tasks count as due only once the day is over (they can still be done)
    const due = slots.filter((x) => x.state === "DONE" || x.state === "OUT" || x.state === "LATE").length + (past ? ts.length : tDone.length);
    const done = slots.filter((x) => x.state === "DONE" || x.state === "OUT").length + tDone.length;
    days.push({ day: k, due: Math.max(due, done), done, late: missed.length, out: es.filter((e) => !e.ok).length, missed });
  }
  const due = days.reduce((a, x) => a + x.due, 0), done = days.reduce((a, x) => a + x.done, 0);
  return { days, due, done, pct: completion(due, done) };
}

async function rows(companyId: string, from: Date, to: Date) {
  const [units, tasks, entries] = await Promise.all([
    prisma.haccpUnit.findMany({ where: { companyId, active: true }, orderBy: [{ sort: "asc" }, { createdAt: "asc" }] }),
    prisma.haccpTask.findMany({ where: { companyId, active: true }, orderBy: [{ sort: "asc" }, { createdAt: "asc" }] }),
    prisma.haccpEntry.findMany({ where: { companyId, forDate: { gte: utcDay(from), lte: utcDay(to) } }, orderBy: { at: "asc" } }),
  ]);
  return { units: units.map((u) => ({ ...u, minC: n(u.minC), maxC: n(u.maxC) })), tasks, entries };
}

export type Tip = { code: "DRIFT_OUT" | "DRIFT_NEAR" | "OFTEN_MISSED" | "NO_DELIVERY_CHECKS" | "TRAINING_EXPIRING" | "TRAINING_EXPIRED"; what?: string; n?: number; value?: number; date?: string };

/** Everything on the Today page. */
export async function today(ctx: Ctx, now = new Date()) {
  const s = await access(ctx, "log");
  const id = ctx.company.id;
  const t0 = utcDay(now);
  const { units, tasks, entries } = await rows(id, new Date(t0.getTime() - 13 * DAY), now);
  const todays = entries.filter((e) => dayKey(e.forDate) === dayKey(t0));
  const slots = s.parts.temperatures ? slotsFor(units, todays.filter((e) => e.kind === "TEMP"), t0, now, s.rules.graceMinutes) : [];
  const dueTasks = tasks.filter((x) => s.parts[x.kind === "CLEANING" ? "cleaning" : "checklists"] && taskDue(x, t0));
  const week = dueAndDone(units, tasks, entries.filter((e) => e.forDate >= new Date(t0.getTime() - 6 * DAY)), new Date(t0.getTime() - 6 * DAY), now, now, s);
  const fortnight = dueAndDone(units, tasks, entries, new Date(t0.getTime() - 13 * DAY), new Date(t0.getTime() - DAY), now, s);
  const tips = await tipsFor(id, s, now, units, fortnight.days);
  const issues = entries.filter((e) => !e.ok && e.at >= new Date(now.getTime() - 7 * DAY)).reverse().slice(0, 10);
  const todayDue = slots.filter((x) => x.state !== "LATER").length + dueTasks.length;
  const todayDone = slots.filter((x) => x.state === "DONE" || x.state === "OUT").length + dueTasks.filter((x) => todays.some((e) => e.taskId === x.id)).length;
  return {
    settings: { parts: s.parts, rules: s.rules }, manage: can(ctx, "buyer.haccp.manage"), setUp: units.length + tasks.length > 0,
    units: units.map((u) => ({ id: u.id, name: u.name, kind: u.kind, minC: u.minC, maxC: u.maxC, limit: limitText(u.minC, u.maxC), slots: slots.filter((x) => x.unitId === u.id), last: todays.filter((e) => e.unitId === u.id).map((e) => ({ slot: e.slot, valueC: n(e.valueC), ok: e.ok })) })),
    tasks: dueTasks.map((x) => ({ id: x.id, name: x.name, kind: x.kind, frequency: x.frequency, items: x.items, needsPhoto: x.needsPhoto && s.parts.photos, done: todays.find((e) => e.taskId === x.id) ? { ok: todays.find((e) => e.taskId === x.id)!.ok, by: todays.find((e) => e.taskId === x.id)!.byName } : null })),
    deliveriesToday: todays.filter((e) => e.kind === "DELIVERY").length, coolingToday: todays.filter((e) => e.kind === "COOLING").length,
    today: { due: todayDue, done: todayDone, pct: completion(todayDue, todayDone) }, week: { due: week.due, done: week.done, pct: week.pct },
    issues: issues.map((e) => ({ id: e.id, kind: e.kind, at: e.at, what: e.unitId ? units.find((u) => u.id === e.unitId)?.name ?? "—" : e.taskId ? tasks.find((x) => x.id === e.taskId)?.name ?? "—" : e.product ?? e.supplier ?? "—", valueC: n(e.valueC), corrective: e.corrective })),
    tips,
  };
}

async function tipsFor(companyId: string, s: HaccpSettings, now: Date, units: UnitRow[], days: { missed: { what: string }[] }[]): Promise<Tip[]> {
  if (!s.parts.ai) return [];
  const tips: Tip[] = [];
  const since = new Date(now.getTime() - 7 * DAY);
  const temps = await prisma.haccpEntry.findMany({ where: { companyId, kind: "TEMP", at: { gte: since }, unitId: { in: units.map((u) => u.id) } }, select: { unitId: true, valueC: true }, orderBy: { at: "asc" } });
  for (const u of units) {
    const d = drift(temps.filter((x) => x.unitId === u.id).map((x) => n(x.valueC) ?? 0), u.maxC, u.minC);
    if (d) tips.push({ code: d.kind === "OUT" ? "DRIFT_OUT" : "DRIFT_NEAR", what: u.name, n: d.out, value: d.avg });
  }
  const counts = new Map<string, number>();
  for (const day of days) for (const m of day.missed) counts.set(m.what, (counts.get(m.what) ?? 0) + 1);
  for (const [what, c] of [...counts].sort((a, b) => b[1] - a[1]).slice(0, 3)) if (c >= 3) tips.push({ code: "OFTEN_MISSED", what, n: c });
  if (s.parts.deliveries) {
    const delivered = await prisma.order.count({ where: { buyerCompanyId: companyId, status: "DELIVERED", updatedAt: { gte: new Date(now.getTime() - 14 * DAY) } } });
    const checked = await prisma.haccpEntry.count({ where: { companyId, kind: "DELIVERY", at: { gte: new Date(now.getTime() - 14 * DAY) } } });
    if (delivered >= 3 && checked === 0) tips.push({ code: "NO_DELIVERY_CHECKS", n: delivered });
  }
  if (s.parts.training) {
    const tr = await prisma.haccpTraining.findMany({ where: { companyId, expiresAt: { lte: new Date(now.getTime() + s.rules.trainingWarnDays * DAY) } }, orderBy: { expiresAt: "asc" }, take: 3 });
    for (const x of tr) tips.push({ code: x.expiresAt! < now ? "TRAINING_EXPIRED" : "TRAINING_EXPIRING", what: x.personName, date: dayKey(x.expiresAt!) });
  }
  return tips;
}

// ── logging ─────────────────────────────────────────────────────────────────

async function notifyIssue(companyId: string, what: string, detail: string) {
  const { notify } = await import("@/server/notify/dispatch");
  await notify("haccp.out_of_range", [{ companyId, link: "/buy/food-safety" }], { what, detail }).catch(() => null);
}
const who = (ctx: Ctx) => ctx.user.name ?? ctx.user.email;
const needCorrective = (ok: boolean, corrective: string | null) => { if (!ok && !corrective) throw new ValidationError("Out of range — write what you did about it (corrective action)."); };

export async function logTemp(ctx: Ctx, i: { unitId: string; slot?: string | null; valueC: number; note?: string | null; corrective?: string | null }, now = new Date()) {
  await access(ctx, "log", "temperatures");
  const u = await prisma.haccpUnit.findFirst({ where: { id: i.unitId, companyId: ctx.company.id, active: true } });
  if (!u) throw new NotFoundError("Equipment");
  if (!(i.valueC > -60 && i.valueC < 150)) throw new ValidationError("Enter the temperature (°C).");
  const ok = inRange(i.valueC, n(u.minC), n(u.maxC));
  const corrective = clean(i.corrective, 500);
  needCorrective(ok, corrective);
  const slot = i.slot && u.times.includes(i.slot) ? i.slot : null;
  const e = await prisma.haccpEntry.create({ data: { companyId: ctx.company.id, kind: "TEMP", unitId: u.id, forDate: utcDay(now), slot, valueC: i.valueC, ok, note: clean(i.note, 300), corrective, byUserId: ctx.user.id, byName: who(ctx), at: now } });
  if (!ok) await notifyIssue(ctx.company.id, u.name, `${i.valueC} °C (${limitText(n(u.minC), n(u.maxC))}) — ${corrective}`);
  return e;
}

export async function logTask(ctx: Ctx, i: { taskId: string; results: Record<string, boolean>; note?: string | null; corrective?: string | null; photo?: File | null }, now = new Date()) {
  const s = await access(ctx, "log");
  const t = await prisma.haccpTask.findFirst({ where: { id: i.taskId, companyId: ctx.company.id, active: true } });
  if (!t) throw new NotFoundError("Checklist");
  if (!s.parts[t.kind === "CLEANING" ? "cleaning" : "checklists"]) throw new AppError("FEATURE_OFF", "This part of the logbook is switched off.", 403);
  const results = Object.fromEntries(t.items.map((it) => [it, !!i.results[it]]));
  const ok = Object.values(results).every(Boolean);
  const corrective = clean(i.corrective, 500);
  needCorrective(ok, corrective);
  let photoKey: string | null = null;
  if (i.photo && i.photo.size > 0 && s.parts.photos) photoKey = (await (await import("@/server/services/storage")).storeUpload(i.photo, `haccp/${ctx.company.id}`)).key;
  if (t.needsPhoto && s.parts.photos && !photoKey) throw new ValidationError("Add a photo.");
  const e = await prisma.haccpEntry.create({ data: { companyId: ctx.company.id, kind: "TASK", taskId: t.id, forDate: utcDay(now), ok, results, note: clean(i.note, 300), corrective, photoKey, byUserId: ctx.user.id, byName: who(ctx), at: now } });
  if (!ok) await notifyIssue(ctx.company.id, t.name, corrective!);
  return e;
}

export async function logDelivery(ctx: Ctx, i: { orderId?: string | null; supplier?: string | null; product?: string | null; valueC?: number | null; frozen?: boolean; packagingOk: boolean; datesOk: boolean; note?: string | null; corrective?: string | null }, now = new Date()) {
  const s = await access(ctx, "log", "deliveries");
  let supplier = clean(i.supplier, 80);
  if (i.orderId) {
    const o = await prisma.order.findFirst({ where: { id: i.orderId, buyerCompanyId: ctx.company.id }, select: { id: true, sellerCompanyId: true } });
    if (!o) throw new NotFoundError("Order");
    const sel = await prisma.company.findUnique({ where: { id: o.sellerCompanyId }, select: { legalName: true, tradeName: true } });
    supplier = sel?.tradeName ?? sel?.legalName ?? supplier;
  }
  if (!supplier) throw new ValidationError("Choose the order or write the supplier.");
  if (i.valueC != null && !(i.valueC > -60 && i.valueC < 100)) throw new ValidationError("Enter the temperature (°C).");
  const ok = deliveryOk({ packagingOk: i.packagingOk, datesOk: i.datesOk, valueC: i.valueC, frozen: i.frozen }, s.rules);
  const corrective = clean(i.corrective, 500);
  needCorrective(ok, corrective);
  const e = await prisma.haccpEntry.create({
    data: { companyId: ctx.company.id, kind: "DELIVERY", forDate: utcDay(now), orderId: i.orderId ?? null, supplier, product: clean(i.product, 120), valueC: i.valueC ?? null, ok, results: { packagingOk: i.packagingOk, datesOk: i.datesOk, frozen: !!i.frozen }, note: clean(i.note, 300), corrective, byUserId: ctx.user.id, byName: who(ctx), at: now },
  });
  return { entry: e, claimUrl: !ok && i.orderId ? `/buy/orders/${i.orderId}/claim` : null };
}

export async function logCooling(ctx: Ctx, i: { product: string; startC: number; endC: number; minutes: number; note?: string | null; corrective?: string | null }, now = new Date()) {
  const s = await access(ctx, "log", "cooling");
  const product = clean(i.product, 120);
  if (!product) throw new ValidationError("Write what was cooled.");
  if (!(i.minutes > 0 && i.minutes < 24 * 60)) throw new ValidationError("Enter how long it took (minutes).");
  const ok = coolingOk(i.endC, i.minutes, s.rules);
  const corrective = clean(i.corrective, 500);
  needCorrective(ok, corrective);
  return prisma.haccpEntry.create({ data: { companyId: ctx.company.id, kind: "COOLING", forDate: utcDay(now), product, startC: i.startC, valueC: i.endC, minutes: Math.round(i.minutes), ok, note: clean(i.note, 300), corrective, byUserId: ctx.user.id, byName: who(ctx), at: now } });
}

/** Take back an entry: your own the same day, or a manager. */
export async function deleteEntry(ctx: Ctx, id: string, now = new Date()) {
  await access(ctx, "log");
  const e = await prisma.haccpEntry.findFirst({ where: { id, companyId: ctx.company.id } });
  if (!e) throw new NotFoundError("Entry");
  const manager = can(ctx, "buyer.haccp.manage");
  if (!manager && (e.byUserId !== ctx.user.id || dayKey(e.at) !== dayKey(now))) throw new ForbiddenError("Only a manager can take back this entry.");
  await prisma.haccpEntry.delete({ where: { id } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "haccp.entry_deleted", entityType: "HaccpEntry", entityId: id, before: { kind: e.kind, valueC: e.valueC?.toString() ?? null, ok: e.ok, at: e.at.toISOString(), by: e.byName } });
}

/** FIRINGI orders delivered in the last 7 days (to check on arrival). */
export async function recentDeliveries(ctx: Ctx, now = new Date()) {
  await access(ctx, "log", "deliveries");
  const orders = await prisma.order.findMany({ where: { buyerCompanyId: ctx.company.id, status: { in: ["DELIVERED", "OUT_FOR_DELIVERY"] }, updatedAt: { gte: new Date(now.getTime() - 7 * DAY) } }, select: { id: true, number: true, sellerCompanyId: true, updatedAt: true }, orderBy: { updatedAt: "desc" }, take: 30 });
  const cos = await prisma.company.findMany({ where: { id: { in: orders.map((o) => o.sellerCompanyId) } }, select: { id: true, legalName: true, tradeName: true } });
  const checked = new Set((await prisma.haccpEntry.findMany({ where: { companyId: ctx.company.id, orderId: { in: orders.map((o) => o.id) } }, select: { orderId: true } })).map((e) => e.orderId));
  return orders.map((o) => ({ id: o.id, number: o.number, at: o.updatedAt, seller: cos.find((c) => c.id === o.sellerCompanyId)?.tradeName ?? cos.find((c) => c.id === o.sellerCompanyId)?.legalName ?? "—", checked: checked.has(o.id) }));
}

// ── history & report ────────────────────────────────────────────────────────

export async function history(ctx: Ctx, f: { from: Date; to: Date; kind?: string | null; issues?: boolean }) {
  await access(ctx, "log");
  const [units, tasks, entries] = await Promise.all([
    prisma.haccpUnit.findMany({ where: { companyId: ctx.company.id }, select: { id: true, name: true, minC: true, maxC: true } }),
    prisma.haccpTask.findMany({ where: { companyId: ctx.company.id }, select: { id: true, name: true } }),
    prisma.haccpEntry.findMany({ where: { companyId: ctx.company.id, forDate: { gte: utcDay(f.from), lte: utcDay(f.to) }, ...(f.kind ? { kind: f.kind } : {}), ...(f.issues ? { ok: false } : {}) }, orderBy: { at: "desc" }, take: 300 }),
  ]);
  return entries.map((e) => {
    const u = units.find((x) => x.id === e.unitId);
    return {
      id: e.id, kind: e.kind, at: e.at, forDate: e.forDate, slot: e.slot, ok: e.ok, valueC: n(e.valueC), startC: n(e.startC), minutes: e.minutes, byName: e.byName, byUserId: e.byUserId, note: e.note, corrective: e.corrective, photo: !!e.photoKey,
      what: u?.name ?? tasks.find((x) => x.id === e.taskId)?.name ?? (e.kind === "DELIVERY" ? e.supplier ?? e.product : e.product ?? e.supplier) ?? "—", limit: u ? limitText(n(u.minC), n(u.maxC)) : null, supplier: e.supplier, product: e.product, orderId: e.orderId,
      results: (e.results as Record<string, boolean> | null) ?? null,
    };
  });
}

/** The inspector-ready report for a period (also the PDF). */
export async function reportData(ctx: Ctx, from: Date, to: Date, now = new Date()) {
  const s = await access(ctx, "log", "reports");
  const id = ctx.company.id;
  const co = await prisma.company.findUniqueOrThrow({ where: { id }, select: { legalName: true, tradeName: true, taxId: true, vatNumber: true } });
  const { units, tasks, entries } = await rows(id, from, to);
  const dd = dueAndDone(units, tasks, entries, from, to, now, s);
  const training = s.parts.training ? await prisma.haccpTraining.findMany({ where: { companyId: id }, orderBy: [{ expiresAt: "asc" }] }) : [];
  return {
    company: { name: co.tradeName ?? co.legalName, legalName: co.legalName, taxId: co.vatNumber ?? co.taxId ?? null }, from, to, generatedAt: now, ...dd,
    units: units.map((u) => ({ id: u.id, name: u.name, kind: u.kind, limit: limitText(u.minC, u.maxC), times: u.times, readings: entries.filter((e) => e.unitId === u.id).map((e) => ({ day: dayKey(e.forDate), slot: e.slot, valueC: n(e.valueC), ok: e.ok, by: e.byName, corrective: e.corrective })) })),
    tasks: tasks.map((t) => ({ id: t.id, name: t.name, kind: t.kind, frequency: t.frequency, done: entries.filter((e) => e.taskId === t.id).map((e) => ({ day: dayKey(e.forDate), ok: e.ok, by: e.byName, corrective: e.corrective })) })),
    deliveries: entries.filter((e) => e.kind === "DELIVERY").map((e) => ({ day: dayKey(e.forDate), supplier: e.supplier, product: e.product, valueC: n(e.valueC), ok: e.ok, results: e.results as Record<string, boolean>, corrective: e.corrective, by: e.byName })),
    cooling: entries.filter((e) => e.kind === "COOLING").map((e) => ({ day: dayKey(e.forDate), product: e.product, startC: n(e.startC), endC: n(e.valueC), minutes: e.minutes, ok: e.ok, corrective: e.corrective, by: e.byName })),
    corrective: entries.filter((e) => !e.ok).map((e) => ({ day: dayKey(e.forDate), kind: e.kind, what: units.find((u) => u.id === e.unitId)?.name ?? tasks.find((t) => t.id === e.taskId)?.name ?? e.product ?? e.supplier ?? "—", valueC: n(e.valueC), corrective: e.corrective, by: e.byName })),
    training: training.map((t) => ({ person: t.personName, course: t.course, certificateNo: t.certificateNo, issuedAt: dayKey(t.issuedAt), expiresAt: t.expiresAt ? dayKey(t.expiresAt) : null, expired: !!t.expiresAt && t.expiresAt < now })),
    rules: s.rules,
  };
}

// ── training ────────────────────────────────────────────────────────────────

export async function trainings(ctx: Ctx, now = new Date()) {
  const s = await access(ctx, "log", "training");
  const rows = await prisma.haccpTraining.findMany({ where: { companyId: ctx.company.id }, orderBy: [{ personName: "asc" }, { issuedAt: "desc" }] });
  return rows.map((t) => ({ ...t, state: !t.expiresAt ? "OK" : t.expiresAt < now ? "EXPIRED" : t.expiresAt.getTime() - now.getTime() <= s.rules.trainingWarnDays * DAY ? "SOON" : "OK" }));
}
export type TrainingInput = { personName: string; course: string; certificateNo?: string | null; issuedAt: Date; expiresAt?: Date | null; note?: string | null };
export async function saveTraining(ctx: Ctx, id: string | null, i: TrainingInput) {
  await access(ctx, "manage", "training");
  const personName = clean(i.personName, 80), course = clean(i.course, 120);
  if (!personName || !course) throw new ValidationError("Write the person and the course.");
  if (i.expiresAt && i.expiresAt <= i.issuedAt) throw new ValidationError("Valid until must be after the date of the course.");
  const data = { personName, course, certificateNo: clean(i.certificateNo, 60), issuedAt: utcDay(i.issuedAt), expiresAt: i.expiresAt ? utcDay(i.expiresAt) : null, note: clean(i.note, 300), alertedAt: null };
  if (id) {
    const t = await prisma.haccpTraining.findFirst({ where: { id, companyId: ctx.company.id } });
    if (!t) throw new NotFoundError("Training");
    return prisma.haccpTraining.update({ where: { id }, data });
  }
  return prisma.haccpTraining.create({ data: { ...data, companyId: ctx.company.id } });
}
export async function deleteTraining(ctx: Ctx, id: string) {
  await access(ctx, "manage", "training");
  const r = await prisma.haccpTraining.deleteMany({ where: { id, companyId: ctx.company.id } });
  if (!r.count) throw new NotFoundError("Training");
}

// ── FIRINGI ─────────────────────────────────────────────────────────────────

function assertStaff(ctx: Ctx) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, ["admin.haccp.view", "admin.haccp.manage"])) throw new ForbiddenError();
}

/** Who uses the logbook and how well (completion and issues over 7 days). */
export async function adminBusinesses(ctx: Ctx, now = new Date()) {
  assertStaff(ctx);
  const s = await haccpSettings();
  const since = new Date(utcDay(now).getTime() - 6 * DAY);
  const ids = [...new Set([...(await prisma.haccpUnit.findMany({ select: { companyId: true }, distinct: ["companyId"] })).map((x) => x.companyId), ...(await prisma.haccpTask.findMany({ select: { companyId: true }, distinct: ["companyId"] })).map((x) => x.companyId)])];
  const cos = await prisma.company.findMany({ where: { id: { in: ids } }, select: { id: true, legalName: true, tradeName: true, type: true } });
  const out = [];
  for (const c of cos) {
    const { units, tasks, entries } = await rows(c.id, since, now);
    const dd = dueAndDone(units, tasks, entries, since, now, now, s);
    const last = await prisma.haccpEntry.findFirst({ where: { companyId: c.id }, orderBy: { at: "desc" }, select: { at: true } });
    out.push({ id: c.id, name: c.tradeName ?? c.legalName, type: c.type, units: units.length, tasks: tasks.length, entries7: entries.length, out7: entries.filter((e) => !e.ok).length, pct7: dd.pct, last: last?.at ?? null, override: s.companies[c.id] ?? null, on: haccpOn(s, c) });
  }
  return out.sort((a, b) => a.pct7 - b.pct7);
}

export async function adminOverview(ctx: Ctx, now = new Date()) {
  assertStaff(ctx);
  const since = new Date(now.getTime() - 7 * DAY);
  const [businesses, entries, out, units, training] = await Promise.all([
    adminBusinesses(ctx, now),
    prisma.haccpEntry.count({ where: { at: { gte: since } } }),
    prisma.haccpEntry.count({ where: { at: { gte: since }, ok: false } }),
    prisma.haccpUnit.count({ where: { active: true } }),
    prisma.haccpTraining.count({ where: { expiresAt: { lt: now } } }),
  ]);
  const active = businesses.filter((b) => b.entries7 > 0);
  return { businesses: businesses.length, active: active.length, entries7: entries, out7: out, units, expiredTraining: training, avgPct: active.length ? Math.round(active.reduce((a, b) => a + b.pct7, 0) / active.length) : 0, low: businesses.filter((b) => b.pct7 < 80).slice(0, 10) };
}

// ── AI ──────────────────────────────────────────────────────────────────────

/** For the customer's Assistant: today's checks, the week's completion, issues and tips (its own company only). */
export async function foodSafetyForAi(ctx: Ctx, now = new Date()) {
  const t = await today(ctx, now);
  return {
    setUp: t.setUp,
    todayCompletionPct: t.today.pct, weekCompletionPct: t.week.pct,
    stillDueToday: [
      ...t.units.flatMap((u) => u.slots.filter((x) => x.state === "DUE" || x.state === "LATE").map((x) => ({ check: `${u.name} temperature`, time: x.time, late: x.state === "LATE" }))),
      ...t.tasks.filter((x) => !x.done).map((x) => ({ check: x.name, time: null, late: false })),
    ],
    issuesLast7Days: t.issues.map((i) => ({ what: i.what, kind: i.kind, valueC: i.valueC, correctiveAction: i.corrective, at: i.at.toISOString().slice(0, 16) })),
    tips: t.tips,
    equipment: t.units.map((u) => ({ name: u.name, limit: u.limit, todaysReadings: u.last })),
  };
}
