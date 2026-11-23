import "server-only";
/**
 * Van sales (Phase 63). Rules in src/lib/van-sales.ts; docs in docs/van-sales.md.
 *
 *   • The supplier's manager (vendor.vansales.manage) opens a load: a warehouse, a seller, a vehicle. Goods are added
 *     from the warehouse (first to expire first) — they leave its stock (TRANSFER_OUT), so online orders never sell
 *     what is on a van. Then the round starts.
 *   • The seller (vendor.vansales.sell) sells from the phone to registered FIRINGI customers at the customer's own
 *     prices. Each sale is a normal FIRINGI order, placed and delivered at once: FIRINGI invoices the customer as
 *     always. The goods are logged back in and out as a shipment on the order (cost of goods, recalls and the
 *     customer's lot alerts follow the lot). Payment is taken on the spot (cash, card, MB WAY) or left on account
 *     (credit control applies). The customer signs on the phone; empties can be handed back.
 *   • Without signal the phone keeps the sale and sends it later (Phase 39 outbox, kind "van.sale"); the sale's own
 *     id makes sure it is carried out once.
 *   • At the end of the day the manager (or the seller) unloads: units counted back return to the warehouse, the rest
 *     is recorded as missing (written off); the cash is counted against the cash sales. A difference above FIRINGI's
 *     limit is reported to FIRINGI and the supplier.
 *   • Money taken on the spot was collected by the supplier for FIRINGI: it is netted from what FIRINGI owes the
 *     supplier (open supplier invoices, oldest first) — at the end of the round and every night.
 *   • FIRINGI switches van sales on/off, per payment method, per supplier; sets the cash limit and the alerts.
 */
import type { Prisma, VanLoadStatus, VanPayMethod } from "@prisma/client";
import Decimal from "decimal.js";
import { prisma, type Tx } from "@/server/db";
import { loadContext, type Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";
import { notify } from "@/server/notify/dispatch";
import { pickLocalized } from "@/i18n/config";
import { pricedOffers } from "@/server/data/catalogue-buyer";
import { cashVariance, lotLeft, mergeVanSalesSettings, sellable, splitReturn, takeFromLots, VAN_METHODS, type VanSalesSettings } from "@/lib/van-sales";

const KEY = "vansales.settings";
const D = (v: { toString(): string } | number | string | null | undefined) => new Decimal(v == null ? 0 : v.toString());
const nameOf = (c: { legalName: string; tradeName: string | null } | null | undefined) => c?.tradeName ?? c?.legalName ?? "—";
const isStaff = (ctx: Ctx) => ctx.company.type === "ADMIN";
const isSeller = (ctx: Ctx) => ctx.company.type === "WHOLESALER" || ctx.company.type === "DISTRIBUTOR";
const startOfDay = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
async function uiLocale(ctx: Ctx) {
  try { return await (await import("next-intl/server")).getLocale(); } catch { return ctx.user.locale ?? "en"; }
}

// ── settings ────────────────────────────────────────────────────────────────

export async function vanSalesSettings(): Promise<VanSalesSettings> {
  const row = await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: KEY } });
  return mergeVanSalesSettings(row?.value as Partial<VanSalesSettings> | null);
}

export async function saveVanSalesSettings(ctx: Ctx, input: Partial<VanSalesSettings>) {
  if (!isStaff(ctx) || !can(ctx, "admin.settings.manage")) throw new ForbiddenError();
  const before = await vanSalesSettings();
  const v = mergeVanSalesSettings({ ...before, ...input, methods: { ...before.methods, ...(input.methods ?? {}) } });
  const row = await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: KEY } });
  if (row) await prisma.setting.update({ where: { id: row.id }, data: { value: v as unknown as Prisma.InputJsonValue } });
  else await prisma.setting.create({ data: { scope: "GLOBAL", scopeId: "", key: KEY, value: v as unknown as Prisma.InputJsonValue } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "vansales.settings", entityType: "Setting", entityId: KEY, before: before as never, after: v as never });
  return v;
}

/** FIRINGI switches van sales for one supplier. */
export async function setVendorVanSales(ctx: Ctx, vendorId: string, on: boolean) {
  const s = await vanSalesSettings();
  const set = new Set(s.disabledVendors);
  if (on) set.delete(vendorId); else set.add(vendorId);
  return saveVanSalesSettings(ctx, { disabledVendors: [...set] });
}

/** Van sales are available to this supplier (FIRINGI's switches). */
export async function vanSalesOn(vendorId: string, s?: VanSalesSettings) {
  const v = s ?? (await vanSalesSettings());
  return v.enabled && !v.disabledVendors.includes(vendorId);
}

async function requireOn(vendorId: string) {
  const s = await vanSalesSettings();
  if (!(await vanSalesOn(vendorId, s))) throw new AppError("FEATURE_OFF", "Van sales are switched off by FIRINGI.", 403);
  return s;
}

function requireManager(ctx: Ctx) {
  if (!isSeller(ctx) || !can(ctx, "vendor.vansales.manage")) throw new ForbiddenError();
}
function requireSellerRole(ctx: Ctx) {
  if (!isSeller(ctx) || !can(ctx, ["vendor.vansales.sell", "vendor.vansales.manage"])) throw new ForbiddenError();
}

// ── manager: loads ──────────────────────────────────────────────────────────

async function nextNo(tx: Tx, name: string, prefix: string) {
  const { nextNumber } = await import("@/server/services/orders");
  return nextNumber(tx, name, prefix);
}

/** People in the company who may sell from a van. */
async function sellers(companyId: string) {
  const members = await prisma.membership.findMany({ where: { companyId, status: "ACTIVE" }, select: { userId: true, user: { select: { name: true } } }, take: 80 });
  const out: { id: string; name: string }[] = [];
  for (const m of members) {
    const c = await loadContext(m.userId, "vansales", companyId).catch(() => null);
    if (c && c.company.id === companyId && (c.permissions.has("vendor.vansales.sell") || c.permissions.has("vendor.vansales.manage"))) out.push({ id: m.userId, name: m.user.name ?? "—" });
  }
  return out;
}

export async function vanOverview(ctx: Ctx) {
  requireManager(ctx);
  const s = await vanSalesSettings();
  const on = await vanSalesOn(ctx.company.id, s);
  const [loads, warehouses, vehicles, people, today, owed] = await Promise.all([
    prisma.vanLoad.findMany({ where: { vendorCompanyId: ctx.company.id }, orderBy: { createdAt: "desc" }, take: 60, include: { lots: true, sales: { where: { status: "DONE" }, select: { grossTotal: true, method: true, paid: true } } } }),
    prisma.address.findMany({ where: { companyId: ctx.company.id, kind: "WAREHOUSE", isActive: true }, select: { id: true, label: true, cityName: true } }),
    prisma.vehicle.findMany({ where: { ownerCompanyId: ctx.company.id, status: { in: ["ACTIVE", "PENDING_APPROVAL"] } }, select: { id: true, plate: true, type: true } }),
    sellers(ctx.company.id),
    prisma.vanSale.aggregate({ where: { vendorCompanyId: ctx.company.id, status: "DONE", soldAt: { gte: startOfDay() } }, _sum: { grossTotal: true, paid: true }, _count: { _all: true } }),
    cashOwed(ctx.company.id),
  ]);
  const users = await prisma.user.findMany({ where: { id: { in: loads.map((l) => l.sellerUserId) } }, select: { id: true, name: true } });
  const un = new Map(users.map((u) => [u.id, u.name ?? "—"]));
  const wn = new Map(warehouses.map((w) => [w.id, `${w.label} · ${w.cityName}`]));
  const vn = new Map(vehicles.map((v) => [v.id, v.plate]));
  return {
    on, settings: { methods: s.methods, maxCashPerSale: s.maxCashPerSale, requireSignature: s.requireSignature, allowEmpties: s.allowEmpties, allowOffline: s.allowOffline },
    warehouses: warehouses.map((w) => ({ id: w.id, name: `${w.label} · ${w.cityName}` })), vehicles: vehicles.map((v) => ({ id: v.id, name: `${v.plate} (${v.type})` })), sellers: people,
    today: { sales: today._count._all, gross: Number(today._sum.grossTotal ?? 0), paid: Number(today._sum.paid ?? 0) },
    owed: Number(owed.toFixed(2)),
    loads: loads.map((l) => ({
      id: l.id, number: l.number, status: l.status, seller: un.get(l.sellerUserId) ?? "—", warehouse: wn.get(l.warehouseId) ?? "—", vehicle: l.vehicleId ? vn.get(l.vehicleId) ?? "—" : null,
      units: l.lots.reduce((a, x) => a + x.qtyLoaded, 0), sold: l.lots.reduce((a, x) => a + x.qtySold, 0), left: l.lots.reduce((a, x) => a + lotLeft(x), 0),
      sales: l.sales.length, gross: Number(l.sales.reduce((a, x) => a.plus(D(x.grossTotal)), new Decimal(0)).toFixed(2)),
      cashExpected: Number(l.cashExpected), cashCounted: l.cashCounted == null ? null : Number(l.cashCounted), cashVariance: l.cashVariance == null ? null : Number(l.cashVariance),
      createdAt: l.createdAt.toISOString(), loadedAt: l.loadedAt?.toISOString() ?? null, closedAt: l.closedAt?.toISOString() ?? null,
    })),
  };
}

