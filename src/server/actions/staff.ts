"use server";
/** Staff shifts & time actions (Phase 52). The service checks rights again (manager, own data, FIRINGI's switches). */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction } from "./_action";
import * as S from "@/server/staff/service";
import { LEAVE_KINDS, PARTS, STAFF_TYPES } from "@/lib/staff-time";

const id = z.string().min(1).max(64);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const hhmm = z.string().regex(/^\d{2}:\d{2}$/);
const note = z.string().max(500).nullable();
const ADMIN = ["admin.settings.manage", "admin.users.manage"] as const;
const done = <T>(v: T) => { for (const p of ["/buy/staff", "/vendor/staff", "/admin/staff"]) revalidatePath(p, "layout"); revalidatePath("/admin/settings/staff-time", "layout"); return v; };

export const saveStaffProfileAction = defineAction({
  permission: null,
  schema: z.object({ membershipId: id, role: z.string().max(60).nullable(), contractHours: z.number().nullable(), hourlyRate: z.number().nullable(), homeSiteId: id.nullable(), payrollCode: z.string().max(40).nullable(), active: z.boolean() }),
  handler: async (ctx, i) => done(await S.saveProfile(ctx, i.membershipId, i)),
});
export const setStaffPinAction = defineAction({ permission: null, schema: z.object({ membershipId: id, pin: z.string().max(8) }), handler: async (ctx, i) => done(await S.setPin(ctx, i.membershipId, i.pin)) });

export const saveShiftAction = defineAction({
  permission: null,
  schema: z.object({ id: id.nullable(), day, start: hhmm, end: hhmm, breakMinutes: z.number().int().min(0).max(240), membershipId: id.nullable(), siteId: id.nullable(), role: z.string().max(60).nullable(), note }),
  handler: async (ctx, i) => { const x = await S.saveShift(ctx, i); return done({ id: x.id }); },
});
export const deleteShiftAction = defineAction({ permission: null, schema: z.object({ id }), handler: async (ctx, i) => done(await S.deleteShift(ctx, i.id)) });
export const copyWeekAction = defineAction({ permission: null, schema: z.object({ from: day, to: day }), handler: async (ctx, i) => done(await S.copyWeek(ctx, i.from, i.to)) });
export const publishWeekAction = defineAction({ permission: null, schema: z.object({ week: day }), handler: async (ctx, i) => done(await S.publishWeek(ctx, i.week)) });
export const claimShiftAction = defineAction({ permission: null, schema: z.object({ id }), handler: async (ctx, i) => done(await S.claimShift(ctx, i.id)) });

const action = z.enum(["IN", "OUT", "BREAK_START", "BREAK_END"]);
export const clockSelfAction = defineAction({
  permission: null,
  schema: z.object({ action, lat: z.number().min(-90).max(90).nullable(), lng: z.number().min(-180).max(180).nullable(), siteId: id.nullable() }),
  handler: async (ctx, i) => done(await S.clockSelf(ctx, i.action, i)),
});
export const clockByPinAction = defineAction({
  permission: null,
  schema: z.object({ pin: z.string().max(8), action: z.enum(["IN", "OUT", "BREAK_START", "BREAK_END", "AUTO"]), siteId: id.nullable(), via: z.enum(["KIOSK", "TILL"]) }),
  handler: async (ctx, i) => done(await S.clockByPin(ctx, i.pin, i.action, i.siteId, i.via)),
});

export const saveEntryAction = defineAction({
  permission: null,
  schema: z.object({ id: id.nullable(), membershipId: id, day, in: hhmm, out: hhmm.nullable(), breakMinutes: z.number().int().min(0).max(480), siteId: id.nullable(), reason: z.string().min(1).max(300) }),
  handler: async (ctx, i) => done(await S.saveEntry(ctx, i)),
});
export const deleteEntryAction = defineAction({ permission: null, schema: z.object({ id, reason: z.string().min(1).max(300) }), handler: async (ctx, i) => done(await S.deleteEntry(ctx, i.id, i.reason)) });

