/**
 * Menu costing & food waste (Phase 54) for restaurants and shops (and wholesalers where FIRINGI allows it), in the
 * buyer portal. Ingredients bought on FIRINGI take their cost from what the business paid (last price or average),
 * per kg / l / piece; others are entered by hand; each has a yield (prep loss). Recipes — dishes and sub-recipes —
 * are costed per portion with food cost %, margin, a target and a suggested price, allergens (from the products'
 * food information) and CO₂ per dish; menu engineering from till sales. The waste log (phone-first) costs each entry
 * and its CO₂, from purchased lots where possible; reports against a target; suggestions (order less, use first);
 * donations apart from waste. A daily job recomputes costs and sends the alerts.
 * Every part is FIRINGI's switch (Settings › Menu Costing & Waste), per business type and per business.
 */
import "server-only";
import type { Prisma, KitchenUnit, WasteReason } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";
import { notify } from "@/server/notify/dispatch";
import { pickLocalized } from "@/i18n/config";
import { allergenLists, type AllergenMap, ALLERGENS } from "@/lib/food";
import {
  BASE_UNITS, COST_BASES, LINE_UNITS, ROUNDINGS, WASTE_REASONS, WASTE_UNITS, cleanKitchenSettings, costRecipe, daysUntil, engineer, foodCostPct, makesCycle, marginOf,
  mergeKitchenSettings, money, netOf, orderLess, packContent, perUnit, purchaseCost, roundPrice, suggestPrice, toBase, wasteSummary, weeklyWaste, whatIf,
  type BaseUnit, type CostBasis, type IngredientLite, type KitchenPart, type KitchenSettings, type KitchenType, type RecipeLite, type Rounding,
} from "@/lib/kitchen";

const KEY = "kitchen.settings";
const FEATURE = "KITCHEN";
const DAY = 86_400_000;
const LIVE_STATUSES = ["CANCELLED", "RETURNED"] as const;
const n = (v: unknown) => (v == null ? null : Number(v));

// ── settings, switches, access ──────────────────────────────────────────────

export async function kitchenSettings(): Promise<KitchenSettings> {
  const row = await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: KEY } });
  return mergeKitchenSettings(row?.value as Partial<KitchenSettings> | null);
}

function firingiAdmin(ctx: Ctx) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, "admin.settings.manage")) throw new ForbiddenError();
}

export async function saveKitchenSettings(ctx: Ctx, input: KitchenSettings) {
  firingiAdmin(ctx);
  let v: KitchenSettings;
  try { v = cleanKitchenSettings(input); } catch (e) { throw new ValidationError((e as Error).message); }
  const before = await kitchenSettings();
  await prisma.setting.upsert({
    where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key: KEY } },
    create: { scope: "GLOBAL", scopeId: "", key: KEY, value: v as unknown as Prisma.InputJsonValue },
    update: { value: v as unknown as Prisma.InputJsonValue },
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "kitchen.settings_saved", entityType: "Setting", entityId: KEY, before, after: v });
  return v;
}

type Switch = "DEFAULT" | "ON" | "OFF";
export async function kitchenSwitch(companyId: string): Promise<Switch> {
  const f = await prisma.companyFeature.findUnique({ where: { companyId_key: { companyId, key: FEATURE } } });
  return !f ? "DEFAULT" : f.enabled ? "ON" : "OFF";
}

export async function setKitchenSwitch(ctx: Ctx, companyId: string, state: Switch) {
  firingiAdmin(ctx);
  const co = await prisma.company.findUnique({ where: { id: companyId }, select: { type: true } });
  if (!co || co.type === "ADMIN" || co.type === "DISTRIBUTOR") throw new NotFoundError("Business");
  if (state === "DEFAULT") await prisma.companyFeature.deleteMany({ where: { companyId, key: FEATURE } });
  else await prisma.companyFeature.upsert({ where: { companyId_key: { companyId, key: FEATURE } }, create: { companyId, key: FEATURE, enabled: state === "ON", updatedById: ctx.user.id }, update: { enabled: state === "ON", updatedById: ctx.user.id } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "kitchen.company_switch", entityType: "Company", entityId: companyId, after: { state } });
}

export async function kitchenSwitches(ctx: Ctx) {
  firingiAdmin(ctx);
  const f = await prisma.companyFeature.findMany({ where: { key: FEATURE }, include: { company: { select: { id: true, legalName: true, tradeName: true, type: true } } } });
  return f.map((x) => ({ companyId: x.companyId, name: x.company.tradeName ?? x.company.legalName, type: x.company.type, state: x.enabled ? ("ON" as const) : ("OFF" as const) }));
}

/** Is menu costing & waste on for this business, and which parts? */
export async function kitchenAccess(co: { id: string; type: string }, s?: KitchenSettings) {
  const set = s ?? (await kitchenSettings());
  const none = Object.fromEntries((Object.keys(set.parts) as KitchenPart[]).map((k) => [k, false])) as Record<KitchenPart, boolean>;
  if (!set.enabled) return { on: false, parts: none, settings: set, why: "OFF" as const };
  if (co.type !== "CUSTOMER" && co.type !== "WHOLESALER") return { on: false, parts: none, settings: set, why: "TYPE_OFF" as const };
  const sw = await kitchenSwitch(co.id);
  if (sw === "OFF") return { on: false, parts: none, settings: set, why: "COMPANY_OFF" as const };
  if (sw !== "ON" && !set.types[co.type as KitchenType]) return { on: false, parts: none, settings: set, why: "TYPE_OFF" as const };
  return { on: true, parts: { ...set.parts }, settings: set, why: null };
}

/** The business's own targets merged over FIRINGI's defaults. */
export async function kitchenProfile(companyId: string, s?: KitchenSettings) {
  const set = s ?? (await kitchenSettings());
  const p = await prisma.kitchenProfile.findUnique({ where: { companyId } });
  return {
    targetFoodCostPct: n(p?.targetFoodCostPct) ?? set.targetFoodCostPct,
    wasteTargetPct: n(p?.wasteTargetPct) ?? set.wasteTargetPct,
    costBasis: ((COST_BASES as readonly string[]).includes(p?.costBasis ?? "") ? p!.costBasis : set.costBasis) as CostBasis,
    rounding: ((ROUNDINGS as readonly string[]).includes(p?.rounding ?? "") ? p!.rounding : set.rounding) as Rounding,
    own: { targetFoodCostPct: n(p?.targetFoodCostPct), wasteTargetPct: n(p?.wasteTargetPct), costBasis: p?.costBasis ?? null, rounding: p?.rounding ?? null },
  };
}

/** Throws unless the business may use the part; `manage` = ingredients, recipes, reports; else logging waste is enough. */
async function guard(ctx: Ctx, part: KitchenPart, manage = true) {
  if (!can(ctx, manage ? "buyer.kitchen.manage" : ["buyer.kitchen.manage", "buyer.kitchen.waste"])) throw new ForbiddenError();
  const a = await kitchenAccess(ctx.company);
  if (!a.on) throw new AppError("KITCHEN_OFF", "Menu costing & waste is not available for your business.", 403);
  if (!a.parts[part]) throw new AppError("KITCHEN_PART_OFF", "FIRINGI has switched this part off.", 403);
  return a;
}

export async function saveKitchenProfile(ctx: Ctx, i: { targetFoodCostPct: number | null; wasteTargetPct: number | null; costBasis: string | null; rounding: string | null }) {
  await guard(ctx, "costing");
  if (i.targetFoodCostPct != null && (i.targetFoodCostPct < 5 || i.targetFoodCostPct > 90)) throw new ValidationError("Target food cost: 5 to 90 %.");
  if (i.wasteTargetPct != null && (i.wasteTargetPct < 0.5 || i.wasteTargetPct > 50)) throw new ValidationError("Waste target: 0.5 to 50 %.");
  const data = {
    targetFoodCostPct: i.targetFoodCostPct, wasteTargetPct: i.wasteTargetPct,
    costBasis: i.costBasis && (COST_BASES as readonly string[]).includes(i.costBasis) ? i.costBasis : null,
    rounding: i.rounding && (ROUNDINGS as readonly string[]).includes(i.rounding) ? i.rounding : null,
  };
  await prisma.kitchenProfile.upsert({ where: { companyId: ctx.company.id }, create: { companyId: ctx.company.id, ...data }, update: data });
  await refreshCosts(ctx.company.id);
  return kitchenProfile(ctx.company.id);
}

