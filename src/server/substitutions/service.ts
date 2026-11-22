import "server-only";
/**
 * Substitutions (Phase 60). Rules in src/lib/substitutions.ts; docs in docs/substitutions.md.
 *
 *   • The supplier finds a line short (at confirmation or while picking) and proposes one of its own products
 *     instead (`propose`). The short units leave the line at once (reservation released, totals follow).
 *   • The customer's rule decides: NEVER → refused, AUTO within limits → accepted at once, otherwise the customer
 *     is asked and has FIRINGI's response time to answer; unanswered proposals follow the customer's choice.
 *   • Accepted → a new order line at the customer's normal price (or the agreed lower price when the supplier
 *     matched the price — the supplier pays the difference), stock reserved, added to an open pick list, totals,
 *     excise, cold chain, returnables, currency and CO₂ updated. FIRINGI invoices it at delivery like any line.
 *   • Rejected / expired → the units stay short; FIRINGI's shortfall handling (Phase 9) takes over.
 */
import type { Prisma, SubstitutionMode, SubstitutionStatus } from "@prisma/client";
import Decimal from "decimal.js";
import { prisma, type Tx } from "@/server/db";
import { loadContext, type Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";
import { notify } from "@/server/notify/dispatch";
import { pickLocalized } from "@/i18n/config";
import { computeLine, computeTotals, type ComputedLine } from "@/server/orders/calc";
import { activeCommission, vatRate } from "@/server/services/orders";
import { releaseForOrder, reserveForOrder, reservedFor } from "@/server/inventory/ledger";
import { pricedOffers } from "@/server/data/catalogue-buyer";
import {
  effectiveRule, freeShort, matchedUnitPrice, mergeSubstitutionSettings, priceDiffPct, SUB_MODES, verdict,
  type CustomerRule, type SubstitutionModeT, type SubstitutionSettings,
} from "@/lib/substitutions";

const KEY = "substitutions.settings";
const D = (v: Decimal.Value | { toString(): string } | null | undefined) => new Decimal(v == null ? 0 : v.toString());
const isStaff = (ctx: Ctx) => ctx.company.type === "ADMIN";
const isBuyer = (ctx: Ctx) => ctx.company.type === "CUSTOMER" || ctx.company.type === "WHOLESALER";
/** Lines can change only after the supplier accepted the order and before it is packed. */
const OPEN_STATUS = "SUPPLIER_PROCESSING";

/** The language the page is shown in (product names follow it); the user's own language outside a request. */
async function uiLocale(ctx: Ctx) {
  try { return await (await import("next-intl/server")).getLocale(); } catch { return ctx.user.locale ?? "en"; }
}

// ── settings ────────────────────────────────────────────────────────────────

export async function substitutionSettings(db: Tx | typeof prisma = prisma): Promise<SubstitutionSettings> {
  const row = await db.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: KEY } });
  return mergeSubstitutionSettings(row?.value as Partial<SubstitutionSettings> | null);
}

export async function saveSubstitutionSettings(ctx: Ctx, input: Partial<SubstitutionSettings>) {
  if (!isStaff(ctx) || !can(ctx, "admin.settings.manage")) throw new ForbiddenError();
  const before = await substitutionSettings();
  const v = mergeSubstitutionSettings({ ...before, ...input });
  const row = await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: KEY } });
  if (row) await prisma.setting.update({ where: { id: row.id }, data: { value: v as unknown as Prisma.InputJsonValue } });
  else await prisma.setting.create({ data: { scope: "GLOBAL", scopeId: "", key: KEY, value: v as unknown as Prisma.InputJsonValue } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "substitutions.settings", entityType: "Setting", entityId: KEY, before: before as unknown as Prisma.InputJsonValue, after: v as unknown as Prisma.InputJsonValue });
  return v;
}

// ── the customer's rules ────────────────────────────────────────────────────

function requireBuyer(ctx: Ctx, manage = false) {
  if (!isBuyer(ctx)) throw new ForbiddenError();
  if (!can(ctx, manage ? "buyer.orders.place" : ["buyer.orders.place", "buyer.orders.view"])) throw new ForbiddenError();
}

export async function myPreferences(ctx: Ctx) {
  requireBuyer(ctx);
  const [s, pref, rules] = await Promise.all([
    substitutionSettings(),
    prisma.substitutionPreference.findUnique({ where: { companyId: ctx.company.id } }),
    prisma.substitutionProductRule.findMany({ where: { companyId: ctx.company.id }, orderBy: { createdAt: "desc" } }),
  ]);
  const products = await prisma.product.findMany({ where: { id: { in: rules.map((r) => r.productId) } }, select: { id: true, name: true, brand: { select: { name: true } } } });
  const pn = new Map(products.map((p) => [p.id, p]));
  const locale = await uiLocale(ctx);
  return {
    settings: { enabled: s.enabled, allowAuto: s.allowAuto, responseMinutes: s.responseMinutes },
    rule: effectiveRule(s, pref ? { mode: pref.mode, maxPricePct: pref.maxPricePct, sameBrandOnly: pref.sameBrandOnly, acceptOnTimeout: pref.acceptOnTimeout } : null, null),
    chosen: !!pref,
    products: rules.map((r) => ({ id: r.id, productId: r.productId, mode: r.mode as SubstitutionModeT, name: pickLocalized(pn.get(r.productId)?.name as Record<string, string> | undefined, locale) || "—", brand: pn.get(r.productId)?.brand?.name ?? null })),
  };
}

export async function savePreferences(ctx: Ctx, i: { mode: string; maxPricePct: number; sameBrandOnly: boolean; acceptOnTimeout: boolean }) {
  requireBuyer(ctx, true);
  if (!SUB_MODES.includes(i.mode as SubstitutionModeT)) throw new ValidationError("Choose how replacements are handled.");
  const pct = Number(i.maxPricePct);
  if (!Number.isInteger(pct) || pct < 0 || pct > 100) throw new ValidationError("The price limit must be between 0 and 100 %.");
  const data = { mode: i.mode as SubstitutionMode, maxPricePct: pct, sameBrandOnly: !!i.sameBrandOnly, acceptOnTimeout: !!i.acceptOnTimeout, updatedById: ctx.user.id };
  await prisma.substitutionPreference.upsert({ where: { companyId: ctx.company.id }, create: { companyId: ctx.company.id, ...data }, update: data });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "substitutions.preferences", entityType: "Company", entityId: ctx.company.id, after: data });
}