export async function createLoad(ctx: Ctx, i: { warehouseId: string; sellerUserId: string; vehicleId?: string | null; note?: string | null }) {
  requireManager(ctx);
  await requireOn(ctx.company.id);
  const wh = await prisma.address.findFirst({ where: { id: i.warehouseId, companyId: ctx.company.id, kind: "WAREHOUSE", isActive: true } });
  if (!wh) throw new ValidationError("Choose one of your warehouses.");
  if (!(await sellers(ctx.company.id)).some((p) => p.id === i.sellerUserId)) throw new ValidationError("Choose a person who may sell from a van.");
  if (i.vehicleId && !(await prisma.vehicle.findFirst({ where: { id: i.vehicleId, ownerCompanyId: ctx.company.id } }))) throw new ValidationError("Choose one of your vehicles.");
  const busy = await prisma.vanLoad.findFirst({ where: { sellerUserId: i.sellerUserId, vendorCompanyId: ctx.company.id, status: { in: ["OPEN", "ON_ROAD"] } } });
  if (busy) throw new ValidationError(`This seller already has a van out (${busy.number}). Unload it first.`);
  const load = await prisma.$transaction(async (tx) => tx.vanLoad.create({
    data: { number: await nextNo(tx, "van_load", "VL"), vendorCompanyId: ctx.company.id, warehouseId: wh.id, sellerUserId: i.sellerUserId, vehicleId: i.vehicleId || null, note: i.note?.trim().slice(0, 500) || null, createdById: ctx.user.id },
  }));
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "vansales.load_created", entityType: "VanLoad", entityId: load.id, after: { number: load.number, warehouse: wh.id, seller: i.sellerUserId } });
  return load;
}

async function ownLoad(ctx: Ctx, id: string, statuses?: VanLoadStatus[]) {
  const l = await prisma.vanLoad.findFirst({ where: { id, vendorCompanyId: ctx.company.id } });
  if (!l) throw new NotFoundError("Van load");
  if (statuses && !statuses.includes(l.status)) throw new ValidationError("This van load can't be changed any more.");
  return l;
}

/** Put goods on the van: they leave the warehouse (first to expire first; never expired or recalled lots). */
export async function addToLoad(ctx: Ctx, loadId: string, offerId: string, qty: number) {
  requireManager(ctx);
  await requireOn(ctx.company.id);
  if (!Number.isInteger(qty) || qty <= 0 || qty > 100_000) throw new ValidationError("Quantity must be a whole number above 0.");
  const load = await ownLoad(ctx, loadId, ["OPEN", "ON_ROAD"]);
  const offer = await prisma.vendorOffer.findFirst({ where: { id: offerId, vendorCompanyId: ctx.company.id } });
  if (!offer) throw new ValidationError("Choose one of your products.");
  const { issue } = await import("@/server/inventory/ledger");
  await prisma.$transaction(async (tx) => {
    const level = await tx.stockLevel.findUnique({ where: { offerId_addressId: { offerId, addressId: load.warehouseId } } });
    const picks = await issue(tx, { offerId, addressId: load.warehouseId, qty, type: "TRANSFER_OUT", refType: "VAN", refId: load.id, byUserId: ctx.user.id, note: `Loaded on van ${load.number}`, includeExpired: false });
    const avg = level ? D(level.avgCost) : new Decimal(0);
    for (const p of picks) {
      const same = await tx.vanLot.findFirst({ where: { loadId: load.id, offerId, batchId: p.batchId } });
      if (same) await tx.vanLot.update({ where: { id: same.id }, data: { qtyLoaded: { increment: p.qty } } });
      else await tx.vanLot.create({ data: { loadId: load.id, offerId, batchId: p.batchId, lotCode: p.lotCode, expiresOn: p.expiresOn, unitCost: avg.toFixed(4), qtyLoaded: p.qty } });
    }
  }, { timeout: 60_000 });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "vansales.loaded", entityType: "VanLoad", entityId: load.id, after: { offerId, qty } });
}

/** Take a product off a van that hasn't left yet: back into the warehouse, same lot. */
export async function removeFromLoad(ctx: Ctx, loadId: string, offerId: string) {
  requireManager(ctx);
  const load = await ownLoad(ctx, loadId, ["OPEN"]);
  await prisma.$transaction(async (tx) => {
    for (const l of await tx.vanLot.findMany({ where: { loadId: load.id, offerId } })) {
      await backToWarehouse(tx, load, l, lotLeft(l), ctx.user.id);
      await tx.vanLot.delete({ where: { id: l.id } });
    }
  }, { timeout: 60_000 });
}

async function backToWarehouse(tx: Tx, load: { id: string; number: string; warehouseId: string }, l: { offerId: string; batchId: string | null; lotCode: string | null; expiresOn: Date | null; unitCost: Prisma.Decimal }, qty: number, userId: string | null) {
  if (qty <= 0) return;
  const { receive } = await import("@/server/inventory/ledger");
  await receive(tx, { offerId: l.offerId, addressId: load.warehouseId, qty, unitCost: l.unitCost.toString(), lotCode: l.lotCode, expiresOn: l.expiresOn, source: "TRANSFER", type: "TRANSFER_IN", refType: "VAN", refId: load.id, byUserId: userId, note: `Back from van ${load.number}`, splitFromId: l.batchId });
}

export async function startRound(ctx: Ctx, loadId: string) {
  requireManager(ctx);
  await requireOn(ctx.company.id);
  const load = await ownLoad(ctx, loadId, ["OPEN"]);
  if (!(await prisma.vanLot.count({ where: { loadId: load.id } }))) throw new ValidationError("Load some goods first.");
  await prisma.vanLoad.update({ where: { id: load.id }, data: { status: "ON_ROAD", loadedAt: new Date() } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "vansales.round_started", entityType: "VanLoad", entityId: load.id });
}

