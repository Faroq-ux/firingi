import "server-only";
/**
 * Food information & allergens (Phase 44, EU 1169/2011). Rules in src/lib/food.ts; docs in docs/food-info.md.
 *
 * Products are shared, so food information hangs off the product in versions (FoodInfo). A supplier selling
 * the product fills one in (by hand, from a spreadsheet / GS1 file, or as an AI draft read from the label photo)
 * and submits it; FIRINGI approves it (when review is on) and it becomes the product's current information —
 * the allergen / diet lists on Product are what buyers filter on. A recipe change is told to the customers who
 * bought the product. Categories say which fields they need; with "required to sell" on, a food product without
 * approved, complete information is hidden from buyers (Product.foodBlockedAt, see catalogue/visibility.ts).
 * Customers get badges, an allergen filter, the allergen book (PDF), recipe-change alerts, an optional kitchen
 * allergen profile, and — to inform their own shoppers — a public product page with shelf QR labels and a data
 * export. Every part is a FIRINGI switch.
 */
import { Prisma, type FoodInfo, type FoodInfoSource } from "@prisma/client";
import { prisma, type Tx } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";
import { notify } from "@/server/notify/dispatch";
import { readStored, storeUpload } from "@/server/services/storage";
import { pickLocalized } from "@/i18n/config";
import {
  activeFields, ALLERGENS, allergenLists, blocking, CERTIFIED_DIETS, completeness, DIETS, diffFood, effectiveFields, ingredientSegments, LEVELS,
  mergeFoodSettings, missingFields, notable, NUTRIENTS, pickLang, problems, profileHits,
  type Allergen, type AllergenMap, type Field, type FoodData, type FoodDiff, type FoodSettings, type Level, type Nutrition,
} from "@/lib/food";

const KEY = "food.settings";
const isStaff = (ctx: Ctx) => ctx.company.type === "ADMIN";
const isVendor = (ctx: Ctx) => ctx.company.type === "DISTRIBUTOR" || ctx.company.type === "WHOLESALER";
const cname = (c: { legalName: string; tradeName: string | null } | null | undefined) => (c ? c.tradeName ?? c.legalName : "");
const pname = (n: unknown, locale = "en") => pickLocalized(n as Record<string, string>, locale);
async function firingiId() { return (await prisma.company.findFirstOrThrow({ where: { type: "ADMIN" }, select: { id: true } })).id; }
const OPEN_ORDER = { notIn: ["CANCELLED"] as ("CANCELLED")[] };

// ── settings ────────────────────────────────────────────────────────────────

export async function foodSettings(db: Tx | typeof prisma = prisma): Promise<FoodSettings> {
  const row = await db.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: KEY } });
  return mergeFoodSettings(row?.value);
}

export async function saveFoodSettings(ctx: Ctx, input: FoodSettings) {
  if (!isStaff(ctx) || !can(ctx, "admin.settings.manage")) throw new ForbiddenError();
  const v = mergeFoodSettings(input);
  const before = await foodSettings();
  const row = await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: KEY } });
  if (row) await prisma.setting.update({ where: { id: row.id }, data: { value: v as unknown as Prisma.InputJsonValue, updatedById: ctx.user.id } });
  else await prisma.setting.create({ data: { scope: "GLOBAL", scopeId: "", key: KEY, value: v as unknown as Prisma.InputJsonValue, updatedById: ctx.user.id } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "food.settings", entityType: "Setting", entityId: KEY, before, after: v });
  await recomputeGate(prisma);
  return v;
}

// ── category requirements ───────────────────────────────────────────────────

type CatRow = { id: string; parentId: string | null; foodRequirements: unknown; name: unknown; slug: string; depth: number; path: string };
async function categories(db: Tx | typeof prisma = prisma): Promise<Map<string, CatRow>> {
  const rows = await db.category.findMany({ select: { id: true, parentId: true, foodRequirements: true, name: true, slug: true, depth: true, path: true } });
  return new Map(rows.map((r) => [r.id, r]));
}
function chain(cats: Map<string, CatRow>, id: string) {
  const out: CatRow[] = [];
  let c = cats.get(id);
  while (c) { out.push(c); c = c.parentId ? cats.get(c.parentId) : undefined; }
  return out;
}
/** The fields this category's products need (null = not food), before the settings' part switches. */
function categoryFields(cats: Map<string, CatRow>, categoryId: string): Field[] | null {
  return effectiveFields(chain(cats, categoryId));
}
/** What a product needs now (settings applied); [] = nothing (not food, or the feature off). */
async function requiredFor(categoryId: string, s: FoodSettings, cats?: Map<string, CatRow>): Promise<{ food: boolean; fields: Field[] }> {
  const f = categoryFields(cats ?? (await categories()), categoryId);
  if (!s.enabled || f === null || f.length === 0) return { food: false, fields: [] }; // [] = the category says "not food"
  return { food: true, fields: activeFields(f, s) };
}

export async function foodCategories(ctx: Ctx) {
  if (!isStaff(ctx) || !can(ctx, ["admin.catalogue.view", "admin.catalogue.manage"])) throw new ForbiddenError();
  const cats = await categories();
  const counts = await prisma.product.groupBy({ by: ["categoryId"], where: { status: "APPROVED" }, _count: true });
  const n = new Map(counts.map((c) => [c.categoryId, c._count]));
  return [...cats.values()].sort((a, b) => a.path.localeCompare(b.path)).map((c) => {
    const own = (c.foodRequirements as { fields?: Field[] } | null)?.fields ?? null;
    return { id: c.id, name: pname(c.name), depth: c.depth, own, effective: categoryFields(cats, c.id), inherited: own === null, products: n.get(c.id) ?? 0 };
  });
}

export async function saveCategoryRequirements(ctx: Ctx, categoryId: string, fields: string[] | null) {
  if (!isStaff(ctx) || !can(ctx, "admin.catalogue.manage")) throw new ForbiddenError();
  const cat = await prisma.category.findUnique({ where: { id: categoryId } });
  if (!cat) throw new NotFoundError("Category");
  const clean = fields === null ? null : [...new Set(fields)].filter((f) => ["ALLERGENS", "INGREDIENTS", "NUTRITION", "ORIGIN", "STORAGE", "SHELF_LIFE", "LABEL_PHOTO", "DIETS"].includes(f));
  await prisma.category.update({ where: { id: categoryId }, data: { foodRequirements: clean === null ? Prisma.DbNull : { fields: clean } } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "food.category_requirements", entityType: "Category", entityId: categoryId, before: { fields: (cat.foodRequirements as { fields?: string[] } | null)?.fields ?? null }, after: { fields: clean } });
  const subtree = await prisma.category.findMany({ where: { path: { startsWith: cat.path } }, select: { id: true } });
  const products = await prisma.product.findMany({ where: { categoryId: { in: subtree.map((c) => c.id) } }, select: { id: true } });
  await recomputeGate(prisma, products.map((p) => p.id));
}

// ── data in / out ───────────────────────────────────────────────────────────

type InfoRow = FoodInfo & { certificates?: { id: string; diet: string; number: string | null; issuer: string | null; expiresOn: Date | null; fileName: string | null; fileKey: string | null }[] };

