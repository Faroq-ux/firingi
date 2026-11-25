import "server-only";
/**
 * Shelf price labels for shops (customers and wholesalers that sell over the counter): products they bought on
 * FIRINGI or items of their FIRINGI till, a selling price per item (by hand, or a margin on today's cost — a case
 * price is split per item), a promo, the unit price (€/kg, €/L), the barcode printed on the product itself (so their
 * till scans it and customers aren't confused) or a QR, brand and origin where FIRINGI allows, and PDFs for A4 sheets,
 * shelf-edge strips and label-printer rolls. "To print" lists labels whose price changed since they were printed;
 * labels priced by margin offer the new price when the cost changes. Setting "shelfLabels.settings".
 */
import type { Prisma, ShelfLabel } from "@prisma/client";
import Decimal from "decimal.js";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";
import { pickLocalized } from "@/i18n/config";
import {
  LABEL_FORMATS, allowedFields, contentFromName, marginOf, mergeSl, needsPrint, priceFromMargin, slOn,
  type LabelFields, type LabelFormat, type Rounding, type ShelfLabelSettings,
} from "@/lib/shelf-labels";

const KEY = "shelfLabels.settings";
const VIEW = ["buyer.catalogue.view", "buyer.orders.place", "company.pos.manage", "company.pos.sell"] as const;
const MANAGE = ["buyer.orders.place", "company.pos.manage"] as const;

export async function slSettings(): Promise<ShelfLabelSettings> {
  return mergeSl((await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: KEY } }))?.value as Partial<ShelfLabelSettings> | null);
}
export async function saveSlSettings(ctx: Ctx, input: Partial<ShelfLabelSettings>) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, ["admin.settings.manage", "admin.catalogue.manage"])) throw new ForbiddenError();
  const before = await slSettings();
  const next = mergeSl({ ...before, ...input, companies: input.companies ?? before.companies });
  await prisma.setting.upsert({ where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key: KEY } }, update: { value: next as unknown as Prisma.InputJsonValue, updatedById: ctx.user.id }, create: { scope: "GLOBAL", key: KEY, value: next as unknown as Prisma.InputJsonValue, updatedById: ctx.user.id } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: KEY, entityType: "Setting", entityId: KEY, before: before as unknown as Prisma.InputJsonValue, after: next as unknown as Prisma.InputJsonValue });
  return next;
}
export async function setCompanySl(ctx: Ctx, companyId: string, value: "ON" | "OFF" | null) {
  const s = await slSettings();
  const companies = { ...s.companies };
  if (value) companies[companyId] = value; else delete companies[companyId];
  return saveSlSettings(ctx, { companies });
}

/** May this shop use shelf labels, and what may it put on them? */
export async function slAccess(ctx: Ctx) {
  const s = await slSettings();
  const on = slOn(s, { id: ctx.company.id, type: ctx.company.type, countryCode: ctx.company.countryCode }) && can(ctx, [...VIEW]);
  return { on, manage: on && can(ctx, [...MANAGE]), settings: s };
}
async function need(ctx: Ctx, manage = false) {
  const a = await slAccess(ctx);
  if (!a.on || (manage && !a.manage)) throw new ForbiddenError();
  return a;
}

// ── today's cost per item ───────────────────────────────────────────────────

/** Today's cost per single item (excl. VAT) of offers for this shop: the pack price ÷ items in the pack. */
async function costs(ctx: Ctx, offerIds: string[]) {
  if (!offerIds.length) return new Map<string, { costNet: Decimal; vatRate: Decimal }>();
  const { pricedOffers } = await import("@/server/data/catalogue-buyer");
  const { items } = await pricedOffers(ctx, offerIds.map((offerId) => ({ offerId, qty: 1 })));
  return new Map(items.filter((i) => i.price).map((i) => [i.offerId, { costNet: new Decimal(i.price!.unitPriceNet).div(Math.max(1, i.packaging.unitsPerPack)).toDecimalPlaces(4), vatRate: new Decimal(i.vatRate) }]));
}

// ── what can be labelled ────────────────────────────────────────────────────

