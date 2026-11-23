import "server-only";
/**
 * Consignment stock (Phase 65). Rules in src/lib/consignment.ts; docs in docs/consignment.md.
 *
 *   • The supplier (vendor.consignment.manage) opens a site at one of a customer's addresses (count interval, who
 *     counts) and sends stock from a warehouse: the goods leave its stock (TRANSFER_OUT, refType CONSIGNMENT) but stay
 *     the supplier's. The customer confirms what arrived; anything short is the supplier's loss (written off).
 *   • Counts (the customer, the supplier or its reps — vendor.consignment.count): what is left on the shelf. Used =
 *     received − returned − already used − on the shelf. The other side confirms (or disputes); nobody answering →
 *     confirmed automatically after FIRINGI's days. Confirmed → FIRINGI places an order for the used goods at the
 *     customer's prices, delivered at once, invoiced to the customer; the lots go out first-to-expire-first as a
 *     shipment on that order (cost of goods, recalls and the customer's expiry alerts follow them).
 *   • The supplier picks up unused goods (back to the warehouse, same lots) and closes the site when it is empty.
 *   • Job (hourly): automatic confirmation, "count due" reminders, "expires soon" alerts.
 *   • Two channels: a distributor with a wholesaler, a wholesaler with a shop / restaurant (same rules both ways; a
 *     wholesaler can be on both sides). FIRINGI switches consignment on/off, per channel and per supplier, and approves
 *     each new site before stock can be sent (PENDING → ACTIVE / REJECTED); whether customers may count; days, alerts.
 */
import type { ConsignmentCounter, Prisma } from "@prisma/client";
import Decimal from "decimal.js";
import { cache } from "react";
import { prisma, type Tx } from "@/server/db";
import { loadContext, type Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";
import { notify } from "@/server/notify/dispatch";
import { pickLocalized } from "@/i18n/config";
import { buyerTypeFor, channelOf, consignmentAllowed, confirmer, countLines, mergeConsignmentSettings, nextCountDue, onShelf, shelfByOffer, takeLots, type CLot, type ConsignmentSettings, type CountLine } from "@/lib/consignment";

const KEY = "consignment.settings";
const D = (v: { toString(): string } | number | string | null | undefined) => new Decimal(v == null ? 0 : v.toString());
const nameOf = (c: { legalName: string; tradeName: string | null } | null | undefined) => c?.tradeName ?? c?.legalName ?? "—";
const isStaff = (ctx: Ctx) => ctx.company.type === "ADMIN";
const isVendor = (ctx: Ctx) => ctx.company.type === "WHOLESALER" || ctx.company.type === "DISTRIBUTOR";
const isBuyer = (ctx: Ctx) => ctx.company.type === "CUSTOMER" || ctx.company.type === "WHOLESALER";
async function uiLocale(ctx: Ctx) {
  try { return await (await import("next-intl/server")).getLocale(); } catch { return ctx.user.locale ?? "en"; }
}
const OFFER_SEL = { id: true, vendorSku: true, packaging: { select: { name: true, variant: { select: { sku: true, product: { select: { name: true } } } } } } } as const;
async function nextNo(tx: Tx, name: string, prefix: string) {
  const { nextNumber } = await import("@/server/services/orders");
  return nextNumber(tx, name, prefix);
}

// ── settings ────────────────────────────────────────────────────────────────

async function readSettings() {
  const row = await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: KEY } });
  return mergeConsignmentSettings(row?.value as Partial<ConsignmentSettings> | null);
}
export const consignmentSettings = cache(readSettings);

export async function saveConsignmentSettings(ctx: Ctx, input: Partial<ConsignmentSettings>) {
  if (!isStaff(ctx) || !can(ctx, "admin.settings.manage")) throw new ForbiddenError();
  const before = await readSettings();
  const v = mergeConsignmentSettings({ ...before, ...input });
  const row = await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: KEY } });
  if (row) await prisma.setting.update({ where: { id: row.id }, data: { value: v as unknown as Prisma.InputJsonValue } });
  else await prisma.setting.create({ data: { scope: "GLOBAL", scopeId: "", key: KEY, value: v as unknown as Prisma.InputJsonValue } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "consignment.settings", entityType: "Setting", entityId: KEY, before: before as never, after: v as never });
  return v;
}

export async function setVendorConsignment(ctx: Ctx, vendorId: string, on: boolean) {
  const s = await readSettings();
  const set = new Set(s.disabledVendors);
  if (on) set.delete(vendorId); else set.add(vendorId);
  return saveConsignmentSettings(ctx, { disabledVendors: [...set] });
}

export const consignmentOn = consignmentAllowed;
async function requireOn(vendorId: string) {
  const s = await readSettings();
  const v = await prisma.company.findUnique({ where: { id: vendorId }, select: { id: true, type: true } });
  if (!v || !consignmentAllowed(s, v)) throw new AppError("FEATURE_OFF", "Consignment stock is switched off by FIRINGI.", 403);
  return s;
}

// ── access ──────────────────────────────────────────────────────────────────

const canManage = (ctx: Ctx) => isVendor(ctx) && can(ctx, "vendor.consignment.manage");
const canCountVendor = (ctx: Ctx) => isVendor(ctx) && can(ctx, ["vendor.consignment.manage", "vendor.consignment.count"]);
function requireManager(ctx: Ctx) { if (!canManage(ctx)) throw new ForbiddenError(); }

/** The site, if this person's company is its supplier (any consignment right) or its customer (orders). */
async function siteFor(ctx: Ctx, id: string) {
  const s = await prisma.consignmentSite.findUnique({ where: { id } });
  if (!s) throw new NotFoundError("Consignment");
  const vendorSide = s.vendorCompanyId === ctx.company.id && canCountVendor(ctx);
  const buyerSide = s.buyerCompanyId === ctx.company.id && (s.status === "ACTIVE" || s.status === "CLOSED") && isBuyer(ctx) && can(ctx, ["buyer.orders.place", "buyer.orders.view"]);
  const staff = isStaff(ctx) && can(ctx, ["admin.vendors.view", "admin.orders.view"]);
  if (!vendorSide && !buyerSide && !staff) throw new NotFoundError("Consignment");
  return { site: s, side: vendorSide ? ("VENDOR" as const) : buyerSide ? ("BUYER" as const) : ("ADMIN" as const) };
}

async function lotRows(siteId: string, db: Tx | typeof prisma = prisma): Promise<(CLot & { batchId: string | null; unitCost: Prisma.Decimal; lotCode: string | null })[]> {
  const lots = await db.consignmentLot.findMany({ where: { siteId }, include: { shipment: { select: { status: true } } } });
  return lots.map((l) => ({ id: l.id, offerId: l.offerId, expiresOn: l.expiresOn, qtySent: l.qtySent, qtyShort: l.qtyShort, qtyUsed: l.qtyUsed, qtyReturned: l.qtyReturned, received: l.shipment.status === "RECEIVED", batchId: l.batchId, unitCost: l.unitCost, lotCode: l.lotCode }));
}

