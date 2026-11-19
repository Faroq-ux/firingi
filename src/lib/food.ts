/**
 * Food information & allergens (Phase 44, EU 1169/2011) — constants and pure rules shared by server
 * and client code (no server imports here).
 */

/** The 14 allergens of EU 1169/2011 Annex II, in the order of the regulation. */
export const ALLERGENS = ["GLUTEN", "CRUSTACEANS", "EGGS", "FISH", "PEANUTS", "SOY", "MILK", "NUTS", "CELERY", "MUSTARD", "SESAME", "SULPHITES", "LUPIN", "MOLLUSCS"] as const;
export type Allergen = (typeof ALLERGENS)[number];
export const LEVELS = ["CONTAINS", "MAY_CONTAIN", "FREE"] as const;
export type Level = (typeof LEVELS)[number];
export type AllergenMap = Partial<Record<Allergen, Level>>;

/** Diet / quality claims a product can carry (with a certificate where one exists). */
export const DIETS = ["VEGAN", "VEGETARIAN", "HALAL", "KOSHER", "GLUTEN_FREE", "LACTOSE_FREE", "ORGANIC"] as const;
export type Diet = (typeof DIETS)[number];
/** Claims that need a certificate behind them. */
export const CERTIFIED_DIETS: Diet[] = ["HALAL", "KOSHER", "ORGANIC"];

/** What a category can require. */
export const FIELDS = ["ALLERGENS", "INGREDIENTS", "NUTRITION", "ORIGIN", "STORAGE", "SHELF_LIFE", "LABEL_PHOTO", "DIETS"] as const;
export type Field = (typeof FIELDS)[number];

export const NUTRIENTS = ["energyKj", "energyKcal", "fat", "saturates", "carbohydrate", "sugars", "fibre", "protein", "salt"] as const;
export type Nutrient = (typeof NUTRIENTS)[number];
/** The mandatory "big 7" (energy in kJ and kcal counted as one line each). */
export const MANDATORY_NUTRIENTS: Nutrient[] = ["energyKj", "energyKcal", "fat", "saturates", "carbohydrate", "sugars", "protein", "salt"];
export type Nutrition = { basis: "100g" | "100ml" } & Partial<Record<Nutrient, number>>;

export type FoodData = {
  allergens: AllergenMap;
  allergenDetail?: Partial<Record<Allergen, string>>;
  ingredients: Record<string, string>;
  nutrition: Nutrition | null;
  diets: string[];
  originCountryCode: string | null;
  storage: Record<string, string>;
  shelfLifeDays: number | null;
  afterOpeningDays: number | null;
  hasLabel?: boolean;
  certificates?: { diet: string; expiresOn?: string | Date | null }[];
};

// ── settings ────────────────────────────────────────────────────────────────

export type FoodSettings = {
  enabled: boolean;
  /** which parts of the data are collected / shown */
  parts: { allergens: boolean; ingredients: boolean; nutrition: boolean; diets: boolean; origin: boolean };
  /** FIRINGI checks every version before customers see it (off: a submitted version goes live at once) */
  review: boolean;
  /** food products are hidden from customers until their required data is approved */
  requireToSell: boolean;
  import: boolean;
  ai: boolean;
  /** customers */
  badges: boolean;
  filter: boolean;
  sheet: boolean;
  changeAlerts: boolean;
  /** customers who bought the product within this many days are told of recipe changes */
  alertDays: number;
  profile: boolean;
  /** resellers: public product page + shelf QR labels, and the data export */
  publicPage: boolean;
  export: boolean;
  /** FIRINGI */
  recallLink: boolean;
  certReminderDays: number[];
};

export const DEFAULT_FOOD_SETTINGS: FoodSettings = {
  enabled: true,
  parts: { allergens: true, ingredients: true, nutrition: true, diets: true, origin: true },
  review: true,
  requireToSell: false,
  import: true,
  ai: true,
  badges: true,
  filter: true,
  sheet: true,
  changeAlerts: true,
  alertDays: 365,
  profile: false,
  publicPage: true,
  export: true,
  recallLink: true,
  certReminderDays: [30, 14, 7],
};

