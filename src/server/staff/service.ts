/**
 * Staff shifts & time (Phase 52) for customers', suppliers' and FIRINGI's own staff: people (role, contract, rate),
 * a weekly rota per site (draft → published, open shifts to claim, EU working-time warnings), clock in / out with
 * breaks (phone with a location check, a kiosk PIN pad on a shared device or the till — the same PIN as the till),
 * flags (late, left early, outside the area, forgot to clock out, no break), manager corrections with a reason,
 * weekly timesheets (regular / overtime / night / public-holiday hours) approved by a manager, payroll and legal
 * time-record exports, leave and shift swaps, labour cost against sales.
 * Every part is FIRINGI's switch (Settings › Staff & Time), per business type and per business.
 */
import "server-only";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";
import { notify } from "@/server/notify/dispatch";
import { pinHash } from "@/server/pos/secret";
import { haversineKm } from "@/lib/co2";
import {
  addDays, breakMinutes, cleanStaffSettings, nationalHolidays, entryFlags, labourShare, leaveDays, localParts, matchShift, mergeStaffSettings, rotaWarnings, splitWork, weekStartOf, weekTotals, zoneOf,
  type Break, type LeaveKindT, type Part, type StaffSettings, type StaffType,
} from "@/lib/staff-time";

const KEY = "staff.settings";
const FEATURE = "STAFF_TIME";
const DAY = 86_400_000;
type Action = "IN" | "OUT" | "BREAK_START" | "BREAK_END";
type Source = "PHONE" | "KIOSK" | "TILL" | "MANAGER" | "AUTO";

// ── settings, switches, access ──────────────────────────────────────────────

export async function staffSettings(): Promise<StaffSettings> {
  const row = await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: KEY } });
  return mergeStaffSettings(row?.value as Partial<StaffSettings> | null);
}

function firingiAdmin(ctx: Ctx) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, ["admin.settings.manage", "admin.users.manage"])) throw new ForbiddenError();
}

export async function saveStaffSettings(ctx: Ctx, input: StaffSettings) {
  firingiAdmin(ctx);
  let v: StaffSettings;
  try { v = cleanStaffSettings(input); } catch (e) { throw new ValidationError((e as Error).message); }
  const before = await staffSettings();
  const row = await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: KEY } });
  if (row) await prisma.setting.update({ where: { id: row.id }, data: { value: v } });
  else await prisma.setting.create({ data: { scope: "GLOBAL", scopeId: "", key: KEY, value: v } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "staff.settings_saved", entityType: "Setting", entityId: KEY, before, after: v });
  return v;
}

export async function companySwitch(companyId: string): Promise<"DEFAULT" | "ON" | "OFF"> {
  const f = await prisma.companyFeature.findUnique({ where: { companyId_key: { companyId, key: FEATURE } } });
  return !f ? "DEFAULT" : f.enabled ? "ON" : "OFF";
}

export async function setCompanySwitch(ctx: Ctx, companyId: string, state: "DEFAULT" | "ON" | "OFF") {
  firingiAdmin(ctx);
  const co = await prisma.company.findUnique({ where: { id: companyId }, select: { type: true } });
  if (!co || co.type === "ADMIN") throw new NotFoundError("Business");
  if (state === "DEFAULT") await prisma.companyFeature.deleteMany({ where: { companyId, key: FEATURE } });
  else await prisma.companyFeature.upsert({ where: { companyId_key: { companyId, key: FEATURE } }, create: { companyId, key: FEATURE, enabled: state === "ON", updatedById: ctx.user.id }, update: { enabled: state === "ON", updatedById: ctx.user.id } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "staff.company_switch", entityType: "Company", entityId: companyId, after: { state } });
}

export async function companySwitches(ctx: Ctx) {
  firingiAdmin(ctx);
  const f = await prisma.companyFeature.findMany({ where: { key: FEATURE }, include: { company: { select: { id: true, legalName: true, tradeName: true, type: true } } } });
  return f.map((x) => ({ companyId: x.companyId, name: x.company.tradeName ?? x.company.legalName, type: x.company.type, state: x.enabled ? ("ON" as const) : ("OFF" as const) }));
}

/** Is Staff & Time on for this business, and which parts? */
export async function staffAccess(co: { id: string; type: string }, s?: StaffSettings) {
  const set = s ?? (await staffSettings());
  const none = { on: false, parts: { clock: false, rota: false, timesheets: false, leave: false, swaps: false, labour: false } as Record<Part, boolean> };
  if (!set.enabled) return { ...none, why: "OFF" as const, settings: set };
  const sw = co.type === "ADMIN" ? "DEFAULT" : await companySwitch(co.id);
  if (sw === "OFF") return { ...none, why: "COMPANY_OFF" as const, settings: set };
  if (sw !== "ON" && !set.types[co.type as StaffType]) return { ...none, why: "TYPE_OFF" as const, settings: set };
  return { on: true, parts: set.parts, why: null, settings: set };
}

/** Managers: owners, "Staff & rota" managers (company.staff.manage), FIRINGI's admin.staff.manage. */
export const isManager = (ctx: Ctx) => ctx.membership.isOwner || can(ctx, ctx.company.type === "ADMIN" ? ["admin.staff.manage", "admin.users.manage"] : ["company.staff.manage", "team.users.manage"]);
const kioskOk = (ctx: Ctx) => isManager(ctx) || can(ctx, ctx.company.type === "ADMIN" ? ["admin.staff.manage"] : ["company.staff.kiosk", "company.pos.sell", "company.pos.manage"]);

async function ensure(ctx: Ctx, part?: Part, manage = false) {
  const a = await staffAccess(ctx.company);
  if (!a.on) throw new ForbiddenError(a.why === "COMPANY_OFF" ? "Staff & time is switched off for this business." : "Staff & time is not available.");
  if (part && !a.parts[part]) throw new ForbiddenError("FIRINGI has switched this part off.");
  if (manage && !isManager(ctx)) throw new ForbiddenError();
  return a.settings;
}

const tzOf = (ctx: Ctx) => zoneOf(ctx.company.countryCode);
const nameOfUser = (u: { name: string | null; email: string }) => u.name || u.email;
const toDate = (day: string) => new Date(`${day}T00:00:00Z`);
/** Staff pages live in the buyer portal for customers, the supplier portal for wholesalers / distributors, the back office for FIRINGI. */
export const portalOf = (type: string) => (type === "ADMIN" ? "/admin" : type === "CUSTOMER" ? "/buy" : "/vendor");
const link = (type: string, path: string) => `${portalOf(type)}${path}`;

/** The UTC instant of a local wall-clock time ("2026-11-23", "09:30") in a zone. */
export function zonedInstant(day: string, hhmm: string, tz: string) {
  const guess = new Date(`${day}T${hhmm}:00Z`);
  for (let i = 0; i < 3; i++) {
    const p = localParts(guess, tz);
    const want = Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
    const dayDiff = (toDate(day).getTime() - toDate(p.day).getTime()) / 60000;
    const diff = dayDiff + want - p.minute;
    if (diff === 0) break;
    guess.setTime(guess.getTime() + diff * 60000);
  }
  return guess;
}

async function holidaysFor(countryId: string, from: string, to: string) {
  const h = await prisma.publicHoliday.findMany({ where: { countryId, date: { gte: toDate(from), lte: toDate(to) } }, select: { date: true } });
  return new Set(h.map((x) => x.date.toISOString().slice(0, 10)));
}

// ── people & sites ──────────────────────────────────────────────────────────

/** The business's sites: its active addresses (shops, warehouses) with their location. */
export async function sites(ctx: Ctx) {
  const a = await prisma.address.findMany({ where: { companyId: ctx.company.id, isActive: true }, select: { id: true, label: true, line1: true, city: true, latitude: true, longitude: true, kind: true }, orderBy: { label: "asc" } });
  return a.map((x) => ({ id: x.id, label: x.label || x.line1, city: x.city, kind: x.kind, lat: x.latitude == null ? null : Number(x.latitude), lng: x.longitude == null ? null : Number(x.longitude) }));
}

/** Staff: the business's active members with their staff profile, PIN and whether they are in now. */
export async function people(ctx: Ctx, opts: { withRates?: boolean } = {}) {
  await ensure(ctx);
  const manager = isManager(ctx);
  const [m, pins, open] = await Promise.all([
    prisma.membership.findMany({ where: { companyId: ctx.company.id, status: "ACTIVE", user: { status: "ACTIVE" } }, include: { user: { select: { id: true, name: true, email: true } }, staffProfile: true }, orderBy: { createdAt: "asc" } }),
    prisma.posPin.findMany({ where: { companyId: ctx.company.id }, select: { userId: true } }),
    prisma.timeEntry.findMany({ where: { companyId: ctx.company.id, clockOut: null }, select: { membershipId: true, clockIn: true, breaks: true, siteId: true } }),
  ]);
  const pinSet = new Set(pins.map((p) => p.userId)), inNow = new Map(open.map((o) => [o.membershipId, o]));
  return m.filter((x) => x.staffProfile?.active !== false || manager).map((x) => {
    const p = x.staffProfile, o = inNow.get(x.id);
    const br = (o?.breaks as Break[] | undefined) ?? [];
    return {
      membershipId: x.id, userId: x.userId, name: nameOfUser(x.user), email: manager ? x.user.email : null, isOwner: x.isOwner,
      role: p?.role ?? x.jobTitle ?? null, contractHours: p?.contractHours == null ? null : Number(p.contractHours),
      hourlyRate: manager && opts.withRates !== false && p?.hourlyRate != null ? Number(p.hourlyRate) : null,
      homeSiteId: p?.homeSiteId ?? null, payrollCode: manager ? p?.payrollCode ?? null : null, active: p?.active ?? true, hasPin: pinSet.has(x.userId),
      inSince: o?.clockIn ?? null, onBreak: br.some((b) => !b.end), siteId: o?.siteId ?? null,
    };
  });
}

