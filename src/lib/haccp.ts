/**
 * Food safety (HACCP) logbook — Phase 69. Pure rules shared by server and pages: equipment and their limits, what is
 * due on a day (temperature checks at set times, checklists, cleaning), whether a reading is in range, cooling,
 * completion, and the ready-made templates per kind of business.
 */

export const UNIT_KINDS = ["FRIDGE", "FREEZER", "COLD_ROOM", "HOT_HOLD", "DISPLAY", "OTHER"] as const;
export type UnitKind = (typeof UNIT_KINDS)[number];
/** Sensible limits per kind (°C); every business can change them. */
export const UNIT_DEFAULTS: Record<UnitKind, { minC: number | null; maxC: number | null }> = {
  FRIDGE: { minC: 0, maxC: 5 }, FREEZER: { minC: null, maxC: -18 }, COLD_ROOM: { minC: 0, maxC: 4 }, HOT_HOLD: { minC: 63, maxC: null }, DISPLAY: { minC: 0, maxC: 5 }, OTHER: { minC: null, maxC: null },
};

export const TASK_KINDS = ["CHECKLIST", "CLEANING"] as const;
export type TaskKind = (typeof TASK_KINDS)[number];
export const TASK_FREQUENCIES = ["OPENING", "CLOSING", "DAILY", "WEEKLY", "MONTHLY"] as const;
export type TaskFrequency = (typeof TASK_FREQUENCIES)[number];

export const ENTRY_KINDS = ["TEMP", "TASK", "DELIVERY", "COOLING"] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

export type HaccpRules = { coolingTargetC: number; coolingMaxMinutes: number; graceMinutes: number; trainingWarnDays: number; deliveryChilledMaxC: number; deliveryFrozenMaxC: number };
export const DEFAULT_RULES: HaccpRules = { coolingTargetC: 10, coolingMaxMinutes: 120, graceMinutes: 60, trainingWarnDays: 30, deliveryChilledMaxC: 5, deliveryFrozenMaxC: -15 };

export const dayKey = (d: Date) => d.toISOString().slice(0, 10);
export const utcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const weekday = (d: Date) => ((d.getUTCDay() + 6) % 7) + 1; // 1 = Monday

/** In range? null limits are open ("no lower / upper limit"). */
export function inRange(valueC: number, minC: number | null, maxC: number | null) {
  return (minC === null || valueC >= minC) && (maxC === null || valueC <= maxC);
}
/** "0 – 5 °C", "≤ −18 °C", "≥ 63 °C", "—" */
export function limitText(minC: number | null, maxC: number | null) {
  const f = (n: number) => String(n).replace("-", "−");
  if (minC !== null && maxC !== null) return `${f(minC)} – ${f(maxC)} °C`;
  if (maxC !== null) return `≤ ${f(maxC)} °C`;
  if (minC !== null) return `≥ ${f(minC)} °C`;
  return "—";
}

/** Cooling: from its start temperature to the target within the time (e.g. ≤ 10 °C within 2 hours). */
export function coolingOk(endC: number, minutes: number, r: Pick<HaccpRules, "coolingTargetC" | "coolingMaxMinutes">) {
  return endC <= r.coolingTargetC && minutes <= r.coolingMaxMinutes;
}

/** Delivery check: packaging and dates fine, and the temperature (if any) within the limit for chilled / frozen goods. */
export function deliveryOk(e: { packagingOk: boolean; datesOk: boolean; valueC?: number | null; frozen?: boolean }, r: Pick<HaccpRules, "deliveryChilledMaxC" | "deliveryFrozenMaxC">) {
  const t = e.valueC == null ? true : e.valueC <= (e.frozen ? r.deliveryFrozenMaxC : r.deliveryChilledMaxC);
  return e.packagingOk && e.datesOk && t;
}

/** Is a task due on this day? */
export function taskDue(t: { frequency: string; weekday: number | null; dayOfMonth: number | null }, d: Date) {
  switch (t.frequency) {
    case "WEEKLY": return weekday(d) === (t.weekday ?? 1);
    case "MONTHLY": { const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(); return d.getUTCDate() === Math.min(t.dayOfMonth ?? 1, last); }
    default: return true; // OPENING, CLOSING, DAILY
  }
}

