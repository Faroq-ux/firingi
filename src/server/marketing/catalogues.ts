import "server-only";
/**
 * Marketing catalogues — FIRINGI makes product catalogues / brochures for marketing, by hand or with AI:
 *  - for: all wholesalers of a country, some wholesalers, delivery zones or districts (the wholesalers serving them);
 *  - products picked by category / brand / words / best sellers, or by the AI from a brief, then reordered by hand;
 *  - each product shows what FIRINGI decides: price (none / excl. / incl. VAT), barcode, pack and minimum order,
 *    supplier (none / name / "FIRINGI <area>"), a QR code into the shop;
 *  - a PDF (layouts 4 / 6 / 9 per page or a list) and a public share link /c/<token>; or FIRINGI's own PDF uploaded;
 *  - sent to the customers in the scope through a marketing campaign (draft, FIRINGI picks the channels and sends).
 * Tobacco is never put in a catalogue (EU advertising rules).
 */
import type Anthropic from "@anthropic-ai/sdk";
import { Prisma, type MarketingCatalogue } from "@prisma/client";
import Decimal from "decimal.js";
import { randomBytes } from "node:crypto";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";
import { aiSettings, aiTransport } from "@/server/ai/assistant";
import { logAi } from "@/server/ai/feed";
import { pickLocalized } from "@/i18n/config";
import {
  AiCatalogue, AiTranslation, MC_LAYOUTS, cleanItems, mergeFilters, mergeOptions, printableBarcode,
  type McFilters, type McItem, type McLayout, type McOptions, type McScope,
} from "@/lib/marketing-catalogue";

const KEY = "marketingCatalogue.settings";
export type McSettings = { enabled: boolean; ai: boolean };
export async function mcSettings(): Promise<McSettings> {
  const v = (await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: KEY } }))?.value as Partial<McSettings> | null;
  return { enabled: v?.enabled !== false, ai: v?.ai !== false };
}
export async function saveMcSettings(ctx: Ctx, s: McSettings) {
  manage(ctx);
  const before = await mcSettings();
  await prisma.setting.upsert({ where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key: KEY } }, update: { value: s, updatedById: ctx.user.id }, create: { scope: "GLOBAL", key: KEY, value: s, updatedById: ctx.user.id } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: KEY, entityType: "Setting", entityId: KEY, before, after: s });
  return s;
}

function view(ctx: Ctx) { if (ctx.company.type !== "ADMIN" || !can(ctx, ["admin.marketing.view", "admin.marketing.manage"])) throw new ForbiddenError(); }
function manage(ctx: Ctx) { if (ctx.company.type !== "ADMIN" || !can(ctx, "admin.marketing.manage")) throw new ForbiddenError(); }
const simulatingAi = () => process.env.ASSISTANT_SIMULATE === "1" && !process.env.ANTHROPIC_API_KEY && process.env.FIRINGI_ENV !== "production";

// ── CRUD ────────────────────────────────────────────────────────────────────

export type McInput = {
  title: string; subtitle?: string | null; intro?: string | null; locale: string; countryId: string;
  scope: McScope; scopeIds: string[]; filters: McFilters; items: McItem[]; layout: McLayout; options: McOptions;
};

function check(i: McInput) {
  if (!i.title.trim()) throw new ValidationError("Give the catalogue a title.");
  if (i.scope !== "ALL" && !i.scopeIds.length) throw new ValidationError(i.scope === "WHOLESALER" ? "Choose at least one wholesaler." : i.scope === "ZONE" ? "Choose at least one delivery zone." : "Choose at least one district.");
  if (!(MC_LAYOUTS as readonly string[]).includes(i.layout)) throw new ValidationError("Unknown layout.");
}

export async function listCatalogues(ctx: Ctx) {
  view(ctx);
  return prisma.marketingCatalogue.findMany({ where: { status: { not: "ARCHIVED" } }, orderBy: { updatedAt: "desc" }, take: 200 });
}
export async function getCatalogue(ctx: Ctx, id: string) {
  view(ctx);
  const c = await prisma.marketingCatalogue.findUnique({ where: { id } });
  if (!c) throw new NotFoundError("Catalogue");
  return c;
}