export async function saveProfile(ctx: Ctx, membershipId: string, i: { role: string | null; contractHours: number | null; hourlyRate: number | null; homeSiteId: string | null; payrollCode: string | null; active: boolean }) {
  await ensure(ctx, undefined, true);
  const m = await prisma.membership.findFirst({ where: { id: membershipId, companyId: ctx.company.id } });
  if (!m) throw new NotFoundError("Staff member");
  if (i.contractHours != null && !(i.contractHours >= 0 && i.contractHours <= 80)) throw new ValidationError("Contract hours are between 0 and 80 a week.");
  if (i.hourlyRate != null && !(i.hourlyRate >= 0 && i.hourlyRate <= 1000)) throw new ValidationError("Check the hourly rate.");
  if (i.homeSiteId && !(await prisma.address.findFirst({ where: { id: i.homeSiteId, companyId: ctx.company.id } }))) throw new ValidationError("Choose one of your sites.");
  const data = { companyId: ctx.company.id, role: i.role?.trim() || null, contractHours: i.contractHours?.toFixed(2) ?? null, hourlyRate: i.hourlyRate?.toFixed(2) ?? null, homeSiteId: i.homeSiteId || null, payrollCode: i.payrollCode?.trim() || null, active: i.active, updatedById: ctx.user.id };
  await prisma.staffProfile.upsert({ where: { membershipId }, create: { membershipId, ...data }, update: data });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "staff.profile_saved", entityType: "Membership", entityId: membershipId, after: { ...i, hourlyRate: i.hourlyRate != null ? "set" : null } });
}

/** The clock-in PIN (the same as the till's): 4–8 digits, unique in the business. */
export async function setPin(ctx: Ctx, membershipId: string, pin: string) {
  await ensure(ctx, "clock");
  const m = await prisma.membership.findFirst({ where: { id: membershipId, companyId: ctx.company.id }, select: { userId: true } });
  if (!m) throw new NotFoundError("Staff member");
  if (m.userId !== ctx.user.id && !isManager(ctx)) throw new ForbiddenError();
  if (!/^\d{4,8}$/.test(pin)) throw new ValidationError("A PIN is 4 to 8 digits.");
  const others = await prisma.posPin.findMany({ where: { companyId: ctx.company.id, NOT: { userId: m.userId } } });
  if (others.some((o) => o.pinHash === pinHash(ctx.company.id, o.userId, pin))) throw new ValidationError("Choose another PIN.");
  const h = pinHash(ctx.company.id, m.userId, pin);
  await prisma.posPin.upsert({ where: { companyId_userId: { companyId: ctx.company.id, userId: m.userId } }, update: { pinHash: h }, create: { companyId: ctx.company.id, userId: m.userId, pinHash: h } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "staff.pin_set", entityType: "Membership", entityId: membershipId });
}

// ── rota ────────────────────────────────────────────────────────────────────

/** A week of the rota (Monday's local day), with each person's planned hours and working-time warnings. */
export async function weekRota(ctx: Ctx, week: string | null, siteId?: string | null) {
  const s = await ensure(ctx, "rota");
  const tz = tzOf(ctx), start = week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? weekStartOf(new Date(`${week}T12:00:00Z`), tz) : weekStartOf(new Date(), tz);
  const from = zonedInstant(start, "00:00", tz), to = zonedInstant(addDays(start, 7), "00:00", tz);
  const manager = isManager(ctx);
  if (!manager && !s.self.seeColleagues) siteId = undefined;
  const shifts = await prisma.staffShift.findMany({
    where: { companyId: ctx.company.id, startsAt: { lt: to }, endsAt: { gt: from }, status: { not: "CANCELLED" }, ...(siteId ? { siteId } : {}), ...(manager ? {} : { status: "PUBLISHED", ...(s.self.seeColleagues ? {} : { OR: [{ membershipId: ctx.membership.id }, { membershipId: null }] }) }) },
    orderBy: { startsAt: "asc" },
  });
  const leave = await prisma.leaveRequest.findMany({ where: { companyId: ctx.company.id, status: "APPROVED", startsOn: { lte: toDate(addDays(start, 6)) }, endsOn: { gte: toDate(start) } } });
  const ppl = await people(ctx);
  const byMember = new Map<string, typeof shifts>();
  for (const x of shifts) if (x.membershipId) byMember.set(x.membershipId, [...(byMember.get(x.membershipId) ?? []), x]);
  const warnings = new Map<string, string[]>(), planned = new Map<string, number>();
  for (const [mid, list] of byMember) {
    const lv = leave.filter((l) => l.membershipId === mid).map((l) => ({ start: zonedInstant(l.startsOn.toISOString().slice(0, 10), "00:00", tz), end: zonedInstant(addDays(l.endsOn.toISOString().slice(0, 10), 1), "00:00", tz) }));
    const r = rotaWarnings(list, s.rules, lv);
    for (const [id, w] of r.warnings) warnings.set(id, w);
    planned.set(mid, r.plannedMinutes);
  }
  const cost = manager ? ppl.reduce((a, p) => a + ((planned.get(p.membershipId) ?? 0) / 60) * (p.hourlyRate ?? 0), 0) : null;
  return {
    week: start, days: Array.from({ length: 7 }, (_, i) => addDays(start, i)), tz, manager, settings: s,
    shifts: shifts.map((x) => ({ id: x.id, membershipId: x.membershipId, siteId: x.siteId, role: x.role, startsAt: x.startsAt, endsAt: x.endsAt, breakMinutes: x.breakMinutes, status: x.status, note: x.note, day: localParts(x.startsAt, tz).day, warnings: warnings.get(x.id) ?? [] })),
    people: ppl.filter((p) => p.active).map((p) => ({ membershipId: p.membershipId, name: p.name, role: p.role, contractHours: p.contractHours, plannedMinutes: planned.get(p.membershipId) ?? 0 })),
    leave: leave.map((l) => ({ membershipId: l.membershipId, kind: l.kind, startsOn: l.startsOn.toISOString().slice(0, 10), endsOn: l.endsOn.toISOString().slice(0, 10) })),
    drafts: shifts.filter((x) => x.status === "DRAFT").length, plannedCost: cost == null ? null : Math.round(cost * 100) / 100,
  };
}

export async function saveShift(ctx: Ctx, i: { id?: string | null; day: string; start: string; end: string; breakMinutes: number; membershipId: string | null; siteId: string | null; role: string | null; note: string | null }) {
  await ensure(ctx, "rota", true);
  const tz = tzOf(ctx);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.day) || !/^\d{2}:\d{2}$/.test(i.start) || !/^\d{2}:\d{2}$/.test(i.end)) throw new ValidationError("Check the day and times.");
  const startsAt = zonedInstant(i.day, i.start, tz);
  let endsAt = zonedInstant(i.day, i.end, tz);
  if (endsAt <= startsAt) endsAt = zonedInstant(addDays(i.day, 1), i.end, tz); // a night shift ends the next day
  if (endsAt.getTime() - startsAt.getTime() > 16 * 3600_000) throw new ValidationError("A shift is at most 16 hours.");
  if (!(i.breakMinutes >= 0 && i.breakMinutes <= 240)) throw new ValidationError("A break is up to 4 hours.");
  if (i.membershipId && !(await prisma.membership.findFirst({ where: { id: i.membershipId, companyId: ctx.company.id, status: "ACTIVE" } }))) throw new ValidationError("Choose one of your staff.");
  if (i.siteId && !(await prisma.address.findFirst({ where: { id: i.siteId, companyId: ctx.company.id } }))) throw new ValidationError("Choose one of your sites.");
  const data = { startsAt, endsAt, breakMinutes: Math.round(i.breakMinutes), membershipId: i.membershipId || null, siteId: i.siteId || null, role: i.role?.trim() || null, note: i.note?.trim() || null };
  if (i.id) {
    const old = await prisma.staffShift.findFirst({ where: { id: i.id, companyId: ctx.company.id } });
    if (!old) throw new NotFoundError("Shift");
    const x = await prisma.staffShift.update({ where: { id: old.id }, data: { ...data, remindedAt: null } });
    if (old.status === "PUBLISHED") {
      const who = [...new Set([old.membershipId, x.membershipId].filter(Boolean))] as string[];
      await tellMembers("staff.shift_changed", who, "/staff/me", { start: fmt(x.startsAt, tz) });
    }
    return x;
  }
  return prisma.staffShift.create({ data: { companyId: ctx.company.id, ...data, createdById: ctx.user.id } });
}

