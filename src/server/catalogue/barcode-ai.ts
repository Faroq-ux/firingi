import "server-only";
/**
 * Add a product by barcode with AI. A supplier types or scans a barcode:
 *  1. already in FIRINGI's catalogue → they sell it (no new product);
 *  2. else the open product databases are asked — Open Food Facts, Open Beauty Facts, Open Pet Food Facts and Open
 *     Products Facts (food, drinks, cosmetics & hygiene, pet food, household and other goods);
 *  3. the AI turns what was found (and/or photos of the package) into the proposal form: names, brand, FIRINGI
 *     category, VAT category, unit and pack, description, and for food the allergens, diets and ingredients;
 *  4. the supplier checks it, adds the price, and proposes it — FIRINGI approves as for any new product.
 * FIRINGI switches it on/off, per seller type, per part, per country and per company (Setting "barcodeAi.settings").
 * Development / tests: ASSISTANT_SIMULATE=1 (no AI key) or OFF_SIMULATE=1 simulate the databases and the AI.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import type { PermissionCode } from "@/server/rbac/permissions";
import { AppError, ForbiddenError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";
import { aiSettings, aiTransport } from "@/server/ai/assistant";
import { logAi } from "@/server/ai/feed";
import { ALLERGENS, DIETS } from "@/lib/food";
import {
  AiDraft, BA_PARTS, OFF_FIELDS, barcodeAiOn, innerGtin, mergeBa, offFacts, parseQuantity, unitFor, validGtin,
  type BarcodeAiSettings, type OffFacts, type OffProduct, type ProductDraft,
} from "@/lib/barcode-ai";

const KEY = "barcodeAi.settings";
export const BA_MANAGE: PermissionCode[] = ["admin.catalogue.manage", "admin.settings.manage"];
export const BA_VIEW: PermissionCode[] = ["admin.catalogue.view", "admin.catalogue.manage", "admin.settings.manage"];

// ── settings ───────────────────────────────────────────────────────────────

export async function barcodeAiSettings(): Promise<BarcodeAiSettings> {
  const row = await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: KEY } });
  return mergeBa(row?.value as Partial<BarcodeAiSettings> | null);
}
export async function saveBarcodeAiSettings(ctx: Ctx, input: Partial<BarcodeAiSettings>) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, BA_MANAGE)) throw new ForbiddenError();
  const before = await barcodeAiSettings();
  const next = mergeBa({ ...before, ...input, companies: input.companies ?? before.companies });
  await prisma.setting.upsert({
    where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key: KEY } },
    update: { value: next as unknown as Prisma.InputJsonValue, updatedById: ctx.user.id },
    create: { scope: "GLOBAL", key: KEY, value: next as unknown as Prisma.InputJsonValue, updatedById: ctx.user.id },
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "barcodeAi.settings", entityType: "Setting", entityId: KEY, before: before as unknown as Prisma.InputJsonValue, after: next as unknown as Prisma.InputJsonValue });
  return next;
}
export async function setCompanyBarcodeAi(ctx: Ctx, companyId: string, value: "ON" | "OFF" | null) {
  const s = await barcodeAiSettings();
  const companies = { ...s.companies };
  if (value) companies[companyId] = value; else delete companies[companyId];
  return saveBarcodeAiSettings(ctx, { companies });
}
export async function barcodeAiOverrides(ctx: Ctx) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, BA_VIEW)) throw new ForbiddenError();
  const s = await barcodeAiSettings();
  const ids = Object.keys(s.companies);
  const cos = ids.length ? await prisma.company.findMany({ where: { id: { in: ids } }, select: { id: true, legalName: true, tradeName: true, type: true, country: { select: { code: true } } } }) : [];
  return cos.map((c) => ({ id: c.id, name: c.tradeName ?? c.legalName, type: c.type, country: c.country?.code ?? "", state: s.companies[c.id] })).sort((a, b) => a.name.localeCompare(b.name));
}

const simulatingAi = () => process.env.ASSISTANT_SIMULATE === "1" && !process.env.ANTHROPIC_API_KEY && process.env.FIRINGI_ENV !== "production";
const simulatingDb = () => process.env.OFF_SIMULATE === "1" || (process.env.ASSISTANT_SIMULATE === "1" && process.env.FIRINGI_ENV !== "production");

/** What this supplier may use right now. */
export async function barcodeAiAccess(ctx: Ctx) {
  const s = await barcodeAiSettings();
  const code = ctx.company.countryCode ?? null;
  const on = barcodeAiOn(s, { id: ctx.company.id, type: ctx.company.type, countryCode: code });
  const governed = (await (await import("@/server/ai/ops/governance")).governance()).enabled;
  const aiReady = on && s.parts.ai && governed && (!!aiTransport() || simulatingAi());
  return { on, lookup: on && s.parts.lookup, ai: aiReady, photos: aiReady && s.parts.photos, settings: s };
}