// ── ingredients ─────────────────────────────────────────────────────────────

const nameOf = (j: unknown, locale = "en") => pickLocalized(j as Record<string, string>, locale);

/** Allergens of FIRINGI products from their approved food information ("~X" = may contain X). */
async function productAllergens(productIds: string[]) {
  const out = new Map<string, string[]>();
  if (!productIds.length) return out;
  const rows = await prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, foodInfo: { select: { status: true, allergens: true } } } });
  for (const p of rows) {
    if (!p.foodInfo || p.foodInfo.status !== "APPROVED") continue;
    const l = allergenLists(p.foodInfo.allergens as AllergenMap);
    out.set(p.id, [...l.contain, ...l.mayContain.map((a) => `~${a}`)]);
  }
  return out;
}

/** CO₂ per base unit of FIRINGI products (from the offer's footprint). */
async function offerCo2(offers: { offerId: string; unit: BaseUnit; packSize: number }[]) {
  const out = new Map<string, number>();
  if (!offers.length) return out;
  const { offerFootprints } = await import("@/server/co2/service");
  const f = await offerFootprints(offers.map((o) => o.offerId)).catch(() => new Map());
  for (const o of offers) {
    const x = f.get(o.offerId);
    if (!x) continue;
    out.set(o.offerId, o.unit === "PCS" ? Math.round((x.perPack.total / Math.max(1, o.packSize)) * 10000) / 10000 : x.kgPerKg);
  }
  return out;
}

/** Order lines of a product the business bought (not cancelled / returned). */
async function boughtLines(companyId: string, productIds: string[], since?: Date) {
  if (!productIds.length) return [];
  return prisma.orderLine.findMany({
    where: { order: { buyerCompanyId: companyId, status: { notIn: [...LIVE_STATUSES] }, ...(since ? { placedAt: { gte: since } } : {}) }, offer: { packaging: { variant: { productId: { in: productIds } } } } },
    select: { offerId: true, unitSalePriceNet: true, qtyOrdered: true, qtyConfirmed: true, qtyDelivered: true, order: { select: { placedAt: true } }, offer: { select: { packaging: { select: { variant: { select: { productId: true } } } } } } },
    orderBy: { order: { placedAt: "desc" } }, take: 5000,
  });
}

/**
 * Recompute every FIRINGI ingredient's cost per unit from what the business paid. Returns the ingredients whose
 * cost rose by at least FIRINGI's alert %.
 */
export async function refreshCosts(companyId: string, opts: { ctx?: Ctx; now?: Date } = {}) {
  const s = await kitchenSettings();
  const prof = await kitchenProfile(companyId, s);
  const now = opts.now ?? new Date();
  const ings = await prisma.kitchenIngredient.findMany({ where: { companyId, source: "FIRINGI", active: true } });
  if (!ings.length) return [];
  const lines = await boughtLines(companyId, [...new Set(ings.map((i) => i.productId!).filter(Boolean))]);
  const since = new Date(now.getTime() - s.averageDays * DAY);
  const rises: { id: string; name: string; before: number; after: number; pct: number }[] = [];
  for (const i of ings) {
    const mine = lines.filter((l) => l.offer.packaging.variant.productId === i.productId).map((l) => ({ unitPriceNet: Number(l.unitSalePriceNet), qty: l.qtyDelivered ?? l.qtyConfirmed ?? l.qtyOrdered, at: l.order.placedAt }));
    const pc = purchaseCost(mine, prof.costBasis, since);
    let packPrice = pc?.packPrice ?? null, basis: string = pc?.basis ?? "CATALOGUE";
    if (packPrice == null && opts.ctx && i.offerId) {
      const { pricedOffers } = await import("@/server/data/catalogue-buyer");
      const p = await pricedOffers(opts.ctx, [{ offerId: i.offerId, qty: 1 }]).catch(() => null);
      const it = p?.items[0];
      packPrice = it?.price ? Number(it.price.unitPriceNet) : null;
    }
    if (packPrice == null) { if (i.cost == null) continue; packPrice = Number(i.cost) * Number(i.packSize ?? 1); basis = i.costBasis ?? "CATALOGUE"; }
    const cost = perUnit(packPrice, Number(i.packSize ?? 1));
    const old = n(i.cost);
    if (old != null && Math.abs(old - cost) < 0.00005 && i.costBasis === basis) continue;
    await prisma.kitchenIngredient.update({ where: { id: i.id }, data: { cost, costAt: now, costBasis: basis, prevCost: old ?? undefined } });
    if (old != null && old > 0 && cost > old && ((cost - old) / old) * 100 >= s.priceRiseAlertPct) rises.push({ id: i.id, name: i.name, before: old, after: cost, pct: Math.round(((cost - old) / old) * 1000) / 10 });
  }
  return rises;
}

/** The business's ingredients with cost, allergens and CO₂ — also used for costing. */
async function ingredientMap(companyId: string) {
  const rows = await prisma.kitchenIngredient.findMany({ where: { companyId }, orderBy: { name: "asc" } });
  const [al, co2] = await Promise.all([
    productAllergens(rows.filter((r) => r.source === "FIRINGI" && !r.allergensOwn && r.productId).map((r) => r.productId!)),
    offerCo2(rows.filter((r) => r.source === "FIRINGI" && r.offerId && r.co2PerUnit == null).map((r) => ({ offerId: r.offerId!, unit: r.unit as BaseUnit, packSize: Number(r.packSize ?? 1) }))),
  ]);
  const lite = new Map<string, IngredientLite>();
  for (const r of rows) {
    lite.set(r.id, {
      id: r.id, name: r.name, unit: r.unit as BaseUnit, cost: n(r.source === "MANUAL" ? r.manualCost : r.cost), yieldPct: Number(r.yieldPct),
      allergens: r.source === "FIRINGI" && !r.allergensOwn ? al.get(r.productId ?? "") ?? [] : r.allergens,
      co2PerUnit: n(r.co2PerUnit) ?? (r.offerId ? co2.get(r.offerId) ?? null : null),
    });
  }
  return { rows, lite };
}

export async function listIngredients(ctx: Ctx) {
  await guard(ctx, "costing");
  const { rows, lite } = await ingredientMap(ctx.company.id);
  const used = await prisma.kitchenRecipeLine.groupBy({ by: ["ingredientId"], where: { ingredientId: { in: rows.map((r) => r.id) } }, _count: { _all: true } });
  const u = new Map(used.map((x) => [x.ingredientId, x._count._all]));
  return rows.map((r) => {
    const l = lite.get(r.id)!;
    return {
      id: r.id, name: r.name, source: r.source, unit: r.unit, packSize: n(r.packSize), manualCost: n(r.manualCost), supplierName: r.supplierName, yieldPct: Number(r.yieldPct),
      cost: l.cost, costBasis: r.source === "MANUAL" ? "MANUAL" : r.costBasis, costAt: r.costAt, prevCost: n(r.prevCost), allergens: l.allergens, allergensOwn: r.allergensOwn,
      co2PerUnit: l.co2PerUnit, active: r.active, usedIn: u.get(r.id) ?? 0, productId: r.productId,
    };
  });
}

