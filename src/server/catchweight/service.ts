import "server-only";
/**
 * Catch-weight / sold by weight (Phase 41). Rules in src/lib/catch-weight.ts; docs in docs/catch-weight.md.
 *
 * Prices stay per unit (the estimate). A weighed line is re-priced on its billed weight — every per-unit amount
 * (list price, discounts, commission, the supplier's cost) × billedKg ÷ nominalKg — and the order totals follow.
 * The invoice then shows the line's units with the weight and the price per kg in the description, so credit
 * notes, returns and claims keep working per unit.
 */
import type { CatchWeightMode, CatchWeightSource, OrderStatus, Prisma } from "@prisma/client";
import Decimal from "decimal.js";
import { prisma, type Tx } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";
import { notify } from "@/server/notify/dispatch";
import { pickLocalized } from "@/i18n/config";
import { computeLine, computeTotals, type ComputedLine } from "@/server/orders/calc";
import {
  billedKg, cleanPieces, estimatedKg, gtin14, mergeCatchWeightSettings, parseWeightLabel, prepayBuffer, pricePerKg, sumKg, tolerancePct, unitEquivalent,
  type CatchWeightSettings, type WeightLabel,
} from "@/lib/catch-weight";

const KEY = "catchweight.settings";
const isStaff = (ctx: Ctx) => ctx.company.type === "ADMIN";
const D = (v: Decimal.Value | { toString(): string } | null | undefined) => new Decimal(v == null ? 0 : v.toString());
const n3 = (v: Decimal.Value | { toString(): string } | null | undefined) => (v == null ? null : Number(D(v).toFixed(3)));

/** Statuses in which an order's weights can still change (after confirmation, before delivery). */
export const WEIGH_STATUSES: OrderStatus[] = ["SUPPLIER_PROCESSING", "READY_FOR_PICKUP", "DISPATCHED", "OUT_FOR_DELIVERY"];

// ── settings ────────────────────────────────────────────────────────────────

export async function catchWeightSettings(db: Tx | typeof prisma = prisma): Promise<CatchWeightSettings> {
  const row = await db.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: KEY } });
  return mergeCatchWeightSettings(row?.value as Partial<CatchWeightSettings> | null);
}

export async function saveCatchWeightSettings(ctx: Ctx, input: CatchWeightSettings) {
  if (!isStaff(ctx) || !can(ctx, "admin.settings.manage")) throw new ForbiddenError();
  const num = (x: unknown, lo: number, hi: number, label: string) => {
    const v = Number(x);
    if (!Number.isFinite(v) || v < lo || v > hi) throw new ValidationError(`${label} must be between ${lo} and ${hi}.`);
    return v;
  };
  const maxOverPct: CatchWeightSettings["maxOverPct"] = { default: num(input.maxOverPct?.default, 0, 50, "The over-weight limit") };
  for (const [code, v] of Object.entries(input.maxOverPct ?? {})) if (/^[A-Z]{2}$/.test(code)) maxOverPct[code] = num(v, 0, 50, `The over-weight limit in ${code}`);
  const prefixes = (input.ean13?.prefixes ?? []).map((p) => String(p).trim()).filter((p) => /^2\d$/.test(p));
  const itemDigits = Math.round(num(input.ean13?.itemDigits, 4, 6, "The item code digits"));
  const valueDigits = Math.round(num(input.ean13?.valueDigits, 4, 6, "The weight digits"));
  if (2 + itemDigits + valueDigits > 12) throw new ValidationError("Prefix + item code + weight must fit in 12 digits.");
  const v: CatchWeightSettings = {
    enabled: !!input.enabled, maxOverPct,
    prepayBufferPct: num(input.prepayBufferPct, 0, 50, "The prepayment buffer"),
    driverCorrection: !!input.driverCorrection, requireWeighing: !!input.requireWeighing,
    ean13: { prefixes: prefixes.length ? prefixes : ["28", "29"], itemDigits, valueDigits, gramsPerUnit: [1, 2, 5, 10].includes(Number(input.ean13?.gramsPerUnit)) ? Number(input.ean13.gramsPerUnit) : 1 },
  };
  const before = await catchWeightSettings();
  const row = await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: KEY } });
  if (row) await prisma.setting.update({ where: { id: row.id }, data: { value: v } });
  else await prisma.setting.create({ data: { scope: "GLOBAL", scopeId: "", key: KEY, value: v } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "catchweight.settings_saved", entityType: "Setting", entityId: KEY, before, after: v });
  return v;
}

// ── offers (supplier) ───────────────────────────────────────────────────────

type OfferCw = { cwMode: CatchWeightMode | null; cwNominalKg: Prisma.Decimal | null; cwMinKg: Prisma.Decimal | null; cwMaxKg: Prisma.Decimal | null; cwMaxOverPct: Prisma.Decimal | null; cwPlu: string | null };

/** Base price (smallest tier of the supplier's base price list) per offer. */
async function basePrices(offerIds: string[]) {
  const rows = await prisma.priceListItem.findMany({
    where: { offerId: { in: offerIds }, priceList: { scope: "BASE", isActive: true } },
    select: { offerId: true, minQty: true, unitPriceNet: true }, orderBy: { minQty: "asc" },
  });
  const m = new Map<string, Decimal>();
  for (const r of rows) if (!m.has(r.offerId)) m.set(r.offerId, D(r.unitPriceNet));
  return m;
}

