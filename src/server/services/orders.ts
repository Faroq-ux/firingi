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
import { computeLine, computeTotals } from "@/server/orders/calc";
import { priceCheckout } from "@/server/orders/pricing";
import { randomUUID } from "node:crypto";
import { assertCouponLimits, recordRedemptions, syncRedemptions } from "@/server/marketing/offers";
import { canTransition, CLOSED, RESERVED_STATUSES, type Actor } from "@/server/orders/state";
import { deliveryStatusForOrder } from "@/server/delivery/state";
import { vendorReaches } from "@/server/delivery/coverage";
import { scopeWhere } from "./admin-access";
import { writeAudit } from "./audit";
import { detachFromRoute } from "./routes";
import { notify } from "@/server/notify/dispatch";
import { invoiceDeliveredOrder } from "@/server/invoicing/service";
import { assertCanOrder } from "./payments";
import { platformSettings } from "./platform-settings";

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
export async function vatRate(tx: Tx, countryId: string, regionId: string | null, taxCategoryId: string) {
  const now = new Date();
  const rows = await tx.taxRate.findMany({
    where: { countryId, taxCategoryId, validFrom: { lte: now }, OR: [{ validTo: null }, { validTo: { gt: now } }], AND: [{ OR: [{ regionId: null }, ...(regionId ? [{ regionId }] : [])] }] },
    orderBy: { validFrom: "desc" },
  });
  return new Decimal((rows.find((r) => r.regionId === regionId && regionId) ?? rows.find((r) => r.regionId === null))?.rate.toString() ?? 0);
}

export async function activeCommission(tx: Tx, vendorId: string) {
  return tx.commissionRule.findFirst({ where: { vendorCompanyId: vendorId, validTo: null, categoryId: null, validFrom: { lte: new Date() } }, orderBy: { validFrom: "desc" } });
}

/** Reserve qty for an offer across the vendor's stock locations (most available first). */
export async function reserveStock(tx: Tx, orderId: string, offerId: string, qty: number) {
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

/**
 * Goods that already left the warehouse come back (cancelled after dispatch, or a return):
 * on hand increases again. `only` limits it to some offers / quantities.
 */
export async function restockShipped(tx: Tx, orderId: string, only?: Map<string, number>) {
  const moves = await tx.stockMovement.findMany({ where: { orderId, type: { in: ["SHIPMENT", "RETURN"] } } });
  const net = new Map<string, { offerId: string; addressId: string; qty: number }>();
  for (const m of moves) {
    const k = `${m.offerId}|${m.addressId}`;
    const cur = net.get(k) ?? { offerId: m.offerId, addressId: m.addressId, qty: 0 };
    cur.qty += m.type === "SHIPMENT" ? m.qty : -m.qty;
    net.set(k, cur);
  }
  const left = only ? new Map(only) : null;
  for (const r of net.values()) {
    let q = r.qty;
    if (left) q = Math.min(q, left.get(r.offerId) ?? 0);
    if (q <= 0) continue;
    await tx.stockLevel.update({ where: { offerId_addressId: { offerId: r.offerId, addressId: r.addressId } }, data: { onHand: { increment: q } } });
    await tx.stockMovement.create({ data: { offerId: r.offerId, addressId: r.addressId, type: "RETURN", qty: q, orderId } });
    if (left) left.set(r.offerId, (left.get(r.offerId) ?? 0) - q);
  }
}

/** Company that executes the delivery: the vendor (own fleet / carrier) or FIRINGI. */
async function executorFor(tx: Tx, order: { sellerCompanyId: string; deliveryMode: DeliveryMode | null }) {
  if (order.deliveryMode === "FIRINGI_FLEET") return (await tx.company.findFirstOrThrow({ where: { type: "ADMIN" }, select: { id: true } })).id;
  return order.sellerCompanyId;
}

/** Make sure a confirmed order has its delivery record (created once, on confirmation). */
export async function ensureDelivery(tx: Tx, orderId: string) {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { id: true, sellerCompanyId: true, deliveryMode: true, deliveryFeeNet: true, requestedDeliveryDate: true, delivery: { select: { id: true } } } });
  if (order.delivery) return order.delivery.id;
  const d = await tx.delivery.create({
    data: { orderId, mode: order.deliveryMode ?? "VENDOR_FLEET", executingCompanyId: await executorFor(tx, order), feeNet: order.deliveryFeeNet, scheduledFor: order.requestedDeliveryDate },
  });
  return d.id;
}