/** Products bought on FIRINGI in the last year that aren't ingredients yet — one click to add. */
export async function purchasedProducts(ctx: Ctx, locale = "en") {
  await guard(ctx, "costing");
  const have = new Set((await prisma.kitchenIngredient.findMany({ where: { companyId: ctx.company.id, productId: { not: null } }, select: { productId: true } })).map((r) => r.productId!));
  const lines = await prisma.orderLine.findMany({
    where: { order: { buyerCompanyId: ctx.company.id, status: { notIn: [...LIVE_STATUSES] }, placedAt: { gte: new Date(Date.now() - 365 * DAY) } } },
    orderBy: { order: { placedAt: "desc" } }, take: 3000,
    select: { offerId: true, productName: true, packagingName: true, unitSalePriceNet: true, order: { select: { placedAt: true } }, offer: { select: { packaging: { select: { unitsPerPack: true, netWeightKg: true, name: true, variant: { select: { productId: true } } } } } } },
  });
  const seen = new Map<string, { productId: string; offerId: string; name: string; pack: string; guess: { size: number; unit: BaseUnit }; lastPrice: number; lastAt: Date; times: number }>();
  for (const l of lines) {
    const pid = l.offer.packaging.variant.productId;
    if (have.has(pid)) continue;
    const x = seen.get(pid);
    if (x) { x.times++; continue; }
    const packName = nameOf(l.packagingName, "en") || nameOf(l.offer.packaging.name, "en");
    seen.set(pid, { productId: pid, offerId: l.offerId, name: nameOf(l.productName, locale), pack: nameOf(l.packagingName, locale), guess: packContent({ name: packName, unitsPerPack: l.offer.packaging.unitsPerPack, netWeightKg: n(l.offer.packaging.netWeightKg) }), lastPrice: Number(l.unitSalePriceNet), lastAt: l.order.placedAt, times: 1 });
  }
  return [...seen.values()].sort((a, b) => b.times - a.times);
}

function cleanName(s: string) {
  const t = s.trim().replace(/\s+/g, " ").slice(0, 120);
  if (t.length < 2) throw new ValidationError("Give it a name.");
  return t;
}
const unitOk = (u: string): u is KitchenUnit => (BASE_UNITS as readonly string[]).includes(u);
const allergensOk = (a: string[]) => a.filter((x) => (ALLERGENS as readonly string[]).includes(x.replace(/^~/, "")));

export async function addIngredientFromPurchase(ctx: Ctx, i: { productId: string; name?: string | null; unit?: string | null; packSize?: number | null }) {
  await guard(ctx, "costing");
  const list = await purchasedProducts(ctx);
  const p = list.find((x) => x.productId === i.productId);
  if (!p) throw new NotFoundError("Product");
  const unit = i.unit && unitOk(i.unit) ? i.unit : p.guess.unit;
  const packSize = i.packSize && i.packSize > 0 ? i.packSize : p.guess.size;
  const row = await prisma.kitchenIngredient.create({ data: { companyId: ctx.company.id, name: cleanName(i.name || p.name), source: "FIRINGI", productId: p.productId, offerId: p.offerId, unit, packSize } });
  await refreshCosts(ctx.company.id, { ctx });
  return { id: row.id };
}

export type IngredientInput = {
  id: string | null; name: string; unit: string; manualCost: number | null; supplierName: string | null; yieldPct: number; allergens: string[]; allergensOwn: boolean;
  co2PerUnit: number | null; packSize: number | null; active: boolean;
};

export async function saveIngredient(ctx: Ctx, i: IngredientInput) {
  await guard(ctx, "costing");
  if (!unitOk(i.unit)) throw new ValidationError("Choose kg, litre or piece.");
  if (!(i.yieldPct > 0 && i.yieldPct <= 100)) throw new ValidationError("Yield: more than 0 and at most 100 %.");
  const existing = i.id ? await prisma.kitchenIngredient.findFirst({ where: { id: i.id, companyId: ctx.company.id } }) : null;
  if (i.id && !existing) throw new NotFoundError("Ingredient");
  const firingi = existing?.source === "FIRINGI";
  if (!firingi && (i.manualCost == null || i.manualCost < 0)) throw new ValidationError("Enter the cost per unit (without VAT).");
  if (firingi && i.packSize != null && !(i.packSize > 0)) throw new ValidationError("A pack holds more than 0.");
  const data = {
    name: cleanName(i.name), unit: i.unit, yieldPct: i.yieldPct, allergens: allergensOk(i.allergens), allergensOwn: firingi ? i.allergensOwn : true,
    co2PerUnit: i.co2PerUnit != null && i.co2PerUnit >= 0 ? i.co2PerUnit : null, active: i.active,
    ...(firingi ? { packSize: i.packSize ?? existing!.packSize } : { manualCost: i.manualCost, supplierName: i.supplierName?.trim().slice(0, 120) || null }),
  };
  const row = existing
    ? await prisma.kitchenIngredient.update({ where: { id: existing.id }, data: { ...data, ...(!firingi && existing.manualCost != null && Number(existing.manualCost) !== i.manualCost ? { prevCost: existing.manualCost } : {}) } })
    : await prisma.kitchenIngredient.create({ data: { ...data, companyId: ctx.company.id, source: "MANUAL", manualCost: i.manualCost } });
  if (firingi) await refreshCosts(ctx.company.id, { ctx });
  return { id: row.id };
}

export async function deleteIngredient(ctx: Ctx, id: string) {
  await guard(ctx, "costing");
  const used = await prisma.kitchenRecipeLine.count({ where: { ingredientId: id, recipe: { companyId: ctx.company.id } } });
  if (used) throw new AppError("INGREDIENT_USED", `It is used in ${used} recipe line(s) — take it out of those first, or switch it off.`, 409, { count: String(used) });
  const del = await prisma.kitchenIngredient.deleteMany({ where: { id, companyId: ctx.company.id } });
  if (!del.count) throw new NotFoundError("Ingredient");
  return true;
}

// ── recipes ─────────────────────────────────────────────────────────────────

async function recipeGraph(companyId: string) {
  const [recs, ing] = await Promise.all([
    prisma.kitchenRecipe.findMany({ where: { companyId }, include: { lines: { orderBy: { sortOrder: "asc" } } }, orderBy: { name: "asc" } }),
    ingredientMap(companyId),
  ]);
  const graph = new Map<string, RecipeLite>(recs.map((r) => [r.id, {
    id: r.id, name: r.name, kind: r.kind, yieldQty: Number(r.yieldQty), yieldUnit: (r.yieldUnit as BaseUnit | null) ?? null,
    lines: r.lines.map((l) => ({ ingredientId: l.ingredientId, subRecipeId: l.subRecipeId, qty: Number(l.qty), unit: l.unit })),
  }]));
  const posIds = recs.map((r) => r.posItemId).filter(Boolean) as string[];
  const pos = posIds.length ? await prisma.posItem.findMany({ where: { id: { in: posIds }, companyId }, select: { id: true, name: true, price: true, vatRate: true, allergens: true } }) : [];
  return { recs, graph, ing, pos: new Map(pos.map((p) => [p.id, p])) };
}

type Graph = Awaited<ReturnType<typeof recipeGraph>>;

function present(r: Graph["recs"][number], g: Graph, prof: Awaited<ReturnType<typeof kitchenProfile>>) {
  const c = costRecipe(r.id, g.graph, g.ing.lite);
  const pos = r.posItemId ? g.pos.get(r.posItemId) : undefined;
  const priceGross = r.kind === "DISH" ? (pos ? Number(pos.price) : n(r.priceGross)) : null;
  const vatRate = pos ? Number(pos.vatRate) : Number(r.vatRate);
  const target = n(r.targetPct) ?? prof.targetFoodCostPct;
  const pct = r.kind === "DISH" ? foodCostPct(c.unitCost, priceGross, vatRate) : null;
  return {
    id: r.id, name: r.name, kind: r.kind, category: r.category, active: r.active, yieldQty: Number(r.yieldQty), yieldUnit: r.yieldUnit,
    posItemId: r.posItemId, posItemName: pos?.name ?? null, priceGross, vatRate, priceFromTill: !!pos, targetPct: target, ownTarget: n(r.targetPct), soldPerWeek: r.soldPerWeek, notes: r.notes,
    cost: c.unitCost, batchCost: c.batchCost, co2: c.co2PerUnit, allergens: c.allergens, missing: c.missing, cycle: c.cycle, lines: c.lines,
    foodCostPct: pct, margin: r.kind === "DISH" ? marginOf(c.unitCost, priceGross, vatRate) : null, over: pct != null && pct > target,
    suggested: r.kind === "DISH" ? suggestPrice(c.unitCost, target, vatRate, prof.rounding) : null,
    tillAllergens: pos?.allergens ?? null,
  };
}

