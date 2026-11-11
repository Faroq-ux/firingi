/**
 * Lot traceability & product recalls (Phase 25).
 *
 * Downstream, a lot is followed through the ledger: the orders it was shipped on (SHIPMENT
 * movements carry the batch) and — for goods bought on FIRINGI — into the buyer's own stock
 * (PurchasedLot.sellerBatchId → ownBatchId) and on to that buyer's customers, and so on. Batches
 * split off a lot (moved in part to another shelf, transferred, returned) belong to it.
 * Upstream, a lot shows where it came from: the purchase order and outside supplier, or the order
 * on FIRINGI and the seller's lot it was shipped from.
 *
 * A recall (by the supplier for its own lot, or by FIRINGI for any lot):
 *   1. every batch of the lot, at every level down the chain, is blocked — its units leave stock
 *      (RECALL movement) and it is never reserved, picked or sold again;
 *   2. open orders holding those batches get their reservation moved to other lots; what can't be
 *      covered becomes a STOCK_SHORT exception for FIRINGI; open pick lists are corrected;
 *   3. every company that received the goods is told (critical notification) and asked to
 *      acknowledge and report what it returned / destroyed.
 * Who sees what: the supplier sees its own direct buyers; buyers further down are seen only by
 * FIRINGI (the supplier sees how many).
 */
import { prisma, type Tx } from "@/server/db";
import type { Ctx } from "@/server/context";
import type { RecallClass } from "@prisma/client";
import { can } from "@/server/rbac/guard";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";
import { nextNumber } from "@/server/services/orders";
import { notify } from "@/server/notify/dispatch";
import { pickLocalized } from "@/i18n/config";
import { batchFamily, blockBatch, releaseBatch, reserveForOrder } from "@/server/inventory/ledger";
import { daysLeft } from "@/server/inventory/service";
import { refreshLinesAfterRecall } from "./picking";

const MAX_LEVELS = 5;
const isAdmin = (ctx: Ctx) => ctx.company.type === "ADMIN";
const cname = (c: { legalName: string; tradeName: string | null }) => c.tradeName ?? c.legalName;

function requireTrace(ctx: Ctx) {
  if (isAdmin(ctx)) {
    if (!can(ctx, ["admin.inventory.view", "admin.inventory.manage", "admin.recalls.manage"])) throw new ForbiddenError();
    return;
  }
  if ((ctx.company.type !== "DISTRIBUTOR" && ctx.company.type !== "WHOLESALER") || ctx.company.status !== "APPROVED") throw new ForbiddenError();
  if (!can(ctx, ["vendor.inventory.view", "vendor.inventory.manage", "vendor.recalls.manage"])) throw new ForbiddenError();
}
function requireRecall(ctx: Ctx) {
  if (isAdmin(ctx) ? !can(ctx, "admin.recalls.manage") : !can(ctx, "vendor.recalls.manage")) throw new ForbiddenError();
  requireTrace(ctx);
}

/** The batches of one lot of a product: by lot number (any warehouse), or one batch without a number. */
async function lotBatches(tx: Tx, i: { offerId: string; lotCode?: string | null; batchId?: string | null }) {
  const lot = i.lotCode?.trim();
  const roots = i.batchId
    ? await tx.stockBatch.findMany({ where: { id: i.batchId, offerId: i.offerId }, select: { id: true } })
    : lot ? await tx.stockBatch.findMany({ where: { offerId: i.offerId, lotCode: { equals: lot, mode: "insensitive" } }, select: { id: true } }) : [];
  if (!roots.length) throw new ValidationError("No stock of this lot was ever recorded for this product.");
  return batchFamily(tx, roots.map((r) => r.id));
}

type Shipment = { orderId: string; number: string; status: string; buyerCompanyId: string; sellerCompanyId: string; qty: number; at: Date };
type Level = { level: number; batchIds: string[]; shipments: Shipment[]; reservedOrders: { orderId: string; batchId: string; offerId: string; qty: number }[] };

