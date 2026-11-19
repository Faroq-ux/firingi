import "server-only";
/**
 * Licensed & excise goods (Phase 43). Rules in src/lib/excise.ts; docs in docs/excise.md.
 *
 * FIRINGI keeps excise categories (beer, wine, spirits, cigarettes, rolling tobacco, e-liquids, sugary drinks),
 * rates per buyer country and licence types; shop categories carry a default category, suppliers give the
 * measures per product (alcohol %, litres, sticks, kg, sugar) and the duty mode: PAID (already in the price,
 * shown on the invoice) or ADDED (FIRINGI calculates it, its own line, passed on to the supplier).
 * Customers upload licences FIRINGI approves; without one, licensed goods are blocked (or only warned). Country
 * restrictions, quantity caps, the driver's licence/ID check, excise documents, the monthly excise report,
 * the licence register and the accounting export lines — each a FIRINGI switch.
 */
import Decimal from "decimal.js";
import type { DutyMode, ExciseBasis, ExciseKind, Prisma, ReviewStatus } from "@prisma/client";
import { prisma, type Tx } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";
import { notify } from "@/server/notify/dispatch";
import { readStored, storeUpload } from "@/server/services/storage";
import { pickLocalized } from "@/i18n/config";
import {
  daysLeft, dutyPerUnit, LICENSED_KINDS, licenceRule, licenceValid, measure, mergeExciseSettings, missingFor, monthRange, parseBands, rateOn,
  type ExciseSettings, type Measures,
} from "@/lib/excise";

const KEY = "excise.settings";
const isStaff = (ctx: Ctx) => ctx.company.type === "ADMIN";
const D = (v: { toString(): string } | number | null | undefined) => new Decimal(v == null ? 0 : v.toString());
const num = (v: { toString(): string } | null | undefined) => (v == null ? null : Number(v.toString()));
const r2 = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const cname = (c: { legalName: string; tradeName: string | null } | null | undefined) => (c ? c.tradeName ?? c.legalName : "");
const day = (s: string | null | undefined) => {
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new ValidationError("Use a date like 2026-12-31.");
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new ValidationError("That date doesn't exist.");
  return d;
};
const today = () => new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
async function firingiId() { return (await prisma.company.findFirstOrThrow({ where: { type: "ADMIN" }, select: { id: true } })).id; }

// ── settings ────────────────────────────────────────────────────────────────

export async function exciseSettings(db: Tx | typeof prisma = prisma): Promise<ExciseSettings> {
  const row = await db.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: KEY } });
  return mergeExciseSettings(row?.value);
}

export async function saveExciseSettings(ctx: Ctx, input: ExciseSettings) {
  if (!isStaff(ctx) || !can(ctx, "admin.settings.manage")) throw new ForbiddenError();
  const v = mergeExciseSettings(input);
  const before = await exciseSettings();
  const row = await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: KEY } });
  if (row) await prisma.setting.update({ where: { id: row.id }, data: { value: v as unknown as Prisma.InputJsonValue } });
  else await prisma.setting.create({ data: { scope: "GLOBAL", scopeId: "", key: KEY, value: v as unknown as Prisma.InputJsonValue } });
  // Suppliers' excise authorisation = the Phase 28 certificate; "required" pauses their licensed offers without it
  if (before.licences.supplier !== v.licences.supplier || before.enabled !== v.enabled) {
    await prisma.certificateType.updateMany({ where: { key: "excise-authorisation" }, data: { required: v.enabled && v.licences.supplier } });
    await (await import("@/server/compliance/service")).recomputeAll().catch(() => null);
  }
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "excise.settings_saved", entityType: "Setting", entityId: KEY, before, after: v });
  return v;
}

// ── FIRINGI: categories, rates, licence types ───────────────────────────────

function requireCatalogue(ctx: Ctx) {
  if (!isStaff(ctx) || !can(ctx, ["admin.catalogue.manage", "admin.settings.manage"])) throw new ForbiddenError();
}

export async function listCategories(locale = "en") {
  const rows = await prisma.exciseCategory.findMany({ orderBy: { sortOrder: "asc" }, include: { rates: { orderBy: [{ countryCode: "asc" }, { validFrom: "desc" }] }, _count: { select: { categories: true, offers: true } } } });
  return rows.map((c) => ({
    id: c.id, code: c.code, name: pickLocalized(c.name as Record<string, string>, locale), names: c.name as Record<string, string>, kind: c.kind, basis: c.basis,
    maxPerOrder: c.maxPerOrder, blockedCountries: c.blockedCountries, active: c.active, shopCategories: c._count.categories, offers: c._count.offers,
    rates: c.rates.map((r) => ({ id: r.id, countryCode: r.countryCode, rate: Number(r.rate), adValoremPct: num(r.adValoremPct), bands: parseBands(r.bands), validFrom: r.validFrom, validTo: r.validTo, note: r.note, current: !r.validTo || r.validTo >= today() })),
  }));
}

export async function saveCategory(ctx: Ctx, id: string, i: { maxPerOrder?: number | null; blockedCountries?: string[]; active?: boolean; nameEn?: string; namePt?: string }) {
  requireCatalogue(ctx);
  const c = await prisma.exciseCategory.findUnique({ where: { id } });
  if (!c) throw new NotFoundError("Excise category");
  const max = i.maxPerOrder == null ? null : Math.round(Number(i.maxPerOrder));
  if (max != null && (!Number.isFinite(max) || max < 1 || max > 100_000)) throw new ValidationError("The cap must be between 1 and 100000 units.");
  const blocked = [...new Set((i.blockedCountries ?? c.blockedCountries).map((x) => x.trim().toUpperCase()).filter((x) => /^[A-Z]{2}$/.test(x)))];
  const names = { ...(c.name as Record<string, string>), ...(i.nameEn?.trim() ? { en: i.nameEn.trim().slice(0, 80) } : {}), ...(i.namePt?.trim() ? { pt: i.namePt.trim().slice(0, 80) } : {}) };
  const row = await prisma.exciseCategory.update({ where: { id }, data: { maxPerOrder: max, blockedCountries: blocked, active: i.active ?? c.active, name: names } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "excise.category_saved", entityType: "ExciseCategory", entityId: id, before: c, after: row });
  return row;
}

export type RateInput = { categoryId: string; countryCode: string; rate: number; adValoremPct?: number | null; bands?: { maxGPerL: number | null; perHl: number }[] | null; validFrom: string; note?: string | null };

/** A new rate for a country: the current one ends the day before (history kept for old orders and reports). */
export async function addRate(ctx: Ctx, i: RateInput) {
  requireCatalogue(ctx);
  const c = await prisma.exciseCategory.findUnique({ where: { id: i.categoryId } });
  if (!c) throw new NotFoundError("Excise category");
  const country = i.countryCode.trim().toUpperCase();
  if (!(await prisma.country.count({ where: { code: country } }))) throw new ValidationError("Choose a country.");
  const from = day(i.validFrom)!;
  const rate = Number(i.rate);
  if (!Number.isFinite(rate) || rate < 0 || rate > 1_000_000) throw new ValidationError("Enter the rate (0 or more).");
  const adv = i.adValoremPct == null || (i.adValoremPct as unknown) === "" ? null : Number(i.adValoremPct);
  if (adv != null && (!Number.isFinite(adv) || adv < 0 || adv > 100)) throw new ValidationError("The % of the price must be between 0 and 100.");
  if (adv != null && c.basis !== "THOUSAND_UNITS" && c.basis !== "KG") throw new ValidationError("A % of the price only applies to tobacco.");
  const bands = c.basis === "HL_SUGAR_BAND" ? parseBands(i.bands ?? []) : [];
  if (c.basis === "HL_SUGAR_BAND" && (!bands.length || bands[bands.length - 1].maxGPerL != null)) throw new ValidationError("Sugar bands need at least one band and a last band without a maximum.");
  const row = await prisma.$transaction(async (tx) => {
    const prev = await tx.exciseRate.findMany({ where: { categoryId: c.id, countryCode: country, OR: [{ validTo: null }, { validTo: { gte: from } }] } });
    for (const p of prev) {
      if (p.validFrom >= from) throw new ValidationError("A rate already starts on or after that date — choose a later date.");
      await tx.exciseRate.update({ where: { id: p.id }, data: { validTo: new Date(from.getTime() - 86_400_000) } });
    }
    return tx.exciseRate.create({ data: { categoryId: c.id, countryCode: country, rate: rate.toString(), adValoremPct: adv?.toString() ?? null, bands: bands.length ? (bands as unknown as Prisma.InputJsonValue) : undefined, validFrom: from, note: i.note?.trim().slice(0, 200) || null } });
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "excise.rate_added", entityType: "ExciseRate", entityId: row.id, after: { category: c.code, country, rate, adv, bands, validFrom: i.validFrom } });
  return row;
}