export async function setProductRule(ctx: Ctx, productId: string, mode: string | null) {
  requireBuyer(ctx, true);
  if (mode === null) {
    await prisma.substitutionProductRule.deleteMany({ where: { companyId: ctx.company.id, productId } });
    return;
  }
  if (!SUB_MODES.includes(mode as SubstitutionModeT)) throw new ValidationError("Choose how replacements are handled.");
  if (!(await prisma.product.findUnique({ where: { id: productId }, select: { id: true } }))) throw new NotFoundError("Product");
  await prisma.substitutionProductRule.upsert({
    where: { companyId_productId: { companyId: ctx.company.id, productId } },
    create: { companyId: ctx.company.id, productId, mode: mode as SubstitutionMode }, update: { mode: mode as SubstitutionMode },
  });
}

/** Products this customer bought (for choosing per-product rules). */
export async function boughtProducts(ctx: Ctx, q?: string | null) {
  requireBuyer(ctx);
  const locale = await uiLocale(ctx);
  const rows = await prisma.$queryRaw<{ productId: string }[]>`
    SELECT DISTINCT v."productId" FROM "OrderLine" l
    JOIN "Order" o ON o.id = l."orderId" JOIN "VendorOffer" f ON f.id = l."offerId"
    JOIN "PackagingUnit" p ON p.id = f."packagingUnitId" JOIN "ProductVariant" v ON v.id = p."variantId"
    WHERE o."buyerCompanyId" = ${ctx.company.id} LIMIT 500`;
  const products = await prisma.product.findMany({ where: { id: { in: rows.map((r) => r.productId) } }, select: { id: true, name: true, brand: { select: { name: true } } } });
  const t = (q ?? "").trim().toLowerCase();
  return products
    .map((p) => ({ id: p.id, name: pickLocalized(p.name as Record<string, string>, locale) || "—", brand: p.brand?.name ?? null }))
    .filter((p) => !t || p.name.toLowerCase().includes(t) || (p.brand ?? "").toLowerCase().includes(t))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 200);
}

async function ruleFor(db: Tx | typeof prisma, buyerCompanyId: string, productId: string, s: SubstitutionSettings): Promise<CustomerRule> {
  const [pref, pr] = await Promise.all([
    db.substitutionPreference.findUnique({ where: { companyId: buyerCompanyId } }),
    db.substitutionProductRule.findUnique({ where: { companyId_productId: { companyId: buyerCompanyId, productId } } }),
  ]);
  return effectiveRule(s, pref ? { mode: pref.mode, maxPricePct: pref.maxPricePct, sameBrandOnly: pref.sameBrandOnly, acceptOnTimeout: pref.acceptOnTimeout } : null, pr?.mode ?? null);
}

// ── the supplier's chosen replacements ──────────────────────────────────────

function requireVendor(ctx: Ctx, perm: "vendor.orders.manage" | "vendor.products.manage" | "vendor.products.view") {
  if (ctx.company.type !== "WHOLESALER" && ctx.company.type !== "DISTRIBUTOR") throw new ForbiddenError();
  if (!can(ctx, perm)) throw new ForbiddenError();
}

const offerProduct = { packaging: { select: { name: true, unitsPerPack: true, variant: { select: { sku: true, product: { select: { id: true, name: true, brandId: true, categoryId: true, brand: { select: { name: true } } } } } } } } } as const;

export async function substituteLinks(ctx: Ctx, offerId: string) {
  requireVendor(ctx, "vendor.products.view");
  const offer = await prisma.vendorOffer.findFirst({ where: { id: offerId, vendorCompanyId: ctx.company.id }, select: { id: true } });
  if (!offer) throw new NotFoundError("Product");
  const links = await prisma.substituteLink.findMany({ where: { offerId }, orderBy: { rank: "asc" }, include: { substitute: { select: { id: true, status: true, ...offerProduct } } } });
  const locale = await uiLocale(ctx);
  return links.map((l) => ({ offerId: l.substituteOfferId, active: l.substitute.status === "ACTIVE", sku: l.substitute.packaging.variant.sku, name: pickLocalized(l.substitute.packaging.variant.product.name as Record<string, string>, locale) || "—", packaging: pickLocalized(l.substitute.packaging.name as Record<string, string>, locale) || "" }));
}

export async function setSubstituteLinks(ctx: Ctx, offerId: string, substituteOfferIds: string[]) {
  requireVendor(ctx, "vendor.products.manage");
  const ids = [...new Set(substituteOfferIds)].filter((x) => x !== offerId).slice(0, 10);
  const own = await prisma.vendorOffer.findMany({ where: { id: { in: [offerId, ...ids] }, vendorCompanyId: ctx.company.id }, select: { id: true } });
  if (!own.some((o) => o.id === offerId) || own.length !== ids.length + 1) throw new NotFoundError("Product");
  await prisma.$transaction(async (tx) => {
    await tx.substituteLink.deleteMany({ where: { offerId } });
    for (const [rank, id] of ids.entries()) await tx.substituteLink.create({ data: { vendorCompanyId: ctx.company.id, offerId, substituteOfferId: id, rank } });
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "substitutions.links", entityType: "VendorOffer", entityId: offerId, after: { substitutes: ids } });
}

/** The supplier's own active products (for choosing replacements). */
export async function ownOffers(ctx: Ctx, q?: string | null) {
  requireVendor(ctx, "vendor.products.view");
  const locale = await uiLocale(ctx);
  const rows = await prisma.vendorOffer.findMany({ where: { vendorCompanyId: ctx.company.id, status: "ACTIVE" }, select: { id: true, ...offerProduct }, take: 1000 });
  const t = (q ?? "").trim().toLowerCase();
  return rows
    .map((r) => ({ id: r.id, sku: r.packaging.variant.sku, name: pickLocalized(r.packaging.variant.product.name as Record<string, string>, locale) || "—", packaging: pickLocalized(r.packaging.name as Record<string, string>, locale) || "" }))
    .filter((r) => !t || r.name.toLowerCase().includes(t) || r.sku.toLowerCase().includes(t))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 300);
}