export async function createCatalogue(ctx: Ctx, i: McInput) {
  manage(ctx);
  if (!(await mcSettings()).enabled) throw new AppError("MC_OFF", "Marketing catalogues are switched off.");
  check(i);
  const c = await prisma.marketingCatalogue.create({ data: { ...data(i), shareToken: randomBytes(9).toString("base64url"), createdById: ctx.user.id } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "marketing.catalogue.created", entityType: "MarketingCatalogue", entityId: c.id, after: { title: c.title, scope: c.scope } });
  return c;
}
export async function updateCatalogue(ctx: Ctx, id: string, i: McInput) {
  manage(ctx);
  check(i);
  await getCatalogue(ctx, id);
  return prisma.marketingCatalogue.update({ where: { id }, data: data(i) });
}
function data(i: McInput) {
  return {
    title: i.title.trim().slice(0, 120), subtitle: i.subtitle?.trim().slice(0, 160) || null, intro: i.intro?.trim().slice(0, 1200) || null,
    locale: i.locale, countryId: i.countryId, scope: i.scope, scopeIds: i.scope === "ALL" ? [] : [...new Set(i.scopeIds)].slice(0, 100),
    filters: mergeFilters(i.filters) as Prisma.InputJsonValue, items: cleanItems(i.items) as unknown as Prisma.InputJsonValue,
    layout: i.layout, options: mergeOptions(i.options) as Prisma.InputJsonValue,
  };
}
export async function setStatus(ctx: Ctx, id: string, status: "DRAFT" | "PUBLISHED" | "ARCHIVED") {
  manage(ctx);
  const c = await getCatalogue(ctx, id);
  if (status === "PUBLISHED" && !c.uploadKey && !cleanItems(c.items).length) throw new ValidationError("Add products (or upload your own PDF) before publishing.");
  const r = await prisma.marketingCatalogue.update({ where: { id }, data: { status, publishedAt: status === "PUBLISHED" ? c.publishedAt ?? new Date() : c.publishedAt } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: `marketing.catalogue.${status.toLowerCase()}`, entityType: "MarketingCatalogue", entityId: id });
  return r;
}
export async function duplicateCatalogue(ctx: Ctx, id: string, patch: Partial<Pick<MarketingCatalogue, "title" | "subtitle" | "intro" | "locale">> & { items?: McItem[] } = {}) {
  manage(ctx);
  const c = await getCatalogue(ctx, id);
  return prisma.marketingCatalogue.create({
    data: {
      title: patch.title ?? `${c.title} (copy)`, subtitle: patch.subtitle ?? c.subtitle, intro: patch.intro ?? c.intro, locale: patch.locale ?? c.locale,
      countryId: c.countryId, scope: c.scope, scopeIds: c.scopeIds, filters: c.filters as Prisma.InputJsonValue,
      items: (patch.items ?? cleanItems(c.items)) as unknown as Prisma.InputJsonValue, layout: c.layout, options: c.options as Prisma.InputJsonValue,
      uploadKey: c.uploadKey, shareToken: randomBytes(9).toString("base64url"), createdById: ctx.user.id,
    },
  });
}
export async function setUpload(ctx: Ctx, id: string, key: string | null) {
  manage(ctx);
  await getCatalogue(ctx, id);
  return prisma.marketingCatalogue.update({ where: { id }, data: { uploadKey: key } });
}

// ── which wholesalers, which products ───────────────────────────────────────

/** The wholesalers a catalogue is for: chosen ones, or those serving the zones / districts (no service areas = everywhere). */
export async function scopeVendors(c: Pick<MarketingCatalogue, "countryId" | "scope" | "scopeIds">): Promise<string[]> {
  const base = { type: { in: ["WHOLESALER", "DISTRIBUTOR"] as ("WHOLESALER" | "DISTRIBUTOR")[] }, status: "APPROVED" as const, countryId: c.countryId };
  if (c.scope === "WHOLESALER") return (await prisma.company.findMany({ where: { ...base, id: { in: c.scopeIds } }, select: { id: true } })).map((x) => x.id);
  const all = await prisma.company.findMany({ where: { ...base, type: "WHOLESALER" }, select: { id: true, serviceAreas: { where: { isActive: true }, select: { type: true, countryId: true, regionId: true, cityId: true, zoneId: true } } } });
  if (c.scope === "ALL") return all.map((x) => x.id);
  const cities = c.scope === "DISTRICT" ? new Set((await prisma.city.findMany({ where: { regionId: { in: c.scopeIds } }, select: { id: true } })).map((x) => x.id)) : new Set<string>();
  const ids = new Set(c.scopeIds);
  return all.filter((v) => !v.serviceAreas.length || v.serviceAreas.some((a) =>
    a.type === "COUNTRY" && a.countryId === c.countryId
    || (c.scope === "ZONE" && a.type === "ZONE" && a.zoneId && ids.has(a.zoneId))
    || (c.scope === "DISTRICT" && ((a.type === "REGION" && a.regionId && ids.has(a.regionId)) || (a.type === "CITY" && a.cityId && cities.has(a.cityId)))),
  )).map((v) => v.id);
}