// ── sites (supplier) ────────────────────────────────────────────────────────

export async function vendorOverview(ctx: Ctx) {
  if (!canCountVendor(ctx)) throw new ForbiddenError();
  const s = await readSettings();
  const sites = await prisma.consignmentSite.findMany({ where: { vendorCompanyId: ctx.company.id }, orderBy: [{ status: "asc" }, { createdAt: "desc" }], take: 200 });
  const ids = sites.map((x) => x.id);
  const [lots, shipments, counts, buyers, warehouses] = await Promise.all([
    prisma.consignmentLot.findMany({ where: { siteId: { in: ids } }, include: { shipment: { select: { status: true } } } }),
    prisma.consignmentShipment.groupBy({ by: ["siteId"], where: { siteId: { in: ids }, status: "SENT" }, _count: { _all: true } }),
    prisma.consignmentCount.groupBy({ by: ["siteId", "status"], where: { siteId: { in: ids }, status: { in: ["SUBMITTED", "DISPUTED", "FAILED"] } }, _count: { _all: true } }),
    prisma.company.findMany({ where: { id: { in: sites.map((x) => x.buyerCompanyId) } }, select: { id: true, legalName: true, tradeName: true } }),
    prisma.address.findMany({ where: { companyId: ctx.company.id, kind: "WAREHOUSE", isActive: true }, select: { id: true, label: true, cityName: true } }),
  ]);
  const bn = new Map(buyers.map((b) => [b.id, nameOf(b)]));
  const sent = new Map(shipments.map((x) => [x.siteId, x._count._all]));
  const pend = new Map<string, number>(), disp = new Map<string, number>();
  for (const c of counts) (c.status === "DISPUTED" ? disp : pend).set(c.siteId, ((c.status === "DISPUTED" ? disp : pend).get(c.siteId) ?? 0) + c._count._all);
  const now = Date.now();
  const rows = sites.map((x) => {
    const ls = lots.filter((l) => l.siteId === x.id).map((l) => ({ ...l, received: l.shipment.status === "RECEIVED" }));
    const units = ls.reduce((a, l) => a + onShelf(l), 0);
    const value = ls.reduce((a, l) => a.plus(D(l.unitCost).mul(onShelf(l))), new Decimal(0));
    const due = nextCountDue(x.lastCountAt, x.decidedAt ?? x.createdAt, x.countEveryDays);
    return {
      id: x.id, number: x.number, status: x.status, customer: bn.get(x.buyerCompanyId) ?? "—", units, value: Number(value.toFixed(2)), inTransit: sent.get(x.id) ?? 0,
      toConfirm: pend.get(x.id) ?? 0, disputed: disp.get(x.id) ?? 0, lastCountAt: x.lastCountAt?.toISOString() ?? null, nextDue: due.toISOString(), overdue: x.status === "ACTIVE" && units > 0 && due.getTime() < now,
    };
  });
  return {
    on: consignmentAllowed(s, ctx.company), manage: canManage(ctx), defaultEvery: s.defaultCountEveryDays,
    warehouses: warehouses.map((w) => ({ id: w.id, name: `${w.label} · ${w.cityName}` })),
    kpis: { sites: rows.filter((r) => r.status === "ACTIVE").length, units: rows.reduce((a, r) => a + r.units, 0), value: Number(rows.reduce((a, r) => a + r.value, 0).toFixed(2)), toConfirm: rows.reduce((a, r) => a + r.toConfirm, 0) },
    sites: rows,
  };
}

/** Customers the supplier can place stock with (approved, right kind), with their delivery addresses. */
export async function consignmentCustomers(ctx: Ctx, q?: string | null) {
  requireManager(ctx);
  const term = q?.trim().slice(0, 60) || "";
  const type = buyerTypeFor(ctx.company.type);
  const rows = await prisma.company.findMany({
    where: { type, status: "APPROVED", ...(type === "CUSTOMER" ? { countryId: ctx.company.countryId } : {}), ...(term ? { OR: [{ legalName: { contains: term, mode: "insensitive" } }, { tradeName: { contains: term, mode: "insensitive" } }, { taxId: { contains: term } }] } : {}) },
    select: { id: true, legalName: true, tradeName: true, taxId: true, addresses: { where: { kind: "DELIVERY", isActive: true }, select: { id: true, label: true, line1: true, cityName: true }, orderBy: { isDefault: "desc" } } },
    orderBy: { legalName: "asc" }, take: 25,
  });
  return rows.filter((r) => r.addresses.length).map((r) => ({ id: r.id, name: nameOf(r), taxId: r.taxId, addresses: r.addresses.map((a) => ({ id: a.id, label: `${a.label} · ${a.line1}, ${a.cityName}` })) }));
}

export async function createSite(ctx: Ctx, i: { buyerCompanyId: string; addressId: string; warehouseId: string; countEveryDays?: number | null; counter?: ConsignmentCounter; note?: string | null }) {
  requireManager(ctx);
  const s = await requireOn(ctx.company.id);
  const addr = await prisma.address.findFirst({ where: { id: i.addressId, companyId: i.buyerCompanyId, kind: "DELIVERY", isActive: true } });
  if (!addr) throw new ValidationError("Choose one of the customer's delivery addresses.");
  const buyer = await prisma.company.findFirst({ where: { id: i.buyerCompanyId, status: "APPROVED", type: buyerTypeFor(ctx.company.type) } });
  if (!buyer) throw new ValidationError("Choose a customer.");
  const wh = await prisma.address.findFirst({ where: { id: i.warehouseId, companyId: ctx.company.id, kind: "WAREHOUSE", isActive: true } });
  if (!wh) throw new ValidationError("Choose one of your warehouses.");
  if (await prisma.consignmentSite.findFirst({ where: { vendorCompanyId: ctx.company.id, addressId: addr.id, status: { in: ["ACTIVE", "PENDING"] } } })) throw new ValidationError("There is already consignment stock at this address.");
  const every = Math.min(90, Math.max(1, Math.round(Number(i.countEveryDays ?? s.defaultCountEveryDays)) || s.defaultCountEveryDays));
  const counter = i.counter === "CUSTOMER" && !s.allowCustomerCount ? "SUPPLIER" : i.counter ?? "EITHER";
  const site = await prisma.$transaction(async (tx) => tx.consignmentSite.create({
    data: { number: await nextNo(tx, "consignment_site", "CS"), status: s.requireApproval ? "PENDING" : "ACTIVE", vendorCompanyId: ctx.company.id, buyerCompanyId: buyer.id, addressId: addr.id, warehouseId: wh.id, countEveryDays: every, counter, note: i.note?.trim().slice(0, 500) || null, createdById: ctx.user.id },
  }));
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "consignment.site_created", entityType: "ConsignmentSite", entityId: site.id, after: { number: site.number, buyer: buyer.id, every, counter, status: site.status } });
  if (site.status === "PENDING") {
    const admin = await prisma.company.findFirst({ where: { type: "ADMIN" }, select: { id: true } });
    if (admin) await notify("consignment.site_pending", [{ companyId: admin.id, link: "/admin/vendors/consignment" }], { site: site.number, supplier: nameOf(ctx.company), customer: nameOf(buyer) }, { ref: { type: "ConsignmentSite", id: site.id } }).catch(() => null);
  } else await siteOpened(site);
  return site;
}

