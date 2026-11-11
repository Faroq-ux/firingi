/**
 * Purchasing (Phase 24): the supplier's own list of outside suppliers, purchase orders and goods
 * receipts. A purchase order is either
 *   • to an outside supplier — sent as a PDF by e-mail; or
 *   • on FIRINGI — a wholesaler buying from a distributor: sending it places a normal FIRINGI order
 *     (same prices, risk checks, invoices; the wholesaler only ever sees its own buying price).
 * Goods are received into batches (lot, best-before, cost) at the receiving warehouse, partly or
 * fully; each receipt moves the weighted average cost.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";
import { nextNumber, placeOrder } from "@/server/services/orders";
import { sendMail } from "@/server/services/mailer";
import { receive } from "./ledger";
import { ownOffer, ownWarehouse, requireInventory } from "./service";

const D = Prisma.Decimal;
const BUY = "vendor.purchasing.manage" as const;
const SEE = ["vendor.purchasing.manage", "vendor.inventory.view", "vendor.inventory.manage"] as const;

// ───────────────────────────── outside suppliers ─────────────────────────────

export type SupplierInput = { name: string; vatNumber?: string | null; email?: string | null; phone?: string | null; address?: string | null; leadTimeDays?: number | null; notes?: string | null };
const clean = (s?: string | null) => s?.trim() || null;

export async function listSuppliers(ctx: Ctx, opts: { all?: boolean } = {}) {
  requireInventory(ctx, [...SEE]);
  return prisma.purchaseSupplier.findMany({
    where: { ownerCompanyId: ctx.company.id, ...(opts.all ? {} : { isActive: true }) },
    include: { _count: { select: { orders: true } } }, orderBy: { name: "asc" },
  });
}

export async function saveSupplier(ctx: Ctx, input: SupplierInput & { id?: string | null; isActive?: boolean }) {
  requireInventory(ctx, BUY);
  const name = input.name?.trim();
  if (!name) throw new ValidationError("Enter the supplier's name.");
  const email = clean(input.email);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ValidationError("That e-mail address doesn't look right.");
  const lead = input.leadTimeDays ?? 2;
  if (!Number.isInteger(lead) || lead < 0 || lead > 365) throw new ValidationError("Lead time must be 0–365 days.");
  const data = { name, vatNumber: clean(input.vatNumber), email, phone: clean(input.phone), address: clean(input.address), leadTimeDays: lead, notes: clean(input.notes), isActive: input.isActive ?? true };
  const dupe = await prisma.purchaseSupplier.findFirst({ where: { ownerCompanyId: ctx.company.id, name, ...(input.id ? { id: { not: input.id } } : {}) } });
  if (dupe) throw new ValidationError("You already have a supplier with that name.");
  if (input.id) {
    const cur = await prisma.purchaseSupplier.findFirst({ where: { id: input.id, ownerCompanyId: ctx.company.id } });
    if (!cur) throw new NotFoundError("Supplier");
    return prisma.purchaseSupplier.update({ where: { id: cur.id }, data });
  }
  return prisma.purchaseSupplier.create({ data: { ...data, ownerCompanyId: ctx.company.id } });
}

// ───────────────────────────── purchase orders ─────────────────────────────

export type PoLineInput = { offerId: string; qty: number; unitCost?: number | null; sourceOfferId?: string | null };
export type PoInput = { supplierId?: string | null; sellerCompanyId?: string | null; addressId: string; expectedOn?: Date | null; notes?: string | null; lines: PoLineInput[] };

/** Distributors on FIRINGI a wholesaler can buy from, with their offers (for "buy on FIRINGI"). */
export async function firingiSources(ctx: Ctx) {
  requireInventory(ctx, BUY);
  if (ctx.company.type !== "WHOLESALER") return [];
  return prisma.company.findMany({
    where: { type: "DISTRIBUTOR", status: "APPROVED", countryId: ctx.company.countryId },
    select: {
      id: true, legalName: true, tradeName: true,
      vendorOffers: { where: { status: "ACTIVE" }, select: { id: true, vendorSku: true, packaging: { select: { name: true, variant: { select: { product: { select: { name: true } } } } } } }, take: 500 },
    },
    orderBy: { legalName: "asc" },
  });
}