// ── rate limit (per supplier, per hour; in memory — enough for one app server) ──
const hits = new Map<string, number[]>();
function limit(companyId: string, perHour: number) {
  const now = Date.now(), list = (hits.get(companyId) ?? []).filter((t) => t > now - 3_600_000);
  if (list.length >= perHour) throw new AppError("BARCODE_AI_LIMIT", "Too many barcode lookups this hour — try again later.");
  list.push(now); hits.set(companyId, list);
}
export function resetBarcodeAiLimitsForTests() { hits.clear(); }

// ── the open product databases ──────────────────────────────────────────────

/** Food & drinks, cosmetics & hygiene, pet food, everything else — asked in this order. */
export const OPEN_DBS = [
  { key: "food", host: "world.openfoodfacts.org", name: "Open Food Facts" },
  { key: "beauty", host: "world.openbeautyfacts.org", name: "Open Beauty Facts" },
  { key: "pet", host: "world.openpetfoodfacts.org", name: "Open Pet Food Facts" },
  { key: "products", host: "world.openproductsfacts.org", name: "Open Products Facts" },
] as const;
export type OpenDb = (typeof OPEN_DBS)[number]["key"];

/** Fixed records for development / tests (fictional brands). */
const SIM_DB: Record<string, { db: OpenDb; p: OffProduct }> = {
  "5609876543212": { db: "food", p: { product_name_en: "Extra virgin olive oil 750 ml", product_name_pt: "Azeite virgem extra 750 ml", brands: "Quinta do Vale", quantity: "750 ml", categories_tags: ["en:plant-based-foods", "en:fats", "en:olive-oils"], allergens_tags: [], labels_tags: ["en:organic"], ingredients_text_pt: "Azeite virgem extra." } },
  "5601111222333": { db: "food", p: { product_name: "Bolachas de manteiga", product_name_pt: "Bolachas de manteiga", brands: "Casa Doce", quantity: "6 x 200 g", categories_tags: ["en:snacks", "en:biscuits"], allergens_tags: ["en:gluten", "en:milk", "en:eggs"], traces_tags: ["en:nuts"], ingredients_text_pt: "Farinha de trigo, manteiga (leite), açúcar, ovos." } },
  "5602222333444": { db: "beauty", p: { product_name_en: "Shower gel 500 ml", product_name_pt: "Gel de banho 500 ml", brands: "Brisa", quantity: "500 ml", categories_tags: ["en:body", "en:shower-gels"] } },
  "5603333444555": { db: "products", p: { product_name_en: "Kitchen sponges, pack of 10", brands: "Limpa+", quantity: "10", categories_tags: ["en:household", "en:cleaning"] } },
};