async function siteOpened(site: { id: string; number: string; vendorCompanyId: string; buyerCompanyId: string }) {
  const vendor = await prisma.company.findUnique({ where: { id: site.vendorCompanyId }, select: { legalName: true, tradeName: true } });
  await notify("consignment.site_opened", [{ companyId: site.buyerCompanyId, link: "/buy/orders/consignment" }], { site: site.number, supplier: nameOf(vendor) }, { ref: { type: "ConsignmentSite", id: site.id } }).catch(() => null);
}

/** FIRINGI approves (→ ACTIVE, stock can be sent) or rejects a new consignment site. */
export async function decideSite(ctx: Ctx, siteId: string, approve: boolean, reason?: string | null) {
  if (!isStaff(ctx) || !can(ctx, ["admin.vendors.approve", "admin.settings.manage"])) throw new ForbiddenError();
  const site = await prisma.consignmentSite.findUnique({ where: { id: siteId } });
  if (!site) throw new NotFoundError("Consignment");
  if (site.status !== "PENDING") throw new ValidationError("This consignment was already decided.");
  const why = reason?.trim().slice(0, 500) || null;
  if (!approve && !why) throw new ValidationError("Say why the consignment is rejected.");
  const ok = await prisma.consignmentSite.updateMany({ where: { id: siteId, status: "PENDING" }, data: { status: approve ? "ACTIVE" : "REJECTED", decidedAt: new Date(), decidedById: ctx.user.id, rejectReason: approve ? null : why, ...(approve ? {} : { closedAt: new Date() }) } });
  if (ok.count !== 1) throw new AppError("CONFLICT", "This consignment was just decided.", 409);
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: approve ? "consignment.site_approved" : "consignment.site_rejected", entityType: "ConsignmentSite", entityId: site.id, after: { reason: why } });
  await notify(approve ? "consignment.site_approved" : "consignment.site_rejected", [{ companyId: site.vendorCompanyId, link: `/vendor/consignment/${site.id}` }], { site: site.number, reason: why ?? "" }, { ref: { type: "ConsignmentSite", id: site.id } }).catch(() => null);
  if (approve) await siteOpened(site);
  return { status: approve ? ("ACTIVE" as const) : ("REJECTED" as const) };
}

export async function updateSite(ctx: Ctx, id: string, i: { countEveryDays: number; counter: ConsignmentCounter; note?: string | null }) {
  requireManager(ctx);
  const { site } = await siteFor(ctx, id);
  if (site.vendorCompanyId !== ctx.company.id) throw new ForbiddenError();
  const s = await readSettings();
  const counter = i.counter === "CUSTOMER" && !s.allowCustomerCount ? "SUPPLIER" : i.counter;
  await prisma.consignmentSite.update({ where: { id }, data: { countEveryDays: Math.min(90, Math.max(1, Math.round(i.countEveryDays))), counter, note: i.note?.trim().slice(0, 500) || null } });
}

/** Products the supplier can send to the site: own active offers with free stock in the site's warehouse. */
export async function shippableProducts(ctx: Ctx, siteId: string, q?: string | null) {
  requireManager(ctx);
  const { site } = await siteFor(ctx, siteId);
  const locale = await uiLocale(ctx);
  const term = q?.trim().toLowerCase().slice(0, 60) || "";
  const levels = await prisma.stockLevel.findMany({
    where: { addressId: site.warehouseId, offer: { vendorCompanyId: ctx.company.id, status: "ACTIVE", ...(term ? { OR: [{ vendorSku: { contains: term, mode: "insensitive" } }, { packaging: { variant: { product: { searchText: { contains: term } } } } }] } : {}) } },
    include: { offer: { select: OFFER_SEL } }, take: 60,
  });
  return levels.filter((l) => l.onHand - l.reserved > 0).map((l) => ({
    offerId: l.offerId, name: pickLocalized(l.offer.packaging.variant.product.name, locale) || "—", packaging: pickLocalized(l.offer.packaging.name, locale) || "", sku: l.offer.vendorSku ?? l.offer.packaging.variant.sku, free: l.onHand - l.reserved,
  })).sort((a, b) => a.name.localeCompare(b.name));
}

/** Send stock to the customer: it leaves the warehouse now (first to expire first, never expired or recalled lots). */
export async function sendStock(ctx: Ctx, siteId: string, items: { offerId: string; qty: number }[], note?: string | null) {
  requireManager(ctx);
  const { site } = await siteFor(ctx, siteId);
  if (site.vendorCompanyId !== ctx.company.id) throw new ForbiddenError();
  await requireOn(ctx.company.id);
  if (site.status === "PENDING") throw new ValidationError("FIRINGI hasn't approved this consignment yet.");
  if (site.status !== "ACTIVE") throw new ValidationError("This consignment is closed.");
  const clean = items.filter((x) => Number.isInteger(x.qty) && x.qty > 0);
  if (!clean.length) throw new ValidationError("Add at least one product.");
  const own = await prisma.vendorOffer.count({ where: { id: { in: clean.map((x) => x.offerId) }, vendorCompanyId: ctx.company.id } });
  if (own !== new Set(clean.map((x) => x.offerId)).size) throw new ValidationError("Choose your own products.");
  const { issue } = await import("@/server/inventory/ledger");
  const sh = await prisma.$transaction(async (tx) => {
    const shipment = await tx.consignmentShipment.create({ data: { number: await nextNo(tx, "consignment_shipment", "CSH"), siteId: site.id, note: note?.trim().slice(0, 500) || null, createdById: ctx.user.id } });
    for (const x of clean) {
      const level = await tx.stockLevel.findUnique({ where: { offerId_addressId: { offerId: x.offerId, addressId: site.warehouseId } } });
      const picks = await issue(tx, { offerId: x.offerId, addressId: site.warehouseId, qty: x.qty, type: "TRANSFER_OUT", refType: "CONSIGNMENT", refId: site.id, byUserId: ctx.user.id, note: `Consignment ${site.number} (${shipment.number})`, includeExpired: false });
      for (const p of picks) await tx.consignmentLot.create({ data: { siteId: site.id, shipmentId: shipment.id, offerId: x.offerId, batchId: p.batchId, lotCode: p.lotCode, expiresOn: p.expiresOn, unitCost: D(p.unitCost || (level ? level.avgCost : 0)).toFixed(4), qtySent: p.qty } });
    }
    return shipment;
  }, { timeout: 60_000 });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "consignment.sent", entityType: "ConsignmentShipment", entityId: sh.id, after: { site: site.number, lines: clean } });
  const vendor = await prisma.company.findUniqueOrThrow({ where: { id: ctx.company.id }, select: { legalName: true, tradeName: true } });
  await notify("consignment.shipment", [{ companyId: site.buyerCompanyId, link: "/buy/orders/consignment" }], { number: sh.number, supplier: nameOf(vendor), units: clean.reduce((a, x) => a + x.qty, 0) }, { ref: { type: "ConsignmentSite", id: site.id } }).catch(() => null);
  return sh;
}

