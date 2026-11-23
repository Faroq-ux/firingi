/**
 * Services & used cooking oil (Phase 68) — the shared vocabulary and the pure maths: how often a service
 * runs (weekly, every 2 weeks, twice a month, monthly or only on request), the visit dates it gives, the
 * fryer oil status and how full the used-oil containers are. No server imports.
 */

export const FREQUENCIES = ["WEEKLY", "BIWEEKLY", "TWICE_MONTHLY", "MONTHLY", "ON_REQUEST"] as const;
export type Frequency = (typeof FREQUENCIES)[number];
export const FREQ_LABEL: Record<Frequency, string> = { WEEKLY: "Every week", BIWEEKLY: "Every 2 weeks", TWICE_MONTHLY: "Twice a month", MONTHLY: "Every month", ON_REQUEST: "Only when requested" };
/** visits a month, roughly (for comparing plans) */
export const VISITS_PER_MONTH: Record<Frequency, number> = { WEEKLY: 4.33, BIWEEKLY: 2.17, TWICE_MONTHLY: 2, MONTHLY: 1, ON_REQUEST: 0 };

export const WINDOWS = ["ANY", "MORNING", "AFTERNOON"] as const;
export type TimeWindow = (typeof WINDOWS)[number];

export const SERVICE_UNITS = ["L", "KG", "BIN", "VISIT"] as const;
export type ServiceUnit = (typeof SERVICE_UNITS)[number];

export const VISIT_STATUSES = ["REQUESTED", "SCHEDULED", "CONFIRMED", "DONE", "MISSED", "SKIPPED", "CANCELLED"] as const;
export type VisitStatus = (typeof VISIT_STATUSES)[number];
export const OPEN_VISIT: VisitStatus[] = ["REQUESTED", "SCHEDULED", "CONFIRMED"];

export type PlanSchedule = { frequency: Frequency; weekday: number; dayA: number; dayB: number; startsOn: Date };
const DAY = 86400_000;
const utcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const weekdayOf = (d: Date) => ((d.getUTCDay() + 6) % 7) + 1; // 1 = Monday … 7 = Sunday
export const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The visit dates of a plan from `from` up to `to` (both days included, UTC days).
 * Weekly: every chosen weekday. Every 2 weeks: the chosen weekday, every other week counted from the start.
 * Twice a month: days A and B of each month. Monthly: day A. Days above 28 move to the month's last day.
 */
export function visitDates(p: PlanSchedule, from: Date, to: Date): Date[] {
  if (p.frequency === "ON_REQUEST") return [];
  const start = utcDay(p.startsOn > from ? p.startsOn : from), end = utcDay(to);
  const out: Date[] = [];
  if (p.frequency === "WEEKLY" || p.frequency === "BIWEEKLY") {
    // the first chosen weekday on or after the plan's start = week 0
    const s0 = utcDay(p.startsOn);
    const first = new Date(s0.getTime() + (((p.weekday - weekdayOf(s0)) + 7) % 7) * DAY);
    for (let t = first.getTime(); t <= end.getTime(); t += 7 * DAY) {
      const d = new Date(t);
      if (d < start) continue;
      const week = Math.round((t - first.getTime()) / (7 * DAY));
      if (p.frequency === "WEEKLY" || week % 2 === 0) out.push(d);
    }
    return out;
  }
  const days = p.frequency === "TWICE_MONTHLY" ? [...new Set([p.dayA, p.dayB])].sort((a, b) => a - b) : [p.dayA];
  for (let y = start.getUTCFullYear(), m = start.getUTCMonth(); Date.UTC(y, m, 1) <= end.getTime(); m === 11 ? (y++, m = 0) : m++) {
    const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    for (const day of days) {
      const d = new Date(Date.UTC(y, m, Math.min(day, last)));
      if (d >= start && d <= end) out.push(d);
    }
  }
  return out;
}
export const nextVisit = (p: PlanSchedule, from: Date) => visitDates(p, from, new Date(from.getTime() + 70 * DAY))[0] ?? null;