export async function cancelLoad(ctx: Ctx, loadId: string) {
  requireManager(ctx);
  const load = await ownLoad(ctx, loadId, ["OPEN"]);
  await prisma.$transaction(async (tx) => {
    for (const l of await tx.vanLot.findMany({ where: { loadId: load.id } })) await backToWarehouse(tx, load, l, lotLeft(l), ctx.user.id);
    await tx.vanLot.deleteMany({ where: { loadId: load.id } });
    await tx.vanLoad.update({ where: { id: load.id }, data: { status: "CANCELLED", closedAt: new Date(), closedById: ctx.user.id } });
  }, { timeout: 60_000 });
}

/** Lots with names and what's left; `blocked` = recalled since loading. */
async function lotsOf(loadId: string, locale: string) {
  const lots = await prisma.vanLot.findMany({ where: { loadId }, orderBy: [{ offerId: "asc" }, { expiresOn: "asc" }] });
  const [offers, batches] = await Promise.all([
    prisma.vendorOffer.findMany({ where: { id: { in: [...new Set(lots.map((l) => l.offerId))] } }, select: { id: true, vendorSku: true, packaging: { select: { name: true, variant: { select: { product: { select: { name: true } } } } } } } }),
    prisma.stockBatch.findMany({ where: { id: { in: lots.map((l) => l.batchId).filter((x): x is string => !!x) } }, select: { id: true, blockedAt: true } }),
  ]);
  const on = new Map(offers.map((o) => [o.id, o]));
  const blocked = new Set(batches.filter((b) => b.blockedAt).map((b) => b.id));
  return lots.map((l) => {
    const o = on.get(l.offerId);
    return {
      id: l.id, offerId: l.offerId, name: pickLocalized(o?.packaging.variant.product.name, locale) || "—", packaging: pickLocalized(o?.packaging?.name, locale) || "", sku: o?.vendorSku ?? "",
      lotCode: l.lotCode, expiresOn: l.expiresOn, qtyLoaded: l.qtyLoaded, qtySold: l.qtySold, qtyBack: l.qtyBack, qtyLost: l.qtyLost, left: lotLeft(l),
      blocked: !!(l.batchId && blocked.has(l.batchId)), unitCost: Number(l.unitCost),
    };
  });
}

/** Per product: loaded, sold, left (lots summed). */
function perProduct(lots: Awaited<ReturnType<typeof lotsOf>>) {
  const m = new Map<string, { offerId: string; name: string; packaging: string; sku: string; loaded: number; sold: number; back: number; lost: number; left: number; sellable: number; lots: number; nextExpiry: string | null }>();
  const ok = sellable(lots);
  for (const l of lots) {
    const cur = m.get(l.offerId) ?? { offerId: l.offerId, name: l.name, packaging: l.packaging, sku: l.sku, loaded: 0, sold: 0, back: 0, lost: 0, left: 0, sellable: ok.get(l.offerId) ?? 0, lots: 0, nextExpiry: null };
    cur.loaded += l.qtyLoaded; cur.sold += l.qtySold; cur.back += l.qtyBack; cur.lost += l.qtyLost; cur.left += l.left; cur.lots += 1;
    const e = l.left > 0 && l.expiresOn ? l.expiresOn.toISOString().slice(0, 10) : null;
    if (e && (!cur.nextExpiry || e < cur.nextExpiry)) cur.nextExpiry = e;
    m.set(l.offerId, cur);
  }
  return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function loadDetail(ctx: Ctx, loadId: string) {
  requireManager(ctx);
  const load = await ownLoad(ctx, loadId);
  return describeLoad(ctx, load);
}

async function describeLoad(ctx: Ctx, load: NonNullable<Awaited<ReturnType<typeof prisma.vanLoad.findFirst>>>) {
  const locale = await uiLocale(ctx);
  const [lots, sales, seller, wh, vehicle] = await Promise.all([
    lotsOf(load.id, locale),
    prisma.vanSale.findMany({ where: { loadId: load.id }, orderBy: { soldAt: "desc" } }),
    prisma.user.findUnique({ where: { id: load.sellerUserId }, select: { name: true } }),
    prisma.address.findUnique({ where: { id: load.warehouseId }, select: { label: true, cityName: true } }),
    load.vehicleId ? prisma.vehicle.findUnique({ where: { id: load.vehicleId }, select: { plate: true } }) : null,
  ]);
  const cos = await prisma.company.findMany({ where: { id: { in: sales.map((s) => s.buyerCompanyId) } }, select: { id: true, legalName: true, tradeName: true } });
  const cn = new Map(cos.map((c) => [c.id, nameOf(c)]));
  const done = sales.filter((s) => s.status === "DONE");
  const byMethod = Object.fromEntries(VAN_METHODS.map((m) => [m, Number(done.filter((s) => s.method === m).reduce((a, s) => a.plus(D(s.grossTotal)), new Decimal(0)).toFixed(2))])) as Record<VanPayMethod, number>;
  return {
    id: load.id, number: load.number, status: load.status, note: load.note, closeNote: load.closeNote, seller: seller?.name ?? "—", sellerUserId: load.sellerUserId,
    warehouse: wh ? `${wh.label} · ${wh.cityName}` : "—", vehicle: vehicle?.plate ?? null,
    createdAt: load.createdAt.toISOString(), loadedAt: load.loadedAt?.toISOString() ?? null, closedAt: load.closedAt?.toISOString() ?? null,
    cashExpected: Number(load.cashExpected), cashCounted: load.cashCounted == null ? null : Number(load.cashCounted), cashVariance: load.cashVariance == null ? null : Number(load.cashVariance),
    lots: lots.map((l) => ({ ...l, expiresOn: l.expiresOn ? l.expiresOn.toISOString().slice(0, 10) : null })),
    products: perProduct(lots),
    byMethod, gross: Number(done.reduce((a, s) => a.plus(D(s.grossTotal)), new Decimal(0)).toFixed(2)),
    sales: sales.map((s) => ({
      id: s.id, number: s.number, status: s.status, error: s.error, customer: cn.get(s.buyerCompanyId) ?? "—", method: s.method, gross: Number(s.grossTotal), paid: Number(s.paid),
      orderId: s.orderId, orderNumber: s.orderNumber, invoiceId: s.invoiceId, invoiceNumber: s.invoiceNumber, signedBy: s.signedBy, hasSignature: !!s.signatureKey, soldAt: s.soldAt.toISOString(),
      at: s.latitude != null && s.longitude != null ? { lat: Number(s.latitude), lng: Number(s.longitude) } : null,
    })),
  };
}

/** Products the manager can put on a van: own active offers with free stock in that warehouse. */
export async function loadableProducts(ctx: Ctx, loadId: string, q?: string | null) {
  requireManager(ctx);
  const load = await ownLoad(ctx, loadId, ["OPEN", "ON_ROAD"]);
  const locale = await uiLocale(ctx);
  const term = q?.trim().toLowerCase().slice(0, 60) || "";
  const levels = await prisma.stockLevel.findMany({
    where: { addressId: load.warehouseId, offer: { vendorCompanyId: ctx.company.id, status: "ACTIVE", ...(term ? { OR: [{ vendorSku: { contains: term, mode: "insensitive" } }, { packaging: { variant: { product: { searchText: { contains: term } } } } }] } : {}) } },
    include: { offer: { select: { id: true, vendorSku: true, packaging: { select: { name: true, variant: { select: { product: { select: { name: true } } } } } } } } },
    take: 60,
  });
  return levels.filter((l) => l.onHand - l.reserved > 0).map((l) => ({
    offerId: l.offerId, name: pickLocalized(l.offer.packaging.variant.product.name, locale) || "—", packaging: pickLocalized(l.offer.packaging?.name, locale) || "", sku: l.offer.vendorSku ?? "", free: l.onHand - l.reserved,
  })).sort((a, b) => a.name.localeCompare(b.name));
}

// ── end of the day ──────────────────────────────────────────────────────────

/**
 * Unload: `counted` = units of each product that came back. They return to the warehouse (same lots); what is
 * left on the van beyond that is missing (written off). The cash is counted against the cash sales.
 */
export async function closeLoad(ctx: Ctx, loadId: string, i: { counted: Record<string, number>; cashCounted: number; note?: string | null }) {
  requireSellerRole(ctx);
  const load = await prisma.vanLoad.findFirst({ where: { id: loadId, vendorCompanyId: ctx.company.id } });
  if (!load) throw new NotFoundError("Van load");
  if (!can(ctx, "vendor.vansales.manage") && load.sellerUserId !== ctx.user.id) throw new ForbiddenError();
  if (load.status !== "ON_ROAD") throw new ValidationError("Only a van on the road can be unloaded.");
  const cash = Number(i.cashCounted);
  if (!Number.isFinite(cash) || cash < 0 || cash > 10_000_000) throw new ValidationError("Enter the cash counted (0 or more).");
  for (const v of Object.values(i.counted ?? {})) if (!Number.isInteger(Number(v)) || Number(v) < 0) throw new ValidationError("Counts must be whole numbers, 0 or more.");
  const pending = await prisma.vanSale.count({ where: { loadId: load.id, status: "FAILED" } });
  const s = await vanSalesSettings();
  const res = await prisma.$transaction(async (tx) => {
    const locked = await tx.vanLoad.updateMany({ where: { id: load.id, status: "ON_ROAD" }, data: { status: "CLOSED" } });
    if (locked.count !== 1) throw new AppError("CONFLICT", "This van was just unloaded by someone else.", 409);
    const lots = await tx.vanLot.findMany({ where: { loadId: load.id } });
    const split = splitReturn(lots, i.counted ?? {});
    let lostUnits = 0, lostValue = new Decimal(0);
    for (const l of lots) {
      const r = split.get(l.id) ?? { back: 0, lost: 0 };
      if (r.back) await backToWarehouse(tx, load, l, r.back, ctx.user.id);
      if (r.lost) {
        await logVanOut(tx, load, l, r.lost, "WRITE_OFF", null, ctx.user.id, `Missing after van ${load.number}`);
        lostUnits += r.lost;
        lostValue = lostValue.plus(D(l.unitCost).mul(r.lost));
      }
      if (r.back || r.lost) await tx.vanLot.update({ where: { id: l.id }, data: { qtyBack: { increment: r.back }, qtyLost: { increment: r.lost } } });
    }
    const variance = cashVariance(Number(load.cashExpected), cash);
    const closed = await tx.vanLoad.update({ where: { id: load.id }, data: { closedAt: new Date(), closedById: ctx.user.id, cashCounted: cash.toFixed(2), cashVariance: variance.toFixed(2), closeNote: i.note?.trim().slice(0, 500) || null } });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "vansales.closed", entityType: "VanLoad", entityId: load.id, after: { cashExpected: load.cashExpected.toString(), cashCounted: cash.toFixed(2), variance, lostUnits, lostValue: lostValue.toFixed(2), failedSales: pending } }, tx);
    return { closed, variance, lostUnits, lostValue: Number(lostValue.toFixed(2)) };
  }, { timeout: 120_000 });
  if (Math.abs(res.variance) > s.varianceAlert || res.lostUnits > 0) {
    const admin = await prisma.company.findFirst({ where: { type: "ADMIN" }, select: { id: true } });
    const vendor = await prisma.company.findUniqueOrThrow({ where: { id: ctx.company.id }, select: { legalName: true, tradeName: true } });
    const targets = [{ companyId: ctx.company.id, link: `/vendor/van/${load.id}` }, ...(admin ? [{ companyId: admin.id, link: "/admin/vendors/van-sales" }] : [])];
    await notify("vansales.variance", targets, { number: load.number, supplier: nameOf(vendor), variance: res.variance, missing: res.lostUnits }, { ref: { type: "VanLoad", id: load.id } });
  }
  await netVanCash(ctx.company.id, ctx.user.id).catch((e) => console.error("van cash netting", e));
  return res;
}