export async function listRecipes(ctx: Ctx, kind?: "DISH" | "SUB" | null) {
  await guard(ctx, "costing");
  const [g, prof] = await Promise.all([recipeGraph(ctx.company.id), kitchenProfile(ctx.company.id)]);
  return { profile: prof, recipes: g.recs.filter((r) => !kind || r.kind === kind).map((r) => present(r, g, prof)) };
}

export async function recipeDetail(ctx: Ctx, id: string) {
  await guard(ctx, "costing");
  const [g, prof] = await Promise.all([recipeGraph(ctx.company.id), kitchenProfile(ctx.company.id)]);
  const r = g.recs.find((x) => x.id === id);
  if (!r) throw new NotFoundError("Recipe");
  const posItems = await prisma.posItem.findMany({ where: { companyId: ctx.company.id, active: true }, select: { id: true, name: true, price: true }, orderBy: { name: "asc" } });
  const linked = new Set(g.recs.filter((x) => x.posItemId && x.id !== id).map((x) => x.posItemId));
  return {
    recipe: { ...present(r, g, prof), lineRows: r.lines.map((l) => ({ ingredientId: l.ingredientId, subRecipeId: l.subRecipeId, qty: Number(l.qty), unit: l.unit })) },
    ingredients: g.ing.rows.filter((x) => x.active).map((x) => ({ id: x.id, name: x.name, unit: x.unit })),
    subRecipes: g.recs.filter((x) => x.kind === "SUB" && x.id !== id && !makesCycle(id, x.id, g.graph)).map((x) => ({ id: x.id, name: x.name, unit: x.yieldUnit })),
    posItems: posItems.filter((p) => !linked.has(p.id)).map((p) => ({ id: p.id, name: p.name, price: Number(p.price) })),
    profile: prof, canEditTill: can(ctx, "company.pos.manage"),
  };
}

/** What a new recipe can use: ingredients, sub-recipes and till items not costed yet. */
export async function newRecipeOptions(ctx: Ctx) {
  await guard(ctx, "costing");
  const g = await recipeGraph(ctx.company.id);
  const linked = g.recs.map((r) => r.posItemId).filter(Boolean) as string[];
  const tills = await prisma.posItem.findMany({ where: { companyId: ctx.company.id, active: true, id: { notIn: linked } }, select: { id: true, name: true, price: true }, orderBy: { name: "asc" } });
  return {
    ingredients: g.ing.rows.filter((x) => x.active).map((x) => ({ id: x.id, name: x.name, unit: x.unit })),
    subRecipes: g.recs.filter((x) => x.kind === "SUB").map((x) => ({ id: x.id, name: x.name, unit: x.yieldUnit })),
    posItems: tills.map((p) => ({ id: p.id, name: p.name, price: Number(p.price) })),
  };
}

export type RecipeInput = {
  id: string | null; name: string; kind: "DISH" | "SUB"; category: string | null; posItemId: string | null; yieldQty: number; yieldUnit: string | null;
  priceGross: number | null; vatRate: number; targetPct: number | null; soldPerWeek: number | null; notes: string | null; active: boolean;
  lines: { ingredientId: string | null; subRecipeId: string | null; qty: number; unit: string }[];
};

export async function saveRecipe(ctx: Ctx, i: RecipeInput) {
  await guard(ctx, "costing");
  const companyId = ctx.company.id;
  const existing = i.id ? await prisma.kitchenRecipe.findFirst({ where: { id: i.id, companyId } }) : null;
  if (i.id && !existing) throw new NotFoundError("Recipe");
  if (!(i.yieldQty > 0)) throw new ValidationError(i.kind === "SUB" ? "What does one batch make? More than 0." : "Portions: more than 0.");
  if (i.kind === "SUB" && !(i.yieldUnit && unitOk(i.yieldUnit))) throw new ValidationError("A sub-recipe makes kg, litres or pieces.");
  if (i.vatRate < 0 || i.vatRate > 30) throw new ValidationError("VAT: 0 to 30 %.");
  if (i.targetPct != null && (i.targetPct < 5 || i.targetPct > 90)) throw new ValidationError("Target food cost: 5 to 90 %.");
  if (i.priceGross != null && i.priceGross < 0) throw new ValidationError("The price can't be negative.");
  if (i.lines.length > 80) throw new ValidationError("At most 80 lines.");
  const g = await recipeGraph(companyId);
  for (const l of i.lines) {
    if (!(l.qty > 0)) throw new ValidationError("Every line needs a quantity.");
    if (!(LINE_UNITS as readonly string[]).includes(l.unit)) throw new ValidationError("Choose g, kg, ml, l or pieces.");
    if (!!l.ingredientId === !!l.subRecipeId) throw new ValidationError("Each line is one ingredient or one sub-recipe.");
    if (l.ingredientId && !g.ing.lite.has(l.ingredientId)) throw new NotFoundError("Ingredient");
    if (l.subRecipeId) {
      const sub = g.recs.find((x) => x.id === l.subRecipeId);
      if (!sub || sub.kind !== "SUB") throw new NotFoundError("Sub-recipe");
      if (existing && makesCycle(existing.id, l.subRecipeId, g.graph)) throw new ValidationError(`"${sub.name}" already uses this recipe — that would be a loop.`);
    }
  }
  if (i.posItemId) {
    const pos = await prisma.posItem.findFirst({ where: { id: i.posItemId, companyId } });
    if (!pos) throw new NotFoundError("Till item");
    const taken = await prisma.kitchenRecipe.findFirst({ where: { posItemId: i.posItemId, NOT: { id: existing?.id ?? "-" } } });
    if (taken) throw new ValidationError(`That till item is already costed as "${taken.name}".`);
  }
  const data = {
    name: cleanName(i.name), kind: i.kind, category: i.category?.trim().slice(0, 60) || null, posItemId: i.kind === "DISH" ? i.posItemId : null,
    yieldQty: i.yieldQty, yieldUnit: i.kind === "SUB" ? (i.yieldUnit as KitchenUnit) : null, priceGross: i.kind === "DISH" && !i.posItemId ? i.priceGross : null,
    vatRate: i.vatRate, targetPct: i.targetPct, soldPerWeek: i.soldPerWeek != null && i.soldPerWeek >= 0 ? Math.round(i.soldPerWeek) : null, notes: i.notes?.trim().slice(0, 2000) || null, active: i.active,
  };
  const row = await prisma.$transaction(async (tx) => {
    const r = existing ? await tx.kitchenRecipe.update({ where: { id: existing.id }, data }) : await tx.kitchenRecipe.create({ data: { ...data, companyId } });
    await tx.kitchenRecipeLine.deleteMany({ where: { recipeId: r.id } });
    if (i.lines.length) await tx.kitchenRecipeLine.createMany({ data: i.lines.map((l, k) => ({ recipeId: r.id, ingredientId: l.ingredientId, subRecipeId: l.subRecipeId, qty: l.qty, unit: l.unit, sortOrder: k })) });
    return r;
  });
  if (!existing && i.lines.some((l) => l.subRecipeId === row.id)) throw new ValidationError("A recipe can't use itself.");
  return { id: row.id };
}

