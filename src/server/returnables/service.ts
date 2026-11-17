/**
 * Returnables & deposits (Phase 40). See prisma/schema/returnables.prisma for the model.
 *
 * Money: deposits are lines on FIRINGI's delivery invoice (after the goods and the delivery fee) and on the
 * supplier's billing statement (pass-through, no commission). Empties that come back are credited by credit
 * notes on the newest deposit invoices first, never more than the deposits the customer still has paid in;
 * the supplier gets a matching credit statement. Swaps (EXCHANGE) cancel the deposit for those units: nothing
 * is charged or refunded for them.
 */
import "server-only";
import type { EmptiesSource, Prisma, ReturnableCategory, ReturnableKind } from "@prisma/client";
import Decimal from "decimal.js";
import { prisma, type Tx } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";
import { notify } from "@/server/notify/dispatch";
import { pickLocalized } from "@/i18n/config";
import {
  ageUnits, chargedUnits, DEPOSIT_PREFIX, depositVatRate, mergeReturnableSettings, overdueRule, overdueUnits, RETURNABLE_CATEGORIES, splitEmpties, unitsFor,
  type ReturnableSettings,
} from "@/lib/returnables";

const KEY = "returnables.settings";
const REMINDED = "returnables.reminded";
const r2 = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const isVendor = (ctx: Ctx) => ctx.company.type === "DISTRIBUTOR" || ctx.company.type === "WHOLESALER";
const isBuyer = (ctx: Ctx) => ctx.company.type === "CUSTOMER" || ctx.company.type === "WHOLESALER";
const isStaff = (ctx: Ctx) => ctx.company.type === "ADMIN";
const adminCompany = () => prisma.company.findFirst({ where: { type: "ADMIN" }, select: { id: true } });
const cname = (c: { tradeName: string | null; legalName: string } | null | undefined) => (c ? c.tradeName ?? c.legalName : "");
const nameOf = (t: { name: unknown }, locale = "pt") => pickLocalized(t.name, locale);
/** The description of a deposit line on an invoice: the code in brackets finds it again for refunds. */
const depositLabel = (t: { name: unknown; code: string }) => `${DEPOSIT_PREFIX}: ${nameOf(t, "pt")} [${t.code}]`;

async function nextNo(tx: Tx, name: string, prefix: string) {
  const year = new Date().getFullYear();
  const rows = await tx.$queryRaw<{ n: number }[]>`INSERT INTO "Sequence" (name, year, "nextValue") VALUES (${name}, ${year}, 2)
    ON CONFLICT (name, year) DO UPDATE SET "nextValue" = "Sequence"."nextValue" + 1 RETURNING "nextValue" - 1 AS n`;
  return `${prefix}-${year}-${String(rows[0].n).padStart(6, "0")}`;
}

// ── settings ────────────────────────────────────────────────────────────────

export async function returnableSettings(db: Tx | typeof prisma = prisma): Promise<ReturnableSettings> {
  const row = await db.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: KEY } });
  return mergeReturnableSettings(row?.value as Partial<ReturnableSettings> | null);
}

export async function saveReturnableSettings(ctx: Ctx, input: ReturnableSettings) {
  if (!isStaff(ctx) || !can(ctx, "admin.settings.manage")) throw new ForbiddenError();
  const n = (x: unknown, lo: number, hi: number, label: string) => { const v = Number(x); if (!Number.isFinite(v) || v < lo || v > hi) throw new ValidationError(`${label} must be between ${lo} and ${hi}.`); return v; };
  const act = (a: unknown) => (a === "KEEP" ? "KEEP" : "REMIND") as "KEEP" | "REMIND";
  const vat: ReturnableSettings["vat"] = {};
  for (const [code, r] of Object.entries(input.vat ?? {})) {
    if (!/^[A-Z]{2}$/.test(code)) continue;
    const mode = r.mode === "NONE" || r.mode === "FIXED" ? r.mode : "PRODUCT";
    vat[code] = mode === "FIXED" ? { mode, rate: n(r.rate, 0, 30, `The deposit VAT in ${code}`) } : { mode };
  }
  const suppliers: ReturnableSettings["suppliers"] = {};
  for (const [id, r] of Object.entries(input.suppliers ?? {})) suppliers[id] = { days: Math.round(n(r.days, 7, 730, "The days before empties are overdue")), action: act(r.action) };
  const v: ReturnableSettings = {
    enabled: !!input.enabled, vat,
    overdue: { days: Math.round(n(input.overdue?.days, 7, 730, "The days before empties are overdue")), action: act(input.overdue?.action), remindEveryDays: Math.round(n(input.overdue?.remindEveryDays, 1, 90, "The days between reminders")) },
    suppliers, creditDamaged: !!input.creditDamaged, pickups: !!input.pickups, pickupMinUnits: Math.round(n(input.pickupMinUnits, 1, 500, "The smallest pickup")),
  };
  const before = await returnableSettings();
  const row = await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: KEY } });
  if (row) await prisma.setting.update({ where: { id: row.id }, data: { value: v } });
  else await prisma.setting.create({ data: { scope: "GLOBAL", scopeId: "", key: KEY, value: v } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "returnables.settings_saved", entityType: "Setting", entityId: KEY, before, after: v });
  return v;
}

// ── types & product links ───────────────────────────────────────────────────

export type TypeInput = { id?: string | null; code: string; name: string; category: string; kind: string; depositNet: number; active?: boolean };

/** FIRINGI's shared list + the caller's own types (staff: every type). */
export async function listTypes(ctx: Ctx, locale = "en") {
  const where: Prisma.ReturnableTypeWhereInput = isStaff(ctx) ? {} : { OR: [{ ownerCompanyId: null }, { ownerCompanyId: ctx.company.id }] };
  const rows = await prisma.returnableType.findMany({ where, orderBy: [{ ownerCompanyId: { sort: "asc", nulls: "first" } }, { code: "asc" }], include: { owner: { select: { legalName: true, tradeName: true } }, _count: { select: { links: true } } } });
  return rows.map((t) => ({
    id: t.id, code: t.code, name: nameOf(t, locale), names: t.name as Record<string, string>, category: t.category, kind: t.kind, depositNet: Number(t.depositNet), active: t.active,
    shared: !t.ownerCompanyId, mine: t.ownerCompanyId === ctx.company.id, owner: t.owner ? cname(t.owner) : "FIRINGI", products: t._count.links,
  }));
}

export async function saveType(ctx: Ctx, i: TypeInput, locale = "en") {
  const shared = isStaff(ctx);
  if (shared ? !can(ctx, ["admin.catalogue.manage", "admin.settings.manage"]) : !(isVendor(ctx) && can(ctx, "vendor.products.manage"))) throw new ForbiddenError();
  const code = i.code.trim().toUpperCase().replace(/[^A-Z0-9-]+/g, "-").slice(0, 30);
  const name = i.name.trim().slice(0, 80);
  if (code.length < 2) throw new ValidationError("Give the item a short code (e.g. CRATE-24).");
  if (name.length < 2) throw new ValidationError("Give the item a name.");
  if (!(RETURNABLE_CATEGORIES as readonly string[]).includes(i.category)) throw new ValidationError("Choose what kind of item it is.");
  if (i.kind !== "DEPOSIT" && i.kind !== "EXCHANGE") throw new ValidationError("Choose deposit or swap.");
  const dep = Number(i.depositNet);
  if (!Number.isFinite(dep) || dep < 0 || dep > 5000) throw new ValidationError("The deposit must be between 0 and 5000 €.");
  const owner = shared ? null : ctx.company.id;
  const clash = await prisma.returnableType.findFirst({ where: { ownerCompanyId: owner, code, ...(i.id ? { id: { not: i.id } } : {}) } });
  if (clash) throw new ValidationError(`There is already an item with the code ${code}.`);
  const data = { code, category: i.category as ReturnableCategory, kind: i.kind as ReturnableKind, depositNet: dep.toFixed(4), active: i.active ?? true };
  let row;
  if (i.id) {
    const cur = await prisma.returnableType.findUnique({ where: { id: i.id } });
    if (!cur || cur.ownerCompanyId !== owner) throw new NotFoundError("Returnable item");
    row = await prisma.returnableType.update({ where: { id: i.id }, data: { ...data, name: { ...(cur.name as object), [locale.split("-")[0]]: name } } });
  } else row = await prisma.returnableType.create({ data: { ...data, ownerCompanyId: owner, name: { en: name, [locale.split("-")[0]]: name } } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: i.id ? "returnables.type_updated" : "returnables.type_created", entityType: "ReturnableType", entityId: row.id, after: { ...data, name } });
  return row;
}

