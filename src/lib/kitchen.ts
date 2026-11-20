/**
 * Phase 54 — menu costing & food waste: pure rules (settings, pack content from the pack name, units, recipe costing
 * with sub-recipes and yield, food cost %, price suggestions and rounding, menu engineering, waste summaries and
 * suggestions). No database; unit-tested.
 */

export const KITCHEN_TYPES = ["CUSTOMER", "WHOLESALER"] as const;
export const KITCHEN_PARTS = ["costing", "engineering", "priceSuggestions", "allergens", "waste", "wasteReports", "suggestions", "donations", "alerts"] as const;
export const WASTE_REASONS = ["EXPIRED", "SPOILED", "OVERPRODUCTION", "PLATE_WASTE", "DAMAGED", "PREP_LOSS", "OTHER"] as const;
export const LINE_UNITS = ["G", "KG", "ML", "L", "PCS"] as const;
export const WASTE_UNITS = ["G", "KG", "ML", "L", "PCS", "PACK", "PORTION"] as const;
export const ROUNDINGS = ["NONE", "0.05", "0.10", "0.50", "X.90"] as const;
export const COST_BASES = ["LAST", "AVERAGE"] as const;
export const BASE_UNITS = ["KG", "L", "PCS"] as const;

export type KitchenType = (typeof KITCHEN_TYPES)[number];
export type KitchenPart = (typeof KITCHEN_PARTS)[number];
export type WasteReasonT = (typeof WASTE_REASONS)[number];
export type LineUnit = (typeof LINE_UNITS)[number];
export type BaseUnit = (typeof BASE_UNITS)[number];
export type Rounding = (typeof ROUNDINGS)[number];
export type CostBasis = (typeof COST_BASES)[number];

export type KitchenSettings = {
  enabled: boolean;
  types: Record<KitchenType, boolean>;
  parts: Record<KitchenPart, boolean>;
  targetFoodCostPct: number; // default target; each business may set its own
  costBasis: CostBasis; // FIRINGI purchases: last price or the average of `averageDays`
  averageDays: number;
  rounding: Rounding;
  priceRiseAlertPct: number; // tell the business when an ingredient's cost rises this much
  wasteTargetPct: number; // waste cost as % of purchases
  useFirstDays: number; // lots expiring within these days are on the use-first list
  engineeringDays: number; // till sales looked at for menu engineering
  orderLessMinEntries: number; // waste entries in 30 days before "order less"
};

export const DEFAULT_KITCHEN_SETTINGS: KitchenSettings = {
  enabled: true,
  types: { CUSTOMER: true, WHOLESALER: false },
  parts: { costing: true, engineering: true, priceSuggestions: true, allergens: true, waste: true, wasteReports: true, suggestions: true, donations: true, alerts: true },
  targetFoodCostPct: 30,
  costBasis: "LAST",
  averageDays: 90,
  rounding: "0.10",
  priceRiseAlertPct: 5,
  wasteTargetPct: 4,
  useFirstDays: 3,
  engineeringDays: 30,
  orderLessMinEntries: 3,
};

const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const pick = <T extends string>(v: unknown, all: readonly T[], d: T) => ((all as readonly string[]).includes(v as string) ? (v as T) : d);
const flags = <K extends string>(keys: readonly K[], v: unknown, d: Record<K, boolean>) =>
  Object.fromEntries(keys.map((k) => [k, bool((v as Record<string, unknown> | null)?.[k], d[k])])) as Record<K, boolean>;

export function mergeKitchenSettings(v: Partial<KitchenSettings> | null | undefined): KitchenSettings {
  const d = DEFAULT_KITCHEN_SETTINGS, x = (v ?? {}) as Partial<KitchenSettings>;
  return {
    enabled: bool(x.enabled, d.enabled), types: flags(KITCHEN_TYPES, x.types, d.types), parts: flags(KITCHEN_PARTS, x.parts, d.parts),
    targetFoodCostPct: num(x.targetFoodCostPct, d.targetFoodCostPct), costBasis: pick(x.costBasis, COST_BASES, d.costBasis), averageDays: num(x.averageDays, d.averageDays),
    rounding: pick(x.rounding, ROUNDINGS, d.rounding), priceRiseAlertPct: num(x.priceRiseAlertPct, d.priceRiseAlertPct), wasteTargetPct: num(x.wasteTargetPct, d.wasteTargetPct),
    useFirstDays: num(x.useFirstDays, d.useFirstDays), engineeringDays: num(x.engineeringDays, d.engineeringDays), orderLessMinEntries: num(x.orderLessMinEntries, d.orderLessMinEntries),
  };
}