// ── order helpers ───────────────────────────────────────────────────────────

/** The customer's view of prices: the person who placed the order (or another buyer of the company). */
async function buyerCtx(order: { placedByUserId: string; buyerCompanyId: string }): Promise<Ctx | null> {
  const ok = (c: Ctx | null) => !!c && c.company.id === order.buyerCompanyId && c.permissions.has("buyer.catalogue.view");
  const direct = await loadContext(order.placedByUserId, "substitution", order.buyerCompanyId).catch(() => null);
  if (ok(direct)) return direct;
  const members = await prisma.membership.findMany({ where: { companyId: order.buyerCompanyId, status: "ACTIVE" }, select: { userId: true }, take: 20 });
  for (const m of members) {
    const c = await loadContext(m.userId, "substitution", order.buyerCompanyId).catch(() => null);
    if (ok(c)) return c;
  }
  return null;
}

const unitsOf = (l: { qtyDelivered: number | null; qtyConfirmed: number | null; qtyOrdered: number }) => l.qtyDelivered ?? l.qtyConfirmed ?? l.qtyOrdered;

/** Release what an order holds of an offer beyond what its lines still need. */
async function syncReservation(tx: Tx, orderId: string, offerId: string) {
  const lines = await tx.orderLine.findMany({ where: { orderId, offerId }, select: { qtyOrdered: true, qtyConfirmed: true, qtyDelivered: true } });
  const need = lines.reduce((a, l) => a + unitsOf(l), 0);
  const held = (await reservedFor(tx, orderId)).filter((r) => r.offerId === offerId).reduce((a, r) => a + r.qty, 0);
  if (held > need) await releaseForOrder(tx, orderId, { offerId, qty: held - need });
}

/**
 * Line amounts and order totals from the current quantities (frozen prices and rates) — the same rules as a
 * confirmation with other quantities; sold-by-weight lines are re-priced by the catch-weight module.
 */
export async function recalcOrder(tx: Tx, orderId: string) {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
  if (order.lines.some((l) => l.cwMode)) {
    await (await import("@/server/catchweight/service")).repriceOrder(tx, orderId);
    return;
  }
  const goodsVatBefore = order.lines.reduce((a, l) => a.plus(D(l.lineVat)), new Decimal(0));
  const calc: ComputedLine[] = [];
  for (const l of order.lines) {
    const qty = unitsOf(l);
    const c = computeLine({
      qty, unitListPriceNet: l.unitListPriceNet.toString(), vatRatePercent: l.taxRate.toString(), commissionRatePercent: l.commissionRate?.toString() ?? 0,
      vendorFundedDiscountPerUnit: l.vendorFundedDiscount.toString(), firingiFundedDiscountPerUnit: l.firingiFundedDiscount.toString(),
      commissionUnitBase: l.dealId ? l.unitListPriceNet.minus(l.vendorFundedDiscount).toString() : null,
    });
    calc.push({ ...c, qty });
    if (!c.lineNet.eq(D(l.lineNet)) || !c.vendorLineNet.eq(D(l.vendorLineNet)))
      await tx.orderLine.update({ where: { id: l.id }, data: { lineNet: c.lineNet.toFixed(2), lineVat: c.lineVat.toFixed(2), commissionBase: c.commissionBase.toFixed(2), commissionAmount: c.commissionAmount.toFixed(2), vendorLineNet: c.vendorLineNet.toFixed(2) } });
  }
  // delivery fee VAT exactly as charged at checkout (the fee itself doesn't change)
  const feeNet = D(order.deliveryFeeNet);
  const feeVat = D(order.vatTotal).minus(goodsVatBefore);
  const feeVatPercent = feeNet.gt(0) ? feeVat.div(feeNet).mul(100) : new Decimal(0);
  const toVendor = order.deliveryMode !== "FIRINGI_FLEET";
  const t = computeTotals(calc, { feeNet, feeVatPercent, toVendor, firingiPaysVendorFeeNet: toVendor ? order.deliveryDiscountNet.toString() : 0 });
  const vatTotal = calc.reduce((a, l) => a.plus(l.lineVat), new Decimal(0)).plus(feeVat);
  const netTotal = t.goodsNet.plus(feeNet);
  await tx.order.update({
    where: { id: orderId },
    data: {
      listNet: t.listNet.toFixed(2), discountTotal: t.discountTotal.toFixed(2), netTotal: netTotal.toFixed(2), vatTotal: vatTotal.toFixed(2), grandTotal: netTotal.plus(vatTotal).toFixed(2),
      commissionTotal: t.commissionTotal.toFixed(2), vendorPayableNet: t.vendorPayableNet.toFixed(2), firingiMarginNet: t.firingiMarginNet.toFixed(2),
    },
  });
  await (await import("@/server/currency/documents")).syncOrderLocal(tx, orderId);
  const { syncRedemptions } = await import("@/server/marketing/offers");
  await syncRedemptions(tx, orderId);
}

/** Everything that follows an order's lines (excise, returnables, cold chain, sold by weight, CO₂, totals). */
async function afterLinesChanged(tx: Tx, orderId: string) {
  await (await import("@/server/catchweight/service")).attachToOrder(tx, orderId);
  await (await import("@/server/coldchain/service")).attachToOrder(tx, orderId);
  const ex = await import("@/server/excise/service");
  await ex.attachToOrder(tx, orderId);
  await ex.refreshOrder(tx, orderId);
  await (await import("@/server/returnables/service")).attachToOrder(tx, orderId);
  await recalcOrder(tx, orderId);
  await (await import("@/server/co2/service")).stampOrder(tx, orderId);
}