/** Follow a lot down the chain (read-only). */
async function walk(tx: Tx, rootIds: string[]) {
  const levels: Level[] = [];
  const seen = new Set<string>();
  let frontier = rootIds;
  for (let level = 0; frontier.length && level < MAX_LEVELS; level++) {
    frontier.forEach((id) => seen.add(id));
    const moves = await tx.stockMovement.findMany({ where: { batchId: { in: frontier }, orderId: { not: null }, type: { in: ["RESERVE", "RELEASE", "SHIPMENT", "RETURN"] } }, select: { orderId: true, batchId: true, offerId: true, type: true, qty: true, at: true } });
    const held = new Map<string, { orderId: string; batchId: string; offerId: string; qty: number }>();
    const shipped = new Map<string, { qty: number; at: Date }>();
    for (const m of moves) {
      if (m.type === "SHIPMENT" || m.type === "RETURN") {
        const s = shipped.get(m.orderId!) ?? { qty: 0, at: m.at };
        s.qty += m.type === "SHIPMENT" ? m.qty : -m.qty;
        if (m.type === "SHIPMENT") s.at = m.at;
        shipped.set(m.orderId!, s);
      }
      if (m.type !== "RETURN") {
        const k = `${m.orderId}|${m.batchId}`;
        const h = held.get(k) ?? { orderId: m.orderId!, batchId: m.batchId!, offerId: m.offerId, qty: 0 };
        h.qty += m.type === "RESERVE" ? m.qty : -m.qty;
        held.set(k, h);
      }
    }
    const orders = await tx.order.findMany({ where: { id: { in: [...shipped.keys()] } }, select: { id: true, number: true, status: true, buyerCompanyId: true, sellerCompanyId: true } });
    const shipments = orders.map((o) => ({ orderId: o.id, number: o.number, status: o.status, buyerCompanyId: o.buyerCompanyId, sellerCompanyId: o.sellerCompanyId, qty: shipped.get(o.id)!.qty, at: shipped.get(o.id)!.at })).filter((s) => s.qty > 0);
    levels.push({ level, batchIds: frontier, shipments, reservedOrders: [...held.values()].filter((h) => h.qty > 0) });
    const lots = await tx.purchasedLot.findMany({ where: { sellerBatchId: { in: frontier }, ownBatchId: { not: null } }, select: { ownBatchId: true } });
    const next = await batchFamily(tx, lots.map((l) => l.ownBatchId!).filter((id) => !seen.has(id)));
    frontier = next.filter((id) => !seen.has(id));
  }
  return levels;
}

/** Where a lot came from. */
async function upstream(tx: Tx, batchIds: string[]) {
  const batches = await tx.stockBatch.findMany({ where: { id: { in: batchIds } }, select: { id: true, source: true, refId: true, receivedAt: true, splitFromId: true, lotCode: true } });
  const out: { kind: "PO" | "FIRINGI" | "OTHER"; source: string; date: Date; reference: string | null; supplier: string | null; supplierLot: string | null }[] = [];
  const poIds = [...new Set(batches.filter((b) => b.refId && b.source === "RECEIPT").map((b) => b.refId!))];
  const pos = poIds.length ? await tx.purchaseOrder.findMany({ where: { id: { in: poIds } }, select: { id: true, number: true, supplier: { select: { name: true } }, seller: { select: { legalName: true, tradeName: true } } } }) : [];
  const viaFiringi = await tx.purchasedLot.findMany({ where: { ownBatchId: { in: batchIds } }, include: { order: { select: { number: true, seller: { select: { legalName: true, tradeName: true } } } } } });
  for (const v of viaFiringi) out.push({ kind: "FIRINGI", source: "ORDER", date: v.stockedAt ?? v.createdAt, reference: v.order.number, supplier: cname(v.order.seller), supplierLot: v.lotCode });
  for (const b of batches) {
    if (b.splitFromId && batchIds.includes(b.splitFromId)) continue; // a piece of a batch listed already
    if (viaFiringi.some((v) => v.ownBatchId === b.id)) continue;
    const po = pos.find((p) => p.id === b.refId);
    if (po) out.push({ kind: "PO", source: b.source, date: b.receivedAt, reference: po.number, supplier: po.supplier?.name ?? (po.seller ? cname(po.seller) : null), supplierLot: b.lotCode });
    else out.push({ kind: "OTHER", source: b.source, date: b.receivedAt, reference: null, supplier: null, supplierLot: b.lotCode });
  }
  return out;
}

