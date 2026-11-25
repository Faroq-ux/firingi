/**
 * Orders: checkout, stock reservation, status machine, vendor confirmation,
 * cancellation and exceptions. FIRINGI is merchant of record: the buyer buys from
 * FIRINGI, FIRINGI buys from the vendor — the order freezes both sides' numbers.
 */
import { releaseForOrder, reserveForOrder, restockForOrder, shipForOrder } from "@/server/inventory/ledger";
import { recordPurchasedLots } from "@/server/inventory/purchased-core";
import { Prisma, type DeliveryMode, type OrderFlow, type OrderStatus } from "@prisma/client";
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

/** Stock for orders goes through the inventory ledger (batches, FEFO, cost of goods). */
export const reserveStock = (tx: Tx, orderId: string, offerId: string, qty: number) => reserveForOrder(tx, orderId, offerId, qty);
const releaseStock = (tx: Tx, orderId: string, only?: { offerId: string; qty: number }) => releaseForOrder(tx, orderId, only);
const shipStock = (tx: Tx, orderId: string) => shipForOrder(tx, orderId);
/** Goods that already left come back (cancelled after dispatch, or a return). */
export const restockShipped = (tx: Tx, orderId: string, only?: Map<string, number>) => restockForOrder(tx, orderId, only);

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

/**
 * Place the buyer's cart as order(s), one per supplier. `items` (purchase orders, Phase 24) places
 * exactly those items instead of the cart — the cart is left as it is.
 */
export type PlaceOrderInput = {
  deliveryAddressId: string; notes?: string | null; requestedDeliveryDate?: Date | null; items?: { offerId: string; qty: number }[];
  /** Phase 26: coupon for an `items` checkout (approved order), agreed prices (accepted quote), skip the buyer's approval rules (already approved / recurring). */
  couponCode?: string | null; fixedPrices?: Map<string, Decimal.Value>; approved?: boolean; source?: { type: "QUOTE" | "RECURRING" | "APPROVAL"; id: string };
  /** Phase 27: the buyer's purchase-order reference (required when the company says so). */
  poReference?: string | null;
  /** Phase 49: placed from a buying group's group order round. */
  groupRoundId?: string | null;
  /** Phase 50: pay later with this term (FIRINGI's settings; partner or own credit is picked per country). */
  payLater?: { termId: string } | null;
  /** Phase 63/65: goods already handed over — a sale from the supplier's van, or consignment stock the customer used.
   * No delivery fee or minimum, no stock reserved (the caller ships it from the van / the customer's shelf), no risk
   * hold; `paidNow` = paid on the spot or billed for goods already used (no credit check); `reason` for the history. */
  handover?: { warehouseId: string; paidNow: boolean; reason?: string } | null;
  /** Phase 71: an order from a confirmed pre-order — the supplier agreed the quantities, so its delivery minimum doesn't apply. */
  preorder?: boolean;
};