export async function deleteShift(ctx: Ctx, id: string) {
  await ensure(ctx, "rota", true);
  const x = await prisma.staffShift.findFirst({ where: { id, companyId: ctx.company.id } });
  if (!x) throw new NotFoundError("Shift");
  if (x.status === "DRAFT") await prisma.staffShift.delete({ where: { id } });
  else {
    await prisma.staffShift.update({ where: { id }, data: { status: "CANCELLED" } });
    if (x.membershipId) await tellMembers("staff.shift_changed", [x.membershipId], "/staff/me", { start: fmt(x.startsAt, tzOf(ctx)) });
  }
}

/** Copy a week's shifts (not cancelled) to another week as drafts. */
export async function copyWeek(ctx: Ctx, fromWeek: string, toWeek: string) {
  await ensure(ctx, "rota", true);
  const tz = tzOf(ctx);
  const a = weekStartOf(new Date(`${fromWeek}T12:00:00Z`), tz), b = weekStartOf(new Date(`${toWeek}T12:00:00Z`), tz);
  if (a === b) throw new ValidationError("Choose another week.");
  const src = await prisma.staffShift.findMany({ where: { companyId: ctx.company.id, status: { not: "CANCELLED" }, startsAt: { gte: zonedInstant(a, "00:00", tz), lt: zonedInstant(addDays(a, 7), "00:00", tz) } } });
  const shiftDays = Math.round((toDate(b).getTime() - toDate(a).getTime()) / DAY);
  let n = 0;
  for (const x of src) {
    const p = localParts(x.startsAt, tz), q = localParts(x.endsAt, tz);
    const hh = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    const day = addDays(p.day, shiftDays);
    const startsAt = zonedInstant(day, hh(p.minute), tz);
    const endsAt = zonedInstant(addDays(q.day, shiftDays), hh(q.minute), tz);
    await prisma.staffShift.create({ data: { companyId: ctx.company.id, siteId: x.siteId, membershipId: x.membershipId, role: x.role, startsAt, endsAt, breakMinutes: x.breakMinutes, note: x.note, createdById: ctx.user.id } });
    n++;
  }
  return { copied: n };
}

/** Publish the week's drafts: staff are told and see their shifts. */
export async function publishWeek(ctx: Ctx, week: string) {
  await ensure(ctx, "rota", true);
  const tz = tzOf(ctx), start = weekStartOf(new Date(`${week}T12:00:00Z`), tz);
  const where = { companyId: ctx.company.id, status: "DRAFT" as const, startsAt: { gte: zonedInstant(start, "00:00", tz), lt: zonedInstant(addDays(start, 7), "00:00", tz) } };
  const drafts = await prisma.staffShift.findMany({ where, select: { membershipId: true } });
  await prisma.staffShift.updateMany({ where, data: { status: "PUBLISHED", publishedAt: new Date() } });
  await tellMembers("staff.rota_published", [...new Set(drafts.map((d) => d.membershipId).filter(Boolean))] as string[], "/staff/me", { week: start });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "staff.rota_published", entityType: "Company", entityId: ctx.company.id, after: { week: start, shifts: drafts.length } });
  return { published: drafts.length };
}

/** A staff member takes an open (published, unassigned) shift. */
export async function claimShift(ctx: Ctx, id: string) {
  const s = await ensure(ctx, "rota");
  if (!s.self.claimOpenShifts) throw new ForbiddenError("FIRINGI has switched this off.");
  const r = await prisma.staffShift.updateMany({ where: { id, companyId: ctx.company.id, status: "PUBLISHED", membershipId: null, startsAt: { gt: new Date() } }, data: { membershipId: ctx.membership.id } });
  if (!r.count) throw new ValidationError("This shift has been taken.");
  const x = await prisma.staffShift.findUniqueOrThrow({ where: { id } });
  await notify("staff.shift_claimed", [{ companyId: ctx.company.id, link: link(ctx.company.type, "/staff/rota") }], { name: ctx.user.name || ctx.user.email, start: fmt(x.startsAt, tzOf(ctx)) }).catch(() => null);
}

/** My shifts and hours (the staff member's own page). */
export async function myWeek(ctx: Ctx) {
  const s = await ensure(ctx);
  const tz = tzOf(ctx), now = new Date();
  const [shifts, open, entries, leave, swaps, openShifts, pin] = await Promise.all([
    s.parts.rota ? prisma.staffShift.findMany({ where: { membershipId: ctx.membership.id, status: "PUBLISHED", endsAt: { gte: new Date(now.getTime() - DAY) } }, orderBy: { startsAt: "asc" }, take: 30 }) : [],
    prisma.timeEntry.findFirst({ where: { membershipId: ctx.membership.id, clockOut: null } }),
    prisma.timeEntry.findMany({ where: { membershipId: ctx.membership.id, clockIn: { gte: new Date(now.getTime() - 14 * DAY) } }, orderBy: { clockIn: "desc" }, take: 40 }),
    s.parts.leave ? prisma.leaveRequest.findMany({ where: { membershipId: ctx.membership.id }, orderBy: { startsOn: "desc" }, take: 20 }) : [],
    s.parts.swaps ? prisma.shiftSwap.findMany({ where: { companyId: ctx.company.id, OR: [{ fromMembershipId: ctx.membership.id }, { toMembershipId: ctx.membership.id }, { toMembershipId: null, status: "PENDING" }] }, include: { shift: true }, orderBy: { createdAt: "desc" }, take: 20 }) : [],
    s.parts.rota && s.self.claimOpenShifts ? prisma.staffShift.findMany({ where: { companyId: ctx.company.id, status: "PUBLISHED", membershipId: null, startsAt: { gt: now } }, orderBy: { startsAt: "asc" }, take: 10 }) : [],
    prisma.posPin.findUnique({ where: { companyId_userId: { companyId: ctx.company.id, userId: ctx.user.id } } }),
  ]);
  const week = weekStartOf(now, tz);
  const holidays = await holidaysFor(ctx.company.countryId, week, addDays(week, 6));
  const thisWeek = entries.filter((e) => weekStartOf(e.clockIn, tz) === week).map((e) => ({ clockIn: e.clockIn, clockOut: e.clockOut, breaks: e.breaks as Break[] }));
  const totals = weekTotals(splitWork(thisWeek, tz, holidays, s.rules, now), s.rules);
  return {
    settings: s, tz, hasPin: !!pin, open: open ? { id: open.id, clockIn: open.clockIn, onBreak: (open.breaks as Break[]).some((b) => !b.end), breakMinutes: breakMinutes(open.breaks as Break[], now) } : null,
    shifts: shifts.map((x) => ({ id: x.id, startsAt: x.startsAt, endsAt: x.endsAt, siteId: x.siteId, role: x.role, breakMinutes: x.breakMinutes })),
    entries: entries.map((e) => ({ id: e.id, clockIn: e.clockIn, clockOut: e.clockOut, breakMinutes: breakMinutes(e.breaks as Break[], now), flags: e.flags, siteId: e.siteId })),
    week, totals, contractHours: (await prisma.staffProfile.findUnique({ where: { membershipId: ctx.membership.id } }))?.contractHours ?? null,
    leave: leave.map((l) => ({ id: l.id, kind: l.kind, startsOn: l.startsOn.toISOString().slice(0, 10), endsOn: l.endsOn.toISOString().slice(0, 10), halfDay: l.halfDay, status: l.status, decisionNote: l.decisionNote })),
    swaps: swaps.map((w) => ({ id: w.id, status: w.status, mine: w.fromMembershipId === ctx.membership.id, forMe: w.toMembershipId === ctx.membership.id || (w.toMembershipId === null && w.fromMembershipId !== ctx.membership.id), startsAt: w.shift.startsAt, endsAt: w.shift.endsAt, note: w.note })),
    openShifts: openShifts.map((x) => ({ id: x.id, startsAt: x.startsAt, endsAt: x.endsAt, role: x.role, siteId: x.siteId })),
  };
}

// ── clock ───────────────────────────────────────────────────────────────────

const fmt = (d: Date, tz: string) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);

async function nearestSite(companyId: string, lat: number, lng: number) {
  const a = await prisma.address.findMany({ where: { companyId, isActive: true, latitude: { not: null } }, select: { id: true, latitude: true, longitude: true } });
  return a.map((x) => ({ id: x.id, m: Math.round(haversineKm({ lat, lng }, { lat: Number(x.latitude), lng: Number(x.longitude) }) * 1000) })).sort((p, q) => p.m - q.m)[0] ?? null;
}

async function siteDistance(siteId: string, lat: number, lng: number) {
  const a = await prisma.address.findUnique({ where: { id: siteId }, select: { latitude: true, longitude: true } });
  if (a?.latitude == null || a.longitude == null) return null;
  return Math.round(haversineKm({ lat, lng }, { lat: Number(a.latitude), lng: Number(a.longitude) }) * 1000);
}