export function scheduleWords(p: Pick<PlanSchedule, "frequency" | "weekday" | "dayA" | "dayB">, weekdays: string[] = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]) {
  switch (p.frequency) {
    case "WEEKLY": return `every ${weekdays[p.weekday - 1]}`;
    case "BIWEEKLY": return `every other ${weekdays[p.weekday - 1]}`;
    case "TWICE_MONTHLY": return `on day ${p.dayA} and ${p.dayB}`;
    case "MONTHLY": return `on day ${p.dayA}`;
    case "ON_REQUEST": return "when requested";
  }
}

// ── fryers & used oil ───────────────────────────────────────────────────────

export type OilRules = { changeDays: number; warnPolarPct: number; maxPolarPct: number; fullPct: number };
export const DEFAULT_OIL: OilRules = { changeDays: 7, warnPolarPct: 20, maxPolarPct: 24, fullPct: 80 };
export type FryerStatus = "OK" | "SOON" | "CHANGE";
/**
 * Change the oil at the limit of polar compounds (EU practice: 24–27 %) or after the set days; "soon" from the
 * warning % or one day before. Without a test, days since the last change decide.
 */
export function fryerStatus(f: { lastChangeAt: Date | null; lastPolarPct: number | null }, r: OilRules, now: Date): { status: FryerStatus; days: number | null } {
  const days = f.lastChangeAt ? Math.floor((now.getTime() - f.lastChangeAt.getTime()) / DAY) : null;
  if (f.lastPolarPct !== null && f.lastPolarPct >= r.maxPolarPct) return { status: "CHANGE", days };
  if (days !== null && days >= r.changeDays) return { status: "CHANGE", days };
  if ((f.lastPolarPct !== null && f.lastPolarPct >= r.warnPolarPct) || (days !== null && days >= r.changeDays - 1)) return { status: "SOON", days };
  return { status: "OK", days };
}
/** Used oil waiting for collection, and how full the containers are (null = no container size known). */
export function storage(litres: number, capacity: number | null, fullPct: number) {
  const pct = capacity && capacity > 0 ? Math.min(999, Math.round((litres / capacity) * 100)) : null;
  return { litres: Math.round(litres * 10) / 10, capacity, pct, full: pct !== null && pct >= fullPct };
}

export const INVOICED_BY = ["FIRINGI", "PROVIDER"] as const;
export type InvoicedBy = (typeof INVOICED_BY)[number];
export type Pricing = { feeNet: number; pricePerUnit: number; buybackPerUnit: number; providerPerVisit: number; providerPerUnit: number; commissionPct: number; commissionPerVisit: number; commissionPerUnit: number };
/**
 * What a finished visit is worth.
 *   FIRINGI invoices the customer: fee (per visit + per unit) to the customer, buy-back paid to the customer by FIRINGI,
 *   the provider's amount paid by FIRINGI; no commission (FIRINGI keeps the difference).
 *   The provider invoices the customer: the same fee and buy-back, between them; FIRINGI's commission = % of the fee +
 *   per visit + per unit, invoiced to the provider (monthly); FIRINGI pays nobody.
 */
export function visitMoney(t: Pricing, qty: number, by: InvoicedBy) {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const q = Math.max(0, qty);
  const fee = r2(t.feeNet + t.pricePerUnit * q), buyback = r2(t.buybackPerUnit * q);
  if (by === "PROVIDER") return { fee, buyback, provider: 0, commission: r2((fee * t.commissionPct) / 100 + t.commissionPerVisit + t.commissionPerUnit * q) };
  return { fee, buyback, provider: r2(t.providerPerVisit + t.providerPerUnit * q), commission: 0 };
}

// ── built-in service types (FIRINGI can add more) ───────────────────────────