export async function placeOrder(ctx: Ctx, input: PlaceOrderInput): Promise<import("@/server/buying/approvals").PlacedOrPending> {
  if ((ctx.company.type !== "CUSTOMER" && ctx.company.type !== "WHOLESALER") || ctx.company.status !== "APPROVED" || !can(ctx, "buyer.orders.place"))
    throw new ForbiddenError();
  if (input.requestedDeliveryDate) {
    const days = (input.requestedDeliveryDate.getTime() - Date.now()) / 86400_000;
    const max = (await platformSettings()).maxRequestedDays;
    if (days < -1 || days > max) throw new ValidationError(`Choose a delivery date between today and ${max} days from now.`);
  }
  // Phase 27: a PO reference when the company requires one (people placing in the shop / accepting a quote)
  const poReference = input.poReference?.trim().slice(0, 60) || null;
  if (!poReference && !input.approved && (await prisma.company.findUniqueOrThrow({ where: { id: ctx.company.id }, select: { requirePoReference: true } })).requirePoReference)
    throw new AppError("PO_REQUIRED", "Your company asks for a purchase-order (PO) reference on every order.", 422);
  // Phase 27: branch staff order only to their own branches' addresses
  const { canOrderTo, branchStamp } = await import("@/server/multisite/branches");
  if (!(await canOrderTo(ctx, input.deliveryAddressId))) throw new ValidationError("Choose one of your delivery addresses.");
  const cart = input.items
    ? { id: "", routed: false, couponCode: (input.couponCode ?? null) as string | null, loyaltyPoints: 0, items: input.items.map((i) => ({ ...i, id: "" })) }
    : await prisma.cart.findUnique({ where: { buyerCompanyId_userId: { buyerCompanyId: ctx.company.id, userId: ctx.user.id } }, include: { items: true } });
  if (cart?.routed && cart.items.length) {
    // "Order from FIRINGI": FIRINGI picks the supplier(s).
    const { placeRoutedOrder } = await import("@/server/allocation/routed");
    const placed = await placeRoutedOrder(ctx, cart, { ...input, poReference });
    const { budgetAlertsAfterOrder } = await import("@/server/multisite/budgets");
    await budgetAlertsAfterOrder(ctx.company.id, (await branchStamp(prisma as unknown as Tx, input.deliveryAddressId)).branchId).catch(() => null);
    return placed;
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
    if (!input.handover && !(await vendorReaches(sid, address.id)))
      throw new AppError("OUTSIDE_SERVICE_AREA", `${nameOf(sid)} doesn't deliver to that address. Choose another delivery address or remove its products.`, 422, { supplier: nameOf(sid) });
    const c = await activeCommission(prisma as unknown as Tx, sid);
    if (!c) throw new AppError("SUPPLIER_UNAVAILABLE", `${nameOf(sid)} can't take orders at the moment. Remove its products to continue.`, 409, { supplier: nameOf(sid) });
    commissions.set(sid, c);
  }

  // Re-price everything server-side with the same visibility rules as the catalogue (offers, coupon, delivery).
  const flow: OrderFlow = ctx.company.type === "CUSTOMER" ? "CUSTOMER_FROM_WHOLESALER" : "WHOLESALER_FROM_DISTRIBUTOR";
  const pc = await priceCheckout(ctx, { items: cart.items.map((i) => ({ offerId: i.offerId, qty: i.qty })), couponCode: cart.couponCode }, {
    regionId: address.city?.regionId ?? null, addressId: address.id, commissionRates: new Map([...commissions].map(([k, c]) => [k, c.rate.toString()])),
    fixedPrices: input.fixedPrices, loyaltyPoints: cart.loyaltyPoints, noDelivery: !!input.handover,
  });
  // Phase 32: points the buyer chose but can't use (fewer than the minimum, not enough) → refused, not silently dropped
  if (pc.loyalty && (pc.loyalty.reason === "BELOW_MIN" || pc.loyalty.reason === "NOT_ENOUGH"))
    throw new AppError("LOYALTY_POINTS", pc.loyalty.reason === "NOT_ENOUGH" ? `You have ${pc.loyalty.balance} points — fewer than you chose to use. Change the points in your cart.` : "Too few points chosen — change the points in your cart.", 409);
  if (pc.unavailable.length) throw new AppError("ITEM_UNAVAILABLE", "Some products in your cart are no longer available. Please review your cart.", 409);
  if (pc.parts.reduce((a, p) => a + p.lines.length, 0) !== cart.items.length) throw new AppError("ITEM_UNAVAILABLE", "Some products no longer have a price for you. Please review your cart.", 409);
  if (pc.coupon && !pc.coupon.ok) throw pc.coupon.error!;
  for (const part of pc.parts) {
    const d = part.decision;
    if (!d.ok && !input.preorder) {
      const who = pc.parts.length > 1 ? `${nameOf(part.sellerId)}: ` : "";
      if (d.reason === "SMALL_ORDER_LIMIT")
        throw new AppError("SMALL_ORDER_LIMIT", `${who}You have used this month's small orders. Orders must now reach ${d.minimum.toFixed(2)} € (excl. VAT) — add ${d.missing.toFixed(2)} € more.`, 422);
      throw new AppError("BELOW_MINIMUM", d.unit === "UNITS"
        ? `${who}Minimum order for delivery is ${d.minimum} units. Add ${d.missing} more.`
        : `${who}Minimum order for delivery is ${d.minimum.toFixed(2)} € (excl. VAT). Add ${d.missing.toFixed(2)} € more.`, 422);
    }
  }
  // Phase 27: the branch's budgets. Over a "block" budget → refused; over an "approval" budget → a
  // manager decides (unless the person may approve). API orders and purchase orders aren't checked.
  const stamp = await branchStamp(prisma as unknown as Tx, address.id);
  const { evaluateBudgets, checkoutLines, budgetAlertsAfterOrder } = await import("@/server/multisite/budgets");
  const budgets = !input.approved || input.source ? await evaluateBudgets(ctx.company.id, stamp.branchId, checkoutLines(pc)) : [];
  const blocked = budgets.find((b) => b.exceeded && b.action === "BLOCK");
  if (blocked)
    throw new AppError("BUDGET_EXCEEDED", `This order would go over the budget "${blocked.name}" (${blocked.spent} € of ${blocked.amount} € used, this order ${blocked.adding} €). Ask a manager to raise it.`, 422, { budget: blocked.name, spent: blocked.spent, amount: blocked.amount, adding: blocked.adding });
  // The buyer's own approval rules (Phase 26): a matching order waits for a manager instead.
  if (!input.approved) {
    const { approvalNeeded, requestApproval, APPROVE } = await import("@/server/buying/approvals");
    const reasons = await approvalNeeded(ctx, pc);
    if (!can(ctx, APPROVE)) for (const b of budgets.filter((x) => x.exceeded && x.action === "APPROVAL")) reasons.push(`Budget: ${b.name} (${b.projected} € / ${b.amount} €)`);
    if (reasons.length) return requestApproval(ctx, { input: { ...input, poReference }, cart, gross: pc.grandTotal, reasons });
  }
  // Phase 43: licensed goods — licence, country restriction, quantity cap (checked again here: the cart may be old)
  await (await import("@/server/excise/service")).assertItems(ctx.company.id, pc.parts.flatMap((p) => p.lines.map((l) => ({ offerId: l.item.offerId, qty: l.item.qty }))));
  const checkoutId = randomUUID();
  // FIRINGI's risk checks on the whole checkout: HIGH → held for review before the suppliers see it.
  const { assessCheckout, recordRisk, afterCheckout } = await import("@/server/risk/service");
  const risk = input.handover ? { score: 0, level: "LOW" as const, reasons: [] } : await assessCheckout(ctx, { gross: pc.grandTotal.toNumber(), goods: pc.goodsNet.toNumber(), addressId: address.id, couponCode: pc.coupon?.ok ? pc.coupon.code : null });
  const deliveryAddress = {
    id: address.id, label: address.label, line1: address.line1, line2: address.line2, postalCode: address.postalCode, city: address.cityName,
    regionId: address.city?.regionId ?? null, country: address.country.code, contactName: address.contactName, phone: address.phone,
    latitude: address.latitude?.toString() ?? null, longitude: address.longitude?.toString() ?? null,
  };

  // Phase 50: pay later — the model (gateway partner / FIRINGI's own credit) is decided before anything is created
  const payLater = input.payLater?.termId ? await (await import("@/server/pay-later/service")).preparePayLater(ctx, input.payLater.termId, pc.grandTotal.toNumber()) : null;
  let payFirstOrders = false;
  const loyaltyShares: { orderId: string; number: string; euros: Decimal; points: number }[] = [];
  const created = await prisma.$transaction(async (tx) => {
    // Credit control on the whole checkout: overdue invoices / credit limit (Payment Settings).
    if (!input.handover?.paidNow) await assertCanOrder(ctx.company.id, pc.grandTotal);
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
          number, flow, buyerCompanyId: ctx.company.id, sellerCompanyId: sellerId, placedByUserId: ctx.user.id, countryId: ctx.company.countryId, groupRoundId: input.groupRoundId ?? null,
          // Phase 62: the supplier's sales rep for this customer (commission), whatever the channel
          salesRepId: await (await import("@/server/salesreps/service")).repFor(tx, sellerId, ctx.company.id),
          status: "NEW", deliveryMode: decision.mode, deliveryRuleId: decision.ruleId, smallOrder: !!decision.small, checkoutId: pc.parts.length > 1 ? checkoutId : null,
          couponCode: pc.coupon?.ok ? pc.coupon.code : null, deliveryDiscountNet: part.waived.toFixed(2), deliveryPromotionId: part.deliveryPromotionId,
          deliveryAddress, requestedDeliveryDate: input.requestedDeliveryDate ?? null, buyerNotes: input.notes?.trim() || null,
          branchId: stamp.branchId, costCentre: stamp.costCentre, poReference,
          listNet: totals.listNet.toFixed(2), discountTotal: totals.discountTotal.toFixed(2), deliveryFeeNet: totals.deliveryFeeNet.toFixed(2),
          netTotal: totals.netTotal.toFixed(2), vatTotal: totals.vatTotal.toFixed(2), grandTotal: totals.grandTotal.toFixed(2),
          commissionTotal: totals.commissionTotal.toFixed(2), vendorPayableNet: totals.vendorPayableNet.toFixed(2), firingiMarginNet: totals.firingiMarginNet.toFixed(2),
        },
      });
      if (input.handover) await tx.order.update({ where: { id: order.id }, data: { sourceAddressId: input.handover.warehouseId } }).then((o) => (order.sourceAddressId = o.sourceAddressId));
      for (const l of part.lines) {
        const res = input.handover ? { ok: true as const, addressId: input.handover.warehouseId, available: 0 } : await reserveStock(tx, order.id, l.item.offerId, l.item.qty);
        if (!res.ok) {
          const name = l.item.name.pt ?? l.item.name.en;
          throw new AppError("OUT_OF_STOCK", `Only ${res.available} available of "${name}". Please change the quantity.`, 409);
        }
        if (!order.sourceAddressId) await tx.order.update({ where: { id: order.id }, data: { sourceAddressId: res.addressId } }).then((o) => (order.sourceAddressId = o.sourceAddressId));
        await tx.orderLine.create({
          data: {
            orderId: order.id, offerId: l.item.offerId, productName: l.item.name, sku: l.item.sku, packagingName: l.item.packaging.name, qtyOrdered: l.item.qty,
            unitListPriceNet: l.calc.unitListPriceNet.toFixed(4),
            vendorDiscountNet: l.deal ? l.calc.vendorFundedDiscount.toFixed(4) : l.discounts.filter((x) => x.ownerType === "VENDOR").reduce((a, x) => a.plus(x.perUnit), new Decimal(0)).toFixed(4),
            adminDiscountNet: l.discounts.filter((x) => x.ownerType === "ADMIN").reduce((a, x) => a.plus(x.perUnit), new Decimal(0)).toFixed(4),
            firingiFundedDiscount: l.calc.firingiFundedDiscount.toFixed(4), vendorFundedDiscount: l.calc.vendorFundedDiscount.toFixed(4),
            unitSalePriceNet: l.calc.unitSalePriceNet.toFixed(4), taxRate: l.rate.toFixed(3), lineNet: l.calc.lineNet.toFixed(2), lineVat: l.calc.lineVat.toFixed(2),
            commissionRuleId: commission.id, commissionType: commission.type, commissionRate: l.deal?.commissionPct != null ? l.deal.commissionPct.toFixed(3) : commission.rate, commissionBase: l.calc.commissionBase.toFixed(2),
            dealId: l.deal?.dealId ?? null, dealBidId: l.deal?.bidId ?? null,
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
      // Phase 40: returnables on this order (deposits, empties to swap for refills)
      {
        const rt = await import("@/server/returnables/service");
        const plan = rt.swapPlanFor((cart as { emptySwaps?: unknown }).emptySwaps, sellerId) ?? (await rt.defaultSwaps(tx, ctx.company.id, sellerId));
        await rt.attachToOrder(tx, order.id, plan);
      }
      // Phase 41: sold-by-weight lines keep their weight rules (nominal kg, over-weight limit)
      await (await import("@/server/catchweight/service")).attachToOrder(tx, order.id);
      // Phase 42: chilled / frozen lines keep their temperature class
      await (await import("@/server/coldchain/service")).attachToOrder(tx, order.id);
      // Phase 43: excise category, mode and duty per unit on each line; the order's excise totals
      await (await import("@/server/excise/service")).attachToOrder(tx, order.id);
      // Phase 45: the customer's currency and rate are locked now (a fixed local price list's price is kept exactly)
      await (await import("@/server/currency/documents")).lockOrderCurrency(tx, order.id, new Map(part.lines.filter((l) => l.item.price?.fixedLocal).map((l) => [l.item.offerId, { code: l.item.price!.fixedLocal!.code, listEur: l.calc.unitListPriceNet.toFixed(4), listLocal: l.item.price!.fixedLocal!.unitNet }])));
      // Phase 48: free goods from rebate & bonus deals are used up
      {
        const all = part.lines.flatMap((l) => l.item.freeGoods?.grants ?? []);
        const { isRewardGrant, consumeRewardGoods } = await import("@/server/rewards/service");
        const grants = all.filter((g) => !isRewardGrant(g.id)), rewards = all.filter((g) => isRewardGrant(g.id));
        if (grants.length) await (await import("@/server/rebates/service")).consumeFreeGoods(tx, order.id, grants);
        // Phase 55: reward products redeemed in the rewards shop are used up
        if (rewards.length) await consumeRewardGoods(tx, order.id, rewards);
      }
      // Phase 38: lots sold out, accepted offers used
      if (part.lines.some((l) => l.deal)) await (await import("@/server/deals/service")).afterDealOrder(tx, order.id);
      // Phase 32: the points behind this order's share of the points discount
      if (pc.loyalty && pc.loyalty.used > 0) {
        const { LOYALTY_PROMOTION_ID } = await import("@/server/loyalty/service");
        const off = part.lines.reduce((a, l) => a.plus(l.discounts.filter((d) => d.promotionId === LOYALTY_PROMOTION_ID).reduce((x, d) => x.plus(d.perUnit.mul(l.item.qty)), new Decimal(0))), new Decimal(0));
        const share = pc.loyalty.euros.gt(0) ? Math.round(pc.loyalty.used * off.div(pc.loyalty.euros).toNumber()) : 0;
        loyaltyShares.push({ orderId: order.id, number, euros: off.toDecimalPlaces(2), points: share });
        // spent below, once all orders exist (the shares add up to exactly the points used)
      }
      await tx.orderStatusHistory.create({ data: { orderId: order.id, toStatus: "NEW", byUserId: ctx.user.id, reason: "Order placed" } });
      await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "order.placed", entityType: "Order", entityId: order.id, after: { number, sellerId, grandTotal: totals.grandTotal.toFixed(2), deliveryMode: decision.mode, coupon: pc.coupon?.ok ? pc.coupon.code : null, checkout: pc.parts.length > 1 ? checkoutId : null } }, tx);
      out.push({ id: order.id, number, sellerId });
    }
    // A coupon that has reached a limit while this checkout was being placed is refused.
    if (pc.coupon?.ok) await assertCouponLimits(tx, pc.coupon.code, ctx.company.id);
    // Phase 32: spend the points (refused if the balance changed meanwhile — nothing is placed then)
    if (pc.loyalty && pc.loyalty.used > 0) {
      const { spendPoints } = await import("@/server/loyalty/service");
      const diff = pc.loyalty.used - loyaltyShares.reduce((a, x) => a + x.points, 0);
      if (loyaltyShares.length) loyaltyShares[loyaltyShares.length - 1].points += diff;
      for (const x of loyaltyShares) if (x.points > 0)
        await spendPoints(tx, ctx.company.id, { kind: "REDEEM_ORDER", points: x.points, orderId: x.orderId, euros: x.euros, note: `Order ${x.number}`, createdById: ctx.user.id });
    }
    // The orders go to the suppliers for confirmation — unless FIRINGI's risk check holds them, or
    // this buyer pays before shipping (then they wait, unseen by the supplier, until paid).
    if (payLater) await (await import("@/server/pay-later/service")).createPlans(tx, ctx, payLater, out.map((o) => o.id));
    // Phase 51: each order's estimated footprint (products, packaging, delivery)
    for (const o of out) await (await import("@/server/co2/service")).stampOrder(tx, o.id);
    const held = await recordRisk(tx, risk, out.map((o) => ({ id: o.id, buyerCompanyId: ctx.company.id })), pc.parts.length > 1 ? checkoutId : null);
    // paying later (partner pays FIRINGI / FIRINGI's credit) replaces paying before shipping
    const payFirst = !payLater && !input.handover && (await tx.company.findUniqueOrThrow({ where: { id: ctx.company.id }, select: { payBeforeShipping: true } })).payBeforeShipping;
    for (const o of out) {
      const to = held || payFirst ? "ON_HOLD" : "PENDING_CONFIRMATION";
      // Phase 41: pay-before-shipping buyers also pay a buffer on sold-by-weight lines (unused part stays as credit)
      const buffer = payFirst ? await (await import("@/server/catchweight/service")).prepayBufferFor(tx, o.id) : new Decimal(0);
      await tx.order.update({ where: { id: o.id }, data: { status: to, awaitingPayment: payFirst, prepayBuffer: buffer.toFixed(2) } });
      await tx.orderStatusHistory.create({ data: { orderId: o.id, fromStatus: "NEW", toStatus: to, reason: held ? `Held for a check by FIRINGI (risk ${risk.score})` : payFirst ? "Waiting for payment" : input.handover ? input.handover.reason ?? "Handed over on the spot" : "Sent to supplier" } });
      await (await import("@/server/integrations/webhooks")).emitOrderEvents(tx, o.id, { from: "NEW", to, placed: true });
    }
    payFirstOrders = payFirst;
    if (!input.items) {
      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
      await tx.cart.update({ where: { id: cart.id }, data: { couponCode: null, loyaltyPoints: 0, emptySwaps: Prisma.DbNull } });
    }
    return out;
  });
  const buyerName = ctx.company.tradeName ?? ctx.company.legalName;
  await afterCheckout(risk, created, ctx.company.id, buyerName);
  await budgetAlertsAfterOrder(ctx.company.id, stamp.branchId).catch(() => null);
  if (payFirstOrders)
    for (const o of created) {
      const row = await prisma.order.findUniqueOrThrow({ where: { id: o.id }, select: { grandTotal: true, prepayBuffer: true } });
      await notify("order.awaiting_payment", [{ companyId: ctx.company.id, link: `/buy/orders/${o.id}` }], { number: o.number, total: row.grandTotal.plus(row.prepayBuffer).toNumber() }, { ref: { type: "Order", id: o.id } });
    }
  if (input.handover) return { id: created[0].id, number: created[0].number, orders: created.map((o) => ({ id: o.id, number: o.number })) };
  if (risk.level === "HIGH" || payFirstOrders) return { id: created[0].id, number: created[0].number, orders: created.map((o) => ({ id: o.id, number: o.number })), payFirst: payFirstOrders };
  for (const o of created) {
    const row = await prisma.order.findUniqueOrThrow({ where: { id: o.id }, select: { grandTotal: true } });
    await notify("order.new", [{ companyId: o.sellerId, link: `/vendor/orders/${o.id}` }], { number: o.number, buyer: buyerName, total: row.grandTotal.toNumber() }, { ref: { type: "Order", id: o.id } });
  }
  return { id: created[0].id, number: created[0].number, orders: created.map((o) => ({ id: o.id, number: o.number })) };
}