export const submitTimesheetAction = defineAction({ permission: null, schema: z.object({ week: day }), handler: async (ctx, i) => done(await S.submitTimesheet(ctx, i.week)) });
export const approveTimesheetAction = defineAction({ permission: null, schema: z.object({ membershipId: id, week: day }), handler: async (ctx, i) => done(await S.approveTimesheet(ctx, i.membershipId, i.week)) });
export const reopenTimesheetAction = defineAction({ permission: null, schema: z.object({ membershipId: id, week: day }), handler: async (ctx, i) => done(await S.reopenTimesheet(ctx, i.membershipId, i.week)) });

export const requestLeaveAction = defineAction({
  permission: null,
  schema: z.object({ kind: z.enum(LEAVE_KINDS), startsOn: day, endsOn: day, halfDay: z.boolean(), reason: note }),
  handler: async (ctx, i) => { await S.requestLeave(ctx, i); return done(true); },
});
export const decideLeaveAction = defineAction({ permission: null, schema: z.object({ id, approve: z.boolean(), note }), handler: async (ctx, i) => done(await S.decideLeave(ctx, i.id, i.approve, i.note)) });
export const cancelLeaveAction = defineAction({ permission: null, schema: z.object({ id }), handler: async (ctx, i) => done(await S.cancelLeave(ctx, i.id)) });

export const requestSwapAction = defineAction({ permission: null, schema: z.object({ shiftId: id, toMembershipId: id.nullable(), note }), handler: async (ctx, i) => { await S.requestSwap(ctx, i.shiftId, i.toMembershipId, i.note); return done(true); } });
export const acceptSwapAction = defineAction({ permission: null, schema: z.object({ id }), handler: async (ctx, i) => done(await S.acceptSwap(ctx, i.id)) });
export const decideSwapAction = defineAction({ permission: null, schema: z.object({ id, approve: z.boolean(), note }), handler: async (ctx, i) => done(await S.decideSwap(ctx, i.id, i.approve, i.note)) });

// FIRINGI
export const setStaffSwitchAction = defineAction({ permission: [...ADMIN], schema: z.object({ companyId: id, state: z.enum(["DEFAULT", "ON", "OFF"]) }), handler: async (ctx, i) => done(await S.setCompanySwitch(ctx, i.companyId, i.state)) });
export const saveHolidayAction = defineAction({ permission: [...ADMIN], schema: z.object({ countryId: id, date: day, name: z.string().min(1).max(80) }), handler: async (ctx, i) => done(await S.saveHoliday(ctx, i.countryId, i.date, i.name)) });
export const fillHolidaysAction = defineAction({ permission: [...ADMIN], schema: z.object({ countryId: id, year: z.number().int() }), handler: async (ctx, i) => done(await S.fillHolidays(ctx, i.countryId, i.year)) });
export const deleteHolidayAction = defineAction({ permission: [...ADMIN], schema: z.object({ id }), handler: async (ctx, i) => done(await S.deleteHoliday(ctx, i.id)) });
const flags = <K extends string>(keys: readonly K[]) => z.object(Object.fromEntries(keys.map((k) => [k, z.boolean()])) as Record<K, z.ZodBoolean>);
export const saveStaffSettingsAction = defineAction({
  permission: [...ADMIN],
  schema: z.object({
    enabled: z.boolean(), types: flags(STAFF_TYPES), parts: flags(PARTS),
    clock: z.object({ phone: z.boolean(), kiosk: z.boolean(), till: z.boolean(), location: z.boolean(), radiusM: z.number(), outside: z.enum(["FLAG", "BLOCK"]), lateGraceMin: z.number(), autoCloseAfterH: z.number(), missedReminderMin: z.number() }),
    rules: z.object({ dailyOvertimeAfterMin: z.number(), weeklyOvertimeAfterMin: z.number(), nightFrom: z.string(), nightTo: z.string(), breakAfterMin: z.number(), minBreakMin: z.number(), maxWeeklyMin: z.number(), minRestMin: z.number() }),
    reminders: z.object({ shiftBeforeMin: z.number() }), approvals: flags(["timesheets", "leave", "swaps"] as const), self: flags(["claimOpenShifts", "seeColleagues"] as const), keepYears: z.number(),
  }),
  handler: async (ctx, i) => done(await S.saveStaffSettings(ctx, i)),
});