export async function deleteRecipe(ctx: Ctx, id: string) {
  await guard(ctx, "costing");
  const r = await prisma.kitchenRecipe.findFirst({ where: { id, companyId: ctx.company.id }, include: { usedIn: { include: { recipe: { select: { name: true } } } } } });
  if (!r) throw new NotFoundError("Recipe");
  if (r.usedIn.length) throw new AppError("RECIPE_USED", `It is used in "${r.usedIn[0].recipe.name}" — take it out there first.`, 409, { name: r.usedIn[0].recipe.name });
  await prisma.kitchenRecipe.delete({ where: { id } });
  return true;
}

/** Take the suggested price: on the till item when it's linked (if the user may change till prices), else the recipe. */
export async function applySuggestedPrice(ctx: Ctx, id: string) {
  const a = await guard(ctx, "priceSuggestions");
  void a;
  const d = await recipeDetail(ctx, id);
  const s = d.recipe.suggested;
  if (s == null) throw new ValidationError("There's no cost yet to suggest a price from.");
  if (d.recipe.posItemId) {
    if (!can(ctx, "company.pos.manage")) throw new ForbiddenError();
    const before = await prisma.posItem.findUniqueOrThrow({ where: { id: d.recipe.posItemId } });
    await prisma.posItem.update({ where: { id: before.id }, data: { price: s } });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "kitchen.till_price", entityType: "PosItem", entityId: before.id, before: { price: Number(before.price) }, after: { price: s } });
  } else await prisma.kitchenRecipe.update({ where: { id }, data: { priceGross: s } });
  return s;
}

/** Copy the dish's allergens (contains) to its till item — what the till shows and prints. */
export async function pushAllergensToTill(ctx: Ctx, id: string) {
  await guard(ctx, "allergens");
  if (!can(ctx, "company.pos.manage")) throw new ForbiddenError();
  const d = await recipeDetail(ctx, id);
  if (!d.recipe.posItemId) throw new ValidationError("Link the dish to a till item first.");
  const list = d.recipe.allergens.filter((x) => !x.startsWith("~"));
  await prisma.posItem.update({ where: { id: d.recipe.posItemId }, data: { allergens: list } });
  return list;
}

/** Dishes from the till: every till item with a recipe (Phase 47) becomes a costed dish; its FIRINGI products become ingredients. */
export async function importFromTill(ctx: Ctx) {
  await guard(ctx, "costing");
  const companyId = ctx.company.id;
  const items = await prisma.posItem.findMany({
    where: { companyId, active: true }, include: { recipe: true },
  });
  const linked = new Set((await prisma.kitchenRecipe.findMany({ where: { companyId, posItemId: { not: null } }, select: { posItemId: true } })).map((r) => r.posItemId));
  const todo = items.filter((i) => !linked.has(i.id) && i.recipe.length);
  if (!todo.length) return { dishes: 0, ingredients: 0 };
  const offerIds = [...new Set(todo.flatMap((i) => i.recipe.map((l) => l.offerId)))];
  const offers = await prisma.vendorOffer.findMany({ where: { id: { in: offerIds } }, select: { id: true, packaging: { select: { name: true, unitsPerPack: true, netWeightKg: true, variant: { select: { productId: true, product: { select: { name: true } } } } } } } });
  const byOffer = new Map(offers.map((o) => [o.id, o]));
  const ing = new Map((await prisma.kitchenIngredient.findMany({ where: { companyId, productId: { in: offers.map((o) => o.packaging.variant.productId) } } })).map((x) => [x.productId!, x]));
  let made = 0;
  for (const o of offers) {
    const pid = o.packaging.variant.productId;
    if (ing.has(pid)) continue;
    const g = packContent({ name: nameOf(o.packaging.name, "en"), unitsPerPack: o.packaging.unitsPerPack, netWeightKg: n(o.packaging.netWeightKg) });
    ing.set(pid, await prisma.kitchenIngredient.create({ data: { companyId, name: nameOf(o.packaging.variant.product.name, "en").slice(0, 120), source: "FIRINGI", productId: pid, offerId: o.id, unit: g.unit, packSize: g.size } }));
    made++;
  }
  let dishes = 0;
  for (const it of todo) {
    const lines = it.recipe.map((l, k) => {
      const o = byOffer.get(l.offerId);
      const x = o ? ing.get(o.packaging.variant.productId) : undefined;
      if (!o || !x) return null;
      const qty = Number(l.qty);
      // KG and PCS keep their unit; PACK becomes the pack's content
      const unit = l.unit === "KG" ? "KG" : l.unit === "PCS" ? "PCS" : x.unit === "L" ? "L" : x.unit === "KG" ? "KG" : "PCS";
      const q = l.unit === "PACK" ? qty * Number(x.packSize ?? 1) : qty;
      return { ingredientId: x.id, subRecipeId: null, qty: q, unit, sortOrder: k };
    }).filter(Boolean) as { ingredientId: string; subRecipeId: null; qty: number; unit: string; sortOrder: number }[];
    await prisma.kitchenRecipe.create({ data: { companyId, name: it.name.slice(0, 120), kind: "DISH", category: it.category, posItemId: it.id, vatRate: it.vatRate, lines: { create: lines.map((l) => ({ ingredientId: l.ingredientId, qty: l.qty, unit: l.unit, sortOrder: l.sortOrder })) } } });
    dishes++;
  }
  await refreshCosts(companyId, { ctx });
  return { dishes, ingredients: made };
}

// ── menu engineering & what-if ──────────────────────────────────────────────

export async function menuEngineering(ctx: Ctx, days?: number) {
  const a = await guard(ctx, "engineering");
  const period = Math.max(7, Math.min(180, days ?? a.settings.engineeringDays));
  const { recipes } = await listRecipes(ctx, "DISH");
  const dishes = recipes.filter((r) => r.active);
  const posIds = dishes.map((d) => d.posItemId).filter(Boolean) as string[];
  const since = new Date(Date.now() - period * DAY);
  const sold = posIds.length ? await prisma.posSaleLine.groupBy({ by: ["itemId"], where: { itemId: { in: posIds }, sale: { companyId: ctx.company.id, status: "COMPLETED", kind: "SALE", soldAt: { gte: since } } }, _sum: { qty: true } }) : [];
  const s = new Map(sold.map((x) => [x.itemId, Number(x._sum.qty ?? 0)]));
  const rows = dishes.map((d) => {
    const fromTill = d.posItemId ? s.get(d.posItemId) ?? 0 : null;
    const qty = fromTill != null && (fromTill > 0 || d.soldPerWeek == null) ? fromTill : Math.round(((d.soldPerWeek ?? 0) * period) / 7);
    return { id: d.id, name: d.name, sold: qty, margin: d.margin, source: fromTill != null && (fromTill > 0 || d.soldPerWeek == null) ? ("TILL" as const) : ("MANUAL" as const), foodCostPct: d.foodCostPct, priceGross: d.priceGross };
  });
  const e = engineer(rows);
  const extra = new Map(rows.map((r) => [r.id, r]));
  return {
    days: period, avgMargin: e.avgMargin, popularAt: e.popularAt,
    items: e.items.map((i) => ({ ...i, source: extra.get(i.id)!.source, foodCostPct: extra.get(i.id)!.foodCostPct, priceGross: extra.get(i.id)!.priceGross, revenueMargin: i.margin != null ? money(i.margin * i.sold) : null })),
    unpriced: dishes.filter((d) => d.margin == null).map((d) => ({ id: d.id, name: d.name })),
  };
}