/** Clock in / out / break for one member. Returns the entry and what happened. */
async function punch(companyId: string, countryCode: string, membershipId: string, action: Action, via: Source, opts: { siteId?: string | null; lat?: number | null; lng?: number | null; actorUserId: string; s: StaffSettings }) {
  const s = opts.s, now = new Date();
  const open = await prisma.timeEntry.findFirst({ where: { membershipId, clockOut: null } });
  let distance: number | null = null, siteId = opts.siteId ?? null;
  if (via === "PHONE" && s.clock.location && (action === "IN" || action === "OUT")) { // breaks are not located
    if (opts.lat == null || opts.lng == null) throw new ValidationError("Allow your location to clock in from your phone.");
    if (!siteId) siteId = (await nearestSite(companyId, opts.lat, opts.lng))?.id ?? null;
    distance = siteId ? await siteDistance(siteId, opts.lat, opts.lng) : null;
    if (distance != null && distance > s.clock.radiusM && s.clock.outside === "BLOCK") throw new ValidationError(`You are ${distance} m from the site — come within ${s.clock.radiusM} m to clock ${action === "OUT" ? "out" : "in"}.`);
  }
  if (action === "IN") {
    if (open) throw new ValidationError("Already clocked in.");
    if (!siteId) siteId = (await prisma.staffProfile.findUnique({ where: { membershipId } }))?.homeSiteId ?? null;
    const shifts = await prisma.staffShift.findMany({ where: { membershipId, status: "PUBLISHED", startsAt: { lte: new Date(now.getTime() + 2 * 3600_000) }, endsAt: { gte: now } } });
    const shift = matchShift(now, shifts);
    const e = { clockIn: now, clockOut: null, breaks: [] as Break[], inDistanceM: distance };
    const flags = entryFlags(e, shift, s, now).filter((f) => f !== "NO_BREAK");
    return prisma.timeEntry.create({ data: { companyId, membershipId, siteId: siteId ?? shift?.siteId ?? null, shiftId: shift?.id ?? null, clockIn: now, source: via, inDistanceM: distance, flags } });
  }
  if (!open) throw new ValidationError("Not clocked in.");
  const breaks = (open.breaks as Break[]).map((b) => ({ ...b }));
  const onBreak = breaks.some((b) => !b.end);
  if (action === "BREAK_START") {
    if (onBreak) throw new ValidationError("Already on a break.");
    breaks.push({ start: now.toISOString(), end: null });
  } else if (action === "BREAK_END") {
    if (!onBreak) throw new ValidationError("Not on a break.");
    breaks[breaks.length - 1].end = now.toISOString();
  } else {
    for (const b of breaks) if (!b.end) b.end = now.toISOString();
  }
  const clockOut = action === "OUT" ? now : null;
  const shift = open.shiftId ? await prisma.staffShift.findUnique({ where: { id: open.shiftId } }) : null;
  const flags = action === "OUT" ? [...new Set([...open.flags.filter((f) => f === "EDITED" || f === "OUTSIDE_AREA" || f === "LATE" || f === "NO_SHIFT"), ...entryFlags({ clockIn: open.clockIn, clockOut, breaks, inDistanceM: open.inDistanceM, outDistanceM: distance }, shift, s, now)])] : open.flags;
  return prisma.timeEntry.update({ where: { id: open.id }, data: { breaks, breakMinutes: breakMinutes(breaks, now), ...(clockOut ? { clockOut, outSource: via, outDistanceM: distance } : {}), flags } });
}

/** The staff member clocks themselves (phone). */
export async function clockSelf(ctx: Ctx, action: Action, loc: { lat: number | null; lng: number | null; siteId?: string | null }) {
  const s = await ensure(ctx, "clock");
  if (!s.clock.phone) throw new ForbiddenError("Clocking in from a phone is switched off — use the kiosk.");
  const e = await punch(ctx.company.id, ctx.company.countryCode, ctx.membership.id, action, "PHONE", { ...loc, actorUserId: ctx.user.id, s });
  return { action, at: new Date(), flags: e.flags };
}

/** A shared device (kiosk or till): the person types their PIN. */
export async function clockByPin(ctx: Ctx, pin: string, action: Action | "AUTO", siteId: string | null, via: "KIOSK" | "TILL" = "KIOSK") {
  const s = await ensure(ctx, "clock");
  if (!kioskOk(ctx)) throw new ForbiddenError();
  if (via === "KIOSK" && !s.clock.kiosk) throw new ForbiddenError("The kiosk is switched off.");
  if (via === "TILL" && !s.clock.till) throw new ForbiddenError("Clocking in at the till is switched off.");
  if (!/^\d{4,8}$/.test(pin)) throw new ValidationError("Wrong PIN.");
  const pins = await prisma.posPin.findMany({ where: { companyId: ctx.company.id } });
  const hit = pins.find((p) => p.pinHash === pinHash(ctx.company.id, p.userId, pin));
  const m = hit ? await prisma.membership.findFirst({ where: { companyId: ctx.company.id, userId: hit.userId, status: "ACTIVE" }, include: { user: { select: { name: true, email: true } } } }) : null;
  if (!m) throw new ValidationError("Wrong PIN.");
  let a: Action = action === "AUTO" ? "IN" : action;
  if (action === "AUTO") a = (await prisma.timeEntry.findFirst({ where: { membershipId: m.id, clockOut: null } })) ? "OUT" : "IN";
  const e = await punch(ctx.company.id, ctx.company.countryCode, m.id, a, via, { siteId, actorUserId: ctx.user.id, s });
  return { name: nameOfUser(m.user), action: a, at: new Date(), flags: e.flags, inSince: e.clockIn };
}

/** Who is in now (and on a break), with today's shifts not yet started / missed. */
export async function whoIsIn(ctx: Ctx) {
  const s = await ensure(ctx, undefined, true);
  const tz = tzOf(ctx), now = new Date(), today = localParts(now, tz).day;
  const [ppl, shifts, siteList, pendingLeave, pendingSwaps, pendingSheets] = await Promise.all([
    people(ctx),
    prisma.staffShift.findMany({ where: { companyId: ctx.company.id, status: "PUBLISHED", startsAt: { gte: zonedInstant(today, "00:00", tz), lt: zonedInstant(addDays(today, 1), "00:00", tz) } }, orderBy: { startsAt: "asc" } }),
    sites(ctx),
    s.parts.leave ? prisma.leaveRequest.count({ where: { companyId: ctx.company.id, status: "PENDING" } }) : 0,
    s.parts.swaps ? prisma.shiftSwap.count({ where: { companyId: ctx.company.id, status: { in: ["PENDING", "ACCEPTED"] } } }) : 0,
    s.parts.timesheets ? prisma.timesheet.count({ where: { companyId: ctx.company.id, status: "SUBMITTED" } }) : 0,
  ]);
  const flagged = await prisma.timeEntry.findMany({ where: { companyId: ctx.company.id, clockIn: { gte: new Date(now.getTime() - 7 * DAY) }, flags: { hasSome: ["LATE", "EARLY_LEAVE", "OUTSIDE_AREA", "MISSED_CLOCK_OUT", "NO_BREAK"] } }, orderBy: { clockIn: "desc" }, take: 20 });
  const name = new Map(ppl.map((p) => [p.membershipId, p.name])), site = new Map(siteList.map((x) => [x.id, x.label]));
  const entered = new Set((await prisma.timeEntry.findMany({ where: { companyId: ctx.company.id, clockIn: { gte: zonedInstant(today, "00:00", tz) } }, select: { membershipId: true } })).map((e) => e.membershipId));
  return {
    settings: s, tz,
    inNow: ppl.filter((p) => p.inSince).map((p) => ({ name: p.name, since: p.inSince!, onBreak: p.onBreak, site: p.siteId ? site.get(p.siteId) ?? null : null })),
    today: shifts.map((x) => ({ id: x.id, name: x.membershipId ? name.get(x.membershipId) ?? "?" : null, startsAt: x.startsAt, endsAt: x.endsAt, site: x.siteId ? site.get(x.siteId) ?? null : null, role: x.role, state: x.membershipId && entered.has(x.membershipId) ? "IN" : x.startsAt.getTime() + s.clock.lateGraceMin * 60000 < now.getTime() ? "MISSING" : "LATER" })),
    flagged: flagged.map((e) => ({ id: e.id, name: name.get(e.membershipId) ?? "?", clockIn: e.clockIn, clockOut: e.clockOut, flags: e.flags })),
    pending: { leave: pendingLeave, swaps: pendingSwaps, timesheets: pendingSheets }, staff: ppl.filter((p) => p.active).length,
  };
}

// ── corrections & timesheets ────────────────────────────────────────────────

async function locked(companyId: string, membershipId: string, at: Date, tz: string) {
  const t = await prisma.timesheet.findUnique({ where: { membershipId_weekStart: { membershipId, weekStart: toDate(weekStartOf(at, tz)) } } });
  return t?.status === "APPROVED";
}

