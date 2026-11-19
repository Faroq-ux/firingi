import "server-only";
/**
 * Phase 44: bulk food information from a spreadsheet (CSV / Excel). Two layouts are understood:
 *   • FIRINGI template — sku | gtin, one column per allergen (gluten, milk …: contains / may contain / free),
 *     ingredients_pt / ingredients_en …, basis, energy_kj, energy_kcal, fat, saturates, carbohydrate, sugars,
 *     fibre, protein, salt, diets, origin, storage_pt …, shelf_life_days, after_opening_days;
 *   • GS1 / GDSN style — gtin, allergen:AW … (CONTAINS / MAY_CONTAIN / FREE_FROM), nutrient:ENER-KJO …,
 *     ingredientStatement:pt …, countryOfOrigin, consumerStorageInstructions:pt …
 * Each row becomes the supplier's DRAFT version for that product (source IMPORT); `submit` sends the complete
 * ones to FIRINGI straight away. Preview first (apply = false) — nothing is saved.
 */
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { AppError, ForbiddenError, ValidationError } from "@/server/errors";
import { parseFile, type Sheet } from "@/server/integrations/catalogue-import";
import { ALLERGENS, blocking, DIETS, GS1_ALLERGEN, GS1_LEVEL, GS1_NUTRIENT, missingFields, NUTRIENTS, problems, type Level, type Nutrient } from "@/lib/food";
import { foodSettings, normaliseInput, problemText, saveFoodDraft, submitFood, type FoodInput } from "./service";

export const MAX_ROWS = 2000;
const NUT_ALIASES: Record<string, Nutrient> = {
  energy_kj: "energyKj", energykj: "energyKj", kj: "energyKj", energy_kcal: "energyKcal", energykcal: "energyKcal", kcal: "energyKcal", fat: "fat", saturates: "saturates", saturated_fat: "saturates",
  carbohydrate: "carbohydrate", carbohydrates: "carbohydrate", carbs: "carbohydrate", sugars: "sugars", sugar: "sugars", fibre: "fibre", fiber: "fibre", protein: "protein", salt: "salt",
};

/** contains / may contain / free from in a few languages and as GS1 codes; "" = not stated. */
export function parseLevel(raw: string): Level | null | "BAD" {
  const v = raw.trim().toLowerCase().replace(/[\s_-]+/g, " ");
  if (!v) return null;
  if (GS1_LEVEL[raw.trim().toUpperCase()]) return GS1_LEVEL[raw.trim().toUpperCase()];
  if (["contains", "c", "yes", "y", "x", "sim", "s", "contém", "contem", "contiene", "si", "sí", "enthält", "contient", "1"].includes(v)) return "CONTAINS";
  if (["may contain", "may", "m", "traces", "trace", "pode conter", "vestígios", "vestigios", "puede contener", "trazas", "kann enthalten", "spuren", "peut contenir", "traces possibles"].includes(v)) return "MAY_CONTAIN";
  if (["free", "free from", "f", "no", "n", "não", "nao", "0", "-", "sin", "libre", "frei", "sans", "none"].includes(v)) return "FREE";
  return "BAD";
}

type Col = { kind: "sku" | "gtin" | "allergen" | "ingredients" | "nutrient" | "basis" | "diets" | "origin" | "storage" | "shelf" | "opened"; key?: string };

/** Which column means what (header names, case-insensitive). */
export function mapHeaders(headers: string[]): (Col | null)[] {
  return headers.map((h) => {
    const raw = h.trim(), k = raw.toLowerCase().replace(/[\s-]+/g, "_");
    if (["sku", "firingi_sku", "codigo", "código"].includes(k)) return { kind: "sku" };
    if (["gtin", "ean", "barcode", "codigo_de_barras"].includes(k)) return { kind: "gtin" };
    const gs1a = raw.match(/^allergen:([A-Z]{2})$/i);
    if (gs1a && GS1_ALLERGEN[gs1a[1].toUpperCase()]) return { kind: "allergen", key: GS1_ALLERGEN[gs1a[1].toUpperCase()] };
    const ours = ALLERGENS.find((a) => a.toLowerCase() === k || `allergen_${a.toLowerCase()}` === k);
    if (ours) return { kind: "allergen", key: ours };
    const gs1n = raw.match(/^nutrient:(.+)$/i);
    if (gs1n && GS1_NUTRIENT[gs1n[1].toUpperCase()]) return { kind: "nutrient", key: GS1_NUTRIENT[gs1n[1].toUpperCase()] };
    if (NUT_ALIASES[k]) return { kind: "nutrient", key: NUT_ALIASES[k] };
    if (["basis", "nutrition_basis", "per"].includes(k)) return { kind: "basis" };
    const ing = raw.match(/^(?:ingredients|ingredientStatement)[:_]([a-z]{2}(?:-[A-Z]{2})?)$/i);
    if (ing) return { kind: "ingredients", key: ing[1].toLowerCase() };
    const sto = raw.match(/^(?:storage|consumerStorageInstructions)[:_]([a-z]{2}(?:-[A-Z]{2})?)$/i);
    if (sto) return { kind: "storage", key: sto[1].toLowerCase() };
    if (["diets", "claims", "diet"].includes(k)) return { kind: "diets" };
    if (["origin", "country_of_origin", "countryoforigin", "origem"].includes(k)) return { kind: "origin" };
    if (["shelf_life_days", "shelf_life", "minimumtradeitemlifespanfromtimeofproduction"].includes(k)) return { kind: "shelf" };
    if (["after_opening_days", "after_opening"].includes(k)) return { kind: "opened" };
    return null;
  });
}