/** The supplier's offers with their sold-by-weight settings (Products › Sold by Weight). */
export async function vendorCatchWeightOffers(ctx: Ctx, locale: string) {
  if (!can(ctx, "vendor.products.manage") && !can(ctx, "vendor.products.view")) throw new ForbiddenError();
  const offers = await prisma.vendorOffer.findMany({
    where: { vendorCompanyId: ctx.company.id, status: { not: "REJECTED" } },
    select: { id: true, vendorSku: true, status: true, cwMode: true, cwNominalKg: true, cwMinKg: true, cwMaxKg: true, cwMaxOverPct: true, cwPlu: true, packaging: { select: { name: true, variant: { select: { product: { select: { name: true } } } } } } },
    orderBy: { createdAt: "asc" },
  });
  const prices = await basePrices(offers.map((o) => o.id));
  const s = await catchWeightSettings();
  const country = await prisma.country.findUnique({ where: { id: ctx.company.countryId }, select: { code: true } });
  return {
    settings: { enabled: s.enabled, maxOverPct: s.maxOverPct[country?.code ?? ""] ?? s.maxOverPct.default, prefixes: s.ean13.prefixes, itemDigits: s.ean13.itemDigits },
    offers: offers.map((o) => {
      const price = prices.get(o.id) ?? null;
      return {
        id: o.id, sku: o.vendorSku, status: o.status, name: pickLocalized(o.packaging.variant.product.name, locale), packaging: pickLocalized(o.packaging.name, locale),
        mode: o.cwMode, nominalKg: n3(o.cwNominalKg), minKg: n3(o.cwMinKg), maxKg: n3(o.cwMaxKg), maxOverPct: o.cwMaxOverPct == null ? null : Number(o.cwMaxOverPct), plu: o.cwPlu,
        unitPrice: price ? Number(price.toFixed(4)) : null, perKg: price && o.cwNominalKg ? Number(pricePerKg(price, o.cwNominalKg).toFixed(4)) : null,
      };
    }),
  };
}

export type OfferCwInput = { offerId: string; mode: "PIECE" | "KG" | null; nominalKg?: number | null; minKg?: number | null; maxKg?: number | null; maxOverPct?: number | null; plu?: string | null; keepPerKg?: boolean };

/**
 * Turn sold-by-weight on/off for an offer, or change its weights. Prices stay per unit; when the nominal weight of a
 * sold-by-weight offer changes and `keepPerKg` (default), every price of the offer is scaled so the price per kg stays.
 */
export async function saveOfferCatchWeight(ctx: Ctx, i: OfferCwInput) {
  if (!can(ctx, "vendor.products.manage")) throw new ForbiddenError();
  const o = await prisma.vendorOffer.findFirst({ where: { id: i.offerId, vendorCompanyId: ctx.company.id }, select: { id: true, cwMode: true, cwNominalKg: true, cwMinKg: true, cwMaxKg: true, cwMaxOverPct: true, cwPlu: true } });
  if (!o) throw new NotFoundError("Product");
  let data: OfferCw;
  if (!i.mode) data = { cwMode: null, cwNominalKg: null, cwMinKg: null, cwMaxKg: null, cwMaxOverPct: null, cwPlu: null };
  else {
    const kg = (v: unknown, label: string, req = false) => {
      if (v == null || v === "") { if (req) throw new ValidationError(`${label} is required.`); return null; }
      const x = Number(v);
      if (!Number.isFinite(x) || x <= 0 || x >= 1000) throw new ValidationError(`${label} must be more than 0 and less than 1000 kg.`);
      return new Decimal(x).toDecimalPlaces(3);
    };
    const nominal = kg(i.nominalKg, i.mode === "PIECE" ? "The average weight" : "The weight of one unit", true)!;
    const min = i.mode === "PIECE" ? kg(i.minKg, "The lightest piece") : null;
    const max = i.mode === "PIECE" ? kg(i.maxKg, "The heaviest piece") : null;
    if (min && max && min.gt(max)) throw new ValidationError("The lightest piece can't be heavier than the heaviest.");
    if (min && nominal.lt(min)) throw new ValidationError("The average weight can't be below the lightest piece.");
    if (max && nominal.gt(max)) throw new ValidationError("The average weight can't be above the heaviest piece.");
    const pct = i.maxOverPct == null || (i.maxOverPct as unknown) === "" ? null : Number(i.maxOverPct);
    if (pct != null && (!Number.isFinite(pct) || pct < 0 || pct > 50)) throw new ValidationError("Your over-weight limit must be between 0 and 50 %.");
    const plu = i.plu?.trim() || null;
    if (plu && !/^\d{4,6}$/.test(plu)) throw new ValidationError("The scale item code is 4 to 6 digits.");
    data = { cwMode: i.mode, cwNominalKg: nominal as unknown as Prisma.Decimal, cwMinKg: min as unknown as Prisma.Decimal, cwMaxKg: max as unknown as Prisma.Decimal, cwMaxOverPct: pct == null ? null : (new Decimal(pct) as unknown as Prisma.Decimal), cwPlu: plu };
  }
  const scale = o.cwMode && data.cwMode && o.cwNominalKg && i.keepPerKg !== false && !D(o.cwNominalKg).eq(D(data.cwNominalKg)) ? D(data.cwNominalKg).div(D(o.cwNominalKg)) : null;
  if (scale && !can(ctx, "vendor.pricing.manage")) throw new ForbiddenError();
  await prisma.$transaction(async (tx) => {
    await tx.vendorOffer.update({ where: { id: o.id }, data: { cwMode: data.cwMode, cwNominalKg: data.cwNominalKg?.toString() ?? null, cwMinKg: data.cwMinKg?.toString() ?? null, cwMaxKg: data.cwMaxKg?.toString() ?? null, cwMaxOverPct: data.cwMaxOverPct?.toString() ?? null, cwPlu: data.cwPlu } });
    if (scale) {
      const items = await tx.priceListItem.findMany({ where: { offerId: o.id }, select: { id: true, unitPriceNet: true } });
      for (const it of items) await tx.priceListItem.update({ where: { id: it.id }, data: { unitPriceNet: D(it.unitPriceNet).mul(scale).toDecimalPlaces(4).toFixed(4) } });
    }
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "catchweight.offer_saved", entityType: "VendorOffer", entityId: o.id, before: o, after: { ...data, pricesScaledBy: scale?.toFixed(6) ?? null } }, tx);
  });
}

