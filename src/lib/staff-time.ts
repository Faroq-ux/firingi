/**
 * Staff shifts & time (Phase 52) — pure rules, no database.
 * Times are stored in UTC; days, nights and public holidays are read in the site's local time (its country's zone).
 * Working-time checks follow the EU Working Time Directive (2003/88/EC) defaults: at most 48 h a week, 11 h rest
 * between shifts, a break once a day passes 6 h. FIRINGI changes every number.
 */
export const LEAVE_KINDS = ["HOLIDAY", "SICK", "UNPAID", "OTHER"] as const;
export type LeaveKindT = (typeof LEAVE_KINDS)[number];
export const STAFF_TYPES = ["CUSTOMER", "WHOLESALER", "DISTRIBUTOR", "ADMIN"] as const;
export type StaffType = (typeof STAFF_TYPES)[number];
export const PARTS = ["clock", "rota", "timesheets", "leave", "swaps", "labour"] as const;
export type Part = (typeof PARTS)[number];

export type StaffSettings = {
  enabled: boolean;
  types: Record<StaffType, boolean>;
  parts: Record<Part, boolean>;
  clock: {
    phone: boolean; kiosk: boolean; till: boolean;
    /** check the phone's location against the site */
    location: boolean; radiusM: number;
    /** outside the area: "FLAG" lets the clock-in through with a flag, "BLOCK" refuses it */
    outside: "FLAG" | "BLOCK";
    lateGraceMin: number;
    /** close an entry still open this many hours after clock-in (flagged MISSED_CLOCK_OUT) */
    autoCloseAfterH: number;
    /** remind staff still clocked in this many minutes after their shift ended */
    missedReminderMin: number;
  };
  rules: {
    dailyOvertimeAfterMin: number; weeklyOvertimeAfterMin: number;
    nightFrom: string; nightTo: string;
    breakAfterMin: number; minBreakMin: number;
    maxWeeklyMin: number; minRestMin: number;
  };
  reminders: { shiftBeforeMin: number };
  approvals: { timesheets: boolean; leave: boolean; swaps: boolean };
  /** what staff may do themselves */
  self: { claimOpenShifts: boolean; seeColleagues: boolean };
  /** keep time records this many years (Portugal: 5) */
  keepYears: number;
};

export const DEFAULT_STAFF_SETTINGS: StaffSettings = {
  enabled: true,
  types: { CUSTOMER: true, WHOLESALER: true, DISTRIBUTOR: true, ADMIN: true },
  parts: { clock: true, rota: true, timesheets: true, leave: true, swaps: true, labour: true },
  clock: { phone: true, kiosk: true, till: true, location: true, radiusM: 150, outside: "FLAG", lateGraceMin: 5, autoCloseAfterH: 14, missedReminderMin: 30 },
  rules: { dailyOvertimeAfterMin: 480, weeklyOvertimeAfterMin: 2400, nightFrom: "22:00", nightTo: "07:00", breakAfterMin: 360, minBreakMin: 30, maxWeeklyMin: 2880, minRestMin: 660 },
  reminders: { shiftBeforeMin: 60 },
  approvals: { timesheets: true, leave: true, swaps: true },
  self: { claimOpenShifts: true, seeColleagues: true },
  keepYears: 5,
};