// ── viewing ─────────────────────────────────────────────────────────────────

export type OrderRole = "BUYER" | "VENDOR" | "ADMIN";

/** Which side the caller is on for this order (or null = may not see it). */
export async function roleFor(ctx: Ctx, order: { buyerCompanyId: string; sellerCompanyId: string; status?: OrderStatus; branchId?: string | null }): Promise<OrderRole | null> {
  if (ctx.company.id === order.buyerCompanyId && can(ctx, ["buyer.orders.view", "buyer.orders.place"])) {
    // Phase 27: branch staff see their own branches' orders only
    const { branchScope } = await import("@/server/multisite/branches");
    const s = await branchScope(ctx);
    if (s && (order.branchId === undefined || !order.branchId || !s.includes(order.branchId))) return null;
    return "BUYER";
  }
  // A held order isn't the supplier's yet: FIRINGI checks it first.
  if (ctx.company.id === order.sellerCompanyId && order.status !== "ON_HOLD" && can(ctx, ["vendor.orders.view", "vendor.orders.manage"])) return "VENDOR";
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
      branch: { select: { name: true } },
      sourceAddress: true,
      lines: { orderBy: { id: "asc" } },
      statusHistory: { orderBy: { at: "asc" } },
      exceptions: { orderBy: { createdAt: "desc" } },
      parentOrder: { select: { id: true, number: true, seller: { select: { id: true, legalName: true, tradeName: true } } } },
      childOrders: { select: { id: true, number: true, status: true, placedAt: true, seller: { select: { id: true, legalName: true, tradeName: true } } }, orderBy: { placedAt: "asc" } },
    },
  });
  if (!order) throw new NotFoundError("Order");
  const role = await roleFor(ctx, order);
  if (!role) throw new NotFoundError("Order"); // don't reveal other companies' orders
  const actors = new Map((await prisma.user.findMany({ where: { id: { in: order.statusHistory.map((h) => h.byUserId).filter(Boolean) as string[] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const settings = await platformSettings();
  const allowed = allowedTransitions(ctx, role, order.status, order.deliveryMode).filter((s) => !(role === "BUYER" && s === "CANCELLED" && !settings.buyerCanCancel));
  // Phase 45: the customer doesn't see the reference rate / FX margin / the supplier's rate; the supplier not the customer's
  const hide = role === "BUYER" ? ["midRate", "fxMarginPct", "vendorRate", "vendorCurrencyCode", "fxRate"] : role === "VENDOR" ? ["eurRate", "midRate", "fxMarginPct", "fxRate", "netTotalLocal", "vatTotalLocal", "grandTotalLocal"] : [];
  for (const k of hide) delete (order as Record<string, unknown>)[k];
  if (role === "VENDOR") for (const l of order.lines) for (const k of ["unitPriceLocal", "lineNetLocal", "lineVatLocal"]) delete (l as Record<string, unknown>)[k];
  if (role === "BUYER") {
    // the buyer sees FIRINGI (ordered from FIRINGI) or the name FIRINGI shows for the supplier ("FIRINGI <area>")
    const named = await (await import("@/server/catalogue/cart-help")).supplierNamer(ctx);
    const show = (id: string, c: { legalName: string; tradeName: string | null }) => { const n = order.routedByFiringi ? "FIRINGI" : named(id, c.tradeName ?? c.legalName); c.legalName = n; c.tradeName = n; };
    show(order.seller.id, order.seller);
    if (order.parentOrder) show(order.parentOrder.seller.id, order.parentOrder.seller);
    for (const c of order.childOrders) show(c.seller.id, c.seller);
  }
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

export type OrderListFilter = { statuses?: OrderStatus[]; q?: string; page?: number; pageSize?: number; since?: Date; sellerType?: "DISTRIBUTOR" | "WHOLESALER"; withOpenExceptions?: boolean };

export async function listOrders(ctx: Ctx, as: OrderRole, f: OrderListFilter = {}) {
  let where: Prisma.OrderWhereInput;
  if (as === "BUYER") {
    if (!can(ctx, ["buyer.orders.view", "buyer.orders.place"])) throw new ForbiddenError();
    const { orderScopeWhere } = await import("@/server/multisite/branches");
    where = { buyerCompanyId: ctx.company.id, ...(await orderScopeWhere(ctx)) };
  } else if (as === "VENDOR") {
    if (!can(ctx, ["vendor.orders.view", "vendor.orders.manage"])) throw new ForbiddenError();
    where = { sellerCompanyId: ctx.company.id, status: { not: "ON_HOLD" } };
  } else {
    if (ctx.company.type !== "ADMIN" || !can(ctx, ["admin.orders.view", "admin.orders.manage"])) throw new ForbiddenError();
    where = { buyer: scopeWhere(ctx) };
  }
  const page = Math.max(1, f.page ?? 1);
  const size = Math.min(500, Math.max(1, f.pageSize ?? 50));
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
      omit: as === "BUYER" ? BUYER_HIDDEN : as === "VENDOR" ? VENDOR_HIDDEN : undefined,
      include: { buyer: { select: { legalName: true, tradeName: true } }, seller: { select: { legalName: true, tradeName: true, type: true } }, _count: { select: { lines: true, exceptions: { where: { isResolved: false } } } } },
      orderBy: { placedAt: "desc" },
      skip: (page - 1) * size,
      take: size,
    }),
    prisma.order.count({ where: full }),
  ]);
  // Ordered from FIRINGI: the buyer's supplier is FIRINGI, not the wholesaler it picked.
  const named = as === "BUYER" ? await (await import("@/server/catalogue/cart-help")).supplierNamer(ctx) : null;
  const shown = as === "BUYER" ? rows.map((o) => (o.routedByFiringi ? { ...o, seller: { legalName: "FIRINGI", tradeName: "FIRINGI", type: "ADMIN" as const } }
    : ((n) => (n === (o.seller.tradeName ?? o.seller.legalName) ? o : { ...o, seller: { ...o.seller, legalName: n, tradeName: n } }))(named!(o.sellerCompanyId, o.seller.tradeName ?? o.seller.legalName)))) : rows;
  return { rows: shown, total, page, pageCount: Math.max(1, Math.ceil(total / size)) };
}

/** Order fields a buyer must not see (FIRINGI's commission, the supplier's payout and currency, FIRINGI's margin). */
/** Order fields a supplier must not see (FIRINGI's margin). */
/** Phase 45: nor the customer's rate, FX margin and local totals (FIRINGI's margin on the conversion). */
const VENDOR_HIDDEN = { firingiMarginNet: true, eurRate: true, midRate: true, fxMarginPct: true, fxRate: true, netTotalLocal: true, vatTotalLocal: true, grandTotalLocal: true } as const;
/** Phase 45: a buyer sees its own rate (eurRate) but not the reference rate / FX margin behind it, nor the supplier's. */
const BUYER_HIDDEN = { commissionTotal: true, vendorPayableNet: true, firingiMarginNet: true, vendorCurrencyCode: true, fxRate: true, deliveryRuleId: true, sourceAddressId: true, midRate: true, fxMarginPct: true, vendorRate: true } as const;

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
  await prisma.$transaction(async (tx) => {
    await applyOrderTransition(tx, order, to, { reason, userId: ctx.user.id, companyId: ctx.company.id });
    // A held order released or cancelled by FIRINGI: its risk check is reviewed.
    if (order.status === "ON_HOLD" && actor === "ADMIN")
      await tx.riskAssessment.updateMany({ where: { orderId, review: "OPEN" }, data: { review: to === "CANCELLED" ? "FRAUD" : "CLEARED", reviewedById: ctx.user.id, reviewedAt: new Date(), note: reason?.trim() || null } });
  });
  if (to === "DELIVERED") (await import("@/server/invoicing/fiscal")).kickFiscalQueue(); // send the invoice to Moloni now (the cron retries)
  if (to === "DELIVERED") await (await import("@/server/loyalty/service")).earnForOrder(orderId).catch(() => null); // Phase 32: loyalty points (the job retries)
  if (to === "CANCELLED") await (await import("@/server/loyalty/service")).refundForOrder(orderId).catch(() => null); // Phase 32: points spent on it go back
  if (to === "CANCELLED") await (await import("@/server/rebates/service")).restoreFreeGoods(orderId).catch(() => null); // Phase 48: free goods taken on it go back
  if (to === "CANCELLED") await (await import("@/server/rewards/service")).restoreRewardGoods(orderId).catch(() => null); // Phase 55: reward products taken on it go back
  // Cancelled before delivery: a prepayment paid online goes back to the customer.
  if (to === "CANCELLED") await (await import("@/server/payments/service")).refundOrderPrepayment(orderId).catch(() => null);
  await (await import("@/server/whatsapp/ordering")).orderStatusChanged(orderId, to).catch(() => null); // Phase 58: WhatsApp orders hear back there
  if (order.status === "ON_HOLD") return notifyHoldDecision(order, to, reason, actor);
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
  // Leaving the hold for the supplier (FIRINGI's decision, or paid): nothing is awaited any more.
  const res = await tx.order.updateMany({ where: { id: order.id, status: order.status }, data: { status: to, ...(order.status === "ON_HOLD" && to === "PENDING_CONFIRMATION" ? { awaitingPayment: false } : {}) } });
  if (res.count !== 1) throw new AppError("CONFLICT", "The order was changed by someone else. Please reload.", 409);
  if (to === "CANCELLED") {
    await releaseStock(tx, order.id);
    await restockShipped(tx, order.id); // cancelled after dispatch: goods go back on hand
  }
  if (to === "DISPATCHED") {
    await (await import("@/server/catchweight/service")).assertWeighedForDispatch(tx, order.id); // Phase 41 (when FIRINGI requires it)
    await shipStock(tx, order.id); // no-op when already shipped (retry after a failed attempt)
  }
  if (to === "DELIVERED") {
    // Delivered = what was confirmed. FIRINGI invoices the buyer and tells the vendor what to invoice.
    for (const l of order.lines) await tx.orderLine.update({ where: { id: l.id }, data: { qtyDelivered: l.qtyConfirmed ?? l.qtyOrdered } });
    // Phase 41: sold-by-weight lines are billed on their weight (capped by the over-weight limit unless accepted)
    await (await import("@/server/catchweight/service")).repriceOrder(tx, order.id);
    await invoiceDeliveredOrder(tx, order.id, by.userId);
    // goods bought on FIRINGI with a best-before date: the basis of the buyer's expiry alerts
    await recordPurchasedLots(tx, order.id);
    // A prepayment (or other customer credit) pays the new invoice at once.
    const { applyCustomerCredit } = await import("@/server/payments/service");
    await applyCustomerCredit(tx, order.buyerCompanyId);
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
  await (await import("@/server/integrations/webhooks")).emitOrderEvents(tx, order.id, { from: order.status, to, reason });
  await writeAudit({ actorUserId: by.userId, actorCompanyId: by.companyId, action: `order.status.${to.toLowerCase()}`, entityType: "Order", entityId: order.id, before: { status: order.status }, after: { status: to, reason } }, tx);
}

/** A held order released (→ supplier gets it, buyer told) or cancelled (only the buyer is told). */
export async function notifyHoldDecision(order: Pick<OrderForChange, "id" | "number" | "buyerCompanyId" | "sellerCompanyId">, to: OrderStatus, reason: string | null | undefined, actor: Actor) {
  if (to === "PENDING_CONFIRMATION") {
    const o = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: { grandTotal: true, buyer: { select: { legalName: true, tradeName: true } }, seller: { select: { legalName: true, tradeName: true } } } });
    await notify("order.new", [{ companyId: order.sellerCompanyId, link: `/vendor/orders/${order.id}` }], { number: order.number, buyer: o.buyer.tradeName ?? o.buyer.legalName, total: o.grandTotal.toNumber() }, { ref: { type: "Order", id: order.id } });
    await notify("order.released", [{ companyId: order.buyerCompanyId, link: `/buy/orders/${order.id}` }], { number: order.number, supplier: o.seller.tradeName ?? o.seller.legalName }, { ref: { type: "Order", id: order.id } });
  } else if (to === "CANCELLED" && actor !== "BUYER") {
    await notify("order.cancelled", [{ companyId: order.buyerCompanyId, link: `/buy/orders/${order.id}` }], { number: order.number, reason: reason ?? "" }, { ref: { type: "Order", id: order.id } });
  }
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
        commissionUnitBase: line.dealId ? line.unitListPriceNet.minus(line.vendorFundedDiscount).toString() : null,
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
    await (await import("@/server/returnables/service")).attachToOrder(tx, orderId); // Phase 40: confirmed quantities carry the returnables
    await (await import("@/server/excise/service")).refreshOrder(tx, orderId); // Phase 43: excise follows the confirmed quantities
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
    await (await import("@/server/currency/documents")).syncOrderLocal(tx, orderId);
    await syncRedemptions(tx, orderId);
    await ensureDelivery(tx, orderId);
    const short = confirmed.filter((c) => c.qty < c.line.qtyOrdered).length;
    await tx.orderStatusHistory.create({ data: { orderId, fromStatus: order.status, toStatus: "SUPPLIER_PROCESSING", byUserId: ctx.user.id, reason: short ? `Confirmed with ${short} line(s) reduced` : "Confirmed" } });
    await (await import("@/server/integrations/webhooks")).emitOrderEvents(tx, orderId, { from: order.status, to: "SUPPLIER_PROCESSING", reason: short ? "short" : null });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "order.confirmed", entityType: "Order", entityId: orderId, after: { quantities: Object.fromEntries(confirmed.map((c) => [c.line.id, c.qty])) } }, tx);
  });
  const seller = await prisma.company.findUniqueOrThrow({ where: { id: order.sellerCompanyId }, select: { legalName: true, tradeName: true } });
  await notify("order.confirmed", [{ companyId: order.buyerCompanyId, link: `/buy/orders/${orderId}` }], { number: order.number, supplier: seller.tradeName ?? seller.legalName }, { ref: { type: "Order", id: orderId } });
  await (await import("@/server/whatsapp/ordering")).orderStatusChanged(orderId, "SUPPLIER_PROCESSING").catch(() => null); // Phase 58
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