export function toData(f: InfoRow | null): FoodData | null {
  if (!f) return null;
  return {
    allergens: (f.allergens ?? {}) as AllergenMap,
    allergenDetail: (f.allergenDetail ?? {}) as Partial<Record<Allergen, string>>,
    ingredients: (f.ingredients ?? {}) as Record<string, string>,
    nutrition: (f.nutrition ?? null) as Nutrition | null,
    diets: f.diets,
    originCountryCode: f.originCountryCode,
    storage: (f.storage ?? {}) as Record<string, string>,
    shelfLifeDays: f.shelfLifeDays,
    afterOpeningDays: f.afterOpeningDays,
    hasLabel: !!f.labelKey,
    certificates: (f.certificates ?? []).map((c) => ({ diet: c.diet, expiresOn: c.expiresOn })),
  };
}

export type FoodInput = {
  allergens?: Record<string, string | null>;
  allergenDetail?: Record<string, string | null>;
  ingredients?: Record<string, string | null>;
  nutrition?: { basis?: string; [k: string]: unknown } | null;
  diets?: string[];
  originCountryCode?: string | null;
  storage?: Record<string, string | null>;
  shelfLifeDays?: number | string | null;
  afterOpeningDays?: number | string | null;
};

const LANG = /^[a-z]{2}(-[A-Z]{2})?$/;
function cleanText(m: Record<string, string | null> | undefined, max = 5000) {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(m ?? {})) {
    if (!LANG.test(k)) throw new ValidationError(`Unknown language code "${k}".`);
    const t = (v ?? "").trim();
    if (t) out[k] = t.slice(0, max);
  }
  return out;
}
const numOrNull = (v: unknown) => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", ".").trim());
  if (!Number.isFinite(n)) throw new ValidationError("Numbers only, please.");
  return n;
};
const intOrNull = (v: unknown) => { const n = numOrNull(v); return n === null ? null : Math.round(n); };

/** Validate and normalise what a supplier / the import / the AI sends. */
export function normaliseInput(i: FoodInput): Omit<FoodData, "hasLabel" | "certificates"> {
  const allergens: AllergenMap = {};
  for (const [k, v] of Object.entries(i.allergens ?? {})) {
    if (!(ALLERGENS as readonly string[]).includes(k)) throw new ValidationError(`Unknown allergen "${k}".`);
    if (v === null || v === "") continue;
    if (!(LEVELS as readonly string[]).includes(v)) throw new ValidationError(`Allergen ${k}: choose contains, may contain or free from.`);
    allergens[k as Allergen] = v as Level;
  }
  const detail: Partial<Record<Allergen, string>> = {};
  for (const [k, v] of Object.entries(i.allergenDetail ?? {})) if ((ALLERGENS as readonly string[]).includes(k) && v?.trim()) detail[k as Allergen] = v.trim().slice(0, 200);
  let nutrition: Nutrition | null = null;
  if (i.nutrition) {
    const n: Nutrition = { basis: i.nutrition.basis === "100ml" ? "100ml" : "100g" };
    let any = false;
    for (const k of NUTRIENTS) { const v = numOrNull(i.nutrition[k]); if (v !== null) { n[k] = Math.round(v * 100) / 100; any = true; } }
    nutrition = any ? n : null;
  }
  const diets = [...new Set(i.diets ?? [])];
  for (const d of diets) if (!(DIETS as readonly string[]).includes(d)) throw new ValidationError(`Unknown diet "${d}".`);
  const origin = i.originCountryCode?.trim().toUpperCase() || null;
  return {
    allergens, allergenDetail: detail, ingredients: cleanText(i.ingredients), nutrition, diets, originCountryCode: origin,
    storage: cleanText(i.storage, 500), shelfLifeDays: intOrNull(i.shelfLifeDays), afterOpeningDays: intOrNull(i.afterOpeningDays),
  };
}

// ── who may edit a product's food information ───────────────────────────────

async function assertCanEdit(ctx: Ctx, productId: string) {
  const product = await prisma.product.findUnique({ where: { id: productId }, select: { id: true, name: true, categoryId: true, proposedByCompanyId: true, foodInfoId: true, status: true } });
  if (!product) throw new NotFoundError("Product");
  if (isStaff(ctx)) {
    if (!can(ctx, ["admin.catalogue.manage", "admin.catalogue.approve"])) throw new ForbiddenError();
    return product;
  }
  if (!isVendor(ctx) || !can(ctx, "vendor.products.manage")) throw new ForbiddenError();
  const sells = product.proposedByCompanyId === ctx.company.id || (await prisma.vendorOffer.count({ where: { vendorCompanyId: ctx.company.id, packaging: { variant: { productId } } } })) > 0;
  if (!sells) throw new NotFoundError("Product");
  return product;
}

// ── supplier: list & editor ─────────────────────────────────────────────────

export async function supplierFoodList(ctx: Ctx, opts: { q?: string; show?: "all" | "todo" } = {}, locale = "en") {
  if (!isVendor(ctx) || !can(ctx, ["vendor.products.view", "vendor.products.manage"])) throw new ForbiddenError();
  const s = await foodSettings();
  const cats = await categories();
  const offers = await prisma.vendorOffer.findMany({
    where: { vendorCompanyId: ctx.company.id, status: { not: "ARCHIVED" }, ...(opts.q ? { packaging: { variant: { product: { searchText: { contains: opts.q.toLowerCase() } } } } } : {}) },
    select: { id: true, status: true, vendorSku: true, packaging: { select: { variant: { select: { sku: true, gtin: true, product: { select: { id: true, name: true, categoryId: true, foodBlockedAt: true, foodInfoId: true, foodInfo: { include: { certificates: true } } } } } } } } },
  });
  const byProduct = new Map<string, (typeof offers)[number][]>();
  for (const o of offers) { const p = o.packaging.variant.product; byProduct.set(p.id, [...(byProduct.get(p.id) ?? []), o]); }
  const ids = [...byProduct.keys()];
  const latest = await prisma.foodInfo.findMany({ where: { productId: { in: ids }, submittedByCompanyId: ctx.company.id, status: { in: ["DRAFT", "PENDING", "REJECTED"] } }, orderBy: { version: "desc" } });
  const mine = new Map<string, FoodInfo>();
  for (const f of latest) if (!mine.has(f.productId)) mine.set(f.productId, f);
  const rows = [];
  for (const [pid, os] of byProduct) {
    const p = os[0].packaging.variant.product;
    const req = await requiredFor(p.categoryId, s, cats);
    if (!req.food) continue;
    const cur = toData(p.foodInfo);
    const missing = cur ? missingFields(cur, req.fields) : req.fields;
    const m = mine.get(pid);
    rows.push({
      productId: pid, name: pname(p.name, locale), sku: os[0].packaging.variant.sku, gtin: os[0].packaging.variant.gtin, offers: os.length, required: req.fields,
      approved: !!p.foodInfoId, score: completeness(cur, req.fields), missing, blocked: !!p.foodBlockedAt,
      mine: m ? { id: m.id, status: m.status, reviewNote: m.reviewNote, version: m.version } : null,
      contain: cur ? allergenLists(cur.allergens).contain : [],
    });
  }
  rows.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
  const out = opts.show === "todo" ? rows.filter((r) => r.score < 100 || r.mine?.status === "REJECTED") : rows;
  return {
    settings: s,
    rows: out,
    totals: { products: rows.length, complete: rows.filter((r) => r.approved && r.score === 100).length, pending: rows.filter((r) => r.mine?.status === "PENDING").length, blocked: rows.filter((r) => r.blocked).length },
  };
}