/** Goods that left on the van go out for good: logged back in and out (the warehouse total already dropped at loading). */
async function logVanOut(tx: Tx, load: { id: string; number: string; warehouseId: string }, l: { offerId: string; batchId: string | null; unitCost: Prisma.Decimal }, qty: number, type: "SHIPMENT" | "WRITE_OFF", orderId: string | null, userId: string | null, note: string) {
  const base = { offerId: l.offerId, addressId: load.warehouseId, batchId: l.batchId, unitCost: l.unitCost.toFixed(4), refType: "VAN", refId: load.id, byUserId: userId };
  await tx.stockMovement.create({ data: { ...base, type: "TRANSFER_IN", qty, note: `Off van ${load.number}` } });
  await tx.stockMovement.create({ data: { ...base, type, qty, orderId, note } });
}

// ── the seller ──────────────────────────────────────────────────────────────

/** The seller's van on the road (or being loaded). */
async function myLoad(ctx: Ctx) {
  return prisma.vanLoad.findFirst({ where: { vendorCompanyId: ctx.company.id, sellerUserId: ctx.user.id, status: { in: ["ON_ROAD", "OPEN"] } }, orderBy: { createdAt: "desc" } });
}

export async function myVan(ctx: Ctx) {
  requireSellerRole(ctx);
  const s = await vanSalesSettings();
  const on = await vanSalesOn(ctx.company.id, s);
  const load = await myLoad(ctx);
  const settings = { methods: s.methods, maxCashPerSale: s.maxCashPerSale, requireSignature: s.requireSignature, allowEmpties: s.allowEmpties, allowOffline: s.allowOffline };
  // the seller's last unloaded van (today): the cash difference and what was missing
  const last = await prisma.vanLoad.findFirst({ where: { vendorCompanyId: ctx.company.id, sellerUserId: ctx.user.id, status: "CLOSED", closedAt: { gte: new Date(Date.now() - 24 * 3600_000) } }, orderBy: { closedAt: "desc" }, include: { lots: { select: { qtyLost: true } } } });
  const lastClosed = last ? { number: last.number, variance: Number(last.cashVariance ?? 0), missing: last.lots.reduce((a, x) => a + x.qtyLost, 0) } : null;
  if (!load) return { on, settings, load: null, lastClosed };
  return { on, settings, load: await describeLoad(ctx, load), lastClosed };
}

/** Customers the seller can sell to: registered buyers of the right kind in the supplier's country. */
export async function vanCustomers(ctx: Ctx, q?: string | null) {
  requireSellerRole(ctx);
  const term = q?.trim().slice(0, 60) || "";
  const type = ctx.company.type === "DISTRIBUTOR" ? "WHOLESALER" : "CUSTOMER";
  const rows = await prisma.company.findMany({
    where: {
      type, status: "APPROVED", countryId: ctx.company.countryId,
      ...(term ? { OR: [{ legalName: { contains: term, mode: "insensitive" } }, { tradeName: { contains: term, mode: "insensitive" } }, { vatNumber: { contains: term.replace(/\s/g, "") } }, { taxId: { contains: term.replace(/\s/g, "") } }] } : {}),
    },
    select: { id: true, legalName: true, tradeName: true, taxId: true, addresses: { where: { kind: "DELIVERY", isActive: true }, select: { id: true, label: true, line1: true, cityName: true, isDefault: true }, orderBy: { isDefault: "desc" } } },
    orderBy: { legalName: "asc" }, take: 25,
  });
  return rows.filter((r) => r.addresses.length).map((r) => ({ id: r.id, name: nameOf(r), taxId: r.taxId, addresses: r.addresses.map((a) => ({ id: a.id, label: `${a.label} · ${a.line1}, ${a.cityName}` })) }));
}