export function mergeFoodSettings(raw: unknown): FoodSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<FoodSettings>;
  const b = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
  const parts = (r.parts ?? {}) as Partial<FoodSettings["parts"]>;
  const d = DEFAULT_FOOD_SETTINGS;
  const days = Array.isArray(r.certReminderDays) ? [...new Set(r.certReminderDays.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 180))].sort((a, z) => z - a) : d.certReminderDays;
  const alertDays = Number.isInteger(r.alertDays) && (r.alertDays as number) >= 30 && (r.alertDays as number) <= 730 ? (r.alertDays as number) : d.alertDays;
  return {
    enabled: b(r.enabled, d.enabled),
    parts: { allergens: b(parts.allergens, true), ingredients: b(parts.ingredients, true), nutrition: b(parts.nutrition, true), diets: b(parts.diets, true), origin: b(parts.origin, true) },
    review: b(r.review, d.review), requireToSell: b(r.requireToSell, d.requireToSell), import: b(r.import, d.import), ai: b(r.ai, d.ai),
    badges: b(r.badges, d.badges), filter: b(r.filter, d.filter), sheet: b(r.sheet, d.sheet), changeAlerts: b(r.changeAlerts, d.changeAlerts), alertDays,
    profile: b(r.profile, d.profile), publicPage: b(r.publicPage, d.publicPage), export: b(r.export, d.export), recallLink: b(r.recallLink, d.recallLink),
    certReminderDays: days.length ? days : d.certReminderDays,
  };
}

/** A field switched off in the settings is never required. */
const PART_OF: Partial<Record<Field, keyof FoodSettings["parts"]>> = { ALLERGENS: "allergens", INGREDIENTS: "ingredients", NUTRITION: "nutrition", DIETS: "diets", ORIGIN: "origin" };
export function activeFields(fields: Field[], s: FoodSettings): Field[] {
  return fields.filter((f) => !PART_OF[f] || s.parts[PART_OF[f]!]);
}

/** Category requirements: the nearest category on the path (child → root) that says something; null = not food. */
export function effectiveFields(chain: { foodRequirements: unknown }[]): Field[] | null {
  for (const c of chain) {
    const r = c.foodRequirements as { fields?: unknown } | null;
    if (r && Array.isArray(r.fields)) return r.fields.filter((f): f is Field => (FIELDS as readonly string[]).includes(f as string));
  }
  return null;
}

// ── completeness & checks ───────────────────────────────────────────────────

const nonEmpty = (o: Record<string, string> | null | undefined) => !!o && Object.values(o).some((v) => typeof v === "string" && v.trim().length > 0);

/** The required fields this data does not fill in. */
export function missingFields(d: FoodData, fields: Field[]): Field[] {
  return fields.filter((f) => {
    switch (f) {
      case "ALLERGENS": return ALLERGENS.some((a) => !d.allergens[a]);
      case "INGREDIENTS": return !nonEmpty(d.ingredients);
      case "NUTRITION": return !d.nutrition || MANDATORY_NUTRIENTS.some((n) => typeof d.nutrition![n] !== "number");
      case "ORIGIN": return !d.originCountryCode;
      case "STORAGE": return !nonEmpty(d.storage);
      case "SHELF_LIFE": return !d.shelfLifeDays;
      case "LABEL_PHOTO": return !d.hasLabel;
      case "DIETS": return false; // a product may simply have no diet claim
    }
  });
}

/** Share of the required fields filled in (100 when nothing is required). */
export function completeness(d: FoodData | null, fields: Field[]): number {
  if (!fields.length) return 100;
  if (!d) return 0;
  return Math.round(((fields.length - missingFields(d, fields).length) / fields.length) * 100);
}

export type Problem = { code: string; field: string; n?: string };