/** The editor: product, what's required, the current approved info and the supplier's own working version. */
export async function foodEditor(ctx: Ctx, productId: string, locale = "en") {
  const product = await assertCanEdit(ctx, productId);
  const s = await foodSettings();
  const req = await requiredFor(product.categoryId, s);
  const [current, working] = await Promise.all([
    product.foodInfoId ? prisma.foodInfo.findUnique({ where: { id: product.foodInfoId }, include: { certificates: true } }) : null,
    prisma.foodInfo.findFirst({ where: { productId, status: { in: ["DRAFT", "PENDING", "REJECTED"] }, ...(isStaff(ctx) ? {} : { submittedByCompanyId: ctx.company.id }) }, orderBy: { version: "desc" }, include: { certificates: true } }),
  ]);
  const show = working ?? current;
  const data = toData(show);
  return {
    product: { id: product.id, name: pname(product.name, locale), status: product.status },
    settings: s, required: req.fields, food: req.food,
    current: current ? { id: current.id, version: current.version, data: toData(current)!, approvedAt: current.reviewedAt } : null,
    working: working ? { id: working.id, version: working.version, status: working.status, source: working.source, reviewNote: working.reviewNote, aiNote: working.aiNote, submittedAt: working.submittedAt, updatedAt: working.updatedAt } : null,
    data,
    files: show ? { label: show.labelName, spec: show.specName, labelId: show.labelKey ? show.id : null, specId: show.specKey ? show.id : null } : { label: null, spec: null, labelId: null, specId: null },
    certificates: (show?.certificates ?? []).map((c) => ({ id: c.id, diet: c.diet, number: c.number, issuer: c.issuer, expiresOn: c.expiresOn ? c.expiresOn.toISOString().slice(0, 10) : null, file: c.fileName })),
    missing: data ? missingFields(data, req.fields) : req.fields,
    problems: data ? problems(data) : [],
    editable: !working || working.status !== "PENDING" || isStaff(ctx),
  };
}

/** The supplier's working version (DRAFT / REJECTED → back to DRAFT), created from the current info when there's none. */
async function workingVersion(tx: Tx, ctx: Ctx, productId: string, source: FoodInfoSource): Promise<InfoRow> {
  const mine = await tx.foodInfo.findFirst({ where: { productId, status: { in: ["DRAFT", "PENDING", "REJECTED"] }, ...(isStaff(ctx) ? {} : { submittedByCompanyId: ctx.company.id }) }, orderBy: { version: "desc" }, include: { certificates: true } });
  if (mine) {
    if (mine.status !== "DRAFT") await tx.foodInfo.update({ where: { id: mine.id }, data: { status: "DRAFT", submittedAt: null, reviewNote: mine.status === "REJECTED" ? mine.reviewNote : null } });
    return mine;
  }
  const product = await tx.product.findUniqueOrThrow({ where: { id: productId }, select: { foodInfoId: true } });
  const base = product.foodInfoId ? await tx.foodInfo.findUnique({ where: { id: product.foodInfoId }, include: { certificates: true } }) : null;
  const last = await tx.foodInfo.aggregate({ where: { productId }, _max: { version: true } });
  const created = await tx.foodInfo.create({
    data: {
      productId, version: (last._max.version ?? 0) + 1, status: "DRAFT", source, submittedByCompanyId: ctx.company.id,
      ...(base ? {
        allergens: base.allergens as Prisma.InputJsonValue, allergenDetail: base.allergenDetail as Prisma.InputJsonValue, ingredients: base.ingredients as Prisma.InputJsonValue,
        nutrition: (base.nutrition ?? undefined) as Prisma.InputJsonValue | undefined, diets: base.diets, originCountryCode: base.originCountryCode, storage: base.storage as Prisma.InputJsonValue,
        shelfLifeDays: base.shelfLifeDays, afterOpeningDays: base.afterOpeningDays, labelKey: base.labelKey, labelName: base.labelName, labelMime: base.labelMime,
        specKey: base.specKey, specName: base.specName, specMime: base.specMime,
      } : {}),
    },
  });
  if (base?.certificates?.length)
    await tx.foodCertificate.createMany({ data: base.certificates.map((c) => ({ foodInfoId: created.id, diet: c.diet, number: c.number, issuer: c.issuer, expiresOn: c.expiresOn, fileKey: c.fileKey, fileName: c.fileName, mimeType: c.mimeType })) });
  return { ...created, certificates: [] };
}

export async function saveFoodDraft(ctx: Ctx, productId: string, input: FoodInput, source: FoodInfoSource = "MANUAL", aiNote?: string | null) {
  await assertCanEdit(ctx, productId);
  const s = await foodSettings();
  if (!s.enabled) throw new AppError("FOOD_OFF", "Food information is switched off.");
  const d = normaliseInput(input);
  const bad = blocking(problems({ ...d, certificates: undefined }));
  if (bad.length) throw new AppError(`FOOD_${bad[0].code}`, problemText(bad[0]));
  const id = await prisma.$transaction(async (tx) => {
    const w = await workingVersion(tx, ctx, productId, source);
    await tx.foodInfo.update({
      where: { id: w.id },
      data: {
        allergens: d.allergens as Prisma.InputJsonValue, allergenDetail: (d.allergenDetail ?? {}) as Prisma.InputJsonValue, ingredients: d.ingredients as Prisma.InputJsonValue,
        nutrition: d.nutrition ? (d.nutrition as unknown as Prisma.InputJsonValue) : Prisma.DbNull, diets: d.diets, originCountryCode: d.originCountryCode,
        storage: d.storage as Prisma.InputJsonValue, shelfLifeDays: d.shelfLifeDays, afterOpeningDays: d.afterOpeningDays, source: source === "MANUAL" && w.source !== "MANUAL" ? w.source : source,
        ...(aiNote !== undefined ? { aiNote } : {}),
      },
    });
    return w.id;
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "food.draft_saved", entityType: "FoodInfo", entityId: id, after: { productId, source } });
  return id;
}