/** Sold-by-weight info for buyer pages (product page, cards, cart): per offer. */
export async function offerCatchWeight(offerIds: string[]) {
  if (!offerIds.length) return new Map<string, { mode: CatchWeightMode; nominalKg: number; minKg: number | null; maxKg: number | null }>();
  const s = await catchWeightSettings();
  if (!s.enabled) return new Map();
  const rows = await prisma.vendorOffer.findMany({ where: { id: { in: offerIds }, cwMode: { not: null } }, select: { id: true, cwMode: true, cwNominalKg: true, cwMinKg: true, cwMaxKg: true } });
  return new Map(rows.map((r) => [r.id, { mode: r.cwMode!, nominalKg: n3(r.cwNominalKg)!, minKg: n3(r.cwMinKg), maxKg: n3(r.cwMaxKg) }]));
}

// ── orders ──────────────────────────────────────────────────────────────────

/** At checkout: snapshot the sold-by-weight settings on the order's lines (FIRINGI's limit or the supplier's tighter one). */
export async function attachToOrder(tx: Tx, orderId: string) {
  const s = await catchWeightSettings(tx);
  if (!s.enabled) return 0;
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { country: { select: { code: true } }, lines: { select: { id: true, offer: { select: { cwMode: true, cwNominalKg: true, cwMaxOverPct: true } } } } } });
  let n = 0;
  for (const l of order.lines) {
    const o = l.offer;
    if (!o.cwMode || !o.cwNominalKg) continue;
    const tol = tolerancePct(s, order.country.code, o.cwMaxOverPct == null ? null : Number(o.cwMaxOverPct));
    await tx.orderLine.update({ where: { id: l.id }, data: { cwMode: o.cwMode, cwNominalKg: o.cwNominalKg, cwMaxOverPct: tol.toFixed(2) } });
    n++;
  }
  return n;
}

/** Pay-before-shipping: the buffer added to what is paid up front (on the sold-by-weight lines). */
export async function prepayBufferFor(tx: Tx, orderId: string) {
  const s = await catchWeightSettings(tx);
  if (!s.enabled || s.prepayBufferPct <= 0) return new Decimal(0);
  const lines = await tx.orderLine.findMany({ where: { orderId, cwMode: { not: null } }, select: { lineNet: true, lineVat: true } });
  if (!lines.length) return new Decimal(0);
  return prepayBuffer(lines.reduce((a, l) => a.plus(D(l.lineNet)).plus(D(l.lineVat)), new Decimal(0)), s.prepayBufferPct);
}

/** What a pay-before-shipping buyer must pay before the order goes to the supplier: total + the weight buffer. */
export const prepayDue = (o: { grandTotal: { toString(): string }; prepayBuffer?: { toString(): string } | null }) => D(o.grandTotal).plus(D(o.prepayBuffer ?? 0));

type LineRow = Prisma.OrderLineGetPayload<object>;

const unitsOf = (l: Pick<LineRow, "qtyDelivered" | "qtyConfirmed" | "qtyOrdered">) => l.qtyDelivered ?? l.qtyConfirmed ?? l.qtyOrdered;

/** The line's billing on its weight (or the estimate). */
export function lineBilling(l: Pick<LineRow, "qtyDelivered" | "qtyConfirmed" | "qtyOrdered" | "cwNominalKg" | "cwActualKg" | "cwMaxOverPct" | "cwOverAccepted">) {
  return billedKg({ units: unitsOf(l), nominalKg: D(l.cwNominalKg), actualKg: l.cwActualKg == null ? null : D(l.cwActualKg), tolerancePct: Number(l.cwMaxOverPct ?? 0), accepted: l.cwOverAccepted });
}

