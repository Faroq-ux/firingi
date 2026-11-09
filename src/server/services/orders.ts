/**
 * Orders: checkout, stock reservation, status machine, vendor confirmation,
 * cancellation and exceptions. FIRINGI is merchant of record: the buyer buys from
 * FIRINGI, FIRINGI buys from the vendor — the order freezes both sides' numbers.
 */
import type { DeliveryMode, OrderFlow, OrderStatus, Prisma } from "@prisma/client";
import Decimal from "decimal.js";
import { prisma, type Tx } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { pricedOffers } from "@/server/data/catalogue-buyer";
import { computeLine, computeTotals } from "@/server/orders/calc";
import { canTransition, CLOSED, RESERVED_STATUSES, type Actor } from "@/server/orders/state";
import { decideDelivery } from "@/server/orders/delivery-rule";
import { scopeWhere } from "./admin-access";
import { deliveryRulesFor } from "./cart";
import { writeAudit } from "./audit";
import { notifyCompany } from "./notify";
import { invoiceDeliveredOrder } from "@/server/invoicing/service";

// ── helpers ─────────────────────────────────────────────────────────────────

/** Gap-free yearly sequence (row-locked inside the transaction). */
export async function nextNumber(tx: Tx, name: string, prefix: string) {
  const year = new Date().getFullYear();
  const rows = await tx.$queryRaw<{ n: number }[]>`
    INSERT INTO "Sequence" (name, year, "nextValue") VALUES (${name}, ${year}, 2)
    ON CONFLICT (name, year) DO UPDATE SET "nextValue" = "Sequence"."nextValue" + 1
    RETURNING "nextValue" - 1 AS n`;
  return `${prefix}-${year}-${String(rows[0].n).padStart(6, "0")}`;
}

/** VAT rate for the buyer's delivery region (Madeira, Azores…) falling back to the country rate. */
async function vatRate(tx: Tx, countryId: string, regionId: string | null, taxCategoryId: string) {
  const now = new Date();
  const rows = await tx.taxRate.findMany({
    where: { countryId, taxCategoryId, validFrom: { lte: now }, OR: [{ validTo: null }, { validTo: { gt: now } }], AND: [{ OR: [{ regionId: null }, ...(regionId ? [{ regionId }] : [])] }] },
    orderBy: { validFrom: "desc" },
  });
  return new Decimal((rows.find((r) => r.regionId === regionId && regionId) ?? rows.find((r) => r.regionId === null))?.rate.toString() ?? 0);
}

async function activeCommission(tx: Tx, vendorId: string) {
  return tx.commissionRule.findFirst({ where: { vendorCompanyId: vendorId, validTo: null, categoryId: null, validFrom: { lte: new Date() } }, orderBy: { validFrom: "desc" } });
}

/** Reserve qty for an offer across the vendor's stock locations (most available first). */
async function reserveStock(tx: Tx, orderId: string, offerId: string, qty: number) {
  const levels = await tx.$queryRaw<{ id: string; addressId: string; free: number }[]>`
    SELECT id, "addressId", "onHand" - reserved AS free FROM "StockLevel" WHERE "offerId" = ${offerId} AND "onHand" - reserved > 0
    ORDER BY "onHand" - reserved DESC FOR UPDATE`;
  const available = levels.reduce((a, l) => a + Number(l.free), 0);
  if (available < qty) return { ok: false as const, available };
  let left = qty;
  const used: string[] = [];
  for (const l of levels) {
    if (left === 0) break;
    const take = Math.min(left, Number(l.free));
    await tx.stockLevel.update({ where: { id: l.id }, data: { reserved: { increment: take } } });
    await tx.stockMovement.create({ data: { offerId, addressId: l.addressId, type: "RESERVE", qty: take, orderId } });
    used.push(l.addressId);
    left -= take;
  }
  return { ok: true as const, addressId: used[0] };
}