/** Products the shop bought on FIRINGI (last 12 months) and till items, not labelled yet. */
export async function labelCandidates(ctx: Ctx, locale: string) {
  await need(ctx);
  const since = new Date(Date.now() - 365 * 86_400_000);
  const [lines, labelled, pos] = await Promise.all([
    prisma.orderLine.groupBy({ by: ["offerId"], where: { order: { buyerCompanyId: ctx.company.id, placedAt: { gte: since }, status: { not: "CANCELLED" } } }, _count: { _all: true }, orderBy: { _count: { offerId: "desc" } }, take: 300 }),
    prisma.shelfLabel.findMany({ where: { companyId: ctx.company.id }, select: { offerId: true, posItemId: true } }),
    can(ctx, ["company.pos.manage", "company.pos.sell"]) ? prisma.posItem.findMany({ where: { companyId: ctx.company.id, active: true }, select: { id: true, name: true, barcode: true, price: true }, orderBy: { name: "asc" } }) : Promise.resolve([]),
  ]);
  const done = new Set(labelled.map((l) => l.offerId ?? `pos:${l.posItemId}`));
  const offerIds = lines.map((l) => l.offerId).filter((id) => !done.has(id));
  const offers = offerIds.length ? await prisma.vendorOffer.findMany({ where: { id: { in: offerIds } }, select: { id: true, packaging: { select: { name: true, unitsPerPack: true, variant: { select: { gtin: true, product: { select: { name: true, brand: { select: { name: true } } } } } } } } } }) : [];
  const cost = await costs(ctx, offerIds);
  const byId = new Map(offers.map((o) => [o.id, o]));
  return {
    purchases: offerIds.filter((id) => byId.has(id)).map((id) => {
      const o = byId.get(id)!;
      const c = cost.get(id);
      return { offerId: id, name: pickLocalized(o.packaging.variant.product.name, locale), pack: pickLocalized(o.packaging.name, locale), brand: o.packaging.variant.product.brand?.name ?? null, barcode: o.packaging.variant.gtin, costNet: c ? c.costNet.toFixed(4) : null, times: lines.find((l) => l.offerId === id)?._count._all ?? 0 };
    }),
    till: pos.filter((p) => !done.has(`pos:${p.id}`)).map((p) => ({ posItemId: p.id, name: p.name, barcode: p.barcode, priceGross: p.price.toFixed(2) })),
  };
}

/** Add products bought on FIRINGI: price = today's cost per item × (1 + margin) incl. VAT. */
export async function addFromPurchases(ctx: Ctx, offerIds: string[], marginPct: number, rounding: Rounding, locale: string) {
  await need(ctx, true);
  if (!offerIds.length) throw new ValidationError("Choose at least one product.");
  if (!(marginPct >= 0 && marginPct <= 500)) throw new ValidationError("Margin between 0 and 500%.");
  const cost = await costs(ctx, offerIds);
  const offers = await prisma.vendorOffer.findMany({ where: { id: { in: offerIds } }, select: { id: true, packaging: { select: { variant: { select: { gtin: true, product: { select: { id: true, name: true, originCountryCode: true, brand: { select: { name: true } } } } } } } } } });
  let added = 0;
  for (const o of offers) {
    const c = cost.get(o.id);
    if (!c) continue; // no longer sold to this shop
    const p = o.packaging.variant.product;
    const name = pickLocalized(p.name, locale);
    const size = contentFromName(name);
    await prisma.shelfLabel.upsert({
      where: { companyId_offerId: { companyId: ctx.company.id, offerId: o.id } },
      update: {},
      create: {
        companyId: ctx.company.id, offerId: o.id, productId: p.id, name, barcode: o.packaging.variant.gtin, brand: p.brand?.name ?? null, originCountryCode: p.originCountryCode,
        vatRate: c.vatRate.toFixed(2), priceGross: priceFromMargin(c.costNet, marginPct, c.vatRate, rounding).toFixed(2), marginPct: marginPct.toFixed(2),
        content: size?.content ?? null, contentUnit: size?.unit ?? null,
      },
    });
    added++;
  }
  return { added };
}

/** Add till items (their till price and barcode). */
export async function addFromTill(ctx: Ctx, posItemIds: string[]) {
  await need(ctx, true);
  const items = await prisma.posItem.findMany({ where: { id: { in: posItemIds }, companyId: ctx.company.id } });
  for (const i of items) {
    const size = contentFromName(i.name);
    await prisma.shelfLabel.upsert({
      where: { companyId_posItemId: { companyId: ctx.company.id, posItemId: i.id } },
      update: {},
      create: { companyId: ctx.company.id, posItemId: i.id, name: i.name, barcode: i.barcode, vatRate: i.vatRate, priceGross: i.price.toDecimalPlaces(2).toFixed(2), content: size?.content ?? (i.byWeight ? 1 : null), contentUnit: size?.unit ?? (i.byWeight ? "KG" : null) },
    });
  }
  return { added: items.length };
}

// ── the list ────────────────────────────────────────────────────────────────