async function checkLines(ctx: Ctx, input: PoInput) {
  if (!input.lines?.length) throw new ValidationError("Add at least one product.");
  if (input.lines.length > 200) throw new ValidationError("At most 200 lines per purchase order.");
  const seen = new Set<string>();
  const out: { offerId: string; sourceOfferId: string | null; description: string; qty: number; unitCost: Prisma.Decimal }[] = [];
  for (const l of input.lines) {
    if (!Number.isInteger(l.qty) || l.qty < 1 || l.qty > 1_000_000) throw new ValidationError("Quantities must be whole numbers from 1.");
    const key = `${l.offerId}|${l.sourceOfferId ?? ""}`;
    if (seen.has(key)) throw new ValidationError("A product is on the order twice — combine the lines.");
    seen.add(key);
    const o = await ownOffer(ctx, l.offerId);
    const own = await prisma.vendorOffer.findUniqueOrThrow({ where: { id: o.id }, select: { vendorSku: true, packaging: { select: { name: true, variant: { select: { product: { select: { name: true } } } } } } } });
    const nm = (j: Prisma.JsonValue) => (j && typeof j === "object" && !Array.isArray(j) ? String((j as Record<string, unknown>).pt ?? (j as Record<string, unknown>).en ?? "") : String(j ?? ""));
    let sourceOfferId: string | null = null;
    if (input.sellerCompanyId) {
      if (!l.sourceOfferId) throw new ValidationError("Choose the distributor's product for every line.");
      const src = await prisma.vendorOffer.findFirst({ where: { id: l.sourceOfferId, vendorCompanyId: input.sellerCompanyId, status: "ACTIVE" } });
      if (!src) throw new ValidationError("One of the distributor's products is no longer available.");
      sourceOfferId = src.id;
    }
    const cost = l.unitCost ?? null;
    if (!input.sellerCompanyId && (cost === null || !(cost >= 0) || !Number.isFinite(cost))) throw new ValidationError("Enter the agreed net unit cost for every line.");
    out.push({ offerId: o.id, sourceOfferId, description: `${nm(own.packaging.variant.product.name)} · ${nm(own.packaging.name)}${own.vendorSku ? ` · ${own.vendorSku}` : ""}`, qty: l.qty, unitCost: new D(cost ?? 0).toDecimalPlaces(4) });
  }
  return out;
}

async function checkSource(ctx: Ctx, input: PoInput) {
  if (!!input.supplierId === !!input.sellerCompanyId) throw new ValidationError("Choose who you buy from: one of your suppliers or a distributor on FIRINGI.");
  if (input.supplierId) {
    const s = await prisma.purchaseSupplier.findFirst({ where: { id: input.supplierId, ownerCompanyId: ctx.company.id, isActive: true } });
    if (!s) throw new ValidationError("Choose one of your suppliers.");
  } else {
    if (ctx.company.type !== "WHOLESALER") throw new ValidationError("Only wholesalers buy from distributors on FIRINGI.");
    const d = await prisma.company.findFirst({ where: { id: input.sellerCompanyId!, type: "DISTRIBUTOR", status: "APPROVED" } });
    if (!d) throw new ValidationError("Choose a distributor on FIRINGI.");
  }
  await ownWarehouse(ctx, input.addressId);
}

export async function createPurchaseOrder(ctx: Ctx, input: PoInput) {
  requireInventory(ctx, BUY);
  await checkSource(ctx, input);
  const lines = await checkLines(ctx, input);
  return prisma.$transaction(async (tx) => {
    const number = await nextNumber(tx, "purchase-order", "PO");
    const po = await tx.purchaseOrder.create({
      data: {
        ownerCompanyId: ctx.company.id, number, supplierId: input.supplierId ?? null, sellerCompanyId: input.sellerCompanyId ?? null,
        addressId: input.addressId, expectedOn: input.expectedOn ?? null, notes: clean(input.notes), createdById: ctx.user.id,
        lines: { create: lines },
      },
    });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "purchase_order.created", entityType: "PurchaseOrder", entityId: po.id, after: { number, lines: lines.length } }, tx);
    return po;
  });
}