async function vendorOffer(ctx: Ctx, offerId: string) {
  if (!isVendor(ctx) || !can(ctx, "vendor.products.manage")) throw new ForbiddenError();
  const offer = await prisma.vendorOffer.findFirst({ where: { id: offerId, vendorCompanyId: ctx.company.id } });
  if (!offer) throw new NotFoundError("Product");
  return offer;
}

export async function linkOffer(ctx: Ctx, offerId: string, typeId: string, qtyPerUnit: number) {
  await vendorOffer(ctx, offerId);
  const t = await prisma.returnableType.findFirst({ where: { id: typeId, active: true, OR: [{ ownerCompanyId: null }, { ownerCompanyId: ctx.company.id }] } });
  if (!t) throw new NotFoundError("Returnable item");
  const q = Math.round(Number(qtyPerUnit));
  if (!Number.isFinite(q) || q < 1 || q > 1000) throw new ValidationError("How many come with one unit: 1 to 1000.");
  const row = await prisma.offerReturnable.upsert({ where: { offerId_typeId: { offerId, typeId } }, create: { offerId, typeId, qtyPerUnit: q }, update: { qtyPerUnit: q } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "returnables.offer_linked", entityType: "VendorOffer", entityId: offerId, after: { typeId, qtyPerUnit: q } });
  return row;
}

export async function unlinkOffer(ctx: Ctx, offerId: string, typeId: string) {
  await vendorOffer(ctx, offerId);
  await prisma.offerReturnable.deleteMany({ where: { offerId, typeId } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "returnables.offer_unlinked", entityType: "VendorOffer", entityId: offerId, after: { typeId } });
}

/** The supplier's offers and what comes with each (for the links page). */
export async function vendorOfferLinks(ctx: Ctx, locale = "en") {
  if (!isVendor(ctx) || !can(ctx, ["vendor.products.manage", "vendor.products.view"])) throw new ForbiddenError();
  const offers = await prisma.vendorOffer.findMany({
    where: { vendorCompanyId: ctx.company.id, status: { in: ["ACTIVE", "PENDING_APPROVAL", "PAUSED"] } },
    include: { packaging: { include: { variant: { include: { product: true } } } }, returnables: { include: { type: true } } },
    orderBy: { createdAt: "asc" },
  });
  return offers.map((o) => ({
    offerId: o.id, sku: o.vendorSku ?? o.packaging.variant.sku, product: pickLocalized(o.packaging.variant.product.name, locale), packaging: pickLocalized(o.packaging.name, locale),
    links: o.returnables.map((l) => ({ typeId: l.typeId, code: l.type.code, name: nameOf(l.type, locale), kind: l.type.kind, qtyPerUnit: l.qtyPerUnit, depositNet: Number(l.type.depositNet) })),
  }));
}

/** What comes with each offer (product page, cards, cart) — buyers see the deposit per unit. */
export async function offerReturnables(offerIds: string[], locale = "en") {
  if (!offerIds.length) return {} as Record<string, OfferReturnableView[]>;
  const rows = await prisma.offerReturnable.findMany({ where: { offerId: { in: offerIds }, type: { active: true } }, include: { type: true } });
  const out: Record<string, OfferReturnableView[]> = {};
  for (const r of rows) (out[r.offerId] ??= []).push({ typeId: r.typeId, code: r.type.code, name: nameOf(r.type, locale), category: r.type.category, kind: r.type.kind, qtyPerUnit: r.qtyPerUnit, depositNet: Number(r.type.depositNet) });
  return out;
}
export type OfferReturnableView = { typeId: string; code: string; name: string; category: string; kind: "DEPOSIT" | "EXCHANGE"; qtyPerUnit: number; depositNet: number };

// ── balances ────────────────────────────────────────────────────────────────

/** Units held per customer × supplier × type (from the ledger). */
export async function holdings(where: { customerCompanyId?: string; supplierCompanyId?: string; typeId?: string }, db: Tx | typeof prisma = prisma) {
  const g = await db.returnableMovement.groupBy({ by: ["customerCompanyId", "supplierCompanyId", "typeId"], where, _sum: { qty: true } });
  return g.map((x) => ({ customerCompanyId: x.customerCompanyId, supplierCompanyId: x.supplierCompanyId, typeId: x.typeId, qty: x._sum.qty ?? 0 }));
}

/** Deposit units the customer still has paid in (invoiced − refunded − kept). */
async function paidUnits(db: Tx | typeof prisma, customerId: string, supplierId: string, typeId: string) {
  const inv = await db.orderReturnable.aggregate({ where: { typeId, order: { buyerCompanyId: customerId, sellerCompanyId: supplierId } }, _sum: { invoicedQty: true } });
  const cred = await db.emptiesReturnLine.aggregate({ where: { typeId, ret: { customerCompanyId: customerId, supplierCompanyId: supplierId } }, _sum: { credited: true } });
  const kept = await db.returnableMovement.aggregate({ where: { customerCompanyId: customerId, supplierCompanyId: supplierId, typeId, kind: "KEPT" }, _sum: { qty: true } });
  return Math.max(0, (inv._sum.invoicedQty ?? 0) - (cred._sum.credited ?? 0) + (kept._sum.qty ?? 0)); // kept qty is negative
}

// ── orders & invoices ───────────────────────────────────────────────────────

/**
 * Returnables an order carries (placement, confirmation, delivery): full units out per type from the
 * order lines; the empties the buyer plans to swap are kept (never more than the units out).
 */
export async function attachToOrder(tx: Tx, orderId: string, swapPlan?: Record<string, number> | null) {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { id: true, lines: { select: { offerId: true, qtyOrdered: true, qtyConfirmed: true, qtyDelivered: true } } } });
  const lines = order.lines.map((l) => ({ offerId: l.offerId, qty: l.qtyDelivered ?? l.qtyConfirmed ?? l.qtyOrdered }));
  const links = await tx.offerReturnable.findMany({ where: { offerId: { in: lines.map((l) => l.offerId) }, type: { active: true } }, include: { type: true } });
  const units = unitsFor(lines, links);
  const existing = await tx.orderReturnable.findMany({ where: { orderId } });
  for (const [typeId, qty] of units) {
    const t = links.find((l) => l.typeId === typeId)!.type;
    const cur = existing.find((e) => e.typeId === typeId);
    const planned = Math.min(qty, Math.max(0, Math.floor(swapPlan?.[typeId] ?? cur?.swapPlanned ?? 0)));
    const swap = t.kind === "EXCHANGE" ? planned : 0;
    if (cur) await tx.orderReturnable.update({ where: { id: cur.id }, data: { qtyOut: qty, swapPlanned: swap } });
    else await tx.orderReturnable.create({ data: { orderId, typeId, qtyOut: qty, swapPlanned: swap, depositUnitNet: t.depositNet } });
  }
  for (const e of existing) if (!units.has(e.typeId) && e.invoicedQty === 0) await tx.orderReturnable.delete({ where: { id: e.id } });
}

type StLine = { orderLineId: string | null; sku: string; description: string; qty: number; unitCostNet: string; lineNet: string; taxRate: string; vat: string; commission: string };

/**
 * At invoicing (order delivered): deposit lines for the invoice and the supplier's statement, and the
 * ledger movements (units out, empties swapped). Idempotent per order (already invoiced rows are skipped).
 */
export async function invoiceDeposits(tx: Tx, orderId: string, o: { buyerCompanyId: string; sellerCompanyId: string; countryCode: string; crossBorder: boolean; goodsRates: number[]; userId: string | null }) {
  await attachToOrder(tx, orderId);
  const rows = await tx.orderReturnable.findMany({ where: { orderId }, include: { type: true } });
  const s = await returnableSettings(tx);
  const invoiceLines: { description: string; qty: Decimal; unitPriceNet: Decimal; taxRate: Decimal; lineNet: Decimal; lineVat: Decimal }[] = [];
  const statementLines: StLine[] = [];
  for (const r of rows) {
    if (r.qtyOut <= 0) continue;
    const already = await tx.returnableMovement.count({ where: { orderId, typeId: r.typeId, kind: "OUT" } });
    if (already) continue;
    const swapped = r.type.kind === "EXCHANGE" ? Math.min(r.qtyOut, r.swapDone ?? r.swapPlanned) : 0;
    const charged = chargedUnits(r.type.kind, r.qtyOut, swapped);
    const rate = new Decimal(depositVatRate(s, o.countryCode, o.goodsRates));
    const unit = new Decimal(r.depositUnitNet.toString());
    if (charged > 0 && unit.gt(0)) {
      const net = r2(unit.mul(charged));
      const vat = r2(net.mul(rate).div(100));
      invoiceLines.push({ description: depositLabel(r.type), qty: new Decimal(charged), unitPriceNet: unit, taxRate: rate, lineNet: net, lineVat: vat });
      const sRate = o.crossBorder ? new Decimal(0) : rate;
      statementLines.push({ orderLineId: null, sku: `DEPOSIT:${r.type.code}`, description: depositLabel(r.type), qty: charged, unitCostNet: unit.toFixed(4), lineNet: net.toFixed(2), taxRate: sRate.toFixed(3), vat: r2(net.mul(sRate).div(100)).toFixed(2), commission: "0" });
    }
    await tx.orderReturnable.update({ where: { id: r.id }, data: { invoicedQty: unit.gt(0) ? charged : 0, vatRate: rate.toFixed(3), swapDone: r.type.kind === "EXCHANGE" ? swapped : r.swapDone } });
    const base = { customerCompanyId: o.buyerCompanyId, supplierCompanyId: o.sellerCompanyId, typeId: r.typeId, orderId, byUserId: o.userId };
    await tx.returnableMovement.create({ data: { ...base, kind: "OUT", qty: r.qtyOut } });
    if (swapped) await tx.returnableMovement.create({ data: { ...base, kind: "SWAP_IN", qty: -swapped, note: "Empties swapped at delivery" } });
  }
  return { invoiceLines, statementLines };
}