/** Goods logged out for good (they left the warehouse's total when sent): back in and out again, at cost. */
async function logOut(tx: Tx, site: { id: string; number: string; warehouseId: string }, l: { offerId: string; batchId: string | null; unitCost: Prisma.Decimal }, qty: number, type: "SHIPMENT" | "WRITE_OFF", orderId: string | null, userId: string | null, note: string) {
  const base = { offerId: l.offerId, addressId: site.warehouseId, batchId: l.batchId, unitCost: l.unitCost.toFixed(4), refType: "CONSIGNMENT", refId: site.id, byUserId: userId };
  await tx.stockMovement.create({ data: { ...base, type: "TRANSFER_IN", qty, note: `From consignment ${site.number}` } });
  await tx.stockMovement.create({ data: { ...base, type, qty, orderId, note } });
}

/** The customer (or the supplier) confirms what arrived; anything short is written off (the supplier's loss). */
export async function receiveShipment(ctx: Ctx, shipmentId: string, received: Record<string, number>) {
  const sh = await prisma.consignmentShipment.findUnique({ where: { id: shipmentId }, include: { lots: true } });
  if (!sh) throw new NotFoundError("Shipment");
  const { site, side } = await siteFor(ctx, sh.siteId);
  if (side === "ADMIN" || (side === "BUYER" && !can(ctx, "buyer.orders.place")) || (side === "VENDOR" && !canManage(ctx))) throw new ForbiddenError();
  if (sh.status !== "SENT") throw new ValidationError("This delivery was already confirmed.");
  const sent = new Map<string, number>();
  for (const l of sh.lots) sent.set(l.offerId, (sent.get(l.offerId) ?? 0) + l.qtySent);
  for (const [offerId, n] of Object.entries(received ?? {})) {
    const v = Math.floor(Number(n));
    if (!sent.has(offerId) || !Number.isFinite(v) || v < 0 || v > (sent.get(offerId) ?? 0)) throw new ValidationError("Received quantities must be between 0 and what was sent.");
  }
  let short = 0;
  await prisma.$transaction(async (tx) => {
    const ok = await tx.consignmentShipment.updateMany({ where: { id: sh.id, status: "SENT" }, data: { status: "RECEIVED", receivedAt: new Date(), receivedById: ctx.user.id } });
    if (ok.count !== 1) throw new AppError("CONFLICT", "This delivery was just confirmed.", 409);
    for (const [offerId, total] of sent) {
      let missing = total - Math.floor(Number(received?.[offerId] ?? total));
      // the shortage comes off the latest-to-expire lots of the delivery
      for (const l of [...sh.lots.filter((x) => x.offerId === offerId)].sort((a, b) => (b.expiresOn?.getTime() ?? Infinity) - (a.expiresOn?.getTime() ?? Infinity))) {
        if (missing <= 0) break;
        const t = Math.min(missing, l.qtySent);
        await tx.consignmentLot.update({ where: { id: l.id }, data: { qtyShort: t } });
        await logOut(tx, site, l, t, "WRITE_OFF", null, ctx.user.id, `Short on consignment delivery ${sh.number}`);
        missing -= t; short += t;
      }
    }
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "consignment.received", entityType: "ConsignmentShipment", entityId: sh.id, after: { short } }, tx);
  }, { timeout: 60_000 });
  return { short };
}

// ── counts ──────────────────────────────────────────────────────────────────

/** Count what is left on the shelf. The other side confirms; nothing used → settled at once. */
export async function submitCount(ctx: Ctx, siteId: string, counted: Record<string, number>, note?: string | null) {
  const { site, side } = await siteFor(ctx, siteId);
  if (side === "ADMIN") throw new ForbiddenError();
  if (side === "BUYER" && !can(ctx, "buyer.orders.place")) throw new ForbiddenError();
  const s = await requireOn(site.vendorCompanyId);
  if (site.status !== "ACTIVE") throw new ValidationError("This consignment is closed.");
  if (side === "BUYER" && (site.counter === "SUPPLIER" || !s.allowCustomerCount)) throw new ForbiddenError("The supplier counts this stock.");
  if (side === "VENDOR" && site.counter === "CUSTOMER") throw new ForbiddenError("The customer counts this stock.");
  if (await prisma.consignmentCount.findFirst({ where: { siteId, status: { in: ["SUBMITTED", "FAILED"] } } })) throw new ValidationError("A count is waiting to be confirmed. Confirm or dispute it first.");
  const lots = await lotRows(siteId);
  const { lines, error } = countLines(shelfByOffer(lots), counted ?? {});
  if (error) throw new ValidationError(error);
  if (!lines.length) throw new ValidationError("There is nothing on the shelf to count.");
  const usedUnits = lines.reduce((a, l) => a + l.used, 0);
  const c = await prisma.$transaction(async (tx) => {
    await tx.consignmentCount.updateMany({ where: { siteId, status: "DISPUTED" }, data: { status: "SUPERSEDED" } });
    const row = await tx.consignmentCount.create({ data: {
      number: await nextNo(tx, "consignment_count", "CC"), siteId, status: usedUnits ? "SUBMITTED" : "INVOICED", countedByCompanyId: ctx.company.id, countedById: ctx.user.id,
      lines: lines as unknown as Prisma.InputJsonValue, usedUnits, note: note?.trim().slice(0, 500) || null, ...(usedUnits ? {} : { decidedAt: new Date() }),
    } });
    if (!usedUnits) await tx.consignmentSite.update({ where: { id: siteId }, data: { lastCountAt: row.countedAt } });
    return row;
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "consignment.counted", entityType: "ConsignmentCount", entityId: c.id, after: { site: site.number, usedUnits } });
  if (usedUnits) {
    const other = confirmer(ctx.company.id, site);
    await notify("consignment.count_to_confirm", [{ companyId: other, link: other === site.buyerCompanyId ? "/buy/orders/consignment" : `/vendor/consignment/${site.id}` }], { number: c.number, site: site.number, units: usedUnits, days: s.autoConfirmDays }, { ref: { type: "ConsignmentSite", id: site.id } }).catch(() => null);
  }
  return { id: c.id, number: c.number, status: c.status, usedUnits };
}