export function cleanKitchenSettings(v: KitchenSettings): KitchenSettings {
  const s = mergeKitchenSettings(v);
  const range = (n: number, lo: number, hi: number, label: string, int = true) => { if ((int && !Number.isInteger(n)) || n < lo || n > hi) throw new Error(`${label}: ${lo} to ${hi}.`); };
  range(s.targetFoodCostPct, 5, 90, "Target food cost %", false);
  range(s.averageDays, 7, 365, "Average over (days)");
  range(s.priceRiseAlertPct, 1, 100, "Price rise alert %", false);
  range(s.wasteTargetPct, 0.5, 50, "Waste target %", false);
  range(s.useFirstDays, 1, 14, "Use-first window (days)");
  range(s.engineeringDays, 7, 180, "Menu engineering period (days)");
  range(s.orderLessMinEntries, 1, 50, "Waste entries before “order less”");
  return s;
}

// ── units ────────────────────────────────────────────────────────────────────

const r = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;
export const money = (n: number) => Math.round(n * 100) / 100;

/** The base unit a line / waste unit belongs to and its factor (500 G = 0.5 KG). */
export function unitInfo(u: string): { base: BaseUnit | null; factor: number } {
  switch (u) {
    case "G": return { base: "KG", factor: 0.001 };
    case "KG": return { base: "KG", factor: 1 };
    case "ML": return { base: "L", factor: 0.001 };
    case "L": return { base: "L", factor: 1 };
    case "PCS": return { base: "PCS", factor: 1 };
    default: return { base: null, factor: 1 };
  }
}

/** A quantity in the ingredient's unit. KG ↔ L counts 1 kg = 1 l (and says so); pieces never convert. */
export function toBase(qty: number, unit: string, to: BaseUnit): { qty: number; approx: boolean; ok: boolean } {
  const u = unitInfo(unit);
  if (!u.base) return { qty: 0, approx: false, ok: false };
  if (u.base === to) return { qty: r(qty * u.factor, 6), approx: false, ok: true };
  if (u.base !== "PCS" && to !== "PCS") return { qty: r(qty * u.factor, 6), approx: true, ok: true };
  return { qty: 0, approx: false, ok: false };
}

/**
 * What one pack holds, from its name ("Case 6 × 2kg" → 12 KG, "Caixa 6 × 1L" → 6 L, "Case 24 × 33cl" → 7.92 L,
 * "Bundle of 100" → 100 PCS), else its net weight, else its units. The business can correct it.
 */
export function packContent(p: { name: string; unitsPerPack: number; netWeightKg?: number | null }): { size: number; unit: BaseUnit } {
  const n = p.name.toLowerCase().replace(",", ".");
  const m = n.match(/(?:(\d+)\s*[x×*]\s*)?(\d+(?:\.\d+)?)\s*(kg|g|gr|l|lt|cl|ml)\b/);
  if (m) {
    const count = m[1] ? Number(m[1]) : 1;
    const q = Number(m[2]);
    const unit = m[3];
    const per = unit === "kg" ? q : unit === "g" || unit === "gr" ? q / 1000 : unit === "l" || unit === "lt" ? q : unit === "cl" ? q / 100 : q / 1000;
    return { size: r(count * per), unit: unit.includes("g") ? "KG" : "L" };
  }
  if (p.netWeightKg && p.netWeightKg > 0) return { size: r(p.netWeightKg), unit: "KG" };
  return { size: Math.max(1, p.unitsPerPack || 1), unit: "PCS" };
}

/** Cost per base unit from what a pack cost. */
export const perUnit = (packPriceNet: number, packSize: number) => (packSize > 0 ? r(packPriceNet / packSize) : 0);