/** Lots of a product that can be traced (for the picker). Admin: any supplier's product. */
export async function traceableLots(ctx: Ctx, offerId: string) {
  requireTrace(ctx);
  const offer = await prisma.vendorOffer.findFirst({ where: { id: offerId, ...(isAdmin(ctx) ? {} : { vendorCompanyId: ctx.company.id }) }, select: { id: true } });
  if (!offer) throw new NotFoundError("Product");
  const rows = await prisma.stockBatch.groupBy({ by: ["lotCode", "expiresOn"], where: { offerId, lotCode: { not: null } }, _sum: { onHand: true }, _count: { _all: true }, _min: { receivedAt: true } });
  return rows.map((r) => ({ lotCode: r.lotCode!, expiresOn: r.expiresOn, onHand: r._sum.onHand ?? 0, batches: r._count._all, since: r._min.receivedAt })).sort((a, b) => (b.since?.getTime() ?? 0) - (a.since?.getTime() ?? 0));
}

/** FIRINGI: products of any supplier that have numbered lots (for the trace picker). */
export async function adminTraceOffers(ctx: Ctx, locale: string) {
  requireTrace(ctx);
  if (!isAdmin(ctx)) throw new ForbiddenError();
  const offers = await prisma.vendorOffer.findMany({
    where: { stockBatches: { some: { lotCode: { not: null } } } },
    select: { id: true, vendorSku: true, vendor: { select: { legalName: true, tradeName: true } }, packaging: { select: { name: true, variant: { select: { product: { select: { name: true } } } } } } },
    take: 1000,
  });
  return offers
    .map((o) => ({ id: o.id, label: `${cname(o.vendor)} — ${pickLocalized(o.packaging.variant.product.name, locale)} · ${pickLocalized(o.packaging.name, locale)}${o.vendorSku ? ` · ${o.vendorSku}` : ""}` }))
    .sort((a, b) => a.label.localeCompare(b.label, locale));
}