async function ownPo(ctx: Ctx, id: string) {
  const po = await prisma.purchaseOrder.findFirst({ where: { id, ownerCompanyId: ctx.company.id } });
  if (!po) throw new NotFoundError("Purchase order");
  return po;
}

export async function updatePurchaseOrder(ctx: Ctx, id: string, input: PoInput) {
  requireInventory(ctx, BUY);
  const po = await ownPo(ctx, id);
  if (po.status !== "DRAFT") throw new ValidationError("Only a draft can be changed.");
  await checkSource(ctx, input);
  const lines = await checkLines(ctx, input);
  await prisma.$transaction(async (tx) => {
    await tx.purchaseOrderLine.deleteMany({ where: { poId: po.id } });
    await tx.purchaseOrder.update({
      where: { id: po.id },
      data: { supplierId: input.supplierId ?? null, sellerCompanyId: input.sellerCompanyId ?? null, addressId: input.addressId, expectedOn: input.expectedOn ?? null, notes: clean(input.notes), lines: { create: lines } },
    });
  });
}

export async function listPurchaseOrders(ctx: Ctx, opts: { status?: string } = {}) {
  requireInventory(ctx, [...SEE]);
  await syncFiringiOrders(ctx);
  const rows = await prisma.purchaseOrder.findMany({
    where: { ownerCompanyId: ctx.company.id, ...(opts.status === "OPEN" ? { status: { in: ["DRAFT", "SENT", "PARTIALLY_RECEIVED"] } } : opts.status ? { status: opts.status as never } : {}) },
    include: { supplier: { select: { name: true } }, seller: { select: { legalName: true, tradeName: true } }, address: { select: { label: true } }, lines: { select: { qty: true, receivedQty: true, unitCost: true } }, viaOrder: { select: { id: true, number: true, status: true } } },
    orderBy: { createdAt: "desc" }, take: 500,
  });
  return rows.map((p) => ({
    id: p.id, number: p.number, status: p.status, createdAt: p.createdAt, expectedOn: p.expectedOn, sentAt: p.sentAt, warehouse: p.address.label,
    from: p.supplier?.name ?? p.seller?.tradeName ?? p.seller?.legalName ?? "—", viaFiringi: !!p.sellerCompanyId, viaOrder: p.viaOrder,
    qty: p.lines.reduce((a, l) => a + l.qty, 0), received: p.lines.reduce((a, l) => a + l.receivedQty, 0),
    total: p.lines.reduce((a, l) => a.add(l.unitCost.mul(l.qty)), new D(0)).toFixed(2),
  }));
}