/** Shop category → excise category (null = none; children inherit). */
export async function setShopCategoryExcise(ctx: Ctx, categoryId: string, exciseCategoryId: string | null) {
  requireCatalogue(ctx);
  const cat = await prisma.category.findUnique({ where: { id: categoryId } });
  if (!cat) throw new NotFoundError("Category");
  if (exciseCategoryId && !(await prisma.exciseCategory.count({ where: { id: exciseCategoryId } }))) throw new NotFoundError("Excise category");
  await prisma.category.update({ where: { id: categoryId }, data: { exciseCategoryId } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "excise.shop_category_set", entityType: "Category", entityId: categoryId, before: { exciseCategoryId: cat.exciseCategoryId }, after: { exciseCategoryId } });
}

export async function shopCategories(locale = "en") {
  const rows = await prisma.category.findMany({ where: { isActive: true }, select: { id: true, name: true, depth: true, path: true, parentId: true, exciseCategoryId: true }, orderBy: { path: "asc" } });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return rows.map((r) => {
    let inherited: string | null = null;
    for (let p = r.parentId ? byId.get(r.parentId) : undefined; p; p = p.parentId ? byId.get(p.parentId) : undefined) if (p.exciseCategoryId) { inherited = p.exciseCategoryId; break; }
    return { id: r.id, name: pickLocalized(r.name as Record<string, string>, locale), depth: r.depth, exciseCategoryId: r.exciseCategoryId, inherited };
  });
}

export async function listLicenceTypes(locale = "en") {
  const rows = await prisma.licenceType.findMany({ orderBy: { sortOrder: "asc" }, include: { _count: { select: { licences: true } } } });
  return rows.map((t) => ({ id: t.id, code: t.code, name: pickLocalized(t.name as Record<string, string>, locale), names: t.name as Record<string, string>, kinds: t.kinds, countries: t.countries, needsNumber: t.needsNumber, hasExpiry: t.hasExpiry, active: t.active, licences: t._count.licences }));
}

export async function saveLicenceType(ctx: Ctx, i: { id?: string | null; code: string; nameEn: string; namePt?: string | null; kinds: ExciseKind[]; countries: string[]; needsNumber: boolean; hasExpiry: boolean; active: boolean }) {
  requireCatalogue(ctx);
  const code = i.code.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_").slice(0, 30);
  if (!code || !i.nameEn.trim()) throw new ValidationError("Give the licence type a code and a name.");
  const kinds = [...new Set(i.kinds)].filter((k) => LICENSED_KINDS.includes(k));
  if (!kinds.length) throw new ValidationError("Choose what the licence covers (alcohol, tobacco, vaping).");
  const countries = [...new Set(i.countries.map((x) => x.trim().toUpperCase()).filter((x) => /^[A-Z]{2}$/.test(x)))];
  const name = { en: i.nameEn.trim().slice(0, 100), ...(i.namePt?.trim() ? { pt: i.namePt.trim().slice(0, 100) } : {}) };
  const data = { code, name, kinds, countries, needsNumber: !!i.needsNumber, hasExpiry: !!i.hasExpiry, active: !!i.active };
  const clash = await prisma.licenceType.findUnique({ where: { code } });
  if (clash && clash.id !== i.id) throw new ValidationError("That code is already used.");
  const row = i.id ? await prisma.licenceType.update({ where: { id: i.id }, data }) : await prisma.licenceType.create({ data: { id: `lt_${code.toLowerCase()}`, ...data } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "excise.licence_type_saved", entityType: "LicenceType", entityId: row.id, after: data });
  return row;
}

// ── which category a product falls in ───────────────────────────────────────

const OFFER_SELECT = {
  id: true, vendorCompanyId: true, exciseCategoryId: true, abv: true, volumeL: true, exciseUnits: true, netKg: true, sugarGPerL: true, dutyMode: true, exciseCountries: true,
  packaging: { select: { variant: { select: { product: { select: { category: { select: { exciseCategoryId: true, parent: { select: { exciseCategoryId: true, parent: { select: { exciseCategoryId: true } } } } } } } } } } } },
} as const;
type OfferRow = Prisma.VendorOfferGetPayload<{ select: typeof OFFER_SELECT }>;
const fromCategory = (o: OfferRow) => { const c = o.packaging.variant.product.category; return c?.exciseCategoryId ?? c?.parent?.exciseCategoryId ?? c?.parent?.parent?.exciseCategoryId ?? null; };
const measuresOf = (o: Pick<OfferRow, "abv" | "volumeL" | "exciseUnits" | "netKg" | "sugarGPerL">): Measures => ({ abv: num(o.abv), volumeL: num(o.volumeL), exciseUnits: o.exciseUnits, netKg: num(o.netKg), sugarGPerL: num(o.sugarGPerL) });

type Cat = { id: string; code: string; name: unknown; kind: ExciseKind; basis: ExciseBasis; maxPerOrder: number | null; blockedCountries: string[]; active: boolean };

/** Effective excise category per offer (supplier's choice, else the nearest shop category's), only active kinds. */
async function offersExcise(offerIds: string[], s: ExciseSettings, db: Tx | typeof prisma = prisma) {
  const out = new Map<string, { offer: OfferRow; cat: Cat }>();
  if (!s.enabled || !offerIds.length) return out;
  const offers = await db.vendorOffer.findMany({ where: { id: { in: offerIds } }, select: OFFER_SELECT });
  const ids = [...new Set(offers.map((o) => o.exciseCategoryId ?? fromCategory(o)).filter((x): x is string => !!x))];
  const cats = await db.exciseCategory.findMany({ where: { id: { in: ids }, active: true } });
  for (const o of offers) {
    const cat = cats.find((c) => c.id === (o.exciseCategoryId ?? fromCategory(o)));
    if (cat && s.kinds[cat.kind]) out.set(o.id, { offer: o, cat });
  }
  return out;
}

async function ratesFor(categoryIds: string[], country: string, db: Tx | typeof prisma = prisma) {
  const rows = await db.exciseRate.findMany({ where: { categoryId: { in: categoryIds }, countryCode: country } });
  const at = new Date();
  return new Map(categoryIds.map((id) => [id, rateOn(rows.filter((r) => r.categoryId === id), at)]));
}

/** Duty per unit for an offer sold to a country at a price (null = no rate or a measure missing). */
function unitDuty(cat: Cat, rate: Awaited<ReturnType<typeof ratesFor>> extends Map<string, infer R> ? R : never, offer: OfferRow, unitPriceNet: Decimal.Value) {
  if (!rate) return null;
  return dutyPerUnit(cat.basis, { rate: rate.rate, adValoremPct: rate.adValoremPct, bands: rate.bands }, measuresOf(offer), unitPriceNet);
}

// ── licences of a buyer ─────────────────────────────────────────────────────

/**
 * Licensed kinds a company may buy now: approved, valid licences for its country — and the catalogue access
 * FIRINGI approved before Phase 43 (alcohol → alcohol; tobacco → tobacco and vaping).
 */
export async function coveredKinds(companyId: string, countryCode: string, db: Tx | typeof prisma = prisma, at = new Date()) {
  const ls = await db.customerLicence.findMany({ where: { companyId, status: "APPROVED", supersededAt: null }, include: { type: true } });
  const kinds = new Set<ExciseKind>();
  for (const l of ls) if (l.type.active && licenceValid(l, at) && (!l.type.countries.length || l.type.countries.includes(countryCode)) && (l.countryCode === countryCode || !l.countryCode)) for (const k of l.type.kinds) kinds.add(k);
  const old = await db.restrictionApproval.findMany({ where: { companyId, status: "APPROVED", OR: [{ validUntil: null }, { validUntil: { gt: at } }] }, select: { restriction: true } });
  for (const o of old) { if (o.restriction === "ALCOHOL") kinds.add("ALCOHOL"); else { kinds.add("TOBACCO"); kinds.add("VAPING"); } }
  return kinds;
}