/** A manager adds or corrects an entry — a reason is required; it is flagged EDITED and audited. */
export async function saveEntry(ctx: Ctx, i: { id?: string | null; membershipId: string; day: string; in: string; out: string | null; breakMinutes: number; siteId: string | null; reason: string }) {
  const s = await ensure(ctx, "clock", true);
  const tz = tzOf(ctx);
  if (!i.reason?.trim() || i.reason.trim().length < 3) throw new ValidationError("Say why you change the time (it is kept in the record).");
  if (!(await prisma.membership.findFirst({ where: { id: i.membershipId, companyId: ctx.company.id } }))) throw new NotFoundError("Staff member");
  const clockIn = zonedInstant(i.day, i.in, tz);
  let clockOut = i.out ? zonedInstant(i.day, i.out, tz) : null;
  if (clockOut && clockOut <= clockIn) clockOut = zonedInstant(addDays(i.day, 1), i.out!, tz);
  if (clockOut && clockOut.getTime() - clockIn.getTime() > 24 * 3600_000) throw new ValidationError("An entry is at most 24 hours.");
  if (clockIn > new Date()) throw new ValidationError("That time is in the future.");
  if (await locked(ctx.company.id, i.membershipId, clockIn, tz)) throw new ValidationError("That week's timesheet is approved — reopen it first.");
  const bm = Math.max(0, Math.round(i.breakMinutes || 0));
  const breaks: Break[] = bm && clockOut ? [{ start: new Date(clockIn.getTime() + 60000).toISOString(), end: new Date(clockIn.getTime() + 60000 + bm * 60000).toISOString() }] : [];
  const shift = matchShift(clockIn, await prisma.staffShift.findMany({ where: { membershipId: i.membershipId, status: "PUBLISHED", startsAt: { lte: new Date(clockIn.getTime() + 2 * 3600_000) }, endsAt: { gte: clockIn } } }));
  const flags = [...new Set([...entryFlags({ clockIn, clockOut, breaks }, shift, { ...s, clock: { ...s.clock, location: false } }), "EDITED"])];
  const data = { clockIn, clockOut, breaks, breakMinutes: bm, siteId: i.siteId || null, shiftId: shift?.id ?? null, flags, editedById: ctx.user.id, editedAt: new Date(), editReason: i.reason.trim() };
  let id = i.id ?? null, before: unknown = null;
  if (id) {
    const old = await prisma.timeEntry.findFirst({ where: { id, companyId: ctx.company.id } });
    if (!old) throw new NotFoundError("Entry");
    if (await locked(ctx.company.id, old.membershipId, old.clockIn, tz)) throw new ValidationError("That week's timesheet is approved — reopen it first.");
    before = { clockIn: old.clockIn, clockOut: old.clockOut, breakMinutes: old.breakMinutes };
    await prisma.timeEntry.update({ where: { id }, data });
  } else id = (await prisma.timeEntry.create({ data: { companyId: ctx.company.id, membershipId: i.membershipId, source: "MANAGER", outSource: clockOut ? "MANAGER" : null, ...data } })).id;
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: i.id ? "staff.entry_edited" : "staff.entry_added", entityType: "TimeEntry", entityId: id, before, after: { clockIn, clockOut, breakMinutes: bm, reason: i.reason.trim() } });
  return { id };
}

export async function deleteEntry(ctx: Ctx, id: string, reason: string) {
  await ensure(ctx, "clock", true);
  if (!reason?.trim()) throw new ValidationError("Say why you remove it.");
  const e = await prisma.timeEntry.findFirst({ where: { id, companyId: ctx.company.id } });
  if (!e) throw new NotFoundError("Entry");
  if (await locked(ctx.company.id, e.membershipId, e.clockIn, tzOf(ctx))) throw new ValidationError("That week's timesheet is approved — reopen it first.");
  await prisma.timeEntry.delete({ where: { id } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "staff.entry_deleted", entityType: "TimeEntry", entityId: id, before: { clockIn: e.clockIn, clockOut: e.clockOut }, after: { reason } });
}

/** The week's hours per person (live from the entries, or as approved). */
export async function timesheetWeek(ctx: Ctx, week: string | null, membershipId?: string | null) {
  const s = await ensure(ctx, "timesheets");
  const manager = isManager(ctx);
  if (!manager) membershipId = ctx.membership.id;
  const tz = tzOf(ctx), start = week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? weekStartOf(new Date(`${week}T12:00:00Z`), tz) : weekStartOf(new Date(), tz);
  const from = zonedInstant(start, "00:00", tz), to = zonedInstant(addDays(start, 7), "00:00", tz);
  const [ppl, entries, sheets, leave, holidays] = await Promise.all([
    people(ctx),
    prisma.timeEntry.findMany({ where: { companyId: ctx.company.id, clockIn: { gte: from, lt: to }, ...(membershipId ? { membershipId } : {}) }, orderBy: { clockIn: "asc" } }),
    prisma.timesheet.findMany({ where: { companyId: ctx.company.id, weekStart: toDate(start), ...(membershipId ? { membershipId } : {}) } }),
    prisma.leaveRequest.findMany({ where: { companyId: ctx.company.id, status: "APPROVED", startsOn: { lte: toDate(addDays(start, 6)) }, endsOn: { gte: toDate(start) }, ...(membershipId ? { membershipId } : {}) } }),
    holidaysFor(ctx.company.countryId, start, addDays(start, 6)),
  ]);
  const sheetOf = new Map(sheets.map((x) => [x.membershipId, x]));
  const rows = ppl.filter((p) => (membershipId ? p.membershipId === membershipId : p.active || entries.some((e) => e.membershipId === p.membershipId))).map((p) => {
    const mine = entries.filter((e) => e.membershipId === p.membershipId);
    const live = weekTotals(splitWork(mine.map((e) => ({ clockIn: e.clockIn, clockOut: e.clockOut, breaks: e.breaks as Break[] })), tz, holidays, s.rules), s.rules);
    const lv = leave.filter((l) => l.membershipId === p.membershipId).reduce((a, l) => {
      const a0 = l.startsOn.toISOString().slice(0, 10) < start ? start : l.startsOn.toISOString().slice(0, 10), b0 = l.endsOn.toISOString().slice(0, 10) > addDays(start, 6) ? addDays(start, 6) : l.endsOn.toISOString().slice(0, 10);
      return a + leaveDays(a0, b0, holidays, l.halfDay);
    }, 0);
    const sh = sheetOf.get(p.membershipId);
    const t = sh?.status === "APPROVED" ? { minutes: sh.minutes, overtimeMinutes: sh.overtimeMinutes, nightMinutes: sh.nightMinutes, holidayMinutes: sh.holidayMinutes } : live;
    return {
      membershipId: p.membershipId, name: p.name, role: p.role, contractHours: p.contractHours, hourlyRate: p.hourlyRate, status: sh?.status ?? "OPEN", ...t, leaveDays: sh?.status === "APPROVED" ? Number(sh.leaveDays) : lv,
      openEntries: mine.filter((e) => !e.clockOut).length, flags: [...new Set(mine.flatMap((e) => e.flags))],
      entries: mine.map((e) => ({ id: e.id, clockIn: e.clockIn, clockOut: e.clockOut, breakMinutes: breakMinutes(e.breaks as Break[]), flags: e.flags, source: e.source, editReason: e.editReason, siteId: e.siteId })),
      cost: p.hourlyRate != null ? Math.round((t.minutes / 60) * p.hourlyRate * 100) / 100 : null,
    };
  });
  return { week: start, days: Array.from({ length: 7 }, (_, i) => addDays(start, i)), tz, manager, rows, settings: s };
}

export async function submitTimesheet(ctx: Ctx, week: string) {
  const s = await ensure(ctx, "timesheets");
  const tz = tzOf(ctx), start = weekStartOf(new Date(`${week}T12:00:00Z`), tz);
  const t = await prisma.timesheet.findUnique({ where: { membershipId_weekStart: { membershipId: ctx.membership.id, weekStart: toDate(start) } } });
  if (t?.status === "APPROVED") throw new ValidationError("Already approved.");
  if (await prisma.timeEntry.count({ where: { membershipId: ctx.membership.id, clockOut: null, clockIn: { lt: zonedInstant(addDays(start, 7), "00:00", tz) } } })) throw new ValidationError("Clock out first.");
  await prisma.timesheet.upsert({ where: { membershipId_weekStart: { membershipId: ctx.membership.id, weekStart: toDate(start) } }, create: { companyId: ctx.company.id, membershipId: ctx.membership.id, weekStart: toDate(start), status: "SUBMITTED", submittedAt: new Date() }, update: { status: "SUBMITTED", submittedAt: new Date() } });
  if (s.approvals.timesheets) await notify("staff.timesheet_submitted", [{ companyId: ctx.company.id, link: link(ctx.company.type, `/staff/timesheets?week=${start}`) }], { name: ctx.user.name || ctx.user.email, week: start }).catch(() => null);
}