export async function getPurchaseOrder(ctx: Ctx, id: string) {
  requireInventory(ctx, [...SEE]);
  await syncFiringiOrders(ctx, id);
  const po = await prisma.purchaseOrder.findFirst({
    where: { id, ownerCompanyId: ctx.company.id },
    include: {
      supplier: true, seller: { select: { id: true, legalName: true, tradeName: true } }, address: { select: { id: true, label: true, line1: true, postalCode: true, cityName: true } },
      viaOrder: { select: { id: true, number: true, status: true, lines: { select: { offerId: true, qtyOrdered: true, qtyConfirmed: true, qtyDelivered: true, unitSalePriceNet: true } } } },
      lines: { include: { offer: { select: { vendorSku: true } } }, orderBy: { description: "asc" } },
      receipts: { include: { lines: true }, orderBy: { at: "asc" } },
    },
  });
  if (!po) throw new NotFoundError("Purchase order");
  const users = await prisma.user.findMany({ where: { id: { in: [po.createdById, ...po.receipts.map((r) => r.byUserId)] } }, select: { id: true, name: true } });
  const deliveredOk = !po.viaOrder || po.viaOrder.status === "DELIVERED";
  return {
    ...po,
    total: po.lines.reduce((a, l) => a.add(l.unitCost.mul(l.qty)), new D(0)).toFixed(2),
    createdBy: users.find((u) => u.id === po.createdById)?.name ?? "—",
    receipts: po.receipts.map((r) => ({ ...r, by: users.find((u) => u.id === r.byUserId)?.name ?? "—" })),
    /** what to prefill when receiving (FIRINGI orders: what was delivered) */
    toReceive: po.lines.map((l) => {
      const ol = po.viaOrder?.lines.find((x) => x.offerId === l.sourceOfferId);
      const expected = ol ? (ol.qtyDelivered ?? ol.qtyConfirmed ?? ol.qtyOrdered) : l.qty;
      return { lineId: l.id, open: Math.max(0, Math.min(l.qty, expected) - l.receivedQty) };
    }),
    canEdit: po.status === "DRAFT" && can(ctx, BUY),
    canSend: po.status === "DRAFT" && can(ctx, BUY),
    canReceive: (po.status === "SENT" || po.status === "PARTIALLY_RECEIVED") && deliveredOk && can(ctx, [BUY, "vendor.inventory.manage"]),
    waitingDelivery: !!po.viaOrder && po.viaOrder.status !== "DELIVERED" && po.viaOrder.status !== "CANCELLED",
    canCancel: (po.status === "DRAFT" || (po.status === "SENT" && !po.viaOrderId)) && can(ctx, BUY),
  };
}

/**
 * Send: outside supplier → PDF by e-mail (when it has an address) and status SENT;
 * on FIRINGI → places the order now (to `deliveryAddressId`), then SENT with the real buying prices.
 */
export async function sendPurchaseOrder(ctx: Ctx, id: string, opts: { deliveryAddressId?: string | null; email?: boolean } = {}) {
  requireInventory(ctx, BUY);
  const po = await ownPo(ctx, id);
  if (po.status !== "DRAFT") throw new ValidationError("This purchase order was already sent.");
  const lines = await prisma.purchaseOrderLine.findMany({ where: { poId: po.id } });
  if (!lines.length) throw new ValidationError("Add at least one product.");
  if (po.sellerCompanyId) {
    if (!can(ctx, "buyer.orders.place")) throw new ForbiddenError();
    const addressId = opts.deliveryAddressId
      ?? (await prisma.address.findFirst({ where: { companyId: ctx.company.id, kind: "DELIVERY", isActive: true }, orderBy: { isDefault: "desc" } }))?.id;
    if (!addressId) throw new ValidationError("Add a delivery address to your company first.");
    const placed = await placeOrder(ctx, { deliveryAddressId: addressId, notes: `${po.number}${po.notes ? ` — ${po.notes}` : ""}`, items: lines.map((l) => ({ offerId: l.sourceOfferId!, qty: l.qty })) });
    if (placed.orders.length !== 1) throw new AppError("PO_SPLIT", "The order was split unexpectedly — check your orders.", 409);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: placed.id }, select: { id: true, lines: { select: { offerId: true, unitSalePriceNet: true } } } });
    await prisma.$transaction(async (tx) => {
      for (const l of lines) {
        const ol = order.lines.find((x) => x.offerId === l.sourceOfferId);
        if (ol) await tx.purchaseOrderLine.update({ where: { id: l.id }, data: { unitCost: ol.unitSalePriceNet } });
      }
      await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: "SENT", sentAt: new Date(), viaOrderId: order.id } });
      await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "purchase_order.sent", entityType: "PurchaseOrder", entityId: po.id, after: { via: "FIRINGI", order: placed.number } }, tx);
    });
    return { order: { id: placed.id, number: placed.number }, emailed: false };
  }
  const supplier = await prisma.purchaseSupplier.findUniqueOrThrow({ where: { id: po.supplierId! } });
  let emailed = false;
  if (opts.email !== false && supplier.email) {
    const pdf = await purchaseOrderPdf(ctx, po.id);
    await sendMail({
      to: supplier.email,
      subject: `Encomenda / Purchase order ${po.number} — ${ctx.company.tradeName ?? ctx.company.legalName}`,
      text: `Bom dia,\n\nSegue em anexo a nossa encomenda ${po.number}.\nPlease find attached our purchase order ${po.number}.\n\n${ctx.company.tradeName ?? ctx.company.legalName}`,
      attachments: [{ filename: `${po.number}.pdf`, content: pdf }],
    });
    emailed = true;
  }
  await prisma.$transaction(async (tx) => {
    await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: "SENT", sentAt: new Date() } });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "purchase_order.sent", entityType: "PurchaseOrder", entityId: po.id, after: { via: "SUPPLIER", emailed } }, tx);
  });
  return { order: null, emailed };
}