/** The other side accepts (→ billed) or disputes the count. */
export async function decideCount(ctx: Ctx, countId: string, accept: boolean, note?: string | null) {
  const c = await prisma.consignmentCount.findUnique({ where: { id: countId } });
  if (!c) throw new NotFoundError("Count");
  const { site, side } = await siteFor(ctx, c.siteId);
  if (side === "ADMIN" || (side === "BUYER" && !can(ctx, "buyer.orders.place")) || (side === "VENDOR" && !canManage(ctx))) throw new ForbiddenError();
  if (c.status !== "SUBMITTED") throw new ValidationError("This count was already decided.");
  if (confirmer(c.countedByCompanyId, site) !== ctx.company.id) throw new ForbiddenError("The other side confirms this count.");
  if (!accept) {
    const why = note?.trim().slice(0, 500);
    if (!why) throw new ValidationError("Say why the count is wrong.");
    await prisma.consignmentCount.update({ where: { id: c.id }, data: { status: "DISPUTED", disputeNote: why, decidedAt: new Date(), decidedById: ctx.user.id } });
    const admin = await prisma.company.findFirst({ where: { type: "ADMIN" }, select: { id: true } });
    await notify("consignment.disputed", [{ companyId: site.vendorCompanyId, link: `/vendor/consignment/${site.id}` }, { companyId: site.buyerCompanyId, link: "/buy/orders/consignment" }, ...(admin ? [{ companyId: admin.id, link: "/admin/vendors/consignment" }] : [])], { number: c.number, site: site.number, note: why }, { ref: { type: "ConsignmentSite", id: site.id } }).catch(() => null);
    return { status: "DISPUTED" as const };
  }
  return billCount(c.id, ctx.user.id, false);
}

/** Someone at the customer who may place orders (the bill is an order in the customer's name, at its prices). */
async function buyerCtx(buyerCompanyId: string): Promise<Ctx | null> {
  const last = await prisma.order.findFirst({ where: { buyerCompanyId }, orderBy: { placedAt: "desc" }, select: { placedByUserId: true } });
  const members = await prisma.membership.findMany({ where: { companyId: buyerCompanyId, status: "ACTIVE" }, orderBy: [{ isOwner: "desc" }, { createdAt: "asc" }], select: { userId: true }, take: 20 });
  for (const uid of [...new Set([...(last ? [last.placedByUserId] : []), ...members.map((m) => m.userId)])]) {
    const c = await loadContext(uid, "consignment", buyerCompanyId).catch(() => null);
    if (c && c.company.id === buyerCompanyId && c.permissions.has("buyer.orders.place")) return c;
  }
  return null;
}

/**
 * Bill a confirmed count: an order for the used goods (the customer's prices), delivered now, invoiced by FIRINGI;
 * the lots go out first to expire first. If anything fails the order is cancelled and the count is FAILED (retry).
 */
export async function billCount(countId: string, byUserId: string | null, auto: boolean) {
  const c = await prisma.consignmentCount.findUniqueOrThrow({ where: { id: countId }, include: { site: true } });
  const site = c.site;
  const lines = (c.lines as unknown as CountLine[]).filter((l) => l.used > 0);
  const fail = async (msg: string, orderId: string | null) => {
    if (orderId) {
      const { applyOrderTransition } = await import("@/server/services/orders");
      await prisma.$transaction(async (tx) => {
        const o = await tx.order.findUnique({ where: { id: orderId }, include: { lines: { select: { id: true, qtyOrdered: true, qtyConfirmed: true } } } });
        if (o && o.status !== "DELIVERED" && o.status !== "CANCELLED") await applyOrderTransition(tx, o, "CANCELLED", { reason: "Consignment billing failed", userId: byUserId, companyId: null });
      }).catch((x) => console.error("consignment rollback", orderId, x));
    }
    await prisma.consignmentCount.update({ where: { id: c.id }, data: { status: "FAILED", error: msg.slice(0, 500), decidedAt: new Date(), decidedById: byUserId, autoConfirmed: auto } });
    return { status: "FAILED" as const, error: msg };
  };
  if (!lines.length) {
    await prisma.$transaction([
      prisma.consignmentCount.update({ where: { id: c.id }, data: { status: "INVOICED", decidedAt: new Date(), decidedById: byUserId, autoConfirmed: auto } }),
      prisma.consignmentSite.update({ where: { id: site.id }, data: { lastCountAt: c.countedAt } }),
    ]);
    return { status: "INVOICED" as const };
  }
  const buyer = await buyerCtx(site.buyerCompanyId);
  if (!buyer) return fail("Nobody at the customer may place orders at the moment.", null);
  const { placeOrder, applyOrderTransition } = await import("@/server/services/orders");
  let orderId: string | null = null;
  try {
    const placed = await placeOrder(buyer, {
      deliveryAddressId: site.addressId, items: lines.map((l) => ({ offerId: l.offerId, qty: l.used })), approved: true,
      notes: `Consignment ${site.number} · count ${c.number}`,
      handover: { warehouseId: site.warehouseId, paidNow: true, reason: `Consignment stock used (count ${c.number})` },
    });
    const orders = "orders" in placed && placed.orders ? placed.orders : [];
    if (orders.length !== 1) return fail("The order for the used goods couldn't be placed.", orders[0]?.id ?? null);
    orderId = orders[0].id;
    const res = await prisma.$transaction(async (tx) => {
      const lots = await lotRows(site.id, tx);
      for (const l of lines) {
        const take = takeLots(lots, l.offerId, l.used, "FEFO");
        if (!take) throw new AppError("CHANGED", "The stock on the shelf changed since the count. Count again.", 409);
        for (const t of take) {
          const lot = lots.find((x) => x.id === t.lotId)!;
          const upd = await tx.consignmentLot.updateMany({ where: { id: lot.id, qtyUsed: lot.qtyUsed }, data: { qtyUsed: { increment: t.qty } } });
          if (upd.count !== 1) throw new AppError("CONFLICT", "The stock changed. Try again.", 409);
          lot.qtyUsed += t.qty;
          await logOut(tx, site, lot, t.qty, "SHIPMENT", orderId, byUserId, `Consignment ${site.number}: used`);
        }
      }
      const order = await tx.order.findUniqueOrThrow({ where: { id: orderId! }, include: { lines: { select: { id: true, qtyOrdered: true, qtyConfirmed: true } } } });
      for (const l of order.lines) await tx.orderLine.update({ where: { id: l.id }, data: { qtyConfirmed: l.qtyOrdered } });
      await applyOrderTransition(tx, { ...order, lines: order.lines.map((l) => ({ ...l, qtyConfirmed: l.qtyOrdered })) }, "DELIVERED", { reason: `Consignment stock used (count ${c.number})`, userId: byUserId, companyId: null });
      const inv = await tx.invoice.findMany({ where: { orderId: orderId!, docType: { in: ["INVOICE", "INVOICE_RECEIPT"] }, status: { not: "DRAFT" } }, orderBy: { createdAt: "asc" } });
      const gross = inv.reduce((a, x) => a.plus(D(x.grossTotal)), new Decimal(0));
      await tx.consignmentCount.update({ where: { id: c.id }, data: { status: "INVOICED", decidedAt: new Date(), decidedById: byUserId, autoConfirmed: auto, orderId, orderNumber: order.number, invoiceNumber: inv[0]?.fullNumber ?? null, grossTotal: gross.toFixed(2), error: null } });
      await tx.consignmentSite.update({ where: { id: site.id }, data: { lastCountAt: c.countedAt } });
      await writeAudit({ actorUserId: byUserId, actorCompanyId: null, action: "consignment.invoiced", entityType: "ConsignmentCount", entityId: c.id, after: { order: order.number, gross: gross.toFixed(2), auto } }, tx);
      return { number: order.number, gross };
    }, { timeout: 120_000 });
    (await import("@/server/invoicing/fiscal")).kickFiscalQueue();
    await (await import("@/server/loyalty/service")).earnForOrder(orderId).catch(() => null);
    await notify("consignment.invoiced", [{ companyId: site.buyerCompanyId, link: `/buy/orders/${orderId}` }, { companyId: site.vendorCompanyId, link: `/vendor/consignment/${site.id}` }], { number: res.number, site: site.number, total: Number(res.gross) }, { ref: { type: "Order", id: orderId } }).catch(() => null);
    return { status: "INVOICED" as const, orderNumber: res.number };
  } catch (e) {
    const msg = e instanceof AppError ? e.message : "The used goods couldn't be billed.";
    if (!(e instanceof AppError)) console.error("consignment bill", c.id, e);
    return fail(msg, orderId);
  }
}