/** What is still reserved for this order per (offer, location), from the movement ledger. */
async function reservations(tx: Tx, orderId: string) {
  const moves = await tx.stockMovement.findMany({ where: { orderId, type: { in: ["RESERVE", "RELEASE", "SHIPMENT"] } } });
  const map = new Map<string, { offerId: string; addressId: string; qty: number }>();
  for (const m of moves) {
    const k = `${m.offerId}|${m.addressId}`;
    const cur = map.get(k) ?? { offerId: m.offerId, addressId: m.addressId, qty: 0 };
    cur.qty += m.type === "RESERVE" ? m.qty : -m.qty;
    map.set(k, cur);
  }
  return [...map.values()].filter((r) => r.qty > 0);
}

/** Release reserved stock (whole order, or `qty` of one offer). */
async function releaseStock(tx: Tx, orderId: string, only?: { offerId: string; qty: number }) {
  let left = only?.qty ?? Infinity;
  for (const r of await reservations(tx, orderId)) {
    if (only && r.offerId !== only.offerId) continue;
    const q = Math.min(r.qty, left);
    if (q <= 0) continue;
    await tx.stockLevel.update({ where: { offerId_addressId: { offerId: r.offerId, addressId: r.addressId } }, data: { reserved: { decrement: q } } });
    await tx.stockMovement.create({ data: { offerId: r.offerId, addressId: r.addressId, type: "RELEASE", qty: q, orderId } });
    left -= q;
  }
}

/** Goods leave the warehouse: reserved → shipped (on hand decreases). */
async function shipStock(tx: Tx, orderId: string) {
  for (const r of await reservations(tx, orderId)) {
    await tx.stockLevel.update({ where: { offerId_addressId: { offerId: r.offerId, addressId: r.addressId } }, data: { reserved: { decrement: r.qty }, onHand: { decrement: r.qty } } });
    await tx.stockMovement.create({ data: { offerId: r.offerId, addressId: r.addressId, type: "SHIPMENT", qty: r.qty, orderId } });
  }
}

// ── checkout ────────────────────────────────────────────────────────────────