/** The label photo or the supplier's spec sheet on the working version. */
export async function uploadFoodFile(ctx: Ctx, productId: string, kind: "LABEL" | "SPEC", file: File) {
  await assertCanEdit(ctx, productId);
  if (!file || !file.size) throw new ValidationError("Choose a file.");
  if (kind === "LABEL" && !["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(file.type)) throw new ValidationError("The label must be a photo (JPG, PNG, WEBP) or a PDF.");
  const stored = await storeUpload(file, `food/${productId}`);
  const id = await prisma.$transaction(async (tx) => {
    const w = await workingVersion(tx, ctx, productId, "MANUAL");
    await tx.foodInfo.update({ where: { id: w.id }, data: kind === "LABEL" ? { labelKey: stored.key, labelName: stored.fileName, labelMime: stored.mimeType } : { specKey: stored.key, specName: stored.fileName, specMime: stored.mimeType } });
    return w.id;
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: `food.${kind.toLowerCase()}_uploaded`, entityType: "FoodInfo", entityId: id, after: { file: stored.fileName, sha256: stored.sha256 } });
  return id;
}

export async function saveCertificate(ctx: Ctx, productId: string, i: { diet: string; number?: string | null; issuer?: string | null; expiresOn?: string | null; file?: File | null }) {
  await assertCanEdit(ctx, productId);
  if (!(DIETS as readonly string[]).includes(i.diet)) throw new ValidationError("Choose the claim the certificate is for.");
  const exp = i.expiresOn ? new Date(`${i.expiresOn}T00:00:00Z`) : null;
  if (exp && Number.isNaN(exp.getTime())) throw new ValidationError("Use a date like 2027-12-31.");
  if (!i.number?.trim() && !i.file?.size) throw new ValidationError("Give the certificate number or upload the certificate.");
  const stored = i.file?.size ? await storeUpload(i.file, `food/${productId}/certificates`) : null;
  return prisma.$transaction(async (tx) => {
    const w = await workingVersion(tx, ctx, productId, "MANUAL");
    const c = await tx.foodCertificate.create({ data: { foodInfoId: w.id, diet: i.diet, number: i.number?.trim() || null, issuer: i.issuer?.trim() || null, expiresOn: exp, fileKey: stored?.key, fileName: stored?.fileName, mimeType: stored?.mimeType } });
    if (!w.diets.includes(i.diet)) await tx.foodInfo.update({ where: { id: w.id }, data: { diets: [...w.diets, i.diet] } });
    return c.id;
  });
}

export async function removeCertificate(ctx: Ctx, certificateId: string) {
  const c = await prisma.foodCertificate.findUnique({ where: { id: certificateId }, include: { foodInfo: true } });
  if (!c) throw new NotFoundError("Certificate");
  await assertCanEdit(ctx, c.foodInfo.productId);
  if (c.foodInfo.status !== "DRAFT" && c.foodInfo.status !== "REJECTED") throw new AppError("BAD_STATUS", "Only a draft can be changed.");
  await prisma.foodCertificate.delete({ where: { id: certificateId } });
}

export function problemText(p: { code: string; field: string }) {
  const T: Record<string, string> = {
    SATURATES_GT_FAT: "Saturates can't be more than fat.", SUGARS_GT_CARBS: "Sugars can't be more than carbohydrate.", ENERGY_MISMATCH: "Energy in kJ and kcal don't match (1 kcal = 4.184 kJ).",
    OVER_100G: "Fat, carbohydrate, fibre, protein and salt add up to more than 100 g.", ENERGY_TOO_HIGH: "More than 900 kcal per 100 is not possible.", NEGATIVE: `${p.field} can't be negative.`,
    VEGAN_CONFLICT: "A vegan product can't contain milk, eggs, fish or shellfish.", VEGETARIAN_CONFLICT: "A vegetarian product can't contain fish or shellfish.", GLUTEN_FREE_CONFLICT: "A gluten-free product can't contain gluten.",
    UNBALANCED_STARS: `Ingredients (${p.field}): an allergen marked with * is not closed.`, BAD_COUNTRY: "Country of origin: a 2-letter code like PT.", BAD_DAYS: "Days: a whole number from 1 to 3650.",
    UNKNOWN_DIET: `Unknown claim "${p.field}".`, UNKNOWN_ALLERGEN: `Unknown allergen "${p.field}".`, BAD_LEVEL: `Allergen ${p.field}: choose contains, may contain or free from.`, BAD_BASIS: "Nutrition is per 100 g or per 100 ml.", TOO_LONG: "The ingredients text is too long.",
  };
  return T[p.code] ?? p.code;
}

/** Send the working version to FIRINGI (or straight live when FIRINGI doesn't review). */
export async function submitFood(ctx: Ctx, productId: string) {
  const product = await assertCanEdit(ctx, productId);
  const s = await foodSettings();
  const w = await prisma.foodInfo.findFirst({ where: { productId, status: "DRAFT", ...(isStaff(ctx) ? {} : { submittedByCompanyId: ctx.company.id }) }, orderBy: { version: "desc" }, include: { certificates: true } });
  if (!w) throw new AppError("NO_DRAFT", "There is nothing to send — save your changes first.");
  const data = toData(w)!;
  const req = await requiredFor(product.categoryId, s);
  const missing = missingFields(data, req.fields);
  if (missing.length) throw new AppError("FOOD_INCOMPLETE", `Still missing: ${missing.join(", ").toLowerCase().replace(/_/g, " ")}.`);
  const bad = blocking(problems(data));
  if (bad.length) throw new AppError(`FOOD_${bad[0].code}`, problemText(bad[0]));
  await prisma.foodInfo.update({ where: { id: w.id }, data: { status: "PENDING", submittedAt: new Date(), submittedById: ctx.user.id, reviewNote: null } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "food.submitted", entityType: "FoodInfo", entityId: w.id, after: { productId, version: w.version } });
  if (!s.review || isStaff(ctx)) return approveVersion(ctx, w.id, null, { auto: !isStaff(ctx) });
  await notify("food.review", [{ companyId: await firingiId(), link: `/admin/catalogue/food-review/${w.id}` }], { company: cname(ctx.company), product: pname(product.name) }, { ref: { type: "FoodInfo", id: w.id } }).catch(() => null);
  return { id: w.id, status: "PENDING" as const };
}

export async function withdrawFood(ctx: Ctx, productId: string) {
  await assertCanEdit(ctx, productId);
  const w = await prisma.foodInfo.findFirst({ where: { productId, status: "PENDING", ...(isStaff(ctx) ? {} : { submittedByCompanyId: ctx.company.id }) } });
  if (!w) throw new AppError("BAD_STATUS", "Nothing is waiting for FIRINGI.");
  await prisma.foodInfo.update({ where: { id: w.id }, data: { status: "DRAFT", submittedAt: null } });
}

// ── FIRINGI: review ─────────────────────────────────────────────────────────

const requireReview = (ctx: Ctx) => { if (!isStaff(ctx) || !can(ctx, "admin.catalogue.approve")) throw new ForbiddenError(); };

export async function reviewQueue(ctx: Ctx) {
  if (!isStaff(ctx) || !can(ctx, ["admin.catalogue.view", "admin.catalogue.approve"])) throw new ForbiddenError();
  const rows = await prisma.foodInfo.findMany({
    where: { status: "PENDING" }, orderBy: { submittedAt: "asc" }, take: 300,
    include: { product: { select: { id: true, name: true, foodInfo: true } }, submittedBy: { select: { legalName: true, tradeName: true } } },
  });
  return rows.map((r) => {
    const diff = diffFood(toData(r.product.foodInfo), toData(r)!);
    return {
      id: r.id, productId: r.productId, product: pname(r.product.name), version: r.version, source: r.source, supplier: cname(r.submittedBy), submittedAt: r.submittedAt,
      isNew: !r.product.foodInfo, diff, allergenAdded: !!diff && (diff.allergensAdded.length > 0 || diff.mayContainAdded.length > 0),
    };
  });
}

export async function reviewDetail(ctx: Ctx, id: string) {
  if (!isStaff(ctx) || !can(ctx, ["admin.catalogue.view", "admin.catalogue.approve"])) throw new ForbiddenError();
  const r = await prisma.foodInfo.findUnique({ where: { id }, include: { certificates: true, product: { select: { id: true, name: true, categoryId: true, foodInfo: { include: { certificates: true } } } }, submittedBy: { select: { legalName: true, tradeName: true } } } });
  if (!r) throw new NotFoundError("Food information");
  const s = await foodSettings();
  const req = await requiredFor(r.product.categoryId, s);
  const data = toData(r)!;
  const prev = toData(r.product.foodInfo ?? null);
  const offers = await prisma.vendorOffer.findMany({ where: { packaging: { variant: { productId: r.productId } }, status: { not: "ARCHIVED" } }, select: { id: true, vendorSku: true, vendor: { select: { legalName: true, tradeName: true } }, packaging: { select: { variant: { select: { sku: true } } } } } });
  return {
    id: r.id, status: r.status, version: r.version, source: r.source, aiNote: r.aiNote, reviewNote: r.reviewNote, submittedAt: r.submittedAt, supplier: cname(r.submittedBy),
    product: { id: r.product.id, name: pname(r.product.name) }, required: req.fields, data, previous: prev, diff: diffFood(prev, data),
    missing: missingFields(data, req.fields), problems: problems(data).map((p) => ({ ...p, text: problemText(p) })),
    files: { label: r.labelName ? r.id : null, labelName: r.labelName, labelMime: r.labelMime, spec: r.specName ? r.id : null, specName: r.specName },
    certificates: r.certificates.map((c) => ({ id: c.id, diet: c.diet, number: c.number, issuer: c.issuer, expiresOn: c.expiresOn, file: c.fileName })),
    offers: offers.map((o) => ({ id: o.id, label: `${cname(o.vendor)} · ${o.packaging.variant.sku}${o.vendorSku ? ` · ${o.vendorSku}` : ""}` })),
    recallLink: s.recallLink,
  };
}

export async function approveFood(ctx: Ctx, id: string, note?: string | null) {
  requireReview(ctx);
  return approveVersion(ctx, id, note ?? null, { auto: false });
}

async function approveVersion(ctx: Ctx, id: string, note: string | null, o: { auto: boolean }) {
  const s = await foodSettings();
  const res = await prisma.$transaction(async (tx) => {
    const v = await tx.foodInfo.findUnique({ where: { id }, include: { certificates: true, product: { select: { id: true, name: true, categoryId: true, foodInfoId: true, foodInfo: { include: { certificates: true } } } } } });
    if (!v) throw new NotFoundError("Food information");
    if (v.status !== "PENDING") throw new AppError("BAD_STATUS", "This version is not waiting for approval.");
    const data = toData(v)!;
    const req = await requiredFor(v.product.categoryId, s, await categories(tx));
    const missing = missingFields(data, req.fields);
    if (missing.length) throw new AppError("FOOD_INCOMPLETE", `Still missing: ${missing.join(", ").toLowerCase().replace(/_/g, " ")}.`);
    const prev = toData(v.product.foodInfo ?? null);
    const diff = diffFood(prev, data);
    if (v.product.foodInfoId) await tx.foodInfo.update({ where: { id: v.product.foodInfoId }, data: { status: "SUPERSEDED" } });
    await tx.foodInfo.update({ where: { id }, data: { status: "APPROVED", reviewedById: ctx.user.id, reviewedAt: new Date(), reviewNote: note?.trim() || (o.auto ? "Published without review (FIRINGI review is off)." : null), changes: (diff ?? undefined) as unknown as Prisma.InputJsonValue | undefined } });
    const l = allergenLists(data.allergens);
    await tx.product.update({ where: { id: v.productId }, data: { foodInfoId: id, allergensContain: l.contain, allergensMayContain: l.mayContain, allergensFree: l.free, diets: data.diets, ...(data.originCountryCode ? { originCountryCode: data.originCountryCode } : {}) } });
    let change: { id: string; allergenAdded: boolean } | null = null;
    if (diff && notable(diff)) {
      const c = await tx.foodChange.create({ data: { productId: v.productId, foodInfoId: id, previousId: v.product.foodInfoId, summary: diff as unknown as Prisma.InputJsonValue, allergenAdded: diff.allergensAdded.length > 0 || diff.mayContainAdded.length > 0 } });
      change = { id: c.id, allergenAdded: c.allergenAdded };
    }
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: o.auto ? "food.published" : "food.approved", entityType: "FoodInfo", entityId: id, before: prev ? { allergens: prev.allergens, diets: prev.diets } : null, after: { allergens: data.allergens, diets: data.diets, note } }, tx);
    return { product: v.product, submittedBy: v.submittedByCompanyId, change, diff };
  });
  await recomputeGate(prisma, [res.product.id]);
  if (res.submittedBy && !o.auto && res.submittedBy !== ctx.company.id)
    await notify("food.decided", [{ companyId: res.submittedBy, link: `/vendor/products/food/${res.product.id}` }], { product: pname(res.product.name), status: "approved", note: note ?? "" }).catch(() => null);
  if (res.change && s.changeAlerts) await tellBuyers(res.product.id, res.change.id, res.diff!, s);
  return { id, status: "APPROVED" as const, changed: !!res.change, allergenAdded: !!res.change?.allergenAdded };
}