/** Take `units` off a line (scaling its discounts) and release their reservation. */
async function shortenLine(tx: Tx, line: { id: string; orderId: string; offerId: string; qtyOrdered: number; qtyConfirmed: number | null }, units: number) {
  if (units <= 0) return;
  const before = line.qtyConfirmed ?? line.qtyOrdered;
  const after = before - units;
  if (after < 0) throw new ValidationError("That is more than the line still has.");
  await tx.orderLine.update({ where: { id: line.id }, data: { qtyConfirmed: after } });
  if (before > 0) {
    const f = new Decimal(after).div(before);
    for (const d of await tx.orderLineDiscount.findMany({ where: { orderLineId: line.id } }))
      await tx.orderLineDiscount.update({ where: { id: d.id }, data: { amount: D(d.amount).mul(f).toFixed(2), firingiAmount: D(d.firingiAmount).mul(f).toFixed(2), vendorAmount: D(d.vendorAmount).mul(f).toFixed(2) } });
  }
  await syncReservation(tx, line.orderId, line.offerId);
}

/** Units of a line already moved to another supplier by FIRINGI's shortfall handling (never replaced again). */
async function movedLineIds(orderId: string) {
  const evs = await prisma.allocationEvent.findMany({ where: { orderId, status: { in: ["MOVED", "PARTIAL"] } }, select: { items: true } });
  return new Set(evs.flatMap((e) => ((e.items as { lineId?: string }[] | null) ?? []).map((i) => i.lineId ?? "")));
}

/** What the customer would pay for a replacement now, and what the line would hold. */
async function priceFor(buyer: Ctx, offerId: string, qty: number) {
  const { items } = await pricedOffers(buyer, [{ offerId, qty }]);
  const it = items[0];
  if (!it?.price) return null;
  return it;
}

// ── proposals ───────────────────────────────────────────────────────────────

export type ProposeInput = { lineId: string; shortQty: number; substituteOfferId: string; qty: number; priceMatch?: boolean; note?: string | null };

async function ownOrderLine(ctx: Ctx, lineId: string) {
  const line = await prisma.orderLine.findUnique({ where: { id: lineId }, include: { order: true, offer: { select: { ...offerProduct } } } });
  if (!line) throw new NotFoundError("Order line");
  const staff = isStaff(ctx) && can(ctx, "admin.orders.manage");
  if (!staff && line.order.sellerCompanyId !== ctx.company.id) throw new NotFoundError("Order line");
  if (!staff) requireVendor(ctx, "vendor.orders.manage");
  return line;
}

/** Replacements the supplier can offer for a line, priced for the customer (chosen replacements first). */
export async function candidatesFor(ctx: Ctx, lineId: string) {
  const line = await ownOrderLine(ctx, lineId);
  const s = await substitutionSettings();
  const product = line.offer.packaging.variant.product;
  const rule = await ruleFor(prisma, line.order.buyerCompanyId, product.id, s);
  const links = await prisma.substituteLink.findMany({ where: { offerId: line.offerId }, orderBy: { rank: "asc" }, select: { substituteOfferId: true } });
  const linked = links.map((l) => l.substituteOfferId);
  const similar = await prisma.vendorOffer.findMany({
    where: { vendorCompanyId: line.order.sellerCompanyId, status: "ACTIVE", id: { notIn: [line.offerId, ...linked] }, packaging: { variant: { product: { categoryId: product.categoryId } } } },
    select: { id: true }, take: 30,
  });
  const ids = [...linked, ...similar.map((o) => o.id)];
  const buyer = await buyerCtx(line.order);
  const locale = await uiLocale(ctx);
  const priced = buyer ? (await pricedOffers(buyer, ids.map((offerId) => ({ offerId, qty: 1 })))).items : [];
  const byId = new Map(priced.map((p) => [p.offerId, p]));
  const brands = new Map((await prisma.vendorOffer.findMany({ where: { id: { in: ids } }, select: { id: true, packaging: { select: { variant: { select: { product: { select: { brandId: true } } } } } } } })).map((o) => [o.id, o.packaging.variant.product.brandId]));
  const pending = await prisma.substitution.aggregate({ where: { lineId, status: "PENDING" }, _sum: { shortQty: true } });
  const moved = (await movedLineIds(line.orderId)).has(line.id);
  return {
    enabled: s.enabled, allowPriceMatch: s.allowPriceMatch,
    rule: { mode: rule.mode, maxPricePct: rule.maxPricePct, sameBrandOnly: rule.sameBrandOnly },
    line: {
      id: line.id, name: pickLocalized(line.productName as Record<string, string>, locale) || "—", sku: line.sku, unitNet: Number(line.unitSalePriceNet),
      qty: line.qtyConfirmed ?? line.qtyOrdered, alreadyShort: moved ? 0 : freeShort(line, pending._sum.shortQty ?? 0), pending: (pending._sum.shortQty ?? 0) > 0,
      isSubstitute: !!line.substituteForLineId,
    },
    candidates: ids
      .map((id) => byId.get(id))
      .filter((p): p is NonNullable<typeof p> => !!p && !!p.price && p.vendorCompanyId === line.order.sellerCompanyId)
      .map((p) => ({
        offerId: p.offerId, linked: linked.includes(p.offerId), name: pickLocalized(p.name, locale) || "—", brand: p.brand, sku: p.sku,
        packaging: pickLocalized(p.packaging.name, locale) || "", unitNet: Number(p.price!.unitPriceNet), available: p.available ?? 0,
        sameBrand: !!product.brandId && brands.get(p.offerId) === product.brandId,
      })),
  };
}