/** Catalogue access (Phase 3 restrictions) that comes from Phase 43: licences, or no licence asked / only a warning. */
export async function licenceAccess(companyId: string, at = new Date()): Promise<("ALCOHOL" | "TOBACCO")[]> {
  const s = await exciseSettings();
  if (!s.enabled) return [];
  const country = await countryOf(companyId);
  const rule = licenceRule(s, country);
  if (!rule.needed || rule.enforcement === "WARN") return ["ALCOHOL", "TOBACCO"];
  const ls = await prisma.customerLicence.findMany({ where: { companyId, status: "APPROVED", supersededAt: null }, include: { type: true } });
  const out = new Set<"ALCOHOL" | "TOBACCO">();
  for (const l of ls) if (l.type.active && licenceValid(l, at) && (!l.type.countries.length || l.type.countries.includes(country))) for (const k of l.type.kinds) out.add(k === "ALCOHOL" ? "ALCOHOL" : "TOBACCO");
  return [...out];
}

async function countryOf(companyId: string, db: Tx | typeof prisma = prisma) {
  return (await db.company.findUniqueOrThrow({ where: { id: companyId }, select: { country: { select: { code: true } } } })).country.code;
}

export type Issue = { offerId: string; code: "LICENCE" | "COUNTRY" | "QTY_CAP"; kind: ExciseKind; category: string; max?: number; block: boolean };

/**
 * What stops (or warns about) these items for a buyer: no licence for the kind, the product can't go to the buyer's
 * country, more than the cap per order. `block` = refused (BLOCK enforcement, country, cap).
 */
export async function checkItems(companyId: string, items: { offerId: string; qty: number }[], db: Tx | typeof prisma = prisma, locale = "en"): Promise<Issue[]> {
  const s = await exciseSettings(db);
  if (!s.enabled || !items.length) return [];
  const ex = await offersExcise([...new Set(items.map((i) => i.offerId))], s, db);
  if (!ex.size) return [];
  const country = await countryOf(companyId, db);
  const rule = licenceRule(s, country);
  const covered = rule.needed ? await coveredKinds(companyId, country, db) : new Set<ExciseKind>();
  const issues: Issue[] = [];
  const qty = new Map<string, number>();
  for (const i of items) qty.set(i.offerId, (qty.get(i.offerId) ?? 0) + i.qty);
  for (const [offerId, q] of qty) {
    const e = ex.get(offerId);
    if (!e) continue;
    const category = pickLocalized(e.cat.name as Record<string, string>, locale);
    if (rule.needed && LICENSED_KINDS.includes(e.cat.kind) && !covered.has(e.cat.kind)) issues.push({ offerId, code: "LICENCE", kind: e.cat.kind, category, block: rule.enforcement === "BLOCK" });
    if (s.restrictions.countries && (e.cat.blockedCountries.includes(country) || (e.offer.exciseCountries.length && !e.offer.exciseCountries.includes(country)))) issues.push({ offerId, code: "COUNTRY", kind: e.cat.kind, category, block: true });
    if (s.restrictions.qtyCaps && e.cat.maxPerOrder && q > e.cat.maxPerOrder) issues.push({ offerId, code: "QTY_CAP", kind: e.cat.kind, category, max: e.cat.maxPerOrder, block: true });
  }
  return issues;
}

const MESSAGES: Record<Issue["code"], (i: Issue) => string> = {
  LICENCE: (i) => `You need an approved licence to buy ${i.category.toLowerCase()} — add it under Company › Licences.`,
  COUNTRY: (i) => `This ${i.category.toLowerCase()} product can't be sold to your country.`,
  QTY_CAP: (i) => `At most ${i.max} units of ${i.category.toLowerCase()} per order.`,
};

/** Throws on the first blocking issue (cart and checkout). */
export async function assertItems(companyId: string, items: { offerId: string; qty: number }[], db: Tx | typeof prisma = prisma) {
  // Phase 47e: special goods only for businesses that sell them and have a matching activity code
  await (await import("@/server/special/service")).assertSpecialItems(companyId, [...new Set(items.map((i) => i.offerId))], db);
  const block = (await checkItems(companyId, items, db)).find((i) => i.block);
  if (block) throw new AppError(`EXCISE_${block.code}`, MESSAGES[block.code](block), 422, { offerId: block.offerId, kind: block.kind });
}

// ── catalogue badges & cart ─────────────────────────────────────────────────

/** Product page / cards: the excise category, duty to add per unit (ADDED), licence missing, restricted. */
export async function offerBadges(ctx: Ctx, offers: { offerId: string; unitPriceNet?: number | null }[], locale: string) {
  const out = new Map<string, { kind: ExciseKind; category: string; mode: DutyMode; dutyUnit: number | null; licence: "OK" | "MISSING_BLOCK" | "MISSING_WARN" | "NOT_NEEDED"; restricted: boolean; maxPerOrder: number | null }>();
  const s = await exciseSettings();
  if (!s.enabled || !offers.length) return out;
  const ex = await offersExcise(offers.map((o) => o.offerId), s);
  if (!ex.size) return out;
  const buyer = ctx.company.type === "CUSTOMER" || ctx.company.type === "WHOLESALER";
  const country = buyer ? await countryOf(ctx.company.id) : "PT";
  const rule = licenceRule(s, country);
  const covered = buyer && rule.needed ? await coveredKinds(ctx.company.id, country) : new Set<ExciseKind>();
  const rates = await ratesFor([...new Set([...ex.values()].map((e) => e.cat.id))], country);
  for (const o of offers) {
    const e = ex.get(o.offerId);
    if (!e) continue;
    const mode = e.offer.dutyMode === "ADDED" && s.duty.calculate ? "ADDED" : "PAID";
    const duty = unitDuty(e.cat, rates.get(e.cat.id) ?? null, e.offer, o.unitPriceNet ?? 0);
    const needs = rule.needed && LICENSED_KINDS.includes(e.cat.kind);
    out.set(o.offerId, {
      kind: e.cat.kind, category: pickLocalized(e.cat.name as Record<string, string>, locale), mode, dutyUnit: duty == null ? null : duty.toNumber(),
      licence: !needs ? "NOT_NEEDED" : !buyer || covered.has(e.cat.kind) ? "OK" : rule.enforcement === "BLOCK" ? "MISSING_BLOCK" : "MISSING_WARN",
      restricted: buyer && s.restrictions.countries && (e.cat.blockedCountries.includes(country) || (e.offer.exciseCountries.length > 0 && !e.offer.exciseCountries.includes(country))),
      maxPerOrder: s.restrictions.qtyCaps ? e.cat.maxPerOrder : null,
    });
  }
  return out;
}

/** The cart page: duty added by FIRINGI and duty already in the prices, per line, plus the issues. */
export async function cartExcise(ctx: Ctx, items: { offerId: string; qty: number; unitPriceNet: number; taxRate: number; name: string }[], locale: string) {
  const s = await exciseSettings();
  const empty = { lines: [] as { offerId: string; name: string; category: string; mode: DutyMode; qty: number; unit: number; total: number }[], addedNet: 0, addedVat: 0, includedNet: 0, issues: [] as (Issue & { message: string })[], show: s.duty.show };
  if (!s.enabled || !items.length) return empty;
  const ex = await offersExcise(items.map((i) => i.offerId), s);
  if (!ex.size) return empty;
  const country = await countryOf(ctx.company.id);
  const rates = await ratesFor([...new Set([...ex.values()].map((e) => e.cat.id))], country);
  let added = new Decimal(0), addedVat = new Decimal(0), incl = new Decimal(0);
  for (const i of items) {
    const e = ex.get(i.offerId);
    if (!e) continue;
    const unit = unitDuty(e.cat, rates.get(e.cat.id) ?? null, e.offer, i.unitPriceNet);
    if (unit == null) continue;
    const mode = e.offer.dutyMode === "ADDED" && s.duty.calculate ? "ADDED" : "PAID";
    const total = r2(unit.mul(i.qty));
    if (mode === "ADDED") { added = added.plus(total); addedVat = addedVat.plus(r2(total.mul(i.taxRate).div(100))); } else incl = incl.plus(total);
    empty.lines.push({ offerId: i.offerId, name: i.name, category: pickLocalized(e.cat.name as Record<string, string>, locale), mode, qty: i.qty, unit: unit.toNumber(), total: total.toNumber() });
  }
  const issues = (await checkItems(ctx.company.id, items, prisma, locale)).map((x) => ({ ...x, message: MESSAGES[x.code](x) }));
  return { ...empty, addedNet: added.toNumber(), addedVat: addedVat.toNumber(), includedNet: incl.toNumber(), issues };
}