/**
 * The driver counted empties at the stop (before the order turns DELIVERED and is invoiced): swaps go on
 * the order, everything else becomes a return waiting for the supplier's check. Open pickups for this
 * customer are collected with it.
 */
export async function recordStopEmpties(tx: Tx, deliveryId: string, counted: Record<string, number>, userId: string) {
  const d = await tx.delivery.findUniqueOrThrow({ where: { id: deliveryId }, include: { order: { select: { id: true, buyerCompanyId: true, sellerCompanyId: true } } } });
  await attachToOrder(tx, d.order.id);
  const rows = await tx.orderReturnable.findMany({ where: { orderId: d.order.id }, include: { type: true } });
  const allowed = await allowedTypes(tx, d.order.buyerCompanyId, d.order.sellerCompanyId);
  const clean: Record<string, number> = {};
  for (const [k, v] of Object.entries(counted)) {
    const n = Math.floor(Number(v) || 0);
    if (n < 0 || n > 10_000) throw new ValidationError("Count the empties again (0 to 10000).");
    if (n && !allowed.has(k) && !rows.some((r) => r.typeId === k)) throw new ValidationError("That item is not one this supplier takes back.");
    if (n) clean[k] = n;
  }
  const { swaps, returns } = splitEmpties(clean, rows.map((r) => ({ typeId: r.typeId, kind: r.type.kind, qtyOut: r.qtyOut })));
  for (const r of rows) if (r.type.kind === "EXCHANGE") await tx.orderReturnable.update({ where: { id: r.id }, data: { swapDone: swaps[r.typeId] ?? 0 } });
  let ret: { id: string; number: string } | null = null;
  if (Object.keys(returns).length) {
    ret = await createReturn(tx, { customerId: d.order.buyerCompanyId, supplierId: d.order.sellerCompanyId, source: "DELIVERY", deliveryId, orderId: d.order.id, userId, lines: returns });
    await tx.emptiesPickup.updateMany({ where: { customerCompanyId: d.order.buyerCompanyId, supplierCompanyId: d.order.sellerCompanyId, status: { in: ["REQUESTED", "PLANNED"] } }, data: { status: "COLLECTED", returnId: ret.id } });
  }
  return { swaps, returns, ret };
}

/** Types a customer may hand back to a supplier: what they hold from it + what the supplier's products carry. */
async function allowedTypes(db: Tx | typeof prisma, customerId: string, supplierId: string) {
  const held = await db.returnableMovement.findMany({ where: { customerCompanyId: customerId, supplierCompanyId: supplierId }, distinct: ["typeId"], select: { typeId: true } });
  const sold = await db.offerReturnable.findMany({ where: { offer: { vendorCompanyId: supplierId } }, distinct: ["typeId"], select: { typeId: true } });
  return new Set([...held, ...sold].map((x) => x.typeId));
}

async function createReturn(tx: Tx, r: { customerId: string; supplierId: string; source: EmptiesSource; deliveryId?: string | null; pickupId?: string | null; orderId?: string | null; userId: string; lines: Record<string, number>; note?: string | null }) {
  const number = await nextNo(tx, "empties_return", "ER");
  const ret = await tx.emptiesReturn.create({
    data: {
      number, customerCompanyId: r.customerId, supplierCompanyId: r.supplierId, source: r.source, deliveryId: r.deliveryId ?? null, pickupId: r.pickupId ?? null, orderId: r.orderId ?? null,
      collectedById: r.userId, note: r.note?.trim().slice(0, 500) || null,
      lines: { create: Object.entries(r.lines).map(([typeId, counted]) => ({ typeId, counted })) },
    },
  });
  await writeAudit({ actorUserId: r.userId, actorCompanyId: null, action: "returnables.collected", entityType: "EmptiesReturn", entityId: ret.id, after: { number, source: r.source, lines: r.lines } }, tx);
  return ret;
}

/** After the stop: tell the supplier there are empties to check. */
export async function afterCollected(retId: string) {
  const ret = await prisma.emptiesReturn.findUnique({ where: { id: retId }, include: { lines: true } });
  if (!ret) return;
  const customer = await prisma.company.findUnique({ where: { id: ret.customerCompanyId }, select: { legalName: true, tradeName: true } });
  await notify("returnables.collected", [{ companyId: ret.supplierCompanyId, link: `/vendor/orders/empties/${ret.id}` }], { number: ret.number, customer: cname(customer), units: ret.lines.reduce((a, l) => a + l.counted, 0) }, { ref: { type: "EmptiesReturn", id: ret.id } });
}

// ── returns: check, credit, dispute ─────────────────────────────────────────

/**
 * Refund `units` deposits of a type: credit notes on the newest deposit invoices first (never more than the
 * customer still has paid in), and the supplier's credit statement for the same deposits.
 */
async function creditDeposits(tx: Tx, ret: { id: string; number: string; customerCompanyId: string; supplierCompanyId: string }, typeId: string, units: number, userId: string) {
  const t = await tx.returnableType.findUniqueOrThrow({ where: { id: typeId } });
  let left = Math.min(units, await paidUnits(tx, ret.customerCompanyId, ret.supplierCompanyId, typeId));
  if (left <= 0) return { credited: 0, gross: new Decimal(0), notes: [] as string[] };
  const label = depositLabel(t);
  const invoices = await tx.invoice.findMany({
    where: { recipientCompanyId: ret.customerCompanyId, docType: "INVOICE", status: { in: ["ISSUED", "PARTIALLY_CREDITED"] }, order: { sellerCompanyId: ret.supplierCompanyId }, lines: { some: { description: { endsWith: `[${t.code}]` } } } },
    orderBy: { issuedAt: "desc" }, include: { lines: true, creditNotes: { include: { lines: true } }, order: { select: { id: true, countryId: true, seller: { select: { countryId: true } } } } },
  });
  const { creditInvoice } = await import("@/server/invoicing/service");
  let credited = 0, gross = new Decimal(0);
  const notes: string[] = [];
  for (const inv of invoices) {
    if (left <= 0) break;
    const line = inv.lines.find((l) => l.description.endsWith(`[${t.code}]`) && l.description.startsWith(DEPOSIT_PREFIX));
    if (!line) continue;
    const done = inv.creditNotes.flatMap((c) => c.lines).filter((l) => l.description === line.description).reduce((a, l) => a + Number(l.qty), 0);
    const avail = Math.floor(Number(line.qty) - done);
    if (avail <= 0) continue;
    const q = Math.min(avail, left);
    const cn = await creditInvoice(tx, inv.id, { lines: [{ invoiceLineId: line.id, qty: q }], reason: `Devolução de vasilhame ${ret.number}`, actorUserId: userId, chargeVendor: false });
    notes.push(cn.id);
    gross = gross.plus(cn.grossTotal.toString());
    credited += q; left -= q;
    // the supplier refunds FIRINGI the same deposits
    const net = r2(new Decimal(line.unitPriceNet.toString()).mul(q));
    const sameCountry = inv.order?.seller.countryId === inv.order?.countryId;
    const rate = inv.taxRegime === "DOMESTIC" && sameCountry ? new Decimal(line.taxRate.toString()) : new Decimal(0);
    const vat = r2(net.mul(rate).div(100));
    const st = { orderLineId: null, sku: `DEPOSIT:${t.code}`, description: label, qty: q, unitCostNet: new Decimal(line.unitPriceNet.toString()).toFixed(4), lineNet: net.toFixed(2), taxRate: rate.toFixed(3), vat: vat.toFixed(2), commission: "0" };
    const orig = await tx.vendorBillingStatement.findFirst({ where: { orderId: inv.orderId!, isCreditStatement: false } });
    await tx.vendorBillingStatement.create({
      data: {
        number: await nextNo(tx, "statement", "VBS"), vendorCompanyId: ret.supplierCompanyId, orderId: inv.orderId!, salesInvoiceId: cn.id, isCreditStatement: true,
        taxRegime: orig?.taxRegime ?? "DOMESTIC", expectedNet: net.toFixed(2), expectedVat: vat.toFixed(2), expectedGross: net.plus(vat).toFixed(2), commissionTotal: 0, lines: [st],
      },
    });
  }
  return { credited, gross, notes };
}