/** The supplier proposes a replacement for short units of a line. */
export async function propose(ctx: Ctx, i: ProposeInput) {
  const s = await substitutionSettings();
  if (!s.enabled) throw new AppError("SUBSTITUTIONS_OFF", "Substitutions are switched off by FIRINGI.", 409);
  const line = await ownOrderLine(ctx, i.lineId);
  const order = line.order;
  if (order.status !== OPEN_STATUS) throw new AppError("BAD_STATUS", "Replacements can be offered only after you accept the order and before it is packed.", 409);
  if (line.substituteForLineId) throw new ValidationError("This line is already a replacement.");
  if (!Number.isInteger(i.shortQty) || i.shortQty < 1) throw new ValidationError("Enter how many units are missing.");
  if (!Number.isInteger(i.qty) || i.qty < 1 || i.qty > Math.max(10 * i.shortQty, 10)) throw new ValidationError("Enter how many units of the replacement you send.");
  if (i.priceMatch && !s.allowPriceMatch) throw new ValidationError("Same-price replacements are switched off by FIRINGI.");
  if (await prisma.substitution.count({ where: { lineId: line.id, status: "PENDING" } })) throw new ValidationError("A replacement for this line is already waiting for the customer.");
  const sub = await prisma.vendorOffer.findFirst({ where: { id: i.substituteOfferId, vendorCompanyId: order.sellerCompanyId, status: "ACTIVE" }, select: { id: true, ...offerProduct } });
  if (!sub || sub.id === line.offerId) throw new ValidationError("Choose one of your other active products.");

  const product = line.offer.packaging.variant.product;
  const rule = await ruleFor(prisma, order.buyerCompanyId, product.id, s);
  const moved = (await movedLineIds(order.id)).has(line.id);
  const free = moved ? 0 : freeShort(line, 0);
  const newly = Math.max(0, i.shortQty - free);
  if (newly > (line.qtyConfirmed ?? line.qtyOrdered)) throw new ValidationError("That is more than the line has.");

  const buyer = await buyerCtx(order);
  if (!buyer) throw new AppError("NO_BUYER", "The customer has nobody who can buy at the moment.", 409);
  const priced = await priceFor(buyer, sub.id, i.qty);
  if (!priced) throw new ValidationError("The customer can't buy this product (not visible or no price for them).");
  if ((priced.available ?? 0) < i.qty) throw new ValidationError(`Only ${Math.max(0, priced.available ?? 0)} in stock of the replacement.`);
  const orig = { unitNet: Number(line.unitSalePriceNet), qty: i.shortQty };
  const offered = { unitNet: Number(priced.price!.unitPriceNet), qty: i.qty };
  const unitNet = i.priceMatch ? matchedUnitPrice(orig, offered) : offered.unitNet;
  const diff = priceDiffPct(orig, { unitNet, qty: i.qty });
  const sameBrand = !!product.brandId && product.brandId === sub.packaging.variant.product.brandId;
  const v = verdict(rule, { diffPct: diff, sameBrand });
  if (v === "BLOCKED") throw new AppError("CUSTOMER_REFUSES", "This customer doesn't accept replacements for this product.", 409);

  const created = await prisma.$transaction(async (tx) => {
    const fresh = await tx.order.findUniqueOrThrow({ where: { id: order.id }, select: { status: true } });
    if (fresh.status !== OPEN_STATUS) throw new AppError("BAD_STATUS", "The order changed meanwhile. Please reload.", 409);
    const l = await tx.orderLine.findUniqueOrThrow({ where: { id: line.id } });
    await shortenLine(tx, l, newly);
    if (newly) await afterLinesChanged(tx, order.id);
    return tx.substitution.create({
      data: {
        orderId: order.id, lineId: line.id, shortQty: i.shortQty, substituteOfferId: sub.id, qty: i.qty,
        unitPriceNet: unitNet.toFixed(4), originalUnitPriceNet: line.unitSalePriceNet, priceMatch: !!i.priceMatch, priceDiffPct: diff.toFixed(2), sameBrand,
        note: i.note?.trim().slice(0, 500) || null, proposedById: ctx.user.id, expiresAt: new Date(Date.now() + s.responseMinutes * 60_000),
      },
    });
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "substitution.proposed", entityType: "Order", entityId: order.id, after: { substitution: created.id, line: line.id, shortQty: i.shortQty, offer: sub.id, qty: i.qty, unitNet, diffPct: diff, verdict: v } });

  const locale = "en";
  const names = { original: pickLocalized(line.productName as Record<string, string>, locale) || line.sku, substitute: pickLocalized(sub.packaging.variant.product.name as Record<string, string>, locale) || sub.packaging.variant.sku };
  if (v === "AUTO") {
    await accept(created.id, { auto: true, byUserId: null, note: "Accepted by the customer's rule" });
    return { id: created.id, status: "ACCEPTED" as SubstitutionStatus, auto: true };
  }
  await notify("substitution.proposed", [{ companyId: order.buyerCompanyId, link: `/buy/orders/${order.id}` }], { number: order.number, product: names.original, substitute: names.substitute, minutes: s.responseMinutes }, { ref: { type: "Order", id: order.id } });
  return { id: created.id, status: "PENDING" as SubstitutionStatus, auto: false };
}