/** Things that cannot be right (refused when saving / submitting). */
export function problems(d: FoodData): Problem[] {
  const out: Problem[] = [];
  for (const [k, v] of Object.entries(d.allergens)) {
    if (!(ALLERGENS as readonly string[]).includes(k)) out.push({ code: "UNKNOWN_ALLERGEN", field: k });
    else if (!(LEVELS as readonly string[]).includes(v as string)) out.push({ code: "BAD_LEVEL", field: k });
  }
  const n = d.nutrition;
  if (n) {
    if (n.basis !== "100g" && n.basis !== "100ml") out.push({ code: "BAD_BASIS", field: "basis" });
    for (const k of NUTRIENTS) {
      const v = n[k];
      if (v == null) continue;
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0) out.push({ code: "NEGATIVE", field: k });
    }
    const g = (k: Nutrient) => (typeof n[k] === "number" ? (n[k] as number) : null);
    const grams = ["fat", "carbohydrate", "fibre", "protein", "salt"].reduce((s, k) => s + (g(k as Nutrient) ?? 0), 0);
    if (n.basis === "100g" && grams > 100.5) out.push({ code: "OVER_100G", field: "nutrition" });
    if (g("saturates") != null && g("fat") != null && g("saturates")! > g("fat")! + 0.05) out.push({ code: "SATURATES_GT_FAT", field: "saturates" });
    if (g("sugars") != null && g("carbohydrate") != null && g("sugars")! > g("carbohydrate")! + 0.05) out.push({ code: "SUGARS_GT_CARBS", field: "sugars" });
    // 1 kcal = 4.184 kJ — allow the rounding labels use (±5 % or 5 kJ)
    if (g("energyKj") != null && g("energyKcal") != null) {
      const want = g("energyKcal")! * 4.184;
      if (Math.abs(g("energyKj")! - want) > Math.max(5, want * 0.05)) out.push({ code: "ENERGY_MISMATCH", field: "energyKj" });
    }
    if (g("energyKcal") != null && g("energyKcal")! > 900) out.push({ code: "ENERGY_TOO_HIGH", field: "energyKcal" });
  }
  for (const x of d.diets) if (!(DIETS as readonly string[]).includes(x)) out.push({ code: "UNKNOWN_DIET", field: x });
  // claims that contradict the allergens
  const has = (a: Allergen) => d.allergens[a] === "CONTAINS";
  if (d.diets.includes("VEGAN") && (has("MILK") || has("EGGS") || has("FISH") || has("CRUSTACEANS") || has("MOLLUSCS"))) out.push({ code: "VEGAN_CONFLICT", field: "VEGAN" });
  if (d.diets.includes("VEGETARIAN") && (has("FISH") || has("CRUSTACEANS") || has("MOLLUSCS"))) out.push({ code: "VEGETARIAN_CONFLICT", field: "VEGETARIAN" });
  if (d.diets.includes("GLUTEN_FREE") && has("GLUTEN")) out.push({ code: "GLUTEN_FREE_CONFLICT", field: "GLUTEN_FREE" });
  if (d.diets.includes("LACTOSE_FREE") && has("MILK")) out.push({ code: "LACTOSE_CONFLICT", field: "LACTOSE_FREE", n: "warn" });
  if (d.originCountryCode && !/^[A-Z]{2}$/.test(d.originCountryCode)) out.push({ code: "BAD_COUNTRY", field: "originCountryCode" });
  if (d.shelfLifeDays != null && (!Number.isInteger(d.shelfLifeDays) || d.shelfLifeDays < 1 || d.shelfLifeDays > 3650)) out.push({ code: "BAD_DAYS", field: "shelfLifeDays" });
  if (d.afterOpeningDays != null && (!Number.isInteger(d.afterOpeningDays) || d.afterOpeningDays < 1 || d.afterOpeningDays > 3650)) out.push({ code: "BAD_DAYS", field: "afterOpeningDays" });
  for (const [lang, txt] of Object.entries(d.ingredients)) {
    if ((txt.match(/\*/g) ?? []).length % 2) out.push({ code: "UNBALANCED_STARS", field: lang });
    if (txt.length > 5000) out.push({ code: "TOO_LONG", field: lang });
  }
  // a certified claim needs its certificate (number or file) — a warning only
  for (const dt of CERTIFIED_DIETS) if (d.diets.includes(dt) && d.certificates && !d.certificates.some((c) => c.diet === dt)) out.push({ code: "NO_CERTIFICATE", field: dt, n: "warn" });
  return out;
}
export const blocking = (p: Problem[]) => p.filter((x) => x.n !== "warn");

// ── for buyers ──────────────────────────────────────────────────────────────

export function allergenLists(m: AllergenMap) {
  const of = (l: Level) => ALLERGENS.filter((a) => m[a] === l);
  return { contain: of("CONTAINS"), mayContain: of("MAY_CONTAIN"), free: of("FREE") };
}

/** Allergens of the customer's avoid list this product has. */
export function profileHits(p: { allergensContain: string[]; allergensMayContain: string[] }, avoid: string[], includeTraces: boolean) {
  return avoid.filter((a) => p.allergensContain.includes(a) || (includeTraces && p.allergensMayContain.includes(a)));
}