/** "If this ingredient gets X % dearer": the dishes it hits and the prices that keep each on target. */
export async function priceRiseWhatIf(ctx: Ctx, ingredientId: string, risePct: number) {
  await guard(ctx, "priceSuggestions");
  if (!(risePct > -90 && risePct <= 300)) throw new ValidationError("A change between −90 % and +300 %.");
  const [g, prof] = await Promise.all([recipeGraph(ctx.company.id), kitchenProfile(ctx.company.id)]);
  const ing = g.ing.lite.get(ingredientId);
  if (!ing) throw new NotFoundError("Ingredient");
  const doubled = new Map(g.ing.lite);
  doubled.set(ingredientId, { ...ing, cost: (ing.cost ?? 0) * 2 });
  const dishes = g.recs.filter((r) => r.kind === "DISH" && r.active).map((r) => {
    const base = present(r, g, prof);
    const twice = costRecipe(r.id, g.graph, doubled).unitCost;
    return { id: r.id, name: r.name, cost: base.cost, ingredientShare: Math.max(0, twice - base.cost), priceGross: base.priceGross, vatRate: base.vatRate, targetPct: base.targetPct };
  });
  return { ingredient: { id: ing.id, name: ing.name, cost: ing.cost, unit: ing.unit }, risePct, rows: whatIf(dishes, risePct, prof.rounding) };
}

// ── waste & donations ───────────────────────────────────────────────────────

export type WasteInput = {
  kind: "WASTE" | "DONATION"; reason: string | null; ingredientId: string | null; recipeId: string | null; lotId: string | null; label: string | null;
  qty: number; unit: string; note: string | null; recipient: string | null; receiptRef: string | null; at: string | null;
};

export async function logWaste(ctx: Ctx, i: WasteInput) {
  const a = await guard(ctx, i.kind === "DONATION" ? "donations" : "waste", false);
  if (!(i.qty > 0) || i.qty > 100000) throw new ValidationError("Enter how much.");
  if (!(WASTE_UNITS as readonly string[]).includes(i.unit)) throw new ValidationError("Choose a unit.");
  if (i.kind === "WASTE" && !(WASTE_REASONS as readonly string[]).includes(i.reason ?? "")) throw new ValidationError("Choose why it was thrown away.");
  if (i.kind === "DONATION" && !(i.recipient ?? "").trim()) throw new ValidationError("Who received the donation?");
  const at = i.at ? new Date(i.at) : new Date();
  if (Number.isNaN(at.getTime()) || at.getTime() > Date.now() + 3600_000 || at.getTime() < Date.now() - 31 * DAY) throw new ValidationError("A date in the last month.");
  const companyId = ctx.company.id;
  let label = (i.label ?? "").trim().slice(0, 120), cost = 0, kg: number | null = null, co2: number | null = null;
  let ingredientId: string | null = null, recipeId: string | null = null, lotId: string | null = null;
  if (i.lotId) {
    const lot = await prisma.purchasedLot.findFirst({ where: { id: i.lotId, buyerCompanyId: companyId } });
    if (!lot) throw new NotFoundError("Lot");
    if (i.unit !== "PACK") throw new ValidationError("From a lot, count packs.");
    const left = lot.qty - lot.usedQty;
    if (i.qty > left) throw new AppError("LOT_SHORT", `Only ${left} left in this lot.`, 422, { left: String(left) });
    const line = await prisma.orderLine.findFirst({ where: { orderId: lot.orderId, offerId: lot.offerId }, select: { unitSalePriceNet: true, productName: true, offer: { select: { packaging: { select: { name: true, unitsPerPack: true, netWeightKg: true, variant: { select: { productId: true } } } } } } } });
    const pc = line ? packContent({ name: nameOf(line.offer.packaging.name, "en"), unitsPerPack: line.offer.packaging.unitsPerPack, netWeightKg: n(line.offer.packaging.netWeightKg) }) : null;
    cost = line ? Number(line.unitSalePriceNet) * i.qty : 0;
    kg = pc && pc.unit !== "PCS" ? pc.size * i.qty : null;
    const fp = (await (await import("@/server/co2/service")).offerFootprints([lot.offerId]).catch(() => new Map())).get(lot.offerId);
    co2 = fp ? fp.perPack.total * i.qty : null;
    label = label || (line ? `${nameOf(line.productName, "en")}${lot.lotCode ? ` · ${lot.lotCode}` : ""}` : "Lot");
    lotId = lot.id;
    const ing = line ? await prisma.kitchenIngredient.findFirst({ where: { companyId, productId: line.offer.packaging.variant.productId } }) : null;
    ingredientId = ing?.id ?? null;
  } else if (i.ingredientId) {
    const { lite } = await ingredientMap(companyId);
    const ing = lite.get(i.ingredientId);
    if (!ing) throw new NotFoundError("Ingredient");
    const b = toBase(i.qty, i.unit, ing.unit);
    if (!b.ok) throw new ValidationError(`Count ${ing.name} in ${ing.unit === "PCS" ? "pieces" : ing.unit === "KG" ? "g or kg" : "ml or l"}.`);
    cost = (ing.cost ?? 0) * b.qty;
    kg = ing.unit === "PCS" ? null : b.qty;
    co2 = ing.co2PerUnit != null ? ing.co2PerUnit * b.qty : null;
    label = label || ing.name;
    ingredientId = ing.id;
  } else if (i.recipeId) {
    const g = await recipeGraph(companyId);
    const r = g.recs.find((x) => x.id === i.recipeId);
    if (!r) throw new NotFoundError("Recipe");
    const c = costRecipe(r.id, g.graph, g.ing.lite);
    if (r.kind === "DISH") {
      if (i.unit !== "PORTION") throw new ValidationError("Count dishes in portions.");
      cost = c.unitCost * i.qty; co2 = c.co2PerUnit * i.qty;
    } else {
      const b = toBase(i.qty, i.unit, (r.yieldUnit as BaseUnit) ?? "KG");
      if (!b.ok) throw new ValidationError("Use the unit the sub-recipe is made in.");
      cost = c.unitCost * b.qty; co2 = c.co2PerUnit * b.qty; kg = r.yieldUnit === "PCS" ? null : b.qty;
    }
    label = label || r.name;
    recipeId = r.id;
  } else {
    if (label.length < 2) throw new ValidationError("What was it?");
    const u = toBase(i.qty, i.unit, "KG");
    kg = u.ok ? u.qty : null;
  }
  const row = await prisma.$transaction(async (tx) => {
    if (lotId) {
      const upd = await tx.purchasedLot.updateMany({ where: { id: lotId, usedQty: { lte: (await tx.purchasedLot.findUniqueOrThrow({ where: { id: lotId } })).qty - i.qty } }, data: { usedQty: { increment: Math.round(i.qty) } } });
      if (!upd.count) throw new ValidationError("Not that much left in this lot.");
    }
    return tx.kitchenWaste.create({
      data: {
        companyId, kind: i.kind, at, reason: i.kind === "WASTE" ? (i.reason as WasteReason) : null, ingredientId, recipeId, lotId, label, qty: i.qty, unit: i.unit,
        cost: money(cost), kgWeight: kg != null ? Math.round(kg * 1000) / 1000 : null, co2Kg: co2 != null ? Math.round(co2 * 1000) / 1000 : null,
        recipient: i.kind === "DONATION" ? i.recipient!.trim().slice(0, 120) : null, receiptRef: i.kind === "DONATION" ? i.receiptRef?.trim().slice(0, 60) || null : null,
        note: i.note?.trim().slice(0, 500) || null, byUserId: ctx.user.id,
      },
    });
  });
  void a;
  return { id: row.id, cost: Number(row.cost), co2Kg: n(row.co2Kg), kg: n(row.kgWeight) };
}

/** Take an entry back (a manager any time; the person who logged it on the same day). A lot gets its packs back. */
export async function deleteWaste(ctx: Ctx, id: string) {
  await guard(ctx, "waste", false);
  const w = await prisma.kitchenWaste.findFirst({ where: { id, companyId: ctx.company.id } });
  if (!w) throw new NotFoundError("Entry");
  const sameDay = w.byUserId === ctx.user.id && Date.now() - w.createdAt.getTime() < DAY;
  if (!can(ctx, "buyer.kitchen.manage") && !sameDay) throw new ForbiddenError();
  await prisma.$transaction(async (tx) => {
    if (w.lotId && w.unit === "PACK") await tx.purchasedLot.update({ where: { id: w.lotId }, data: { usedQty: { decrement: Math.round(Number(w.qty)) } } });
    await tx.kitchenWaste.delete({ where: { id } });
  });
  return true;
}