const offerInclude = {
  vendor: { select: { id: true, legalName: true, tradeName: true } },
  packaging: { include: { variant: { include: { product: { include: { brand: { select: { name: true } }, category: { select: { id: true, name: true } } } } } } } },
} satisfies Prisma.VendorOfferInclude;
type OfferRow = Prisma.VendorOfferGetPayload<{ include: typeof offerInclude }>;

function liveOfferWhere(countryId: string, vendorIds: string[]): Prisma.VendorOfferWhereInput {
  return {
    status: "ACTIVE", countryId, vendorCompanyId: { in: vendorIds },
    packaging: { isActive: true, variant: { isActive: true, product: { status: "APPROVED", OR: [{ restriction: null }, { restriction: { not: "TOBACCO" } }] } } },
  };
}

/** Base (list) prices excl. VAT, one per offer (minimum quantity 1). */
async function basePrices(offerIds: string[]) {
  const now = new Date();
  const rows = await prisma.priceListItem.findMany({
    where: { offerId: { in: offerIds }, minQty: 1, priceList: { scope: "BASE", isActive: true, validFrom: { lte: now }, OR: [{ validTo: null }, { validTo: { gt: now } }] } },
    select: { offerId: true, unitPriceNet: true, priceList: { select: { priority: true } } },
    orderBy: { priceList: { priority: "desc" } },
  });
  const out = new Map<string, Decimal>();
  for (const r of rows) if (!out.has(r.offerId)) out.set(r.offerId, new Decimal(r.unitPriceNet.toString()));
  return out;
}

/** VAT % per tax category in the catalogue's country (mainland). */
async function vatRates(countryId: string, taxCategoryIds: string[]) {
  const now = new Date();
  const rows = await prisma.taxRate.findMany({ where: { countryId, regionId: null, taxCategoryId: { in: taxCategoryIds }, validFrom: { lte: now }, OR: [{ validTo: null }, { validTo: { gt: now } }] }, orderBy: { validFrom: "desc" } });
  const out = new Map<string, Decimal>();
  for (const r of rows) if (!out.has(r.taxCategoryId)) out.set(r.taxCategoryId, new Decimal(r.rate.toString()));
  return out;
}

/**
 * Candidate products for the catalogue's scope and filters, best sellers first: one per pack (the lowest list price
 * when several wholesalers sell the same pack).
 */
export async function candidates(c: Pick<MarketingCatalogue, "countryId" | "scope" | "scopeIds" | "filters">, limit = 300) {
  const f = mergeFilters(c.filters as McFilters);
  const vendors = await scopeVendors(c);
  if (!vendors.length) return [];
  const where: Prisma.VendorOfferWhereInput = { AND: [liveOfferWhere(c.countryId, vendors)] };
  const and = where.AND as Prisma.VendorOfferWhereInput[];
  if (f.categoryIds?.length) and.push({ OR: f.categoryIds.map((id) => ({ packaging: { variant: { product: { category: { path: { contains: id } } } } } })) });
  if (f.brandIds?.length) and.push({ packaging: { variant: { product: { brandId: { in: f.brandIds } } } } });
  if (f.withImages) and.push({ packaging: { variant: { product: { images: { isEmpty: false } } } } });
  if (f.q) { const { productQueryWhere } = await import("@/server/data/catalogue-buyer"); and.push(productQueryWhere(f.q)); }
  const rows = await prisma.vendorOffer.findMany({ where, include: offerInclude, take: 2000 });
  const prices = await basePrices(rows.map((r) => r.id));
  const since = new Date(Date.now() - 90 * 86_400_000);
  const sold = f.bestSellers !== false && rows.length
    ? new Map((await prisma.orderLine.groupBy({ by: ["offerId"], where: { offerId: { in: rows.map((r) => r.id) }, order: { placedAt: { gte: since }, status: { not: "CANCELLED" } } }, _sum: { qtyOrdered: true } })).map((g) => [g.offerId, g._sum.qtyOrdered ?? 0]))
    : new Map<string, number>();
  // one per pack: the lowest price
  const best = new Map<string, OfferRow>();
  for (const r of rows) {
    if (!prices.has(r.id)) continue;
    const cur = best.get(r.packagingUnitId);
    if (!cur || prices.get(r.id)!.lt(prices.get(cur.id)!)) best.set(r.packagingUnitId, r);
  }
  const bySales = (o: OfferRow) => [...rows].filter((x) => x.packagingUnitId === o.packagingUnitId).reduce((a, x) => a + (sold.get(x.id) ?? 0), 0);
  return [...best.values()].map((o) => ({ o, sold: bySales(o), price: prices.get(o.id)! }))
    .sort((a, b) => b.sold - a.sold || pickLocalized(a.o.packaging.variant.product.name, "en").localeCompare(pickLocalized(b.o.packaging.variant.product.name, "en")))
    .slice(0, limit);
}