export async function placeOrder(ctx: Ctx, input: { deliveryAddressId: string; notes?: string | null; requestedDeliveryDate?: Date | null }) {
  if ((ctx.company.type !== "CUSTOMER" && ctx.company.type !== "WHOLESALER") || ctx.company.status !== "APPROVED" || !can(ctx, "buyer.orders.place"))
    throw new ForbiddenError();
  const cart = await prisma.cart.findUnique({ where: { buyerCompanyId_userId: { buyerCompanyId: ctx.company.id, userId: ctx.user.id } }, include: { items: true } });
  if (!cart || !cart.sellerCompanyId || cart.items.length === 0) throw new ValidationError("Your cart is empty.");
  const sellerId = cart.sellerCompanyId;

  const address = await prisma.address.findFirst({ where: { id: input.deliveryAddressId, companyId: ctx.company.id, isActive: true, kind: "DELIVERY" }, include: { city: true, country: true } });
  if (!address) throw new ValidationError("Choose one of your delivery addresses.");
  if (address.countryId !== ctx.company.countryId) throw new ValidationError("Delivery address must be in your company's country.");

  // Re-price everything server-side with the same visibility rules as the catalogue.
  const { items, unavailable } = await pricedOffers(ctx, cart.items.map((i) => ({ offerId: i.offerId, qty: i.qty })));
  if (unavailable.length) throw new AppError("ITEM_UNAVAILABLE", "Some products in your cart are no longer available. Please review your cart.", 409);
  if (items.some((i) => !i.price)) throw new AppError("ITEM_UNAVAILABLE", "Some products no longer have a price for you. Please review your cart.", 409);

  const seller = await prisma.company.findUniqueOrThrow({ where: { id: sellerId } });
  const flow: OrderFlow = ctx.company.type === "CUSTOMER" ? "CUSTOMER_FROM_WHOLESALER" : "WHOLESALER_FROM_DISTRIBUTOR";

  return prisma.$transaction(async (tx) => {
    const commission = await activeCommission(tx, sellerId);
    if (!commission) throw new AppError("SUPPLIER_UNAVAILABLE", "This supplier can't take orders at the moment.", 409);

    const lines = [];
    for (const i of items) {
      const rate = await vatRate(tx, ctx.company.countryId, address.city?.regionId ?? null, i.taxCategoryId);
      // List price before promotions; discounts split by who pays (commission stays on list).
      const c = computeLine({
        qty: i.qty, unitListPriceNet: i.price!.listUnitNet, vatRatePercent: rate, commissionRatePercent: commission.rate.toString(),
        vendorFundedDiscountPerUnit: i.price!.vendorFundedPerUnit, firingiFundedDiscountPerUnit: i.price!.firingiFundedPerUnit,
      });
      lines.push({ item: i, rate, calc: { ...c, qty: i.qty } });
    }
    const goodsNet = lines.reduce((a, l) => a.plus(l.calc.lineNet), new Decimal(0));

    const rules = await deliveryRulesFor(ctx.company.countryId, sellerId);
    const decision = decideDelivery(
      goodsNet,
      rules.firingi && { id: rules.firingi.id, minOrderValue: rules.firingi.minOrderValue!.toString(), feeNet: rules.firingi.firingiDeliveryFeeNet!.toString() },
      rules.vendor && { id: rules.vendor.id, amount: rules.vendor.vendorDeliveryMinimum!.toString() },
      seller.countryId !== ctx.company.countryId,
    );
    if (!decision.ok)
      throw new AppError("BELOW_MINIMUM", `Minimum order for delivery is ${decision.minimum.toFixed(2)} € (excl. VAT). Add ${decision.missing.toFixed(2)} € more.`, 422);
    const feeVatRate = decision.feeNet.gt(0) && rules.firingi?.feeTaxCategoryId ? await vatRate(tx, ctx.company.countryId, address.city?.regionId ?? null, rules.firingi.feeTaxCategoryId) : new Decimal(0);
    const totals = computeTotals(lines.map((l) => l.calc), { feeNet: decision.feeNet, feeVatPercent: feeVatRate });

    const number = await nextNumber(tx, "order", "FO");
    const order = await tx.order.create({
      data: {
        number, flow, buyerCompanyId: ctx.company.id, sellerCompanyId: sellerId, placedByUserId: ctx.user.id, countryId: ctx.company.countryId,
        status: "NEW", deliveryMode: decision.mode, deliveryRuleId: decision.ruleId,
        deliveryAddress: {
          id: address.id, label: address.label, line1: address.line1, line2: address.line2, postalCode: address.postalCode, city: address.cityName,
          regionId: address.city?.regionId ?? null, country: address.country.code, contactName: address.contactName, phone: address.phone,
          latitude: address.latitude?.toString() ?? null, longitude: address.longitude?.toString() ?? null,
        },
        requestedDeliveryDate: input.requestedDeliveryDate ?? null, buyerNotes: input.notes?.trim() || null,
        listNet: totals.listNet.toFixed(2), discountTotal: totals.discountTotal.toFixed(2), deliveryFeeNet: totals.deliveryFeeNet.toFixed(2),
        netTotal: totals.netTotal.toFixed(2), vatTotal: totals.vatTotal.toFixed(2), grandTotal: totals.grandTotal.toFixed(2),
        commissionTotal: totals.commissionTotal.toFixed(2), vendorPayableNet: totals.vendorPayableNet.toFixed(2), firingiMarginNet: totals.firingiMarginNet.toFixed(2),
      },
    });
    for (const l of lines) {
      const res = await reserveStock(tx, order.id, l.item.offerId, l.item.qty);
      if (!res.ok) {
        const name = l.item.name.pt ?? l.item.name.en;
        throw new AppError("OUT_OF_STOCK", `Only ${res.available} available of "${name}". Please change the quantity.`, 409);
      }
      if (!order.sourceAddressId) await tx.order.update({ where: { id: order.id }, data: { sourceAddressId: res.addressId } }).then((o) => (order.sourceAddressId = o.sourceAddressId));
      await tx.orderLine.create({
        data: {
          orderId: order.id, offerId: l.item.offerId, productName: l.item.name, sku: l.item.sku, packagingName: l.item.packaging.name, qtyOrdered: l.item.qty,
          unitListPriceNet: l.calc.unitListPriceNet.toFixed(4),
          vendorDiscountNet: l.item.price!.promotions.find((x) => x.ownerType === "VENDOR")?.perUnit ?? 0,
          adminDiscountNet: l.item.price!.promotions.find((x) => x.ownerType === "ADMIN")?.perUnit ?? 0,
          firingiFundedDiscount: l.calc.firingiFundedDiscount.toFixed(4), vendorFundedDiscount: l.calc.vendorFundedDiscount.toFixed(4),
          unitSalePriceNet: l.calc.unitSalePriceNet.toFixed(4), taxRate: l.rate.toFixed(3), lineNet: l.calc.lineNet.toFixed(2), lineVat: l.calc.lineVat.toFixed(2),
          commissionRuleId: commission.id, commissionType: commission.type, commissionRate: commission.rate, commissionBase: l.calc.commissionBase.toFixed(2),
          commissionAmount: l.calc.commissionAmount.toFixed(2), vendorUnitCostNet: l.calc.vendorUnitCostNet.toFixed(4), vendorLineNet: l.calc.vendorLineNet.toFixed(2),
          // Who funded each discount (finance reporting).
          discounts: {
            create: l.item.price!.promotions.map((pr) => ({
              promotionId: pr.id,
              amount: new Decimal(pr.perUnit).mul(l.item.qty).toFixed(2),
              firingiAmount: new Decimal(pr.firingiPerUnit).mul(l.item.qty).toFixed(2),
              vendorAmount: new Decimal(pr.vendorPerUnit).mul(l.item.qty).toFixed(2),
            })),
          },
        },
      });
    }
    await tx.orderStatusHistory.create({ data: { orderId: order.id, toStatus: "NEW", byUserId: ctx.user.id, reason: "Order placed" } });
    // No online payment step yet → the order goes straight to the vendor for confirmation.
    await tx.order.update({ where: { id: order.id }, data: { status: "PENDING_CONFIRMATION" } });
    await tx.orderStatusHistory.create({ data: { orderId: order.id, fromStatus: "NEW", toStatus: "PENDING_CONFIRMATION", reason: "Sent to supplier" } });
    await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "order.placed", entityType: "Order", entityId: order.id, after: { number, sellerId, grandTotal: totals.grandTotal.toFixed(2), deliveryMode: decision.mode } }, tx);
    return { id: order.id, number };
  }).then(async (r) => {
    await notifyCompany(sellerId, { type: "order.new", title: `New order ${r.number}`, body: `You received order ${r.number}. Please confirm it.`, link: `/vendor/orders/${r.id}` });
    return r;
  });
}