/** Someone at the customer who may place orders (the sale is placed in the customer's name, at its prices). */
async function buyerCtx(buyerCompanyId: string): Promise<Ctx | null> {
  const last = await prisma.order.findFirst({ where: { buyerCompanyId }, orderBy: { placedAt: "desc" }, select: { placedByUserId: true } });
  const members = await prisma.membership.findMany({ where: { companyId: buyerCompanyId, status: "ACTIVE" }, orderBy: [{ isOwner: "desc" }, { createdAt: "asc" }], select: { userId: true }, take: 20 });
  for (const uid of [...new Set([...(last ? [last.placedByUserId] : []), ...members.map((m) => m.userId)])]) {
    const c = await loadContext(uid, "vansales", buyerCompanyId).catch(() => null);
    if (c && c.company.id === buyerCompanyId && c.permissions.has("buyer.orders.place")) return c;
  }
  return null;
}

/** The customer's prices for what is on the van (+ VAT rate, for the phone's offline estimate). */
export async function vanPrices(ctx: Ctx, buyerCompanyId: string) {
  requireSellerRole(ctx);
  const load = await myLoad(ctx);
  if (!load || load.status !== "ON_ROAD") return [];
  const buyer = await buyerCtx(buyerCompanyId);
  if (!buyer) return [];
  const locale = await uiLocale(ctx);
  const left = sellable(await vanLotRows(load.id));
  const ids = [...left.entries()].filter(([, n]) => n > 0).map(([id]) => id);
  if (!ids.length) return [];
  const priced = (await pricedOffers(buyer, ids.map((offerId) => ({ offerId, qty: 1 })))).items;
  const offers = await prisma.vendorOffer.findMany({ where: { id: { in: ids } }, select: { id: true, packaging: { select: { variant: { select: { product: { select: { taxCategoryId: true } } } } } } } });
  const tc = new Map(offers.map((o) => [o.id, o.packaging.variant.product.taxCategoryId]));
  const { vatRate } = await import("@/server/services/orders");
  const addr = await prisma.address.findFirst({ where: { companyId: buyerCompanyId, kind: "DELIVERY", isActive: true }, orderBy: { isDefault: "desc" }, include: { city: true } });
  const out = [];
  for (const p of priced) {
    if (!p.price) continue;
    const rate = await vatRate(prisma as unknown as Tx, buyer.company.countryId, addr?.city?.regionId ?? null, tc.get(p.offerId)!).catch(() => new Decimal(0));
    out.push({ offerId: p.offerId, name: pickLocalized(p.name, locale) || "—", packaging: pickLocalized(p.packaging.name, locale) || "", sku: p.vendorSku ?? p.sku, unitNet: Number(p.price.unitPriceNet), vatPct: Number(rate), left: left.get(p.offerId) ?? 0 });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

async function vanLotRows(loadId: string) {
  const lots = await prisma.vanLot.findMany({ where: { loadId } });
  const blocked = new Set((await prisma.stockBatch.findMany({ where: { id: { in: lots.map((l) => l.batchId).filter((x): x is string => !!x) }, blockedAt: { not: null } }, select: { id: true } })).map((b) => b.id));
  return lots.map((l) => ({ ...l, blocked: !!(l.batchId && blocked.has(l.batchId)) }));
}

export type VanSaleInput = {
  buyerCompanyId: string; addressId: string; items: { offerId: string; qty: number }[]; method: VanPayMethod;
  signedBy?: string | null; signature?: File | null; empties?: Record<string, number> | null; clientRef?: string | null;
  lat?: number | null; lng?: number | null; note?: string | null; soldAt?: Date | null;
};

/**
 * A sale from the van: placed as the customer (its prices, licences, credit when on account), delivered now,
 * invoiced by FIRINGI; paid on the spot or left on account. Sent twice with the same `clientRef` → done once.
 */
export async function sellFromVan(ctx: Ctx, i: VanSaleInput) {
  requireSellerRole(ctx);
  const s = await requireOn(ctx.company.id);
  // the phone's id for the sale, kept per seller (sent online, or again from the outbox later → done once)
  if (i.clientRef && !/^[A-Za-z0-9_-]{8,64}$/.test(i.clientRef)) throw new ValidationError("Bad sale id.");
  i = { ...i, clientRef: i.clientRef ? `${ctx.user.id.slice(-10)}:${i.clientRef}` : null };
  if (i.clientRef) {
    const prev = await prisma.vanSale.findUnique({ where: { clientRef: i.clientRef } });
    if (prev) {
      if (prev.vendorCompanyId !== ctx.company.id) throw new ValidationError("This sale id was used already.");
      return saleResult(prev);
    }
  }
  if (!VAN_METHODS.includes(i.method) || !s.methods[i.method]) throw new ValidationError("This payment method isn't allowed for van sales.");
  const load = await myLoad(ctx);
  if (!load || load.status !== "ON_ROAD") throw new ValidationError("You have no van on the road.");
  const items = new Map<string, number>();
  for (const x of i.items ?? []) {
    if (!Number.isInteger(x.qty) || x.qty <= 0 || x.qty > 100_000) throw new ValidationError("Quantities must be whole numbers above 0.");
    items.set(x.offerId, (items.get(x.offerId) ?? 0) + x.qty);
  }
  if (!items.size) throw new ValidationError("Add at least one product.");
  if (items.size > 100) throw new ValidationError("At most 100 lines.");
  if (s.requireSignature && !(i.signedBy?.trim()) ) throw new ValidationError("The customer's name and signature are needed.");
  const addr = await prisma.address.findFirst({ where: { id: i.addressId, companyId: i.buyerCompanyId, kind: "DELIVERY", isActive: true } });
  if (!addr) throw new ValidationError("Choose one of the customer's delivery addresses.");
  // enough on the van (first to expire first; never recalled or past the date)
  const lots0 = await vanLotRows(load.id);
  for (const [offerId, qty] of items) if (!takeFromLots(lots0, offerId, qty)) throw new AppError("OUT_OF_STOCK", "Not enough of a product on the van.", 409, { offerId, left: String(sellable(lots0).get(offerId) ?? 0) });
  const buyer = await buyerCtx(i.buyerCompanyId);
  if (!buyer) throw new AppError("NO_BUYER", "Nobody at this customer may place orders at the moment.", 409);
  if (i.method === "CASH" && s.maxCashPerSale > 0) {
    const { priceCheckout } = await import("@/server/orders/pricing");
    const pc = await priceCheckout(buyer, { items: [...items].map(([offerId, qty]) => ({ offerId, qty })), couponCode: null }, { regionId: null, addressId: addr.id, noDelivery: true, skipCoupon: true });
    if (pc.grandTotal.gt(s.maxCashPerSale)) throw new AppError("CASH_LIMIT", `Cash is limited to ${s.maxCashPerSale.toFixed(2)} € per sale. Choose another payment method.`, 422, { limit: s.maxCashPerSale.toFixed(2) });
  }
  const signature = i.signature ? await (await import("@/server/services/storage")).storeUpload(i.signature, "vansales") : null;
  const number = await prisma.$transaction((tx) => nextNo(tx, "van_sale", "VS"));
  const { placeOrder, applyOrderTransition } = await import("@/server/services/orders");
  let orderId: string | null = null, orderNumber: string | null = null;
  try {
    const placed = await placeOrder(buyer, {
      deliveryAddressId: addr.id, items: [...items].map(([offerId, qty]) => ({ offerId, qty })), approved: true,
      notes: [`Van sale ${number} · ${ctx.user.name ?? ""}`, i.note?.trim().slice(0, 300)].filter(Boolean).join(" — "),
      handover: { warehouseId: load.warehouseId, paidNow: i.method !== "ON_ACCOUNT", reason: "Sold from the supplier's van" },
    });
    const orders = "orders" in placed && placed.orders ? placed.orders : [];
    if (orders.length !== 1) throw new AppError("VAN_SALE", "The sale couldn't be placed.", 409);
    orderId = orders[0].id; orderNumber = orders[0].number;
    const sale = await prisma.$transaction(async (tx) => {
      // goods leave the van: first to expire first
      const lots = await tx.vanLot.findMany({ where: { loadId: load.id } });
      const rows = (await vanLotRows(load.id)).map((r) => ({ ...r, ...lots.find((l) => l.id === r.id)! }));
      for (const [offerId, qty] of items) {
        const take = takeFromLots(rows, offerId, qty);
        if (!take) throw new AppError("OUT_OF_STOCK", "Not enough of a product on the van.", 409, { offerId });
        for (const t of take) {
          const l = rows.find((r) => r.id === t.lotId)!;
          const upd = await tx.vanLot.updateMany({ where: { id: l.id, qtySold: l.qtySold }, data: { qtySold: { increment: t.qty } } });
          if (upd.count !== 1) throw new AppError("CONFLICT", "The van's stock changed. Try again.", 409);
          l.qtySold += t.qty;
          await logVanOut(tx, load, l, t.qty, "SHIPMENT", orderId, ctx.user.id, `Sold from van ${load.number}`);
        }
      }
      // delivered now: FIRINGI invoices the customer
      const order = await tx.order.findUniqueOrThrow({ where: { id: orderId! }, include: { lines: { select: { id: true, qtyOrdered: true, qtyConfirmed: true } } } });
      for (const l of order.lines) await tx.orderLine.update({ where: { id: l.id }, data: { qtyConfirmed: l.qtyOrdered } });
      await applyOrderTransition(tx, { ...order, lines: order.lines.map((l) => ({ ...l, qtyConfirmed: l.qtyOrdered })) }, "DELIVERED", { reason: `Sold from van ${load.number}`, userId: ctx.user.id, companyId: ctx.company.id });
      // empties handed back
      let emptiesReturnId: string | null = null;
      const empties = Object.fromEntries(Object.entries(i.empties ?? {}).map(([k, v]) => [k, Math.floor(Number(v) || 0)]).filter(([, v]) => (v as number) > 0));
      if (Object.keys(empties).length) {
        if (!s.allowEmpties) throw new ValidationError("Empties can't be taken back at van sales.");
        const r = await (await import("@/server/returnables/service")).recordOrderEmpties(tx, orderId!, empties, ctx.user.id);
        emptiesReturnId = r.ret?.id ?? null;
      }
      // the invoice(s) and what is still open on them (a customer credit may have paid part already)
      const invoices = await tx.invoice.findMany({ where: { orderId: orderId!, docType: { in: ["INVOICE", "INVOICE_RECEIPT"] }, status: { not: "DRAFT" } }, orderBy: { createdAt: "asc" } });
      const gross = invoices.reduce((a, x) => a.plus(D(x.grossTotal)), new Decimal(0));
      const { openAmounts } = await import("@/server/payments/service");
      const open = await openAmounts(invoices.map((x) => x.id), tx);
      let paid = new Decimal(0), paymentId: string | null = null;
      if (i.method !== "ON_ACCOUNT") {
        const allocs = invoices.map((x) => ({ invoiceId: x.id, amount: open.get(x.id) ?? new Decimal(0) })).filter((a) => a.amount.gt(0));
        paid = allocs.reduce((a, x) => a.plus(x.amount), new Decimal(0));
        if (paid.gt(0)) {
          const p = await tx.payment.create({ data: {
            companyId: i.buyerCompanyId, direction: "INBOUND", method: i.method, amount: paid.toFixed(2), reference: `Van sale ${number}`, status: "CONFIRMED", paidAt: i.soldAt ?? new Date(),
            recordedById: ctx.user.id, provider: "VAN", allocations: { create: allocs.map((a) => ({ invoiceId: a.invoiceId, amount: a.amount.toFixed(2) })) },
          } });
          paymentId = p.id;
        }
      }
      if (i.method === "CASH" && paid.gt(0)) await tx.vanLoad.update({ where: { id: load.id }, data: { cashExpected: { increment: paid.toFixed(2) } } });
      const row = await tx.vanSale.create({ data: {
        number, loadId: load.id, vendorCompanyId: ctx.company.id, buyerCompanyId: i.buyerCompanyId, addressId: addr.id, clientRef: i.clientRef || null, status: "DONE",
        orderId, orderNumber, invoiceId: invoices[0]?.id ?? null, invoiceNumber: invoices[0]?.fullNumber ?? null, method: i.method, grossTotal: gross.toFixed(2), paid: paid.toFixed(2), paymentId,
        signedBy: i.signedBy?.trim().slice(0, 120) || null, signatureKey: signature?.key ?? null, emptiesReturnId,
        latitude: Number.isFinite(Number(i.lat)) && i.lat != null ? Number(i.lat).toFixed(6) : null, longitude: Number.isFinite(Number(i.lng)) && i.lng != null ? Number(i.lng).toFixed(6) : null,
        note: i.note?.trim().slice(0, 500) || null, items: [...items].map(([offerId, qty]) => ({ offerId, qty })) as unknown as Prisma.InputJsonValue, createdById: ctx.user.id, soldAt: i.soldAt ?? new Date(),
      } });
      await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "vansale.done", entityType: "VanSale", entityId: row.id, after: { number, order: orderNumber, buyer: i.buyerCompanyId, method: i.method, gross: gross.toFixed(2), paid: paid.toFixed(2) } }, tx);
      return row;
    }, { timeout: 120_000 });
    // after: the certified invoice, loyalty points, the customer's receipt, empties to check
    (await import("@/server/invoicing/fiscal")).kickFiscalQueue();
    await (await import("@/server/loyalty/service")).earnForOrder(orderId).catch(() => null);
    if (sale.emptiesReturnId) await (await import("@/server/returnables/service")).afterCollected(sale.emptiesReturnId).catch(() => null);
    const vendor = await prisma.company.findUniqueOrThrow({ where: { id: ctx.company.id }, select: { legalName: true, tradeName: true } });
    await notify("vansale.receipt", [{ companyId: i.buyerCompanyId, link: `/buy/orders/${orderId}` }], { supplier: nameOf(vendor), number: orderNumber ?? "", total: Number(sale.grossTotal), paid: Number(sale.paid) }, { ref: { type: "Order", id: orderId } });
    return saleResult(sale);
  } catch (e) {
    // an order placed but not delivered (the van step failed): cancelled, nothing left half-done
    if (orderId) {
      await prisma.$transaction(async (tx) => {
        const o = await tx.order.findUnique({ where: { id: orderId! }, include: { lines: { select: { id: true, qtyOrdered: true, qtyConfirmed: true } } } });
        if (o && o.status !== "DELIVERED" && o.status !== "CANCELLED") await applyOrderTransition(tx, o, "CANCELLED", { reason: "Van sale failed", userId: ctx.user.id, companyId: ctx.company.id });
      }).catch((x) => console.error("van sale rollback", orderId, x));
    }
    const msg = e instanceof AppError ? e.message : "The sale couldn't be completed.";
    if (!(e instanceof AppError)) console.error("van sale", e);
    await prisma.vanSale.create({ data: {
      number, loadId: load.id, vendorCompanyId: ctx.company.id, buyerCompanyId: i.buyerCompanyId, addressId: addr.id, clientRef: i.clientRef ? `${i.clientRef}:failed:${Date.now()}` : null, status: "FAILED", error: msg.slice(0, 500),
      method: i.method, items: [...items].map(([offerId, qty]) => ({ offerId, qty })) as unknown as Prisma.InputJsonValue, createdById: ctx.user.id, signedBy: i.signedBy?.trim().slice(0, 120) || null,
    } }).catch(() => null);
    throw e;
  }
}

