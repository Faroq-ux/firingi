/**
 * Phase 52: staff shifts & time — FIRINGI's switches; staff profiles and the clock PIN (the till's); the rota (drafts
 * unseen until published, working-time warnings, copy, open shifts claimed); clocking in by PIN at a kiosk and from a
 * phone with the location check (flag or block); breaks; manager corrections with a reason; the week's timesheet
 * (overtime, night, public holiday), approval locks the week; payroll and time-record exports; leave and swaps; the
 * job (reminders, forgotten clock-outs closed, no-shows); FIRINGI's own staff.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import * as S from "@/server/staff/service";
import { DEFAULT_STAFF_SETTINGS, addDays, weekStartOf, type StaffSettings } from "@/lib/staff-time";
import { ctxFor } from "../helpers";

const SA = "superadmin@firingi.test", OPS = "ops@firingi.test", OWNER = "owner@kebabhouse.test", STAFF = "buyer@kebabhouse.test";
const TZ = "Europe/Lisbon";
let co = "", staffM = "", ownerM = "", site = "", siteLat = 0, siteLng = 0, ptId = "";
const today = () => new Date().toISOString().slice(0, 10);

async function settings(p: Partial<StaffSettings> = {}) { return S.saveStaffSettings(await ctxFor(SA), { ...DEFAULT_STAFF_SETTINGS, ...p }); }
async function clean() {
  await prisma.timeEntry.deleteMany({ where: { companyId: co } });
  await prisma.shiftSwap.deleteMany({ where: { companyId: co } });
  await prisma.staffShift.deleteMany({ where: { companyId: co } });
  await prisma.timesheet.deleteMany({ where: { companyId: co } });
  await prisma.leaveRequest.deleteMany({ where: { companyId: co } });
}

beforeAll(async () => {
  await prisma.setting.deleteMany({ where: { key: "staff.settings" } });
  await prisma.companyFeature.deleteMany({ where: { key: "STAFF_TIME" } });
  const o = await ctxFor(OWNER), s = await ctxFor(STAFF);
  co = o.company.id; ownerM = o.membership.id; staffM = s.membership.id; ptId = o.company.countryId;
  const a = await prisma.address.findFirstOrThrow({ where: { companyId: co, isActive: true }, orderBy: { isDefault: "desc" } });
  site = a.id;
  if (a.latitude == null) await prisma.address.update({ where: { id: a.id }, data: { latitude: "38.722300", longitude: "-9.139300" } });
  const b = await prisma.address.findUniqueOrThrow({ where: { id: site } });
  siteLat = Number(b.latitude); siteLng = Number(b.longitude);
  await prisma.posPin.deleteMany({ where: { companyId: co } });
  await prisma.staffProfile.deleteMany({ where: { companyId: co } });
  await clean();
});
afterAll(async () => {
  await clean();
  await prisma.staffProfile.deleteMany({ where: { companyId: co } });
  await prisma.posPin.deleteMany({ where: { companyId: co } });
  await prisma.setting.deleteMany({ where: { key: "staff.settings" } });
  await prisma.companyFeature.deleteMany({ where: { key: "STAFF_TIME" } });
  await prisma.$disconnect();
});

describe("staff shifts & time", () => {
  it("FIRINGI switches it: the whole feature, the business type, each business, each part", async () => {
    const owner = await ctxFor(OWNER);
    expect((await S.people(owner)).length).toBeGreaterThanOrEqual(2);
    await settings({ types: { ...DEFAULT_STAFF_SETTINGS.types, CUSTOMER: false } });
    await expect(S.people(owner)).rejects.toThrow(/not available/);
    await S.setCompanySwitch(await ctxFor(SA), co, "ON"); // this business on its own
    expect((await S.people(owner)).length).toBeGreaterThanOrEqual(2);
    await S.setCompanySwitch(await ctxFor(SA), co, "OFF");
    await settings();
    await expect(S.people(owner)).rejects.toThrow(/switched off for this business/);
    await S.setCompanySwitch(await ctxFor(SA), co, "DEFAULT");
    await settings({ parts: { ...DEFAULT_STAFF_SETTINGS.parts, rota: false } });
    await expect(S.weekRota(owner, null)).rejects.toThrow(/switched this part off/);
    await settings();
    await expect(S.saveStaffSettings(await ctxFor(OPS), DEFAULT_STAFF_SETTINGS)).rejects.toThrow();
  });

  it("profiles and the clock PIN (the same as the till's): staff can't see rates or edit others", async () => {
    const owner = await ctxFor(OWNER), staff = await ctxFor(STAFF);
    await S.saveProfile(owner, staffM, { role: "Cook", contractHours: 40, hourlyRate: 10, homeSiteId: site, payrollCode: "K-7", active: true });
    await expect(S.saveProfile(staff, staffM, { role: "Boss", contractHours: 40, hourlyRate: 99, homeSiteId: null, payrollCode: null, active: true })).rejects.toThrow();
    await S.setPin(owner, staffM, "2468");
    await expect(S.setPin(owner, ownerM, "2468")).rejects.toThrow(/another PIN/);
    await S.setPin(staff, staffM, "1357"); // own PIN
    await expect(S.setPin(staff, ownerM, "9999")).rejects.toThrow();
    await S.setPin(owner, ownerM, "8642");
    const seen = (await S.people(staff)).find((p) => p.membershipId === staffM)!;
    expect(seen.hourlyRate).toBeNull();
    expect((await S.people(owner)).find((p) => p.membershipId === staffM)!.hourlyRate).toBe(10);
  });

  it("rota: drafts stay hidden until published; warnings; copy; open shifts claimed", async () => {
    const owner = await ctxFor(OWNER), staff = await ctxFor(STAFF);
    const d1 = addDays(today(), 7), d2 = addDays(today(), 8);
    const a = await S.saveShift(owner, { id: null, day: d1, start: "14:00", end: "23:00", breakMinutes: 30, membershipId: staffM, siteId: site, role: "Cook", note: null });
    await S.saveShift(owner, { id: null, day: d2, start: "06:00", end: "14:00", breakMinutes: 30, membershipId: staffM, siteId: site, role: "Cook", note: null });
    await S.saveShift(owner, { id: null, day: d2, start: "18:00", end: "02:00", breakMinutes: 30, membershipId: null, siteId: site, role: "Cook", note: "late cover" });
    const r = await S.weekRota(owner, d1);
    expect(r.drafts).toBeGreaterThanOrEqual(1);
    const second = r.shifts.find((x) => x.day === d2 && x.membershipId === staffM);
    if (second) expect(second.warnings).toContain("SHORT_REST"); // 7 h after 23:00 (when both fall in the same week)
    const night = r.shifts.find((x) => x.membershipId === null)!;
    expect(night.endsAt.getTime() - night.startsAt.getTime()).toBe(8 * 3600_000); // ends the next day
    expect((await S.weekRota(staff, d1)).shifts.filter((x) => x.id === a.id)).toHaveLength(0); // draft unseen
    await S.publishWeek(owner, d1); await S.publishWeek(owner, d2);
    expect((await S.weekRota(staff, d1)).shifts.some((x) => x.id === a.id)).toBe(true);
    await S.claimShift(staff, night.id);
    await expect(S.claimShift(staff, night.id)).rejects.toThrow(/taken/);
    const copied = await S.copyWeek(owner, d1, addDays(d1, 7));
    expect(copied.copied).toBeGreaterThanOrEqual(1);
    await expect(S.saveShift(staff, { id: null, day: d1, start: "09:00", end: "10:00", breakMinutes: 0, membershipId: staffM, siteId: null, role: null, note: null })).rejects.toThrow();
  });

  it("kiosk PIN and phone: in, break, out; the location is checked (flag or block)", async () => {
    const owner = await ctxFor(OWNER), staff = await ctxFor(STAFF);
    await expect(S.clockByPin(owner, "0000", "AUTO", site)).rejects.toThrow(/Wrong PIN/);
    const i = await S.clockByPin(owner, "1357", "AUTO", site); // the PIN the staff member chose
    expect(i.action).toBe("IN");
    expect(i.name).toBeTruthy();
    await expect(S.clockSelf(staff, "IN", { lat: siteLat, lng: siteLng })).rejects.toThrow(/Already clocked in/);
    await S.clockSelf(staff, "BREAK_START", { lat: null, lng: null }); // breaks from the phone carry no location
    expect((await S.myWeek(staff)).open?.onBreak).toBe(true);
    await S.clockSelf(staff, "BREAK_END", { lat: null, lng: null });
    const o = await S.clockByPin(owner, "1357", "AUTO", site);
    expect(o.action).toBe("OUT");
    // from a phone 2 km away: flagged by default …
    await S.clockSelf(staff, "IN", { lat: siteLat + 0.018, lng: siteLng });
    const e = await prisma.timeEntry.findFirstOrThrow({ where: { membershipId: staffM, clockOut: null } });
    expect(e.flags).toContain("OUTSIDE_AREA");
    expect(e.inDistanceM).toBeGreaterThan(1500);
    await S.clockSelf(staff, "OUT", { lat: siteLat, lng: siteLng });
    // … refused when FIRINGI blocks it; no location → refused
    await settings({ clock: { ...DEFAULT_STAFF_SETTINGS.clock, outside: "BLOCK" } });
    await expect(S.clockSelf(staff, "IN", { lat: siteLat + 0.018, lng: siteLng })).rejects.toThrow(/come within/);
    await expect(S.clockSelf(staff, "IN", { lat: null, lng: null })).rejects.toThrow(/location/);
    await settings({ clock: { ...DEFAULT_STAFF_SETTINGS.clock, phone: false } });
    await expect(S.clockSelf(staff, "IN", { lat: siteLat, lng: siteLng })).rejects.toThrow(/kiosk/);
    await settings();
    const who = await S.whoIsIn(owner);
    expect(who.inNow).toEqual([]);
    await expect(S.whoIsIn(staff)).rejects.toThrow();
  });

  it("timesheet: overtime, night and public-holiday hours; approval locks the week; corrections need a reason", async () => {
    const owner = await ctxFor(OWNER), staff = await ctxFor(STAFF);
    await prisma.timeEntry.deleteMany({ where: { companyId: co } });
    const week = addDays(weekStartOf(new Date(), TZ), -7); // last week, Monday
    const filled = await S.fillHolidays(await ctxFor(SA), ptId, Number(week.slice(0, 4)));
    expect(filled.total).toBe(13);
    await prisma.publicHoliday.upsert({ where: { countryId_date: { countryId: ptId, date: new Date(`${addDays(week, 2)}T00:00:00Z`) } }, create: { countryId: ptId, date: new Date(`${addDays(week, 2)}T00:00:00Z`), name: "Test holiday" }, update: {} });
    const mk = (d: string, a: string, b: string, brk = 30, at = "12") => prisma.timeEntry.create({ data: { companyId: co, membershipId: staffM, siteId: site, clockIn: new Date(`${d}T${a}:00Z`), clockOut: new Date(`${d}T${b}:00Z`), source: "KIOSK", breaks: brk ? [{ start: `${d}T${at}:00:00.000Z`, end: `${d}T${at}:${String(brk).padStart(2, "0")}:00.000Z` }] : [], breakMinutes: brk } });
    await mk(week, "08:00", "19:00"); // 10 h 30 → 2 h 30 daily overtime
    await mk(addDays(week, 1), "14:00", "23:00", 30, "18"); // 8 h 30 (break at 18:00), 1 h night
    await mk(addDays(week, 2), "09:00", "13:00", 0); // 4 h on a public holiday
    const t = await S.timesheetWeek(owner, week);
    const row = t.rows.find((r) => r.membershipId === staffM)!;
    expect(row.minutes).toBe(630 + 510 + 240);
    expect(row.overtimeMinutes).toBe(150 + 30);
    expect(row.nightMinutes).toBe(60);
    expect(row.holidayMinutes).toBe(240);
    expect(row.cost).toBe(230); // 23 h × 10
    // staff see only their own week
    expect((await S.timesheetWeek(staff, week)).rows.map((r) => r.membershipId)).toEqual([staffM]);
    await S.submitTimesheet(staff, week);
    await S.approveTimesheet(owner, staffM, week);
    const e = await prisma.timeEntry.findFirstOrThrow({ where: { membershipId: staffM, clockIn: new Date(`${week}T08:00:00Z`) } });
    await expect(S.saveEntry(owner, { id: e.id, membershipId: staffM, day: week, in: "08:00", out: "17:00", breakMinutes: 30, siteId: site, reason: "forgot" })).rejects.toThrow(/approved/);
    await S.reopenTimesheet(owner, staffM, week);
    await expect(S.saveEntry(owner, { id: e.id, membershipId: staffM, day: week, in: "08:00", out: "17:00", breakMinutes: 30, siteId: site, reason: "" })).rejects.toThrow(/why/);
    await S.saveEntry(owner, { id: e.id, membershipId: staffM, day: week, in: "08:00", out: "17:00", breakMinutes: 30, siteId: site, reason: "Left at five, forgot to clock out" });
    const edited = await prisma.timeEntry.findUniqueOrThrow({ where: { id: e.id } });
    expect(edited.flags).toContain("EDITED");
    expect(edited.editReason).toMatch(/five/);
    expect(await prisma.auditLog.count({ where: { action: "staff.entry_edited", entityId: e.id } })).toBe(1);
    await expect(S.saveEntry(staff, { id: e.id, membershipId: staffM, day: week, in: "08:00", out: "20:00", breakMinutes: 0, siteId: site, reason: "more pay" })).rejects.toThrow();
    // exports
    const pay = await S.exportRows(owner, "PAYROLL", week, addDays(week, 6));
    const mine = pay.rows.find((r) => r[1] === "K-7")!;
    expect(mine[3]).toBe(((480 + 510 + 240 - 30) / 60).toFixed(2)); // regular hours = worked − overtime
    const rec = await S.exportRows(owner, "RECORD", week, addDays(week, 6));
    expect(rec.rows.length).toBe(3);
    expect(rec.rows.some((r) => String(r[12]).includes("five"))).toBe(true);
    await expect(S.exportRows(staff, "PAYROLL", week, addDays(week, 6))).rejects.toThrow();
  });

  it("leave and swaps, each with the manager's approval", async () => {
    const owner = await ctxFor(OWNER), staff = await ctxFor(STAFF);
    const from = addDays(today(), 20), to = addDays(today(), 24);
    const l = await S.requestLeave(staff, { kind: "HOLIDAY", startsOn: from, endsOn: to, halfDay: false, reason: "family" });
    expect(l.status).toBe("PENDING");
    await expect(S.requestLeave(staff, { kind: "HOLIDAY", startsOn: to, endsOn: addDays(to, 1), halfDay: false, reason: null })).rejects.toThrow(/already asked/);
    await expect(S.decideLeave(owner, l.id, false, null)).rejects.toThrow(/why/);
    await S.decideLeave(owner, l.id, true, null);
    expect((await prisma.leaveRequest.findUniqueOrThrow({ where: { id: l.id } })).status).toBe("APPROVED");
    expect((await S.leaveList(owner)).find((x) => x.id === l.id)!.days).toBeGreaterThan(0);
    await S.cancelLeave(staff, l.id);
    // swap: the staff member offers a shift to the owner; the owner takes it; the manager approves
    const shift = await S.saveShift(owner, { id: null, day: addDays(today(), 10), start: "10:00", end: "16:00", breakMinutes: 30, membershipId: staffM, siteId: site, role: null, note: null });
    await S.publishWeek(owner, addDays(today(), 10));
    const w = await S.requestSwap(staff, shift.id, ownerM, "doctor");
    await expect(S.requestSwap(staff, shift.id, ownerM, null)).rejects.toThrow(/already offered/);
    expect((await S.acceptSwap(owner, w.id)).status).toBe("ACCEPTED");
    await S.decideSwap(owner, w.id, true, null);
    expect((await prisma.staffShift.findUniqueOrThrow({ where: { id: shift.id } })).membershipId).toBe(ownerM);
  });

  it("the job: shift reminders, forgotten clock-outs reminded then closed, no-shows", async () => {
    const owner = await ctxFor(OWNER);
    await prisma.timeEntry.deleteMany({ where: { companyId: co } });
    const now = new Date();
    const soon = await prisma.staffShift.create({ data: { companyId: co, membershipId: staffM, siteId: site, startsAt: new Date(now.getTime() + 30 * 60000), endsAt: new Date(now.getTime() + 5 * 3600_000), status: "PUBLISHED" } });
    const missed = await prisma.staffShift.create({ data: { companyId: co, membershipId: ownerM, siteId: site, startsAt: new Date(now.getTime() - 40 * 60000), endsAt: new Date(now.getTime() + 3 * 3600_000), status: "PUBLISHED" } });
    const ended = await prisma.staffShift.create({ data: { companyId: co, membershipId: staffM, siteId: site, startsAt: new Date(now.getTime() - 5 * 3600_000), endsAt: new Date(now.getTime() - 60 * 60000), status: "PUBLISHED", noShowAt: now } });
    const late = await prisma.timeEntry.create({ data: { companyId: co, membershipId: staffM, shiftId: ended.id, clockIn: new Date(now.getTime() - 5 * 3600_000), source: "KIOSK" } });
    const forgot = await prisma.timeEntry.create({ data: { companyId: co, membershipId: ownerM, clockIn: new Date(now.getTime() - 15 * 3600_000), source: "PHONE" } });
    const r = await S.runStaffJob(now);
    expect((await prisma.staffShift.findUniqueOrThrow({ where: { id: soon.id } })).remindedAt).not.toBeNull();
    expect((await prisma.staffShift.findUniqueOrThrow({ where: { id: missed.id } })).noShowAt).not.toBeNull();
    expect(r.noShows).toBeGreaterThanOrEqual(1);
    expect((await prisma.timeEntry.findUniqueOrThrow({ where: { id: late.id } })).remindedAt).not.toBeNull();
    const closed = await prisma.timeEntry.findUniqueOrThrow({ where: { id: forgot.id } });
    expect(closed.clockOut).not.toBeNull();
    expect(closed.flags).toContain("MISSED_CLOCK_OUT");
    expect(closed.outSource).toBe("AUTO");
    expect((await S.whoIsIn(owner)).flagged.some((f) => f.id === forgot.id)).toBe(true);
    const lab = await S.labourReport(owner, 7);
    expect(lab.rows).toHaveLength(7);
  });

  it("FIRINGI's own staff use it in the back office; staff without the right can't manage", async () => {
    const sa = await ctxFor(SA), ops = await ctxFor(OPS);
    expect((await S.people(sa)).length).toBeGreaterThanOrEqual(5);
    expect(S.isManager(sa)).toBe(true);
    expect(S.isManager(ops)).toBe(false);
    await expect(S.whoIsIn(ops)).rejects.toThrow();
    expect((await S.myWeek(ops)).open).toBeNull();
    expect((await S.adminOverview(sa)).profiles).toBeGreaterThanOrEqual(1);
  });
});