/** "Farinha de *trigo*" → [{t:"Farinha de "}, {t:"trigo", b:true}] (allergens emphasised, as the EU requires). */
export function ingredientSegments(text: string): { t: string; b?: boolean }[] {
  const out: { t: string; b?: boolean }[] = [];
  text.split(/(\*[^*]+\*)/g).forEach((part) => {
    if (!part) return;
    if (/^\*[^*]+\*$/.test(part)) out.push({ t: part.slice(1, -1), b: true });
    else out.push({ t: part });
  });
  return out;
}

/** The text for this language, else English, else Portuguese, else any (and which one it is). */
export function pickLang(m: Record<string, string> | null | undefined, locale: string): { text: string; lang: string } | null {
  if (!m) return null;
  const base = locale.split("-")[0];
  for (const k of [locale, base, "en", "pt-PT", "pt", ...Object.keys(m)]) if (m[k]?.trim()) return { text: m[k], lang: k };
  return null;
}

// ── recipe changes ──────────────────────────────────────────────────────────

export type FoodDiff = {
  allergensAdded: string[]; allergensRemoved: string[]; mayContainAdded: string[]; mayContainRemoved: string[];
  ingredients: boolean; nutrition: boolean; dietsAdded: string[]; dietsRemoved: string[];
};

export function diffFood(prev: FoodData | null, next: FoodData): FoodDiff | null {
  if (!prev) return null;
  const a = allergenLists(prev.allergens), b = allergenLists(next.allergens);
  const plus = (x: string[], y: string[]) => y.filter((v) => !x.includes(v));
  const norm = (o: Record<string, string>) => JSON.stringify(Object.keys(o).sort().map((k) => [k, (o[k] ?? "").trim().replace(/\s+/g, " ")]).filter(([, v]) => v));
  const nut = (n: Nutrition | null) => JSON.stringify(n ? [n.basis, ...NUTRIENTS.map((k) => n[k] ?? null)] : null);
  const d: FoodDiff = {
    allergensAdded: plus(a.contain, b.contain), allergensRemoved: plus(b.contain, a.contain),
    mayContainAdded: plus(a.mayContain, b.mayContain), mayContainRemoved: plus(b.mayContain, a.mayContain),
    ingredients: norm(prev.ingredients) !== norm(next.ingredients), nutrition: nut(prev.nutrition) !== nut(next.nutrition),
    dietsAdded: plus(prev.diets, next.diets), dietsRemoved: plus(next.diets, prev.diets),
  };
  const any = d.allergensAdded.length || d.allergensRemoved.length || d.mayContainAdded.length || d.mayContainRemoved.length || d.ingredients || d.nutrition || d.dietsAdded.length || d.dietsRemoved.length;
  return any ? d : null;
}
/** Worth telling customers about (nutrition-only tweaks are not). */
export const notable = (d: FoodDiff | null) => !!d && (d.allergensAdded.length > 0 || d.mayContainAdded.length > 0 || d.allergensRemoved.length > 0 || d.ingredients || d.dietsRemoved.length > 0 || d.dietsAdded.length > 0);

// ── GS1 (GDSN-style) import codes ───────────────────────────────────────────

/** GS1 allergen type codes (AllergenTypeCode) → ours. */
export const GS1_ALLERGEN: Record<string, Allergen> = {
  AW: "GLUTEN", AC: "CRUSTACEANS", AE: "EGGS", AF: "FISH", AP: "PEANUTS", AY: "SOY", AM: "MILK", AN: "NUTS",
  BC: "CELERY", BM: "MUSTARD", AS: "SESAME", AU: "SULPHITES", NL: "LUPIN", UM: "MOLLUSCS",
};
/** GS1 LevelOfContainmentCode → ours. */
export const GS1_LEVEL: Record<string, Level> = { CONTAINS: "CONTAINS", MAY_CONTAIN: "MAY_CONTAIN", FREE_FROM: "FREE", "": "FREE" };
/** GS1 nutrient type codes (INFOODS tagnames, as GDSN uses them) → ours. */
export const GS1_NUTRIENT: Record<string, Nutrient> = {
  "ENER-KJO": "energyKj", "ENER-E14": "energyKcal", FAT: "fat", FASAT: "saturates", CHOAVL: "carbohydrate", "SUGAR-": "sugars", SUGAR: "sugars", FIBTG: "fibre", "PRO-": "protein", PRO: "protein", SALTEQ: "salt",
};
/** Our level → a short mark for tables and PDFs. */
export const LEVEL_MARK: Record<Level, string> = { CONTAINS: "●", MAY_CONTAIN: "◐", FREE: "–" };