function saleResult(s: { id: string; number: string; status: string; orderId: string | null; orderNumber: string | null; invoiceId: string | null; invoiceNumber: string | null; grossTotal: Prisma.Decimal; paid: Prisma.Decimal; method: VanPayMethod }) {
  return { id: s.id, number: s.number, status: s.status, orderId: s.orderId, orderNumber: s.orderNumber, invoiceId: s.invoiceId, invoiceNumber: s.invoiceNumber, gross: Number(s.grossTotal), paid: Number(s.paid), method: s.method };
}

/** Empties the seller can take back: the kinds this supplier's products carry (+ its own types). */
export async function vanEmptyTypes(ctx: Ctx) {
  requireSellerRole(ctx);
  const locale = await uiLocale(ctx);
  const rows = await prisma.returnableType.findMany({ where: { active: true, OR: [{ ownerCompanyId: ctx.company.id }, { links: { some: { offer: { vendorCompanyId: ctx.company.id } } } }] }, orderBy: { code: "asc" }, take: 20 });
  return rows.map((t) => ({ typeId: t.id, name: pickLocalized(t.name, locale) || t.code }));
}

/** Recent customers of the seller's company (for the phone's list and its offline copy). */
export async function recentVanCustomers(ctx: Ctx) {
  requireSellerRole(ctx);
  const recent = await prisma.order.findMany({ where: { sellerCompanyId: ctx.company.id, placedAt: { gte: new Date(Date.now() - 120 * 86400_000) } }, distinct: ["buyerCompanyId"], orderBy: { placedAt: "desc" }, select: { buyerCompanyId: true }, take: 30 });
  const rows = await prisma.company.findMany({
    where: { id: { in: recent.map((r) => r.buyerCompanyId) }, status: "APPROVED" },
    select: { id: true, legalName: true, tradeName: true, taxId: true, addresses: { where: { kind: "DELIVERY", isActive: true }, select: { id: true, label: true, line1: true, cityName: true }, orderBy: { isDefault: "desc" } } },
  });
  return rows.filter((r) => r.addresses.length).map((r) => ({ id: r.id, name: nameOf(r), taxId: r.taxId, addresses: r.addresses.map((a) => ({ id: a.id, label: `${a.label} · ${a.line1}, ${a.cityName}` })) })).sort((a, b) => a.name.localeCompare(b.name));
}