/**
 * Re-price an order with sold-by-weight lines: weighed lines on their billed weight, the others as they are;
 * then the order totals (same rules as a confirmation with other quantities). No-op without such lines.
 */
export async function repriceOrder(tx: Tx, orderId: string) {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
  if (!order.lines.some((l) => l.cwMode)) return false;
  const calc: ComputedLine[] = [];
  for (const l of order.lines) {
    const units = unitsOf(l);
    const commissionUnitBase = l.dealId ? l.unitListPriceNet.minus(l.vendorFundedDiscount).toString() : null;
    const base = {
      unitListPriceNet: l.unitListPriceNet.toString(), vatRatePercent: l.taxRate.toString(), commissionRatePercent: l.commissionRate?.toString() ?? 0,
      vendorFundedDiscountPerUnit: l.vendorFundedDiscount.toString(), firingiFundedDiscountPerUnit: l.firingiFundedDiscount.toString(), commissionUnitBase,
    };
    if (!l.cwMode || !l.cwNominalKg) {
      calc.push({ ...computeLine({ ...base, qty: units }), qty: units });
      continue;
    }
    const b = lineBilling(l);
    const q = units > 0 ? unitEquivalent(b.billed, l.cwNominalKg.toString()) : new Decimal(0);
    const c = computeLine({ ...base, qty: q });
    calc.push({ ...c, qty: q.toNumber() });
    // discounts reported per line follow the same factor
    const prevQ = l.cwBilledKg != null ? unitEquivalent(l.cwBilledKg.toString(), l.cwNominalKg.toString()) : new Decimal(units);
    if (!prevQ.eq(q) && prevQ.gt(0)) {
      const f = q.div(prevQ);
      const ds = await tx.orderLineDiscount.findMany({ where: { orderLineId: l.id } });
      for (const d of ds) await tx.orderLineDiscount.update({ where: { id: d.id }, data: { amount: D(d.amount).mul(f).toFixed(2), firingiAmount: D(d.firingiAmount).mul(f).toFixed(2), vendorAmount: D(d.vendorAmount).mul(f).toFixed(2) } });
    }
    await tx.orderLine.update({
      where: { id: l.id },
      data: {
        cwBilledKg: b.billed.toFixed(3), lineNet: c.lineNet.toFixed(2), lineVat: c.lineVat.toFixed(2), commissionBase: c.commissionBase.toFixed(2), commissionAmount: c.commissionAmount.toFixed(2),
        vendorLineNet: c.vendorLineNet.toFixed(2), vendorUnitCostNet: units > 0 ? c.vendorLineNet.div(units).toFixed(4) : l.vendorUnitCostNet.toString(),
      },
    });
  }
  // delivery fee VAT exactly as charged at checkout (the fee itself doesn't change)
  const goodsVatBefore = order.lines.reduce((a, l) => a.plus(D(l.lineVat)), new Decimal(0));
  const feeVat = D(order.vatTotal).minus(goodsVatBefore);
  const feeNet = D(order.deliveryFeeNet);
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
  return true;
}

/** Order → DISPATCHED: when FIRINGI requires it, every sold-by-weight line must be weighed first. */
export async function assertWeighedForDispatch(tx: Tx, orderId: string) {
  const s = await catchWeightSettings(tx);
  if (!s.enabled || !s.requireWeighing) return;
  const open = await tx.orderLine.count({ where: { orderId, cwMode: { not: null }, cwActualKg: null, qtyOrdered: { gt: 0 } } });
  if (open) throw new AppError("NOT_WEIGHED", "Weigh the products sold by weight before dispatching this order.", 409);
}

type WeighOpts = { source: CatchWeightSource; userId: string | null; barcode?: string | null; note?: string | null; append?: boolean };

/** Record a weighing of one line (inside a transaction) and re-price the order. */
async function weighTx(tx: Tx, lineId: string, pieces: number[], o: WeighOpts) {
  const line = await tx.orderLine.findUniqueOrThrow({ where: { id: lineId }, include: { order: { select: { id: true, status: true } }, weighings: { orderBy: { at: "desc" }, take: 1 } } });
  if (!line.cwMode) throw new ValidationError("This product isn't sold by weight.");
  if (!WEIGH_STATUSES.includes(line.order.status)) throw new AppError("BAD_STATUS", "Weights can only change after the order is confirmed and before it is delivered.", 409);
  const all = o.append && line.weighings[0] ? [...((line.weighings[0].pieces as number[]) ?? []), ...pieces] : pieces;
  const total = sumKg(all);
  await tx.catchWeighing.create({ data: { orderLineId: line.id, pieces: all, totalKg: total.toFixed(3), source: o.source, barcode: o.barcode ?? null, note: o.note?.trim() || null, byUserId: o.userId } });
  await tx.orderLine.update({ where: { id: line.id }, data: { cwActualKg: total.toFixed(3), cwWeighedAt: new Date() } });
  await repriceOrder(tx, line.orderId);
  const fresh = await tx.orderLine.findUniqueOrThrow({ where: { id: line.id } });
  return { line: fresh, billing: lineBilling(fresh), orderId: line.orderId, wasOver: line.cwActualKg != null && lineBilling(line).over };
}