// ── supplier: product details ───────────────────────────────────────────────

function requireSupplier(ctx: Ctx, manage = true) {
  if ((ctx.company.type !== "DISTRIBUTOR" && ctx.company.type !== "WHOLESALER") || !can(ctx, manage ? ["vendor.products.manage"] : ["vendor.products.view", "vendor.products.manage"])) throw new ForbiddenError();
}

/** The supplier's offers that fall in an excise category (by shop category or its own choice), with what is missing. */
export async function vendorExciseOffers(ctx: Ctx, locale: string) {
  requireSupplier(ctx, false);
  const s = await exciseSettings();
  const all = await prisma.vendorOffer.findMany({
    where: { vendorCompanyId: ctx.company.id, status: { in: ["ACTIVE", "PAUSED", "PENDING_APPROVAL"] } },
    select: { ...OFFER_SELECT, vendorSku: true, packaging: { select: { name: true, unitsPerPack: true, variant: { select: { sku: true, product: { select: { name: true, category: OFFER_SELECT.packaging.select.variant.select.product.select.category } } } } } } },
    orderBy: { createdAt: "asc" },
  });
  const cats = await prisma.exciseCategory.findMany({ orderBy: { sortOrder: "asc" } });
  const country = await countryOf(ctx.company.id);
  const rates = await ratesFor(cats.map((c) => c.id), country);
  const rows = [];
  for (const o of all) {
    const inherited = fromCategory(o as unknown as OfferRow);
    const cid = o.exciseCategoryId ?? inherited;
    if (!cid) continue;
    const cat = cats.find((c) => c.id === cid)!;
    const m = measuresOf(o);
    const duty = cat ? unitDuty(cat, rates.get(cat.id) ?? null, o as unknown as OfferRow, 0) : null;
    rows.push({
      offerId: o.id, sku: o.vendorSku ?? o.packaging.variant.sku, name: `${pickLocalized(o.packaging.variant.product.name as Record<string, string>, locale)} — ${pickLocalized(o.packaging.name as Record<string, string>, locale)}`, unitsPerPack: o.packaging.unitsPerPack,
      categoryId: cid, own: o.exciseCategoryId, inherited, category: cat ? pickLocalized(cat.name as Record<string, string>, locale) : "", kind: cat?.kind, basis: cat?.basis,
      measures: m, missing: cat ? missingFor(cat.basis, m) : [], dutyMode: o.dutyMode, exciseCountries: o.exciseCountries, dutyUnit: duty?.toNumber() ?? null,
    });
  }
  return { settings: s, offers: rows, categories: cats.filter((c) => c.active && s.kinds[c.kind]).map((c) => ({ id: c.id, code: c.code, name: pickLocalized(c.name as Record<string, string>, locale), kind: c.kind, basis: c.basis })) };
}

export type OfferExciseInput = { offerId: string; exciseCategoryId?: string | null; abv?: number | null; volumeL?: number | null; exciseUnits?: number | null; netKg?: number | null; sugarGPerL?: number | null; dutyMode: DutyMode; exciseCountries?: string[] };

export async function saveOfferExcise(ctx: Ctx, i: OfferExciseInput) {
  requireSupplier(ctx);
  const s = await exciseSettings();
  const o = await prisma.vendorOffer.findFirst({ where: { id: i.offerId, vendorCompanyId: ctx.company.id }, select: OFFER_SELECT });
  if (!o) throw new NotFoundError("Offer");
  if (i.exciseCategoryId && !(await prisma.exciseCategory.count({ where: { id: i.exciseCategoryId, active: true } }))) throw new NotFoundError("Excise category");
  const pos = (v: unknown, max: number, what: string, int = false) => {
    if (v == null || v === "") return null;
    const x = Number(v);
    if (!Number.isFinite(x) || x <= 0 || x > max || (int && !Number.isInteger(x))) throw new ValidationError(`Check the ${what}.`);
    return x;
  };
  const abv = i.abv == null || (i.abv as unknown) === "" ? null : Number(i.abv);
  if (abv != null && (!Number.isFinite(abv) || abv < 0 || abv > 100)) throw new ValidationError("Alcohol must be between 0 and 100 % vol.");
  const sugar = i.sugarGPerL == null || (i.sugarGPerL as unknown) === "" ? null : Number(i.sugarGPerL);
  if (sugar != null && (!Number.isFinite(sugar) || sugar < 0 || sugar > 1000)) throw new ValidationError("Sugar must be between 0 and 1000 g per litre.");
  if (i.dutyMode === "ADDED" && !s.duty.calculate) throw new ValidationError("FIRINGI doesn't calculate duty at the moment — your prices must include it.");
  const countries = [...new Set((i.exciseCountries ?? []).map((x) => x.trim().toUpperCase()).filter((x) => /^[A-Z]{2}$/.test(x)))];
  const data = {
    exciseCategoryId: i.exciseCategoryId || null, abv: abv?.toString() ?? null, volumeL: pos(i.volumeL, 10_000, "litres")?.toString() ?? null,
    exciseUnits: pos(i.exciseUnits, 1_000_000, "number of units", true), netKg: pos(i.netKg, 10_000, "weight in kg")?.toString() ?? null,
    sugarGPerL: sugar?.toString() ?? null, dutyMode: i.dutyMode === "ADDED" ? "ADDED" : "PAID", exciseCountries: countries,
  } as const;
  const cid = data.exciseCategoryId ?? fromCategory(o);
  if (cid) {
    const cat = await prisma.exciseCategory.findUniqueOrThrow({ where: { id: cid } });
    const miss = missingFor(cat.basis, { abv, volumeL: data.volumeL == null ? null : Number(data.volumeL), exciseUnits: data.exciseUnits, netKg: data.netKg == null ? null : Number(data.netKg), sugarGPerL: sugar });
    if (miss.length) throw new ValidationError(`${pickLocalized(cat.name as Record<string, string>, "en")} needs: ${miss.join(", ")}.`, { missing: miss });
  }
  await prisma.vendorOffer.update({ where: { id: o.id }, data });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "excise.offer_saved", entityType: "VendorOffer", entityId: o.id, before: { exciseCategoryId: o.exciseCategoryId, abv: num(o.abv), volumeL: num(o.volumeL), exciseUnits: o.exciseUnits, netKg: num(o.netKg), sugarGPerL: num(o.sugarGPerL), dutyMode: o.dutyMode, exciseCountries: o.exciseCountries }, after: data });
}

// ── customers' licences ─────────────────────────────────────────────────────

function requireBuyer(ctx: Ctx, manage = false) {
  if ((ctx.company.type !== "CUSTOMER" && ctx.company.type !== "WHOLESALER") || !can(ctx, manage ? ["company.documents.manage", "company.profile.manage", "buyer.orders.place"] : ["buyer.orders.view", "buyer.orders.place", "company.documents.manage"])) throw new ForbiddenError();
}