/** Try again to bill a confirmed count that failed (supplier manager or FIRINGI). */
export async function retryCount(ctx: Ctx, countId: string) {
  const c = await prisma.consignmentCount.findUnique({ where: { id: countId }, include: { site: true } });
  if (!c) throw new NotFoundError("Count");
  const ok = (canManage(ctx) && c.site.vendorCompanyId === ctx.company.id) || (isStaff(ctx) && can(ctx, ["admin.orders.manage", "admin.vendors.approve"]));
  if (!ok) throw new ForbiddenError();
  if (c.status !== "FAILED") throw new ValidationError("Only a failed count can be billed again.");
  await prisma.consignmentCount.update({ where: { id: c.id }, data: { status: "SUBMITTED" } });
  return billCount(c.id, ctx.user.id, false);
}

// ── pick up, close ──────────────────────────────────────────────────────────

/** The supplier takes unused goods back: latest to expire first, back into the warehouse (same lots). */
export async function pickUp(ctx: Ctx, siteId: string, back: Record<string, number>) {
  requireManager(ctx);
  const { site } = await siteFor(ctx, siteId);
  if (site.vendorCompanyId !== ctx.company.id) throw new ForbiddenError();
  if (await prisma.consignmentCount.findFirst({ where: { siteId, status: { in: ["SUBMITTED", "FAILED"] } } })) throw new ValidationError("A count is waiting to be confirmed. Settle it first.");
  const wanted = Object.entries(back ?? {}).map(([offerId, n]) => ({ offerId, qty: Math.floor(Number(n)) })).filter((x) => x.qty > 0);
  if (!wanted.length) throw new ValidationError("Enter what you take back.");
  const { receive } = await import("@/server/inventory/ledger");
  let units = 0;
  await prisma.$transaction(async (tx) => {
    const lots = await lotRows(site.id, tx);
    for (const w of wanted) {
      const take = takeLots(lots, w.offerId, w.qty, "LATEST");
      if (!take) throw new ValidationError("You can't take back more than is on the shelf.");
      for (const t of take) {
        const l = lots.find((x) => x.id === t.lotId)!;
        await tx.consignmentLot.update({ where: { id: l.id }, data: { qtyReturned: { increment: t.qty } } });
        l.qtyReturned += t.qty;
        await receive(tx, { offerId: l.offerId, addressId: site.warehouseId, qty: t.qty, unitCost: l.unitCost.toString(), lotCode: l.lotCode, expiresOn: l.expiresOn ? new Date(l.expiresOn) : null, source: "TRANSFER", type: "TRANSFER_IN", refType: "CONSIGNMENT", refId: site.id, byUserId: ctx.user.id, note: `Back from consignment ${site.number}`, splitFromId: l.batchId });
        units += t.qty;
      }
    }
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "consignment.picked_up", entityType: "ConsignmentSite", entityId: site.id, after: { lines: wanted } }, tx);
  }, { timeout: 60_000 });
  return { units };
}

export async function closeSite(ctx: Ctx, siteId: string) {
  requireManager(ctx);
  const { site } = await siteFor(ctx, siteId);
  if (site.vendorCompanyId !== ctx.company.id) throw new ForbiddenError();
  if (site.status === "CLOSED" || site.status === "REJECTED") throw new ValidationError("This consignment is closed.");
  const lots = await lotRows(site.id);
  if (lots.some((l) => onShelf(l) > 0)) throw new ValidationError("Count or pick up what is left first.");
  if (await prisma.consignmentShipment.findFirst({ where: { siteId, status: "SENT" } })) throw new ValidationError("A delivery is still on its way.");
  if (await prisma.consignmentCount.findFirst({ where: { siteId, status: { in: ["SUBMITTED", "FAILED"] } } })) throw new ValidationError("A count is waiting to be confirmed.");
  await prisma.consignmentSite.update({ where: { id: siteId }, data: { status: "CLOSED", closedAt: new Date() } });
}

// ── one site, both sides ────────────────────────────────────────────────────