/** Who may weigh: the seller (orders / warehouse staff) or FIRINGI's order staff. */
async function lineForSeller(ctx: Ctx, lineId: string) {
  const l = await prisma.orderLine.findUnique({ where: { id: lineId }, select: { id: true, orderId: true, offerId: true, cwMode: true, order: { select: { sellerCompanyId: true, status: true, number: true, buyerCompanyId: true } } } });
  if (!l) throw new NotFoundError("Order line");
  const seller = l.order.sellerCompanyId === ctx.company.id && (can(ctx, "vendor.orders.manage") || can(ctx, "vendor.warehouse.pick") || can(ctx, "vendor.inventory.manage"));
  const staff = isStaff(ctx) && can(ctx, "admin.orders.manage");
  if (!seller && !staff) throw new ForbiddenError();
  return l;
}

async function afterWeigh(r: Awaited<ReturnType<typeof weighTx>>) {
  if (!r.billing.over || r.wasOver || r.line.cwOverAccepted) return;
  const o = await prisma.order.findUniqueOrThrow({ where: { id: r.orderId }, select: { number: true, buyerCompanyId: true } });
  await notify("catchweight.over_limit", [{ companyId: o.buyerCompanyId, link: `/buy/orders/${r.orderId}` }], {
    number: o.number, product: pickLocalized(r.line.productName as Record<string, string>, "pt"), weighed: Number(r.line.cwActualKg), max: Number(r.billing.maxKg.toFixed(3)),
  }, { ref: { type: "Order", id: r.orderId } });
}

/** Weights typed (picking / order page): kg per piece; replaces the line's earlier weighing. */
export async function recordWeights(ctx: Ctx, i: { orderLineId: string; pieces: unknown; source?: "PICK" | "SUPPLIER"; note?: string | null }) {
  const l = await lineForSeller(ctx, i.orderLineId);
  const pieces = cleanPieces(i.pieces);
  if (!pieces) throw new ValidationError("Enter the weight of each piece in kg (more than 0).");
  const r = await prisma.$transaction(async (tx) => {
    const res = await weighTx(tx, l.id, pieces, { source: i.source === "PICK" ? "PICK" : "SUPPLIER", userId: ctx.user.id, note: i.note });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "catchweight.weighed", entityType: "OrderLine", entityId: l.id, after: { pieces, totalKg: res.line.cwActualKg?.toString(), source: i.source ?? "SUPPLIER" } }, tx);
    return res;
  });
  await afterWeigh(r);
  return { totalKg: Number(r.line.cwActualKg), billedKg: Number(r.billing.billed), maxKg: Number(r.billing.maxKg), over: r.billing.over, capped: r.billing.capped };
}

/** Does a scale label belong to this offer? (EAN-13: the scale item code or the SKU's digits; GS1: the GTIN.) */
async function labelMatches(offerId: string, label: WeightLabel) {
  const o = await prisma.vendorOffer.findUniqueOrThrow({ where: { id: offerId }, select: { cwPlu: true, vendorSku: true, packaging: { select: { gtin: true, variant: { select: { gtin: true } } } } } });
  if (label.kind === "EAN13") {
    const codes = [o.cwPlu, o.vendorSku?.replace(/\D/g, "")].filter((x): x is string => !!x).map((x) => x.padStart(label.item.length, "0"));
    return codes.includes(label.item);
  }
  if (!label.gtin) return true; // weight only: the picker has the line open
  return [o.packaging.gtin, o.packaging.variant.gtin].map(gtin14).includes(gtin14(label.gtin));
}

export type LabelOutcome = "OK" | "NOT_A_LABEL" | "WRONG_ITEM" | "NOT_SOLD_BY_WEIGHT";

/** A scanned scale label adds one piece to the line. */
export async function scanWeightLabel(ctx: Ctx, orderLineId: string, code: string): Promise<{ outcome: LabelOutcome; kg?: number; totalKg?: number; pieces?: number; over?: boolean }> {
  const l = await lineForSeller(ctx, orderLineId);
  if (!l.cwMode) return { outcome: "NOT_SOLD_BY_WEIGHT" };
  const s = await catchWeightSettings();
  const label = parseWeightLabel(code, s.ean13);
  if (!label) return { outcome: "NOT_A_LABEL" };
  if (!(await labelMatches(l.offerId, label))) return { outcome: "WRONG_ITEM" };
  const r = await prisma.$transaction((tx) => weighTx(tx, l.id, [label.kg], { source: "SCAN", userId: ctx.user.id, barcode: label.code, append: true }));
  await afterWeigh(r);
  const last = await prisma.catchWeighing.findFirst({ where: { orderLineId: l.id }, orderBy: { at: "desc" }, select: { pieces: true } });
  return { outcome: "OK", kg: label.kg, totalKg: Number(r.line.cwActualKg), pieces: ((last?.pieces as number[]) ?? []).length, over: r.billing.over };
}