/** A manager approves a person's week: the totals are kept and the week's entries are locked. */
export async function approveTimesheet(ctx: Ctx, membershipId: string, week: string) {
  await ensure(ctx, "timesheets", true);
  const r = await timesheetWeek(ctx, week, membershipId);
  const row = r.rows[0];
  if (!row) throw new NotFoundError("Staff member");
  if (row.openEntries) throw new ValidationError("Someone is still clocked in that week — close the entry first.");
  const data = { status: "APPROVED" as const, minutes: row.minutes, overtimeMinutes: row.overtimeMinutes, nightMinutes: row.nightMinutes, holidayMinutes: row.holidayMinutes, leaveDays: row.leaveDays.toFixed(1), approvedById: ctx.user.id, approvedAt: new Date() };
  await prisma.timesheet.upsert({ where: { membershipId_weekStart: { membershipId, weekStart: toDate(r.week) } }, create: { companyId: ctx.company.id, membershipId, weekStart: toDate(r.week), ...data }, update: data });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "staff.timesheet_approved", entityType: "Membership", entityId: membershipId, after: { week: r.week, ...data } });
  await tellMembers("staff.timesheet_approved", [membershipId], "/staff/me", { week: r.week });
}

export async function reopenTimesheet(ctx: Ctx, membershipId: string, week: string) {
  await ensure(ctx, "timesheets", true);
  const start = weekStartOf(new Date(`${week}T12:00:00Z`), tzOf(ctx));
  await prisma.timesheet.updateMany({ where: { companyId: ctx.company.id, membershipId, weekStart: toDate(start) }, data: { status: "OPEN", approvedAt: null, approvedById: null } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "staff.timesheet_reopened", entityType: "Membership", entityId: membershipId, after: { week: start } });
}

/** Payroll export (per person) or the legal time record (every entry), CSV, for a period of local days. */
export async function exportRows(ctx: Ctx, kind: "PAYROLL" | "RECORD", fromDay: string, toDay: string) {
  const s = await ensure(ctx, "timesheets", true);
  const tz = tzOf(ctx);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDay) || !/^\d{4}-\d{2}-\d{2}$/.test(toDay) || fromDay > toDay) throw new ValidationError("Check the dates.");
  if ((toDate(toDay).getTime() - toDate(fromDay).getTime()) / DAY > 400) throw new ValidationError("At most about a year at a time.");
  const from = zonedInstant(fromDay, "00:00", tz), to = zonedInstant(addDays(toDay, 1), "00:00", tz);
  const [ppl, entries, holidays, leave, siteList] = await Promise.all([
    people(ctx), prisma.timeEntry.findMany({ where: { companyId: ctx.company.id, clockIn: { gte: from, lt: to } }, orderBy: [{ membershipId: "asc" }, { clockIn: "asc" }] }),
    holidaysFor(ctx.company.countryId, fromDay, toDay),
    prisma.leaveRequest.findMany({ where: { companyId: ctx.company.id, status: "APPROVED", startsOn: { lte: toDate(toDay) }, endsOn: { gte: toDate(fromDay) } } }),
    sites(ctx),
  ]);
  const name = new Map(ppl.map((p) => [p.membershipId, p])), site = new Map(siteList.map((x) => [x.id, x.label]));
  const t = (d: Date | null) => (d ? new Intl.DateTimeFormat("sv-SE", { timeZone: tz, dateStyle: "short", timeStyle: "short" }).format(d) : "");
  if (kind === "RECORD") {
    const head = ["Staff", "Payroll code", "Date", "Clock in", "Clock out", "Break (min)", "Worked (min)", "Site", "In via", "Out via", "Flags", "Edited by manager", "Reason"];
    const rows = entries.map((e) => {
      const p = name.get(e.membershipId), bm = breakMinutes(e.breaks as Break[]);
      const worked = e.clockOut ? Math.round((e.clockOut.getTime() - e.clockIn.getTime()) / 60000) - bm : "";
      return [p?.name ?? "?", p?.payrollCode ?? "", localParts(e.clockIn, tz).day, t(e.clockIn), t(e.clockOut), bm, worked, e.siteId ? site.get(e.siteId) ?? "" : "", e.source, e.outSource ?? "", e.flags.join(" "), e.editedAt ? "yes" : "", e.editReason ?? ""];
    });
    return { head, rows, filename: `time-record-${fromDay}-${toDay}.csv` };
  }
  const head = ["Staff", "Payroll code", "Role", "Regular hours", "Overtime hours", "Night hours", "Public holiday hours", "Holiday days", "Sick days", "Unpaid days", "Other leave days", "Hourly rate", "Gross (estimate)", "Flags"];
  const rows = ppl.filter((p) => entries.some((e) => e.membershipId === p.membershipId) || leave.some((l) => l.membershipId === p.membershipId)).map((p) => {
    const mine = entries.filter((e) => e.membershipId === p.membershipId).map((e) => ({ clockIn: e.clockIn, clockOut: e.clockOut, breaks: e.breaks as Break[] }));
    // overtime is counted week by week
    const weeks = new Map<string, typeof mine>();
    for (const e of mine) { const w = weekStartOf(e.clockIn, tz); weeks.set(w, [...(weeks.get(w) ?? []), e]); }
    let minutes = 0, ot = 0, night = 0, hol = 0;
    for (const list of weeks.values()) { const x = weekTotals(splitWork(list, tz, holidays, s.rules), s.rules); minutes += x.minutes; ot += x.overtimeMinutes; night += x.nightMinutes; hol += x.holidayMinutes; }
    const lv = (k: LeaveKindT) => leave.filter((l) => l.membershipId === p.membershipId && l.kind === k).reduce((a, l) => a + leaveDays(l.startsOn.toISOString().slice(0, 10) < fromDay ? fromDay : l.startsOn.toISOString().slice(0, 10), l.endsOn.toISOString().slice(0, 10) > toDay ? toDay : l.endsOn.toISOString().slice(0, 10), holidays, l.halfDay), 0);
    const h = (m: number) => (m / 60).toFixed(2);
    const flags = [...new Set(entries.filter((e) => e.membershipId === p.membershipId).flatMap((e) => e.flags))].join(" ");
    return [p.name, p.payrollCode ?? "", p.role ?? "", h(minutes - ot), h(ot), h(night), h(hol), lv("HOLIDAY"), lv("SICK"), lv("UNPAID"), lv("OTHER"), p.hourlyRate ?? "", p.hourlyRate != null ? ((minutes / 60) * p.hourlyRate).toFixed(2) : "", flags];
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "staff.payroll_exported", entityType: "Company", entityId: ctx.company.id, after: { fromDay, toDay } });
  return { head, rows, filename: `payroll-${fromDay}-${toDay}.csv` };
}

// ── leave & swaps ───────────────────────────────────────────────────────────

export async function requestLeave(ctx: Ctx, i: { kind: LeaveKindT; startsOn: string; endsOn: string; halfDay: boolean; reason: string | null }) {
  const s = await ensure(ctx, "leave");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.startsOn) || !/^\d{4}-\d{2}-\d{2}$/.test(i.endsOn) || i.endsOn < i.startsOn) throw new ValidationError("Check the dates.");
  if ((toDate(i.endsOn).getTime() - toDate(i.startsOn).getTime()) / DAY > 90) throw new ValidationError("At most 90 days at a time.");
  if (i.halfDay && i.startsOn !== i.endsOn) throw new ValidationError("A half day is one day.");
  const clash = await prisma.leaveRequest.findFirst({ where: { membershipId: ctx.membership.id, status: { in: ["PENDING", "APPROVED"] }, startsOn: { lte: toDate(i.endsOn) }, endsOn: { gte: toDate(i.startsOn) } } });
  if (clash) throw new ValidationError("You already asked for these days.");
  const auto = !s.approvals.leave;
  const r = await prisma.leaveRequest.create({ data: { companyId: ctx.company.id, membershipId: ctx.membership.id, kind: i.kind, startsOn: toDate(i.startsOn), endsOn: toDate(i.endsOn), halfDay: i.halfDay, reason: i.reason?.trim() || null, status: auto ? "APPROVED" : "PENDING", decidedAt: auto ? new Date() : null } });
  if (!auto) await notify("staff.leave_requested", [{ companyId: ctx.company.id, link: link(ctx.company.type, "/staff/leave") }], { name: ctx.user.name || ctx.user.email, from: i.startsOn, to: i.endsOn }).catch(() => null);
  return r;
}

export async function decideLeave(ctx: Ctx, id: string, approve: boolean, note: string | null) {
  await ensure(ctx, "leave", true);
  const r = await prisma.leaveRequest.findFirst({ where: { id, companyId: ctx.company.id, status: "PENDING" } });
  if (!r) throw new NotFoundError("Request");
  if (!approve && !note?.trim()) throw new ValidationError("Say why (the person sees it).");
  await prisma.leaveRequest.update({ where: { id }, data: { status: approve ? "APPROVED" : "REJECTED", decidedById: ctx.user.id, decidedAt: new Date(), decisionNote: note?.trim() || null } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: approve ? "staff.leave_approved" : "staff.leave_rejected", entityType: "LeaveRequest", entityId: id, after: { note } });
  await tellMembers("staff.leave_decided", [r.membershipId], "/staff/me", { from: r.startsOn.toISOString().slice(0, 10), to: r.endsOn.toISOString().slice(0, 10), decision: approve ? "✓" : "✗", note: note ?? "" });
}

