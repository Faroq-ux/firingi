/**
 * "Order from FIRINGI" (countries in FIRINGI ordering mode, customers only).
 * The customer sees one FIRINGI price per product and checks out one cart; FIRINGI picks
 * the wholesaler(s) — nearest or cheapest (rules), or its in-house warehouse — and creates
 * one order per supplier. The customer never pays more than the price shown.
 * Delivery: supplier delivers free when its goods reach its free-delivery minimum; otherwise
 * FIRINGI's fleet at FIRINGI's flat fee, charged once per checkout.
 */
import type { Prisma } from "@prisma/client";
import Decimal from "decimal.js";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { AppError, ValidationError } from "@/server/errors";
import { pricedOffers } from "@/server/data/catalogue-buyer";
import { vatRate } from "@/server/services/orders";
import { deliveryRulesFor } from "@/server/services/cart";
import { writeAudit } from "@/server/services/audit";
import { assertCanOrder } from "@/server/services/payments";
import { notify } from "@/server/notify/dispatch";
import { allocationRules } from "./rules";
import { vendorMinimumReached } from "@/server/orders/delivery-rule";
import { createAllocatedOrder, findCandidates, planMoves, type Candidate, type MoveItem } from "./engine";

export { orderingMode } from "./mode";

type CartLine = { offerId: string; qty: number };

/** Turn cart lines into items FIRINGI must source, with the price the buyer saw as the ceiling. */
async function itemsFor(ctx: Ctx, lines: CartLine[], regionId: string | null) {
  const { items, unavailable } = await pricedOffers(ctx, lines);
  if (unavailable.length || items.some((i) => !i.price)) throw new AppError("ITEM_UNAVAILABLE", "Some products in your cart are no longer available. Please review your cart.", 409);
  const offers = await prisma.vendorOffer.findMany({ where: { id: { in: items.map((i) => i.offerId) } }, select: { id: true, packagingUnitId: true } });
  const pu = new Map(offers.map((o) => [o.id, o.packagingUnitId]));
  const out: MoveItem[] = [];
  for (const i of items)
    out.push({
      lineId: i.offerId, offerId: i.offerId, packagingUnitId: pu.get(i.offerId)!, qty: i.qty, name: i.name, sku: i.sku,
      unitSalePriceNet: i.price!.unitPriceNet, taxRate: (await vatRate(prisma, ctx.company.countryId, regionId, i.taxCategoryId)).toString(),
    });
  return out;
}

export type RoutedPlan = Awaited<ReturnType<typeof planRouted>>;

/** Which supplier(s) would deliver this cart to this address, and the delivery fee. */
export async function planRouted(ctx: Ctx, lines: CartLine[], addressId: string) {
  const address = await prisma.address.findFirst({ where: { id: addressId, companyId: ctx.company.id, isActive: true, kind: "DELIVERY", countryId: ctx.company.countryId }, include: { city: true } });
  if (!address) throw new ValidationError("Choose one of your delivery addresses.");
  const rules = await allocationRules();
  const items = await itemsFor(ctx, lines, address.city?.regionId ?? null);
  const cands = await findCandidates(
    { id: null, buyerCompanyId: ctx.company.id, countryId: ctx.company.countryId, flow: "CUSTOMER_FROM_WHOLESALER", addressId, buyer: ctx },
    items, rules, new Set(),
  );
  const { picks, leftover } = planMoves(cands, items.length, rules.maxSplitOrders);
  const firingi = (await deliveryRulesFor(ctx.company.countryId, "", addressId)).firingi;
  const goodsNet = picks.reduce((a, p) => a + p.covers.reduce((s, c) => s + Number(c.lineNet), 0), 0);
  // FIRINGI's fleet (flat fee, once) for every part that isn't delivered free by its supplier.
  const byFiringi = picks.some((p) => p.candidate.inHouse || !freeFor(p.candidate, p.covers));
  // FIRINGI's free delivery (admin switch, per country / zone) on the whole checkout, else its flat rate.
  const firingiFree = !!firingi?.firingiFreeEnabled && firingi.firingiFreeFrom != null && goodsNet >= Number(firingi.firingiFreeFrom);
  const feeNet = byFiringi && firingi && !firingiFree ? new Decimal(firingi.firingiDeliveryFeeNet?.toString() ?? 0) : new Decimal(0);
  const minimum = firingi?.minOrderValue ? Number(firingi.minOrderValue) : 0;
  return { address, items, candidates: cands, picks, leftover, goodsNet, feeNet, minimum, byFiringi, feeRuleId: firingi?.id ?? null, feeTaxCategoryId: firingi?.feeTaxCategoryId ?? null };
}