/** Picking (Phase 25): a scanned code on a pick line that is a matching scale label → also records the piece. */
export async function pickLabel(ctx: Ctx, orderId: string, offerId: string, code: string) {
  const s = await catchWeightSettings();
  const label = parseWeightLabel(code, s.ean13);
  if (!label) return null;
  const line = await prisma.orderLine.findFirst({ where: { orderId, offerId, cwMode: { not: null } }, select: { id: true } });
  if (!line) return null;
  if (!(await labelMatches(offerId, label))) return { ok: false as const };
  const r = await prisma.$transaction((tx) => weighTx(tx, line.id, [label.kg], { source: "SCAN", userId: ctx.user.id, barcode: label.code, append: true }));
  await afterWeigh(r);
  return { ok: true as const, kg: label.kg, totalKg: Number(r.line.cwActualKg) };
}

/** The buyer accepts the extra weight on a line above the limit (or every such line). */
export async function acceptOverWeight(ctx: Ctx, orderId: string, lineId?: string | null) {
  if (!can(ctx, "buyer.orders.place")) throw new ForbiddenError();
  const o = await prisma.order.findFirst({ where: { id: orderId, buyerCompanyId: ctx.company.id }, select: { id: true, number: true, status: true, sellerCompanyId: true, lines: { where: { cwMode: { not: null }, ...(lineId ? { id: lineId } : {}) } } } });
  if (!o) throw new NotFoundError("Order");
  if (!WEIGH_STATUSES.includes(o.status)) throw new AppError("BAD_STATUS", "The weights of this order can't change any more.", 409);
  const over = o.lines.filter((l) => lineBilling(l).over && !l.cwOverAccepted);
  if (!over.length) throw new ValidationError("Nothing above the weight limit to accept.");
  await prisma.$transaction(async (tx) => {
    await tx.orderLine.updateMany({ where: { id: { in: over.map((l) => l.id) } }, data: { cwOverAccepted: true } });
    await repriceOrder(tx, o.id);
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "catchweight.over_accepted", entityType: "Order", entityId: o.id, after: { lines: over.map((l) => l.id) } }, tx);
  });
  await notify("catchweight.over_accepted", [{ companyId: o.sellerCompanyId, link: `/vendor/orders/${o.id}` }], { number: o.number }, { ref: { type: "Order", id: o.id } });
}

/**
 * At the stop (inside the delivery transaction): the driver's corrected weights (total kg per line) and whether the
 * customer accepted weight above the limit. Ignored when FIRINGI has switched driver correction off.
 */
export async function recordStopWeights(tx: Tx, orderId: string, weights: Record<string, number> | null | undefined, acceptOver: boolean, userId: string) {
  const s = await catchWeightSettings(tx);
  if (!s.enabled) return;
  const lines = await tx.orderLine.findMany({ where: { orderId, cwMode: { not: null } }, select: { id: true, cwActualKg: true } });
  if (!lines.length) return;
  if (s.driverCorrection && weights)
    for (const l of lines) {
      const v = weights[l.id];
      if (v == null || !Number.isFinite(Number(v)) || Number(v) <= 0 || Number(v) >= 10_000) continue;
      if (l.cwActualKg != null && D(l.cwActualKg).eq(new Decimal(Number(v)).toDecimalPlaces(3))) continue;
      await weighTx(tx, l.id, [Math.round(Number(v) * 1000) / 1000], { source: "DRIVER", userId, note: "Corrected at delivery" });
    }
  if (acceptOver) {
    await tx.orderLine.updateMany({ where: { orderId, cwMode: { not: null } }, data: { cwOverAccepted: true } });
    await repriceOrder(tx, orderId);
  }
}

// ── views ───────────────────────────────────────────────────────────────────

/** Sold-by-weight lines of an order, as each side may see them (buyer: its price per kg; supplier: its own). */
export async function orderWeights(ctx: Ctx, orderId: string, as: "BUYER" | "SUPPLIER" | "ADMIN" | "DRIVER", locale: string) {
  const o = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, status: true, buyerCompanyId: true, sellerCompanyId: true, prepayBuffer: true, awaitingPayment: true, grandTotal: true, lines: { where: { cwMode: { not: null } }, include: { weighings: { orderBy: { at: "desc" }, take: 5 } } } },
  });
  if (!o) throw new NotFoundError("Order");
  if (as === "BUYER" && o.buyerCompanyId !== ctx.company.id) throw new ForbiddenError();
  if (as === "SUPPLIER" && o.sellerCompanyId !== ctx.company.id) throw new ForbiddenError();
  if (as === "ADMIN" && !isStaff(ctx)) throw new ForbiddenError();
  const s = await catchWeightSettings();
  const lines = o.lines.map((l) => {
    const b = lineBilling(l);
    const units = unitsOf(l);
    const nominal = D(l.cwNominalKg);
    // supplier: what FIRINGI pays it per kg (its own amount); buyer / staff: the sale price per kg
    const supplierPerKg = b.billed.gt(0) && l.cwBilledKg != null ? D(l.vendorLineNet).div(b.billed) : D(l.vendorUnitCostNet).div(nominal);
    const last = l.weighings[0];
    return {
      id: l.id, product: pickLocalized(l.productName as Record<string, string>, locale), packaging: pickLocalized(l.packagingName as Record<string, string>, locale), sku: l.sku,
      mode: l.cwMode!, units, nominalKg: Number(nominal), estimatedKg: Number(estimatedKg(units, nominal)), actualKg: n3(l.cwActualKg), billedKg: Number(b.billed), maxKg: Number(b.maxKg),
      tolerancePct: Number(l.cwMaxOverPct ?? 0), over: b.over, capped: b.capped, accepted: l.cwOverAccepted, weighed: b.weighed,
      perKg: as === "SUPPLIER" ? Number(supplierPerKg.toFixed(4)) : Number(pricePerKg(D(l.unitSalePriceNet), nominal).toFixed(4)), amountNet: as === "SUPPLIER" ? Number(l.vendorLineNet) : Number(l.lineNet),
      pieces: last ? ((last.pieces as number[]) ?? []) : [], source: last?.source ?? null, weighedAt: l.cwWeighedAt,
      history: as === "BUYER" ? [] : l.weighings.map((w) => ({ at: w.at, source: w.source, totalKg: Number(w.totalKg), pieces: (w.pieces as number[]).length })),
    };
  });
  return {
    lines, canWeigh: WEIGH_STATUSES.includes(o.status) && as !== "BUYER", canAccept: as === "BUYER" && WEIGH_STATUSES.includes(o.status) && lines.some((l) => l.over && !l.accepted),
    driverCorrection: s.driverCorrection, prepayBuffer: as === "SUPPLIER" ? 0 : Number(o.prepayBuffer), awaitingPayment: o.awaitingPayment,
  };
}