/** What the waste log offers: ingredients, dishes / sub-recipes and lots still in stock. */
export async function wasteOptions(ctx: Ctx, locale = "en") {
  const a = await guard(ctx, "waste", false);
  const [ings, recs, lots] = await Promise.all([
    prisma.kitchenIngredient.findMany({ where: { companyId: ctx.company.id, active: true }, select: { id: true, name: true, unit: true }, orderBy: { name: "asc" } }),
    prisma.kitchenRecipe.findMany({ where: { companyId: ctx.company.id, active: true }, select: { id: true, name: true, kind: true, yieldUnit: true }, orderBy: { name: "asc" } }),
    openLots(ctx.company.id, locale),
  ]);
  return { ingredients: ings, recipes: recs, lots, donations: a.parts.donations };
}

async function openLots(companyId: string, locale: string) {
  const lots = await prisma.purchasedLot.findMany({ where: { buyerCompanyId: companyId, expiresOn: { gte: new Date(Date.now() - 30 * DAY) } }, orderBy: { expiresOn: "asc" }, take: 300 });
  const live = lots.filter((l) => l.qty - l.usedQty > 0);
  const lines = live.length ? await prisma.orderLine.findMany({ where: { OR: live.map((l) => ({ orderId: l.orderId, offerId: l.offerId })) }, select: { orderId: true, offerId: true, productName: true, packagingName: true, unitSalePriceNet: true, offer: { select: { packaging: { select: { variant: { select: { productId: true } } } } } } } }) : [];
  const key = (o: string, f: string) => `${o}:${f}`;
  const lm = new Map(lines.map((l) => [key(l.orderId, l.offerId), l]));
  return live.map((l) => {
    const line = lm.get(key(l.orderId, l.offerId));
    return { id: l.id, product: line ? nameOf(line.productName, locale) : "—", pack: line ? nameOf(line.packagingName, locale) : "", productId: line?.offer.packaging.variant.productId ?? null, lotCode: l.lotCode, expiresOn: l.expiresOn, left: l.qty - l.usedQty, packPrice: line ? Number(line.unitSalePriceNet) : null };
  });
}

export async function wasteList(ctx: Ctx, f: { kind?: "WASTE" | "DONATION"; days?: number; take?: number } = {}) {
  await guard(ctx, f.kind === "DONATION" ? "donations" : "waste", false);
  const since = new Date(Date.now() - (f.days ?? 30) * DAY);
  const rows = await prisma.kitchenWaste.findMany({ where: { companyId: ctx.company.id, kind: f.kind ?? "WASTE", at: { gte: since } }, orderBy: { at: "desc" }, take: Math.min(500, f.take ?? 100) });
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.byUserId))] } }, select: { id: true, name: true } });
  const un = new Map(users.map((u) => [u.id, u.name]));
  const manager = can(ctx, "buyer.kitchen.manage");
  return rows.map((r) => ({
    id: r.id, kind: r.kind, at: r.at, reason: r.reason, label: r.label, qty: Number(r.qty), unit: r.unit, cost: Number(r.cost), kg: n(r.kgWeight), co2: n(r.co2Kg),
    recipient: r.recipient, receiptRef: r.receiptRef, note: r.note, by: un.get(r.byUserId) ?? "—", fromLot: !!r.lotId,
    canDelete: manager || (r.byUserId === ctx.user.id && Date.now() - r.createdAt.getTime() < DAY),
  }));
}

/** Purchases (net, ex VAT) in a period — the base of "waste as % of purchases". */
async function purchasesNet(companyId: string, since: Date, until = new Date()) {
  const a = await prisma.orderLine.aggregate({ where: { order: { buyerCompanyId: companyId, status: { notIn: [...LIVE_STATUSES] }, placedAt: { gte: since, lt: until } } }, _sum: { lineNet: true } });
  return Number(a._sum.lineNet ?? 0);
}

export async function wasteReport(ctx: Ctx, days = 30, now = new Date()) {
  const a = await guard(ctx, "wasteReports");
  const since = new Date(now.getTime() - days * DAY);
  const [rows, don, purch, prof] = await Promise.all([
    prisma.kitchenWaste.findMany({ where: { companyId: ctx.company.id, kind: "WASTE", at: { gte: new Date(Math.min(since.getTime(), now.getTime() - 56 * DAY)) } } }),
    a.parts.donations ? prisma.kitchenWaste.findMany({ where: { companyId: ctx.company.id, kind: "DONATION", at: { gte: since } } }) : Promise.resolve([]),
    purchasesNet(ctx.company.id, since, now),
    kitchenProfile(ctx.company.id, a.settings),
  ]);
  const lite = (r: (typeof rows)[number]) => ({ at: r.at, reason: r.reason, label: r.label, ingredientId: r.ingredientId, cost: Number(r.cost), kg: n(r.kgWeight), co2: n(r.co2Kg) });
  const inPeriod = rows.filter((r) => r.at >= since);
  const sum = wasteSummary(inPeriod.map(lite), purch);
  const d = wasteSummary(don.map(lite), 0);
  return {
    days, ...sum, purchases: money(purch), targetPct: prof.wasteTargetPct, overTarget: sum.pctOfPurchases != null && sum.pctOfPurchases > prof.wasteTargetPct,
    weekly: weeklyWaste(rows.map((r) => ({ at: r.at, cost: Number(r.cost) })), now, 8),
    donations: { count: d.count, kg: d.kg, cost: d.cost, co2: d.co2 },
  };
}

/** Use first (lots close to their date, and the dishes that use them) and order less (often wasted). */
export async function kitchenSuggestions(ctx: Ctx, locale = "en", now = new Date()) {
  const a = await guard(ctx, "suggestions");
  const lots = (await openLots(ctx.company.id, locale)).filter((l) => daysUntil(l.expiresOn, now) <= a.settings.useFirstDays && daysUntil(l.expiresOn, now) >= -7);
  const ings = await prisma.kitchenIngredient.findMany({ where: { companyId: ctx.company.id }, select: { id: true, name: true, productId: true, unit: true, packSize: true } });
  const byProduct = new Map(ings.filter((i) => i.productId).map((i) => [i.productId!, i]));
  const recipeLines = await prisma.kitchenRecipeLine.findMany({ where: { recipe: { companyId: ctx.company.id, active: true }, ingredientId: { in: ings.map((i) => i.id) } }, select: { ingredientId: true, recipe: { select: { id: true, name: true, kind: true } } } });
  const useFirst = lots.map((l) => {
    const ing = l.productId ? byProduct.get(l.productId) : undefined;
    const dishes = ing ? [...new Map(recipeLines.filter((x) => x.ingredientId === ing.id).map((x) => [x.recipe.id, x.recipe])).values()] : [];
    return { ...l, daysLeft: daysUntil(l.expiresOn, now), value: l.packPrice != null ? money(l.packPrice * l.left) : null, dishes: dishes.map((d) => ({ id: d.id, name: d.name })) };
  });
  // order less: waste entries in 30 days per ingredient against what was bought in 30 days
  const since = new Date(now.getTime() - 30 * DAY);
  const waste = await prisma.kitchenWaste.findMany({ where: { companyId: ctx.company.id, kind: "WASTE", at: { gte: since }, ingredientId: { not: null } }, select: { ingredientId: true, qty: true, unit: true, reason: true } });
  const bought = await boughtLines(ctx.company.id, ings.filter((i) => i.productId).map((i) => i.productId!), since);
  const items = ings.map((i) => {
    const w = waste.filter((x) => x.ingredientId === i.id);
    const wastedQty = w.reduce((s, x) => s + (x.unit === "PACK" ? Number(x.qty) * Number(i.packSize ?? 1) : toBase(Number(x.qty), x.unit, i.unit as BaseUnit).qty), 0);
    const boughtQty = bought.filter((b) => b.offer.packaging.variant.productId === i.productId).reduce((s, b) => s + (b.qtyDelivered ?? b.qtyConfirmed ?? b.qtyOrdered) * Number(i.packSize ?? 1), 0);
    return { ingredientId: i.id, name: i.name, wasteEntries: w.length, wastedQty: Math.round(wastedQty * 1000) / 1000, boughtQty, reasons: [...new Set(w.map((x) => x.reason ?? ""))], unit: i.unit };
  });
  return { useFirstDays: a.settings.useFirstDays, useFirst, orderLess: orderLess(items, a.settings.orderLessMinEntries).map((x) => ({ ...x, unit: items.find((i) => i.ingredientId === x.ingredientId)!.unit })) };
}