/** Full trace of one lot: upstream, stock now (per warehouse / shelf), every order downstream by level. */
export async function traceLot(ctx: Ctx, i: { offerId: string; lotCode?: string | null; batchId?: string | null }, locale: string) {
  requireTrace(ctx);
  const offer = await prisma.vendorOffer.findFirst({
    where: { id: i.offerId, ...(isAdmin(ctx) ? {} : { vendorCompanyId: ctx.company.id }) },
    select: { id: true, vendorSku: true, vendorCompanyId: true, vendor: { select: { legalName: true, tradeName: true } }, packaging: { select: { name: true, variant: { select: { product: { select: { name: true } } } } } } },
  });
  if (!offer) throw new NotFoundError("Product");
  const ids = await lotBatches(prisma, i);
  const levels = await walk(prisma, ids);
  const allBatchIds = levels.flatMap((l) => l.batchIds);
  const batches = await prisma.stockBatch.findMany({ where: { id: { in: allBatchIds } }, include: { address: { select: { label: true, companyId: true } }, bin: { select: { code: true } }, offer: { select: { vendorCompanyId: true } } } });
  const companyIds = [...new Set([...levels.flatMap((l) => l.shipments.flatMap((s) => [s.buyerCompanyId, s.sellerCompanyId])), ...batches.map((b) => b.offer.vendorCompanyId)])];
  const companies = new Map((await prisma.company.findMany({ where: { id: { in: companyIds } }, select: { id: true, legalName: true, tradeName: true, type: true } })).map((c) => [c.id, c]));
  const admin = isAdmin(ctx);
  const me = ctx.company.id;
  const recalls = await prisma.recall.findMany({ where: { batches: { some: { batchId: { in: ids } } } }, select: { id: true, number: true, status: true, recallClass: true, createdAt: true } });
  const levelBatches = (l: Level) => batches.filter((b) => l.batchIds.includes(b.id));
  return {
    product: { id: offer.id, sku: offer.vendorSku, name: pickLocalized(offer.packaging.variant.product.name, locale), packaging: pickLocalized(offer.packaging.name, locale), supplier: cname(offer.vendor) },
    lotCode: i.lotCode ?? batches.find((b) => ids.includes(b.id))?.lotCode ?? null,
    expiresOn: batches.find((b) => ids.includes(b.id))?.expiresOn ?? null,
    upstream: await upstream(prisma, ids),
    recalls,
    levels: levels.map((l) => {
      // the supplier sees its own stock and direct buyers; deeper levels only as numbers
      const visible = admin || l.level === 0;
      const lb = levelBatches(l);
      return {
        level: l.level,
        visible,
        stock: visible ? lb.filter((b) => b.onHand > 0 || b.blockedAt).map((b) => ({ id: b.id, company: cname(companies.get(b.offer.vendorCompanyId)!), warehouse: b.address.label, bin: b.bin?.code ?? null, onHand: b.onHand, reserved: b.reserved, blocked: !!b.blockedAt, expiresOn: b.expiresOn, daysLeft: daysLeft(b.expiresOn) })) : [],
        stockUnits: lb.reduce((a, b) => a + b.onHand, 0),
        shipments: visible ? l.shipments.map((s) => ({ orderId: s.orderId, number: s.number, status: s.status, buyer: cname(companies.get(s.buyerCompanyId)!), buyerType: companies.get(s.buyerCompanyId)?.type, seller: cname(companies.get(s.sellerCompanyId)!), qty: s.qty, at: s.at, mine: s.sellerCompanyId === me })) : [],
        buyers: new Set(l.shipments.map((s) => s.buyerCompanyId)).size,
        shippedUnits: l.shipments.reduce((a, s) => a + s.qty, 0),
        openOrders: l.reservedOrders.length,
        reservedUnits: l.reservedOrders.reduce((a, r) => a + r.qty, 0),
      };
    }),
  };
}

// ───────────────────────────── recalls ─────────────────────────────

export const CLASSES: RecallClass[] = ["CLASS_I", "CLASS_II", "CLASS_III"];