export async function cancelLeave(ctx: Ctx, id: string) {
  await ensure(ctx, "leave");
  const r = await prisma.leaveRequest.findFirst({ where: { id, membershipId: ctx.membership.id, status: { in: ["PENDING", "APPROVED"] } } });
  if (!r) throw new NotFoundError("Request");
  if (r.status === "APPROVED" && r.startsOn <= toDate(localParts(new Date(), tzOf(ctx)).day)) throw new ValidationError("It has started — ask your manager.");
  await prisma.leaveRequest.update({ where: { id }, data: { status: "CANCELLED" } });
}

export async function leaveList(ctx: Ctx) {
  await ensure(ctx, "leave", true);
  const [rows, ppl] = await Promise.all([prisma.leaveRequest.findMany({ where: { companyId: ctx.company.id, endsOn: { gte: new Date(Date.now() - 60 * DAY) } }, orderBy: [{ status: "asc" }, { startsOn: "asc" }], take: 200 }), people(ctx)]);
  const name = new Map(ppl.map((p) => [p.membershipId, p.name]));
  const holidays = await holidaysFor(ctx.company.countryId, localParts(new Date(Date.now() - 60 * DAY), tzOf(ctx)).day, localParts(new Date(Date.now() + 400 * DAY), tzOf(ctx)).day);
  return rows.map((r) => ({ id: r.id, name: name.get(r.membershipId) ?? "?", kind: r.kind, startsOn: r.startsOn.toISOString().slice(0, 10), endsOn: r.endsOn.toISOString().slice(0, 10), halfDay: r.halfDay, days: leaveDays(r.startsOn.toISOString().slice(0, 10), r.endsOn.toISOString().slice(0, 10), holidays, r.halfDay), reason: r.reason, status: r.status, decisionNote: r.decisionNote }));
}

/** Offer my shift to a colleague (or to anyone). */
export async function requestSwap(ctx: Ctx, shiftId: string, toMembershipId: string | null, note: string | null) {
  await ensure(ctx, "swaps");
  const x = await prisma.staffShift.findFirst({ where: { id: shiftId, companyId: ctx.company.id, membershipId: ctx.membership.id, status: "PUBLISHED", startsAt: { gt: new Date() } } });
  if (!x) throw new NotFoundError("Shift");
  if (toMembershipId && (toMembershipId === ctx.membership.id || !(await prisma.membership.findFirst({ where: { id: toMembershipId, companyId: ctx.company.id, status: "ACTIVE" } })))) throw new ValidationError("Choose a colleague.");
  if (await prisma.shiftSwap.findFirst({ where: { shiftId, status: { in: ["PENDING", "ACCEPTED"] } } })) throw new ValidationError("You already offered this shift.");
  const w = await prisma.shiftSwap.create({ data: { companyId: ctx.company.id, shiftId, fromMembershipId: ctx.membership.id, toMembershipId, note: note?.trim() || null } });
  const tz = tzOf(ctx);
  if (toMembershipId) await tellMembers("staff.swap_requested", [toMembershipId], "/staff/me", { name: ctx.user.name || ctx.user.email, start: fmt(x.startsAt, tz) });
  return w;
}

/** A colleague takes the offered shift; with approval on, the manager confirms. */
export async function acceptSwap(ctx: Ctx, id: string) {
  const s = await ensure(ctx, "swaps");
  const w = await prisma.shiftSwap.findFirst({ where: { id, companyId: ctx.company.id, status: "PENDING", fromMembershipId: { not: ctx.membership.id }, OR: [{ toMembershipId: ctx.membership.id }, { toMembershipId: null }] }, include: { shift: true } });
  if (!w || w.shift.startsAt <= new Date()) throw new NotFoundError("Swap");
  if (!s.approvals.swaps) {
    await prisma.$transaction([prisma.shiftSwap.update({ where: { id }, data: { toMembershipId: ctx.membership.id, status: "APPROVED", acceptedAt: new Date(), decidedAt: new Date() } }), prisma.staffShift.update({ where: { id: w.shiftId }, data: { membershipId: ctx.membership.id, remindedAt: null } })]);
    await tellMembers("staff.swap_decided", [w.fromMembershipId], "/staff/me", { start: fmt(w.shift.startsAt, tzOf(ctx)), decision: "✓" });
    return { status: "APPROVED" };
  }
  await prisma.shiftSwap.update({ where: { id }, data: { toMembershipId: ctx.membership.id, status: "ACCEPTED", acceptedAt: new Date() } });
  await notify("staff.swap_to_approve", [{ companyId: ctx.company.id, link: link(ctx.company.type, "/staff/leave") }], { name: ctx.user.name || ctx.user.email, start: fmt(w.shift.startsAt, tzOf(ctx)) }).catch(() => null);
  return { status: "ACCEPTED" };
}

export async function decideSwap(ctx: Ctx, id: string, approve: boolean, note: string | null) {
  await ensure(ctx, "swaps", true);
  const w = await prisma.shiftSwap.findFirst({ where: { id, companyId: ctx.company.id, status: { in: ["PENDING", "ACCEPTED"] } }, include: { shift: true } });
  if (!w) throw new NotFoundError("Swap");
  if (approve && !w.toMembershipId) throw new ValidationError("Nobody has taken this shift yet.");
  await prisma.$transaction([
    prisma.shiftSwap.update({ where: { id }, data: { status: approve ? "APPROVED" : "REJECTED", decidedById: ctx.user.id, decidedAt: new Date(), decisionNote: note?.trim() || null } }),
    ...(approve ? [prisma.staffShift.update({ where: { id: w.shiftId }, data: { membershipId: w.toMembershipId, remindedAt: null } })] : []),
  ]);
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: approve ? "staff.swap_approved" : "staff.swap_rejected", entityType: "ShiftSwap", entityId: id, after: { note } });
  await tellMembers("staff.swap_decided", [w.fromMembershipId, ...(w.toMembershipId ? [w.toMembershipId] : [])], "/staff/me", { start: fmt(w.shift.startsAt, tzOf(ctx)), decision: approve ? "✓" : "✗" });
}

export async function swapList(ctx: Ctx) {
  await ensure(ctx, "swaps", true);
  const [rows, ppl] = await Promise.all([prisma.shiftSwap.findMany({ where: { companyId: ctx.company.id, createdAt: { gte: new Date(Date.now() - 60 * DAY) } }, include: { shift: true }, orderBy: { createdAt: "desc" }, take: 100 }), people(ctx)]);
  const name = new Map(ppl.map((p) => [p.membershipId, p.name]));
  return rows.map((w) => ({ id: w.id, from: name.get(w.fromMembershipId) ?? "?", to: w.toMembershipId ? name.get(w.toMembershipId) ?? "?" : null, startsAt: w.shift.startsAt, endsAt: w.shift.endsAt, status: w.status, note: w.note }));
}

// ── labour cost against sales ───────────────────────────────────────────────

/** Per local day: hours worked, labour cost (hours × rate), sales (till sales for shops; delivered sales for suppliers). */
export async function labourReport(ctx: Ctx, days = 14) {
  const s = await ensure(ctx, "labour", true);
  const tz = tzOf(ctx), today = localParts(new Date(), tz).day, first = addDays(today, -(days - 1));
  const from = zonedInstant(first, "00:00", tz);
  const [ppl, entries] = await Promise.all([people(ctx), prisma.timeEntry.findMany({ where: { companyId: ctx.company.id, clockIn: { gte: from } } })]);
  const rate = new Map(ppl.map((p) => [p.membershipId, p.hourlyRate ?? 0]));
  const out = new Map<string, { minutes: number; cost: number; sales: number }>();
  for (let i = 0; i < days; i++) out.set(addDays(first, i), { minutes: 0, cost: 0, sales: 0 });
  for (const e of entries) for (const [day, d] of splitWork([{ clockIn: e.clockIn, clockOut: e.clockOut, breaks: e.breaks as Break[] }], tz, new Set(), s.rules)) {
    const o = out.get(day); if (!o) continue;
    o.minutes += d.worked; o.cost += (d.worked / 60) * (rate.get(e.membershipId) ?? 0);
  }
  const sales = ctx.company.type === "CUSTOMER" || ctx.company.type === "WHOLESALER"
    ? await prisma.posSale.findMany({ where: { companyId: ctx.company.id, soldAt: { gte: from }, status: "COMPLETED" }, select: { soldAt: true, gross: true } })
    : [];
  for (const x of sales) { const o = out.get(localParts(x.soldAt, tz).day); if (o) o.sales += Number(x.gross); }
  if (ctx.company.type === "WHOLESALER" || ctx.company.type === "DISTRIBUTOR") {
    const orders = await prisma.order.findMany({ where: { sellerCompanyId: ctx.company.id, status: "DELIVERED", co2At: { gte: from } }, select: { co2At: true, netTotal: true } }).catch(() => [] as { co2At: Date | null; netTotal: unknown }[]);
    for (const o of orders) { const d = o.co2At ? out.get(localParts(o.co2At, tz).day) : null; if (d) d.sales += Number(o.netTotal); }
  }
  const rows = [...out.entries()].map(([day, v]) => ({ day, minutes: v.minutes, cost: Math.round(v.cost * 100) / 100, sales: Math.round(v.sales * 100) / 100, share: labourShare(v.cost, v.sales) }));
  const tot = rows.reduce((a, r) => ({ minutes: a.minutes + r.minutes, cost: a.cost + r.cost, sales: a.sales + r.sales }), { minutes: 0, cost: 0, sales: 0 });
  return { rows, total: { ...tot, cost: Math.round(tot.cost * 100) / 100, sales: Math.round(tot.sales * 100) / 100, share: labourShare(tot.cost, tot.sales) }, ratesMissing: ppl.filter((p) => p.active && p.hourlyRate == null).length };
}