// ── overview ────────────────────────────────────────────────────────────────

export async function kitchenOverview(ctx: Ctx, locale = "en") {
  const a = await kitchenAccess(ctx.company);
  if (!a.on) return { on: false as const, why: a.why };
  const manage = can(ctx, "buyer.kitchen.manage");
  const [rec, rep, sug, ingCount] = await Promise.all([
    manage && a.parts.costing ? listRecipes(ctx, "DISH") : null,
    manage && a.parts.wasteReports ? wasteReport(ctx, 30) : null,
    manage && a.parts.suggestions ? kitchenSuggestions(ctx, locale) : null,
    prisma.kitchenIngredient.count({ where: { companyId: ctx.company.id } }),
  ]);
  const dishes = rec?.recipes.filter((r) => r.active) ?? [];
  const priced = dishes.filter((d) => d.foodCostPct != null);
  return {
    on: true as const, parts: a.parts, manage, ingredients: ingCount, dishes: dishes.length,
    avgFoodCostPct: priced.length ? Math.round((priced.reduce((s, d) => s + d.foodCostPct!, 0) / priced.length) * 10) / 10 : null,
    target: rec?.profile.targetFoodCostPct ?? null, over: dishes.filter((d) => d.over).map((d) => ({ id: d.id, name: d.name, pct: d.foodCostPct, suggested: d.suggested })),
    waste: rep ? { cost: rep.cost, kg: rep.kg, pct: rep.pctOfPurchases, target: rep.targetPct, over: rep.overTarget, co2: rep.co2 } : null,
    useFirst: sug?.useFirst.length ?? 0, orderLess: sug?.orderLess.length ?? 0,
  };
}

// ── FIRINGI ─────────────────────────────────────────────────────────────────

export async function adminKitchenOverview(ctx: Ctx) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, ["admin.settings.view", "admin.settings.manage", "admin.analytics.view"])) throw new ForbiddenError();
  const since = new Date(Date.now() - 30 * DAY);
  const [businesses, recipes, waste, donations, byReason, top] = await Promise.all([
    prisma.kitchenIngredient.groupBy({ by: ["companyId"] }).then((r) => r.length),
    prisma.kitchenRecipe.count({ where: { active: true } }),
    prisma.kitchenWaste.aggregate({ where: { kind: "WASTE", at: { gte: since } }, _sum: { cost: true, kgWeight: true, co2Kg: true }, _count: { _all: true } }),
    prisma.kitchenWaste.aggregate({ where: { kind: "DONATION", at: { gte: since } }, _sum: { kgWeight: true, cost: true }, _count: { _all: true } }),
    prisma.kitchenWaste.groupBy({ by: ["reason"], where: { kind: "WASTE", at: { gte: since } }, _sum: { cost: true }, _count: { _all: true } }),
    prisma.kitchenWaste.groupBy({ by: ["companyId"], where: { kind: "WASTE", at: { gte: since } }, _sum: { cost: true, kgWeight: true }, orderBy: { _sum: { cost: "desc" } }, take: 10 }),
  ]);
  const cos = await prisma.company.findMany({ where: { id: { in: top.map((t) => t.companyId) } }, select: { id: true, tradeName: true, legalName: true } });
  const cn = new Map(cos.map((c) => [c.id, c.tradeName ?? c.legalName]));
  return {
    businesses, recipes,
    waste: { cost: money(Number(waste._sum.cost ?? 0)), kg: Number(waste._sum.kgWeight ?? 0), co2: Number(waste._sum.co2Kg ?? 0), entries: waste._count._all },
    donations: { kg: Number(donations._sum.kgWeight ?? 0), cost: money(Number(donations._sum.cost ?? 0)), entries: donations._count._all },
    byReason: byReason.map((r) => ({ reason: r.reason ?? "OTHER", cost: money(Number(r._sum.cost ?? 0)), count: r._count._all })).sort((a, b) => b.cost - a.cost),
    top: top.map((t) => ({ companyId: t.companyId, name: cn.get(t.companyId) ?? "—", cost: money(Number(t._sum.cost ?? 0)), kg: Number(t._sum.kgWeight ?? 0) })),
  };
}

// ── daily job ───────────────────────────────────────────────────────────────

/** Recompute costs (alert on rises), waste over target (once a month), use-first reminder (once a day). */
export async function runKitchenJob(now = new Date()) {
  const s = await kitchenSettings();
  if (!s.enabled) return { companies: 0, rises: 0, wasteAlerts: 0, useFirst: 0 };
  const companies = await prisma.kitchenIngredient.groupBy({ by: ["companyId"] });
  let rises = 0, wasteAlerts = 0, useFirst = 0;
  const month = now.toISOString().slice(0, 7), today = now.toISOString().slice(0, 10);
  for (const { companyId } of companies) {
    const co = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true, type: true } });
    if (!co) continue;
    const a = await kitchenAccess(co, s);
    if (!a.on) continue;
    const r = await refreshCosts(companyId, { now }).catch(() => []);
    if (r.length && a.parts.alerts && a.parts.costing) {
      rises += r.length;
      const top = r.sort((x, y) => y.pct - x.pct)[0];
      await notify("kitchen.cost_rise", [{ companyId, link: "/buy/kitchen/recipes" }], { ingredient: top.name, pct: String(top.pct), count: String(r.length) }).catch(() => null);
    }
    const prof = await prisma.kitchenProfile.findUnique({ where: { companyId } });
    if (a.parts.alerts && a.parts.wasteReports && prof?.wasteAlertMonth !== month) {
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const [w, p] = await Promise.all([prisma.kitchenWaste.aggregate({ where: { companyId, kind: "WASTE", at: { gte: start } }, _sum: { cost: true } }), purchasesNet(companyId, start, now)]);
      const target = n(prof?.wasteTargetPct) ?? s.wasteTargetPct;
      const pct = p > 0 ? (Number(w._sum.cost ?? 0) / p) * 100 : 0;
      if (p > 0 && pct > target) {
        await notify("kitchen.waste_over", [{ companyId, link: "/buy/kitchen/waste/reports" }], { pct: String(Math.round(pct * 10) / 10), target: String(target) }).catch(() => null);
        await prisma.kitchenProfile.upsert({ where: { companyId }, create: { companyId, wasteAlertMonth: month }, update: { wasteAlertMonth: month } });
        wasteAlerts++;
      }
    }
    if (a.parts.alerts && a.parts.suggestions && prof?.useFirstSentOn !== today) {
      const soon = await prisma.purchasedLot.findMany({ where: { buyerCompanyId: companyId, expiresOn: { gte: new Date(now.getTime() - DAY), lte: new Date(now.getTime() + Math.min(2, s.useFirstDays) * DAY) } }, select: { qty: true, usedQty: true } });
      const count = soon.filter((l) => l.qty - l.usedQty > 0).length;
      if (count) {
        await notify("kitchen.use_first", [{ companyId, link: "/buy/kitchen/use-first" }], { count: String(count) }).catch(() => null);
        await prisma.kitchenProfile.upsert({ where: { companyId }, create: { companyId, useFirstSentOn: today }, update: { useFirstSentOn: today } });
        useFirst++;
      }
    }
  }
  return { companies: companies.length, rises, wasteAlerts, useFirst };
}

export { roundPrice, netOf };
