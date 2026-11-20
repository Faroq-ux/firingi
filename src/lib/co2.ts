/**
 * Sustainability & CO₂ (Phase 51) — pure rules. Footprints are kg CO₂e:
 *   product   = kg of product × kg CO₂e per kg (the supplier's checked value, else its category's, else FIRINGI's default)
 *   packaging = items × FIRINGI's factor per item for the packaging type
 *   delivery  = road km (straight line × road factor) × tonnes delivered × factor per tonne-km for the vehicle's fuel
 *   local     = the supplier's warehouse within FIRINGI's "local" distance of the delivery address
 * Category defaults are cradle-to-gate averages (Poore & Nemecek 2018 and similar public tables) — FIRINGI edits them.
 */
export const PACKAGINGS = ["CARDBOARD", "PLASTIC", "GLASS", "METAL", "RETURNABLE", "MIXED", "NONE"] as const;
export type Packaging = (typeof PACKAGINGS)[number];
export const FUELS = ["DIESEL", "PETROL", "HYBRID", "LPG", "ELECTRIC"] as const;
export type Fuel = (typeof FUELS)[number];

export type Co2Settings = {
  enabled: boolean;
  /** what the footprint counts */
  parts: { products: boolean; delivery: boolean; packaging: boolean; local: boolean };
  /** what people see */
  show: { badges: boolean; orders: boolean; reports: boolean; export: boolean; alternatives: boolean; goals: boolean; supplierScore: boolean };
  buyers: { CUSTOMER: boolean; WHOLESALER: boolean };
  /** suppliers that may enter their own values */
  suppliers: { WHOLESALER: boolean; DISTRIBUTOR: boolean };
  /** ALWAYS = FIRINGI checks each supplier value; AUTO = used at once */
  approval: "ALWAYS" | "AUTO";
  /** "Low CO₂" when the product's kg/kg is at most this % of its category's */
  lowPct: number;
  localKm: number;
  roadFactor: number;
  /** kg CO₂e per tonne-km by fuel (light commercial vehicles) */
  fuels: Record<Fuel, number>;
  defaultFuel: Fuel;
  /** kg CO₂e per item by packaging type */
  packaging: Record<Packaging, number>;
  /** kg CO₂e per kg for products whose category has no value */
  fallbackKgPerKg: number;
  /** kg per unit when a pack has no net weight */
  fallbackUnitKg: number;
};

export const DEFAULT_CO2_SETTINGS: Co2Settings = {
  enabled: true,
  parts: { products: true, delivery: true, packaging: true, local: true },
  show: { badges: true, orders: true, reports: true, export: true, alternatives: true, goals: true, supplierScore: true },
  buyers: { CUSTOMER: true, WHOLESALER: true },
  suppliers: { WHOLESALER: true, DISTRIBUTOR: true },
  approval: "ALWAYS",
  lowPct: 70,
  localKm: 150,
  roadFactor: 1.3,
  fuels: { DIESEL: 0.6, PETROL: 0.65, HYBRID: 0.45, LPG: 0.5, ELECTRIC: 0.12 },
  defaultFuel: "DIESEL",
  packaging: { CARDBOARD: 0.02, PLASTIC: 0.04, GLASS: 0.25, METAL: 0.1, RETURNABLE: 0.005, MIXED: 0.06, NONE: 0 },
  fallbackKgPerKg: 2,
  fallbackUnitKg: 0.5,
};

/** FIRINGI's starting values per category slug (kg CO₂e per kg of product). */
export const DEFAULT_CATEGORY_FACTORS: Record<string, number> = {
  "kebab-meat": 30, "cheese-dairy": 12, "flour-dough": 1.4, "rice-pasta": 2.5, "oils-vinegar": 4, "canned-goods": 2, spices: 3,
  "fresh-produce": 0.6, fruit: 0.7, vegetables: 0.5, beverages: 0.6, water: 0.2, "soft-drinks": 0.4, juices: 0.9,
  "alcoholic-beverages": 1.5, beer: 1, wine: 1.8, spirits: 2.5, sauces: 2, groceries: 2, "kebab-pizza-supplies": 3,
  "packaging-supplies": 2, "pizza-kebab-packaging": 2,
};

export function mergeCo2Settings(v: Partial<Co2Settings> | null | undefined): Co2Settings {
  const d = DEFAULT_CO2_SETTINGS, x = v ?? {};
  return {
    ...d, ...x, parts: { ...d.parts, ...(x.parts ?? {}) }, show: { ...d.show, ...(x.show ?? {}) }, buyers: { ...d.buyers, ...(x.buyers ?? {}) },
    suppliers: { ...d.suppliers, ...(x.suppliers ?? {}) }, fuels: { ...d.fuels, ...(x.fuels ?? {}) }, packaging: { ...d.packaging, ...(x.packaging ?? {}) },
  };
}