/** Accept a return: holdings go down by everything taken back; deposits are refunded for the good ones. */
async function settleReturn(tx: Tx, retId: string, lines: { typeId: string; accepted: number; damaged: number }[], userId: string, status: "CONFIRMED" | "RESOLVED") {
  const ret = await tx.emptiesReturn.findUniqueOrThrow({ where: { id: retId }, include: { lines: true } });
  const s = await returnableSettings(tx);
  let gross = new Decimal(0);
  const noteIds = [...ret.creditNoteIds];
  for (const l of ret.lines) {
    const w = lines.find((x) => x.typeId === l.typeId) ?? { typeId: l.typeId, accepted: l.counted, damaged: 0 };
    const accepted = Math.max(0, Math.floor(w.accepted)), damaged = Math.max(0, Math.floor(w.damaged));
    if (accepted + damaged > l.counted) throw new ValidationError("Accepted and damaged can't be more than were counted.");
    const prevBack = (l.accepted ?? 0) + (l.accepted == null ? 0 : l.damaged);
    const back = accepted + damaged - prevBack; // more taken back than before (FIRINGI's decision on a dispute)
    if (back > 0) await tx.returnableMovement.create({ data: { customerCompanyId: ret.customerCompanyId, supplierCompanyId: ret.supplierCompanyId, typeId: l.typeId, kind: "RETURN", qty: -back, returnId: ret.id, byUserId: userId } });
    const creditable = accepted + (s.creditDamaged ? damaged : 0) - l.credited;
    let credited = l.credited;
    if (creditable > 0) {
      const c = await creditDeposits(tx, ret, l.typeId, creditable, userId);
      credited += c.credited; gross = gross.plus(c.gross); noteIds.push(...c.notes);
    }
    await tx.emptiesReturnLine.update({ where: { id: l.id }, data: { accepted, damaged, credited } });
  }
  return tx.emptiesReturn.update({
    where: { id: retId },
    data: { status, creditGross: new Decimal(ret.creditGross.toString()).plus(gross).toFixed(2), creditNoteIds: noteIds, ...(status === "CONFIRMED" ? { confirmedById: userId, confirmedAt: new Date() } : { resolvedById: userId, resolvedAt: new Date() }) },
    include: { lines: true },
  });
}

/** The supplier checks the empties: accepted (good) and damaged per item; the rest counts as missing. */
export async function confirmReturn(ctx: Ctx, id: string, lines: { typeId: string; accepted: number; damaged: number }[]) {
  if (!isVendor(ctx) || !can(ctx, "vendor.orders.manage")) throw new ForbiddenError();
  const ret = await prisma.emptiesReturn.findFirst({ where: { id, supplierCompanyId: ctx.company.id } });
  if (!ret) throw new NotFoundError("Return");
  if (ret.status !== "COLLECTED") throw new AppError("BAD_STATE", "This return was already checked.", 409);
  const done = await prisma.$transaction((tx) => settleReturn(tx, id, lines, ctx.user.id, "CONFIRMED"), { timeout: 60_000 });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "returnables.confirmed", entityType: "EmptiesReturn", entityId: id, after: { lines } });
  await (await import("@/server/invoicing/fiscal")).kickFiscalQueue();
  const short = done.lines.reduce((a, l) => a + l.counted - (l.accepted ?? 0) - l.damaged, 0);
  const damaged = done.lines.reduce((a, l) => a + l.damaged, 0);
  await notify("returnables.confirmed", [{ companyId: done.customerCompanyId, link: `/buy/orders/empties/${id}` }], { number: done.number, accepted: done.lines.reduce((a, l) => a + (l.accepted ?? 0), 0), damaged, missing: short, credit: Number(done.creditGross) }, { ref: { type: "EmptiesReturn", id } });
  return done;
}

/** The customer contests the supplier's count: FIRINGI decides. */
export async function disputeReturn(ctx: Ctx, id: string, note: string) {
  if (!isBuyer(ctx) || !can(ctx, ["buyer.orders.place", "buyer.orders.view"])) throw new ForbiddenError();
  const ret = await prisma.emptiesReturn.findFirst({ where: { id, customerCompanyId: ctx.company.id }, include: { lines: true } });
  if (!ret) throw new NotFoundError("Return");
  if (ret.status !== "CONFIRMED" || !ret.lines.some((l) => l.counted > (l.accepted ?? 0) + l.damaged || l.damaged > 0)) throw new AppError("BAD_STATE", "Only a checked return with fewer empties accepted than counted can be contested.", 409);
  if (note.trim().length < 5) throw new ValidationError("Say why you don't agree with the count.");
  await prisma.emptiesReturn.update({ where: { id }, data: { status: "DISPUTED", disputeNote: note.trim().slice(0, 1000) } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "returnables.disputed", entityType: "EmptiesReturn", entityId: id, after: { note } });
  const a = await adminCompany();
  const customer = cname(await prisma.company.findUnique({ where: { id: ret.customerCompanyId }, select: { legalName: true, tradeName: true } }));
  if (a) await notify("returnables.disputed", [{ companyId: a.id, link: `/admin/orders/empties/${id}` }], { number: ret.number, customer }, { ref: { type: "EmptiesReturn", id } });
  await notify("returnables.disputed", [{ companyId: ret.supplierCompanyId, link: `/vendor/orders/empties/${id}` }], { number: ret.number, customer }, { ref: { type: "EmptiesReturn", id } });
}

/** FIRINGI decides a dispute: the customer's count (counted, minus damaged) or the supplier's. */
export async function resolveDispute(ctx: Ctx, id: string, decision: "CUSTOMER" | "SUPPLIER", note: string) {
  if (!isStaff(ctx) || !can(ctx, ["admin.orders.manage", "admin.claims.manage"])) throw new ForbiddenError();
  const ret = await prisma.emptiesReturn.findUnique({ where: { id }, include: { lines: true } });
  if (!ret) throw new NotFoundError("Return");
  if (ret.status !== "DISPUTED") throw new AppError("BAD_STATE", "This return is not contested.", 409);
  if (note.trim().length < 3) throw new ValidationError("Write a short note about the decision.");
  const lines = ret.lines.map((l) => decision === "CUSTOMER" ? { typeId: l.typeId, accepted: l.counted - l.damaged, damaged: l.damaged } : { typeId: l.typeId, accepted: l.accepted ?? 0, damaged: l.damaged });
  const done = await prisma.$transaction(async (tx) => {
    const r = await settleReturn(tx, id, lines, ctx.user.id, "RESOLVED");
    return tx.emptiesReturn.update({ where: { id }, data: { resolution: `${decision === "CUSTOMER" ? "Customer's count" : "Supplier's count"}: ${note.trim().slice(0, 500)}` }, include: { lines: true } }).then((x) => ({ ...x, creditGross: r.creditGross }));
  }, { timeout: 60_000 });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "returnables.resolved", entityType: "EmptiesReturn", entityId: id, after: { decision, note } });
  await (await import("@/server/invoicing/fiscal")).kickFiscalQueue();
  const vars = { number: ret.number, decision: decision === "CUSTOMER" ? "customer" : "supplier", note: note.trim() };
  await notify("returnables.resolved", [{ companyId: ret.customerCompanyId, link: `/buy/orders/empties/${id}` }, { companyId: ret.supplierCompanyId, link: `/vendor/orders/empties/${id}` }], vars, { ref: { type: "EmptiesReturn", id } });
  return done;
}

/** The customer brought empties to the supplier: counted and checked at once. */
export async function recordDropOff(ctx: Ctx, customerId: string, lines: { typeId: string; accepted: number; damaged: number }[], note: string | null) {
  if (!isVendor(ctx) || !can(ctx, "vendor.orders.manage")) throw new ForbiddenError();
  const known = await allowedTypes(prisma, customerId, ctx.company.id);
  const counted: Record<string, number> = {};
  for (const l of lines) {
    const n = Math.floor(l.accepted) + Math.floor(l.damaged);
    if (n < 0 || l.accepted < 0 || l.damaged < 0) throw new ValidationError("Quantities can't be negative.");
    if (n && !known.has(l.typeId)) throw new ValidationError("That item is not one this customer can bring back to you.");
    if (n) counted[l.typeId] = n;
  }
  if (!Object.keys(counted).length) throw new ValidationError("Count at least one empty.");
  const ret = await prisma.$transaction(async (tx) => {
    const r = await createReturn(tx, { customerId, supplierId: ctx.company.id, source: "DROP_OFF", userId: ctx.user.id, lines: counted, note });
    return settleReturn(tx, r.id, lines, ctx.user.id, "CONFIRMED");
  }, { timeout: 60_000 });
  await (await import("@/server/invoicing/fiscal")).kickFiscalQueue();
  await notify("returnables.confirmed", [{ companyId: customerId, link: `/buy/orders/empties/${ret.id}` }], { number: ret.number, accepted: ret.lines.reduce((a, l) => a + (l.accepted ?? 0), 0), damaged: ret.lines.reduce((a, l) => a + l.damaged, 0), missing: 0, credit: Number(ret.creditGross) }, { ref: { type: "EmptiesReturn", id: ret.id } });
  return ret;
}