export async function startRecall(ctx: Ctx, i: { offerId: string; lotCode?: string | null; batchId?: string | null; recallClass: RecallClass; reason: string; instructions?: string | null }) {
  requireRecall(ctx);
  const offer = await prisma.vendorOffer.findFirst({
    where: { id: i.offerId, ...(isAdmin(ctx) ? {} : { vendorCompanyId: ctx.company.id }) },
    select: { id: true, vendorCompanyId: true, packaging: { select: { name: true, variant: { select: { product: { select: { name: true } } } } } } },
  });
  if (!offer) throw new NotFoundError("Product");
  const reason = i.reason.trim();
  if (reason.length < 5) throw new ValidationError("Please describe the reason (at least 5 characters).");
  if (!CLASSES.includes(i.recallClass)) throw new ValidationError("Choose the recall class.");
  const result = await prisma.$transaction(async (tx) => {
    const ids = await lotBatches(tx, i);
    const roots = await tx.stockBatch.findMany({ where: { id: { in: ids } }, select: { id: true, lotCode: true, expiresOn: true, blockedAt: true } });
    if (roots.every((b) => b.blockedAt)) throw new ValidationError("This lot is already recalled.");
    const recall = await tx.recall.create({
      data: {
        number: await nextNumber(tx, "recall", "RC"), ownerCompanyId: offer.vendorCompanyId, startedByCompanyId: ctx.company.id, offerId: offer.id,
        lotCode: roots.find((b) => b.lotCode)?.lotCode ?? null, expiresOn: roots.find((b) => b.expiresOn)?.expiresOn ?? null,
        recallClass: i.recallClass, reason, instructions: i.instructions?.trim() || null, createdById: ctx.user.id,
      },
    });
    const levels = await walk(tx, ids);
    let blocked = 0, reReserved = 0, notReReserved = 0;
    const recipients = new Map<string, { companyId: string; via: string; qty: number; level: number; orders: { id: string; number: string }[] }>();
    for (const l of levels) {
      // 1. orders holding these batches let go of them …
      const moveBack: { orderId: string; offerId: string; qty: number }[] = [];
      for (const r of l.reservedOrders) {
        const q = await releaseBatch(tx, r.orderId, r.batchId, r.qty);
        if (q > 0) moveBack.push({ orderId: r.orderId, offerId: r.offerId, qty: q });
      }
      // 2. … the batches are blocked …
      for (const id of l.batchIds) {
        blocked += await blockBatch(tx, { batchId: id, recallId: recall.id, byUserId: ctx.user.id, note: recall.number });
        await tx.recallBatch.create({ data: { recallId: recall.id, batchId: id, level: l.level } });
      }
      // 3. … and get other lots instead, when there are any
      const merged = new Map<string, { orderId: string; offerId: string; qty: number }>();
      for (const m of moveBack) {
        const k = `${m.orderId}|${m.offerId}`;
        const cur = merged.get(k) ?? { ...m, qty: 0 };
        cur.qty += m.qty;
        merged.set(k, cur);
      }
      for (const m of merged.values()) {
        let res = await reserveForOrder(tx, m.orderId, m.offerId, m.qty);
        if (!res.ok && res.available > 0) res = await reserveForOrder(tx, m.orderId, m.offerId, res.available);
        const got = res.ok ? res.picks.reduce((a, p) => a + p.qty, 0) : 0;
        reReserved += got;
        if (m.qty - got > 0) {
          notReReserved += m.qty - got;
          await tx.orderException.create({ data: { orderId: m.orderId, type: "STOCK_SHORT", description: `Recall ${recall.number}: ${m.qty - got} unit(s) of the recalled lot could not be replaced from other stock.` } });
        }
      }
      await refreshLinesAfterRecall(tx, l.batchIds);
      // 4. everyone who received the goods
      for (const s of l.shipments) {
        const cur = recipients.get(s.buyerCompanyId) ?? { companyId: s.buyerCompanyId, via: s.sellerCompanyId, qty: 0, level: l.level + 1, orders: [] };
        cur.qty += s.qty;
        cur.level = Math.min(cur.level, l.level + 1);
        cur.orders.push({ id: s.orderId, number: s.number });
        recipients.set(s.buyerCompanyId, cur);
      }
    }
    for (const r of recipients.values())
      await tx.recallRecipient.create({ data: { recallId: recall.id, companyId: r.companyId, viaCompanyId: r.via, qty: r.qty, level: r.level, orders: r.orders } });
    // goods bought on FIRINGI that are recalled: no more best-before alerts for them
    await tx.purchasedLot.updateMany({ where: { sellerBatchId: { in: levels.flatMap((l) => l.batchIds) }, secondAlertAt: null }, data: { firstAlertAt: new Date(), secondAlertAt: new Date() } });
    await tx.recall.update({ where: { id: recall.id }, data: { blockedUnits: blocked, reReserved, notReReserved } });
    return { id: recall.id, number: recall.number, lotCode: recall.lotCode, blocked, reReserved, notReReserved, recipients: recipients.size };
  }, { timeout: 120_000 });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "recall.started", entityType: "Recall", entityId: result.id, after: { ...result, reason, recallClass: i.recallClass } });
  await notifyRecall(result.id);
  return result;
}