/** Does this pick reach the supplier's own free-delivery minimum? (In-house: FIRINGI's fleet.) */
function freeFor(c: Candidate, covers: { lineNet: string; qty: number }[]) {
  if (c.inHouse) return false;
  return vendorMinimumReached(c.deliveryRule, covers.reduce((a, x) => a + Number(x.lineNet), 0), covers.reduce((a, x) => a + x.qty, 0));
}

/** Check out a FIRINGI cart: one order per picked supplier. */
export async function placeRoutedOrder(ctx: Ctx, cart: { id: string; items: CartLine[] }, input: { deliveryAddressId: string; notes?: string | null; requestedDeliveryDate?: Date | null }) {
  const plan = await planRouted(ctx, cart.items, input.deliveryAddressId);
  if (plan.leftover.length) {
    const names = plan.leftover.map((i) => plan.items[i].name.pt ?? plan.items[i].name.en).join(", ");
    throw new AppError("NOT_AVAILABLE_HERE", `These products can't be delivered to this address right now: ${names}. Remove them or try another address.`, 409);
  }
  if (plan.goodsNet < plan.minimum)
    throw new AppError("BELOW_MINIMUM", `Minimum order for delivery is ${plan.minimum.toFixed(2)} € (excl. VAT). Add ${(plan.minimum - plan.goodsNet).toFixed(2)} € more.`, 422);
  const a = plan.address;
  const base = {
    flow: "CUSTOMER_FROM_WHOLESALER" as const, buyerCompanyId: ctx.company.id, countryId: ctx.company.countryId, placedByUserId: ctx.user.id,
    deliveryAddress: {
      id: a.id, label: a.label, line1: a.line1, line2: a.line2, postalCode: a.postalCode, city: a.cityName, regionId: a.city?.regionId ?? null,
      country: ctx.company.countryCode, contactName: a.contactName, phone: a.phone, latitude: a.latitude?.toString() ?? null, longitude: a.longitude?.toString() ?? null,
    } as Prisma.JsonValue,
    requestedDeliveryDate: input.requestedDeliveryDate ?? null, buyerNotes: input.notes?.trim() || null, deliveryRuleId: plan.feeRuleId,
    parentOrderId: null, routedByFiringi: true,
  };
  // The flat fee goes on the first order FIRINGI's fleet delivers.
  const feeIdx = plan.picks.findIndex((p) => p.candidate.inHouse || !freeFor(p.candidate, p.covers));
  const created = await prisma.$transaction(async (tx) => {
    const out = [];
    for (const [i, p] of plan.picks.entries())
      out.push(await createAllocatedOrder(tx, base, p.candidate.vendorId, plan.items, p.covers, i === feeIdx ? plan.feeNet : new Decimal(0), "Ordered from FIRINGI", ctx.user.id));
    // Credit control on the whole checkout (rolls everything back when blocked).
    const gross = (await tx.order.findMany({ where: { id: { in: out.map((o) => o.orderId) } }, select: { grandTotal: true } })).reduce((a, o) => a.plus(o.grandTotal.toString()), new Decimal(0));
    await assertCanOrder(ctx.company.id, gross);
    await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "order.placed", entityType: "Order", entityId: out[0].orderId, after: { routed: true, orders: out.map((o) => ({ number: o.number, vendorId: o.vendorId, mode: o.mode })) } }, tx);
    return out;
  });
  const buyer = ctx.company.tradeName ?? ctx.company.legalName;
  for (const c of created) {
    const o = await prisma.order.findUniqueOrThrow({ where: { id: c.orderId }, select: { grandTotal: true } });
    await notify("order.new", [{ companyId: c.vendorId, link: `/vendor/orders/${c.orderId}` }], { number: c.number, buyer, total: o.grandTotal.toNumber() }, { ref: { type: "Order", id: c.orderId } });
  }
  return { id: created[0].orderId, number: created[0].number, orders: created.map((c) => ({ id: c.orderId, number: c.number })) };
}