export async function rejectFood(ctx: Ctx, id: string, note: string) {
  requireReview(ctx);
  if (!note?.trim()) throw new ValidationError("Tell the supplier what to fix.");
  const v = await prisma.foodInfo.findUnique({ where: { id }, include: { product: { select: { id: true, name: true } } } });
  if (!v) throw new NotFoundError("Food information");
  if (v.status !== "PENDING") throw new AppError("BAD_STATUS", "This version is not waiting for approval.");
  await prisma.foodInfo.update({ where: { id }, data: { status: "REJECTED", reviewedById: ctx.user.id, reviewedAt: new Date(), reviewNote: note.trim() } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "food.rejected", entityType: "FoodInfo", entityId: id, after: { note } });
  if (v.submittedByCompanyId) await notify("food.decided", [{ companyId: v.submittedByCompanyId, link: `/vendor/products/food/${v.productId}` }], { product: pname(v.product.name), status: "rejected", note: note.trim() }).catch(() => null);
}

/** The customers who bought the product (within alertDays) are told what changed. */
async function tellBuyers(productId: string, changeId: string, diff: FoodDiff, s: FoodSettings) {
  const since = new Date(Date.now() - s.alertDays * 86_400_000);
  const lines = await prisma.orderLine.findMany({ where: { offer: { packaging: { variant: { productId } } }, order: { placedAt: { gte: since }, status: OPEN_ORDER } }, select: { order: { select: { buyerCompanyId: true } } } });
  const buyers = [...new Set(lines.map((l) => l.order.buyerCompanyId))];
  if (!buyers.length) return;
  const product = await prisma.product.findUniqueOrThrow({ where: { id: productId }, select: { name: true } });
  const added = [...diff.allergensAdded, ...diff.mayContainAdded];
  await notify("food.recipe_changed", buyers.map((companyId) => ({ companyId, link: "/buy/catalogue/allergens" })), { product: pname(product.name), allergens: added.join(", ").toLowerCase() }, { ref: { type: "FoodChange", id: changeId } }).catch(() => null);
  await prisma.foodChange.update({ where: { id: changeId }, data: { notifiedCompanies: buyers.length } });
}