/** The cost basis for FIRINGI purchases: the last price paid, or the quantity-weighted average. */
export function purchaseCost(lines: { unitPriceNet: number; qty: number; at: Date }[], basis: CostBasis, since?: Date) {
  const sorted = [...lines].filter((l) => l.qty > 0).sort((a, b) => b.at.getTime() - a.at.getTime());
  if (!sorted.length) return null;
  if (basis === "LAST") return { packPrice: sorted[0].unitPriceNet, basis: "LAST" as const };
  const win = since ? sorted.filter((l) => l.at >= since) : sorted;
  const use = win.length ? win : sorted.slice(0, 1);
  const q = use.reduce((s, l) => s + l.qty, 0);
  return { packPrice: r(use.reduce((s, l) => s + l.unitPriceNet * l.qty, 0) / q), basis: "AVERAGE" as const };
}

// ── recipes ──────────────────────────────────────────────────────────────────

export type IngredientLite = { id: string; name: string; unit: BaseUnit; cost: number | null; yieldPct: number; allergens: string[]; co2PerUnit: number | null };
export type RecipeLite = {
  id: string; name: string; kind: "DISH" | "SUB"; yieldQty: number; yieldUnit: BaseUnit | null;
  lines: { ingredientId: string | null; subRecipeId: string | null; qty: number; unit: string }[];
};
export type LineCost = { name: string; qty: number; unit: string; cost: number; co2: number; missing: boolean; approx: boolean; badUnit: boolean };
export type RecipeCost = { batchCost: number; unitCost: number; co2PerUnit: number; allergens: string[]; lines: LineCost[]; missing: number; cycle: boolean };

/**
 * A recipe's cost: each line's quantity in the ingredient's unit, divided by its yield (500 g of onion at 90 % yield
 * needs 555 g bought), times the cost; sub-recipes at their cost per unit they make. `unitCost` is per portion (DISH)
 * or per kg / l / piece made (SUB). Cycles (A uses B uses A) are refused.
 */
export function costRecipe(id: string, recipes: Map<string, RecipeLite>, ingredients: Map<string, IngredientLite>, seen: string[] = [], memo = new Map<string, RecipeCost>()): RecipeCost {
  if (memo.has(id)) return memo.get(id)!;
  const rec = recipes.get(id);
  const empty: RecipeCost = { batchCost: 0, unitCost: 0, co2PerUnit: 0, allergens: [], lines: [], missing: 0, cycle: false };
  if (!rec) return empty;
  if (seen.includes(id)) return { ...empty, cycle: true };
  const lines: LineCost[] = [];
  const allergens = new Set<string>();
  let total = 0, co2 = 0, missing = 0, cycle = false;
  for (const l of rec.lines) {
    if (l.ingredientId) {
      const ing = ingredients.get(l.ingredientId);
      if (!ing) { missing++; continue; }
      const b = toBase(l.qty, l.unit, ing.unit);
      const bought = b.ok ? b.qty / Math.max(0.01, ing.yieldPct / 100) : 0;
      const cost = ing.cost == null ? 0 : bought * ing.cost;
      const c2 = ing.co2PerUnit == null ? 0 : bought * ing.co2PerUnit;
      if (ing.cost == null) missing++;
      if (!b.ok) missing++;
      ing.allergens.forEach((a) => allergens.add(a));
      total += cost; co2 += c2;
      lines.push({ name: ing.name, qty: l.qty, unit: l.unit, cost: r(cost), co2: r(c2), missing: ing.cost == null, approx: b.approx, badUnit: !b.ok });
    } else if (l.subRecipeId) {
      const sub = recipes.get(l.subRecipeId);
      const sc = costRecipe(l.subRecipeId, recipes, ingredients, [...seen, id], memo);
      if (!sub || sc.cycle) { cycle = cycle || sc.cycle; missing++; continue; }
      const b = sub.yieldUnit ? toBase(l.qty, l.unit, sub.yieldUnit) : { qty: l.qty, approx: false, ok: true };
      const cost = b.ok ? b.qty * sc.unitCost : 0;
      const c2 = b.ok ? b.qty * sc.co2PerUnit : 0;
      if (!b.ok || sc.missing) missing++;
      sc.allergens.forEach((a) => allergens.add(a));
      total += cost; co2 += c2;
      lines.push({ name: sub.name, qty: l.qty, unit: l.unit, cost: r(cost), co2: r(c2), missing: sc.missing > 0, approx: b.approx, badUnit: !b.ok });
    }
  }
  const per = Math.max(0.0001, rec.yieldQty || 1);
  const out: RecipeCost = { batchCost: r(total), unitCost: r(total / per), co2PerUnit: r(co2 / per), allergens: [...allergens].sort(), lines, missing, cycle };
  memo.set(id, out);
  return out;
}