/** "08:00" → minutes after midnight */
export const minutesOf = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return (h || 0) * 60 + (m || 0); };
export const validTime = (s: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

export type Slot = { unitId: string; time: string; state: "DONE" | "OUT" | "DUE" | "LATE" | "LATER" };
/**
 * The temperature slots of a day and their state. A reading counts for the nearest slot it was taken for (the
 * entry stores its slot). "LATE": the slot's time + grace has passed (on today) or the day is over (earlier days).
 */
export function slotsFor(units: { id: string; times: string[] }[], entries: { unitId: string | null; slot: string | null; ok: boolean }[], day: Date, now: Date, graceMinutes: number): Slot[] {
  const today = dayKey(day) === dayKey(now), past = utcDay(day) < utcDay(now);
  const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  const out: Slot[] = [];
  for (const u of units) for (const time of u.times) {
    const e = entries.find((x) => x.unitId === u.id && x.slot === time);
    if (e) { out.push({ unitId: u.id, time, state: e.ok ? "DONE" : "OUT" }); continue; }
    const m = minutesOf(time);
    out.push({ unitId: u.id, time, state: past || (today && nowMin > m + graceMinutes) ? "LATE" : today && nowMin >= m - 60 ? "DUE" : "LATER" });
  }
  return out;
}

/** Completion of a day / period: done ÷ due (temperature slots + tasks). 100 when nothing is due. */
export function completion(due: number, done: number) {
  return due <= 0 ? 100 : Math.round((Math.min(done, due) / due) * 100);
}

/** Drift: a unit's recent readings creep towards its upper limit (or out of range repeatedly). */
export function drift(readings: number[], maxC: number | null, minC: number | null) {
  if (readings.length < 4) return null;
  const out = readings.filter((v) => !inRange(v, minC, maxC)).length;
  const avg = readings.reduce((a, v) => a + v, 0) / readings.length;
  if (out >= 3) return { kind: "OUT" as const, out, avg: Math.round(avg * 10) / 10 };
  if (maxC !== null && maxC > -100 && avg >= maxC - 1 && (minC === null || minC < maxC - 1)) return { kind: "NEAR_MAX" as const, out, avg: Math.round(avg * 10) / 10 };
  return null;
}

// ── templates ──────────────────────────────────────────────────────────────

export type TemplateUnit = { key: string; kind: UnitKind; times: string[] };
export type TemplateTask = { key: string; kind: TaskKind; frequency: TaskFrequency; weekday?: number; dayOfMonth?: number; items: string[] };
export type Template = { key: string; units: TemplateUnit[]; tasks: TemplateTask[] };
/**
 * Ready-made logbooks per kind of business. Names and checklist items are message keys (haccp.tpl.*) so each
 * business gets them in its language when the template is applied.
 */
export const TEMPLATES: Template[] = [
  {
    key: "RESTAURANT",
    units: [{ key: "fridge1", kind: "FRIDGE", times: ["09:00", "17:00"] }, { key: "fridge2", kind: "FRIDGE", times: ["09:00", "17:00"] }, { key: "freezer1", kind: "FREEZER", times: ["09:00"] }, { key: "hotHold", kind: "HOT_HOLD", times: ["12:30", "19:30"] }],
    tasks: [
      { key: "opening", kind: "CHECKLIST", frequency: "OPENING", items: ["handWash", "surfaces", "fridgesClosed", "staffHealth"] },
      { key: "closing", kind: "CHECKLIST", frequency: "CLOSING", items: ["foodCovered", "labelled", "binsEmptied", "floorsClean"] },
      { key: "dailyClean", kind: "CLEANING", frequency: "DAILY", items: ["worktops", "boards", "sinks", "floors"] },
      { key: "weeklyClean", kind: "CLEANING", frequency: "WEEKLY", weekday: 1, items: ["fridgeInside", "shelves", "extractor", "drains"] },
      { key: "monthlyClean", kind: "CLEANING", frequency: "MONTHLY", dayOfMonth: 1, items: ["behindEquipment", "walls", "storeroom"] },
    ],
  },
  {
    key: "CAFE",
    units: [{ key: "fridge1", kind: "FRIDGE", times: ["08:00", "16:00"] }, { key: "display", kind: "DISPLAY", times: ["08:00", "16:00"] }, { key: "freezer1", kind: "FREEZER", times: ["08:00"] }],
    tasks: [
      { key: "opening", kind: "CHECKLIST", frequency: "OPENING", items: ["handWash", "surfaces", "staffHealth"] },
      { key: "closing", kind: "CHECKLIST", frequency: "CLOSING", items: ["foodCovered", "labelled", "binsEmptied"] },
      { key: "dailyClean", kind: "CLEANING", frequency: "DAILY", items: ["worktops", "coffeeMachine", "floors"] },
      { key: "weeklyClean", kind: "CLEANING", frequency: "WEEKLY", weekday: 1, items: ["fridgeInside", "shelves"] },
    ],
  },
  {
    key: "SHOP",
    units: [{ key: "coldRoom", kind: "COLD_ROOM", times: ["09:00", "18:00"] }, { key: "display", kind: "DISPLAY", times: ["09:00", "18:00"] }, { key: "freezer1", kind: "FREEZER", times: ["09:00"] }],
    tasks: [
      { key: "opening", kind: "CHECKLIST", frequency: "OPENING", items: ["surfaces", "datesChecked", "staffHealth"] },
      { key: "closing", kind: "CHECKLIST", frequency: "CLOSING", items: ["fridgesClosed", "binsEmptied", "floorsClean"] },
      { key: "weeklyClean", kind: "CLEANING", frequency: "WEEKLY", weekday: 1, items: ["fridgeInside", "shelves", "storeroom"] },
    ],
  },
];
export const TEMPLATE_KEYS = TEMPLATES.map((t) => t.key);