/** Fill the catalogue by the filters (no AI): the best sellers, grouped by category. */
export async function fillByFilters(ctx: Ctx, id: string) {
  manage(ctx);
  const c = await getCatalogue(ctx, id);
  const f = mergeFilters(c.filters as McFilters);
  const list = (await candidates(c)).slice(0, f.max ?? 24);
  const byCat = new Map<string, typeof list>();
  for (const x of list) { const k = x.o.packaging.variant.product.category.id; byCat.set(k, [...(byCat.get(k) ?? []), x]); }
  const items: McItem[] = [];
  for (const group of byCat.values()) group.forEach((x, k) => items.push({ offerId: x.o.id, section: k === 0 ? pickLocalized(x.o.packaging.variant.product.category.name, c.locale) : null }));
  return prisma.marketingCatalogue.update({ where: { id }, data: { items: items as unknown as Prisma.InputJsonValue } });
}

// ── the AI ──────────────────────────────────────────────────────────────────

export async function mcAiReady() {
  const s = await mcSettings();
  const governed = (await (await import("@/server/ai/ops/governance")).governance()).enabled;
  return s.enabled && s.ai && governed && (!!aiTransport() || simulatingAi());
}

const PICK_TOOL = {
  name: "build_catalogue",
  description: "Build the marketing catalogue: pick products (offer ids from the list only), group them into sections, write the texts.",
  input_schema: {
    type: "object" as const,
    properties: {
      title: { type: "string", description: "Catalogue title, short and catchy, in the catalogue's language." },
      subtitle: { type: "string", description: "One line under the title." },
      intro: { type: "string", description: "Two or three sentences for the cover, for wholesale buyers (restaurants, cafés, shops)." },
      sections: { type: "array", items: { type: "object", properties: { title: { type: "string" }, offerIds: { type: "array", items: { type: "string" } } }, required: ["title", "offerIds"] }, description: "Sections in order, each with its products (ids from the list)." },
    },
    required: ["title", "subtitle", "intro", "sections"],
  },
};