export type ServiceTemplate = { code: string; kind: "COLLECTION" | "VISIT"; unit: ServiceUnit; isOil: boolean; wasteCode: string | null; needsDocument: boolean; frequencies: Frequency[]; invoicedBy: InvoicedBy } & Pricing;
export const BUILT_IN_SERVICES: ServiceTemplate[] = [
  { code: "OIL_COLLECTION", kind: "COLLECTION", unit: "L", isOil: true, wasteCode: "20 01 25", needsDocument: true, frequencies: ["WEEKLY", "BIWEEKLY", "TWICE_MONTHLY", "MONTHLY", "ON_REQUEST"], feeNet: 0, pricePerUnit: 0, buybackPerUnit: 0.2, providerPerVisit: 0, providerPerUnit: 0.05, invoicedBy: "FIRINGI", commissionPct: 0, commissionPerVisit: 0, commissionPerUnit: 0.03 },
  { code: "GREASE_TRAP", kind: "VISIT", unit: "VISIT", isOil: false, wasteCode: "19 08 09", needsDocument: true, frequencies: ["MONTHLY", "TWICE_MONTHLY", "ON_REQUEST"], feeNet: 65, pricePerUnit: 0, buybackPerUnit: 0, providerPerVisit: 50, providerPerUnit: 0, invoicedBy: "FIRINGI", commissionPct: 15, commissionPerVisit: 0, commissionPerUnit: 0 },
  { code: "PEST_CONTROL", kind: "VISIT", unit: "VISIT", isOil: false, wasteCode: null, needsDocument: true, frequencies: ["MONTHLY", "TWICE_MONTHLY", "ON_REQUEST"], feeNet: 45, pricePerUnit: 0, buybackPerUnit: 0, providerPerVisit: 35, providerPerUnit: 0, invoicedBy: "PROVIDER", commissionPct: 15, commissionPerVisit: 0, commissionPerUnit: 0 },
  { code: "HOOD_CLEANING", kind: "VISIT", unit: "VISIT", isOil: false, wasteCode: null, needsDocument: false, frequencies: ["MONTHLY", "ON_REQUEST"], feeNet: 90, pricePerUnit: 0, buybackPerUnit: 0, providerPerVisit: 70, providerPerUnit: 0, invoicedBy: "PROVIDER", commissionPct: 12, commissionPerVisit: 0, commissionPerUnit: 0 },
];
/** Built-in service names in the 25 languages (FIRINGI can rename them; its own names win). */
export const BUILT_IN_NAMES: Record<string, Record<string, string>> = {
  OIL_COLLECTION: {
    en: "Used cooking oil collection", "pt-PT": "Recolha de óleo alimentar usado", es: "Recogida de aceite de cocina usado", fr: "Collecte d'huile de friture usagée", de: "Altspeiseöl-Abholung",
    it: "Raccolta olio da cucina esausto", nl: "Inzameling gebruikt frituurvet", pl: "Odbiór zużytego oleju spożywczego", ro: "Colectare ulei alimentar uzat", cs: "Svoz použitého kuchyňského oleje",
    sk: "Zber použitého kuchynského oleja", hu: "Használt sütőolaj elszállítása", hr: "Prikupljanje otpadnog jestivog ulja", sl: "Zbiranje odpadnega jedilnega olja", bg: "Събиране на отработено олио",
    el: "Συλλογή χρησιμοποιημένου μαγειρικού λαδιού", da: "Afhentning af brugt fritureolie", sv: "Insamling av använd frityrolja", fi: "Käytetyn paistoöljyn keräys", et: "Kasutatud toiduõli kogumine",
    lv: "Lietotas cepamās eļļas savākšana", lt: "Panaudoto kepimo aliejaus surinkimas", mt: "Ġbir ta' żejt tat-tisjir użat", nb: "Innsamling av brukt frityrolje", is: "Söfnun notaðrar steikingarolíu",
  },
  GREASE_TRAP: {
    en: "Grease trap cleaning", "pt-PT": "Limpeza de separador de gorduras", es: "Limpieza de separador de grasas", fr: "Nettoyage du bac à graisse", de: "Fettabscheider-Reinigung",
    it: "Pulizia degrassatore", nl: "Vetafscheider reinigen", pl: "Czyszczenie separatora tłuszczu", ro: "Curățare separator de grăsimi", cs: "Čištění lapače tuků",
    sk: "Čistenie lapača tukov", hu: "Zsírfogó tisztítása", hr: "Čišćenje mastolova", sl: "Čiščenje lovilca maščob", bg: "Почистване на мазниноуловител",
    el: "Καθαρισμός λιποσυλλέκτη", da: "Rensning af fedtudskiller", sv: "Tömning av fettavskiljare", fi: "Rasvanerottimen tyhjennys", et: "Rasvapüüduri puhastus",
    lv: "Tauku atdalītāja tīrīšana", lt: "Riebalų gaudyklės valymas", mt: "Tindif tal-grease trap", nb: "Tømming av fettutskiller", is: "Hreinsun fitugildru",
  },
  PEST_CONTROL: {
    en: "Pest control", "pt-PT": "Controlo de pragas", es: "Control de plagas", fr: "Lutte contre les nuisibles", de: "Schädlingsbekämpfung",
    it: "Disinfestazione", nl: "Ongediertebestrijding", pl: "Zwalczanie szkodników", ro: "Combaterea dăunătorilor", cs: "Deratizace a dezinsekce",
    sk: "Deratizácia a dezinsekcia", hu: "Kártevőirtás", hr: "Suzbijanje štetnika", sl: "Zatiranje škodljivcev", bg: "Контрол на вредители",
    el: "Απεντόμωση και μυοκτονία", da: "Skadedyrsbekæmpelse", sv: "Skadedjursbekämpning", fi: "Tuholaistorjunta", et: "Kahjuritõrje",
    lv: "Kaitēkļu apkarošana", lt: "Kenkėjų kontrolė", mt: "Kontroll tal-pesti", nb: "Skadedyrkontroll", is: "Meindýravarnir",
  },
  HOOD_CLEANING: {
    en: "Kitchen hood & duct cleaning", "pt-PT": "Limpeza de exaustores e condutas", es: "Limpieza de campanas y conductos", fr: "Nettoyage des hottes et conduits", de: "Dunstabzug- und Kanalreinigung",
    it: "Pulizia cappe e condotti", nl: "Reiniging afzuigkappen en kanalen", pl: "Czyszczenie okapów i kanałów", ro: "Curățare hote și tubulatură", cs: "Čištění digestoří a potrubí",
    sk: "Čistenie digestorov a potrubí", hu: "Elszívóernyő és légcsatorna tisztítása", hr: "Čišćenje napa i kanala", sl: "Čiščenje nap in kanalov", bg: "Почистване на аспирации и въздуховоди",
    el: "Καθαρισμός απορροφητήρων και αεραγωγών", da: "Rensning af emhætter og kanaler", sv: "Rengöring av köksfläktar och kanaler", fi: "Liesituulettimien ja kanavien puhdistus", et: "Kubude ja õhukanalite puhastus",
    lv: "Tvaika nosūcēju un kanālu tīrīšana", lt: "Gartraukių ir ortakių valymas", mt: "Tindif tal-hoods u d-dakts", nb: "Rengjøring av kjøkkenvifter og kanaler", is: "Hreinsun eldhúsviftna og loftstokka",
  },
};
/** A service's name in the viewer's language (its own translation, the language without region, then English). */
export function localName(name: unknown, code: string, locale = "en") {
  const n = (name ?? {}) as Record<string, string>;
  return n[locale] ?? n[locale.split("-")[0]] ?? (locale.startsWith("pt") ? n.pt : undefined) ?? n.en ?? code;
}

export const OIL_LOG_KINDS = ["TOP_UP", "CHANGE", "TEST", "FILTER"] as const;
export type OilLogKind = (typeof OIL_LOG_KINDS)[number];