// ── notifications & the job ─────────────────────────────────────────────────

async function tellMembers(event: string, membershipIds: string[], path: string, vars: Record<string, string>) {
  if (!membershipIds.length) return;
  const m = await prisma.membership.findMany({ where: { id: { in: membershipIds } }, select: { userId: true, company: { select: { type: true } } } });
  for (const x of m) {
    await notify(event, [{ userId: x.userId, link: link(x.company.type, path) }], vars).catch(() => null);
  }
}

/** Every 15 minutes: shift reminders, missed clock-outs (remind, then close), no-shows, and old records removed. */
export async function runStaffJob(now = new Date()) {
  const s = await staffSettings();
  const out = { reminded: 0, clockOutReminders: 0, autoClosed: 0, noShows: 0, purged: 0 };
  if (!s.enabled) return out;
  if (s.parts.rota && s.reminders.shiftBeforeMin > 0) {
    const soon = await prisma.staffShift.findMany({ where: { status: "PUBLISHED", membershipId: { not: null }, remindedAt: null, startsAt: { gt: now, lte: new Date(now.getTime() + s.reminders.shiftBeforeMin * 60000) } }, include: { membership: { select: { company: { select: { country: { select: { code: true } } } } } } }, take: 500 });
    for (const x of soon) {
      await tellMembers("staff.shift_reminder", [x.membershipId!], "/staff/me", { start: fmt(x.startsAt, zoneOf(x.membership?.company.country.code)) });
      await prisma.staffShift.update({ where: { id: x.id }, data: { remindedAt: now } });
      out.reminded++;
    }
    // no-shows: a published shift started (after the grace) and nobody of it clocked in
    const started = await prisma.staffShift.findMany({ where: { status: "PUBLISHED", membershipId: { not: null }, noShowAt: null, startsAt: { lte: new Date(now.getTime() - Math.max(15, s.clock.lateGraceMin) * 60000), gte: new Date(now.getTime() - 6 * 3600_000) } }, take: 500 });
    for (const x of started) {
      const came = await prisma.timeEntry.count({ where: { membershipId: x.membershipId!, clockIn: { gte: new Date(x.startsAt.getTime() - 2 * 3600_000), lte: x.endsAt } } });
      await prisma.staffShift.update({ where: { id: x.id }, data: { noShowAt: now } });
      if (came) continue;
      const m = await prisma.membership.findUnique({ where: { id: x.membershipId! }, select: { user: { select: { name: true, email: true } }, company: { select: { type: true, country: { select: { code: true } } } } } });
      await notify("staff.no_show", [{ companyId: x.companyId, link: link(m?.company.type ?? "CUSTOMER", "/staff") }], { name: m ? nameOfUser(m.user) : "?", start: fmt(x.startsAt, zoneOf(m?.company.country.code)) }).catch(() => null);
      out.noShows++;
    }
  }
  if (s.parts.clock) {
    const open = await prisma.timeEntry.findMany({ where: { clockOut: null }, include: { shift: true }, take: 2000 });
    for (const e of open) {
      const ended = e.shift?.endsAt ?? new Date(e.clockIn.getTime() + 8 * 3600_000);
      if (now.getTime() - e.clockIn.getTime() >= s.clock.autoCloseAfterH * 3600_000) {
        const who = await prisma.membership.findUnique({ where: { id: e.membershipId }, select: { user: { select: { name: true, email: true } }, company: { select: { type: true } } } });
        const clockOut = new Date(Math.min(now.getTime(), Math.max(ended.getTime(), e.clockIn.getTime() + 60000)));
        const breaks = (e.breaks as Break[]).map((b) => ({ ...b, end: b.end ?? clockOut.toISOString() }));
        await prisma.timeEntry.update({ where: { id: e.id }, data: { clockOut, outSource: "AUTO", breaks, breakMinutes: breakMinutes(breaks, clockOut), flags: [...new Set([...e.flags, "MISSED_CLOCK_OUT"])] } });
        await notify("staff.missed_clock_out", [{ companyId: e.companyId, link: link(who?.company.type ?? "CUSTOMER", "/staff/timesheets") }], { name: who ? nameOfUser(who.user) : "?" }).catch(() => null);
        out.autoClosed++;
      } else if (!e.remindedAt && now.getTime() - ended.getTime() >= s.clock.missedReminderMin * 60000) {
        await tellMembers("staff.clock_out_reminder", [e.membershipId], "/staff/me", {});
        await prisma.timeEntry.update({ where: { id: e.id }, data: { remindedAt: now } });
        out.clockOutReminders++;
      }
    }
  }
  // records are kept the legal time, then removed (GDPR)
  const cut = new Date(now.getTime() - s.keepYears * 366 * DAY);
  out.purged = (await prisma.timeEntry.deleteMany({ where: { clockIn: { lt: cut } } })).count;
  await prisma.timesheet.deleteMany({ where: { weekStart: { lt: cut } } });
  await prisma.staffShift.deleteMany({ where: { endsAt: { lt: cut } } });
  return out;
}

// ── FIRINGI overview & holidays ─────────────────────────────────────────────

export async function adminOverview(ctx: Ctx) {
  firingiAdmin(ctx);
  const weekAgo = new Date(Date.now() - 7 * DAY);
  const [profiles, entries, inNow, companies] = await Promise.all([
    prisma.staffProfile.count({ where: { active: true } }),
    prisma.timeEntry.count({ where: { clockIn: { gte: weekAgo } } }),
    prisma.timeEntry.count({ where: { clockOut: null } }),
    prisma.timeEntry.groupBy({ by: ["companyId"], where: { clockIn: { gte: weekAgo } }, _count: { _all: true }, orderBy: { _count: { companyId: "desc" } }, take: 20 }),
  ]);
  const names = await prisma.company.findMany({ where: { id: { in: companies.map((c) => c.companyId) } }, select: { id: true, legalName: true, tradeName: true, type: true } });
  const nm = new Map(names.map((c) => [c.id, c]));
  return { profiles, entries, inNow, companies: companies.map((c) => ({ id: c.companyId, name: nm.get(c.companyId)?.tradeName ?? nm.get(c.companyId)?.legalName ?? "?", type: nm.get(c.companyId)?.type ?? "", entries: c._count._all })) };
}

export async function holidayList(ctx: Ctx, countryId: string | null, year: number) {
  firingiAdmin(ctx);
  const countries = await prisma.country.findMany({ select: { id: true, code: true, name: true }, orderBy: { code: "asc" } });
  const c = countries.find((x) => x.id === countryId) ?? countries.find((x) => x.code === "PT") ?? countries[0];
  const rows = c ? await prisma.publicHoliday.findMany({ where: { countryId: c.id, date: { gte: toDate(`${year}-01-01`), lte: toDate(`${year}-12-31`) } }, orderBy: { date: "asc" } }) : [];
  return { countries, countryId: c?.id ?? null, rows: rows.map((r) => ({ id: r.id, date: r.date.toISOString().slice(0, 10), name: r.name })) };
}

export async function saveHoliday(ctx: Ctx, countryId: string, date: string, name: string) {
  firingiAdmin(ctx);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !name?.trim()) throw new ValidationError("A date and a name.");
  await prisma.publicHoliday.upsert({ where: { countryId_date: { countryId, date: toDate(date) } }, create: { countryId, date: toDate(date), name: name.trim() }, update: { name: name.trim() } });
}

export async function deleteHoliday(ctx: Ctx, id: string) {
  firingiAdmin(ctx);
  await prisma.publicHoliday.deleteMany({ where: { id } });
}

/** Fill a country's national public holidays for a year (kept ones stay; regional ones are added by hand). */
export async function fillHolidays(ctx: Ctx, countryId: string, year: number) {
  firingiAdmin(ctx);
  const c = await prisma.country.findUnique({ where: { id: countryId }, select: { code: true } });
  if (!c) throw new NotFoundError("Country");
  if (!(year >= 2020 && year <= 2100)) throw new ValidationError("Check the year.");
  const list = nationalHolidays(c.code, year);
  if (!list.length) throw new ValidationError("FIRINGI has no national list for this country — add the days by hand.");
  const r = await prisma.publicHoliday.createMany({ data: list.map((h) => ({ countryId, date: toDate(h.date), name: h.name })), skipDuplicates: true });
  return { added: r.count, total: list.length };
}