/** The shop's labels: today's cost, the margin price now (when priced by margin), and whether to print again. */
export async function listLabels(ctx: Ctx) {
  const a = await need(ctx);
  const labels = await prisma.shelfLabel.findMany({ where: { companyId: ctx.company.id }, orderBy: { name: "asc" } });
  const cost = await costs(ctx, labels.map((l) => l.offerId).filter((x): x is string => !!x));
  return {
    access: a,
    labels: labels.map((l) => {
      const c = l.offerId ? cost.get(l.offerId) : null;
      const marginPrice = c && l.marginPct != null ? priceFromMargin(c.costNet, l.marginPct.toString(), l.vatRate.toString()) : null;
      return {
        ...l,
        costNet: c ? c.costNet.toFixed(4) : null,
        margin: c ? marginOf(l.priceGross.toString(), c.costNet, l.vatRate.toString())?.toString() ?? null : null,
        /** priced by margin and the cost changed: the price the margin gives now */
        newPrice: marginPrice && !marginPrice.eq(l.priceGross.toString()) ? marginPrice.toFixed(2) : null,
        toPrint: needsPrint({ ...l, priceGross: l.priceGross.toString(), promoPrice: l.promoPrice?.toString() ?? null, printedPrice: l.printedPrice?.toString() ?? null, printedPromo: l.printedPromo?.toString() ?? null }),
      };
    }),
  };
}

export type LabelEdit = {
  name?: string; barcode?: string | null; brand?: string | null; originCountryCode?: string | null;
  priceGross?: number; marginPct?: number | null; promoPrice?: number | null; promoUntil?: Date | null;
  content?: number | null; contentUnit?: "KG" | "L" | "UNIT" | null; syncTill?: boolean;
};
export async function updateLabel(ctx: Ctx, id: string, e: LabelEdit) {
  const a = await need(ctx, true);
  const l = await prisma.shelfLabel.findFirst({ where: { id, companyId: ctx.company.id } });
  if (!l) throw new NotFoundError("Label");
  if (e.barcode && !/^\d{8,14}$/.test(e.barcode)) throw new ValidationError("A barcode has 8 to 14 digits.");
  if (e.priceGross != null && !(e.priceGross > 0)) throw new ValidationError("Enter a price above 0.");
  if (e.promoPrice != null && !(e.promoPrice > 0)) throw new ValidationError("Enter a promo price above 0.");
  const data: Prisma.ShelfLabelUpdateInput = {
    ...(e.name != null ? { name: e.name.trim().slice(0, 120) || l.name } : {}),
    ...(e.barcode !== undefined ? { barcode: e.barcode || null } : {}),
    ...(e.brand !== undefined ? { brand: e.brand?.trim().slice(0, 80) || null } : {}),
    ...(e.originCountryCode !== undefined ? { originCountryCode: e.originCountryCode && /^[A-Za-z]{2}$/.test(e.originCountryCode) ? e.originCountryCode.toUpperCase() : null } : {}),
    ...(e.priceGross != null ? { priceGross: e.priceGross.toFixed(2), marginPct: e.marginPct === undefined ? null : e.marginPct } : {}),
    ...(e.marginPct !== undefined && e.priceGross == null ? { marginPct: e.marginPct } : {}),
    ...(e.promoPrice !== undefined ? { promoPrice: e.promoPrice, promoUntil: e.promoPrice == null ? null : e.promoUntil ?? null } : {}),
    ...(e.content !== undefined ? { content: e.content && e.content > 0 ? e.content : null } : {}),
    ...(e.contentUnit !== undefined ? { contentUnit: e.contentUnit } : {}),
  };
  // a new margin without a price: price it from today's cost
  if (e.marginPct != null && e.priceGross == null && l.offerId) {
    const c = (await costs(ctx, [l.offerId])).get(l.offerId);
    if (c) data.priceGross = priceFromMargin(c.costNet, e.marginPct, l.vatRate.toString()).toFixed(2);
  }
  const r = await prisma.shelfLabel.update({ where: { id }, data });
  if (e.syncTill && a.settings.allowPosSync && can(ctx, "company.pos.manage")) await syncTill(ctx, r);
  return r;
}

/** Take the margin prices for labels whose cost changed. */
export async function applyNewPrices(ctx: Ctx, ids: string[]) {
  await need(ctx, true);
  const { labels } = await listLabels(ctx);
  let n = 0;
  for (const l of labels.filter((x) => ids.includes(x.id) && x.newPrice)) { await prisma.shelfLabel.update({ where: { id: l.id }, data: { priceGross: l.newPrice! } }); n++; }
  return { updated: n };
}

export async function removeLabels(ctx: Ctx, ids: string[]) {
  await need(ctx, true);
  return prisma.shelfLabel.deleteMany({ where: { id: { in: ids }, companyId: ctx.company.id } });
}