async function fetchOne(db: (typeof OPEN_DBS)[number], code: string): Promise<OffProduct | null> {
  const url = `https://${db.host}/api/v2/product/${code}.json?fields=${OFF_FIELDS.join(",")}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 6000);
  try {
    // A generic client name only — never the supplier's or FIRINGI staff's details.
    const r = await fetch(url, { headers: { "User-Agent": "FIRINGI-Catalogue/1.0", Accept: "application/json" }, signal: ctrl.signal, cache: "no-store" });
    if (!r.ok) return null;
    const j = (await r.json()) as { status?: number; product?: OffProduct };
    return j.status === 1 && j.product ? j.product : null;
  } catch { return null; } finally { clearTimeout(t); }
}

/** The barcode in the open databases: the first that knows it. */
export async function lookupOpenDbs(code: string): Promise<{ db: OpenDb; name: string; facts: OffFacts } | null> {
  if (simulatingDb()) {
    const hit = SIM_DB[code];
    return hit ? { db: hit.db, name: OPEN_DBS.find((d) => d.key === hit.db)!.name, facts: offFacts(hit.p) } : null;
  }
  for (const db of OPEN_DBS) {
    const p = await fetchOne(db, code);
    if (p) { const facts = offFacts(p); if (Object.keys(facts.names).length || facts.brand) return { db: db.key, name: db.name, facts }; }
  }
  return null;
}

// ── FIRINGI's own lists, for the AI and for checking its answer ──────────────

async function options() {
  const [cats, taxes, units, brands] = await Promise.all([
    prisma.category.findMany({ where: { isActive: true }, select: { id: true, name: true, path: true, depth: true, restriction: true, defaultTaxCategoryId: true }, orderBy: { path: "asc" } }),
    prisma.taxCategory.findMany({ select: { id: true, code: true } }),
    prisma.unitOfMeasure.findMany({ select: { code: true, name: true } }),
    prisma.brand.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
  ]);
  const byId = new Map(cats.map((c) => [c.id, c]));
  const label = (c: (typeof cats)[number]) => c.path.split("/").filter(Boolean).map((id) => (byId.get(id)?.name as Record<string, string> | undefined)?.en ?? "").filter(Boolean).join(" › ") || ((c.name as Record<string, string>).en ?? "");
  return { cats: cats.map((c) => ({ ...c, label: label(c) })), taxes, units, brands };
}
type Opts = Awaited<ReturnType<typeof options>>;

/** A plain first guess at the category from words (when no AI): the category whose English name appears in the facts. */
function guessCategory(o: Opts, words: string) {
  const w = words.toLowerCase();
  let best: { id: string; depth: number } | null = null;
  for (const c of o.cats) {
    const n = ((c.name as Record<string, string>).en ?? "").toLowerCase();
    const parts = n.split(/[^a-z]+/).filter((x) => x.length > 3);
    if (parts.some((p) => w.includes(p.replace(/s$/, ""))) && (!best || c.depth > best.depth)) best = { id: c.id, depth: c.depth };
  }
  return best?.id ?? null;
}

/** Turn an answer (AI or rules) into the form's values, keeping only FIRINGI's own ids. */
function finish(o: Opts, code: string, a: AiDraft, facts: OffFacts | null, source: ProductDraft["source"], simulated: boolean): ProductDraft {
  const cat = a.categoryId ? o.cats.find((c) => c.id === a.categoryId) ?? null : null;
  const tax = (a.taxCategoryCode && o.taxes.find((t) => t.code === a.taxCategoryCode)) || (cat?.defaultTaxCategoryId ? o.taxes.find((t) => t.id === cat.defaultTaxCategoryId) : null) || o.taxes.find((t) => t.code === "STANDARD") || null;
  const brandName = (a.brandName || facts?.brand || "").trim();
  const brand = brandName ? o.brands.find((b) => b.name.toLowerCase() === brandName.toLowerCase()) ?? null : null;
  const uom = o.units.some((u) => u.code === a.uomCode) ? a.uomCode : "UN";
  const restriction = (cat?.restriction as "ALCOHOL" | "TOBACCO" | null) ?? a.restriction ?? null;
  const ingredients: Record<string, string> = { ...(facts?.ingredients ?? {}) };
  if (a.ingredients) ingredients[a.ingredientsLanguage && /^[a-z]{2}$/.test(a.ingredientsLanguage) ? a.ingredientsLanguage : "xx"] = a.ingredients;
  return {
    gtin: code, unitGtin: null, barcodeOn: a.barcodeOn, nameEn: a.nameEn.trim(), namePt: a.namePt.trim(),
    brandId: brand?.id ?? null, brandName, categoryId: cat?.id ?? null, taxCategoryId: tax?.id ?? null, restriction,
    uomCode: uom, unitsPerPack: a.unitsPerPack, packName: a.packName.trim() || a.nameEn.trim(),
    descriptionEn: a.descriptionEn.trim(), descriptionPt: a.descriptionPt.trim(),
    contain: [...new Set(a.contain)], mayContain: [...new Set(a.mayContain.filter((x) => !a.contain.includes(x)))], diets: [...new Set(a.diets)],
    ingredients: Object.fromEntries(Object.entries(ingredients).filter(([, v]) => v).map(([k, v]) => [k, v.slice(0, 3000)])),
    notes: a.notes.trim(), source, simulated,
  };
}

/** Without AI: what the database says, mapped by simple rules (the supplier picks the category if none matched). */
function ruleDraft(o: Opts, code: string, facts: OffFacts): ProductDraft {
  const q = parseQuantity(facts.quantity);
  const name = facts.names.en ?? facts.names.xx ?? Object.values(facts.names)[0] ?? "";
  return finish(o, code, AiDraft.parse({
    nameEn: name || code, namePt: facts.names.pt ?? "", brandName: facts.brand,
    categoryId: guessCategory(o, [name, facts.genericName, ...facts.categories].join(" ")),
    uomCode: unitFor(q.size), unitsPerPack: q.count, barcodeOn: q.count > 1 ? "PACK" : "UNIT",
    packName: q.count > 1 ? `${q.count} × ${q.size}` : q.size || name, descriptionEn: facts.genericName,
    contain: facts.contain, mayContain: facts.mayContain, diets: facts.diets,
  }), facts, "OFF", false);
}

// ── the AI ──────────────────────────────────────────────────────────────────

const TOOL = {
  name: "record_product",
  description: "Record the product for FIRINGI's catalogue proposal form. Use only what the data or the photos show — never invent.",
  input_schema: {
    type: "object" as const,
    properties: {
      barcodeOn: { type: "string", enum: ["UNIT", "PACK"], description: "Is the scanned barcode on a single item (UNIT) or on a case / multipack (PACK)?" },
      nameEn: { type: "string", description: "Short English product name as a wholesaler lists it: product, variety, size (e.g. 'Extra virgin olive oil 750 ml'). Keep the brand out unless it is part of the product name." },
      namePt: { type: "string", description: "The same in European Portuguese." },
      brandName: { type: "string", description: "The brand, or empty." },
      categoryId: { type: ["string", "null"], description: "The id of the MOST SPECIFIC matching category from FIRINGI's list, or null if none fits." },
      taxCategoryCode: { type: ["string", "null"], description: "VAT category code from the list if clear (e.g. REDUCED for basic food in Portugal, STANDARD for cosmetics); null to use the category's default." },
      restriction: { type: ["string", "null"], enum: ["ALCOHOL", "TOBACCO", null], description: "ALCOHOL for alcoholic drinks, TOBACCO for tobacco products, else null." },
      uomCode: { type: "string", description: "Unit code from the list: what one unit is sold as (UN unit, KG, L, PK pack, CX case…)." },
      unitsPerPack: { type: "integer", description: "Wholesale: how many single items are in what the scanned barcode is on (the case / multipack); 1 when the barcode is on a single item." },
      packName: { type: "string", description: "Wholesale packaging name, e.g. 'Case 6 × 750 ml', 'Box 24 × 33 cl', 'Bag 10 kg' — or 'Bottle 750 ml' for a single item." },
      descriptionEn: { type: "string", description: "One or two plain sentences, English. Empty if nothing useful." },
      descriptionPt: { type: "string", description: "The same in European Portuguese." },
      contain: { type: "array", items: { type: "string", enum: [...ALLERGENS] }, description: "Food only: EU allergens it contains (as listed/shown). Empty for non-food." },
      mayContain: { type: "array", items: { type: "string", enum: [...ALLERGENS] }, description: "Food only: 'may contain / traces of' allergens." },
      diets: { type: "array", items: { type: "string", enum: [...DIETS] }, description: "Food only: claims shown (vegan, organic, halal …)." },
      ingredients: { type: "string", description: "Food only: the ingredients list as given, else empty." },
      ingredientsLanguage: { type: "string", description: "ISO 639-1 code of the ingredients text." },
      notes: { type: "string", description: "One or two short sentences on what was unclear and the supplier must check. Empty if all clear." },
    },
    required: ["barcodeOn", "nameEn", "namePt", "brandName", "categoryId", "taxCategoryCode", "restriction", "uomCode", "unitsPerPack", "packName", "contain", "mayContain", "diets", "notes"],
  },
};

type Img = { mime: string; base64: string };
const IMG = ["image/jpeg", "image/png", "image/webp"];

/** Simulated AI (development / tests): the rule draft, marked as AI, with a note; from photos a fixed reading. */
function simulatedAi(o: Opts, code: string, facts: OffFacts | null, photos: number): ProductDraft {
  if (facts) {
    const d = ruleDraft(o, code, facts);
    return { ...d, namePt: d.namePt || d.nameEn, descriptionPt: d.descriptionPt || d.descriptionEn, notes: "Simulated AI — check every field.", source: photos ? "OFF_PHOTOS_AI" : "OFF_AI", simulated: true };
  }
  const cat = o.cats.find((c) => ((c.name as Record<string, string>).en ?? "").toLowerCase().includes("sauce")) ?? o.cats[0];
  return finish(o, code, AiDraft.parse({
    nameEn: "Tomato sauce 500 g", namePt: "Molho de tomate 500 g", brandName: "Horta Viva", categoryId: cat?.id ?? null, uomCode: "UN", unitsPerPack: 1,
    packName: "Jar 500 g", descriptionEn: "Tomato sauce for pasta and pizza.", descriptionPt: "Molho de tomate para massas e pizza.",
    contain: ["CELERY"], ingredients: "Tomate, cebola, aipo, azeite, sal.", ingredientsLanguage: "pt", notes: "Simulated reading of the photos — check every field.",
  }), null, "PHOTOS_AI", true);
}

async function aiDraft(ctx: Ctx, o: Opts, code: string, found: { name: string; facts: OffFacts } | null, photos: Img[]): Promise<ProductDraft> {
  const transport = aiTransport();
  if (!transport) {
    if (!simulatingAi()) throw new AppError("AI_NOT_CONFIGURED", "No AI is connected.");
    return simulatedAi(o, code, found?.facts ?? null, photos.length);
  }
  const settings = await aiSettings();
  const lists = [
    "FIRINGI categories (id — path):", ...o.cats.map((c) => `${c.id} — ${c.label}${c.restriction ? ` [${c.restriction}]` : ""}`),
    "", "VAT categories: " + o.taxes.map((t) => t.code).join(", "),
    "", "Units: " + o.units.map((u) => `${u.code} (${(u.name as Record<string, string>).en ?? u.code})`).join(", "),
  ].join("\n");
  const content: Anthropic.Beta.Messages.BetaContentBlockParam[] = [
    ...photos.map((p) => ({ type: "image" as const, source: { type: "base64" as const, media_type: p.mime as "image/jpeg" | "image/png" | "image/webp", data: p.base64 } })),
    { type: "text", text: [`Barcode: ${code}`, found ? `From ${found.name}:\n${JSON.stringify(found.facts)}` : "Not found in the open product databases.", photos.length ? `${photos.length} photo(s) of the package above.` : "", "", lists].join("\n") },
  ];
  const res = await Promise.race([
    transport({
      model: settings.model, max_tokens: 2500,
      system: "You prepare a new-product proposal for FIRINGI, a B2B WHOLESALE marketplace: distributors and wholesalers sell by the case, box or bulk pack to restaurants, cafés, hotels and shops in Europe — food, drinks, cosmetics, hygiene, household goods, pet supplies, tobacco, toys, packaging and more. From the product data and/or photos, fill in the form with the record_product tool. Pick FIRINGI's most specific matching category id from the list. Think wholesale: say whether the barcode is on the single item or on the case, give the items per case when the data or photos show it (e.g. '6 x 75 cl', a case label), and if the case size isn't shown say so in notes so the supplier adds it. Allergens, diets and ingredients only for food and drinks. Never invent facts that aren't in the data or photos; say what is unclear in notes.",
      tools: [TOOL as unknown as Anthropic.Beta.Messages.BetaTool],
      tool_choice: { type: "tool", name: TOOL.name },
      messages: [{ role: "user", content }],
    }),
    new Promise<never>((_, rej) => setTimeout(() => rej(new AppError("AI_TIMEOUT", "The AI took too long — try again, or fill the form in yourself.")), 25_000)),
  ]);
  const call = res.content.find((b) => b.type === "tool_use" && b.name === TOOL.name) as { input: unknown } | undefined;
  const parsed = AiDraft.safeParse(call?.input);
  if (!parsed.success) throw new AppError("AI_DRAFT_FAILED", "The AI couldn't read this product — fill the form in yourself.");
  await logAi({ kind: "BARCODE", ctx, summary: `Product draft for barcode ${code}`, detail: { code, source: found?.name ?? "photos", photos: photos.length }, model: settings.model, tokensIn: res.usage?.input_tokens, tokensOut: res.usage?.output_tokens }).catch(() => null);
  return finish(o, code, parsed.data, found?.facts ?? null, found ? (photos.length ? "OFF_PHOTOS_AI" : "OFF_AI") : "PHOTOS_AI", false);
}

/** For FIRINGI's page: the Schengen countries to switch and how many AI drafts were made in 30 days. */
export async function barcodeAiAdminFacts(ctx: Ctx) {
  if (!can(ctx, BA_VIEW)) throw new ForbiddenError();
  const [countries, proposed] = await Promise.all([
    prisma.country.findMany({ where: { isActive: true, isSchengen: true }, select: { code: true, name: true }, orderBy: { code: "asc" } }),
    prisma.aiActivity.count({ where: { kind: "BARCODE", at: { gte: new Date(Date.now() - 30 * 86_400_000) } } }),
  ]);
  return { countries, proposed };
}

// ── the supplier's steps ─────────────────────────────────────────────────────

/**
 * FIRINGI is wholesale: a case code (GTIN-14) goes on the case, the item inside gets its own barcode; the open databases
 * list single items, so when the barcode is on one item the supplier is reminded to set the case they sell.
 */
function wholesale(d: ProductDraft, code: string): ProductDraft {
  const item = innerGtin(code);
  if (item) return { ...d, gtin: code, unitGtin: item, barcodeOn: "PACK" };
  return { ...d, gtin: code, unitGtin: d.barcodeOn === "UNIT" ? code : null };
}

function supplier(ctx: Ctx) {
  if (!(ctx.company.type === "DISTRIBUTOR" || ctx.company.type === "WHOLESALER") || !can(ctx, "vendor.products.manage")) throw new ForbiddenError();
}

export type BarcodeResult =
  | { kind: "catalogue"; code: string; products: { id: string; name: string; packagings: number }[] }
  | { kind: "draft"; code: string; source: string | null; draft: ProductDraft }
  | { kind: "notFound"; code: string; photos: boolean };

/** Step 1: the barcode — in FIRINGI's catalogue, in an open database (→ a draft), or nowhere (→ photos / by hand). */
export async function startFromBarcode(ctx: Ctx, raw: string): Promise<BarcodeResult> {
  supplier(ctx);
  const access = await barcodeAiAccess(ctx);
  if (!access.on) throw new AppError("BARCODE_AI_OFF", "Adding products by barcode isn't switched on for your company.");
  const code = validGtin(raw);
  if (!code) throw new ValidationError("That isn't a valid barcode (EAN-8, UPC, EAN-13 or GTIN-14).");
  const item = innerGtin(code);
  const codes = item ? [code, item] : [code];
  const inCatalogue = await prisma.product.findMany({
    where: { status: { in: ["APPROVED", "PENDING_APPROVAL"] }, variants: { some: { OR: [{ gtin: { in: codes } }, { packagings: { some: { gtin: { in: codes } } } }] } } },
    select: { id: true, name: true, _count: { select: { variants: true } } }, take: 5,
  });
  if (inCatalogue.length) return { kind: "catalogue", code, products: inCatalogue.map((p) => ({ id: p.id, name: (p.name as Record<string, string>).en ?? Object.values(p.name as Record<string, string>)[0] ?? "", packagings: p._count.variants })) };
  limit(ctx.company.id, access.settings.hourlyLimit);
  const found = access.lookup ? await lookupOpenDbs(item ?? code) : null;
  if (!found) return { kind: "notFound", code, photos: access.photos };
  const o = await options();
  const draft = access.ai ? await aiDraft(ctx, o, code, found, []).catch(() => ruleDraft(o, code, found.facts)) : ruleDraft(o, code, found.facts);
  return { kind: "draft", code, source: found.name, draft: wholesale(draft, code) };
}

/** Step 1b: photos of the package (1–3) — the AI reads them (with any database data) into a draft. */
export async function draftFromPhotos(ctx: Ctx, raw: string, photos: Img[]): Promise<BarcodeResult> {
  supplier(ctx);
  const access = await barcodeAiAccess(ctx);
  if (!access.photos) throw new AppError("BARCODE_AI_OFF", "Reading package photos with AI isn't switched on for your company.");
  const code = validGtin(raw);
  if (!code) throw new ValidationError("That isn't a valid barcode (EAN-8, UPC, EAN-13 or GTIN-14).");
  if (!photos.length || photos.length > 3) throw new ValidationError("Add 1 to 3 photos of the package.");
  for (const p of photos) {
    if (!IMG.includes(p.mime)) throw new ValidationError("Photos must be JPG, PNG or WEBP.");
    if (p.base64.length > 7_000_000) throw new ValidationError("A photo is too large (max. 5 MB).");
  }
  limit(ctx.company.id, access.settings.hourlyLimit);
  const found = access.lookup ? await lookupOpenDbs(innerGtin(code) ?? code) : null;
  const o = await options();
  return { kind: "draft", code, source: found?.name ?? null, draft: wholesale(await aiDraft(ctx, o, code, found, photos), code) };
}

/** After the proposal: the food information from the draft as a DRAFT for the supplier to check (food only, best effort). */
export async function saveDraftFoodInfo(ctx: Ctx, productId: string, d: { contain: string[]; mayContain: string[]; diets: string[]; ingredients: Record<string, string> }) {
  if (!d.contain.length && !d.mayContain.length && !d.diets.length && !Object.keys(d.ingredients).length) return null;
  const { saveFoodDraft, foodSettings } = await import("@/server/food/service");
  if (!(await foodSettings()).enabled) return null;
  const allergens = Object.fromEntries(ALLERGENS.map((a) => [a, d.contain.includes(a) ? "CONTAINS" : d.mayContain.includes(a) ? "MAY_CONTAIN" : null]));
  const ingredients = Object.fromEntries(Object.entries(d.ingredients).filter(([l]) => /^[a-z]{2}$/.test(l)));
  return saveFoodDraft(ctx, productId, { allergens, ingredients, diets: d.diets.filter((x) => (DIETS as readonly string[]).includes(x)), nutrition: null }, "AI", "Filled in from the product databases / package photos when the product was added by barcode — check it.").catch(() => null);
}

export { BA_PARTS };