/** Supplier correction / opening balance (units the customer already had before FIRINGI; no deposit paid). */
export async function adjustBalance(ctx: Ctx, customerId: string, typeId: string, qty: number, note: string) {
  if (!isVendor(ctx) || !can(ctx, "vendor.orders.manage")) throw new ForbiddenError();
  const q = Math.round(qty);
  if (!q || Math.abs(q) > 10_000) throw new ValidationError("Enter how many units to add (+) or remove (−).");
  if (note.trim().length < 3) throw new ValidationError("Say why (e.g. opening balance).");
  const t = await prisma.returnableType.findFirst({ where: { id: typeId, OR: [{ ownerCompanyId: null }, { ownerCompanyId: ctx.company.id }] } });
  if (!t) throw new NotFoundError("Returnable item");
  const customer = await prisma.company.findFirst({ where: { id: customerId, type: { in: ["CUSTOMER", "WHOLESALER"] } } });
  if (!customer) throw new NotFoundError("Customer");
  const held = (await holdings({ customerCompanyId: customerId, supplierCompanyId: ctx.company.id, typeId }))[0]?.qty ?? 0;
  if (held + q < 0) throw new ValidationError(`The customer holds ${held}; you can't remove more.`);
  await prisma.returnableMovement.create({ data: { customerCompanyId: customerId, supplierCompanyId: ctx.company.id, typeId, kind: "ADJUST", qty: q, note: note.trim().slice(0, 300), byUserId: ctx.user.id } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "returnables.adjusted", entityType: "Company", entityId: customerId, after: { typeId, qty: q, note } });
}

// ── pickups ─────────────────────────────────────────────────────────────────

export async function requestPickup(ctx: Ctx, i: { supplierId: string; addressId: string; lines: { typeId: string; qty: number }[]; note?: string | null; preferredDate?: Date | null }) {
  if (!isBuyer(ctx) || !can(ctx, "buyer.orders.place")) throw new ForbiddenError();
  const s = await returnableSettings();
  if (!s.enabled || !s.pickups) throw new AppError("OFF", "Collections of empties are not offered right now.", 409);
  const { canOrderTo } = await import("@/server/multisite/branches");
  if (!(await canOrderTo(ctx, i.addressId))) throw new ValidationError("Choose one of your addresses.");
  const held = await holdings({ customerCompanyId: ctx.company.id, supplierCompanyId: i.supplierId });
  const lines = i.lines.map((l) => ({ typeId: l.typeId, qty: Math.floor(Number(l.qty) || 0) })).filter((l) => l.qty > 0);
  for (const l of lines) {
    const h = held.find((x) => x.typeId === l.typeId)?.qty ?? 0;
    if (l.qty > h) throw new ValidationError(`You hold ${h} of that item from this supplier.`);
  }
  const total = lines.reduce((a, l) => a + l.qty, 0);
  if (total < s.pickupMinUnits) throw new ValidationError(`A collection is for at least ${s.pickupMinUnits} empties.`);
  if (await prisma.emptiesPickup.findFirst({ where: { customerCompanyId: ctx.company.id, supplierCompanyId: i.supplierId, status: { in: ["REQUESTED", "PLANNED"] } } }))
    throw new AppError("OPEN", "You already asked this supplier for a collection; it is still open.", 409);
  if (i.preferredDate && (i.preferredDate.getTime() < Date.now() - 86_400_000 || i.preferredDate.getTime() > Date.now() + 60 * 86_400_000)) throw new ValidationError("Choose a date in the next 60 days.");
  const p = await prisma.$transaction(async (tx) => tx.emptiesPickup.create({
    data: { number: await nextNo(tx, "empties_pickup", "EP"), customerCompanyId: ctx.company.id, supplierCompanyId: i.supplierId, addressId: i.addressId, lines, note: i.note?.trim().slice(0, 500) || null, preferredDate: i.preferredDate ?? null, requestedById: ctx.user.id },
  }));
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "returnables.pickup_requested", entityType: "EmptiesPickup", entityId: p.id, after: { lines } });
  await notify("returnables.pickup_requested", [{ companyId: i.supplierId, link: "/vendor/orders/empties" }], { number: p.number, customer: ctx.company.tradeName ?? ctx.company.legalName, units: total }, { ref: { type: "EmptiesPickup", id: p.id } });
  return p;
}

export async function planPickup(ctx: Ctx, id: string, driverId: string, plannedDate: Date) {
  if (!isVendor(ctx) || !can(ctx, ["vendor.orders.manage", "vendor.drivers.manage"])) throw new ForbiddenError();
  const p = await prisma.emptiesPickup.findFirst({ where: { id, supplierCompanyId: ctx.company.id } });
  if (!p) throw new NotFoundError("Collection");
  if (p.status !== "REQUESTED" && p.status !== "PLANNED") throw new AppError("BAD_STATE", "This collection is closed.", 409);
  const driver = await prisma.driver.findFirst({ where: { id: driverId, ownerCompanyId: ctx.company.id, status: "APPROVED" } });
  if (!driver) throw new ValidationError("Choose one of your drivers.");
  if (Number.isNaN(plannedDate.getTime())) throw new ValidationError("Choose a date.");
  await prisma.emptiesPickup.update({ where: { id }, data: { status: "PLANNED", driverId, plannedDate } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "returnables.pickup_planned", entityType: "EmptiesPickup", entityId: id, after: { driverId, plannedDate } });
  await notify("returnables.pickup_planned", [{ companyId: p.customerCompanyId, link: "/buy/orders/empties" }], { number: p.number, date: plannedDate.toISOString().slice(0, 10) }, { ref: { type: "EmptiesPickup", id } });
}

export async function cancelPickup(ctx: Ctx, id: string) {
  const p = await prisma.emptiesPickup.findUnique({ where: { id } });
  if (!p) throw new NotFoundError("Collection");
  const mine = (isBuyer(ctx) && p.customerCompanyId === ctx.company.id && can(ctx, "buyer.orders.place")) || (isVendor(ctx) && p.supplierCompanyId === ctx.company.id && can(ctx, "vendor.orders.manage"));
  if (!mine) throw new ForbiddenError();
  if (p.status !== "REQUESTED" && p.status !== "PLANNED") throw new AppError("BAD_STATE", "This collection is closed.", 409);
  await prisma.emptiesPickup.update({ where: { id }, data: { status: "CANCELLED" } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "returnables.pickup_cancelled", entityType: "EmptiesPickup", entityId: id });
}

/** The driver collected a pickup: counted empties become a return for the supplier to check. */
export async function collectPickup(ctx: Ctx, id: string, counted: Record<string, number>) {
  if (!ctx.driver || !can(ctx, "driver.deliveries.update")) throw new ForbiddenError();
  const p = await prisma.emptiesPickup.findFirst({ where: { id, driverId: ctx.driver.id } });
  if (!p) throw new NotFoundError("Collection");
  if (p.status !== "PLANNED") throw new AppError("BAD_STATE", "This collection is not planned for you.", 409);
  const allowed = await allowedTypes(prisma, p.customerCompanyId, p.supplierCompanyId);
  const lines: Record<string, number> = {};
  for (const [k, v] of Object.entries(counted)) {
    const n = Math.floor(Number(v) || 0);
    if (n < 0 || n > 10_000) throw new ValidationError("Count the empties again (0 to 10000).");
    if (n && !allowed.has(k)) throw new ValidationError("That item is not one this supplier takes back.");
    if (n) lines[k] = n;
  }
  const ret = await prisma.$transaction(async (tx) => {
    const res = await tx.emptiesPickup.updateMany({ where: { id, status: "PLANNED" }, data: { status: "COLLECTED" } });
    if (res.count !== 1) throw new AppError("CONFLICT", "This collection was changed meanwhile. Reload.", 409);
    if (!Object.keys(lines).length) return null;
    const r = await createReturn(tx, { customerId: p.customerCompanyId, supplierId: p.supplierCompanyId, source: "PICKUP", pickupId: id, userId: ctx.user.id, lines });
    await tx.emptiesPickup.update({ where: { id }, data: { returnId: r.id } });
    return r;
  });
  if (ret) await afterCollected(ret.id);
  return ret;
}