async function notifyRecall(recallId: string) {
  const r = await prisma.recall.findUniqueOrThrow({ where: { id: recallId }, include: { recipients: { include: { company: { select: { defaultLanguageCode: true } } } } } });
  const offer = await prisma.vendorOffer.findUniqueOrThrow({ where: { id: r.offerId }, select: { packaging: { select: { name: true, variant: { select: { product: { select: { name: true } } } } } } } });
  const product = (lang: string | null | undefined) => `${pickLocalized(offer.packaging.variant.product.name, lang ?? "en")} (${pickLocalized(offer.packaging.name, lang ?? "en")})`;
  const lot = r.lotCode ?? "—";
  for (const p of r.recipients)
    await notify("recall.notice", [{ companyId: p.companyId, link: `/buy/orders/recalls/${p.id}` }], { number: r.number, product: product(p.company.defaultLanguageCode), lot, reason: r.reason }, { ref: { type: "Recall", id: r.id } }).catch(() => null);
  const admin = await prisma.company.findFirst({ where: { type: "ADMIN" }, orderBy: { createdAt: "asc" }, select: { id: true } });
  const owner = await prisma.company.findUniqueOrThrow({ where: { id: r.ownerCompanyId }, select: { defaultLanguageCode: true } });
  const vars = { number: r.number, product: product(owner.defaultLanguageCode), lot, units: String(r.blockedUnits), buyers: String(r.recipients.length) };
  if (r.startedByCompanyId !== r.ownerCompanyId) await notify("recall.started", [{ companyId: r.ownerCompanyId, link: `/vendor/warehouse/recalls/${r.id}` }], vars, { ref: { type: "Recall", id: r.id } }).catch(() => null);
  if (admin && r.startedByCompanyId !== admin.id) await notify("recall.started", [{ companyId: admin.id, link: `/admin/inventory/recalls/${r.id}` }], { ...vars, product: product("en") }, { ref: { type: "Recall", id: r.id } }).catch(() => null);
}

export async function listRecalls(ctx: Ctx) {
  requireTrace(ctx);
  const rows = await prisma.recall.findMany({
    where: isAdmin(ctx) ? {} : { ownerCompanyId: ctx.company.id },
    include: { owner: { select: { legalName: true, tradeName: true } }, recipients: { select: { status: true } } },
    orderBy: { createdAt: "desc" }, take: 300,
  });
  const offers = await prisma.vendorOffer.findMany({ where: { id: { in: rows.map((r) => r.offerId) } }, select: { id: true, vendorSku: true, packaging: { select: { name: true, variant: { select: { product: { select: { name: true } } } } } } } });
  return rows.map((r) => {
    const o = offers.find((x) => x.id === r.offerId);
    return {
      id: r.id, number: r.number, status: r.status, recallClass: r.recallClass, createdAt: r.createdAt, closedAt: r.closedAt, supplier: cname(r.owner),
      product: o ? o.packaging.variant.product.name : null, packaging: o ? o.packaging.name : null, sku: o?.vendorSku ?? null, lotCode: r.lotCode, expiresOn: r.expiresOn,
      blockedUnits: r.blockedUnits, notReReserved: r.notReReserved, recipients: r.recipients.length, done: r.recipients.filter((x) => x.status === "DONE").length,
      acknowledged: r.recipients.filter((x) => x.status !== "NOTIFIED").length, startedByFiringi: r.startedByCompanyId !== r.ownerCompanyId,
    };
  });
}