/** Would adding `subId` to `recipeId` make a loop? */
export function makesCycle(recipeId: string, subId: string, recipes: Map<string, RecipeLite>): boolean {
  const stack = [subId];
  const seen = new Set<string>();
  while (stack.length) {
    const x = stack.pop()!;
    if (x === recipeId) return true;
    if (seen.has(x)) continue;
    seen.add(x);
    for (const l of recipes.get(x)?.lines ?? []) if (l.subRecipeId) stack.push(l.subRecipeId);
  }
  return false;
}

export const netOf = (gross: number, vatRate: number) => r(gross / (1 + vatRate / 100));
/** Food cost % of the price without VAT (null without a price). */
export const foodCostPct = (cost: number, priceGross: number | null, vatRate: number) => (priceGross && priceGross > 0 ? Math.round((cost / netOf(priceGross, vatRate)) * 1000) / 10 : null);
export const marginOf = (cost: number, priceGross: number | null, vatRate: number) => (priceGross ? money(netOf(priceGross, vatRate) - cost) : null);

/** Round a price incl. VAT up to the business's style (never below what hits the target). */
export function roundPrice(gross: number, rounding: Rounding) {
  if (rounding === "NONE") return money(gross);
  if (rounding === "X.90") { const f = Math.floor(gross); return money(gross <= f + 0.9 ? f + 0.9 : f + 1.9); }
  const step = Number(rounding);
  return money(Math.ceil(Math.round(gross * 1000) / 1000 / step - 1e-9) * step);
}

/** The price (incl. VAT) that brings the food cost to the target. */
export function suggestPrice(cost: number, targetPct: number, vatRate: number, rounding: Rounding) {
  if (cost <= 0 || targetPct <= 0) return null;
  const net = cost / (targetPct / 100);
  return roundPrice(net * (1 + vatRate / 100), rounding);
}

/** "If X gets Y % dearer": each dish's new cost, food cost % and the price that keeps the target. */
export function whatIf(dishes: { id: string; name: string; cost: number; ingredientShare: number; priceGross: number | null; vatRate: number; targetPct: number }[], risePct: number, rounding: Rounding) {
  return dishes.filter((d) => d.ingredientShare > 0).map((d) => {
    const cost = r(d.cost + d.ingredientShare * (risePct / 100));
    return { id: d.id, name: d.name, before: foodCostPct(d.cost, d.priceGross, d.vatRate), after: foodCostPct(cost, d.priceGross, d.vatRate), cost, suggested: suggestPrice(cost, d.targetPct, d.vatRate, rounding), over: (foodCostPct(cost, d.priceGross, d.vatRate) ?? 0) > d.targetPct };
  }).sort((a, b) => (b.after ?? 0) - (a.after ?? 0));
}

// ── menu engineering (Kasavana & Smith) ────────────────────────────────────────

export type EngClass = "STAR" | "PLOWHORSE" | "PUZZLE" | "DOG";
/**
 * Popular = sold at least 70 % of an equal share (1 / number of dishes); profitable = contribution margin per portion
 * at least the sales-weighted average. Stars (both), plough-horses (popular, low margin), puzzles (high margin,
 * not popular), dogs (neither).
 */
export function engineer(items: { id: string; name: string; sold: number; margin: number | null }[]) {
  const rows = items.filter((i) => i.margin != null);
  const total = rows.reduce((s, i) => s + i.sold, 0);
  if (!rows.length || total <= 0) return { avgMargin: null as number | null, popularAt: null as number | null, items: rows.map((i) => ({ ...i, mix: 0, cls: null as EngClass | null })) };
  const avgMargin = money(rows.reduce((s, i) => s + i.sold * i.margin!, 0) / total);
  const popularAt = Math.round((0.7 / rows.length) * 1000) / 10; // % of the sales mix
  return {
    avgMargin, popularAt,
    items: rows.map((i) => {
      const mix = Math.round((i.sold / total) * 1000) / 10;
      const pop = mix >= popularAt, prof = i.margin! >= avgMargin;
      return { ...i, mix, cls: (pop && prof ? "STAR" : pop ? "PLOWHORSE" : prof ? "PUZZLE" : "DOG") as EngClass };
    }).sort((a, b) => b.sold - a.sold),
  };
}