/** Collections planned for the driver (route page). */
export async function driverPickups(ctx: Ctx, locale = "en") {
  if (!ctx.driver) return [];
  const rows = await prisma.emptiesPickup.findMany({ where: { driverId: ctx.driver.id, status: "PLANNED" }, orderBy: { plannedDate: "asc" } });
  return Promise.all(rows.map(async (p) => {
    const [customer, address] = await Promise.all([
      prisma.company.findUnique({ where: { id: p.customerCompanyId }, select: { legalName: true, tradeName: true } }),
      prisma.address.findUnique({ where: { id: p.addressId }, select: { line1: true, postalCode: true, cityName: true } }),
    ]);
    return { id: p.id, number: p.number, customer: cname(customer), address: address ? `${address.line1}, ${address.postalCode} ${address.cityName}` : "", plannedDate: p.plannedDate, note: p.note, items: await stopItems(p.customerCompanyId, p.supplierCompanyId, locale, p.lines as { typeId: string; qty: number }[]) };
  }));
}

/** Items the driver can count at a customer: what they hold (+ expected) for this supplier. */
export async function stopItems(customerId: string, supplierId: string, locale = "en", expected: { typeId: string; qty: number }[] = [], orderId?: string | null) {
  const held = await holdings({ customerCompanyId: customerId, supplierCompanyId: supplierId });
  const out = orderId ? await prisma.orderReturnable.findMany({ where: { orderId } }) : [];
  const ids = [...new Set([...held.filter((h) => h.qty > 0).map((h) => h.typeId), ...expected.map((e) => e.typeId), ...out.map((o) => o.typeId)])];
  const types = await prisma.returnableType.findMany({ where: { id: { in: ids } } });
  return types.map((t) => {
    const o = out.find((x) => x.typeId === t.id);
    return { typeId: t.id, code: t.code, name: nameOf(t, locale), kind: t.kind, held: held.find((h) => h.typeId === t.id)?.qty ?? 0, expected: expected.find((e) => e.typeId === t.id)?.qty ?? (o ? (t.kind === "EXCHANGE" ? o.swapPlanned : 0) : 0), fullOut: o?.qtyOut ?? 0 };
  }).sort((a, b) => a.code.localeCompare(b.code));
}

// ── views & reports ─────────────────────────────────────────────────────────

type Row = { customerId: string; supplierId: string; typeId: string; held: number; overdue: number; paid: number; oldest: Date | null };