/** Apply an accepted replacement: the new line, stock, pick list, totals. */
async function accept(id: string, by: { auto: boolean; byUserId: string | null; note?: string | null }) {
  const sub = await prisma.substitution.findUniqueOrThrow({ where: { id }, include: { order: true } });
  const order = sub.order;
  const buyer = await buyerCtx(order);
  const priced = buyer ? await priceFor(buyer, sub.substituteOfferId, sub.qty) : null;
  const fail = async (why: string) => {
    await prisma.substitution.updateMany({ where: { id, status: "PENDING" }, data: { status: "CANCELLED", decidedAt: new Date(), decidedById: by.byUserId, decisionNote: why } });
    await afterRefused(order.id);
    throw new AppError("SUBSTITUTE_FAILED", why, 409);
  };
  if (order.status !== OPEN_STATUS) return fail("The order has moved on — the replacement can no longer be added.");
  if (!priced?.price) return fail("The replacement is no longer available to you.");
  const regionId = (order.deliveryAddress as { regionId?: string | null } | null)?.regionId ?? null;
  const zeroRated = await (await import("@/server/trade/service")).zeroRatedBuyer(order.buyerCompanyId);
  const rate = zeroRated ? new Decimal(0) : await vatRate(prisma as unknown as Tx, order.countryId, regionId, priced.taxCategoryId);
  try {
    const lineId = await prisma.$transaction(async (tx) => {
      const ok = await tx.substitution.updateMany({ where: { id, status: "PENDING" }, data: { status: "ACCEPTED", auto: by.auto, decidedAt: new Date(), decidedById: by.byUserId, decisionNote: by.note ?? null } });
      if (ok.count !== 1) throw new AppError("CONFLICT", "This replacement was already decided.", 409);
      const fresh = await tx.order.findUniqueOrThrow({ where: { id: order.id }, select: { status: true } });
      if (fresh.status !== OPEN_STATUS) throw new AppError("SUBSTITUTE_FAILED", "The order has moved on — the replacement can no longer be added.", 409);
      const commission = await activeCommission(tx, order.sellerCompanyId);
      if (!commission) throw new AppError("SUBSTITUTE_FAILED", "The supplier can't take orders at the moment.", 409);
      const p = priced.price!;
      const list = D(p.listUnitNet);
      let vendorDisc = D(p.vendorFundedPerUnit);
      const firingiDisc = D(p.firingiFundedPerUnit);
      // the customer never pays more than the price shown in the proposal: the supplier pays the difference
      const over = list.minus(vendorDisc).minus(firingiDisc).minus(D(sub.unitPriceNet));
      if (over.gt(0)) vendorDisc = vendorDisc.plus(over);
      const c = computeLine({ qty: sub.qty, unitListPriceNet: list, vatRatePercent: rate, commissionRatePercent: commission.rate.toString(), vendorFundedDiscountPerUnit: vendorDisc, firingiFundedDiscountPerUnit: firingiDisc });
      const res = await reserveForOrder(tx, order.id, sub.substituteOfferId, sub.qty);
      if (!res.ok) throw new AppError("SUBSTITUTE_FAILED", `Only ${res.available} of the replacement left in stock.`, 409);
      const promos = p.promotions.filter((x) => !x.coupon);
      const created = await tx.orderLine.create({
        data: {
          orderId: order.id, offerId: sub.substituteOfferId, productName: priced.name, sku: priced.sku, packagingName: priced.packaging.name,
          qtyOrdered: sub.qty, qtyConfirmed: sub.qty, substituteForLineId: sub.lineId,
          unitListPriceNet: c.unitListPriceNet.toFixed(4),
          vendorDiscountNet: vendorDisc.toFixed(4), adminDiscountNet: promos.filter((x) => x.ownerType === "ADMIN").reduce((a, x) => a.plus(D(x.perUnit)), new Decimal(0)).toFixed(4),
          firingiFundedDiscount: c.firingiFundedDiscount.toFixed(4), vendorFundedDiscount: c.vendorFundedDiscount.toFixed(4), unitSalePriceNet: c.unitSalePriceNet.toFixed(4),
          taxRate: rate.toFixed(3), lineNet: c.lineNet.toFixed(2), lineVat: c.lineVat.toFixed(2),
          commissionRuleId: commission.id, commissionType: commission.type, commissionRate: commission.rate, commissionBase: c.commissionBase.toFixed(2), commissionAmount: c.commissionAmount.toFixed(2),
          vendorUnitCostNet: c.vendorUnitCostNet.toFixed(4), vendorLineNet: c.vendorLineNet.toFixed(2),
          discounts: { create: promos.map((x) => ({ promotionId: x.id, amount: D(x.perUnit).mul(sub.qty).toFixed(2), firingiAmount: D(x.firingiPerUnit).mul(sub.qty).toFixed(2), vendorAmount: D(x.vendorPerUnit).mul(sub.qty).toFixed(2) })) },
        },
      });
      await tx.orderLine.update({ where: { id: sub.lineId }, data: { substitutedQty: { increment: sub.shortQty } } });
      await tx.substitution.update({ where: { id }, data: { newLineId: created.id } });
      // on an open pick list in that warehouse: the picker sees the replacement too
      const plo = await tx.pickListOrder.findFirst({ where: { orderId: order.id, pickList: { status: { in: ["OPEN", "PICKED"] } } }, include: { pickList: { select: { id: true, addressId: true, status: true } } } });
      if (plo) {
        const here = res.picks.filter((x) => x.addressId === plo.pickList.addressId);
        if (here.length) {
          await (await import("@/server/warehouse/picking")).addLines(tx, plo.pickList.id, order.id, plo.pickList.addressId, here.map((x) => ({ batchId: x.batchId, qty: x.qty })));
          if (plo.pickList.status === "PICKED") await tx.pickList.update({ where: { id: plo.pickList.id }, data: { status: "OPEN" } });
        }
      }
      await afterLinesChanged(tx, order.id);
      await writeAudit({ actorUserId: by.byUserId, actorCompanyId: null, action: "substitution.accepted", entityType: "Order", entityId: order.id, after: { substitution: id, line: created.id, auto: by.auto } }, tx);
      return created.id;
    });
    // nothing short any more → open shortfall cases for this order close
    const { itemsToMove } = await import("@/server/allocation/engine");
    const left = await itemsToMove((await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { lines: true } })), "SHORTFALL");
    if (!left.length) await prisma.allocationEvent.updateMany({ where: { orderId: order.id, resolvedAt: null }, data: { status: "DISMISSED", resolvedAt: new Date(), note: "Replaced by the supplier's substitute" } });
    const name = pickLocalized(priced.name, "en") || priced.sku;
    await notify(by.auto ? "substitution.auto_accepted" : "substitution.accepted", [
      ...(by.auto ? [{ companyId: order.buyerCompanyId, link: `/buy/orders/${order.id}` }] : []),
      { companyId: order.sellerCompanyId, link: `/vendor/orders/${order.id}` },
    ], { number: order.number, substitute: name, qty: sub.qty }, { ref: { type: "Order", id: order.id } });
    return lineId;
  } catch (e) {
    if (e instanceof AppError && e.code === "SUBSTITUTE_FAILED") return fail(e.message);
    throw e;
  }
}

/** Refused / expired / cancelled: FIRINGI's shortfall handling may now look for another supplier. */
async function afterRefused(orderId: string) {
  const { onSupplierEvent } = await import("@/server/allocation/engine");
  await onSupplierEvent(orderId, "SHORTFALL");
}