/** The seller's sales today (and the van's cash so far). */
export async function mySalesToday(ctx: Ctx) {
  requireSellerRole(ctx);
  const rows = await prisma.vanSale.findMany({ where: { vendorCompanyId: ctx.company.id, createdById: ctx.user.id, soldAt: { gte: startOfDay() } }, orderBy: { soldAt: "desc" }, take: 100 });
  const cos = await prisma.company.findMany({ where: { id: { in: rows.map((r) => r.buyerCompanyId) } }, select: { id: true, legalName: true, tradeName: true } });
  const cn = new Map(cos.map((c) => [c.id, nameOf(c)]));
  return rows.map((r) => ({ ...saleResult(r), customer: cn.get(r.buyerCompanyId) ?? "—", soldAt: r.soldAt.toISOString(), error: r.error }));
}

/** The customer's signature image (supplier who sold, the customer, FIRINGI). */
export async function saleSignature(ctx: Ctx, id: string) {
  const s = await prisma.vanSale.findUnique({ where: { id } });
  if (!s?.signatureKey) throw new NotFoundError("Signature");
  const ok = (ctx.company.id === s.vendorCompanyId && can(ctx, ["vendor.vansales.manage", "vendor.vansales.sell"])) || (ctx.company.id === s.buyerCompanyId && can(ctx, ["buyer.orders.view", "buyer.orders.place"])) || (isStaff(ctx) && can(ctx, ["admin.orders.view", "admin.vendors.view"]));
  if (!ok) throw new ForbiddenError();
  return s.signatureKey;
}

// ── the customer ────────────────────────────────────────────────────────────

export async function boughtFromVans(buyerCompanyId: string) {
  return !!(await prisma.vanSale.findFirst({ where: { buyerCompanyId, status: "DONE" }, select: { id: true } }));
}

export async function myVanPurchases(ctx: Ctx) {
  if (!(ctx.company.type === "CUSTOMER" || ctx.company.type === "WHOLESALER") || !can(ctx, ["buyer.orders.view", "buyer.orders.place"])) throw new ForbiddenError();
  const rows = await prisma.vanSale.findMany({ where: { buyerCompanyId: ctx.company.id, status: "DONE" }, orderBy: { soldAt: "desc" }, take: 100 });
  const [cos, users] = await Promise.all([
    prisma.company.findMany({ where: { id: { in: rows.map((r) => r.vendorCompanyId) } }, select: { id: true, legalName: true, tradeName: true } }),
    prisma.user.findMany({ where: { id: { in: rows.map((r) => r.createdById) } }, select: { id: true, name: true } }),
  ]);
  const cn = new Map(cos.map((c) => [c.id, nameOf(c)])), un = new Map(users.map((u) => [u.id, u.name ?? "—"]));
  return rows.map((r) => ({ ...saleResult(r), supplier: cn.get(r.vendorCompanyId) ?? "—", seller: un.get(r.createdById) ?? "—", signedBy: r.signedBy, hasSignature: !!r.signatureKey, soldAt: r.soldAt.toISOString() }));
}

// ── money: cash collected for FIRINGI ───────────────────────────────────────

/** Money the supplier's sellers took on the spot for FIRINGI and FIRINGI hasn't netted yet. */
export async function cashOwed(vendorId: string, db: Tx | typeof prisma = prisma) {
  const a = await db.vanSale.aggregate({ where: { vendorCompanyId: vendorId, status: "DONE", method: { not: "ON_ACCOUNT" } }, _sum: { paid: true, cashNetted: true } });
  return D(a._sum.paid).minus(D(a._sum.cashNetted));
}

/**
 * Net what the supplier collected against what FIRINGI owes it (open approved supplier invoices, oldest first):
 * an outbound payment of that amount to those invoices, reference "Compensação vendas carrinha". What can't be
 * netted yet waits for the next supplier invoice.
 */
export async function netVanCash(vendorId: string, actorUserId: string | null) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Company" WHERE id = ${vendorId} FOR UPDATE`;
    let need = await cashOwed(vendorId, tx);
    if (need.lte(0.004)) return new Decimal(0);
    const vis = await tx.vendorInvoice.findMany({ where: { vendorCompanyId: vendorId, status: "APPROVED", docType: { not: "CREDIT_NOTE" } }, orderBy: { issueDate: "asc" }, include: { paymentAllocations: { where: { payment: { status: "CONFIRMED" } }, select: { amount: true } } } });
    const allocs: { vendorInvoiceId: string; amount: Decimal; full: boolean }[] = [];
    for (const v of vis) {
      if (need.lte(0)) break;
      const open = D(v.grossTotal).minus(v.paymentAllocations.reduce((a, x) => a.plus(D(x.amount)), new Decimal(0)));
      if (open.lte(0.004)) continue;
      const take = Decimal.min(need, open);
      allocs.push({ vendorInvoiceId: v.id, amount: take, full: take.gte(open) });
      need = need.minus(take);
    }
    const total = allocs.reduce((a, x) => a.plus(x.amount), new Decimal(0));
    if (total.lte(0)) return new Decimal(0);
    await tx.payment.create({ data: {
      companyId: vendorId, direction: "OUTBOUND", method: "OTHER", amount: total.toFixed(2), reference: "Compensação vendas carrinha", status: "CONFIRMED", paidAt: new Date(), recordedById: actorUserId, provider: "VAN",
      allocations: { create: allocs.map((x) => ({ vendorInvoiceId: x.vendorInvoiceId, amount: x.amount.toFixed(2) })) },
    } });
    for (const x of allocs) if (x.full) await tx.vendorInvoice.update({ where: { id: x.vendorInvoiceId }, data: { status: "PAID" } });
    // spread the netted amount over the oldest sales first
    let left = total;
    for (const sale of await tx.vanSale.findMany({ where: { vendorCompanyId: vendorId, status: "DONE", method: { not: "ON_ACCOUNT" } }, orderBy: { soldAt: "asc" } })) {
      if (left.lte(0)) break;
      const open = D(sale.paid).minus(D(sale.cashNetted));
      if (open.lte(0)) continue;
      const t = Decimal.min(open, left);
      await tx.vanSale.update({ where: { id: sale.id }, data: { cashNetted: { increment: t.toFixed(2) } } });
      left = left.minus(t);
    }
    await writeAudit({ actorUserId, actorCompanyId: null, action: "vansales.netted", entityType: "Company", entityId: vendorId, after: { amount: total.toFixed(2), vendorInvoices: allocs.map((x) => x.vendorInvoiceId) } }, tx);
    return total;
  }, { timeout: 60_000 });
}