/** The AI picks products from the scope for a brief ("summer drinks for cafés, 30 products") and writes the texts. */
export async function aiBuild(ctx: Ctx, id: string, brief: string) {
  manage(ctx);
  if (!(await mcAiReady())) throw new AppError("AI_OFF", "AI isn't available for catalogues — pick the products with the filters instead.");
  const c = await getCatalogue(ctx, id);
  const list = await candidates(c, 250);
  if (!list.length) throw new ValidationError("No products for this scope — choose other wholesalers, zones or districts.");
  const want = Math.min(200, Math.max(1, Number(brief.match(/\b(\d{1,3})\s*(products|produtos|items|artigos)?\b/i)?.[1] ?? mergeFilters(c.filters as McFilters).max ?? 24)));
  const lang = c.locale;
  let parsed: AiCatalogue;
  const transport = aiTransport();
  if (!transport) {
    if (!simulatingAi()) throw new AppError("AI_NOT_CONFIGURED", "No AI is connected.");
    // simulated: best sellers matching the brief's words, grouped by category
    const words = brief.toLowerCase().split(/[^\p{L}\d]+/u).filter((w) => w.length > 3);
    const hit = (x: (typeof list)[number]) => words.some((w) => JSON.stringify(x.o.packaging.variant.product.name).toLowerCase().includes(w) || JSON.stringify(x.o.packaging.variant.product.category.name).toLowerCase().includes(w));
    const chosen = [...list.filter(hit), ...list.filter((x) => !hit(x))].slice(0, want);
    const byCat = new Map<string, string[]>();
    for (const x of chosen) { const k = pickLocalized(x.o.packaging.variant.product.category.name, lang); byCat.set(k, [...(byCat.get(k) ?? []), x.o.id]); }
    parsed = { title: brief.slice(0, 60) || "FIRINGI", subtitle: "Simulated AI", intro: `Selected for you: ${chosen.length} products.`, sections: [...byCat.entries()].map(([title, offerIds]) => ({ title, offerIds })) };
  } else {
    const settings = await aiSettings();
    const lines = list.map((x) => {
      const p = x.o.packaging.variant.product;
      return `${x.o.id} | ${pickLocalized(p.name, lang)} | ${p.brand?.name ?? ""} | ${pickLocalized(x.o.packaging.name, lang)} | ${pickLocalized(p.category.name, "en")} | €${x.price.toFixed(2)} | sold90d ${x.sold}`;
    }).join("\n");
    const res = await Promise.race([
      transport({
        model: settings.model, max_tokens: 4000,
        system: `You build marketing catalogues for FIRINGI, a B2B wholesale marketplace (restaurants, cafés, hotels and shops buy by the case). Pick about ${want} products from the list that fit the brief — use ONLY ids from the list — group them into a few sections that make sense, and write the title, subtitle and intro in the catalogue language (${lang}). No prices or claims that aren't in the data.`,
        tools: [PICK_TOOL as unknown as Anthropic.Beta.Messages.BetaTool],
        tool_choice: { type: "tool", name: PICK_TOOL.name },
        messages: [{ role: "user", content: `Brief: ${brief}\n\nProducts (id | name | brand | pack | category | list price excl. VAT | units sold in 90 days):\n${lines}` }],
      }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new AppError("AI_TIMEOUT", "The AI took too long — try again.")), 45_000)),
    ]);
    const call = res.content.find((b) => b.type === "tool_use" && b.name === PICK_TOOL.name) as { input: unknown } | undefined;
    const p = AiCatalogue.safeParse(call?.input);
    if (!p.success) throw new AppError("AI_FAILED", "The AI couldn't build the catalogue — try another brief.");
    parsed = p.data;
    await logAi({ kind: "CATALOGUE", ctx, summary: `Marketing catalogue: ${brief.slice(0, 200)}`, detail: { id, products: parsed.sections.reduce((a, s) => a + s.offerIds.length, 0) }, model: settings.model, tokensIn: res.usage?.input_tokens, tokensOut: res.usage?.output_tokens }).catch(() => null);
  }
  const valid = new Set(list.map((x) => x.o.id));
  const items: McItem[] = [];
  for (const s of parsed.sections) s.offerIds.filter((o) => valid.has(o)).forEach((o, k) => items.push({ offerId: o, section: k === 0 ? s.title || null : null }));
  const clean = cleanItems(items);
  if (!clean.length) throw new AppError("AI_FAILED", "The AI didn't pick any product from the list — try another brief.");
  return prisma.marketingCatalogue.update({ where: { id }, data: { items: clean as unknown as Prisma.InputJsonValue, title: parsed.title, subtitle: parsed.subtitle || null, intro: parsed.intro || null, aiPrompt: brief.slice(0, 1000) } });
}

/** A copy of the catalogue in another language: the AI translates FIRINGI's texts (product names come from the catalogue). */
export async function translateCatalogue(ctx: Ctx, id: string, locale: string) {
  manage(ctx);
  const c = await getCatalogue(ctx, id);
  const items = cleanItems(c.items);
  const sections = items.map((i) => i.section).filter((s): s is string => !!s);
  let t = { title: c.title, subtitle: c.subtitle ?? "", intro: c.intro ?? "", sections };
  const transport = aiTransport();
  if (transport && (await mcAiReady())) {
    const settings = await aiSettings();
    const res = await transport({
      model: settings.model, max_tokens: 1500,
      system: `Translate these marketing catalogue texts for a B2B wholesale marketplace into ${locale}. Keep "FIRINGI" as is. Return the same number of section titles in the same order.`,
      tools: [{ name: "translation", description: "The translated texts.", input_schema: { type: "object", properties: { title: { type: "string" }, subtitle: { type: "string" }, intro: { type: "string" }, sections: { type: "array", items: { type: "string" } } }, required: ["title", "subtitle", "intro", "sections"] } } as unknown as Anthropic.Beta.Messages.BetaTool],
      tool_choice: { type: "tool", name: "translation" },
      messages: [{ role: "user", content: JSON.stringify(t) }],
    });
    const call = res.content.find((b) => b.type === "tool_use") as { input: unknown } | undefined;
    const p = AiTranslation.safeParse(call?.input);
    if (p.success && p.data.sections.length === sections.length) t = p.data;
  } else if (!simulatingAi()) throw new AppError("AI_OFF", "AI isn't available — duplicate the catalogue and translate the texts yourself.");
  let k = 0;
  const newItems = items.map((i) => (i.section ? { ...i, section: t.sections[k++] ?? i.section } : i));
  return duplicateCatalogue(ctx, id, { title: t.title, subtitle: t.subtitle || null, intro: t.intro || null, locale, items: newItems });
}