/**
 * Order split: checkouts that became several orders (a cart from several suppliers, or FIRINGI's
 * split across wholesalers), and orders FIRINGI moved on to other suppliers. Last 90 days.
 */
export async function splitOrders(ctx: Ctx) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, ["admin.orders.view", "admin.orders.manage"])) throw new ForbiddenError();
  const since = new Date(Date.now() - 90 * 86400_000);
  const scope = { buyer: scopeWhere(ctx) };
  const select = { id: true, number: true, status: true, grandTotal: true, placedAt: true, checkoutId: true, routedByFiringi: true, buyer: { select: { legalName: true } }, seller: { select: { legalName: true } } } as const;
  const grouped = await prisma.order.groupBy({ by: ["checkoutId"], where: { checkoutId: { not: null }, placedAt: { gte: since }, ...scope }, _count: { _all: true }, having: { checkoutId: { _count: { gt: 1 } } } });
  const orders = await prisma.order.findMany({ where: { checkoutId: { in: grouped.map((g) => g.checkoutId!) } }, select, orderBy: { number: "asc" } });
  const checkouts = grouped.map((g) => {
    const os = orders.filter((o) => o.checkoutId === g.checkoutId);
    return { checkoutId: g.checkoutId!, buyer: os[0]?.buyer.legalName ?? "", placedAt: os[0]?.placedAt ?? null, routed: os.some((o) => o.routedByFiringi), orders: os, total: os.reduce((a, o) => a + Number(o.grandTotal), 0) };
  }).sort((a, b) => (b.placedAt?.getTime() ?? 0) - (a.placedAt?.getTime() ?? 0));
  const moved = await prisma.order.findMany({
    where: { childOrders: { some: {} }, placedAt: { gte: since }, ...scope }, orderBy: { placedAt: "desc" }, take: 100,
    select: { ...select, childOrders: { select } },
  });
  return { checkouts, moved };
}