export async function cancelPurchaseOrder(ctx: Ctx, id: string, reason?: string | null) {
  requireInventory(ctx, BUY);
  const po = await ownPo(ctx, id);
  if (po.viaOrderId) throw new ValidationError("This purchase order is a FIRINGI order — cancel that order instead.");
  if (po.status !== "DRAFT" && po.status !== "SENT") throw new ValidationError("Goods were already received for this purchase order.");
  await prisma.$transaction(async (tx) => {
    await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "purchase_order.cancelled", entityType: "PurchaseOrder", entityId: po.id, after: { reason: clean(reason) } }, tx);
  });
}

export type ReceiptLineInput = { lineId: string; qty: number; lotCode?: string | null; expiresOn?: Date | null; unitCost?: number | null };

/** Receive goods (some or all). Each line → a batch at the PO's warehouse, at its cost. */
export async function receivePurchaseOrder(ctx: Ctx, id: string, input: { lines: ReceiptLineInput[]; note?: string | null }) {
  requireInventory(ctx, [BUY, "vendor.inventory.manage"]);
  const po = await getPurchaseOrder(ctx, id);
  if (!po.canReceive) throw new ValidationError(po.waitingDelivery ? "The FIRINGI order isn't delivered yet." : "This purchase order can't receive goods.");
  const todo = input.lines.filter((l) => l.qty > 0);
  if (!todo.length) throw new ValidationError("Enter the quantity received for at least one line.");
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  return prisma.$transaction(async (tx) => {
    const receipt = await tx.goodsReceipt.create({ data: { poId: po.id, byUserId: ctx.user.id, note: clean(input.note) } });
    for (const r of todo) {
      const line = await tx.purchaseOrderLine.findFirst({ where: { id: r.lineId, poId: po.id } });
      if (!line) throw new ValidationError("Unknown line.");
      if (!Number.isInteger(r.qty) || r.qty < 1) throw new ValidationError("Quantities must be whole numbers.");
      if (line.receivedQty + r.qty > line.qty) throw new ValidationError(`${line.description}: only ${line.qty - line.receivedQty} still to receive.`);
      if (r.expiresOn && r.expiresOn < today) throw new ValidationError(`${line.description}: that best-before date has already passed.`);
      const cost = po.viaOrderId ? line.unitCost : r.unitCost !== null && r.unitCost !== undefined ? new D(r.unitCost) : line.unitCost;
      if (cost.isNegative()) throw new ValidationError("Cost can't be negative.");
      const b = await receive(tx, { offerId: line.offerId, addressId: po.addressId, qty: r.qty, unitCost: cost, lotCode: r.lotCode, expiresOn: r.expiresOn ?? null, source: "RECEIPT", refType: "PO", refId: po.id, byUserId: ctx.user.id, note: po.number });
      await tx.goodsReceiptLine.create({ data: { receiptId: receipt.id, poLineId: line.id, qty: r.qty, lotCode: clean(r.lotCode), expiresOn: r.expiresOn ?? null, unitCost: cost, batchId: b.batchId } });
      await tx.purchaseOrderLine.update({ where: { id: line.id }, data: { receivedQty: { increment: r.qty } } });
    }
    const after = await tx.purchaseOrderLine.findMany({ where: { poId: po.id } });
    const done = after.every((l) => l.receivedQty >= l.qty);
    await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: done ? "RECEIVED" : "PARTIALLY_RECEIVED", receivedAt: done ? new Date() : null } });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "purchase_order.received", entityType: "PurchaseOrder", entityId: po.id, after: { receipt: receipt.id, lines: todo.length, complete: done } }, tx);
    return { receiptId: receipt.id, complete: done };
  });
}