/** Driver's stop: the sold-by-weight lines to check (no prices). */
export async function stopWeights(orderId: string, locale: string) {
  const s = await catchWeightSettings();
  if (!s.enabled) return { correction: false, lines: [] as { id: string; product: string; units: number; mode: CatchWeightMode; estimatedKg: number; actualKg: number | null; maxKg: number; over: boolean; accepted: boolean }[] };
  const lines = await prisma.orderLine.findMany({ where: { orderId, cwMode: { not: null } } });
  return {
    correction: s.driverCorrection,
    lines: lines.map((l) => {
      const b = lineBilling(l);
      return { id: l.id, product: pickLocalized(l.productName as Record<string, string>, locale), units: unitsOf(l), mode: l.cwMode!, estimatedKg: Number(estimatedKg(unitsOf(l), D(l.cwNominalKg))), actualKg: n3(l.cwActualKg), maxKg: Number(b.maxKg), over: b.over, accepted: l.cwOverAccepted };
    }),
  };
}

type VarRow = { companyId: string; name: string; lines: number; weighed: number; estKg: number; actualKg: number; billedKg: number; over: number; capped: number; cappedNet: number };

/** Variance on delivered sold-by-weight lines (last `days` days), per supplier or per product. */
async function varianceRows(where: Prisma.Sql, groupBy: "supplier" | "offer", days: number) {
  const { Prisma: P } = await import("@prisma/client");
  const key = groupBy === "supplier" ? P.sql`o."sellerCompanyId"` : P.sql`l."offerId"`;
  return prisma.$queryRaw<{ id: string; lines: number; weighed: number; est: number; actual: number; billed: number; over: number; capped: number; capped_net: number }[]>`
    SELECT ${key} AS id, count(*)::int AS lines, count(l."cwActualKg")::int AS weighed,
      coalesce(sum(l."cwNominalKg" * coalesce(l."qtyDelivered", l."qtyConfirmed", l."qtyOrdered")), 0)::float AS est,
      coalesce(sum(coalesce(l."cwActualKg", l."cwNominalKg" * coalesce(l."qtyDelivered", l."qtyConfirmed", l."qtyOrdered"))), 0)::float AS actual,
      coalesce(sum(l."cwBilledKg"), 0)::float AS billed,
      count(*) FILTER (WHERE l."cwActualKg" > l."cwNominalKg" * coalesce(l."qtyDelivered", l."qtyConfirmed", l."qtyOrdered") * (1 + coalesce(l."cwMaxOverPct", 0) / 100))::int AS over,
      count(*) FILTER (WHERE l."cwActualKg" > l."cwBilledKg")::int AS capped,
      coalesce(sum(CASE WHEN l."cwActualKg" > l."cwBilledKg" AND l."cwBilledKg" > 0 THEN l."lineNet" * (l."cwActualKg" - l."cwBilledKg") / l."cwBilledKg" ELSE 0 END), 0)::float AS capped_net
    FROM "OrderLine" l JOIN "Order" o ON o.id = l."orderId"
    WHERE l."cwMode" IS NOT NULL AND o.status = 'DELIVERED' AND o."updatedAt" > now() - make_interval(days => ${days}::int) AND ${where}
    GROUP BY 1`;
}