export async function getRecall(ctx: Ctx, id: string, locale: string) {
  requireTrace(ctx);
  const r = await prisma.recall.findFirst({
    where: { id, ...(isAdmin(ctx) ? {} : { ownerCompanyId: ctx.company.id }) },
    include: { owner: { select: { legalName: true, tradeName: true } }, batches: true, recipients: { include: { company: { select: { id: true, legalName: true, tradeName: true, type: true } } }, orderBy: [{ level: "asc" }, { notifiedAt: "asc" }] } },
  });
  if (!r) throw new NotFoundError("Recall");
  const offer = await prisma.vendorOffer.findUniqueOrThrow({ where: { id: r.offerId }, select: { vendorSku: true, packaging: { select: { name: true, variant: { select: { product: { select: { name: true } } } } } } } });
  const admin = isAdmin(ctx);
  const batches = await prisma.stockBatch.findMany({ where: { id: { in: r.batches.map((b) => b.batchId) } }, include: { address: { select: { label: true } }, offer: { select: { vendorCompanyId: true } } } });
  const blockedHere = await prisma.stockMovement.groupBy({ by: ["batchId"], where: { batchId: { in: batches.map((b) => b.id) }, type: "RECALL" }, _sum: { qty: true } });
  const vis = (level: number) => admin || level <= 1;
  return {
    id: r.id, number: r.number, status: r.status, recallClass: r.recallClass, reason: r.reason, instructions: r.instructions, createdAt: r.createdAt, closedAt: r.closedAt, closeNote: r.closeNote,
    supplier: cname(r.owner), startedByFiringi: r.startedByCompanyId !== r.ownerCompanyId, offerId: r.offerId,
    product: pickLocalized(offer.packaging.variant.product.name, locale), packaging: pickLocalized(offer.packaging.name, locale), sku: offer.vendorSku, lotCode: r.lotCode, expiresOn: r.expiresOn,
    blockedUnits: r.blockedUnits, reReserved: r.reReserved, notReReserved: r.notReReserved,
    stock: batches.filter((b) => admin || b.offer.vendorCompanyId === ctx.company.id).map((b) => ({ id: b.id, level: r.batches.find((x) => x.batchId === b.id)?.level ?? 0, warehouse: b.address.label, lotCode: b.lotCode, blockedUnits: blockedHere.find((x) => x.batchId === b.id)?._sum.qty ?? 0 })),
    recipients: r.recipients.filter((p) => vis(p.level)).map((p) => ({
      id: p.id, company: cname(p.company), companyType: p.company.type, level: p.level, qty: p.qty, orders: p.orders as { id: string; number: string }[], status: p.status,
      notifiedAt: p.notifiedAt, acknowledgedAt: p.acknowledgedAt, returnedQty: p.returnedQty, destroyedQty: p.destroyedQty, noneLeft: p.noneLeft, note: p.note, doneAt: p.doneAt,
    })),
    hiddenRecipients: r.recipients.filter((p) => !vis(p.level)).length,
    progress: { total: r.recipients.length, acknowledged: r.recipients.filter((p) => p.status !== "NOTIFIED").length, done: r.recipients.filter((p) => p.status === "DONE").length, returned: r.recipients.reduce((a, p) => a + p.returnedQty, 0), destroyed: r.recipients.reduce((a, p) => a + p.destroyedQty, 0), units: r.recipients.reduce((a, p) => a + p.qty, 0) },
  };
}

export async function closeRecall(ctx: Ctx, id: string, note?: string | null) {
  requireRecall(ctx);
  const r = await prisma.recall.findFirst({ where: { id, ...(isAdmin(ctx) ? {} : { ownerCompanyId: ctx.company.id }) } });
  if (!r) throw new NotFoundError("Recall");
  if (r.status === "CLOSED") throw new ValidationError("Already closed.");
  await prisma.recall.update({ where: { id }, data: { status: "CLOSED", closedAt: new Date(), closedById: ctx.user.id, closeNote: note?.trim() || null } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "recall.closed", entityType: "Recall", entityId: id, after: { note } });
}

// ───────────────────────────── buyers ─────────────────────────────

function requireNoticeReader(ctx: Ctx) {
  if (ctx.company.type === "ADMIN") throw new ForbiddenError();
  if (!can(ctx, ["buyer.orders.view", "buyer.orders.place", "vendor.inventory.view", "vendor.inventory.manage"])) throw new ForbiddenError();
}