// ── waste ───────────────────────────────────────────────────────────────────

export type WasteLite = { at: Date; reason: string | null; label: string; ingredientId: string | null; cost: number; kg: number | null; co2: number | null };

/** Totals by reason and by item, and the share of purchases. */
export function wasteSummary(entries: WasteLite[], purchasesNet: number) {
  const byReason = new Map<string, { cost: number; kg: number; count: number }>();
  const byItem = new Map<string, { label: string; cost: number; kg: number; count: number }>();
  let cost = 0, kg = 0, co2 = 0;
  for (const e of entries) {
    cost += e.cost; kg += e.kg ?? 0; co2 += e.co2 ?? 0;
    const k = e.reason ?? "OTHER";
    const a = byReason.get(k) ?? { cost: 0, kg: 0, count: 0 };
    a.cost += e.cost; a.kg += e.kg ?? 0; a.count++; byReason.set(k, a);
    const ik = e.ingredientId ?? `label:${e.label.toLowerCase()}`;
    const b = byItem.get(ik) ?? { label: e.label, cost: 0, kg: 0, count: 0 };
    b.cost += e.cost; b.kg += e.kg ?? 0; b.count++; byItem.set(ik, b);
  }
  const rnd = <T extends { cost: number; kg: number }>(x: T) => ({ ...x, cost: money(x.cost), kg: r(x.kg, 3) });
  return {
    cost: money(cost), kg: r(kg, 3), co2: r(co2, 3), count: entries.length,
    pctOfPurchases: purchasesNet > 0 ? Math.round((cost / purchasesNet) * 1000) / 10 : null,
    byReason: [...byReason.entries()].map(([reason, v]) => ({ reason, ...rnd(v) })).sort((a, b) => b.cost - a.cost),
    byItem: [...byItem.entries()].map(([key, v]) => ({ key, ...rnd(v) })).sort((a, b) => b.cost - a.cost),
  };
}

/** Weekly totals for a chart (Monday-based ISO weeks, oldest first). */
export function weeklyWaste(entries: { at: Date; cost: number }[], now: Date, weeks = 8) {
  const monday = (d: Date) => { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x; };
  const start = monday(now);
  const keys = Array.from({ length: weeks }, (_, i) => { const d = new Date(start); d.setUTCDate(d.getUTCDate() - 7 * (weeks - 1 - i)); return d.toISOString().slice(0, 10); });
  const acc = new Map(keys.map((k) => [k, 0]));
  for (const e of entries) { const k = monday(e.at).toISOString().slice(0, 10); if (acc.has(k)) acc.set(k, acc.get(k)! + e.cost); }
  return keys.map((week) => ({ week, cost: money(acc.get(week)!) }));
}

/**
 * "Order less": ingredients wasted at least `minEntries` times (30 days) for reasons that point at buying too much
 * (expired, spoiled, overproduction); suggests cutting orders by the wasted share of what was bought (5–50 %).
 */
export function orderLess(items: { ingredientId: string; name: string; wasteEntries: number; wastedQty: number; boughtQty: number; reasons: string[] }[], minEntries: number) {
  const OVERBUY = new Set(["EXPIRED", "SPOILED", "OVERPRODUCTION"]);
  return items
    .filter((i) => i.wasteEntries >= minEntries && i.reasons.some((x) => OVERBUY.has(x)))
    .map((i) => ({ ...i, cutPct: i.boughtQty > 0 ? Math.min(50, Math.max(5, Math.round((i.wastedQty / i.boughtQty) * 100 / 5) * 5)) : 10 }))
    .sort((a, b) => b.wasteEntries - a.wasteEntries);
}

/** Days until a date (UTC days; 0 = today). */
export const daysUntil = (d: Date, now: Date) => Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) / 86_400_000);