/** The selling price into the shop's FIRINGI till: the till item it came from, or a new one by barcode. */
async function syncTill(ctx: Ctx, l: ShelfLabel) {
  const price = l.priceGross;
  if (l.posItemId) { await prisma.posItem.updateMany({ where: { id: l.posItemId, companyId: ctx.company.id }, data: { price } }); return; }
  const existing = l.barcode ? await prisma.posItem.findFirst({ where: { companyId: ctx.company.id, barcode: l.barcode } }) : null;
  if (existing) { await prisma.posItem.update({ where: { id: existing.id }, data: { price } }); await prisma.shelfLabel.update({ where: { id: l.id }, data: { posItemId: existing.id } }).catch(() => null); return; }
  const item = await prisma.posItem.create({ data: { companyId: ctx.company.id, name: l.name, barcode: l.barcode, price, vatRate: l.vatRate } });
  await prisma.shelfLabel.update({ where: { id: l.id }, data: { posItemId: item.id } }).catch(() => null);
}

// ── printing ────────────────────────────────────────────────────────────────

/** The PDF for these labels in this format; they are marked as printed at their current price. */
export async function printLabels(ctx: Ctx, ids: string[], format: LabelFormat, fields: LabelFields, locale: string, copies = 1) {
  const a = await need(ctx);
  const labels = await prisma.shelfLabel.findMany({ where: { id: { in: ids }, companyId: ctx.company.id }, orderBy: { name: "asc" } });
  if (!labels.length) throw new ValidationError("Choose labels to print.");
  if (labels.length * copies > 2000) throw new ValidationError("Print at most 2000 labels at a time.");
  const f = allowedFields(fields, a.settings);
  const { renderShelfLabelsPdf } = await import("@/server/pdf/shelf-labels");
  const { appUrl } = await import("@/server/notify/dispatch");
  const load = async (l: string) => ((await import(`@/messages/${l}.json`).catch(() => ({ default: {} }))).default as { shelfLabels?: { pdf?: Record<string, string> } }).shelfLabels?.pdf ?? {};
  const [mine, en] = await Promise.all([load(locale), load("en")]);
  const l = (k: string) => mine[k] ?? en[k] ?? k;
  const shop = await prisma.company.findUnique({ where: { id: ctx.company.id }, select: { tradeName: true, legalName: true } });
  const now = new Date();
  const pdf = await renderShelfLabelsPdf({
    format, fields: f, qrFallback: a.settings.allowQr, locale, baseUrl: appUrl(), shopName: shop?.tradeName ?? shop?.legalName ?? "", date: now,
    labels: labels.flatMap((x) => Array.from({ length: Math.max(1, Math.min(50, copies)) }, () => x)),
    l: { perKg: l("perKg"), perL: l("perL"), promo: l("promo"), was: l("was"), until: l("until"), origin: l("origin") },
  });
  await prisma.$transaction(labels.map((x) => {
    const promoOn = x.promoPrice != null && (!x.promoUntil || x.promoUntil >= now);
    return prisma.shelfLabel.update({ where: { id: x.id }, data: { printedAt: now, printedPrice: x.priceGross, printedPromo: promoOn ? x.promoPrice : null } });
  }));
  return pdf;
}

export function assertFormat(f: string): LabelFormat {
  if (!(LABEL_FORMATS as readonly string[]).includes(f)) throw new AppError("BAD_FORMAT", "Unknown label size.");
  return f as LabelFormat;
}

// ── FIRINGI ─────────────────────────────────────────────────────────────────

export async function slAdmin(ctx: Ctx) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, ["admin.settings.manage", "admin.catalogue.manage", "admin.catalogue.view"])) throw new ForbiddenError();
  const s = await slSettings();
  const ids = Object.keys(s.companies);
  const [countries, cos, shops, labels] = await Promise.all([
    prisma.country.findMany({ where: { isActive: true, isSchengen: true }, select: { code: true, name: true }, orderBy: { code: "asc" } }),
    ids.length ? prisma.company.findMany({ where: { id: { in: ids } }, select: { id: true, legalName: true, tradeName: true, type: true } }) : Promise.resolve([]),
    prisma.shelfLabel.groupBy({ by: ["companyId"], _count: { _all: true } }),
    prisma.shelfLabel.count(),
  ]);
  return {
    settings: s, manage: can(ctx, ["admin.settings.manage", "admin.catalogue.manage"]),
    countries: countries.map((c) => ({ code: c.code, name: pickLocalized(c.name, "en") })),
    overrides: cos.map((c) => ({ id: c.id, name: c.tradeName ?? c.legalName, type: c.type, state: s.companies[c.id] })),
    shops: shops.length, labels,
  };
}