async function balanceRows(where: { customerCompanyId?: string; supplierCompanyId?: string }, now = new Date()): Promise<Row[]> {
  const s = await returnableSettings();
  const moves = await prisma.returnableMovement.findMany({ where, select: { customerCompanyId: true, supplierCompanyId: true, typeId: true, qty: true, at: true } });
  const groups = new Map<string, { qty: number; at: Date }[]>();
  for (const m of moves) {
    const k = `${m.customerCompanyId}|${m.supplierCompanyId}|${m.typeId}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push({ qty: m.qty, at: m.at });
  }
  const rows: Row[] = [];
  for (const [k, ms] of groups) {
    const [customerId, supplierId, typeId] = k.split("|");
    const held = ms.reduce((a, m) => a + m.qty, 0);
    if (held === 0) continue;
    const lots = ageUnits(ms);
    rows.push({ customerId, supplierId, typeId, held, overdue: overdueUnits(lots, overdueRule(s, supplierId).days, now), paid: await paidUnits(prisma, customerId, supplierId, typeId), oldest: lots[0]?.since ?? null });
  }
  return rows;
}

async function decorate(rows: Row[], locale: string) {
  const types = await prisma.returnableType.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.typeId))] } } });
  const companies = await prisma.company.findMany({ where: { id: { in: [...new Set(rows.flatMap((r) => [r.customerId, r.supplierId]))] } }, select: { id: true, legalName: true, tradeName: true } });
  const cn = (id: string) => cname(companies.find((c) => c.id === id));
  return rows.map((r) => {
    const t = types.find((x) => x.id === r.typeId)!;
    return { ...r, customer: cn(r.customerId), supplier: cn(r.supplierId), code: t.code, name: nameOf(t, locale), kind: t.kind, category: t.category, depositNet: Number(t.depositNet), depositValue: Number(r2(new Decimal(t.depositNet.toString()).mul(Math.min(r.paid, Math.max(r.held, 0))))) };
  });
}

async function returnsList(where: Prisma.EmptiesReturnWhereInput, locale: string, take = 50) {
  const rows = await prisma.emptiesReturn.findMany({ where, orderBy: { collectedAt: "desc" }, take, include: { lines: true } });
  const types = await prisma.returnableType.findMany({ where: { id: { in: [...new Set(rows.flatMap((r) => r.lines.map((l) => l.typeId)))] } } });
  const companies = await prisma.company.findMany({ where: { id: { in: [...new Set(rows.flatMap((r) => [r.customerCompanyId, r.supplierCompanyId]))] } }, select: { id: true, legalName: true, tradeName: true } });
  return rows.map((r) => ({
    id: r.id, number: r.number, source: r.source, status: r.status, collectedAt: r.collectedAt, confirmedAt: r.confirmedAt, creditGross: Number(r.creditGross), note: r.note, disputeNote: r.disputeNote, resolution: r.resolution,
    customer: cname(companies.find((c) => c.id === r.customerCompanyId)), supplier: cname(companies.find((c) => c.id === r.supplierCompanyId)), customerId: r.customerCompanyId, supplierId: r.supplierCompanyId,
    lines: r.lines.map((l) => { const t = types.find((x) => x.id === l.typeId); return { typeId: l.typeId, code: t?.code ?? "", name: t ? nameOf(t, locale) : "", kind: t?.kind ?? "DEPOSIT", counted: l.counted, accepted: l.accepted, damaged: l.damaged, credited: l.credited }; }),
    units: r.lines.reduce((a, l) => a + l.counted, 0),
  }));
}

async function pickupsList(where: Prisma.EmptiesPickupWhereInput, locale: string) {
  const rows = await prisma.emptiesPickup.findMany({ where, orderBy: { createdAt: "desc" }, take: 50 });
  const types = await prisma.returnableType.findMany({ where: { id: { in: [...new Set(rows.flatMap((p) => (p.lines as { typeId: string }[]).map((l) => l.typeId)))] } } });
  const companies = await prisma.company.findMany({ where: { id: { in: [...new Set(rows.flatMap((p) => [p.customerCompanyId, p.supplierCompanyId]))] } }, select: { id: true, legalName: true, tradeName: true } });
  const addresses = await prisma.address.findMany({ where: { id: { in: rows.map((p) => p.addressId) } }, select: { id: true, label: true, line1: true, cityName: true } });
  const drivers = await prisma.driver.findMany({ where: { id: { in: rows.map((p) => p.driverId).filter((x): x is string => !!x) } }, include: { user: { select: { name: true } } } });
  return rows.map((p) => ({
    id: p.id, number: p.number, status: p.status, createdAt: p.createdAt, preferredDate: p.preferredDate, plannedDate: p.plannedDate, note: p.note, returnId: p.returnId,
    customer: cname(companies.find((c) => c.id === p.customerCompanyId)), supplier: cname(companies.find((c) => c.id === p.supplierCompanyId)),
    address: (() => { const a = addresses.find((x) => x.id === p.addressId); return a ? `${a.label} · ${a.line1}, ${a.cityName}` : ""; })(),
    driver: drivers.find((d) => d.id === p.driverId)?.user.name ?? null, driverId: p.driverId,
    lines: (p.lines as { typeId: string; qty: number }[]).map((l) => { const t = types.find((x) => x.id === l.typeId); return { ...l, code: t?.code ?? "", name: t ? nameOf(t, locale) : "" }; }),
  }));
}

/** The customer's empties: what they hold per supplier, deposits paid, returns, collections. */
export async function buyerOverview(ctx: Ctx, locale = "en") {
  if (!isBuyer(ctx) || !can(ctx, ["buyer.orders.view", "buyer.orders.place", "buyer.invoices.view"])) throw new ForbiddenError();
  const s = await returnableSettings();
  const balances = await decorate(await balanceRows({ customerCompanyId: ctx.company.id }), locale);
  return {
    settings: { pickups: s.enabled && s.pickups, pickupMinUnits: s.pickupMinUnits, overdueDays: s.overdue.days, overdueAction: s.overdue.action },
    balances: balances.map((b) => ({ ...b, overdueDays: overdueRule(s, b.supplierId).days, overdueAction: overdueRule(s, b.supplierId).action })),
    returns: await returnsList({ customerCompanyId: ctx.company.id }, locale, 30),
    pickups: await pickupsList({ customerCompanyId: ctx.company.id }, locale),
  };
}

export async function vendorOverview(ctx: Ctx, locale = "en") {
  if (!isVendor(ctx) || !can(ctx, ["vendor.orders.view", "vendor.orders.manage"])) throw new ForbiddenError();
  const balances = await decorate(await balanceRows({ supplierCompanyId: ctx.company.id }), locale);
  const byType = new Map<string, { typeId: string; code: string; name: string; kind: string; held: number; overdue: number; customers: number; depositValue: number }>();
  for (const b of balances) {
    const cur = byType.get(b.typeId) ?? { typeId: b.typeId, code: b.code, name: b.name, kind: b.kind, held: 0, overdue: 0, customers: 0, depositValue: 0 };
    cur.held += b.held; cur.overdue += b.overdue; cur.customers += 1; cur.depositValue += b.depositValue;
    byType.set(b.typeId, cur);
  }
  return {
    balances, byType: [...byType.values()].sort((a, b) => a.code.localeCompare(b.code)),
    toCheck: await returnsList({ supplierCompanyId: ctx.company.id, status: { in: ["COLLECTED", "DISPUTED"] } }, locale),
    returns: await returnsList({ supplierCompanyId: ctx.company.id }, locale, 30),
    pickups: await pickupsList({ supplierCompanyId: ctx.company.id, status: { in: ["REQUESTED", "PLANNED"] } }, locale),
    drivers: (await prisma.driver.findMany({ where: { ownerCompanyId: ctx.company.id, status: "APPROVED" }, include: { user: { select: { name: true } } } })).map((d) => ({ id: d.id, name: d.user.name })),
    customers: [...new Map(balances.map((b) => [b.customerId, b.customer])).entries()].map(([id, name]) => ({ id, name })),
  };
}

export async function adminOverview(ctx: Ctx) {
  if (!isStaff(ctx) || !can(ctx, ["admin.orders.view", "admin.orders.manage", "admin.finance.view", "admin.settings.view", "admin.settings.manage"])) throw new ForbiddenError();
  const balances = await decorate(await balanceRows({}), "en");
  const totals = { units: balances.reduce((a, b) => a + b.held, 0), overdue: balances.reduce((a, b) => a + b.overdue, 0), depositValue: Number(balances.reduce((a, b) => a + b.depositValue, 0).toFixed(2)), customers: new Set(balances.map((b) => b.customerId)).size };
  const bySupplier = new Map<string, { supplier: string; units: number; overdue: number; depositValue: number; customers: Set<string> }>();
  for (const b of balances) {
    const cur = bySupplier.get(b.supplierId) ?? { supplier: b.supplier, units: 0, overdue: 0, depositValue: 0, customers: new Set<string>() };
    cur.units += b.held; cur.overdue += b.overdue; cur.depositValue += b.depositValue; cur.customers.add(b.customerId);
    bySupplier.set(b.supplierId, cur);
  }
  return {
    totals, balances: balances.sort((a, b) => b.overdue - a.overdue || b.held - a.held).slice(0, 200),
    bySupplier: [...bySupplier.entries()].map(([id, v]) => ({ id, supplier: v.supplier, units: v.units, overdue: v.overdue, depositValue: Number(v.depositValue.toFixed(2)), customers: v.customers.size })),
    disputes: await returnsList({ status: "DISPUTED" }, "en"),
    returns: await returnsList({}, "en", 30),
  };
}

export async function getReturn(ctx: Ctx, id: string, locale = "en") {
  const where: Prisma.EmptiesReturnWhereInput = isStaff(ctx) ? { id } : isVendor(ctx) && can(ctx, ["vendor.orders.view", "vendor.orders.manage"]) ? { id, OR: [{ supplierCompanyId: ctx.company.id }, { customerCompanyId: ctx.company.id }] } : { id, customerCompanyId: ctx.company.id };
  if (isStaff(ctx) && !can(ctx, ["admin.orders.view", "admin.orders.manage", "admin.claims.manage"])) throw new ForbiddenError();
  const [r] = await returnsList(where, locale, 1);
  if (!r) throw new NotFoundError("Return");
  const notes = await prisma.invoice.findMany({ where: { id: { in: (await prisma.emptiesReturn.findUniqueOrThrow({ where: { id } })).creditNoteIds } }, select: { id: true, fullNumber: true, providerNumber: true, grossTotal: true } });
  return { ...r, creditNotes: notes.map((n) => ({ id: n.id, number: n.providerNumber ?? n.fullNumber, gross: Number(n.grossTotal) })), viewer: isStaff(ctx) ? "ADMIN" : r.supplierId === ctx.company.id ? "SUPPLIER" : "CUSTOMER" };
}

/** Statement: every movement for the caller (customer or supplier), oldest first, with the running balance per item. */
export async function statement(ctx: Ctx, as: "CUSTOMER" | "SUPPLIER" | "ADMIN", f: { counterpartyId?: string | null; from?: Date | null; to?: Date | null }, locale = "en") {
  if (as === "ADMIN" ? !(isStaff(ctx) && can(ctx, ["admin.orders.view", "admin.finance.view"])) : as === "SUPPLIER" ? !(isVendor(ctx) && can(ctx, ["vendor.orders.view", "vendor.orders.manage"])) : !(isBuyer(ctx) && can(ctx, ["buyer.orders.view", "buyer.invoices.view"])))
    throw new ForbiddenError();
  const where: Prisma.ReturnableMovementWhereInput = as === "ADMIN" ? {} : as === "SUPPLIER" ? { supplierCompanyId: ctx.company.id } : { customerCompanyId: ctx.company.id };
  if (f.counterpartyId) Object.assign(where, as === "CUSTOMER" ? { supplierCompanyId: f.counterpartyId } : { customerCompanyId: f.counterpartyId });
  const moves = await prisma.returnableMovement.findMany({ where: { ...where, ...(f.from || f.to ? { at: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } } : {}) }, orderBy: { at: "asc" }, take: 5000 });
  const types = await prisma.returnableType.findMany({ where: { id: { in: [...new Set(moves.map((m) => m.typeId))] } } });
  const companies = await prisma.company.findMany({ where: { id: { in: [...new Set(moves.flatMap((m) => [m.customerCompanyId, m.supplierCompanyId]))] } }, select: { id: true, legalName: true, tradeName: true } });
  const orders = await prisma.order.findMany({ where: { id: { in: moves.map((m) => m.orderId).filter((x): x is string => !!x) } }, select: { id: true, number: true } });
  const rets = await prisma.emptiesReturn.findMany({ where: { id: { in: moves.map((m) => m.returnId).filter((x): x is string => !!x) } }, select: { id: true, number: true } });
  const run = new Map<string, number>();
  return moves.map((m) => {
    const k = `${m.customerCompanyId}|${m.supplierCompanyId}|${m.typeId}`;
    run.set(k, (run.get(k) ?? 0) + m.qty);
    const t = types.find((x) => x.id === m.typeId)!;
    return {
      at: m.at, kind: m.kind, qty: m.qty, balance: run.get(k)!, code: t.code, name: nameOf(t, locale), note: m.note,
      customer: cname(companies.find((c) => c.id === m.customerCompanyId)), supplier: cname(companies.find((c) => c.id === m.supplierCompanyId)),
      ref: orders.find((o) => o.id === m.orderId)?.number ?? rets.find((r) => r.id === m.returnId)?.number ?? null,
    };
  });
}

/** Deposits on an order (order page): units out, swapped, charged, unit deposit, VAT. */
export async function orderReturnables(orderId: string, locale = "en") {
  const rows = await prisma.orderReturnable.findMany({ where: { orderId }, include: { type: true } });
  return rows.map((r) => ({
    typeId: r.typeId, code: r.type.code, name: nameOf(r.type, locale), kind: r.type.kind, qtyOut: r.qtyOut, swapPlanned: r.swapPlanned, swapDone: r.swapDone, invoicedQty: r.invoicedQty,
    depositUnitNet: Number(r.depositUnitNet), vatRate: Number(r.vatRate),
    estimatedQty: chargedUnits(r.type.kind, r.qtyOut, r.swapDone ?? r.swapPlanned),
  }));
}

// ── cart: estimate + swaps ──────────────────────────────────────────────────

/** What the cart's goods carry (per supplier × type), the empties the buyer can swap, and the estimated deposit. */
export async function cartReturnables(ctx: Ctx, locale = "en") {
  if (!isBuyer(ctx)) return null;
  const s = await returnableSettings();
  if (!s.enabled) return null;
  const cart = await prisma.cart.findUnique({ where: { buyerCompanyId_userId: { buyerCompanyId: ctx.company.id, userId: ctx.user.id } }, include: { items: { include: { offer: { select: { vendorCompanyId: true } } } } } });
  if (!cart?.items.length) return null;
  const links = await prisma.offerReturnable.findMany({ where: { offerId: { in: cart.items.map((i) => i.offerId) }, type: { active: true } }, include: { type: true } });
  if (!links.length) return null;
  const plan = (cart.emptySwaps as Record<string, number> | null) ?? {};
  const bySupplier = new Map<string, { offerId: string; qty: number }[]>();
  for (const i of cart.items) (bySupplier.get(i.offer.vendorCompanyId) ?? bySupplier.set(i.offer.vendorCompanyId, []).get(i.offer.vendorCompanyId)!).push({ offerId: i.offerId, qty: i.qty });
  const out: { supplierId: string; typeId: string; code: string; name: string; kind: "DEPOSIT" | "EXCHANGE"; qtyOut: number; held: number; swap: number; charged: number; depositNet: number; depositTotal: number }[] = [];
  for (const [supplierId, lines] of bySupplier) {
    const units = unitsFor(lines, links);
    const held = await holdings({ customerCompanyId: ctx.company.id, supplierCompanyId: supplierId });
    for (const [typeId, qtyOut] of units) {
      const t = links.find((l) => l.typeId === typeId)!.type;
      const h = Math.max(0, held.find((x) => x.typeId === typeId)?.qty ?? 0);
      // by default the buyer swaps the empties they hold (at most one per full unit)
      const swap = t.kind === "EXCHANGE" ? Math.min(qtyOut, Math.max(0, Math.floor(plan[`${supplierId}:${typeId}`] ?? h))) : 0;
      const charged = chargedUnits(t.kind, qtyOut, swap);
      out.push({ supplierId, typeId, code: t.code, name: nameOf(t, locale), kind: t.kind, qtyOut, held: h, swap, charged, depositNet: Number(t.depositNet), depositTotal: Number(r2(new Decimal(t.depositNet.toString()).mul(charged))) });
    }
  }
  return { lines: out, depositTotal: Number(out.reduce((a, l) => a + l.depositTotal, 0).toFixed(2)) };
}

export async function setCartSwap(ctx: Ctx, supplierId: string, typeId: string, qty: number) {
  if (!isBuyer(ctx) || !can(ctx, "buyer.orders.place")) throw new ForbiddenError();
  const q = Math.max(0, Math.min(10_000, Math.floor(Number(qty) || 0)));
  const cart = await prisma.cart.findUnique({ where: { buyerCompanyId_userId: { buyerCompanyId: ctx.company.id, userId: ctx.user.id } } });
  if (!cart) throw new NotFoundError("Cart");
  const plan = { ...((cart.emptySwaps as Record<string, number> | null) ?? {}), [`${supplierId}:${typeId}`]: q };
  await prisma.cart.update({ where: { id: cart.id }, data: { emptySwaps: plan } });
}

/** The swaps the cart planned for one supplier's order ({ typeId: qty }); null when the buyer left the default. */
export function swapPlanFor(emptySwaps: unknown, supplierId: string): Record<string, number> | null {
  const plan = (emptySwaps as Record<string, number> | null) ?? null;
  if (!plan) return null;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(plan)) { const [s, t] = k.split(":"); if (s === supplierId) out[t] = v; }
  return Object.keys(out).length ? out : null;
}

/** Default swap for an order with no plan: the empties the buyer holds of each EXCHANGE type. */
export async function defaultSwaps(tx: Tx, customerId: string, supplierId: string) {
  const h = await holdings({ customerCompanyId: customerId, supplierCompanyId: supplierId }, tx);
  return Object.fromEntries(h.filter((x) => x.qty > 0).map((x) => [x.typeId, x.qty]));
}

// ── the daily job: overdue empties ──────────────────────────────────────────

export async function runReturnablesJob(now = new Date()) {
  const s = await returnableSettings();
  if (!s.enabled) return { reminded: 0, kept: 0 };
  const rows = await decorate(await balanceRows({}, now), "pt");
  const remRow = await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: REMINDED } });
  const reminded = { ...((remRow?.value as Record<string, string>) ?? {}) };
  let nRemind = 0, nKept = 0;
  const byCustomer = new Map<string, typeof rows>();
  for (const r of rows) if (r.overdue > 0) (byCustomer.get(`${r.customerId}|${r.supplierId}`) ?? byCustomer.set(`${r.customerId}|${r.supplierId}`, []).get(`${r.customerId}|${r.supplierId}`)!).push(r);
  for (const [k, list] of byCustomer) {
    const [customerId, supplierId] = k.split("|");
    const rule = overdueRule(s, supplierId);
    if (rule.action === "KEEP") {
      await prisma.$transaction(async (tx) => {
        for (const r of list) await tx.returnableMovement.create({ data: { customerCompanyId: customerId, supplierCompanyId: supplierId, typeId: r.typeId, kind: "KEPT", qty: -r.overdue, note: `Held more than ${rule.days} days: the deposit is kept` } });
      });
      nKept += list.length;
      const items = list.map((r) => `${r.overdue} × ${r.name}`).join(", ");
      await notify("returnables.kept", [{ companyId: customerId, link: "/buy/orders/empties" }, { companyId: supplierId, link: "/vendor/orders/empties" }], { customer: list[0].customer, supplier: list[0].supplier, items, days: rule.days }, { ref: { type: "Company", id: customerId } });
    } else {
      const last = reminded[k] ? new Date(reminded[k]) : null;
      if (last && now.getTime() - last.getTime() < s.overdue.remindEveryDays * 86_400_000) continue;
      const items = list.map((r) => `${r.overdue} × ${r.name}`).join(", ");
      await notify("returnables.overdue", [{ companyId: customerId, link: "/buy/orders/empties" }], { supplier: list[0].supplier, items, days: rule.days }, { ref: { type: "Company", id: customerId } });
      reminded[k] = now.toISOString();
      nRemind++;
    }
  }
  if (remRow) await prisma.setting.update({ where: { id: remRow.id }, data: { value: reminded } });
  else await prisma.setting.create({ data: { scope: "GLOBAL", scopeId: "", key: REMINDED, value: reminded } });
  return { reminded: nRemind, kept: nKept };
}

// ── page data (pages never touch the database directly) ─────────────────────

/** FIRINGI settings page: Schengen countries and suppliers for the per-supplier rule. */
export async function settingsFormData(ctx: Ctx) {
  if (!isStaff(ctx) || !can(ctx, ["admin.settings.view", "admin.settings.manage"])) throw new ForbiddenError();
  const [countries, suppliers] = await Promise.all([
    prisma.country.findMany({ where: { isSchengen: true }, select: { code: true, name: true }, orderBy: { code: "asc" } }),
    prisma.company.findMany({ where: { type: { in: ["DISTRIBUTOR", "WHOLESALER"] }, status: "APPROVED" }, select: { id: true, legalName: true, tradeName: true }, orderBy: { legalName: "asc" } }),
  ]);
  return {
    countries: countries.map((c) => ({ code: c.code, name: pickLocalized(c.name, "en") || c.code })),
    suppliers: suppliers.map((x) => ({ id: x.id, label: cname(x) })),
  };
}

/** Driver's proof-of-delivery form: the empties that can be taken back at this delivery. */
export async function deliveryEmpties(ctx: Ctx, deliveryId: string, locale = "en") {
  if (!ctx.driver) return [];
  const d = await prisma.delivery.findFirst({ where: { id: deliveryId, driverId: ctx.driver.id }, select: { order: { select: { id: true, buyerCompanyId: true, sellerCompanyId: true } } } });
  if (!d) return [];
  return stopItems(d.order.buyerCompanyId, d.order.sellerCompanyId, locale, [], d.order.id);
}

/** Supplier: customers who ordered from it (drop-off and correction forms). */
export async function vendorCustomers(ctx: Ctx) {
  if (!isVendor(ctx) || !can(ctx, ["vendor.orders.view", "vendor.orders.manage"])) throw new ForbiddenError();
  const rows = await prisma.company.findMany({ where: { type: { in: ["CUSTOMER", "WHOLESALER"] }, status: "APPROVED", ordersAsBuyer: { some: { sellerCompanyId: ctx.company.id } } }, select: { id: true, legalName: true, tradeName: true }, orderBy: { legalName: "asc" }, take: 300 });
  return rows.map((c) => ({ id: c.id, label: cname(c) }));
}

/** Customer: addresses a pickup can be collected from (branch staff: their branches). */
export async function pickupAddresses(ctx: Ctx) {
  if (!isBuyer(ctx)) throw new ForbiddenError();
  const { orderableAddressWhere } = await import("@/server/multisite/branches");
  const rows = await prisma.address.findMany({ where: await orderableAddressWhere(ctx), orderBy: [{ isDefault: "desc" }, { label: "asc" }], select: { id: true, label: true, line1: true, cityName: true } });
  return rows.map((a) => ({ id: a.id, label: `${a.label} · ${a.line1}, ${a.cityName ?? ""}` }));
}