export async function myLicences(ctx: Ctx, locale: string) {
  requireBuyer(ctx);
  const s = await exciseSettings();
  const country = await countryOf(ctx.company.id);
  const types = (await prisma.licenceType.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } })).filter((t) => !t.countries.length || t.countries.includes(country));
  const rows = await prisma.customerLicence.findMany({ where: { companyId: ctx.company.id }, orderBy: { createdAt: "desc" }, include: { type: true } });
  const covered = await coveredKinds(ctx.company.id, country);
  return {
    settings: s, rule: licenceRule(s, country), country, covered: [...covered],
    types: types.map((t) => ({ id: t.id, code: t.code, name: pickLocalized(t.name as Record<string, string>, locale), kinds: t.kinds, needsNumber: t.needsNumber, hasExpiry: t.hasExpiry, ok: t.kinds.every((k) => covered.has(k)) })),
    licences: rows.map((l) => ({ id: l.id, type: pickLocalized(l.type.name as Record<string, string>, locale), kinds: l.type.kinds, number: l.number, issuer: l.issuer, issuedOn: l.issuedOn, expiresOn: l.expiresOn, status: l.status as ReviewStatus | "SUPERSEDED", reviewNote: l.reviewNote, hasFile: !!l.fileKey, valid: licenceValid(l), superseded: !!l.supersededAt, daysLeft: l.expiresOn ? daysLeft(l.expiresOn) : null })),
  };
}

export type LicenceInput = { typeId: string; number?: string | null; issuer?: string | null; issuedOn?: string | null; expiresOn?: string | null; file: File };

export async function uploadLicence(ctx: Ctx, i: LicenceInput) {
  requireBuyer(ctx, true);
  const country = await countryOf(ctx.company.id);
  const type = await prisma.licenceType.findFirst({ where: { id: i.typeId, active: true } });
  if (!type || (type.countries.length && !type.countries.includes(country))) throw new ValidationError("This licence isn't asked for your country.");
  const number = i.number?.trim() || null, issuer = i.issuer?.trim() || null;
  if (type.needsNumber && !number) throw new ValidationError("Enter the licence number.");
  if ((number?.length ?? 0) > 80 || (issuer?.length ?? 0) > 120) throw new ValidationError("The licence number or issuer is too long.");
  const issuedOn = day(i.issuedOn), expiresOn = day(i.expiresOn);
  if (issuedOn && issuedOn > today()) throw new ValidationError("The issue date can't be in the future.");
  if (type.hasExpiry && !expiresOn) throw new ValidationError("Enter the expiry date.");
  if (expiresOn && expiresOn < today()) throw new ValidationError("This licence has already expired — upload the current one.");
  if (issuedOn && expiresOn && expiresOn < issuedOn) throw new ValidationError("The expiry date is before the issue date.");
  const stored = await storeUpload(i.file, `licences/${ctx.company.id}`);
  const l = await prisma.customerLicence.create({
    data: { companyId: ctx.company.id, typeId: type.id, number, issuer, countryCode: country, issuedOn, expiresOn: type.hasExpiry ? expiresOn : null, fileKey: stored.key, fileName: stored.fileName, mimeType: stored.mimeType, sizeBytes: stored.sizeBytes, uploadedById: ctx.user.id },
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "excise.licence_uploaded", entityType: "CustomerLicence", entityId: l.id, after: { type: type.code, number, expiresOn: i.expiresOn, file: stored.fileName, sha256: stored.sha256 } });
  await notify("excise.licence_review", [{ companyId: await firingiId(), link: `/admin/customers/licences?licence=${l.id}` }], { company: ctx.company.tradeName ?? ctx.company.legalName, licence: pickLocalized(type.name as Record<string, string>, "en") }, { ref: { type: "CustomerLicence", id: l.id } }).catch(() => null);
  return l.id;
}

export async function withdrawLicence(ctx: Ctx, id: string) {
  requireBuyer(ctx, true);
  const l = await prisma.customerLicence.findFirst({ where: { id, companyId: ctx.company.id, status: "PENDING" } });
  if (!l) throw new NotFoundError("Licence");
  await prisma.customerLicence.delete({ where: { id } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "excise.licence_withdrawn", entityType: "CustomerLicence", entityId: id, before: { number: l.number } });
}

function requireLicenceAdmin(ctx: Ctx, manage = false) {
  if (!isStaff(ctx) || !can(ctx, manage ? ["admin.customers.manage", "admin.vendors.approve"] : ["admin.customers.view", "admin.customers.manage", "admin.vendors.view", "admin.vendors.approve"])) throw new ForbiddenError();
}

async function decided(l: { id: string; companyId: string; type: { name: unknown } }, status: string, note: string | null) {
  await notify("excise.licence_decided", [{ companyId: l.companyId, link: "/buy/company/licences" }], { licence: pickLocalized(l.type.name as Record<string, string>, "pt"), status: status.toLowerCase(), note: note ?? "" }, { ref: { type: "CustomerLicence", id: l.id } }).catch(() => null);
}

export async function approveLicence(ctx: Ctx, id: string, i: { expiresOn?: string | null; note?: string | null } = {}) {
  requireLicenceAdmin(ctx, true);
  const l = await prisma.customerLicence.findUnique({ where: { id }, include: { type: true } });
  if (!l || l.status !== "PENDING") throw new NotFoundError("Licence");
  const expiresOn = i.expiresOn ? day(i.expiresOn) : l.expiresOn;
  if (l.type.hasExpiry && !expiresOn) throw new ValidationError("Enter the expiry date.");
  await prisma.$transaction(async (tx) => {
    await tx.customerLicence.updateMany({ where: { companyId: l.companyId, typeId: l.typeId, status: "APPROVED", supersededAt: null, id: { not: id } }, data: { supersededAt: new Date() } });
    await tx.customerLicence.update({ where: { id }, data: { status: "APPROVED", expiresOn, reviewNote: i.note?.trim() || null, reviewedById: ctx.user.id, reviewedAt: new Date(), remindedDays: [] } });
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "excise.licence_approved", entityType: "CustomerLicence", entityId: id, after: { expiresOn: expiresOn?.toISOString().slice(0, 10) ?? null } });
  await decided(l, "APPROVED", i.note?.trim() || null);
}

export async function rejectLicence(ctx: Ctx, id: string, note: string) {
  requireLicenceAdmin(ctx, true);
  if (!note?.trim()) throw new ValidationError("Say why, so the customer can fix it.");
  const l = await prisma.customerLicence.findUnique({ where: { id }, include: { type: true } });
  if (!l || l.status !== "PENDING") throw new NotFoundError("Licence");
  await prisma.customerLicence.update({ where: { id }, data: { status: "REJECTED", reviewNote: note.trim().slice(0, 500), reviewedById: ctx.user.id, reviewedAt: new Date() } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "excise.licence_rejected", entityType: "CustomerLicence", entityId: id, after: { note } });
  await decided(l, "REJECTED", note.trim());
}

export async function revokeLicence(ctx: Ctx, id: string, note: string) {
  requireLicenceAdmin(ctx, true);
  if (!note?.trim()) throw new ValidationError("Say why the licence is revoked.");
  const l = await prisma.customerLicence.findUnique({ where: { id }, include: { type: true } });
  if (!l || l.status !== "APPROVED") throw new NotFoundError("Licence");
  await prisma.customerLicence.update({ where: { id }, data: { status: "REVOKED", reviewNote: note.trim().slice(0, 500), reviewedById: ctx.user.id, reviewedAt: new Date() } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "excise.licence_revoked", entityType: "CustomerLicence", entityId: id, after: { note } });
  await decided(l, "REVOKED", note.trim());
}

/** FIRINGI records a licence it has seen (paper, registry check) — approved at once, no file needed. */
export async function recordLicence(ctx: Ctx, i: { companyId: string; typeId: string; number?: string | null; issuer?: string | null; expiresOn?: string | null; note?: string | null }) {
  requireLicenceAdmin(ctx, true);
  const co = await prisma.company.findFirst({ where: { id: i.companyId, type: { in: ["CUSTOMER", "WHOLESALER"] } }, select: { id: true, country: { select: { code: true } } } });
  if (!co) throw new NotFoundError("Customer");
  const type = await prisma.licenceType.findFirst({ where: { id: i.typeId, active: true } });
  if (!type) throw new NotFoundError("Licence type");
  const expiresOn = day(i.expiresOn);
  if (type.hasExpiry && !expiresOn) throw new ValidationError("Enter the expiry date.");
  if (type.needsNumber && !i.number?.trim()) throw new ValidationError("Enter the licence number.");
  const l = await prisma.$transaction(async (tx) => {
    await tx.customerLicence.updateMany({ where: { companyId: co.id, typeId: type.id, status: "APPROVED", supersededAt: null }, data: { supersededAt: new Date() } });
    return tx.customerLicence.create({ data: { companyId: co.id, typeId: type.id, number: i.number?.trim() || null, issuer: i.issuer?.trim() || null, countryCode: co.country.code, expiresOn, status: "APPROVED", reviewNote: i.note?.trim() || "Recorded by FIRINGI", reviewedById: ctx.user.id, reviewedAt: new Date(), uploadedById: ctx.user.id } });
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "excise.licence_recorded", entityType: "CustomerLicence", entityId: l.id, after: { companyId: co.id, type: type.code, number: i.number, expiresOn: i.expiresOn } });
  return l.id;
}