/** FIRINGI / supplier: an undeclared allergen → start a Phase 25 recall of a lot (class I by default). */
export async function startAllergenRecall(ctx: Ctx, i: { offerId: string; lotCode: string; allergen: string; note?: string | null }) {
  const s = await foodSettings();
  if (!s.recallLink) throw new AppError("FOOD_OFF", "Allergen recalls are switched off.");
  if (!(ALLERGENS as readonly string[]).includes(i.allergen)) throw new ValidationError("Choose the allergen.");
  if (!i.lotCode?.trim()) throw new ValidationError("Give the lot to recall.");
  const { startRecall } = await import("@/server/warehouse/recalls");
  const reason = `Undeclared allergen: ${i.allergen.toLowerCase().replace(/_/g, " ")}${i.note?.trim() ? ` — ${i.note.trim()}` : ""}`;
  return startRecall(ctx, { offerId: i.offerId, lotCode: i.lotCode.trim(), recallClass: "CLASS_I", reason, instructions: "Do not sell or use. Keep the stock apart; FIRINGI will collect it or credit it." });
}

// ── the go-live gate ────────────────────────────────────────────────────────

/** Hide / show food products for buyers ("required to sell"). All products when ids is omitted. */
export async function recomputeGate(db: Tx | typeof prisma = prisma, ids?: string[]) {
  const s = await foodSettings(db);
  const cats = await categories(db);
  const rows = await db.product.findMany({ where: ids ? { id: { in: ids } } : {}, select: { id: true, categoryId: true, foodBlockedAt: true, foodBlockReason: true, foodInfo: { include: { certificates: true } } } });
  const now = new Date();
  let blocked = 0, released = 0;
  for (const p of rows) {
    const req = await requiredFor(p.categoryId, s, cats);
    let reason: string | null = null;
    if (s.requireToSell && req.food && req.fields.length) {
      const d = toData(p.foodInfo);
      if (!d) reason = "NO_FOOD_INFO";
      else if (missingFields(d, req.fields).length) reason = "INCOMPLETE";
    }
    if (reason && (!p.foodBlockedAt || p.foodBlockReason !== reason)) { await db.product.update({ where: { id: p.id }, data: { foodBlockedAt: p.foodBlockedAt ?? now, foodBlockReason: reason } }); blocked++; }
    else if (!reason && p.foodBlockedAt) { await db.product.update({ where: { id: p.id }, data: { foodBlockedAt: null, foodBlockReason: null } }); released++; }
  }
  return { blocked, released };
}

// ── FIRINGI: data quality ───────────────────────────────────────────────────

export async function qualityDashboard(ctx: Ctx) {
  if (!isStaff(ctx) || !can(ctx, ["admin.catalogue.view", "admin.catalogue.approve"])) throw new ForbiddenError();
  const s = await foodSettings();
  const cats = await categories();
  const products = await prisma.product.findMany({
    where: { status: "APPROVED" },
    select: { id: true, name: true, categoryId: true, foodBlockedAt: true, foodInfo: { include: { certificates: true } }, variants: { select: { packagings: { select: { offers: { where: { status: { in: ["ACTIVE", "PAUSED", "PENDING_APPROVAL"] } }, select: { vendorCompanyId: true, vendor: { select: { legalName: true, tradeName: true } } } } } } } } },
  });
  const pending = await prisma.foodInfo.groupBy({ by: ["productId"], where: { status: "PENDING" } });
  const pendingSet = new Set(pending.map((p) => p.productId));
  const perSupplier = new Map<string, { name: string; products: number; complete: number }>();
  const perCategory = new Map<string, { name: string; products: number; complete: number }>();
  const missingList: { productId: string; name: string; category: string; missing: Field[]; pending: boolean; blocked: boolean; suppliers: string }[] = [];
  let food = 0, complete = 0, wouldBlock = 0, blockedNow = 0;
  for (const p of products) {
    const req = await requiredFor(p.categoryId, s, cats);
    if (!req.food) continue;
    food++;
    const d = toData(p.foodInfo);
    const missing = d ? missingFields(d, req.fields) : req.fields;
    const ok = !!d && missing.length === 0;
    if (ok) complete++; else wouldBlock++;
    if (p.foodBlockedAt) blockedNow++;
    const root = chain(cats, p.categoryId).at(-1);
    const ck = root?.id ?? p.categoryId;
    const c = perCategory.get(ck) ?? { name: pname(root?.name ?? ""), products: 0, complete: 0 };
    c.products++; if (ok) c.complete++; perCategory.set(ck, c);
    const sellers = new Map<string, string>();
    for (const v of p.variants) for (const pk of v.packagings) for (const o of pk.offers) sellers.set(o.vendorCompanyId, cname(o.vendor));
    for (const [sid, sname] of sellers) { const x = perSupplier.get(sid) ?? { name: sname, products: 0, complete: 0 }; x.products++; if (ok) x.complete++; perSupplier.set(sid, x); }
    if (!ok) missingList.push({ productId: p.id, name: pname(p.name), category: pname(cats.get(p.categoryId)?.name ?? ""), missing, pending: pendingSet.has(p.id), blocked: !!p.foodBlockedAt, suppliers: [...sellers.values()].join(", ") });
  }
  const soon = new Date(Date.now() + 60 * 86_400_000);
  const certs = await prisma.foodCertificate.findMany({ where: { expiresOn: { lte: soon }, foodInfo: { status: "APPROVED" } }, include: { foodInfo: { select: { productId: true, product: { select: { name: true } }, submittedBy: { select: { legalName: true, tradeName: true } } } } }, orderBy: { expiresOn: "asc" }, take: 50 });
  const changes = await prisma.foodChange.findMany({ orderBy: { createdAt: "desc" }, take: 20, include: { product: { select: { name: true } } } });
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 100);
  return {
    settings: s,
    tiles: { food, complete, completePct: pct(complete, food), missing: food - complete, pending: pendingSet.size, blockedNow, wouldBlock: s.requireToSell ? blockedNow : wouldBlock, expiringCerts: certs.length },
    suppliers: [...perSupplier.entries()].map(([id, x]) => ({ id, ...x, pct: pct(x.complete, x.products) })).sort((a, b) => a.pct - b.pct || b.products - a.products),
    categories: [...perCategory.entries()].map(([id, x]) => ({ id, ...x, pct: pct(x.complete, x.products) })).sort((a, b) => a.pct - b.pct),
    missing: missingList.sort((a, b) => b.missing.length - a.missing.length || a.name.localeCompare(b.name)).slice(0, 200),
    certificates: certs.map((c) => ({ id: c.id, productId: c.foodInfo.productId, product: pname(c.foodInfo.product.name), supplier: cname(c.foodInfo.submittedBy), diet: c.diet, number: c.number, expiresOn: c.expiresOn, expired: !!c.expiresOn && c.expiresOn < new Date() })),
    changes: changes.map((c) => ({ id: c.id, productId: c.productId, product: pname(c.product.name), at: c.createdAt, summary: c.summary as unknown as FoodDiff, notified: c.notifiedCompanies, allergenAdded: c.allergenAdded })),
  };
}

// ── buyers ──────────────────────────────────────────────────────────────────

const buyerOk = (ctx: Ctx) => ctx.company.type === "CUSTOMER" || ctx.company.type === "WHOLESALER";

export async function myProfile(ctx: Ctx) {
  if (!buyerOk(ctx)) return null;
  const s = await foodSettings();
  if (!s.enabled || !s.profile) return null;
  const p = await prisma.foodProfile.findUnique({ where: { companyId: ctx.company.id } });
  return { avoid: p?.avoid ?? [], includeTraces: p?.includeTraces ?? true, hideInCatalogue: p?.hideInCatalogue ?? false };
}