/** FIRINGI: sold-by-weight overview (variance per supplier, lines above the limit, unweighed deliveries). */
export async function adminOverview(ctx: Ctx, days = 90) {
  if (!isStaff(ctx) || !can(ctx, "admin.orders.view")) throw new ForbiddenError();
  const { Prisma: P } = await import("@prisma/client");
  const rows = await varianceRows(P.sql`true`, "supplier", days);
  const companies = await prisma.company.findMany({ where: { id: { in: rows.map((r) => r.id) } }, select: { id: true, legalName: true, tradeName: true } });
  const suppliers: VarRow[] = rows.map((r) => {
    const c = companies.find((x) => x.id === r.id);
    return { companyId: r.id, name: c?.tradeName ?? c?.legalName ?? r.id, lines: r.lines, weighed: r.weighed, estKg: r.est, actualKg: r.actual, billedKg: r.billed, over: r.over, capped: r.capped, cappedNet: Math.round(r.capped_net * 100) / 100 };
  }).sort((a, b) => b.lines - a.lines);
  const offers = await prisma.vendorOffer.count({ where: { cwMode: { not: null } } });
  const open = await prisma.orderLine.findMany({
    where: { cwMode: { not: null }, order: { status: { in: WEIGH_STATUSES } } },
    select: { id: true, cwActualKg: true, cwNominalKg: true, cwMaxOverPct: true, cwOverAccepted: true, qtyOrdered: true, qtyConfirmed: true, qtyDelivered: true, productName: true, order: { select: { id: true, number: true, status: true, seller: { select: { legalName: true, tradeName: true } }, buyer: { select: { legalName: true, tradeName: true } } } } },
    orderBy: { order: { placedAt: "desc" } }, take: 200,
  });
  return {
    settings: await catchWeightSettings(), offers, suppliers,
    open: open.map((l) => {
      const b = lineBilling(l);
      return { id: l.id, orderId: l.order.id, number: l.order.number, status: l.order.status, product: pickLocalized(l.productName as Record<string, string>, "en"), supplier: l.order.seller.tradeName ?? l.order.seller.legalName, customer: l.order.buyer.tradeName ?? l.order.buyer.legalName, estimatedKg: Number(estimatedKg(unitsOf(l), D(l.cwNominalKg))), actualKg: n3(l.cwActualKg), maxKg: Number(b.maxKg), over: b.over, accepted: l.cwOverAccepted };
    }),
  };
}

/** Supplier: weighing report per product (delivered orders, last `days` days) + orders still to weigh. */
export async function vendorReport(ctx: Ctx, locale: string, days = 90) {
  if (!can(ctx, "vendor.orders.view") && !can(ctx, "vendor.orders.manage")) throw new ForbiddenError();
  const { Prisma: P } = await import("@prisma/client");
  const rows = await varianceRows(P.sql`o."sellerCompanyId" = ${ctx.company.id}`, "offer", days);
  const offers = await prisma.vendorOffer.findMany({ where: { id: { in: rows.map((r) => r.id) } }, select: { id: true, packaging: { select: { name: true, variant: { select: { product: { select: { name: true } } } } } } } });
  const toWeigh = await prisma.orderLine.findMany({
    where: { cwMode: { not: null }, cwActualKg: null, order: { sellerCompanyId: ctx.company.id, status: { in: WEIGH_STATUSES } } },
    select: { id: true, qtyOrdered: true, qtyConfirmed: true, qtyDelivered: true, cwNominalKg: true, productName: true, order: { select: { id: true, number: true, status: true, requestedDeliveryDate: true } } },
    orderBy: { order: { placedAt: "asc" } }, take: 200,
  });
  return {
    products: rows.map((r) => {
      const o = offers.find((x) => x.id === r.id);
      return { offerId: r.id, name: o ? `${pickLocalized(o.packaging.variant.product.name, locale)} · ${pickLocalized(o.packaging.name, locale)}` : r.id, lines: r.lines, weighed: r.weighed, estKg: r.est, actualKg: r.actual, billedKg: r.billed, over: r.over, capped: r.capped };
    }),
    toWeigh: toWeigh.map((l) => ({ id: l.id, orderId: l.order.id, number: l.order.number, status: l.order.status, date: l.order.requestedDeliveryDate, product: pickLocalized(l.productName as Record<string, string>, locale), units: unitsOf(l), estimatedKg: Number(estimatedKg(unitsOf(l), D(l.cwNominalKg))) })),
  };
}

/** Invoice line text for a weighed line: "… · 7,240 kg × 12,0000 €/kg". */
export function invoiceWeightText(l: { cwBilledKg: { toString(): string } | null; cwNominalKg: { toString(): string } | null; unitSalePriceNet: { toString(): string } }) {
  if (l.cwBilledKg == null || !l.cwNominalKg) return "";
  const kg = D(l.cwBilledKg).toFixed(3).replace(".", ",");
  const perKg = pricePerKg(D(l.unitSalePriceNet), D(l.cwNominalKg)).toFixed(4).replace(".", ",");
  return ` · ${kg} kg × ${perKg} €/kg`;
}

/** FIRINGI settings page: the countries a limit can be set for. */
export async function settingsCountries(ctx: Ctx) {
  if (!isStaff(ctx) || !can(ctx, ["admin.settings.view", "admin.settings.manage"])) throw new ForbiddenError();
  const rows = await prisma.country.findMany({ where: { isSchengen: true }, select: { code: true, name: true }, orderBy: { code: "asc" } });
  return rows.map((c) => ({ code: c.code, name: pickLocalized(c.name, "en") || c.code }));
}