/** Close purchase orders whose FIRINGI order was cancelled before anything was received. */
async function syncFiringiOrders(ctx: Ctx, id?: string) {
  const stale = await prisma.purchaseOrder.findMany({
    where: { ownerCompanyId: ctx.company.id, ...(id ? { id } : {}), status: "SENT", viaOrder: { status: { in: ["CANCELLED", "RETURNED"] } } },
    select: { id: true },
  });
  for (const p of stale) await prisma.purchaseOrder.update({ where: { id: p.id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
}

/** Draft purchase orders from reorder suggestions: one per supplier, lines at the last cost. */
export async function draftFromSuggestions(ctx: Ctx, picks: { offerId: string; addressId: string; qty: number; supplierId?: string | null; sellerCompanyId?: string | null; sourceOfferId?: string | null; unitCost?: number | null }[]) {
  requireInventory(ctx, BUY);
  const groups = new Map<string, typeof picks>();
  for (const p of picks) {
    if (!p.supplierId && !p.sellerCompanyId) throw new ValidationError("Choose a supplier for every product.");
    const k = `${p.supplierId ?? ""}|${p.sellerCompanyId ?? ""}|${p.addressId}`;
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  const made: { id: string; number: string }[] = [];
  for (const g of groups.values()) {
    const po = await createPurchaseOrder(ctx, {
      supplierId: g[0].supplierId ?? null, sellerCompanyId: g[0].sellerCompanyId ?? null, addressId: g[0].addressId, notes: null,
      lines: g.map((p) => ({ offerId: p.offerId, qty: p.qty, unitCost: p.unitCost ?? (p.sellerCompanyId ? null : 0), sourceOfferId: p.sourceOfferId ?? null })),
    });
    made.push({ id: po.id, number: po.number });
  }
  return made;
}

/** The purchase order as a PDF (Portuguese, English second). */
export async function purchaseOrderPdf(ctx: Ctx, id: string) {
  requireInventory(ctx, [...SEE]);
  const po = await getPurchaseOrder(ctx, id);
  const me = await prisma.company.findUniqueOrThrow({ where: { id: ctx.company.id }, select: { legalName: true, tradeName: true, vatNumber: true, email: true, phone: true } });
  const { renderPurchaseOrderPdf } = await import("@/server/pdf/documents");
  return renderPurchaseOrderPdf({
    number: po.number, date: po.sentAt ?? po.createdAt, expectedOn: po.expectedOn,
    buyer: { name: me.tradeName ?? me.legalName, vatNumber: me.vatNumber, email: me.email ?? undefined },
    supplier: { name: po.supplier?.name ?? po.seller?.legalName ?? "—", vatNumber: po.supplier?.vatNumber ?? null, address: po.supplier?.address ?? null, email: po.supplier?.email ?? undefined },
    deliverTo: [po.address.label, po.address.line1, [po.address.postalCode, po.address.cityName].filter(Boolean).join(" ")].filter(Boolean).join(", "),
    notes: po.notes, lines: po.lines.map((l) => ({ description: l.description, sku: l.offer.vendorSku, qty: l.qty, unitCost: l.unitCost.toString(), total: l.unitCost.mul(l.qty).toFixed(2) })),
    total: po.total,
  });
}