// ── what the catalogue shows ────────────────────────────────────────────────

export type McEntry = {
  offerId: string; productId: string; section: string | null; name: string; brand: string | null; pack: string; unitsPerPack: number;
  gtin: string | null; unitGtin: string | null; minQty: number; step: number; supplier: string | null;
  /** the barcode as scannable bars (EAN-13 / EAN-8 / UPC; pack's, else the single item's), when drawable */
  bars: { modules: string; digits: string } | null;
  /** a QR code to the product in the shop */
  qr: boolean;
  priceNet: string | null; priceGross: string | null; vatRate: string | null; imageKey: string | null;
};

/**
 * Every product gets at least one code to scan: the barcode when it is on (or when the QR is off), the QR when it is
 * on (or when the product has no barcode that can be drawn).
 */
export function codes(o: Pick<McOptions, "barcode" | "qr">, bars: { modules: string; digits: string } | null) {
  const showBars = !!bars && (o.barcode || !o.qr);
  return { bars: showBars ? bars : null, qr: o.qr || !showBars };
}

/** The catalogue's products as they print / show: only those still sold, with the options FIRINGI chose. */
export async function catalogueEntries(c: MarketingCatalogue): Promise<McEntry[]> {
  const items = cleanItems(c.items);
  if (!items.length) return [];
  const o = mergeOptions(c.options as McOptions);
  const vendors = await scopeVendors(c);
  const rows = await prisma.vendorOffer.findMany({ where: { AND: [{ id: { in: items.map((i) => i.offerId) } }, liveOfferWhere(c.countryId, vendors)] }, include: offerInclude });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const [prices, rates] = await Promise.all([basePrices(rows.map((r) => r.id)), vatRates(c.countryId, [...new Set(rows.map((r) => r.packaging.variant.product.taxCategoryId))])]);
  const areas = o.supplier === "AREA" ? await (await import("@/server/catalogue/cart-help")).supplierAreas() : null;
  let section: string | null = null;
  const out: McEntry[] = [];
  for (const i of items) {
    const r = byId.get(i.offerId);
    if (i.section) section = i.section;
    if (!r) continue;
    const p = r.packaging.variant.product;
    const net = prices.get(r.id) ?? null;
    const rate = rates.get(p.taxCategoryId) ?? null;
    out.push({
      offerId: r.id, productId: p.id, section: i.section ?? (out.length && out[out.length - 1].section === section ? null : section),
      name: pickLocalized(p.name, c.locale), brand: p.brand?.name ?? null, pack: pickLocalized(r.packaging.name, c.locale), unitsPerPack: r.packaging.unitsPerPack,
      gtin: o.barcode ? r.packaging.gtin ?? (r.packaging.unitsPerPack === 1 ? r.packaging.variant.gtin : null) : null,
      unitGtin: o.barcode ? r.packaging.variant.gtin : null,
      ...codes(o, printableBarcode(r.packaging.gtin, r.packaging.variant.gtin)),
      minQty: r.minOrderQty, step: r.qtyStep,
      supplier: o.supplier === "NAME" ? r.vendor.tradeName ?? r.vendor.legalName : o.supplier === "AREA" ? areas!.get(r.vendor.id) ?? "FIRINGI" : null,
      priceNet: o.price !== "NONE" && net ? net.toFixed(2) : null,
      priceGross: o.price !== "NONE" && net && rate ? net.mul(rate.div(100).plus(1)).toDecimalPlaces(2).toFixed(2) : null,
      vatRate: rate ? rate.toString() : null, imageKey: p.images[0] ?? null,
    });
  }
  return out;
}

/** Public: a published catalogue by its share link (counts the view). */
export async function publicCatalogue(token: string, countView = true) {
  if (!/^[A-Za-z0-9_-]{8,30}$/.test(token)) return null;
  const c = await prisma.marketingCatalogue.findUnique({ where: { shareToken: token } });
  if (!c || c.status !== "PUBLISHED" || !(await mcSettings()).enabled) return null;
  if (countView) await prisma.marketingCatalogue.update({ where: { id: c.id }, data: { views: { increment: 1 } } }).catch(() => null);
  return c;
}