export async function siteDetail(ctx: Ctx, siteId: string) {
  const { site, side } = await siteFor(ctx, siteId);
  const s = await readSettings();
  const locale = await uiLocale(ctx);
  const [lots, shipments, counts, vendor, buyer, addr, wh] = await Promise.all([
    lotRows(site.id),
    prisma.consignmentShipment.findMany({ where: { siteId }, orderBy: { sentAt: "desc" }, include: { lots: true }, take: 30 }),
    prisma.consignmentCount.findMany({ where: { siteId }, orderBy: { countedAt: "desc" }, take: 30 }),
    prisma.company.findUnique({ where: { id: site.vendorCompanyId }, select: { legalName: true, tradeName: true } }),
    prisma.company.findUnique({ where: { id: site.buyerCompanyId }, select: { legalName: true, tradeName: true } }),
    prisma.address.findUnique({ where: { id: site.addressId }, select: { label: true, line1: true, cityName: true } }),
    prisma.address.findUnique({ where: { id: site.warehouseId }, select: { label: true, cityName: true } }),
  ]);
  const offers = await prisma.vendorOffer.findMany({ where: { id: { in: [...new Set(lots.map((l) => l.offerId))] } }, select: OFFER_SEL });
  const on = new Map(offers.map((o) => [o.id, o]));
  const products = new Map<string, { offerId: string; name: string; packaging: string; sku: string; sent: number; inTransit: number; short: number; used: number; returned: number; onShelf: number; value: number; nextExpiry: string | null }>();
  for (const l of lots) {
    const o = on.get(l.offerId);
    const p = products.get(l.offerId) ?? { offerId: l.offerId, name: pickLocalized(o?.packaging.variant.product.name, locale) || "—", packaging: pickLocalized(o?.packaging.name, locale) || "", sku: o?.vendorSku ?? "", sent: 0, inTransit: 0, short: 0, used: 0, returned: 0, onShelf: 0, value: 0, nextExpiry: null };
    p.sent += l.qtySent; p.short += l.qtyShort; p.used += l.qtyUsed; p.returned += l.qtyReturned;
    if (!l.received) p.inTransit += l.qtySent;
    const sh = onShelf(l);
    p.onShelf += sh;
    p.value += Number(D(l.unitCost).mul(sh));
    const e = sh > 0 && l.expiresOn ? new Date(l.expiresOn).toISOString().slice(0, 10) : null;
    if (e && (!p.nextExpiry || e < p.nextExpiry)) p.nextExpiry = e;
    products.set(l.offerId, p);
  }
  const nm = (id: string) => (id === site.vendorCompanyId ? nameOf(vendor) : nameOf(buyer));
  const due = nextCountDue(site.lastCountAt, site.decidedAt ?? site.createdAt, site.countEveryDays);
  const pending = counts.find((c) => c.status === "SUBMITTED");
  return {
    id: site.id, number: site.number, status: site.status, side, supplier: nameOf(vendor), customer: nameOf(buyer), vendorCompanyId: site.vendorCompanyId,
    address: addr ? `${addr.label} · ${addr.line1}, ${addr.cityName}` : "—", warehouse: wh ? `${wh.label} · ${wh.cityName}` : "—",
    countEveryDays: site.countEveryDays, counter: site.counter, note: site.note, rejectReason: site.rejectReason, lastCountAt: site.lastCountAt?.toISOString() ?? null, nextDue: due.toISOString(), autoConfirmDays: s.autoConfirmDays,
    canCount: site.status === "ACTIVE" && !pending && !counts.some((c) => c.status === "FAILED") && (side === "VENDOR" ? site.counter !== "CUSTOMER" : side === "BUYER" && can(ctx, "buyer.orders.place") && site.counter !== "SUPPLIER" && s.allowCustomerCount),
    canManage: side === "VENDOR" && canManage(ctx),
    canClose: side === "VENDOR" && canManage(ctx) && (site.status === "ACTIVE" || site.status === "PENDING"),
    products: [...products.values()].map((p) => ({ ...p, value: side === "BUYER" ? null : Math.round(p.value * 100) / 100 })).sort((a, b) => a.name.localeCompare(b.name)),
    shipments: shipments.map((x) => ({
      id: x.id, number: x.number, status: x.status, sentAt: x.sentAt.toISOString(), receivedAt: x.receivedAt?.toISOString() ?? null, note: x.note,
      lines: [...x.lots.reduce((m, l) => m.set(l.offerId, { sent: (m.get(l.offerId)?.sent ?? 0) + l.qtySent, short: (m.get(l.offerId)?.short ?? 0) + l.qtyShort }), new Map<string, { sent: number; short: number }>())].map(([offerId, q]) => ({ offerId, name: products.get(offerId)?.name ?? "—", ...q })),
    })),
    counts: counts.map((c) => ({
      id: c.id, number: c.number, status: c.status, countedBy: nm(c.countedByCompanyId), countedAt: c.countedAt.toISOString(), usedUnits: c.usedUnits, note: c.note, disputeNote: c.disputeNote, autoConfirmed: c.autoConfirmed,
      orderId: c.orderId, orderNumber: c.orderNumber, invoiceNumber: c.invoiceNumber, gross: c.grossTotal == null ? null : Number(c.grossTotal), error: c.error,
      toConfirmByMe: c.status === "SUBMITTED" && confirmer(c.countedByCompanyId, site) === ctx.company.id && (side === "BUYER" ? can(ctx, "buyer.orders.place") : canManage(ctx)),
      autoAt: c.status === "SUBMITTED" ? new Date(c.countedAt.getTime() + s.autoConfirmDays * 86400_000).toISOString() : null,
      lines: (c.lines as unknown as CountLine[]).map((l) => ({ ...l, name: products.get(l.offerId)?.name ?? "—" })),
    })),
  };
}

// ── the customer ────────────────────────────────────────────────────────────

export async function myConsignment(ctx: Ctx) {
  if (!isBuyer(ctx) || !can(ctx, ["buyer.orders.place", "buyer.orders.view"])) throw new ForbiddenError();
  const sites = await prisma.consignmentSite.findMany({ where: { buyerCompanyId: ctx.company.id, status: { in: ["ACTIVE", "CLOSED"] } }, orderBy: [{ status: "asc" }, { createdAt: "desc" }], take: 50 });
  const out = [];
  for (const x of sites) out.push(await siteDetail(ctx, x.id));
  return out;
}

export async function hasConsignment(buyerCompanyId: string) {
  return !!(await prisma.consignmentSite.findFirst({ where: { buyerCompanyId, status: { in: ["ACTIVE", "CLOSED"] } }, select: { id: true } }));
}

// ── FIRINGI ─────────────────────────────────────────────────────────────────