export function mergeStaffSettings(v: Partial<StaffSettings> | null | undefined): StaffSettings {
  const d = DEFAULT_STAFF_SETTINGS, x = v ?? {};
  return {
    ...d, ...x, types: { ...d.types, ...(x.types ?? {}) }, parts: { ...d.parts, ...(x.parts ?? {}) }, clock: { ...d.clock, ...(x.clock ?? {}) },
    rules: { ...d.rules, ...(x.rules ?? {}) }, reminders: { ...d.reminders, ...(x.reminders ?? {}) }, approvals: { ...d.approvals, ...(x.approvals ?? {}) }, self: { ...d.self, ...(x.self ?? {}) },
  };
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
export function cleanStaffSettings(i: StaffSettings): StaffSettings {
  const n = (x: unknown, lo: number, hi: number, label: string) => { const v = Math.round(Number(x)); if (!Number.isFinite(v) || v < lo || v > hi) throw new Error(`${label} must be between ${lo} and ${hi}.`); return v; };
  const flags = <K extends string>(o: Record<K, boolean> | undefined, keys: readonly K[]) => Object.fromEntries(keys.map((k) => [k, !!o?.[k]])) as Record<K, boolean>;
  const t = (x: string, label: string) => { if (!HHMM.test(x ?? "")) throw new Error(`${label} must look like 22:00.`); return x; };
  const c = i.clock ?? DEFAULT_STAFF_SETTINGS.clock, r = i.rules ?? DEFAULT_STAFF_SETTINGS.rules;
  return {
    enabled: !!i.enabled, types: flags(i.types, STAFF_TYPES), parts: flags(i.parts, PARTS),
    clock: {
      phone: !!c.phone, kiosk: !!c.kiosk, till: !!c.till, location: !!c.location, radiusM: n(c.radiusM, 20, 5000, "Clock-in distance"),
      outside: c.outside === "BLOCK" ? "BLOCK" : "FLAG", lateGraceMin: n(c.lateGraceMin, 0, 60, "Late grace"),
      autoCloseAfterH: n(c.autoCloseAfterH, 4, 24, "Auto clock-out"), missedReminderMin: n(c.missedReminderMin, 5, 240, "Missed clock-out reminder"),
    },
    rules: {
      dailyOvertimeAfterMin: n(r.dailyOvertimeAfterMin, 60, 1440, "Daily overtime after"), weeklyOvertimeAfterMin: n(r.weeklyOvertimeAfterMin, 60, 6000, "Weekly overtime after"),
      nightFrom: t(r.nightFrom, "Night from"), nightTo: t(r.nightTo, "Night to"),
      breakAfterMin: n(r.breakAfterMin, 60, 720, "Break after"), minBreakMin: n(r.minBreakMin, 0, 120, "Shortest break"),
      maxWeeklyMin: n(r.maxWeeklyMin, 600, 6000, "Most hours a week"), minRestMin: n(r.minRestMin, 0, 1440, "Rest between shifts"),
    },
    reminders: { shiftBeforeMin: n(i.reminders?.shiftBeforeMin, 0, 1440, "Shift reminder") },
    approvals: flags(i.approvals, ["timesheets", "leave", "swaps"] as const),
    self: flags(i.self, ["claimOpenShifts", "seeColleagues"] as const),
    keepYears: n(i.keepYears, 1, 30, "Keep records"),
  };
}

/** The IANA zone of a Schengen country (the main one; Portugal's islands use the mainland's). */
const ZONES: Record<string, string> = {
  PT: "Europe/Lisbon", ES: "Europe/Madrid", FR: "Europe/Paris", BE: "Europe/Brussels", NL: "Europe/Amsterdam", LU: "Europe/Luxembourg",
  DE: "Europe/Berlin", AT: "Europe/Vienna", CH: "Europe/Zurich", LI: "Europe/Vaduz", IT: "Europe/Rome", MT: "Europe/Malta", SI: "Europe/Ljubljana",
  HR: "Europe/Zagreb", HU: "Europe/Budapest", SK: "Europe/Bratislava", CZ: "Europe/Prague", PL: "Europe/Warsaw", DK: "Europe/Copenhagen",
  SE: "Europe/Stockholm", NO: "Europe/Oslo", FI: "Europe/Helsinki", IS: "Atlantic/Reykjavik", EE: "Europe/Tallinn", LV: "Europe/Riga",
  LT: "Europe/Vilnius", GR: "Europe/Athens", BG: "Europe/Sofia", RO: "Europe/Bucharest",
};
export const zoneOf = (countryCode: string | null | undefined) => ZONES[(countryCode ?? "PT").toUpperCase()] ?? "Europe/Lisbon";

/** Local wall-clock parts of an instant in a zone. */
const FMT = new Map<string, Intl.DateTimeFormat>();
export function localParts(d: Date, tz: string) {
  let f = FMT.get(tz);
  if (!f) { f = new Intl.DateTimeFormat("en-GB", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" }); FMT.set(tz, f); }
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, minute: Number(p.hour) * 60 + Number(p.minute), weekday: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(p.weekday) };
}

/** The local day ("YYYY-MM-DD") of the Monday of the week holding d. */
export function weekStartOf(d: Date, tz: string) {
  const { day, weekday } = localParts(d, tz);
  const x = new Date(`${day}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() - weekday);
  return x.toISOString().slice(0, 10);
}

export const addDays = (day: string, n: number) => { const x = new Date(`${day}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const isNight = (minute: number, from: number, to: number) => (from > to ? minute >= from || minute < to : minute >= from && minute < to);

export type Interval = { start: Date; end: Date };
export type Break = { start: string; end: string | null };

/** Minutes of breaks in an entry (an open break counts up to `now`). */
export function breakMinutes(breaks: Break[], now = new Date()) {
  return Math.round(breaks.reduce((a, b) => a + Math.max(0, (b.end ? new Date(b.end) : now).getTime() - new Date(b.start).getTime()), 0) / 60000);
}

/**
 * Splits worked time minute by minute (to the minute — exact across midnight, night hours, holidays and DST):
 * per local day: worked, night and holiday minutes. Breaks are taken out.
 */
export function splitWork(entries: { clockIn: Date; clockOut: Date | null; breaks: Break[] }[], tz: string, holidays: Set<string>, rules: Pick<StaffSettings["rules"], "nightFrom" | "nightTo">, now = new Date()) {
  const days = new Map<string, { worked: number; night: number; holiday: number }>();
  const nf = toMin(rules.nightFrom), nt = toMin(rules.nightTo);
  for (const e of entries) {
    const end = e.clockOut ?? now;
    const off = e.breaks.map((b) => ({ s: new Date(b.start).getTime(), e: (b.end ? new Date(b.end) : now).getTime() }));
    for (let t = Math.floor(e.clockIn.getTime() / 60000) * 60000; t < end.getTime(); t += 60000) {
      if (off.some((b) => t >= b.s && t < b.e)) continue;
      const { day, minute } = localParts(new Date(t), tz);
      const d = days.get(day) ?? { worked: 0, night: 0, holiday: 0 };
      d.worked++;
      if (isNight(minute, nf, nt)) d.night++;
      if (holidays.has(day)) d.holiday++;
      days.set(day, d);
    }
  }
  return days;
}

/** A week's totals: worked, overtime (the larger of daily and weekly overtime), night, holiday minutes. */
export function weekTotals(days: Map<string, { worked: number; night: number; holiday: number }>, rules: Pick<StaffSettings["rules"], "dailyOvertimeAfterMin" | "weeklyOvertimeAfterMin">) {
  let worked = 0, night = 0, holiday = 0, daily = 0;
  for (const d of days.values()) { worked += d.worked; night += d.night; holiday += d.holiday; daily += Math.max(0, d.worked - rules.dailyOvertimeAfterMin); }
  const weekly = Math.max(0, worked - rules.weeklyOvertimeAfterMin);
  return { minutes: worked, overtimeMinutes: Math.max(daily, weekly), nightMinutes: night, holidayMinutes: holiday };
}

export type Warning = "WEEK_OVER_MAX" | "SHORT_REST" | "NO_BREAK" | "OVERLAP" | "ON_LEAVE";

/** Working-time warnings for one person's planned shifts (sorted or not). */
export function rotaWarnings(shifts: { id: string; startsAt: Date; endsAt: Date; breakMinutes: number }[], rules: Pick<StaffSettings["rules"], "maxWeeklyMin" | "minRestMin" | "breakAfterMin" | "minBreakMin">, leave: Interval[] = []) {
  const out = new Map<string, Warning[]>();
  const add = (id: string, w: Warning) => out.set(id, [...new Set([...(out.get(id) ?? []), w])]);
  const s = [...shifts].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  let total = 0;
  for (let i = 0; i < s.length; i++) {
    const len = (s[i].endsAt.getTime() - s[i].startsAt.getTime()) / 60000;
    total += len - s[i].breakMinutes;
    if (len > rules.breakAfterMin && s[i].breakMinutes < rules.minBreakMin) add(s[i].id, "NO_BREAK");
    if (i > 0) {
      const gap = (s[i].startsAt.getTime() - s[i - 1].endsAt.getTime()) / 60000;
      if (gap < 0) { add(s[i].id, "OVERLAP"); add(s[i - 1].id, "OVERLAP"); } else if (gap < rules.minRestMin) add(s[i].id, "SHORT_REST");
    }
    if (leave.some((l) => s[i].startsAt < l.end && s[i].endsAt > l.start)) add(s[i].id, "ON_LEAVE");
  }
  if (total > rules.maxWeeklyMin) for (const x of s) add(x.id, "WEEK_OVER_MAX");
  return { warnings: out, plannedMinutes: Math.round(total) };
}

export type Flag = "LATE" | "EARLY_LEAVE" | "OUTSIDE_AREA" | "MISSED_CLOCK_OUT" | "EDITED" | "NO_BREAK" | "NO_SHIFT";

/** Flags for a clocked entry against its planned shift and the rules. */
export function entryFlags(e: { clockIn: Date; clockOut: Date | null; breaks: Break[]; inDistanceM?: number | null; outDistanceM?: number | null }, shift: { startsAt: Date; endsAt: Date } | null, s: Pick<StaffSettings, "clock" | "rules">, now = new Date()) {
  const f: Flag[] = [];
  const grace = s.clock.lateGraceMin * 60000;
  if (!shift) f.push("NO_SHIFT");
  if (shift && e.clockIn.getTime() > shift.startsAt.getTime() + grace) f.push("LATE");
  if (shift && e.clockOut && e.clockOut.getTime() < shift.endsAt.getTime() - grace) f.push("EARLY_LEAVE");
  if (s.clock.location && ((e.inDistanceM ?? 0) > s.clock.radiusM || (e.outDistanceM ?? 0) > s.clock.radiusM)) f.push("OUTSIDE_AREA");
  const worked = ((e.clockOut ?? now).getTime() - e.clockIn.getTime()) / 60000 - breakMinutes(e.breaks, now);
  if (e.clockOut && worked > s.rules.breakAfterMin && breakMinutes(e.breaks, now) < s.rules.minBreakMin) f.push("NO_BREAK");
  return f;
}

/** The planned shift an entry belongs to: the member's shift around the clock-in (2 h before start to its end). */
export function matchShift<T extends { startsAt: Date; endsAt: Date }>(at: Date, shifts: T[]) {
  const t = at.getTime();
  return shifts.filter((x) => t >= x.startsAt.getTime() - 2 * 3600_000 && t <= x.endsAt.getTime()).sort((a, b) => Math.abs(a.startsAt.getTime() - t) - Math.abs(b.startsAt.getTime() - t))[0] ?? null;
}

/** Working days of leave between two local days (Mon–Fri, public holidays not counted; a half day = 0.5). */
export function leaveDays(startsOn: string, endsOn: string, holidays: Set<string>, halfDay = false) {
  if (halfDay) return 0.5;
  let n = 0;
  for (let d = startsOn; d <= endsOn; d = addDays(d, 1)) {
    const wd = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (wd !== 0 && wd !== 6 && !holidays.has(d)) n++;
  }
  return n;
}

/** Labour cost share of sales (%), or null with no sales. */
export const labourShare = (cost: number, sales: number) => (sales > 0 ? Math.round((cost / sales) * 1000) / 10 : null);

/** "7 h 05" */
export const hm = (min: number) => `${Math.floor(Math.max(0, min) / 60)} h ${String(Math.round(Math.max(0, min) % 60)).padStart(2, "0")}`;

/** Easter Sunday (Gregorian, anonymous algorithm) as "YYYY-MM-DD". */
export function easter(year: number) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** National public holidays FIRINGI can fill in for a year (regional ones are added by hand). Empty for other countries. */
export function nationalHolidays(countryCode: string, year: number): { date: string; name: string }[] {
  const E = easter(year), y = (md: string) => `${year}-${md}`, e = (n: number) => addDays(E, n);
  const lists: Record<string, [string, string][]> = {
    PT: [[y("01-01"), "Ano Novo"], [e(-2), "Sexta-feira Santa"], [E, "Páscoa"], [y("04-25"), "Dia da Liberdade"], [y("05-01"), "Dia do Trabalhador"], [e(60), "Corpo de Deus"], [y("06-10"), "Dia de Portugal"], [y("08-15"), "Assunção de Nossa Senhora"], [y("10-05"), "Implantação da República"], [y("11-01"), "Dia de Todos os Santos"], [y("12-01"), "Restauração da Independência"], [y("12-08"), "Imaculada Conceição"], [y("12-25"), "Natal"]],
    ES: [[y("01-01"), "Año Nuevo"], [y("01-06"), "Epifanía del Señor"], [e(-2), "Viernes Santo"], [y("05-01"), "Fiesta del Trabajo"], [y("08-15"), "Asunción de la Virgen"], [y("10-12"), "Fiesta Nacional de España"], [y("11-01"), "Todos los Santos"], [y("12-06"), "Día de la Constitución"], [y("12-08"), "Inmaculada Concepción"], [y("12-25"), "Natividad del Señor"]],
    FR: [[y("01-01"), "Jour de l'an"], [e(1), "Lundi de Pâques"], [y("05-01"), "Fête du Travail"], [y("05-08"), "Victoire 1945"], [e(39), "Ascension"], [e(50), "Lundi de Pentecôte"], [y("07-14"), "Fête nationale"], [y("08-15"), "Assomption"], [y("11-01"), "Toussaint"], [y("11-11"), "Armistice"], [y("12-25"), "Noël"]],
    DE: [[y("01-01"), "Neujahr"], [e(-2), "Karfreitag"], [e(1), "Ostermontag"], [y("05-01"), "Tag der Arbeit"], [e(39), "Christi Himmelfahrt"], [e(50), "Pfingstmontag"], [y("10-03"), "Tag der Deutschen Einheit"], [y("12-25"), "1. Weihnachtstag"], [y("12-26"), "2. Weihnachtstag"]],
    IT: [[y("01-01"), "Capodanno"], [y("01-06"), "Epifania"], [e(1), "Lunedì dell'Angelo"], [y("04-25"), "Festa della Liberazione"], [y("05-01"), "Festa del Lavoro"], [y("06-02"), "Festa della Repubblica"], [y("08-15"), "Ferragosto"], [y("11-01"), "Ognissanti"], [y("12-08"), "Immacolata Concezione"], [y("12-25"), "Natale"], [y("12-26"), "Santo Stefano"]],
    NL: [[y("01-01"), "Nieuwjaarsdag"], [e(1), "Tweede paasdag"], [new Date(`${year}-04-27T12:00:00Z`).getUTCDay() === 0 ? y("04-26") : y("04-27"), "Koningsdag"], [e(39), "Hemelvaartsdag"], [e(50), "Tweede pinksterdag"], [y("12-25"), "Eerste kerstdag"], [y("12-26"), "Tweede kerstdag"]],
    BE: [[y("01-01"), "Nieuwjaar / Nouvel An"], [e(1), "Paasmaandag / Lundi de Pâques"], [y("05-01"), "Dag van de Arbeid / Fête du Travail"], [e(39), "Hemelvaart / Ascension"], [e(50), "Pinkstermaandag / Lundi de Pentecôte"], [y("07-21"), "Nationale feestdag / Fête nationale"], [y("08-15"), "O.L.V. Hemelvaart / Assomption"], [y("11-01"), "Allerheiligen / Toussaint"], [y("11-11"), "Wapenstilstand / Armistice"], [y("12-25"), "Kerstmis / Noël"]],
    AT: [[y("01-01"), "Neujahr"], [y("01-06"), "Heilige Drei Könige"], [e(1), "Ostermontag"], [y("05-01"), "Staatsfeiertag"], [e(39), "Christi Himmelfahrt"], [e(50), "Pfingstmontag"], [e(60), "Fronleichnam"], [y("08-15"), "Mariä Himmelfahrt"], [y("10-26"), "Nationalfeiertag"], [y("11-01"), "Allerheiligen"], [y("12-08"), "Mariä Empfängnis"], [y("12-25"), "Christtag"], [y("12-26"), "Stefanitag"]],
  };
  return (lists[countryCode.toUpperCase()] ?? []).map(([date, name]) => ({ date, name })).sort((a, b) => a.date.localeCompare(b.date));
}