export function cleanCo2Settings(i: Co2Settings): Co2Settings {
  const n = (x: unknown, lo: number, hi: number, label: string) => { const v = Number(x); if (!Number.isFinite(v) || v < lo || v > hi) throw new Error(`${label} must be between ${lo} and ${hi}.`); return v; };
  const flags = <K extends string>(o: Record<K, boolean> | undefined, keys: readonly K[]) => Object.fromEntries(keys.map((k) => [k, !!o?.[k]])) as Record<K, boolean>;
  return {
    enabled: !!i.enabled,
    parts: flags(i.parts, ["products", "delivery", "packaging", "local"] as const),
    show: flags(i.show, ["badges", "orders", "reports", "export", "alternatives", "goals", "supplierScore"] as const),
    buyers: flags(i.buyers, ["CUSTOMER", "WHOLESALER"] as const), suppliers: flags(i.suppliers, ["WHOLESALER", "DISTRIBUTOR"] as const),
    approval: i.approval === "AUTO" ? "AUTO" : "ALWAYS",
    lowPct: n(i.lowPct, 10, 100, "Low CO₂ threshold"), localKm: n(i.localKm, 5, 2000, "Local distance"), roadFactor: n(i.roadFactor, 1, 2, "Road factor"),
    fuels: Object.fromEntries(FUELS.map((f) => [f, n(i.fuels?.[f], 0, 5, `Fuel factor (${f})`)])) as Record<Fuel, number>,
    defaultFuel: (FUELS as readonly string[]).includes(i.defaultFuel) ? i.defaultFuel : "DIESEL",
    packaging: Object.fromEntries(PACKAGINGS.map((p) => [p, n(i.packaging?.[p], 0, 5, `Packaging factor (${p})`)])) as Record<Packaging, number>,
    fallbackKgPerKg: n(i.fallbackKgPerKg, 0, 200, "Fallback factor"), fallbackUnitKg: n(i.fallbackUnitKg, 0.001, 1000, "Fallback weight"),
  };
}

const r3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;

/** Straight-line km between two points (haversine). */
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371, rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** kg of product in one pack (net weight, else items × FIRINGI's fallback). */
export const packKg = (p: { netWeightKg: number | null; unitsPerPack: number }, s: Pick<Co2Settings, "fallbackUnitKg">) => (p.netWeightKg && p.netWeightKg > 0 ? p.netWeightKg : Math.max(1, p.unitsPerPack) * s.fallbackUnitKg);

/** One pack's footprint: product + packaging (kg CO₂e). */
export function packFootprint(p: { kgPerKg: number; netKg: number; unitsPerPack: number; packaging: Packaging | null }, s: Pick<Co2Settings, "parts" | "packaging">) {
  const product = s.parts.products ? p.kgPerKg * p.netKg : 0;
  const packaging = s.parts.packaging && p.packaging ? (s.packaging[p.packaging] ?? 0) * Math.max(1, p.unitsPerPack) : 0;
  return { product: r3(product), packaging: r3(packaging), total: r3(product + packaging) };
}

/** Delivery footprint (kg CO₂e) for a weight over a straight-line distance. */
export function deliveryFootprint(straightKm: number, weightKg: number, fuel: Fuel, s: Pick<Co2Settings, "roadFactor" | "fuels">) {
  return r3(straightKm * s.roadFactor * (weightKg / 1000) * (s.fuels[fuel] ?? s.fuels.DIESEL));
}

/** Badges for a pack: low CO₂ (against its category), local, eco packaging. */
export function badges(p: { kgPerKg: number; categoryKgPerKg: number; packaging: Packaging | null; recyclable: boolean; local: boolean | null }, s: Pick<Co2Settings, "lowPct" | "parts">) {
  const out: ("LOW_CO2" | "LOCAL" | "ECO_PACKAGING")[] = [];
  if (s.parts.products && p.categoryKgPerKg > 0 && p.kgPerKg <= (p.categoryKgPerKg * s.lowPct) / 100) out.push("LOW_CO2");
  if (s.parts.local && p.local) out.push("LOCAL");
  if (s.parts.packaging && (p.packaging === "RETURNABLE" || p.packaging === "NONE" || (p.recyclable && p.packaging !== "MIXED" && p.packaging !== null))) out.push("ECO_PACKAGING");
  return out;
}

/** A supplier's green grade from its offers: kg/kg against the categories, eco packaging and the share with checked values. */
export function supplierGrade(offers: { ratio: number; eco: boolean; own: boolean }[]) {
  if (!offers.length) return { grade: null as null | "A" | "B" | "C" | "D" | "E", score: 0 };
  const avgRatio = offers.reduce((a, o) => a + o.ratio, 0) / offers.length; // 1 = as its category
  const eco = offers.filter((o) => o.eco).length / offers.length, own = offers.filter((o) => o.own).length / offers.length;
  // ratio 0.5 (half its category) or better → full 60 points; 1.0 → 30; 1.5 or worse → 0
  const ratioScore = Math.max(0, Math.min(1, 1.5 - avgRatio));
  const score = Math.round(60 * ratioScore + 25 * eco + 15 * own);
  const grade = score >= 80 ? "A" : score >= 65 ? "B" : score >= 50 ? "C" : score >= 35 ? "D" : "E";
  return { grade: grade as "A" | "B" | "C" | "D" | "E", score };
}

/** Progress against a yearly goal: this year so far vs the same period last year. */
export function goalProgress(thisYearKg: number, sameTimeLastYearKg: number, reductionPct: number) {
  const target = sameTimeLastYearKg * (1 - reductionPct / 100);
  const change = sameTimeLastYearKg > 0 ? Math.round(((thisYearKg - sameTimeLastYearKg) / sameTimeLastYearKg) * 1000) / 10 : null;
  return { target: r3(target), change, onTrack: sameTimeLastYearKg > 0 ? thisYearKg <= target : null };
}