/** Recall notices a buyer received (customers and wholesalers). The supplier stays FIRINGI's business. */
export async function myRecallNotices(ctx: Ctx, locale: string) {
  requireNoticeReader(ctx);
  const rows = await prisma.recallRecipient.findMany({ where: { companyId: ctx.company.id }, include: { recall: true }, orderBy: { notifiedAt: "desc" } });
  const offers = await prisma.vendorOffer.findMany({ where: { id: { in: rows.map((r) => r.recall.offerId) } }, select: { id: true, packaging: { select: { name: true, variant: { select: { product: { select: { name: true } } } } } } } });
  return rows.map((p) => {
    const o = offers.find((x) => x.id === p.recall.offerId);
    return {
      id: p.id, number: p.recall.number, recallClass: p.recall.recallClass, recallStatus: p.recall.status, reason: p.recall.reason, instructions: p.recall.instructions,
      product: o ? pickLocalized(o.packaging.variant.product.name, locale) : "", packaging: o ? pickLocalized(o.packaging.name, locale) : "", lotCode: p.recall.lotCode, expiresOn: p.recall.expiresOn,
      qty: p.qty, orders: p.orders as { id: string; number: string }[], status: p.status, notifiedAt: p.notifiedAt, acknowledgedAt: p.acknowledgedAt,
      returnedQty: p.returnedQty, destroyedQty: p.destroyedQty, noneLeft: p.noneLeft, note: p.note, doneAt: p.doneAt,
    };
  });
}

export async function myRecallNotice(ctx: Ctx, id: string, locale: string) {
  const n = (await myRecallNotices(ctx, locale)).find((x) => x.id === id);
  if (!n) throw new NotFoundError("Recall");
  return n;
}

export async function openRecallCount(ctx: Ctx) {
  if (ctx.company.type === "ADMIN") return 0;
  return prisma.recallRecipient.count({ where: { companyId: ctx.company.id, status: { not: "DONE" }, recall: { status: "OPEN" } } });
}

export async function acknowledgeRecall(ctx: Ctx, recipientId: string) {
  requireNoticeReader(ctx);
  const p = await prisma.recallRecipient.findFirst({ where: { id: recipientId, companyId: ctx.company.id } });
  if (!p) throw new NotFoundError("Recall");
  if (p.status !== "NOTIFIED") return;
  await prisma.recallRecipient.update({ where: { id: p.id }, data: { status: "ACKNOWLEDGED", acknowledgedAt: new Date(), acknowledgedById: ctx.user.id } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "recall.acknowledged", entityType: "RecallRecipient", entityId: p.id });
}

/** What the buyer did with the recalled goods. Done when everything is accounted for (or none left). */
export async function reportRecallAction(ctx: Ctx, recipientId: string, i: { returnedQty: number; destroyedQty: number; noneLeft: boolean; note?: string | null }) {
  requireNoticeReader(ctx);
  const p = await prisma.recallRecipient.findFirst({ where: { id: recipientId, companyId: ctx.company.id }, include: { recall: { select: { status: true } } } });
  if (!p) throw new NotFoundError("Recall");
  if (p.recall.status === "CLOSED") throw new ValidationError("This recall is closed.");
  for (const q of [i.returnedQty, i.destroyedQty]) if (!Number.isInteger(q) || q < 0) throw new ValidationError("Quantities must be whole numbers ≥ 0.");
  if (i.returnedQty + i.destroyedQty > p.qty) throw new ValidationError(`You received ${p.qty} — returned + destroyed can't be more.`);
  if (!i.noneLeft && i.returnedQty + i.destroyedQty === 0) throw new ValidationError("Tell us what you returned or destroyed, or that none is left.");
  const done = i.noneLeft || i.returnedQty + i.destroyedQty >= p.qty;
  await prisma.recallRecipient.update({
    where: { id: p.id },
    data: { returnedQty: i.returnedQty, destroyedQty: i.destroyedQty, noneLeft: i.noneLeft, note: i.note?.trim() || null, status: done ? "DONE" : "ACKNOWLEDGED", acknowledgedAt: p.acknowledgedAt ?? new Date(), acknowledgedById: p.acknowledgedById ?? ctx.user.id, doneAt: done ? new Date() : null },
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "recall.reported", entityType: "RecallRecipient", entityId: p.id, after: i });
}