// ── checkout ────────────────────────────────────────────────────────────────

export async function placeOrder(ctx: Ctx, input: { deliveryAddressId: string; notes?: string | null; requestedDeliveryDate?: Date | null }) {
  if ((ctx.company.type !== "CUSTOMER" && ctx.company.type !== "WHOLESALER") || ctx.company.status !== "APPROVED" || !can(ctx, "buyer.orders.place"))
    throw new ForbiddenError();
  if (input.requestedDeliveryDate) {
    const days = (input.requestedDeliveryDate.getTime() - Date.now()) / 86400_000;
    const max = (await platformSettings()).maxRequestedDays;
    if (days < -1 || days > max) throw new ValidationError(`Choose a delivery date between today and ${max} days from now.`);
  }
  const cart = await prisma.cart.findUnique({ where: { buyerCompanyId_userId: { buyerCompanyId: ctx.company.id, userId: ctx.user.id } }, include: { items: true } });
  if (cart?.routed && cart.items.length) {
    // "Order from FIRINGI": FIRINGI picks the supplier(s).
    const { placeRoutedOrder } = await import("@/server/allocation/routed");
    return placeRoutedOrder(ctx, cart, input);
  }
  if (!cart || cart.items.length === 0) throw new ValidationError("Your cart is empty.");

  const address = await prisma.address.findFirst({ where: { id: input.deliveryAddressId, companyId: ctx.company.id, isActive: true, kind: "DELIVERY" }, include: { city: true, country: true } });
  if (!address) throw new ValidationError("Choose one of your delivery addresses.");
  if (address.countryId !== ctx.company.countryId) throw new ValidationError("Delivery address must be in your company's country.");

  // Suppliers in the cart: each must serve the address and have a commission agreement.
  const sellerIds = [...new Set((await prisma.vendorOffer.findMany({ where: { id: { in: cart.items.map((i) => i.offerId) } }, select: { vendorCompanyId: true } })).map((o) => o.vendorCompanyId))];
  const sellers = await prisma.company.findMany({ where: { id: { in: sellerIds } }, select: { id: true, legalName: true, tradeName: true } });
  const nameOf = (id: string) => { const c = sellers.find((x) => x.id === id); return c?.tradeName ?? c?.legalName ?? "a supplier"; };
  const commissions = new Map<string, NonNullable<Awaited<ReturnType<typeof activeCommission>>>>();
  for (const sid of sellerIds) {
    if (!(await vendorReaches(sid, address.id)))
      throw new AppError("OUTSIDE_SERVICE_AREA", `${nameOf(sid)} doesn't deliver to that address. Choose another delivery address or remove its products.`, 422, { supplier: nameOf(sid) });
    const c = await activeCommission(prisma as unknown as Tx, sid);
    if (!c) throw new AppError("SUPPLIER_UNAVAILABLE", `${nameOf(sid)} can't take orders at the moment. Remove its products to continue.`, 409, { supplier: nameOf(sid) });
    commissions.set(sid, c);
  }

  // Re-price everything server-side with the same visibility rules as the catalogue (offers, coupon, delivery).
  const flow: OrderFlow = ctx.company.type === "CUSTOMER" ? "CUSTOMER_FROM_WHOLESALER" : "WHOLESALER_FROM_DISTRIBUTOR";
  const pc = await priceCheckout(ctx, { items: cart.items.map((i) => ({ offerId: i.offerId, qty: i.qty })), couponCode: cart.couponCode }, {
    regionId: address.city?.regionId ?? null, addressId: address.id, commissionRates: new Map([...commissions].map(([k, c]) => [k, c.rate.toString()])),
  });
  if (pc.unavailable.length) throw new AppError("ITEM_UNAVAILABLE", "Some products in your cart are no longer available. Please review your cart.", 409);
  if (pc.parts.reduce((a, p) => a + p.lines.length, 0) !== cart.items.length) throw new AppError("ITEM_UNAVAILABLE", "Some products no longer have a price for you. Please review your cart.", 409);
  if (pc.coupon && !pc.coupon.ok) throw pc.coupon.error!;
  for (const part of pc.parts) {
    const d = part.decision;
    if (!d.ok) {
      const who = pc.parts.length > 1 ? `${nameOf(part.sellerId)}: ` : "";
      throw new AppError("BELOW_MINIMUM", d.unit === "UNITS"
        ? `${who}Minimum order for delivery is ${d.minimum} units. Add ${d.missing} more.`
        : `${who}Minimum order for delivery is ${d.minimum.toFixed(2)} € (excl. VAT). Add ${d.missing.toFixed(2)} € more.`, 422);
    }
  }
  const checkoutId = randomUUID();
  const deliveryAddress = {
    id: address.id, label: address.label, line1: address.line1, line2: address.line2, postalCode: address.postalCode, city: address.cityName,
    regionId: address.city?.regionId ?? null, country: address.country.code, contactName: address.contactName, phone: address.phone,
    latitude: address.latitude?.toString() ?? null, longitude: address.longitude?.toString() ?? null,
  };

  const created = await prisma.$transaction(async (tx) => {
    // Credit control on the whole checkout: overdue invoices / credit limit (Payment Settings).
    await assertCanOrder(ctx.company.id, pc.grandTotal);
    const out: { id: string; number: string; sellerId: string }[] = [];
    for (const part of pc.parts) {
      const sellerId = part.sellerId;
      const commission = await activeCommission(tx, sellerId);
      if (!commission || commission.id !== commissions.get(sellerId)!.id) throw new AppError("SUPPLIER_UNAVAILABLE", `${nameOf(sellerId)} can't take orders at the moment.`, 409);
      const decision = part.decision as Extract<typeof part.decision, { ok: true }>;
      const totals = part.totals;
      const number = await nextNumber(tx, "order", "FO");
      const order = await tx.order.create({
        data: {
          number, flow, buyerCompanyId: ctx.company.id, sellerCompanyId: sellerId, placedByUserId: ctx.user.id, countryId: ctx.company.countryId,
          status: "NEW", deliveryMode: decision.mode, deliveryRuleId: decision.ruleId, checkoutId: pc.parts.length > 1 ? checkoutId : null,
          couponCode: pc.coupon?.ok ? pc.coupon.code : null, deliveryDiscountNet: part.waived.toFixed(2), deliveryPromotionId: part.deliveryPromotionId,
          deliveryAddress, requestedDeliveryDate: input.requestedDeliveryDate ?? null, buyerNotes: input.notes?.trim() || null,
          listNet: totals.listNet.toFixed(2), discountTotal: totals.discountTotal.toFixed(2), deliveryFeeNet: totals.deliveryFeeNet.toFixed(2),
          netTotal: totals.netTotal.toFixed(2), vatTotal: totals.vatTotal.toFixed(2), grandTotal: totals.grandTotal.toFixed(2),
          commissionTotal: totals.commissionTotal.toFixed(2), vendorPayableNet: totals.vendorPayableNet.toFixed(2), firingiMarginNet: totals.firingiMarginNet.toFixed(2),
        },
      });
      for (const l of part.lines) {
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
            vendorDiscountNet: l.discounts.filter((x) => x.ownerType === "VENDOR").reduce((a, x) => a.plus(x.perUnit), new Decimal(0)).toFixed(4),
            adminDiscountNet: l.discounts.filter((x) => x.ownerType === "ADMIN").reduce((a, x) => a.plus(x.perUnit), new Decimal(0)).toFixed(4),
            firingiFundedDiscount: l.calc.firingiFundedDiscount.toFixed(4), vendorFundedDiscount: l.calc.vendorFundedDiscount.toFixed(4),
            unitSalePriceNet: l.calc.unitSalePriceNet.toFixed(4), taxRate: l.rate.toFixed(3), lineNet: l.calc.lineNet.toFixed(2), lineVat: l.calc.lineVat.toFixed(2),
            commissionRuleId: commission.id, commissionType: commission.type, commissionRate: commission.rate, commissionBase: l.calc.commissionBase.toFixed(2),
            commissionAmount: l.calc.commissionAmount.toFixed(2), vendorUnitCostNet: l.calc.vendorUnitCostNet.toFixed(4), vendorLineNet: l.calc.vendorLineNet.toFixed(2),
            // Who funded each discount (finance reporting).
            discounts: {
              create: l.discounts.map((pr) => ({
                promotionId: pr.promotionId,
                amount: pr.perUnit.mul(l.item.qty).toFixed(2),
                firingiAmount: pr.firingiPerUnit.mul(l.item.qty).toFixed(2),
                vendorAmount: pr.vendorPerUnit.mul(l.item.qty).toFixed(2),
              })),
            },
          },
        });
      }
      await recordRedemptions(tx, order.id, ctx.company.id, part.redemptions, checkoutId);
      await tx.orderStatusHistory.create({ data: { orderId: order.id, toStatus: "NEW", byUserId: ctx.user.id, reason: "Order placed" } });
      await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "order.placed", entityType: "Order", entityId: order.id, after: { number, sellerId, grandTotal: totals.grandTotal.toFixed(2), deliveryMode: decision.mode, coupon: pc.coupon?.ok ? pc.coupon.code : null, checkout: pc.parts.length > 1 ? checkoutId : null } }, tx);
      out.push({ id: order.id, number, sellerId });
    }
    // A coupon that has reached a limit while this checkout was being placed is refused.
    if (pc.coupon?.ok) await assertCouponLimits(tx, pc.coupon.code, ctx.company.id);
    // No online payment step yet → the orders go straight to the suppliers for confirmation.
    for (const o of out) {
      await tx.order.update({ where: { id: o.id }, data: { status: "PENDING_CONFIRMATION" } });
      await tx.orderStatusHistory.create({ data: { orderId: o.id, fromStatus: "NEW", toStatus: "PENDING_CONFIRMATION", reason: "Sent to supplier" } });
    }
    await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
    await tx.cart.update({ where: { id: cart.id }, data: { couponCode: null } });
    return out;
  });
  const buyerName = ctx.company.tradeName ?? ctx.company.legalName;
  for (const o of created) {
    const row = await prisma.order.findUniqueOrThrow({ where: { id: o.id }, select: { grandTotal: true } });
    await notify("order.new", [{ companyId: o.sellerId, link: `/vendor/orders/${o.id}` }], { number: o.number, buyer: buyerName, total: row.grandTotal.toNumber() }, { ref: { type: "Order", id: o.id } });
  }
  return { id: created[0].id, number: created[0].number, orders: created.map((o) => ({ id: o.id, number: o.number })) };
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
      parentOrder: { select: { id: true, number: true, seller: { select: { legalName: true, tradeName: true } } } },
      childOrders: { select: { id: true, number: true, status: true, placedAt: true, seller: { select: { legalName: true, tradeName: true } } }, orderBy: { placedAt: "asc" } },
    },
  });
  if (!order) throw new NotFoundError("Order");
  const role = await roleFor(ctx, order);
  if (!role) throw new NotFoundError("Order"); // don't reveal other companies' orders
  const actors = new Map((await prisma.user.findMany({ where: { id: { in: order.statusHistory.map((h) => h.byUserId).filter(Boolean) as string[] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const settings = await platformSettings();
  const allowed = allowedTransitions(ctx, role, order.status, order.deliveryMode).filter((s) => !(role === "BUYER" && s === "CANCELLED" && !settings.buyerCanCancel));
  return { order, role, actors, allowed };
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
      // Buyers never see FIRINGI's side of the deal: the supplier's commission, its payout, FIRINGI's margin.
      omit: as === "BUYER" ? BUYER_HIDDEN : undefined,
      include: { buyer: { select: { legalName: true, tradeName: true } }, seller: { select: { legalName: true, tradeName: true, type: true } }, _count: { select: { lines: true, exceptions: { where: { isResolved: false } } } } },
      orderBy: { placedAt: "desc" },
      skip: (page - 1) * 50,
      take: 50,
    }),
    prisma.order.count({ where: full }),
  ]);
  // Ordered from FIRINGI: the buyer's supplier is FIRINGI, not the wholesaler it picked.
  const shown = as === "BUYER" ? rows.map((o) => (o.routedByFiringi ? { ...o, seller: { legalName: "FIRINGI", tradeName: "FIRINGI", type: "ADMIN" as const } } : o)) : rows;
  return { rows: shown, total, page, pageCount: Math.max(1, Math.ceil(total / 50)) };
}

/** Order fields a buyer must not see (FIRINGI's commission, the supplier's payout and currency, FIRINGI's margin). */
const BUYER_HIDDEN = { commissionTotal: true, vendorPayableNet: true, firingiMarginNet: true, vendorCurrencyCode: true, fxRate: true, deliveryRuleId: true, sourceAddressId: true } as const;

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

/** Notification event for each order status (statuses not listed send nothing). */
const ORDER_EVENT: Partial<Record<OrderStatus, string>> = {
  SUPPLIER_PROCESSING: "order.confirmed", READY_FOR_PICKUP: "order.ready_for_pickup", DISPATCHED: "order.dispatched",
  OUT_FOR_DELIVERY: "order.out_for_delivery", DELIVERED: "order.delivered", CANCELLED: "order.cancelled", EXCEPTION: "order.exception", RETURNED: "order.returned",
};

/** Generic status change following the state machine and the actor's rights. */
export async function changeOrderStatus(ctx: Ctx, orderId: string, to: OrderStatus, reason?: string | null) {
  const { order, actor } = await loadForChange(ctx, orderId);
  if (!canTransition(order.status, to, actor, order.deliveryMode)) throw new AppError("BAD_TRANSITION", `You can't change this order from ${order.status} to ${to}.`, 409);
  if ((to === "CANCELLED" || to === "EXCEPTION" || to === "RETURNED") && !reason?.trim()) throw new ValidationError("Please give a reason.");
  if (actor === "BUYER" && to === "CANCELLED" && !(await platformSettings()).buyerCanCancel) throw new ForbiddenError("Please contact FIRINGI to cancel this order.");
  if (to === "SUPPLIER_PROCESSING" && order.status === "PENDING_CONFIRMATION") return confirmOrder(ctx, orderId, {});
  await prisma.$transaction((tx) => applyOrderTransition(tx, order, to, { reason, userId: ctx.user.id, companyId: ctx.company.id }));
  if (to === "CANCELLED" && actor === "VENDOR" && order.status === "PENDING_CONFIRMATION") {
    // Supplier declined: FIRINGI tries to move the order to another supplier (Phase 9).
    const { onSupplierEvent } = await import("@/server/allocation/engine");
    const ev = await onSupplierEvent(orderId, "DECLINED");
    if (ev && (ev.status === "MOVED" || ev.status === "PARTIAL" || ev.status === "AWAITING_BUYER")) return; // buyer is told about the move / asked instead
  }
  await notifyOrderChange(order, to, reason, actor);
}

type OrderForChange = { id: string; number: string; status: OrderStatus; buyerCompanyId: string; sellerCompanyId: string; lines: { id: string; qtyOrdered: number; qtyConfirmed: number | null }[] };

/**
 * The one place an order changes status (after authorisation): stock, invoicing,
 * exceptions, history, audit — and the delivery record follows.
 * `exceptionType` tags the exception opened when moving to EXCEPTION.
 */
export async function applyOrderTransition(
  tx: Tx,
  order: OrderForChange,
  to: OrderStatus,
  by: { reason?: string | null; userId: string | null; companyId: string | null; exceptionType?: string; syncDelivery?: boolean },
) {
  const reason = by.reason?.trim() || null;
  const res = await tx.order.updateMany({ where: { id: order.id, status: order.status }, data: { status: to } });
  if (res.count !== 1) throw new AppError("CONFLICT", "The order was changed by someone else. Please reload.", 409);
  if (to === "CANCELLED") {
    await releaseStock(tx, order.id);
    await restockShipped(tx, order.id); // cancelled after dispatch: goods go back on hand
  }
  if (to === "DISPATCHED") await shipStock(tx, order.id); // no-op when already shipped (retry after a failed attempt)
  if (to === "DELIVERED") {
    // Delivered = what was confirmed. FIRINGI invoices the buyer and tells the vendor what to invoice.
    for (const l of order.lines) await tx.orderLine.update({ where: { id: l.id }, data: { qtyDelivered: l.qtyConfirmed ?? l.qtyOrdered } });
    await invoiceDeliveredOrder(tx, order.id, by.userId);
  }
  if (to === "EXCEPTION") await tx.orderException.create({ data: { orderId: order.id, type: by.exceptionType ?? "OTHER", description: reason ?? "Exception" } });
  if (order.status === "EXCEPTION" && to !== "EXCEPTION")
    await tx.orderException.updateMany({ where: { orderId: order.id, isResolved: false }, data: { isResolved: true, resolvedById: by.userId, resolvedAt: new Date() } });
  if (by.syncDelivery !== false) {
    const d = await tx.delivery.findUnique({ where: { orderId: order.id } });
    const next = d ? deliveryStatusForOrder(to, d.status) : null;
    if (d && next)
      await tx.delivery.update({
        where: { id: d.id },
        data: { status: next, ...(next === "PICKED_UP" && !d.pickedUpAt ? { pickedUpAt: new Date() } : {}), ...(next === "DELIVERED" || next === "RETURNED" || next === "CANCELLED" ? { completedAt: new Date() } : {}) },
      });
    if (d?.routeId && (next === "CANCELLED" || next === "RETURNED")) await detachFromRoute(tx, d.id);
  }
  await tx.orderStatusHistory.create({ data: { orderId: order.id, fromStatus: order.status, toStatus: to, reason, byUserId: by.userId } });
  await writeAudit({ actorUserId: by.userId, actorCompanyId: by.companyId, action: `order.status.${to.toLowerCase()}`, entityType: "Order", entityId: order.id, before: { status: order.status }, after: { status: to, reason } }, tx);
}

export async function notifyOrderChange(order: Pick<OrderForChange, "id" | "number" | "buyerCompanyId" | "sellerCompanyId">, to: OrderStatus, reason: string | null | undefined, actor: Actor) {
  const event = ORDER_EVENT[to];
  if (!event) return;
  const targets = [
    ...(actor !== "BUYER" ? [{ companyId: order.buyerCompanyId, link: `/buy/orders/${order.id}` }] : []),
    ...(actor !== "VENDOR" ? [{ companyId: order.sellerCompanyId, link: `/vendor/orders/${order.id}` }] : []),
  ];
  await notify(event, targets, { number: order.number, reason: reason ?? "" }, { ref: { type: "Order", id: order.id } });
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
    const toVendor = order.deliveryMode !== "FIRINGI_FLEET";
    const t = computeTotals(calcLines, { feeNet: order.deliveryFeeNet.toString(), feeVatPercent, toVendor, firingiPaysVendorFeeNet: toVendor ? order.deliveryDiscountNet.toString() : 0 });
    const res = await tx.order.updateMany({
      where: { id: orderId, status: order.status },
      data: {
        status: "SUPPLIER_PROCESSING", listNet: t.listNet.toFixed(2), discountTotal: t.discountTotal.toFixed(2), netTotal: t.netTotal.toFixed(2),
        vatTotal: t.vatTotal.toFixed(2), grandTotal: t.grandTotal.toFixed(2), commissionTotal: t.commissionTotal.toFixed(2),
        vendorPayableNet: t.vendorPayableNet.toFixed(2), firingiMarginNet: t.firingiMarginNet.toFixed(2),
      },
    });
    if (res.count !== 1) throw new AppError("CONFLICT", "The order was changed by someone else. Please reload.", 409);
    await syncRedemptions(tx, orderId);
    await ensureDelivery(tx, orderId);
    const short = confirmed.filter((c) => c.qty < c.line.qtyOrdered).length;
    await tx.orderStatusHistory.create({ data: { orderId, fromStatus: order.status, toStatus: "SUPPLIER_PROCESSING", byUserId: ctx.user.id, reason: short ? `Confirmed with ${short} line(s) reduced` : "Confirmed" } });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "order.confirmed", entityType: "Order", entityId: orderId, after: { quantities: Object.fromEntries(confirmed.map((c) => [c.line.id, c.qty])) } }, tx);
  });
  const seller = await prisma.company.findUniqueOrThrow({ where: { id: order.sellerCompanyId }, select: { legalName: true, tradeName: true } });
  await notify("order.confirmed", [{ companyId: order.buyerCompanyId, link: `/buy/orders/${orderId}` }], { number: order.number, supplier: seller.tradeName ?? seller.legalName }, { ref: { type: "Order", id: orderId } });
  if (confirmed.some((c) => c.qty < c.line.qtyOrdered)) {
    // Short supply: the missing quantities go to another supplier (Phase 9).
    const { onSupplierEvent } = await import("@/server/allocation/engine");
    await onSupplierEvent(orderId, "SHORTFALL");
  }
}