// ── viewing ─────────────────────────────────────────────────────────────────

export type OrderRole = "BUYER" | "VENDOR" | "ADMIN";

/** Which side the caller is on for this order (or null = may not see it). */
export async function roleFor(ctx: Ctx, order: { buyerCompanyId: string; sellerCompanyId: string }): Promise<OrderRole | null> {
  if (ctx.company.id === order.buyerCompanyId && can(ctx, ["buyer.orders.view", "buyer.orders.place"])) return "BUYER";
  if (ctx.company.id === order.sellerCompanyId && can(ctx, ["vendor.orders.view", "vendor.orders.manage"])) return "VENDOR";
  if (ctx.company.type === "ADMIN" && can(ctx, ["admin.orders.view", "admin.orders.manage"])) {
    const inScope = await prisma.company.count({ where: { id: order.buyerCompanyId, ...scopeWhere(ctx) } });
    return inScope ? "ADMIN" : null;
  }
  return null;
}

export async function getOrder(ctx: Ctx, id: string) {
  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      buyer: { select: { id: true, legalName: true, tradeName: true, taxId: true, vatNumber: true, phone: true, email: true } },
      seller: { select: { id: true, legalName: true, tradeName: true, type: true, phone: true } },
      placedBy: { select: { name: true, email: true } },
      sourceAddress: true,
      lines: { orderBy: { id: "asc" } },
      statusHistory: { orderBy: { at: "asc" } },
      exceptions: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!order) throw new NotFoundError("Order");
  const role = await roleFor(ctx, order);
  if (!role) throw new NotFoundError("Order"); // don't reveal other companies' orders
  const actors = new Map((await prisma.user.findMany({ where: { id: { in: order.statusHistory.map((h) => h.byUserId).filter(Boolean) as string[] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  return { order, role, actors, allowed: allowedTransitions(ctx, role, order.status, order.deliveryMode) };
}

function actorFor(ctx: Ctx, role: OrderRole): Actor | null {
  if (role === "ADMIN") return can(ctx, "admin.orders.manage") ? "ADMIN" : null;
  if (role === "VENDOR") return can(ctx, "vendor.orders.manage") ? "VENDOR" : null;
  return can(ctx, "buyer.orders.place") ? "BUYER" : null;
}

export function allowedTransitions(ctx: Ctx, role: OrderRole, status: OrderStatus, mode: DeliveryMode | null): OrderStatus[] {
  const actor = actorFor(ctx, role);
  if (!actor) return [];
  const all: OrderStatus[] = ["PENDING_CONFIRMATION", "SUPPLIER_PROCESSING", "READY_FOR_PICKUP", "DISPATCHED", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED", "RETURNED", "EXCEPTION"];
  return all.filter((to) => canTransition(status, to, actor, mode));
}

export type OrderListFilter = { statuses?: OrderStatus[]; q?: string; page?: number; since?: Date; sellerType?: "DISTRIBUTOR" | "WHOLESALER"; withOpenExceptions?: boolean };

export async function listOrders(ctx: Ctx, as: OrderRole, f: OrderListFilter = {}) {
  let where: Prisma.OrderWhereInput;
  if (as === "BUYER") {
    if (!can(ctx, ["buyer.orders.view", "buyer.orders.place"])) throw new ForbiddenError();
    where = { buyerCompanyId: ctx.company.id };
  } else if (as === "VENDOR") {
    if (!can(ctx, ["vendor.orders.view", "vendor.orders.manage"])) throw new ForbiddenError();
    where = { sellerCompanyId: ctx.company.id };
  } else {
    if (ctx.company.type !== "ADMIN" || !can(ctx, ["admin.orders.view", "admin.orders.manage"])) throw new ForbiddenError();
    where = { buyer: scopeWhere(ctx) };
  }
  const page = Math.max(1, f.page ?? 1);
  const full: Prisma.OrderWhereInput = {
    AND: [
      where,
      f.statuses?.length ? { status: { in: f.statuses } } : {},
      f.since ? { placedAt: { gte: f.since } } : {},
      f.sellerType ? { seller: { type: f.sellerType } } : {},
      f.withOpenExceptions ? { exceptions: { some: { isResolved: false } } } : {},
      f.q ? { OR: [{ number: { contains: f.q, mode: "insensitive" } }, { buyer: { legalName: { contains: f.q, mode: "insensitive" } } }, { seller: { legalName: { contains: f.q, mode: "insensitive" } } }] } : {},
    ],
  };
  const [rows, total] = await Promise.all([
    prisma.order.findMany({
      where: full,
      include: { buyer: { select: { legalName: true, tradeName: true } }, seller: { select: { legalName: true, tradeName: true, type: true } }, _count: { select: { lines: true, exceptions: { where: { isResolved: false } } } } },
      orderBy: { placedAt: "desc" },
      skip: (page - 1) * 50,
      take: 50,
    }),
    prisma.order.count({ where: full }),
  ]);
  return { rows, total, page, pageCount: Math.max(1, Math.ceil(total / 50)) };
}

// ── changes ─────────────────────────────────────────────────────────────────

async function loadForChange(ctx: Ctx, orderId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { lines: true } });
  if (!order) throw new NotFoundError("Order");
  const role = await roleFor(ctx, order);
  if (!role) throw new NotFoundError("Order");
  const actor = actorFor(ctx, role);
  if (!actor) throw new ForbiddenError();
  return { order, role, actor };
}

const NOTIFY: Partial<Record<OrderStatus, string>> = {
  SUPPLIER_PROCESSING: "confirmed by the supplier", READY_FOR_PICKUP: "ready for pickup", DISPATCHED: "dispatched",
  OUT_FOR_DELIVERY: "out for delivery", DELIVERED: "delivered", CANCELLED: "cancelled", EXCEPTION: "on hold (exception)", RETURNED: "returned",
};

/** Generic status change following the state machine and the actor's rights. */
export async function changeOrderStatus(ctx: Ctx, orderId: string, to: OrderStatus, reason?: string | null) {
  const { order, actor } = await loadForChange(ctx, orderId);
  if (!canTransition(order.status, to, actor, order.deliveryMode)) throw new AppError("BAD_TRANSITION", `You can't change this order from ${order.status} to ${to}.`, 409);
  if ((to === "CANCELLED" || to === "EXCEPTION" || to === "RETURNED") && !reason?.trim()) throw new ValidationError("Please give a reason.");
  if (to === "SUPPLIER_PROCESSING" && order.status === "PENDING_CONFIRMATION") return confirmOrder(ctx, orderId, {});
  await prisma.$transaction(async (tx) => {
    const res = await tx.order.updateMany({ where: { id: orderId, status: order.status }, data: { status: to } });
    if (res.count !== 1) throw new AppError("CONFLICT", "The order was changed by someone else. Please reload.", 409);
    if (to === "CANCELLED") await releaseStock(tx, orderId);
    if (to === "DISPATCHED") await shipStock(tx, orderId);
    if (to === "DELIVERED") {
      // Delivered = what was confirmed. FIRINGI invoices the buyer and tells the vendor what to invoice.
      for (const l of order.lines) await tx.orderLine.update({ where: { id: l.id }, data: { qtyDelivered: l.qtyConfirmed ?? l.qtyOrdered } });
      await invoiceDeliveredOrder(tx, orderId, ctx.user.id);
    }
    if (to === "EXCEPTION") await tx.orderException.create({ data: { orderId, type: "OTHER", description: reason!.trim() } });
    await tx.orderStatusHistory.create({ data: { orderId, fromStatus: order.status, toStatus: to, reason: reason?.trim() || null, byUserId: ctx.user.id } });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: `order.status.${to.toLowerCase()}`, entityType: "Order", entityId: orderId, before: { status: order.status }, after: { status: to, reason } }, tx);
  });
  const text = `Order ${order.number} is ${NOTIFY[to] ?? to.toLowerCase()}.${reason ? ` ${reason}` : ""}${to === "DELIVERED" ? " The invoice is available under Invoices." : ""}`;
  if (actor !== "BUYER") await notifyCompany(order.buyerCompanyId, { type: `order.${to.toLowerCase()}`, title: `Order ${order.number}`, body: text, link: `/buy/orders/${orderId}` });
  if (actor !== "VENDOR") await notifyCompany(order.sellerCompanyId, { type: `order.${to.toLowerCase()}`, title: `Order ${order.number}`, body: text, link: `/vendor/orders/${orderId}` });
}

/**
 * Vendor (or admin) accepts the order, optionally confirming LOWER quantities
 * (short supply). Lines and totals are recalculated with the frozen prices / rates and
 * the surplus reservation is released. Delivery mode and fee stay as agreed at checkout.
 */
export async function confirmOrder(ctx: Ctx, orderId: string, quantities: Record<string, number>) {
  const { order, actor } = await loadForChange(ctx, orderId);
  if (!canTransition(order.status, "SUPPLIER_PROCESSING", actor, order.deliveryMode)) throw new AppError("BAD_TRANSITION", "This order can't be confirmed now.", 409);
  const confirmed = order.lines.map((l) => {
    const q = quantities[l.id] ?? l.qtyOrdered;
    if (!Number.isInteger(q) || q < 0 || q > l.qtyOrdered) throw new ValidationError("Confirmed quantity must be between 0 and the ordered quantity.");
    return { line: l, qty: q };
  });
  if (confirmed.every((c) => c.qty === 0)) throw new ValidationError("Nothing confirmed — decline the order instead.");
  await prisma.$transaction(async (tx) => {
    const calcLines = [];
    for (const { line, qty } of confirmed) {
      const c = computeLine({
        qty, unitListPriceNet: line.unitListPriceNet.toString(), vatRatePercent: line.taxRate.toString(), commissionRatePercent: line.commissionRate?.toString() ?? 0,
        vendorFundedDiscountPerUnit: line.vendorFundedDiscount.toString(), firingiFundedDiscountPerUnit: line.firingiFundedDiscount.toString(),
      });
      calcLines.push({ ...c, qty });
      await tx.orderLine.update({
        where: { id: line.id },
        data: { qtyConfirmed: qty, lineNet: c.lineNet.toFixed(2), lineVat: c.lineVat.toFixed(2), commissionBase: c.commissionBase.toFixed(2), commissionAmount: c.commissionAmount.toFixed(2), vendorLineNet: c.vendorLineNet.toFixed(2) },
      });
      if (qty < line.qtyOrdered) {
        await releaseStock(tx, orderId, { offerId: line.offerId, qty: line.qtyOrdered - qty });
        const discounts = await tx.orderLineDiscount.findMany({ where: { orderLineId: line.id } });
        for (const d of discounts) {
          const f = new Decimal(qty).div(line.qtyOrdered);
          await tx.orderLineDiscount.update({ where: { id: d.id }, data: { amount: d.amount.mul(f.toString()).toFixed(2), firingiAmount: d.firingiAmount.mul(f.toString()).toFixed(2), vendorAmount: d.vendorAmount.mul(f.toString()).toFixed(2) } });
        }
      }
    }
    // Delivery fee VAT: rate of the fee's tax category in the buyer's (region of) country.
    let feeVatPercent: Decimal = new Decimal(0);
    if (order.deliveryFeeNet.gt(0) && order.deliveryRuleId) {
      const rule = await tx.deliveryRule.findUnique({ where: { id: order.deliveryRuleId } });
      const regionId = (order.deliveryAddress as { regionId?: string | null }).regionId ?? null;
      if (rule?.feeTaxCategoryId) feeVatPercent = await vatRate(tx, order.countryId, regionId, rule.feeTaxCategoryId);
    }
    const t = computeTotals(calcLines, { feeNet: order.deliveryFeeNet.toString(), feeVatPercent });
    const res = await tx.order.updateMany({
      where: { id: orderId, status: order.status },
      data: {
        status: "SUPPLIER_PROCESSING", listNet: t.listNet.toFixed(2), discountTotal: t.discountTotal.toFixed(2), netTotal: t.netTotal.toFixed(2),
        vatTotal: t.vatTotal.toFixed(2), grandTotal: t.grandTotal.toFixed(2), commissionTotal: t.commissionTotal.toFixed(2),
        vendorPayableNet: t.vendorPayableNet.toFixed(2), firingiMarginNet: t.firingiMarginNet.toFixed(2),
      },
    });
    if (res.count !== 1) throw new AppError("CONFLICT", "The order was changed by someone else. Please reload.", 409);
    const short = confirmed.filter((c) => c.qty < c.line.qtyOrdered).length;
    await tx.orderStatusHistory.create({ data: { orderId, fromStatus: order.status, toStatus: "SUPPLIER_PROCESSING", byUserId: ctx.user.id, reason: short ? `Confirmed with ${short} line(s) reduced` : "Confirmed" } });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "order.confirmed", entityType: "Order", entityId: orderId, after: { quantities: Object.fromEntries(confirmed.map((c) => [c.line.id, c.qty])) } }, tx);
  });
  await notifyCompany(order.buyerCompanyId, { type: "order.confirmed", title: `Order ${order.number} confirmed`, body: `Your order ${order.number} was confirmed by the supplier.`, link: `/buy/orders/${orderId}` });
}

export async function resolveException(ctx: Ctx, exceptionId: string, note: string) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, "admin.orders.manage")) throw new ForbiddenError();
  const ex = await prisma.orderException.findUnique({ where: { id: exceptionId }, include: { order: true } });
  if (!ex || !(await roleFor(ctx, ex.order))) throw new NotFoundError("Exception");
  await prisma.orderException.update({ where: { id: exceptionId }, data: { isResolved: true, resolvedById: ctx.user.id, resolvedAt: new Date(), description: `${ex.description}\n— Resolved: ${note}` } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "order.exception_resolved", entityType: "Order", entityId: ex.orderId, after: { note } });
}

export { CLOSED, RESERVED_STATUSES };