export type ImportRow = { row: number; ref: string; productId: string | null; product: string | null; status: "OK" | "INCOMPLETE" | "ERROR" | "NOT_FOUND"; message: string | null; input: FoodInput | null };

function rowInput(cols: (Col | null)[], cells: string[]): { input: FoodInput; error: string | null } {
  const input: FoodInput = { allergens: {}, ingredients: {}, storage: {}, diets: [] };
  let nutrition: Record<string, unknown> | null = null;
  let error: string | null = null;
  cols.forEach((c, i) => {
    if (!c) return;
    const v = (cells[i] ?? "").trim();
    switch (c.kind) {
      case "allergen": { const l = parseLevel(v); if (l === "BAD") error ??= `${c.key!.toLowerCase()}: "${v}" — use contains, may contain or free`; else input.allergens![c.key!] = l; break; }
      case "ingredients": if (v) input.ingredients![c.key!] = v; break;
      case "storage": if (v) input.storage![c.key!] = v; break;
      case "nutrient": if (v) { nutrition ??= {}; nutrition[c.key!] = v; } break;
      case "basis": if (v) { nutrition ??= {}; nutrition.basis = /ml/i.test(v) ? "100ml" : "100g"; } break;
      case "diets": input.diets = v.split(/[,;|]/).map((x) => x.trim().toUpperCase().replace(/[\s-]+/g, "_")).filter(Boolean); break;
      case "origin": input.originCountryCode = v || null; break;
      case "shelf": input.shelfLifeDays = v || null; break;
      case "opened": input.afterOpeningDays = v || null; break;
    }
  });
  if (nutrition) input.nutrition = nutrition as FoodInput["nutrition"];
  const bad = (input.diets ?? []).find((d) => !(DIETS as readonly string[]).includes(d));
  if (bad) error ??= `diet "${bad}" is not known (${DIETS.join(", ").toLowerCase()})`;
  return { input, error };
}