/** The licence register: customers' licences and suppliers' excise authorisations, with status and expiry. */
export async function licenceRegister(ctx: Ctx, f: { status?: string; q?: string } = {}, locale = "en") {
  requireLicenceAdmin(ctx);
  const s = await exciseSettings();
  const q = f.q?.trim();
  const where: Prisma.CustomerLicenceWhereInput = {
    ...(f.status === "PENDING" || f.status === "APPROVED" || f.status === "REJECTED" || f.status === "REVOKED" ? { status: f.status } : {}),
    ...(q ? { OR: [{ number: { contains: q, mode: "insensitive" } }, { company: { legalName: { contains: q, mode: "insensitive" } } }, { company: { tradeName: { contains: q, mode: "insensitive" } } }] } : {}),
  };
  const rows = await prisma.customerLicence.findMany({ where, include: { type: true, company: { select: { id: true, legalName: true, tradeName: true, taxId: true, country: { select: { code: true } } } } }, orderBy: [{ status: "asc" }, { createdAt: "desc" }], take: 500 });
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.reviewedById).filter((x): x is string => !!x))] } }, select: { id: true, name: true } });
  const suppliers = await prisma.certificate.findMany({ where: { type: { key: "excise-authorisation" }, supersededAt: null }, include: { company: { select: { id: true, legalName: true, tradeName: true, taxId: true } } }, orderBy: { createdAt: "desc" }, take: 200 });
  const types = await prisma.licenceType.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } });
  return {
    settings: s,
    pending: rows.filter((r) => r.status === "PENDING").length,
    customers: rows.map((r) => ({
      id: r.id, companyId: r.companyId, company: cname(r.company), taxId: r.company.taxId, country: r.company.country.code, type: pickLocalized(r.type.name as Record<string, string>, locale), kinds: r.type.kinds,
      number: r.number, issuer: r.issuer, issuedOn: r.issuedOn, expiresOn: r.expiresOn, status: r.status, superseded: !!r.supersededAt, valid: licenceValid(r), hasFile: !!r.fileKey,
      reviewNote: r.reviewNote, reviewedBy: users.find((u) => u.id === r.reviewedById)?.name ?? null, reviewedAt: r.reviewedAt, createdAt: r.createdAt, daysLeft: r.expiresOn ? daysLeft(r.expiresOn) : null,
    })),
    suppliers: suppliers.map((c) => ({ id: c.id, companyId: c.companyId, company: cname(c.company), taxId: c.company.taxId, number: c.number, expiresOn: c.expiresOn, status: c.status })),
    types: types.map((t) => ({ id: t.id, name: pickLocalized(t.name as Record<string, string>, locale) })),
  };
}

/** Customers FIRINGI can record a licence for. */
export async function licenceCompanies(ctx: Ctx) {
  requireLicenceAdmin(ctx, true);
  const rows = await prisma.company.findMany({ where: { type: { in: ["CUSTOMER", "WHOLESALER"] }, status: "APPROVED" }, select: { id: true, legalName: true, tradeName: true }, orderBy: { legalName: "asc" }, take: 1000 });
  return rows.map((c) => ({ id: c.id, name: cname(c) }));
}

export async function licenceFile(ctx: Ctx, id: string) {
  const l = await prisma.customerLicence.findUnique({ where: { id } });
  if (!l || !l.fileKey) throw new NotFoundError("Licence");
  const ok = isStaff(ctx) ? can(ctx, ["admin.customers.view", "admin.customers.manage", "admin.vendors.view", "admin.vendors.approve"]) : ctx.company.id === l.companyId;
  if (!ok) throw new NotFoundError("Licence");
  return { body: await readStored(l.fileKey), fileName: l.fileName ?? "licence", mimeType: l.mimeType ?? "application/octet-stream" };
}

// ── orders ──────────────────────────────────────────────────────────────────

/**
 * At checkout: each line keeps its excise category, mode and duty per unit (rates of that day, buyer's country);
 * the order its totals (added duty + its VAT, duty already in the prices). Quantities can change later — the
 * totals follow (refreshOrder), the unit duty stays.
 */
export async function attachToOrder(tx: Tx, orderId: string) {
  const s = await exciseSettings(tx);
  if (!s.enabled) return 0;
  const o = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { buyerCompanyId: true, lines: { select: { id: true, offerId: true, unitSalePriceNet: true } } } });
  const ex = await offersExcise([...new Set(o.lines.map((l) => l.offerId))], s, tx);
  if (!ex.size) return 0;
  const country = await countryOf(o.buyerCompanyId, tx);
  const rates = await ratesFor([...new Set([...ex.values()].map((e) => e.cat.id))], country, tx);
  let n = 0;
  for (const l of o.lines) {
    const e = ex.get(l.offerId);
    if (!e) continue;
    const unit = unitDuty(e.cat, rates.get(e.cat.id) ?? null, e.offer, l.unitSalePriceNet);
    const mode: DutyMode = e.offer.dutyMode === "ADDED" && s.duty.calculate && unit != null ? "ADDED" : "PAID";
    const m = measure(measuresOf(e.offer));
    await tx.orderLine.update({ where: { id: l.id }, data: { exciseCategoryId: e.cat.id, exciseMode: mode, exciseUnitNet: unit?.toFixed(4) ?? null, exciseMeasure: { ...m, country } as Prisma.InputJsonValue } });
    n++;
  }
  await refreshOrder(tx, orderId);
  return n;
}

/** Totals from the lines' current quantities (delivered → confirmed → ordered). */
export async function refreshOrder(tx: Tx, orderId: string) {
  const lines = await tx.orderLine.findMany({ where: { orderId, exciseCategoryId: { not: null } }, select: { id: true, exciseMode: true, exciseUnitNet: true, taxRate: true, qtyOrdered: true, qtyConfirmed: true, qtyDelivered: true } });
  let added = new Decimal(0), vat = new Decimal(0), incl = new Decimal(0);
  for (const l of lines) {
    const qty = l.qtyDelivered ?? l.qtyConfirmed ?? l.qtyOrdered;
    const net = l.exciseUnitNet == null ? new Decimal(0) : r2(D(l.exciseUnitNet).mul(qty));
    await tx.orderLine.update({ where: { id: l.id }, data: { exciseNet: net.toFixed(2) } });
    if (l.exciseMode === "ADDED") { added = added.plus(net); vat = vat.plus(r2(net.mul(D(l.taxRate)).div(100))); } else incl = incl.plus(net);
  }
  await tx.order.update({ where: { id: orderId }, data: { exciseAddedNet: added.toFixed(2), exciseAddedVat: vat.toFixed(2), exciseIncludedNet: incl.toFixed(2) } });
  return { added, vat, incl };
}

type InvLine = { orderLineId?: string; description: string; qty: Decimal; unitPriceNet: Decimal; taxRate: Decimal; lineNet: Decimal; lineVat: Decimal; exciseNet?: Decimal };
type StLine = { orderLineId: string | null; sku: string; description: string; qty: number; unitCostNet: string; lineNet: string; taxRate: string; vat: string; commission: string };

/**
 * At invoicing: the duty already in each goods line (shown on the invoice), the added-duty lines for the invoice
 * (VAT at the goods' rate), and the same amounts on the supplier's statement (the supplier pays the duty).
 */