/** The customer accepts or rejects a proposal. */
export async function decide(ctx: Ctx, id: string, acceptIt: boolean, note?: string | null) {
  requireBuyer(ctx, true);
  const sub = await prisma.substitution.findUnique({ where: { id }, include: { order: { select: { id: true, number: true, buyerCompanyId: true, sellerCompanyId: true } } } });
  if (!sub || sub.order.buyerCompanyId !== ctx.company.id) throw new NotFoundError("Replacement");
  if (sub.status !== "PENDING") throw new ValidationError("This replacement was already decided.");
  if (acceptIt) {
    await accept(id, { auto: false, byUserId: ctx.user.id, note });
    return "ACCEPTED" as const;
  }
  const ok = await prisma.substitution.updateMany({ where: { id, status: "PENDING" }, data: { status: "REJECTED", decidedAt: new Date(), decidedById: ctx.user.id, decisionNote: note?.trim().slice(0, 500) || null } });
  if (ok.count !== 1) throw new ValidationError("This replacement was already decided.");
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "substitution.rejected", entityType: "Order", entityId: sub.orderId, after: { substitution: id } });
  await notify("substitution.rejected", [{ companyId: sub.order.sellerCompanyId, link: `/vendor/orders/${sub.orderId}` }], { number: sub.order.number }, { ref: { type: "Order", id: sub.orderId } });
  await afterRefused(sub.orderId);
  return "REJECTED" as const;
}

/** The supplier withdraws a proposal still waiting for the customer. */
export async function withdraw(ctx: Ctx, id: string) {
  const sub = await prisma.substitution.findUnique({ where: { id }, include: { order: { select: { sellerCompanyId: true } } } });
  if (!sub) throw new NotFoundError("Replacement");
  const staff = isStaff(ctx) && can(ctx, "admin.orders.manage");
  if (!staff) {
    requireVendor(ctx, "vendor.orders.manage");
    if (sub.order.sellerCompanyId !== ctx.company.id) throw new NotFoundError("Replacement");
  }
  const ok = await prisma.substitution.updateMany({ where: { id, status: "PENDING" }, data: { status: "CANCELLED", decidedAt: new Date(), decidedById: ctx.user.id, decisionNote: "Withdrawn" } });
  if (ok.count !== 1) throw new ValidationError("This replacement was already decided.");
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "substitution.withdrawn", entityType: "Order", entityId: sub.orderId, after: { substitution: id } });
  await afterRefused(sub.orderId);
}

/** Proposals not answered in time follow the customer's choice (job, every few minutes). */
export async function processExpired(now = new Date()) {
  const s = await substitutionSettings();
  const due = await prisma.substitution.findMany({ where: { status: "PENDING", expiresAt: { lt: now } }, include: { order: { select: { id: true, number: true, buyerCompanyId: true, sellerCompanyId: true } } }, take: 200 });
  let accepted = 0, expired = 0, failed = 0;
  for (const sub of due) {
    const line = await prisma.orderLine.findUnique({ where: { id: sub.lineId }, select: { offer: { select: { packaging: { select: { variant: { select: { productId: true } } } } } } } });
    const rule = line ? await ruleFor(prisma, sub.order.buyerCompanyId, line.offer.packaging.variant.productId, s) : null;
    if (rule?.acceptOnTimeout) {
      try { await accept(sub.id, { auto: true, byUserId: null, note: "Not answered in time — accepted (customer's choice)" }); accepted++; } catch { failed++; }
      continue;
    }
    const ok = await prisma.substitution.updateMany({ where: { id: sub.id, status: "PENDING" }, data: { status: "EXPIRED", decidedAt: now, decisionNote: "Not answered in time" } });
    if (ok.count) {
      expired++;
      await notify("substitution.expired", [{ companyId: sub.order.sellerCompanyId, link: `/vendor/orders/${sub.orderId}` }, { companyId: sub.order.buyerCompanyId, link: `/buy/orders/${sub.orderId}` }], { number: sub.order.number }, { ref: { type: "Order", id: sub.orderId } });
      await afterRefused(sub.orderId);
    }
  }
  return { checked: due.length, accepted, expired, failed };
}

// ── views ───────────────────────────────────────────────────────────────────

/** The replacements of an order (customer, supplier, FIRINGI). Prices are what the customer pays. */
export async function forOrder(ctx: Ctx, orderId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { id: true, buyerCompanyId: true, sellerCompanyId: true, status: true } });
  if (!order) throw new NotFoundError("Order");
  const role = isStaff(ctx) ? "ADMIN" : order.buyerCompanyId === ctx.company.id ? "BUYER" : order.sellerCompanyId === ctx.company.id ? "VENDOR" : null;
  if (!role) throw new NotFoundError("Order");
  const locale = await uiLocale(ctx);
  const rows = await prisma.substitution.findMany({ where: { orderId }, orderBy: { createdAt: "desc" }, include: { offer: { select: { ...offerProduct } } } });
  const lines = await prisma.orderLine.findMany({ where: { id: { in: rows.map((r) => r.lineId) } }, select: { id: true, productName: true, sku: true } });
  const ln = new Map(lines.map((l) => [l.id, l]));
  const s = await substitutionSettings();
  return {
    enabled: s.enabled, canPropose: order.status === OPEN_STATUS,
    items: rows.map((r) => ({
      id: r.id, status: r.status, auto: r.auto, lineId: r.lineId, newLineId: r.newLineId,
      original: { name: pickLocalized(ln.get(r.lineId)?.productName as Record<string, string> | undefined, locale) || "—", sku: ln.get(r.lineId)?.sku ?? "", qty: r.shortQty, unitNet: Number(r.originalUnitPriceNet) },
      substitute: { offerId: r.substituteOfferId, name: pickLocalized(r.offer.packaging.variant.product.name as Record<string, string>, locale) || "—", brand: r.offer.packaging.variant.product.brand?.name ?? null, sku: r.offer.packaging.variant.sku, packaging: pickLocalized(r.offer.packaging.name as Record<string, string>, locale) || "", qty: r.qty, unitNet: Number(r.unitPriceNet) },
      priceMatch: r.priceMatch, diffPct: Number(r.priceDiffPct), sameBrand: r.sameBrand, note: r.note, decisionNote: r.decisionNote,
      expiresAt: r.expiresAt.toISOString(), decidedAt: r.decidedAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString(),
    })),
  };
}