export async function saveProfile(ctx: Ctx, i: { avoid: string[]; includeTraces: boolean; hideInCatalogue: boolean }) {
  if (!buyerOk(ctx) || !can(ctx, ["company.profile.manage", "buyer.orders.place"])) throw new ForbiddenError();
  const s = await foodSettings();
  if (!s.enabled || !s.profile) throw new AppError("FOOD_OFF", "The allergen profile is switched off.");
  const avoid = [...new Set(i.avoid)].filter((a) => (ALLERGENS as readonly string[]).includes(a));
  await prisma.foodProfile.upsert({ where: { companyId: ctx.company.id }, update: { avoid, includeTraces: !!i.includeTraces, hideInCatalogue: !!i.hideInCatalogue, updatedById: ctx.user.id }, create: { companyId: ctx.company.id, avoid, includeTraces: !!i.includeTraces, hideInCatalogue: !!i.hideInCatalogue, updatedById: ctx.user.id } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "food.profile_saved", entityType: "FoodProfile", entityId: ctx.company.id, after: { avoid, includeTraces: i.includeTraces, hideInCatalogue: i.hideInCatalogue } });
}

/** Catalogue filter: "free from" allergens (no contains, no may-contain), a diet, and the profile's hide option. */
export async function buyerFoodWhere(ctx: Ctx, f: { free?: string[]; diet?: string | null }): Promise<Prisma.VendorOfferWhereInput> {
  const s = await foodSettings();
  if (!s.enabled) return {};
  const free = (f.free ?? []).filter((a) => (ALLERGENS as readonly string[]).includes(a));
  const diet = f.diet && (DIETS as readonly string[]).includes(f.diet) ? f.diet : null;
  const and: Prisma.ProductWhereInput[] = [];
  if (s.filter && free.length) and.push({ foodInfoId: { not: null }, NOT: [{ allergensContain: { hasSome: free } }, { allergensMayContain: { hasSome: free } }] });
  if (s.filter && diet) and.push({ diets: { has: diet } });
  const prof = await myProfile(ctx);
  if (prof?.hideInCatalogue && prof.avoid.length) and.push({ NOT: prof.includeTraces ? [{ allergensContain: { hasSome: prof.avoid } }, { allergensMayContain: { hasSome: prof.avoid } }] : [{ allergensContain: { hasSome: prof.avoid } }] });
  return and.length ? { packaging: { variant: { product: { AND: and } } } } : {};
}

export type FoodBadge = { contain: string[]; mayContain: string[]; diets: string[]; hits: string[]; approved: boolean };

/** Badges for product cards / cart lines (only when switched on). */
export async function foodBadges(ctx: Ctx, productIds: string[]): Promise<Map<string, FoodBadge>> {
  const s = await foodSettings();
  const out = new Map<string, FoodBadge>();
  if (!s.enabled || (!s.badges && !s.profile) || !productIds.length) return out;
  const [rows, prof] = await Promise.all([
    prisma.product.findMany({ where: { id: { in: [...new Set(productIds)] } }, select: { id: true, foodInfoId: true, allergensContain: true, allergensMayContain: true, diets: true } }),
    myProfile(ctx),
  ]);
  for (const r of rows) {
    out.set(r.id, {
      contain: s.badges && s.parts.allergens ? r.allergensContain : [], mayContain: s.badges && s.parts.allergens ? r.allergensMayContain : [], diets: s.badges && s.parts.diets ? r.diets : [],
      hits: prof ? profileHits(r, prof.avoid, prof.includeTraces) : [], approved: !!r.foodInfoId,
    });
  }
  return out;
}

/** Full food information of a product for buyers (product page) and for the public page. */
export async function productFood(productId: string, locale: string, opts: { avoid?: string[]; includeTraces?: boolean } = {}) {
  const s = await foodSettings();
  if (!s.enabled) return null;
  const p = await prisma.product.findUnique({ where: { id: productId }, select: { id: true, name: true, brand: { select: { name: true } }, images: true, foodInfo: { include: { certificates: true } }, foodChanges: { where: { createdAt: { gte: new Date(Date.now() - 90 * 86_400_000) } }, orderBy: { createdAt: "desc" }, take: 1 } } });
  if (!p || !p.foodInfo) return p ? { approved: false as const, name: pname(p.name, locale) } : null;
  const d = toData(p.foodInfo)!;
  const ing = s.parts.ingredients ? pickLang(d.ingredients, locale) : null;
  const sto = pickLang(d.storage, locale);
  const lists = allergenLists(d.allergens);
  return {
    approved: true as const,
    productId: p.id, name: pname(p.name, locale), brand: p.brand?.name ?? null, version: p.foodInfo.version, approvedAt: p.foodInfo.reviewedAt,
    parts: s.parts,
    allergens: s.parts.allergens ? ALLERGENS.map((a) => ({ code: a, level: d.allergens[a] ?? null, detail: d.allergenDetail?.[a] ?? null })) : [],
    contain: s.parts.allergens ? lists.contain : [], mayContain: s.parts.allergens ? lists.mayContain : [],
    ingredients: ing ? { lang: ing.lang, segments: ingredientSegments(ing.text) } : null,
    nutrition: s.parts.nutrition ? d.nutrition : null,
    diets: s.parts.diets ? d.diets : [],
    certificates: s.parts.diets ? (p.foodInfo.certificates ?? []).filter((c) => !c.expiresOn || c.expiresOn >= new Date()).map((c) => ({ diet: c.diet, number: c.number, issuer: c.issuer, expiresOn: c.expiresOn })) : [],
    origin: s.parts.origin ? d.originCountryCode : null,
    storage: sto ? sto.text : null, shelfLifeDays: d.shelfLifeDays, afterOpeningDays: d.afterOpeningDays,
    hits: opts.avoid ? profileHits({ allergensContain: lists.contain, allergensMayContain: lists.mayContain }, opts.avoid, opts.includeTraces ?? true) : [],
    changedAt: p.foodChanges[0]?.createdAt ?? null,
  };
}

/** For a logged-in buyer: the product's food information with its profile hits. */
export async function buyerProductFood(ctx: Ctx, productId: string, locale: string) {
  const prof = await myProfile(ctx);
  return productFood(productId, locale, prof ? { avoid: prof.avoid, includeTraces: prof.includeTraces } : {});
}

/** The public page (reseller's shoppers, via shelf QR): only approved information, no prices / suppliers. */
export async function publicFood(productId: string, locale: string) {
  const s = await foodSettings();
  if (!s.enabled || !s.publicPage) return null;
  const f = await productFood(productId, locale);
  return f && f.approved ? f : null;
}