export async function invoiceExcise(tx: Tx, orderId: string, o: { crossBorder: boolean }) {
  const s = await exciseSettings(tx);
  await refreshOrder(tx, orderId);
  const lines = await tx.orderLine.findMany({ where: { orderId, exciseCategoryId: { not: null } }, include: { exciseCategory: true } });
  const included = new Map<string, Decimal>();
  const invoiceLines: InvLine[] = [];
  const statementLines: StLine[] = [];
  for (const l of lines) {
    const qty = l.qtyDelivered ?? l.qtyConfirmed ?? l.qtyOrdered;
    if (qty <= 0 || l.exciseUnitNet == null) continue;
    const net = D(l.exciseNet);
    const cat = pickLocalized(l.exciseCategory!.name as Record<string, string>, "pt");
    if (l.exciseMode === "ADDED") {
      const rate = D(l.taxRate);
      invoiceLines.push({ orderLineId: l.id, description: `Imposto especial de consumo — ${cat} (SKU ${l.sku})`, qty: new Decimal(qty), unitPriceNet: D(l.exciseUnitNet), taxRate: rate, lineNet: net, lineVat: r2(net.mul(rate).div(100)), exciseNet: net });
      const stRate = o.crossBorder ? new Decimal(0) : rate;
      statementLines.push({ orderLineId: l.id, sku: `EXCISE-${l.sku}`, description: `Imposto especial de consumo — ${cat}`, qty, unitCostNet: D(l.exciseUnitNet).toFixed(4), lineNet: net.toFixed(2), taxRate: stRate.toFixed(3), vat: r2(net.mul(stRate).div(100)).toFixed(2), commission: "0" });
    } else if (s.duty.show) included.set(l.id, net);
  }
  return { included, invoiceLines, statementLines };
}

/** Order pages: the excise lines, the licence check at delivery and the accompanying document. */
export async function orderExcise(ctx: Ctx, orderId: string, as: "BUYER" | "SUPPLIER" | "ADMIN", locale: string) {
  const s = await exciseSettings();
  if (!s.enabled) return null;
  const o = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, status: true, buyerCompanyId: true, sellerCompanyId: true, exciseAddedNet: true, exciseAddedVat: true, exciseIncludedNet: true, delivery: { select: { exciseCheckedAt: true, exciseDocType: true, exciseDocRef: true, exciseCheckedById: true } }, lines: { where: { exciseCategoryId: { not: null } }, include: { exciseCategory: true } } },
  });
  if (!o) return null;
  const mine = as === "BUYER" ? o.buyerCompanyId === ctx.company.id : as === "SUPPLIER" ? o.sellerCompanyId === ctx.company.id : isStaff(ctx);
  if (!mine || !o.lines.length) return null;
  const checker = o.delivery?.exciseCheckedById ? await prisma.user.findUnique({ where: { id: o.delivery.exciseCheckedById }, select: { name: true } }) : null;
  return {
    show: s.duty.show,
    lines: o.lines.map((l) => {
      const m = (l.exciseMeasure ?? {}) as { litres?: number | null; lpa?: number | null; units?: number | null; kg?: number | null; abv?: number | null };
      return { id: l.id, name: `${pickLocalized(l.productName as Record<string, string>, locale)} — ${pickLocalized(l.packagingName as Record<string, string>, locale)}`, category: pickLocalized(l.exciseCategory!.name as Record<string, string>, locale), kind: l.exciseCategory!.kind, mode: l.exciseMode, unit: num(l.exciseUnitNet), total: Number(l.exciseNet), qty: l.qtyDelivered ?? l.qtyConfirmed ?? l.qtyOrdered, abv: m.abv ?? null, litres: m.litres ?? null, lpa: m.lpa ?? null, units: m.units ?? null, kg: m.kg ?? null };
    }),
    addedNet: Number(o.exciseAddedNet), addedVat: Number(o.exciseAddedVat), includedNet: Number(o.exciseIncludedNet),
    licensed: o.lines.some((l) => LICENSED_KINDS.includes(l.exciseCategory!.kind)),
    check: { required: s.restrictions.driverCheck, at: o.delivery?.exciseCheckedAt ?? null, by: checker?.name ?? null },
    doc: s.records.deliveryDocs ? { type: o.delivery?.exciseDocType ?? null, ref: o.delivery?.exciseDocRef ?? null, canEdit: as !== "BUYER" && !["CANCELLED"].includes(o.status) } : null,
  };
}

export const DOC_TYPES = ["E_DA", "E_SAD", "SAAD", "DSA", "OTHER"] as const;

/** Supplier or FIRINGI records the accompanying excise document (e-DA / e-SAD / SAAD reference). */
export async function recordExciseDoc(ctx: Ctx, orderId: string, i: { docType: string; docRef: string }) {
  const s = await exciseSettings();
  if (!s.enabled || !s.records.deliveryDocs) throw new ForbiddenError();
  const o = await prisma.order.findUnique({ where: { id: orderId }, select: { sellerCompanyId: true, delivery: { select: { id: true, exciseDocType: true, exciseDocRef: true } } } });
  if (!o?.delivery) throw new NotFoundError("Delivery");
  const ok = isStaff(ctx) ? can(ctx, ["admin.orders.manage", "admin.delivery.manage"]) : o.sellerCompanyId === ctx.company.id && can(ctx, ["vendor.orders.manage"]);
  if (!ok) throw new ForbiddenError();
  if (!DOC_TYPES.includes(i.docType as (typeof DOC_TYPES)[number])) throw new ValidationError("Choose the document type.");
  const ref = i.docRef.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9 ./-]{2,39}$/.test(ref)) throw new ValidationError("Enter the document reference (e.g. the ARC of the e-DA).");
  await prisma.delivery.update({ where: { id: o.delivery.id }, data: { exciseDocType: i.docType, exciseDocRef: ref } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "excise.document_recorded", entityType: "Delivery", entityId: o.delivery.id, before: { type: o.delivery.exciseDocType, ref: o.delivery.exciseDocRef }, after: { type: i.docType, ref } });
}

/** The driver's stop: does this delivery need the licence / ID check? */
export async function stopCheck(orderId: string, db: Tx | typeof prisma = prisma) {
  const s = await exciseSettings(db);
  if (!s.enabled || !s.restrictions.driverCheck) return { required: false, kinds: [] as ExciseKind[] };
  const lines = await db.orderLine.findMany({ where: { orderId, exciseCategoryId: { not: null } }, select: { exciseCategory: { select: { kind: true } } } });
  const kinds = [...new Set(lines.map((l) => l.exciseCategory!.kind).filter((k) => LICENSED_KINDS.includes(k)))];
  return { required: kinds.length > 0, kinds };
}

/** In the handover transaction: refuses without the driver's check when FIRINGI asks for it; records it. */
export async function recordHandoverCheckTx(tx: Tx, deliveryId: string, checked: boolean | undefined, userId: string) {
  const d = await tx.delivery.findUniqueOrThrow({ where: { id: deliveryId }, select: { orderId: true } });
  const need = await stopCheck(d.orderId, tx);
  if (!need.required) { if (checked) await tx.delivery.update({ where: { id: deliveryId }, data: { exciseCheckedAt: new Date(), exciseCheckedById: userId } }); return; }
  if (!checked) throw new AppError("EXCISE_CHECK_REQUIRED", "Check the customer's licence or ID for the alcohol / tobacco before handing over.", 422);
  await tx.delivery.update({ where: { id: deliveryId }, data: { exciseCheckedAt: new Date(), exciseCheckedById: userId } });
}

// ── report ──────────────────────────────────────────────────────────────────