/** The supplier's own view of the money: collected on the spot, netted, still to settle. */
export async function vendorCash(ctx: Ctx) {
  requireManager(ctx);
  const a = await prisma.vanSale.aggregate({ where: { vendorCompanyId: ctx.company.id, status: "DONE", method: { not: "ON_ACCOUNT" } }, _sum: { paid: true, cashNetted: true } });
  return { collected: Number(a._sum.paid ?? 0), netted: Number(a._sum.cashNetted ?? 0), owed: Number(D(a._sum.paid).minus(D(a._sum.cashNetted)).toFixed(2)) };
}

// ── FIRINGI ─────────────────────────────────────────────────────────────────

export async function adminOverview(ctx: Ctx) {
  if (!isStaff(ctx) || !can(ctx, ["admin.vendors.view", "admin.orders.view", "admin.settings.manage"])) throw new ForbiddenError();
  const s = await vanSalesSettings();
  const since = new Date(Date.now() - 30 * 86400_000);
  const [loads, bySupplier, onRoad, variances] = await Promise.all([
    prisma.vanLoad.findMany({ orderBy: { createdAt: "desc" }, take: 60, include: { sales: { where: { status: "DONE" }, select: { grossTotal: true } } } }),
    prisma.vanSale.groupBy({ by: ["vendorCompanyId"], where: { status: "DONE", soldAt: { gte: since } }, _sum: { grossTotal: true, paid: true }, _count: { _all: true } }),
    prisma.vanLoad.count({ where: { status: "ON_ROAD" } }),
    prisma.vanLoad.findMany({ where: { status: "CLOSED", closedAt: { gte: since }, NOT: { cashVariance: 0 } }, select: { cashVariance: true } }),
  ]);
  const vendorIds = [...new Set([...loads.map((l) => l.vendorCompanyId), ...bySupplier.map((b) => b.vendorCompanyId), ...s.disabledVendors])];
  const cos = await prisma.company.findMany({ where: { id: { in: vendorIds } }, select: { id: true, legalName: true, tradeName: true } });
  const cn = new Map(cos.map((c) => [c.id, nameOf(c)]));
  const users = await prisma.user.findMany({ where: { id: { in: loads.map((l) => l.sellerUserId) } }, select: { id: true, name: true } });
  const un = new Map(users.map((u) => [u.id, u.name ?? "—"]));
  const suppliers = [];
  for (const b of bySupplier) suppliers.push({ id: b.vendorCompanyId, name: cn.get(b.vendorCompanyId) ?? "—", sales: b._count._all, gross: Number(b._sum.grossTotal ?? 0), paidOnSpot: Number(b._sum.paid ?? 0), owed: Number((await cashOwed(b.vendorCompanyId)).toFixed(2)), on: !s.disabledVendors.includes(b.vendorCompanyId) });
  const stale = Date.now() - s.maxRoundHours * 3600_000;
  return {
    settings: s,
    kpis: {
      onRoad, sales30: bySupplier.reduce((a, b) => a + b._count._all, 0), gross30: Number(bySupplier.reduce((a, b) => a.plus(D(b._sum.grossTotal)), new Decimal(0)).toFixed(2)),
      owed: Number(suppliers.reduce((a, x) => a + x.owed, 0).toFixed(2)), variance30: Number(variances.reduce((a, v) => a.plus(D(v.cashVariance)), new Decimal(0)).toFixed(2)),
    },
    suppliers: suppliers.sort((a, b) => b.gross - a.gross),
    disabled: s.disabledVendors.map((id) => ({ id, name: cn.get(id) ?? id })),
    loads: loads.map((l) => ({
      id: l.id, number: l.number, supplier: cn.get(l.vendorCompanyId) ?? "—", seller: un.get(l.sellerUserId) ?? "—", status: l.status, sales: l.sales.length,
      gross: Number(l.sales.reduce((a, x) => a.plus(D(x.grossTotal)), new Decimal(0)).toFixed(2)), cashExpected: Number(l.cashExpected), cashCounted: l.cashCounted == null ? null : Number(l.cashCounted),
      cashVariance: l.cashVariance == null ? null : Number(l.cashVariance), late: l.status === "ON_ROAD" && !!l.loadedAt && l.loadedAt.getTime() < stale,
      loadedAt: l.loadedAt?.toISOString() ?? null, closedAt: l.closedAt?.toISOString() ?? null,
    })),
  };
}

/** Suppliers FIRINGI may switch van sales off for (search). */
export async function searchVendors(ctx: Ctx, q: string) {
  if (!isStaff(ctx)) throw new ForbiddenError();
  const term = q.trim().slice(0, 60);
  if (term.length < 2) return [];
  const rows = await prisma.company.findMany({ where: { type: { in: ["WHOLESALER", "DISTRIBUTOR"] }, OR: [{ legalName: { contains: term, mode: "insensitive" } }, { tradeName: { contains: term, mode: "insensitive" } }] }, select: { id: true, legalName: true, tradeName: true }, take: 10 });
  return rows.map((r) => ({ id: r.id, name: nameOf(r) }));
}

export async function adminNetNow(ctx: Ctx, vendorId: string) {
  if (!isStaff(ctx) || !can(ctx, "admin.finance.manage")) throw new ForbiddenError();
  return Number((await netVanCash(vendorId, ctx.user.id)).toFixed(2));
}

// ── nightly job ─────────────────────────────────────────────────────────────

/** Net collected cash for every supplier; flag vans still out after FIRINGI's limit. */
export async function processVanSales(now = new Date()) {
  const s = await vanSalesSettings();
  let netted = new Decimal(0);
  const vendors = await prisma.vanSale.groupBy({ by: ["vendorCompanyId"], where: { status: "DONE", method: { not: "ON_ACCOUNT" } }, _sum: { paid: true, cashNetted: true } });
  for (const v of vendors) if (D(v._sum.paid).minus(D(v._sum.cashNetted)).gt(0.004)) netted = netted.plus(await netVanCash(v.vendorCompanyId, null).catch(() => new Decimal(0)));
  const late = await prisma.vanLoad.findMany({ where: { status: "ON_ROAD", loadedAt: { lt: new Date(now.getTime() - s.maxRoundHours * 3600_000) } } });
  for (const l of late) await notify("vansales.late", [{ companyId: l.vendorCompanyId, link: `/vendor/van/${l.id}` }], { number: l.number, hours: s.maxRoundHours }, { ref: { type: "VanLoad", id: l.id } }).catch(() => null);
  return { netted: netted.toFixed(2), late: late.length };
}