/** Products the buyer has bought (within alertDays), with their current food information. */
export async function myFoodProducts(ctx: Ctx, locale: string) {
  if (!buyerOk(ctx)) throw new ForbiddenError();
  const s = await foodSettings();
  const since = new Date(Date.now() - s.alertDays * 86_400_000);
  const lines = await prisma.orderLine.findMany({
    where: { order: { buyerCompanyId: ctx.company.id, placedAt: { gte: since }, status: OPEN_ORDER } },
    select: { offer: { select: { packaging: { select: { variant: { select: { sku: true, gtin: true, product: { select: { id: true, name: true, categoryId: true, foodInfo: { include: { certificates: true } } } } } } } } } } },
  });
  const seen = new Map<string, (typeof lines)[number]["offer"]["packaging"]["variant"]>();
  for (const l of lines) { const v = l.offer.packaging.variant; if (!seen.has(v.product.id)) seen.set(v.product.id, v); }
  const cats = await categories();
  const out = [];
  for (const v of seen.values()) {
    const req = await requiredFor(v.product.categoryId, s, cats);
    if (!req.food) continue;
    const d = toData(v.product.foodInfo);
    out.push({ productId: v.product.id, name: pname(v.product.name, locale), sku: v.sku, gtin: v.gtin, data: d, approved: !!d });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function myRecipeChanges(ctx: Ctx, locale: string) {
  if (!buyerOk(ctx)) throw new ForbiddenError();
  const s = await foodSettings();
  if (!s.enabled || !s.changeAlerts) return [];
  const ids = (await myFoodProducts(ctx, locale)).map((p) => p.productId);
  const rows = await prisma.foodChange.findMany({ where: { productId: { in: ids }, createdAt: { gte: new Date(Date.now() - s.alertDays * 86_400_000) } }, orderBy: { createdAt: "desc" }, take: 100, include: { product: { select: { name: true } } } });
  const prof = await myProfile(ctx);
  return rows.map((r) => {
    const d = r.summary as unknown as FoodDiff;
    const urgent = !!prof && [...d.allergensAdded, ...(prof.includeTraces ? d.mayContainAdded : [])].some((a) => prof.avoid.includes(a));
    return { id: r.id, productId: r.productId, name: pname(r.product.name, locale), at: r.createdAt, diff: d, allergenAdded: r.allergenAdded, urgent };
  });
}

/** CSV export of the food data of the products the buyer buys (its webshop / till). */
export async function exportCsv(ctx: Ctx, locale: string) {
  const s = await foodSettings();
  if (!s.enabled || !s.export) throw new AppError("FOOD_OFF", "The food data export is switched off.");
  const rows = await myFoodProducts(ctx, locale);
  const esc = (v: unknown) => { const t = v == null ? "" : String(v); return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const head = ["sku", "gtin", "name", ...ALLERGENS.map((a) => `allergen_${a.toLowerCase()}`), "ingredients", "basis", ...NUTRIENTS, "diets", "origin", "storage", "shelf_life_days", "after_opening_days", "public_page"];
  const base = (process.env.APP_URL ?? process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const lines = [head.join(";")];
  for (const r of rows) {
    const d = r.data;
    const ing = d ? pickLang(d.ingredients, locale)?.text.replace(/\*/g, "") : "";
    lines.push([
      r.sku, r.gtin, r.name, ...ALLERGENS.map((a) => (d?.allergens[a] ?? "").toLowerCase()), ing, d?.nutrition?.basis ?? "", ...NUTRIENTS.map((n) => d?.nutrition?.[n] ?? ""),
      (d?.diets ?? []).join(","), d?.originCountryCode ?? "", d ? pickLang(d.storage, locale)?.text ?? "" : "", d?.shelfLifeDays ?? "", d?.afterOpeningDays ?? "", s.publicPage && d ? `${base}/food/${r.productId}` : "",
    ].map(esc).join(";"));
  }
  return "﻿" + lines.join("\r\n");
}

/** A stored food file (label / spec / certificate) — staff, suppliers selling the product, or buyers for an approved label. */
export async function foodFile(ctx: Ctx, foodInfoId: string, kind: "label" | "spec" | "cert", certId?: string) {
  const f = await prisma.foodInfo.findUnique({ where: { id: foodInfoId }, include: { certificates: true } });
  if (!f) throw new NotFoundError("File");
  let allowed = isStaff(ctx) && can(ctx, ["admin.catalogue.view", "admin.catalogue.approve"]);
  if (!allowed && isVendor(ctx)) allowed = f.submittedByCompanyId === ctx.company.id || (await prisma.vendorOffer.count({ where: { vendorCompanyId: ctx.company.id, packaging: { variant: { productId: f.productId } } } })) > 0;
  if (!allowed && buyerOk(ctx)) allowed = f.status === "APPROVED" && kind !== "spec";
  if (!allowed) throw new NotFoundError("File");
  if (kind === "cert") {
    const c = f.certificates.find((x) => x.id === certId);
    if (!c?.fileKey) throw new NotFoundError("File");
    return { buf: await readStored(c.fileKey), name: c.fileName ?? "certificate", mime: c.mimeType ?? "application/octet-stream" };
  }
  const key = kind === "label" ? f.labelKey : f.specKey;
  if (!key) throw new NotFoundError("File");
  return { buf: await readStored(key), name: (kind === "label" ? f.labelName : f.specName) ?? kind, mime: (kind === "label" ? f.labelMime : f.specMime) ?? "application/octet-stream" };
}

// ── daily job ───────────────────────────────────────────────────────────────

/** Certificate expiry reminders to the supplier, and the gate re-checked. */
export async function runFoodJob(now = new Date()) {
  const s = await foodSettings();
  if (!s.enabled) return { reminded: 0, gate: { blocked: 0, released: 0 } };
  const max = Math.max(...s.certReminderDays);
  const certs = await prisma.foodCertificate.findMany({
    where: { expiresOn: { gte: new Date(now.toISOString().slice(0, 10)), lte: new Date(now.getTime() + max * 86_400_000) }, foodInfo: { status: "APPROVED" } },
    include: { foodInfo: { select: { productId: true, submittedByCompanyId: true, product: { select: { name: true } } } } },
  });
  let reminded = 0;
  for (const c of certs) {
    const left = Math.ceil((c.expiresOn!.getTime() - new Date(now.toISOString().slice(0, 10)).getTime()) / 86_400_000);
    const due = s.certReminderDays.filter((d) => left <= d && !c.remindedDays.includes(d));
    if (!due.length || !c.foodInfo.submittedByCompanyId) continue;
    await notify("food.cert_expiring", [{ companyId: c.foodInfo.submittedByCompanyId, link: `/vendor/products/food/${c.foodInfo.productId}` }], { product: pname(c.foodInfo.product.name), claim: c.diet.toLowerCase().replace(/_/g, " "), date: c.expiresOn!.toISOString().slice(0, 10), days: left }).catch(() => null);
    await prisma.foodCertificate.update({ where: { id: c.id }, data: { remindedDays: [...c.remindedDays, ...due] } });
    reminded++;
  }
  const gate = await recomputeGate(prisma);
  return { reminded, gate };
}

export { CERTIFIED_DIETS };

/** The cart: lines whose product hits the kitchen's avoid list (a warning — buying it stays possible). */
export async function cartFoodWarnings(ctx: Ctx, lines: { offerId: string; name: string }[]) {
  const prof = await myProfile(ctx);
  if (!prof || !prof.avoid.length || !lines.length) return [];
  const offers = await prisma.vendorOffer.findMany({ where: { id: { in: lines.map((l) => l.offerId) } }, select: { id: true, packaging: { select: { variant: { select: { product: { select: { allergensContain: true, allergensMayContain: true } } } } } } } });
  const by = new Map(offers.map((o) => [o.id, o.packaging.variant.product]));
  return lines.map((l) => ({ ...l, hits: by.get(l.offerId) ? profileHits(by.get(l.offerId)!, prof.avoid, prof.includeTraces) : [] })).filter((l) => l.hits.length);
}