/** Supplier / FIRINGI: the order's lines a replacement can be offered for (not replacements themselves). */
export async function proposableLines(ctx: Ctx, orderId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { sellerCompanyId: true, status: true } });
  if (!order) throw new NotFoundError("Order");
  const staff = isStaff(ctx) && can(ctx, "admin.orders.manage");
  if (!staff && !(order.sellerCompanyId === ctx.company.id && can(ctx, "vendor.orders.manage"))) return [];
  if (order.status !== OPEN_STATUS || !(await substitutionSettings()).enabled) return [];
  const locale = await uiLocale(ctx);
  const lines = await prisma.orderLine.findMany({ where: { orderId, substituteForLineId: null }, orderBy: { id: "asc" }, select: { id: true, productName: true, qtyOrdered: true, qtyConfirmed: true } });
  return lines.map((l) => ({ id: l.id, name: pickLocalized(l.productName as Record<string, string>, locale) || "—", qty: l.qtyConfirmed ?? l.qtyOrdered }));
}

/** Customer / supplier: the latest replacements on its orders. */
export async function recentFor(ctx: Ctx, portal: "buy" | "vendor") {
  const buyer = portal === "buy";
  if (buyer) requireBuyer(ctx);
  else if ((ctx.company.type !== "WHOLESALER" && ctx.company.type !== "DISTRIBUTOR") || !can(ctx, ["vendor.orders.view", "vendor.orders.manage"])) throw new ForbiddenError();
  const locale = await uiLocale(ctx);
  const rows = await prisma.substitution.findMany({
    where: { order: buyer ? { buyerCompanyId: ctx.company.id } : { sellerCompanyId: ctx.company.id } }, orderBy: { createdAt: "desc" }, take: 50,
    include: { offer: { select: { ...offerProduct } }, order: { select: { number: true, buyer: { select: { legalName: true, tradeName: true } }, seller: { select: { legalName: true, tradeName: true } } } } },
  });
  const lines = await prisma.orderLine.findMany({ where: { id: { in: rows.map((r) => r.lineId) } }, select: { id: true, productName: true } });
  const ln = new Map(lines.map((l) => [l.id, l.productName as Record<string, string>]));
  return rows.map((r) => ({
    id: r.id, orderId: r.orderId, number: r.order.number, status: r.status, auto: r.auto, createdAt: r.createdAt.toISOString(),
    other: buyer ? r.order.seller.tradeName ?? r.order.seller.legalName : r.order.buyer.tradeName ?? r.order.buyer.legalName,
    original: pickLocalized(ln.get(r.lineId), locale) || "—", substitute: pickLocalized(r.offer.packaging.variant.product.name as Record<string, string>, locale) || "—",
    shortQty: r.shortQty, qty: r.qty, diffPct: Number(r.priceDiffPct),
  }));
}

/** Customer: replacements waiting for an answer (dashboard / list). */
export async function waitingForMe(ctx: Ctx) {
  requireBuyer(ctx);
  return prisma.substitution.count({ where: { status: "PENDING", order: { buyerCompanyId: ctx.company.id } } });
}

/** FIRINGI: overview of replacements (English admin page). */
export async function adminOverview(ctx: Ctx, f: { status?: string | null; days?: number } = {}) {
  if (!isStaff(ctx) || !can(ctx, ["admin.orders.view", "admin.orders.manage"])) throw new ForbiddenError();
  const since = new Date(Date.now() - (f.days ?? 30) * 86400_000);
  const where: Prisma.SubstitutionWhereInput = { createdAt: { gte: since }, ...(f.status && ["PENDING", "ACCEPTED", "REJECTED", "EXPIRED", "CANCELLED"].includes(f.status) ? { status: f.status as SubstitutionStatus } : {}) };
  const [rows, byStatus, autoCount] = await Promise.all([
    prisma.substitution.findMany({
      where, orderBy: { createdAt: "desc" }, take: 300,
      include: { offer: { select: { ...offerProduct } }, order: { select: { number: true, buyer: { select: { legalName: true, tradeName: true } }, seller: { select: { legalName: true, tradeName: true } } } } },
    }),
    prisma.substitution.groupBy({ by: ["status"], where: { createdAt: { gte: since } }, _count: { _all: true } }),
    prisma.substitution.count({ where: { createdAt: { gte: since }, auto: true, status: "ACCEPTED" } }),
  ]);
  const lines = await prisma.orderLine.findMany({ where: { id: { in: rows.map((r) => r.lineId) } }, select: { id: true, productName: true } });
  const ln = new Map(lines.map((l) => [l.id, l.productName as Record<string, string>]));
  const count = (s: SubstitutionStatus) => byStatus.find((b) => b.status === s)?._count._all ?? 0;
  const decided = count("ACCEPTED") + count("REJECTED") + count("EXPIRED");
  return {
    totals: { proposed: byStatus.reduce((a, b) => a + b._count._all, 0), pending: count("PENDING"), accepted: count("ACCEPTED"), auto: autoCount, rejected: count("REJECTED"), expired: count("EXPIRED"), cancelled: count("CANCELLED"), acceptRate: decided ? Math.round((count("ACCEPTED") / decided) * 100) : null },
    items: rows.map((r) => ({
      id: r.id, orderId: r.orderId, number: r.order.number, status: r.status, auto: r.auto, createdAt: r.createdAt.toISOString(),
      buyer: r.order.buyer.tradeName ?? r.order.buyer.legalName, supplier: r.order.seller.tradeName ?? r.order.seller.legalName,
      original: pickLocalized(ln.get(r.lineId), "en") || "—", substitute: pickLocalized(r.offer.packaging.variant.product.name as Record<string, string>, "en") || "—",
      shortQty: r.shortQty, qty: r.qty, diffPct: Number(r.priceDiffPct), priceMatch: r.priceMatch,
    })),
  };
}