/** Monthly excise report from delivered orders: per category, buyer country and mode — units, litres, LPA, sticks, kg, duty. */
export async function exciseReport(ctx: Ctx, ym: string, locale = "en") {
  const s = await exciseSettings();
  if (!s.records.report) throw new ForbiddenError();
  const range = monthRange(ym);
  if (!range) throw new ValidationError("Choose a month.");
  const staff = isStaff(ctx);
  if (staff ? !can(ctx, ["admin.finance.view", "admin.finance.manage"]) : !(ctx.company.type === "DISTRIBUTOR" || ctx.company.type === "WHOLESALER") || !can(ctx, ["vendor.orders.view", "vendor.orders.manage", "vendor.reports.view"])) throw new ForbiddenError();
  const lines = await prisma.orderLine.findMany({
    where: { exciseCategoryId: { not: null }, order: { status: "DELIVERED", delivery: { completedAt: { gte: range[0], lt: range[1] } }, ...(staff ? {} : { sellerCompanyId: ctx.company.id }) } },
    include: { exciseCategory: true, order: { select: { number: true, seller: { select: { legalName: true, tradeName: true } }, buyer: { select: { legalName: true, tradeName: true, country: { select: { code: true } } } }, delivery: { select: { completedAt: true, exciseDocRef: true } } } } },
  });
  const groups = new Map<string, { category: string; code: string; kind: ExciseKind; country: string; mode: string; units: number; litres: number; lpa: number; sticks: number; kg: number; dutyAdded: number; dutyIncluded: number; orders: Set<string> }>();
  const detail = [];
  for (const l of lines) {
    const qty = l.qtyDelivered ?? l.qtyConfirmed ?? l.qtyOrdered;
    const m = (l.exciseMeasure ?? {}) as { litres?: number | null; lpa?: number | null; units?: number | null; kg?: number | null };
    const country = l.order.buyer.country.code, mode = l.exciseMode ?? "PAID";
    const k = `${l.exciseCategoryId}|${country}|${mode}`;
    const g = groups.get(k) ?? { category: pickLocalized(l.exciseCategory!.name as Record<string, string>, locale), code: l.exciseCategory!.code, kind: l.exciseCategory!.kind, country, mode, units: 0, litres: 0, lpa: 0, sticks: 0, kg: 0, dutyAdded: 0, dutyIncluded: 0, orders: new Set<string>() };
    g.units += qty; g.litres += (m.litres ?? 0) * qty; g.lpa += (m.lpa ?? 0) * qty; g.sticks += (m.units ?? 0) * qty; g.kg += (m.kg ?? 0) * qty;
    if (mode === "ADDED") g.dutyAdded += Number(l.exciseNet); else g.dutyIncluded += Number(l.exciseNet);
    g.orders.add(l.order.number);
    groups.set(k, g);
    detail.push({ date: l.order.delivery?.completedAt ?? null, order: l.order.number, supplier: cname(l.order.seller), customer: cname(l.order.buyer), country, category: g.category, mode, sku: l.sku, qty, litres: +((m.litres ?? 0) * qty).toFixed(3), lpa: +((m.lpa ?? 0) * qty).toFixed(4), sticks: (m.units ?? 0) * qty, kg: +((m.kg ?? 0) * qty).toFixed(3), duty: Number(l.exciseNet), doc: l.order.delivery?.exciseDocRef ?? null });
  }
  const rows = [...groups.values()].map((g) => ({ ...g, orders: g.orders.size, litres: +g.litres.toFixed(3), lpa: +g.lpa.toFixed(4), kg: +g.kg.toFixed(3), dutyAdded: +g.dutyAdded.toFixed(2), dutyIncluded: +g.dutyIncluded.toFixed(2) })).sort((a, b) => a.code.localeCompare(b.code) || a.country.localeCompare(b.country));
  const company = staff ? null : await prisma.company.findUnique({ where: { id: ctx.company.id }, select: { legalName: true, taxId: true } });
  return {
    month: ym, staff, company: company?.legalName ?? "FIRINGI", taxId: company?.taxId ?? null, rows, detail: detail.sort((a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0)),
    totals: { dutyAdded: +rows.reduce((a, r) => a + r.dutyAdded, 0).toFixed(2), dutyIncluded: +rows.reduce((a, r) => a + r.dutyIncluded, 0).toFixed(2), lpa: +rows.reduce((a, r) => a + r.lpa, 0).toFixed(4), litres: +rows.reduce((a, r) => a + r.litres, 0).toFixed(3), sticks: rows.reduce((a, r) => a + r.sticks, 0) },
  };
}

export function reportCsv(r: Awaited<ReturnType<typeof exciseReport>>) {
  const q = (v: unknown) => { const s = v == null ? "" : String(v); return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const c = (n: number, dp = 2) => n.toFixed(dp).replace(".", ",");
  const head = ["date", "order", "supplier", "customer", "country", "category", "mode", "sku", "qty", "litres", "litres_pure_alcohol", "units", "kg", "duty_eur", "document"];
  return [head.join(";"), ...r.detail.map((x) => [x.date ? x.date.toISOString().slice(0, 10) : "", x.order, x.supplier, x.customer, x.country, x.category, x.mode, x.sku, x.qty, c(x.litres, 3), c(x.lpa, 4), x.sticks, c(x.kg, 3), c(x.duty), x.doc ?? ""].map(q).join(";"))].join("\n") + "\n";
}

// ── overview & job ──────────────────────────────────────────────────────────

/** FIRINGI overview: pending licences, expiring soon, licensed goods without measures, this month's duty. */
export async function exciseOverview(ctx: Ctx, locale = "en") {
  requireLicenceAdmin(ctx);
  const s = await exciseSettings();
  const soon = new Date(Date.now() + 30 * 86_400_000);
  const [pending, expiring, blockedBuyers] = await Promise.all([
    prisma.customerLicence.count({ where: { status: "PENDING" } }),
    prisma.customerLicence.count({ where: { status: "APPROVED", supersededAt: null, expiresOn: { gte: today(), lte: soon } } }),
    prisma.customerLicence.count({ where: { status: { in: ["REJECTED", "REVOKED"] } } }),
  ]);
  const ym = new Date().toISOString().slice(0, 7);
  const report = s.records.report ? await exciseReport(ctx, ym, locale).catch(() => null) : null;
  const all = await prisma.vendorOffer.findMany({ where: { status: "ACTIVE" }, select: { ...OFFER_SELECT, vendor: { select: { legalName: true, tradeName: true } }, vendorSku: true } });
  const cats = await prisma.exciseCategory.findMany();
  const incomplete = [];
  for (const o of all) {
    const cat = cats.find((c) => c.id === (o.exciseCategoryId ?? fromCategory(o as unknown as OfferRow)));
    if (!cat || !cat.active || !s.kinds[cat.kind]) continue;
    const miss = missingFor(cat.basis, measuresOf(o));
    if (miss.length) incomplete.push({ offerId: o.id, supplier: cname(o.vendor), sku: o.vendorSku ?? "", category: pickLocalized(cat.name as Record<string, string>, locale), missing: miss });
  }
  return { settings: s, pending, expiring, blockedBuyers, month: ym, report, incomplete: incomplete.slice(0, 100), incompleteCount: incomplete.length };
}

/** Daily: licence reminders before expiry (30 / 14 / 7 days) and expired licences marked. */
export async function runExciseJob(at = new Date()) {
  const s = await exciseSettings();
  if (!s.enabled) return { reminders: 0, expired: 0 };
  let reminders = 0;
  const expired = await prisma.customerLicence.updateMany({ where: { status: "APPROVED", expiresOn: { lt: new Date(at.toISOString().slice(0, 10) + "T00:00:00Z") } }, data: { status: "EXPIRED" } });
  const rows = await prisma.customerLicence.findMany({ where: { status: "APPROVED", supersededAt: null, expiresOn: { not: null } }, include: { type: true } });
  for (const l of rows) {
    const left = daysLeft(l.expiresOn!, at);
    const due = s.licences.reminderDays.filter((d) => left <= d && !l.remindedDays.includes(d));
    if (!due.length) continue;
    // a newer licence of the same type waiting for review → no reminder needed
    if (await prisma.customerLicence.count({ where: { companyId: l.companyId, typeId: l.typeId, status: "PENDING" } })) continue;
    await notify("excise.licence_expiring", [{ companyId: l.companyId, link: "/buy/company/licences" }], { licence: pickLocalized(l.type.name as Record<string, string>, "pt"), date: l.expiresOn!.toISOString().slice(0, 10), days: Math.max(0, left) }, { ref: { type: "CustomerLicence", id: l.id } }).catch(() => null);
    await prisma.customerLicence.update({ where: { id: l.id }, data: { remindedDays: [...l.remindedDays, ...due] } });
    reminders++;
  }
  return { reminders, expired: expired.count };
}