/** A product photo shown in a published catalogue (public), or to FIRINGI staff while editing. */
export async function catalogueImageKey(token: string, productId: string, staff: Ctx | null) {
  const c = await prisma.marketingCatalogue.findUnique({ where: { shareToken: token } });
  if (!c) return null;
  const ok = c.status === "PUBLISHED" || (staff?.company.type === "ADMIN" && can(staff, ["admin.marketing.view", "admin.marketing.manage"]));
  if (!ok) return null;
  const entries = await catalogueEntries(c);
  return entries.find((e) => e.productId === productId)?.imageKey ?? null;
}

// ── sending ─────────────────────────────────────────────────────────────────

/** Customers (and wholesalers) in the catalogue's scope: by delivery address in the zones / districts, or buying from the wholesalers. */
export async function scopeCustomers(c: Pick<MarketingCatalogue, "countryId" | "scope" | "scopeIds">) {
  const types = ["CUSTOMER", "WHOLESALER"] as ("CUSTOMER" | "WHOLESALER")[];
  const base = { type: { in: types }, status: "APPROVED" as const, countryId: c.countryId };
  if (c.scope === "ALL") return (await prisma.company.findMany({ where: base, select: { id: true } })).map((x) => x.id);
  if (c.scope === "WHOLESALER") {
    const since = new Date(Date.now() - 365 * 86_400_000);
    const [bought, linked] = await Promise.all([
      prisma.order.findMany({ where: { sellerCompanyId: { in: c.scopeIds }, placedAt: { gte: since } }, distinct: ["buyerCompanyId"], select: { buyerCompanyId: true } }),
      prisma.storefrontLink.findMany({ where: { storeCompanyId: { in: c.scopeIds } }, select: { buyerCompanyId: true } }),
    ]);
    return [...new Set([...bought.map((b) => b.buyerCompanyId), ...linked.map((l) => l.buyerCompanyId)])];
  }
  if (c.scope === "DISTRICT") {
    const rows = await prisma.address.findMany({ where: { isActive: true, kind: { in: ["DELIVERY", "HEAD_OFFICE"] }, city: { regionId: { in: c.scopeIds } }, company: base }, distinct: ["companyId"], select: { companyId: true } });
    return rows.map((r) => r.companyId);
  }
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT DISTINCT a."companyId" AS id FROM "Address" a
    JOIN "Company" co ON co.id = a."companyId" AND co.type IN ('CUSTOMER','WHOLESALER') AND co.status = 'APPROVED' AND co."countryId" = ${c.countryId}
    JOIN "DeliveryZone" z ON z.id IN (${Prisma.join(c.scopeIds)}) AND z."isActive"
    WHERE a."isActive" AND a.kind IN ('DELIVERY','HEAD_OFFICE') AND (
      (z.area IS NOT NULL AND a.geo IS NOT NULL AND postgis.ST_Covers(z.area, a.geo))
      OR EXISTS (SELECT 1 FROM unnest(z."postalCodePatterns") p WHERE upper(a."postalCode") LIKE replace(replace(replace(upper(p), '%', '\\%'), '_', '\\_'), '*', '%')))`;
  return rows.map((r) => r.id);
}

/** A campaign draft (email + in-app) with the share link, for the customers in the scope — FIRINGI checks and sends it. */
export async function campaignFor(ctx: Ctx, id: string) {
  manage(ctx);
  const c = await getCatalogue(ctx, id);
  if (c.status !== "PUBLISHED") throw new ValidationError("Publish the catalogue first.");
  const companyIds = await scopeCustomers(c);
  if (!companyIds.length) throw new ValidationError("No customers in this scope yet.");
  const { saveCampaign } = await import("@/server/marketing/campaigns");
  const lang = c.locale.slice(0, 2);
  const subject = { en: c.title, ...(lang !== "en" ? { [c.locale]: c.title, [lang]: c.title } : {}) };
  const text = c.intro || c.subtitle || c.title;
  const body = { en: text, ...(lang !== "en" ? { [c.locale]: text, [lang]: text } : {}) };
  const camp = await saveCampaign(ctx, null, {
    name: `Catalogue: ${c.title}`.slice(0, 120), channels: ["EMAIL", "IN_APP"], audience: { companyIds: companyIds.slice(0, 5000) },
    subject, body, ctaLabel: { en: "Open the catalogue", pt: "Abrir o catálogo" }, ctaPath: `/c/${c.shareToken}`,
  });
  await prisma.marketingCatalogue.update({ where: { id }, data: { campaignId: (camp as { id: string }).id } });
  return { campaignId: (camp as { id: string }).id, customers: companyIds.length };
}

// ── FIRINGI's page lists ────────────────────────────────────────────────────

/** The country a new catalogue starts in (Portugal, else FIRINGI's own). */
export async function defaultCountryId(ctx: Ctx) {
  view(ctx);
  return (await prisma.country.findFirst({ where: { code: "PT" }, select: { id: true } }))?.id ?? ctx.company.countryId;
}

export async function editorLists(ctx: Ctx, countryId: string) {
  view(ctx);
  const [countries, wholesalers, zones, regions, categories, brands] = await Promise.all([
    prisma.country.findMany({ where: { isActive: true, isSchengen: true }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } }),
    prisma.company.findMany({ where: { type: { in: ["WHOLESALER", "DISTRIBUTOR"] }, status: "APPROVED", countryId }, select: { id: true, legalName: true, tradeName: true, type: true }, orderBy: { legalName: "asc" } }),
    prisma.deliveryZone.findMany({ where: { isActive: true, countryId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.region.findMany({ where: { isActive: true, countryId }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } }),
    prisma.category.findMany({ where: { isActive: true }, select: { id: true, name: true, depth: true, path: true }, orderBy: { path: "asc" } }),
    prisma.brand.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const L = (n: unknown) => pickLocalized(n, "en");
  return {
    countries: countries.map((c) => ({ id: c.id, label: `${c.code} — ${L(c.name)}` })),
    wholesalers: wholesalers.map((w) => ({ id: w.id, label: `${w.tradeName ?? w.legalName} (${w.type.toLowerCase()})` })),
    zones: zones.map((z) => ({ id: z.id, label: z.name })),
    regions: regions.map((r) => ({ id: r.id, label: `${L(r.name)} (${r.code})` })),
    categories: categories.map((c) => ({ id: c.id, label: `${"— ".repeat(c.depth)}${L(c.name)}` })),
    brands: brands.map((b) => ({ id: b.id, label: b.name })),
  };
}

// ── PDF ─────────────────────────────────────────────────────────────────────

/** The PDF: FIRINGI's own upload, or the catalogue rendered (photos shrunk, QR codes, the labels in its language). */
export async function cataloguePdf(c: MarketingCatalogue): Promise<Buffer> {
  const { readStored, sniffMime } = await import("@/server/services/storage");
  if (c.uploadKey) return readStored(c.uploadKey);
  const entries = await catalogueEntries(c);
  // photos the PDF can show (JPG / PNG; others get the FIRINGI placeholder)
  const images = new Map<string, Buffer>();
  await Promise.all([...new Map(entries.filter((e) => e.imageKey).map((e) => [e.productId, e.imageKey!])).entries()].map(async ([pid, key]) => {
    try { const b = await readStored(key); if (["image/jpeg", "image/png"].includes(sniffMime(b) ?? "")) images.set(pid, b); } catch { /* no photo */ }
  }));
  // the labels in the catalogue's language (English for anything missing)
  const load = async (l: string) => ((await import(`@/messages/${l}.json`).catch(() => ({ default: {} }))).default as { mktCatalogue?: Record<string, string> }).mktCatalogue ?? {};
  const [mine, en] = await Promise.all([load(c.locale), load("en")]);
  const o = mergeOptions(c.options as McOptions);
  const keys = ["priceNet", "priceGross", "minOrder", "barcode", "unitBarcode", "scan", "page", "soldBy"] as const;
  const raw = (k: string) => mine[k] ?? en[k] ?? k;
  const l = { ...Object.fromEntries(keys.map((k) => [k, raw(k)])), pricesNote: raw(o.price === "GROSS" ? "pricesNoteGross" : "pricesNoteNet") } as import("@/server/pdf/marketing-catalogue").McPdfLabels;
  const nf = new Intl.NumberFormat(c.locale, { style: "currency", currency: "EUR" });
  const { appUrl } = await import("@/server/notify/dispatch");
  const { renderMarketingCatalogue } = await import("@/server/pdf/marketing-catalogue");
  return renderMarketingCatalogue({ title: c.title, subtitle: c.subtitle, intro: c.intro, locale: c.locale, layout: (MC_LAYOUTS as readonly string[]).includes(c.layout) ? (c.layout as McLayout) : "GRID6", options: o, entries, images, baseUrl: appUrl(), l, money: (x) => nf.format(Number(x)) });
}
export const pdfName = (c: Pick<MarketingCatalogue, "title">) => `${c.title.replace(/[^\p{L}\d]+/gu, "-").replace(/^-|-$/g, "").slice(0, 60) || "catalogue"}.pdf`;