export async function resolveException(ctx: Ctx, exceptionId: string, note: string) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, "admin.orders.manage")) throw new ForbiddenError();
  const ex = await prisma.orderException.findUnique({ where: { id: exceptionId }, include: { order: true } });
  if (!ex || !(await roleFor(ctx, ex.order))) throw new NotFoundError("Exception");
  await prisma.orderException.update({ where: { id: exceptionId }, data: { isResolved: true, resolvedById: ctx.user.id, resolvedAt: new Date(), description: `${ex.description}\n— Resolved: ${note}` } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "order.exception_resolved", entityType: "Order", entityId: ex.orderId, after: { note } });
}

export { CLOSED, RESERVED_STATUSES };

/** The other orders of the same checkout (a cart from several suppliers), for the buyer and FIRINGI. */
export async function checkoutSiblings(ctx: Ctx, order: { id: string; checkoutId: string | null; buyerCompanyId: string }) {
  if (!order.checkoutId) return [];
  if (ctx.company.type !== "ADMIN" && ctx.company.id !== order.buyerCompanyId) return [];
  return prisma.order.findMany({
    where: { checkoutId: order.checkoutId, id: { not: order.id }, buyerCompanyId: order.buyerCompanyId },
    select: { id: true, number: true, status: true, seller: { select: { legalName: true, tradeName: true } } }, orderBy: { number: "asc" },
  });
}