export async function adminOverview(ctx: Ctx) {
  if (!isStaff(ctx) || !can(ctx, ["admin.vendors.view", "admin.settings.manage", "admin.orders.view"])) throw new ForbiddenError();
  const s = await readSettings();
  const since = new Date(Date.now() - 30 * 86400_000);
  const [sites, lots, billed, disputes, failed] = await Promise.all([
    prisma.consignmentSite.findMany({ orderBy: { createdAt: "desc" }, take: 200 }),
    prisma.consignmentLot.findMany({ include: { shipment: { select: { status: true } } } }),
    prisma.consignmentCount.aggregate({ where: { status: "INVOICED", decidedAt: { gte: since } }, _sum: { grossTotal: true }, _count: { _all: true } }),
    prisma.consignmentCount.findMany({ where: { status: "DISPUTED" }, orderBy: { decidedAt: "desc" }, take: 30 }),
    prisma.consignmentCount.findMany({ where: { status: "FAILED" }, orderBy: { decidedAt: "desc" }, take: 30 }),
  ]);
  const cos = await prisma.company.findMany({ where: { id: { in: [...new Set([...sites.flatMap((x) => [x.vendorCompanyId, x.buyerCompanyId]), ...s.disabledVendors])] } }, select: { id: true, legalName: true, tradeName: true, type: true } });
  const ct = new Map(cos.map((c) => [c.id, c.type as string]));
  const addrs = await prisma.address.findMany({ where: { id: { in: sites.filter((x) => x.status === "PENDING").map((x) => x.addressId) } }, select: { id: true, label: true, line1: true, cityName: true } });
  const an = new Map(addrs.map((a) => [a.id, `${a.label} · ${a.line1}, ${a.cityName}`]));
  const cn = new Map(cos.map((c) => [c.id, nameOf(c)]));
  const sn = new Map(sites.map((x) => [x.id, x]));
  const per = new Map<string, { units: number; value: Decimal }>();
  for (const l of lots) {
    const sh = onShelf({ ...l, received: l.shipment.status === "RECEIVED" });
    const p = per.get(l.siteId) ?? { units: 0, value: new Decimal(0) };
    p.units += sh; p.value = p.value.plus(D(l.unitCost).mul(sh));
    per.set(l.siteId, p);
  }
  const bySupplier = new Map<string, { id: string; name: string; sites: number; units: number; value: number; on: boolean }>();
  for (const x of sites.filter((y) => y.status === "ACTIVE")) {
    const b = bySupplier.get(x.vendorCompanyId) ?? { id: x.vendorCompanyId, name: cn.get(x.vendorCompanyId) ?? "—", sites: 0, units: 0, value: 0, on: !s.disabledVendors.includes(x.vendorCompanyId) };
    b.sites++; b.units += per.get(x.id)?.units ?? 0; b.value += Number((per.get(x.id)?.value ?? new Decimal(0)).toFixed(2));
    bySupplier.set(x.vendorCompanyId, b);
  }
  const issue = (c: { id: string; number: string; siteId: string; disputeNote: string | null; error: string | null; decidedAt: Date | null }) => ({ id: c.id, number: c.number, site: sn.get(c.siteId)?.number ?? "—", supplier: cn.get(sn.get(c.siteId)?.vendorCompanyId ?? "") ?? "—", customer: cn.get(sn.get(c.siteId)?.buyerCompanyId ?? "") ?? "—", note: c.disputeNote ?? c.error, at: c.decidedAt?.toISOString() ?? null });
  return {
    settings: s,
    kpis: { sites: sites.filter((x) => x.status === "ACTIVE").length, pending: sites.filter((x) => x.status === "PENDING").length, value: Number([...per.values()].reduce((a, p) => a.plus(p.value), new Decimal(0)).toFixed(2)), billed30: Number(billed._sum.grossTotal ?? 0), counts30: billed._count._all, disputes: disputes.length + failed.length },
    suppliers: [...bySupplier.values()].sort((a, b) => b.value - a.value),
    disabled: s.disabledVendors.map((id) => ({ id, name: cn.get(id) ?? id })),
    disputes: disputes.map(issue), failed: failed.map(issue),
    pending: sites.filter((x) => x.status === "PENDING").map((x) => ({ id: x.id, number: x.number, supplier: cn.get(x.vendorCompanyId) ?? "—", customer: cn.get(x.buyerCompanyId) ?? "—", channel: channelOf(ct.get(x.vendorCompanyId) ?? ""), address: an.get(x.addressId) ?? "—", every: x.countEveryDays, counter: x.counter, note: x.note, at: x.createdAt.toISOString() })),
    sites: sites.map((x) => ({ id: x.id, number: x.number, status: x.status, channel: channelOf(ct.get(x.vendorCompanyId) ?? ""), supplier: cn.get(x.vendorCompanyId) ?? "—", customer: cn.get(x.buyerCompanyId) ?? "—", units: per.get(x.id)?.units ?? 0, value: Number((per.get(x.id)?.value ?? new Decimal(0)).toFixed(2)), lastCountAt: x.lastCountAt?.toISOString() ?? null, overdue: x.status === "ACTIVE" && (per.get(x.id)?.units ?? 0) > 0 && nextCountDue(x.lastCountAt, x.decidedAt ?? x.createdAt, x.countEveryDays).getTime() < Date.now() })),
  };
}

export async function searchVendors(ctx: Ctx, q: string) {
  if (!isStaff(ctx)) throw new ForbiddenError();
  const term = q.trim().slice(0, 60);
  if (term.length < 2) return [];
  const rows = await prisma.company.findMany({ where: { type: { in: ["WHOLESALER", "DISTRIBUTOR"] }, OR: [{ legalName: { contains: term, mode: "insensitive" } }, { tradeName: { contains: term, mode: "insensitive" } }] }, select: { id: true, legalName: true, tradeName: true }, take: 10 });
  return rows.map((r) => ({ id: r.id, name: nameOf(r) }));
}

// ── job ─────────────────────────────────────────────────────────────────────

/** Automatic confirmation of unanswered counts, "count due" reminders and "expires soon" alerts. */
export async function processConsignment(now = new Date()) {
  const s = await readSettings();
  let confirmed = 0, reminded = 0, alerted = 0;
  for (const c of await prisma.consignmentCount.findMany({ where: { status: "SUBMITTED", countedAt: { lt: new Date(now.getTime() - s.autoConfirmDays * 86400_000) } }, select: { id: true } })) {
    await billCount(c.id, null, true).catch((e) => console.error("consignment auto", c.id, e));
    confirmed++;
  }
  const active = await prisma.consignmentSite.findMany({ where: { status: "ACTIVE" } });
  const vt = new Map((await prisma.company.findMany({ where: { id: { in: [...new Set(active.map((x) => x.vendorCompanyId))] } }, select: { id: true, type: true } })).map((c) => [c.id, c.type as string]));
  for (const site of active) {
    const lots = await lotRows(site.id);
    const units = lots.reduce((a, l) => a + onShelf(l), 0);
    const due = nextCountDue(site.lastCountAt, site.decidedAt ?? site.createdAt, site.countEveryDays);
    if (units > 0 && due < now && (!site.remindedAt || site.remindedAt < due) && consignmentAllowed(s, { id: site.vendorCompanyId, type: vt.get(site.vendorCompanyId) ?? "" })) {
      const who = site.counter === "SUPPLIER" || !s.allowCustomerCount ? [site.vendorCompanyId] : site.counter === "CUSTOMER" ? [site.buyerCompanyId] : [site.buyerCompanyId, site.vendorCompanyId];
      await notify("consignment.count_due", who.map((companyId) => ({ companyId, link: companyId === site.buyerCompanyId ? "/buy/orders/consignment" : `/vendor/consignment/${site.id}` })), { site: site.number, days: site.countEveryDays }, { ref: { type: "ConsignmentSite", id: site.id } }).catch(() => null);
      await prisma.consignmentSite.update({ where: { id: site.id }, data: { remindedAt: now } });
      reminded++;
    }
    const soon = new Date(now.getTime() + s.expiryAlertDays * 86400_000);
    const expiring = (await prisma.consignmentLot.findMany({ where: { siteId: site.id, alertedAt: null, expiresOn: { not: null, lte: soon } } })).filter((l) => onShelf({ ...l, received: lots.find((x) => x.id === l.id)?.received ?? false }) > 0);
    if (expiring.length) {
      await notify("consignment.expiring", [{ companyId: site.vendorCompanyId, link: `/vendor/consignment/${site.id}` }], { site: site.number, n: expiring.reduce((a, l) => a + onShelf({ ...l, received: true }), 0), days: s.expiryAlertDays }, { ref: { type: "ConsignmentSite", id: site.id } }).catch(() => null);
      await prisma.consignmentLot.updateMany({ where: { id: { in: expiring.map((l) => l.id) } }, data: { alertedAt: now } });
      alerted++;
    }
  }
  return { confirmed, reminded, alerted };
}