/** Preview (apply = false) or import. `submit` sends complete rows to FIRINGI. */
export async function importFood(ctx: Ctx, i: { file: File; apply: boolean; submit?: boolean }) {
  const isVendor = ctx.company.type === "DISTRIBUTOR" || ctx.company.type === "WHOLESALER";
  if (!isVendor && ctx.company.type !== "ADMIN") throw new ForbiddenError();
  const s = await foodSettings();
  if (!s.enabled || !s.import) throw new AppError("FOOD_OFF", "Importing food information is switched off.");
  if (!i.file?.size) throw new ValidationError("Choose a CSV or Excel file.");
  const sheet: Sheet = await parseFile(Buffer.from(await i.file.arrayBuffer()), i.file.name);
  if (sheet.rows.length > MAX_ROWS) throw new ValidationError(`At most ${MAX_ROWS} rows per file.`);
  const cols = mapHeaders(sheet.headers);
  const ref = cols.findIndex((c) => c?.kind === "sku"), gtinCol = cols.findIndex((c) => c?.kind === "gtin");
  if (ref < 0 && gtinCol < 0) throw new ValidationError("The file needs a sku or gtin column.");
  if (!cols.some((c) => c && c.kind !== "sku" && c.kind !== "gtin")) throw new ValidationError("No food columns found — use the template.");

  // products this company may edit: those it sells (staff: any)
  const mine = await prisma.vendorOffer.findMany({
    where: ctx.company.type === "ADMIN" ? { status: { not: "ARCHIVED" } } : { vendorCompanyId: ctx.company.id, status: { not: "ARCHIVED" } },
    select: { vendorSku: true, packaging: { select: { gtin: true, variant: { select: { sku: true, gtin: true, product: { select: { id: true, name: true, categoryId: true } } } } } } },
  });
  const by = new Map<string, { id: string; name: string; categoryId: string }>();
  for (const o of mine) {
    const p = o.packaging.variant.product, v = { id: p.id, name: (p.name as Record<string, string>).en ?? Object.values(p.name as Record<string, string>)[0] ?? "", categoryId: p.categoryId };
    for (const k of [o.packaging.variant.sku, o.packaging.variant.gtin, o.packaging.gtin, o.vendorSku]) if (k) by.set(k.trim().toUpperCase(), v);
  }
  const { foodEditor } = await import("./service");
  const out: ImportRow[] = [];
  const seen = new Set<string>();
  for (let r = 0; r < sheet.rows.length; r++) {
    const cells = sheet.rows[r];
    const key = ((ref >= 0 ? cells[ref] : "") || (gtinCol >= 0 ? cells[gtinCol] : "") || "").trim();
    if (!key && cells.every((c) => !c?.trim())) continue;
    const p = by.get(key.toUpperCase());
    if (!p) { out.push({ row: r + 2, ref: key, productId: null, product: null, status: "NOT_FOUND", message: "No product of yours with this SKU / barcode", input: null }); continue; }
    if (seen.has(p.id)) { out.push({ row: r + 2, ref: key, productId: p.id, product: p.name, status: "ERROR", message: "This product is already in the file (one row per product)", input: null }); continue; }
    seen.add(p.id);
    const { input, error } = rowInput(cols, cells);
    if (error) { out.push({ row: r + 2, ref: key, productId: p.id, product: p.name, status: "ERROR", message: error, input: null }); continue; }
    let status: ImportRow["status"] = "OK", message: string | null = null;
    try {
      const d = normaliseInput(input);
      const bad = blocking(problems(d));
      if (bad.length) { status = "ERROR"; message = problemText(bad[0]); }
      else {
        const ed = await foodEditor(ctx, p.id);
        const miss = missingFields({ ...d, hasLabel: !!ed.files.label }, ed.required);
        if (miss.length) { status = "INCOMPLETE"; message = `Missing: ${miss.join(", ").toLowerCase().replace(/_/g, " ")}`; }
      }
    } catch (e) { status = "ERROR"; message = e instanceof Error ? e.message : String(e); }
    out.push({ row: r + 2, ref: key, productId: p.id, product: p.name, status, message, input: status === "ERROR" ? null : input });
  }
  let saved = 0, submitted = 0;
  if (i.apply) {
    for (const r of out) {
      if (!r.input || !r.productId) continue;
      await saveFoodDraft(ctx, r.productId, r.input, "IMPORT");
      saved++;
      if (i.submit && r.status === "OK") { await submitFood(ctx, r.productId); submitted++; }
    }
  }
  const count = (st: ImportRow["status"]) => out.filter((r) => r.status === st).length;
  return { rows: out.map((r) => ({ row: r.row, ref: r.ref, productId: r.productId, product: r.product, status: r.status, message: r.message })), totals: { rows: out.length, ok: count("OK"), incomplete: count("INCOMPLETE"), error: count("ERROR"), notFound: count("NOT_FOUND") }, saved, submitted, applied: i.apply };
}

/** The FIRINGI template (CSV, ; separated) — with the supplier's products listed when given. */
export function templateCsv(products: { sku: string; gtin: string | null; name: string }[] = [], layout: "firingi" | "gs1" = "firingi") {
  const head = layout === "gs1"
    ? ["gtin", ...Object.keys(GS1_ALLERGEN).map((c) => `allergen:${c}`), "ingredientStatement:pt", "ingredientStatement:en", ...["ENER-KJO", "ENER-E14", "FAT", "FASAT", "CHOAVL", "SUGAR-", "FIBTG", "PRO-", "SALTEQ"].map((n) => `nutrient:${n}`), "countryOfOrigin", "consumerStorageInstructions:pt"]
    : ["sku", "gtin", "name", ...ALLERGENS.map((a) => a.toLowerCase()), "ingredients_pt", "ingredients_en", "basis", "energy_kj", "energy_kcal", ...NUTRIENTS.filter((n) => !n.startsWith("energy")), "diets", "origin", "storage_pt", "shelf_life_days", "after_opening_days"];
  const rows = products.map((p) => (layout === "gs1" ? [p.gtin ?? ""] : [p.sku, p.gtin ?? "", p.name]).concat(Array(head.length - (layout === "gs1" ? 1 : 3)).fill("")));
  const esc = (v: string) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return "﻿" + [head, ...rows].map((r) => r.map(esc).join(";")).join("\r\n");
}
