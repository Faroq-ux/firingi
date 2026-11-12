/**
 * Supplier allocation. The buyer chooses the supplier; when that supplier
 *   • declines the order (DECLINED),
 *   • confirms lower quantities (SHORTFALL), or
 *   • doesn't confirm within the response time (NO_RESPONSE),
 * FIRINGI moves the order — or only the missing items — to other suppliers that reach the
 * buyer, as new orders linked to the original (parentOrderId). The buyer keeps the original
 * price (never pays more; pays less if the new supplier is cheaper); FIRINGI absorbs the
 * difference as long as its margin on the moved goods stays above the floor in the rules.
 *
 * Candidates are filtered (type, approval, not excluded, coverage, distance, stock, daily
 * capacity, commission, margin floor) and scored (distance, price/margin, priority,
 * reliability, already delivering nearby, already has an open order for this buyer).
 * Every decision is an AllocationEvent; cases nobody can take wait in the Control Tower.
 */
import { Prisma, type AllocationStatus, type AllocationTrigger, type CompanyType, type DeliveryMode, type Order, type OrderFlow, type OrderLine } from "@prisma/client";
import Decimal from "decimal.js";
import { prisma, type Tx } from "@/server/db";
import { loadContext, type Ctx } from "@/server/context";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { can } from "@/server/rbac/guard";
import { pricedOffers } from "@/server/data/catalogue-buyer";
import { vendorReaches } from "@/server/delivery/coverage";
import { checkQty, computeLine, computeTotals } from "@/server/orders/calc";
import { activeCommission, applyOrderTransition, nextNumber, reserveStock, vatRate } from "@/server/services/orders";
import { deliveryRulesFor } from "@/server/services/cart";
import { vendorInput, vendorMinimumReached, type VendorRule } from "@/server/orders/delivery-rule";
import { pickRule } from "@/server/services/performance";

/** Categories (with their parents) of the products behind these packaging units. */
async function categoriesOf(packagingUnitIds: string[]) {
  const pus = await prisma.packagingUnit.findMany({ where: { id: { in: packagingUnitIds } }, select: { variant: { select: { product: { select: { categoryId: true } } } } } });
  const cats = await prisma.category.findMany({ select: { id: true, parentId: true } });
  const parent = new Map(cats.map((c) => [c.id, c.parentId]));
  const out = new Set<string>();
  for (const p of pus) for (let c: string | null | undefined = p.variant.product.categoryId; c; c = parent.get(c)) out.add(c);
  return [...out];
}
import { writeAudit } from "@/server/services/audit";
import { notify } from "@/server/notify/dispatch";
import { allocationRules, assertAllocationManager, distanceLimit, type AllocationRules } from "./rules";

type OrderWithLines = Order & { lines: OrderLine[] };

export type MoveItem = {
  lineId: string; offerId: string; packagingUnitId: string; qty: number;
  name: Record<string, string>; sku: string; unitSalePriceNet: string; taxRate: string;
};

export type CoveredItem = {
  index: number; offerId: string; qty: number; listUnitNet: string; vendorFunded: string; firingiFunded: string;
  saleUnitNet: string; candidateSaleUnitNet: string; lineNet: string; vendorLineNet: string; commissionRate: string;
};

export type Candidate = {
  vendorId: string; name: string; country: string; eligible: boolean; reasons: string[];
  /** FIRINGI's in-house warehouse. */ inHouse: boolean;
  /** Goods reach this supplier's free-delivery minimum. */ freeDelivery: boolean;
  /** The supplier's own free-delivery minimum (null = none; in-house = always FIRINGI's fleet). */ deliveryMinimum: number | null;
  /** The supplier's delivery rule (minimum by amount or units). */ deliveryRule: VendorRule;
  /** What the buyer would pay this supplier for the covered items (before FIRINGI's cap). */ buyerCost: number;
  /** Position after ranking (0 = first choice). */ rank: number;
  score: number; parts: Record<string, number>; distanceKm: number | null; marginPct: number | null;
  goodsNet: number; marginNet: number; absorbedNet: number; covers: CoveredItem[];
};

const OPEN: Prisma.OrderWhereInput["status"] = { in: ["PENDING_CONFIRMATION", "SUPPLIER_PROCESSING", "READY_FOR_PICKUP", "DISPATCHED", "OUT_FOR_DELIVERY"] };
const sellerTypeOf = (flow: Order["flow"]): CompanyType => (flow === "CUSTOMER_FROM_WHOLESALER" ? "WHOLESALER" : "DISTRIBUTOR");
const addressIdOf = (o: Order) => (o.deliveryAddress as { id?: string } | null)?.id ?? null;
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const round2 = (n: number) => Math.round(n * 100) / 100;

// ── what has to move ────────────────────────────────────────────────────────

export async function itemsToMove(order: OrderWithLines, trigger: AllocationTrigger): Promise<MoveItem[]> {
  const offers = await prisma.vendorOffer.findMany({ where: { id: { in: order.lines.map((l) => l.offerId) } }, select: { id: true, packagingUnitId: true } });
  const pu = new Map(offers.map((o) => [o.id, o.packagingUnitId]));
  const shortfall = trigger === "SHORTFALL" || (trigger === "MANUAL" && order.status !== "PENDING_CONFIRMATION" && order.status !== "CANCELLED");
  return order.lines
    .map((l) => ({
      lineId: l.id, offerId: l.offerId, packagingUnitId: pu.get(l.offerId)!, name: l.productName as Record<string, string>, sku: l.sku,
      qty: shortfall ? l.qtyOrdered - (l.qtyConfirmed ?? l.qtyOrdered) : l.qtyOrdered,
      unitSalePriceNet: l.unitSalePriceNet.toString(), taxRate: l.taxRate.toString(),
    }))
    .filter((i) => i.qty > 0);
}

/** Suppliers already tried for these items (the order chain) and how many moves happened. */
async function chainOf(order: Order) {
  const vendors = new Set<string>([order.sellerCompanyId]);
  let moves = 0;
  let cur: Pick<Order, "parentOrderId"> | null = order;
  while (cur?.parentOrderId) {
    const p: Pick<Order, "parentOrderId" | "sellerCompanyId"> | null = await prisma.order.findUnique({ where: { id: cur.parentOrderId }, select: { parentOrderId: true, sellerCompanyId: true } });
    if (!p) break;
    vendors.add(p.sellerCompanyId);
    moves++;
    cur = p;
  }
  return { vendors, moves };
}

/** The buyer's view of prices: the person who placed the order (or another buyer of the company). */
async function buyerCtx(order: Order): Promise<Ctx | null> {
  const direct = await loadContext(order.placedByUserId, "allocation", order.buyerCompanyId);
  if (direct && direct.company.id === order.buyerCompanyId && direct.permissions.has("buyer.catalogue.view")) return direct;
  const members = await prisma.membership.findMany({ where: { companyId: order.buyerCompanyId, status: "ACTIVE" }, select: { userId: true }, take: 20 });
  for (const m of members) {
    const c = await loadContext(m.userId, "allocation", order.buyerCompanyId);
    if (c && c.company.id === order.buyerCompanyId && c.permissions.has("buyer.catalogue.view")) return c;
  }
  return null;
}

// ── candidates ──────────────────────────────────────────────────────────────

/** Who the goods are for: an existing order (moves) or a new checkout. */
export type Target = { id: string | null; buyerCompanyId: string; countryId: string; flow: OrderFlow; addressId: string | null; buyer: Ctx | null };

export async function targetOf(order: Order): Promise<Target> {
  return { id: order.id, buyerCompanyId: order.buyerCompanyId, countryId: order.countryId, flow: order.flow, addressId: addressIdOf(order), buyer: await buyerCtx(order) };
}

/** Rank: eligible, most items covered, in-house policy, then nearest / cheapest, then score. */
export function rankCandidates(cands: Candidate[], rules: AllocationRules): Candidate[] {
  const base = [...cands].sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.covers.length - a.covers.length);
  const firstOutside = base.find((c) => c.eligible && !c.inHouse);
  const small = !!firstOutside && !firstOutside.freeDelivery;
  const inHouseFirst = rules.inHouse === "FIRST" || (rules.inHouse === "SMALL_ORDERS" && small);
  const primary = (a: Candidate, b: Candidate) =>
    rules.pickBy === "CHEAPEST" ? a.buyerCost - b.buyerCost : (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity);
  const sorted = [...cands].sort((a, b) =>
    Number(b.eligible) - Number(a.eligible) || b.covers.length - a.covers.length ||
    // In-house first when the policy says so; otherwise only as a fallback after the wholesalers.
    (inHouseFirst ? Number(b.inHouse) - Number(a.inHouse) : Number(a.inHouse) - Number(b.inHouse)) ||
    primary(a, b) || b.score - a.score);
  return sorted.map((c, i) => ({ ...c, rank: i }));
}

export async function findCandidates(target: Target, items: MoveItem[], rules: AllocationRules, exclude: Set<string>): Promise<Candidate[]> {
  const addressId = target.addressId;
  const sellerType = sellerTypeOf(target.flow);
  const vendors = await prisma.company.findMany({
    where: {
      type: sellerType, status: "APPROVED", id: { notIn: [...exclude] },
      // Wholesalers sell only inside their own country; distributors across FIRINGI's European markets.
      ...(sellerType === "WHOLESALER" ? { countryId: target.countryId } : {}),
      vendorOffers: { some: { status: "ACTIVE", packagingUnitId: { in: items.map((i) => i.packagingUnitId) } } },
    },
    select: { id: true, legalName: true, tradeName: true, countryId: true, isInHouse: true, country: { select: { code: true } }, allocationProfile: true },
  });
  if (!vendors.length || !addressId) return [];
  const ids = vendors.map((v) => v.id);
  // Margin rules (Pricing › Margin Rules): the most specific floor applies, else the allocation rules' minimum.
  const marginRules = await prisma.marginRule.findMany({ where: { isActive: true } });
  const itemCategories = marginRules.some((r) => r.scope === "CATEGORY") ? await categoriesOf(items.map((i) => i.packagingUnitId)) : [];
  const since90 = new Date(Date.now() - 90 * 86400_000);
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);

  const [distances, routes, sameBuyer, todayCounts, accepted, declined, buyer] = await Promise.all([
    prisma.$queryRaw<{ id: string; km: number }[]>`
      SELECT w."companyId" AS id, min(postgis.ST_Distance(w.geo, b.geo))::float8 / 1000 AS km
      FROM "Address" w, "Address" b
      WHERE b.id = ${addressId} AND b.geo IS NOT NULL AND w.geo IS NOT NULL AND w."isActive"
        AND w.kind IN ('WAREHOUSE', 'PICKUP') AND w."companyId" IN (${Prisma.join(ids)})
      GROUP BY 1`,
    rules.routeMatchKm > 0
      ? prisma.$queryRaw<{ id: string }[]>`
          SELECT DISTINCT o."sellerCompanyId" AS id FROM "Order" o, "Address" b
          WHERE b.id = ${addressId} AND b.geo IS NOT NULL AND o."sellerCompanyId" IN (${Prisma.join(ids)})
            AND o.status IN ('SUPPLIER_PROCESSING', 'READY_FOR_PICKUP', 'DISPATCHED', 'OUT_FOR_DELIVERY')
            AND (o."deliveryAddress"->>'latitude') IS NOT NULL AND (o."deliveryAddress"->>'longitude') IS NOT NULL
            AND postgis.ST_DWithin(
              postgis.ST_SetSRID(postgis.ST_MakePoint((o."deliveryAddress"->>'longitude')::float8, (o."deliveryAddress"->>'latitude')::float8), 4326)::postgis.geography,
              b.geo, ${rules.routeMatchKm * 1000})`
      : Promise.resolve([]),
    prisma.order.findMany({ where: { sellerCompanyId: { in: ids }, buyerCompanyId: target.buyerCompanyId, status: OPEN, ...(target.id ? { id: { not: target.id } } : {}) }, select: { sellerCompanyId: true }, distinct: ["sellerCompanyId"] }),
    prisma.order.groupBy({ by: ["sellerCompanyId"], where: { sellerCompanyId: { in: ids }, placedAt: { gte: dayStart }, status: { not: "CANCELLED" } }, _count: true }),
    prisma.$queryRaw<{ id: string; n: number }[]>`
      SELECT o."sellerCompanyId" AS id, count(DISTINCT o.id)::int AS n FROM "Order" o JOIN "OrderStatusHistory" h ON h."orderId" = o.id
      WHERE h."toStatus" = 'SUPPLIER_PROCESSING' AND o."placedAt" >= ${since90} AND o."sellerCompanyId" IN (${Prisma.join(ids)}) GROUP BY 1`,
    prisma.allocationEvent.groupBy({ by: ["fromVendorId"], where: { fromVendorId: { in: ids }, trigger: { in: ["DECLINED", "NO_RESPONSE"] }, createdAt: { gte: since90 } }, _count: true }),
    Promise.resolve(target.buyer),
  ]);
  const km = new Map(distances.map((d) => [d.id, Number(d.km)]));
  const onRoute = new Set(routes.map((r) => r.id));
  const hasOpen = new Set(sameBuyer.map((r) => r.sellerCompanyId));
  const today = new Map(todayCounts.map((r) => [r.sellerCompanyId, r._count]));
  const acc = new Map(accepted.map((r) => [r.id, Number(r.n)]));
  const dec = new Map(declined.map((r) => [r.fromVendorId, r._count]));

  const offers = await prisma.vendorOffer.findMany({
    where: { vendorCompanyId: { in: ids }, status: "ACTIVE", packagingUnitId: { in: items.map((i) => i.packagingUnitId) } },
    select: { id: true, vendorCompanyId: true, packagingUnitId: true },
  });
  // Price every candidate offer as the buyer would see it (visibility, price lists, promotions, stock).
  const priced = buyer ? await pricedOffers(buyer, offers.map((o) => ({ offerId: o.id, qty: items.find((i) => i.packagingUnitId === o.packagingUnitId)!.qty }))) : { items: [], unavailable: offers.map((o) => o.id) };
  const pricedById = new Map(priced.items.map((p) => [p.offerId, p]));
  const limitKm = distanceLimit(rules, target.countryId);
  const w = rules.weights;
  const wSum = Object.values(w).reduce((a, b) => a + b, 0) || 1;

  const out: Candidate[] = [];
  for (const v of vendors) {
    const reasons: string[] = [];
    const profile = v.allocationProfile;
    const crossBorder = v.countryId !== target.countryId;
    if (profile?.excluded) reasons.push("Excluded by FIRINGI");
    if (v.isInHouse && rules.inHouse === "OFF") reasons.push("In-house warehouse not used (rules)");
    if (crossBorder && sellerType === "WHOLESALER") reasons.push("Other country");
    if (!(await vendorReaches(v.id, addressId))) reasons.push("Doesn't deliver to this address");
    const d = km.get(v.id) ?? null;
    if (!crossBorder && d !== null && d > limitKm) reasons.push(`Too far (${Math.round(d)} km > ${limitKm} km)`);
    if (profile?.dailyOrderCapacity != null && (today.get(v.id) ?? 0) >= profile.dailyOrderCapacity) reasons.push(`Daily capacity reached (${profile.dailyOrderCapacity})`);
    const commission = await activeCommission(prisma, v.id);
    if (!commission) reasons.push("No commission agreement");

    const covers: CoveredItem[] = [];
    items.forEach((it, index) => {
      const offer = offers.find((o) => o.vendorCompanyId === v.id && o.packagingUnitId === it.packagingUnitId);
      const p = offer && pricedById.get(offer.id);
      if (!offer || !p?.price || p.available < it.qty || checkQty(it.qty, p.minOrderQty, p.qtyStep)) return;
      const list = new Decimal(p.price.listUnitNet);
      const vendorFunded = new Decimal(p.price.vendorFundedPerUnit);
      const candidateSale = list.minus(vendorFunded).minus(p.price.firingiFundedPerUnit);
      const sale = Decimal.min(new Decimal(it.unitSalePriceNet), candidateSale); // never more than agreed
      const c = computeLine({
        qty: it.qty, unitListPriceNet: list, vatRatePercent: it.taxRate, commissionRatePercent: commission?.rate.toString() ?? 0,
        vendorFundedDiscountPerUnit: vendorFunded, firingiFundedDiscountPerUnit: list.minus(vendorFunded).minus(sale),
      });
      covers.push({
        index, offerId: offer.id, qty: it.qty, listUnitNet: list.toFixed(4), vendorFunded: vendorFunded.toFixed(4), firingiFunded: c.firingiFundedDiscount.toFixed(4),
        saleUnitNet: sale.toFixed(4), candidateSaleUnitNet: candidateSale.toFixed(4), lineNet: c.lineNet.toFixed(2), vendorLineNet: c.vendorLineNet.toFixed(2),
        commissionRate: commission?.rate.toString() ?? "0",
      });
    });
    if (!covers.length) reasons.push("No stock or price for these items");

    const goodsNet = covers.reduce((a, c) => a + Number(c.lineNet), 0);
    const buyerCost = covers.reduce((a, c) => a + Number(c.candidateSaleUnitNet) * c.qty, 0);
    const vRule = vendorInput((await deliveryRulesFor(target.countryId, v.id)).vendor);
    const vendorMin = vRule?.kind === "AMOUNT" ? vRule.amount : null;
    const freeDelivery = !v.isInHouse && vendorMinimumReached(vRule, goodsNet, covers.reduce((a, c) => a + c.qty, 0));
    const marginNet = covers.reduce((a, c) => a + Number(c.lineNet) - Number(c.vendorLineNet), 0);
    const absorbedNet = covers.reduce((a, c) => a + Math.max(0, Number(c.candidateSaleUnitNet) - Number(c.saleUnitNet)) * c.qty, 0);
    const marginPct = goodsNet > 0 ? (marginNet / goodsNet) * 100 : null;
    const floorRule = pickRule(marginRules, { vendorId: v.id, categoryIds: itemCategories, countryId: target.countryId });
    const floor = floorRule ? Number(floorRule.minMarginPercent) : rules.minMarginPercent;
    if (marginPct !== null && marginPct < floor) reasons.push(`Margin ${marginPct.toFixed(1)}% below ${floor}%`);

    const total = (acc.get(v.id) ?? 0) + (dec.get(v.id) ?? 0);
    const parts = {
      distance: d === null ? 0.5 : crossBorder ? 0.2 : clamp01(1 - d / limitKm),
      price: marginPct === null ? 0 : clamp01((marginPct - floor) / 20),
      priority: (profile?.priority ?? 50) / 100,
      reliability: total < 3 ? 0.8 : (acc.get(v.id) ?? 0) / total,
      route: onRoute.has(v.id) ? 1 : 0,
      sameBuyer: hasOpen.has(v.id) ? 1 : 0,
    };
    const score = (Object.keys(parts) as (keyof typeof parts)[]).reduce((a, k) => a + parts[k] * w[k], 0) / wSum * 100;
    out.push({
      vendorId: v.id, name: v.tradeName ?? v.legalName, country: v.country.code, eligible: reasons.length === 0, reasons,
      inHouse: v.isInHouse, freeDelivery, deliveryMinimum: vendorMin ? Number(vendorMin) : null, deliveryRule: vRule, buyerCost: round2(buyerCost), rank: 0,
      score: round2(score), parts: Object.fromEntries(Object.entries(parts).map(([k, x]) => [k, round2(x)])), distanceKm: d === null ? null : round2(d),
      marginPct: marginPct === null ? null : round2(marginPct), goodsNet: round2(goodsNet), marginNet: round2(marginNet), absorbedNet: round2(absorbedNet), covers,
    });
  }
  return rankCandidates(out, rules);
}

/** Greedy split: the supplier covering most remaining items (then best score), up to maxSplit orders. */
export function planMoves(cands: Candidate[], itemCount: number, maxSplit: number, allowed: (c: Candidate) => boolean = (c) => c.eligible) {
  const left = new Set(Array.from({ length: itemCount }, (_, i) => i));
  const picks: { candidate: Candidate; covers: CoveredItem[] }[] = [];
  while (left.size && picks.length < maxSplit) {
    let best: { candidate: Candidate; covers: CoveredItem[] } | null = null;
    for (const c of cands) {
      if (!allowed(c) || picks.some((p) => p.candidate.vendorId === c.vendorId)) continue;
      const covers = c.covers.filter((x) => left.has(x.index));
      if (!covers.length) continue;
      const better = (x: Candidate, y: Candidate) => (x.rank !== y.rank ? x.rank < y.rank : x.score > y.score);
      if (!best || covers.length > best.covers.length || (covers.length === best.covers.length && better(c, best.candidate))) best = { candidate: c, covers };
    }
    if (!best) break;
    picks.push(best);
    for (const x of best.covers) left.delete(x.index);
  }
  return { picks, leftover: [...left] };
}

// ── creating the replacement order ──────────────────────────────────────────

/** What a new order copies: buyer, delivery address, notes — and its link to the original, if any. */
export type OrderBase = Pick<Order, "flow" | "buyerCompanyId" | "countryId" | "placedByUserId" | "deliveryAddress" | "requestedDeliveryDate" | "buyerNotes" | "deliveryRuleId"> & {
  parentOrderId: string | null; routedByFiringi: boolean;
  /** Phase 27: the buyer's branch, cost centre and PO reference carry over */
  branchId?: string | null; costCentre?: string | null; poReference?: string | null;
};

/**
 * Create an order for `vendorId` with the covered items at the prices worked out for them.
 * Delivery: the supplier delivers when the goods reach its free-delivery minimum; otherwise
 * (and always for the in-house warehouse) FIRINGI's fleet. `feeNet` is the fee charged.
 */
export async function createAllocatedOrder(tx: Tx, original: OrderBase, vendorId: string, items: MoveItem[], covers: CoveredItem[], feeNet: Decimal, why: string, byUserId: string | null) {
  const addr = original.deliveryAddress as { id: string; regionId?: string | null };
  const vendor = await tx.company.findUniqueOrThrow({ where: { id: vendorId }, select: { countryId: true, isInHouse: true } });
  const commission = await activeCommission(tx, vendorId);
  if (!commission) throw new AppError("SUPPLIER_UNAVAILABLE", "Supplier has no commission agreement.", 409);
  const lines = covers.map((c) => {
    const it = items[c.index];
    return { it, c, calc: { ...computeLine({ qty: c.qty, unitListPriceNet: c.listUnitNet, vatRatePercent: it.taxRate, commissionRatePercent: commission.rate.toString(), vendorFundedDiscountPerUnit: c.vendorFunded, firingiFundedDiscountPerUnit: c.firingiFunded }), qty: c.qty } };
  });
  const goodsNet = lines.reduce((a, l) => a.plus(l.calc.lineNet), new Decimal(0));
  // Delivery: the new supplier delivers if the goods reach its free-delivery minimum, else FIRINGI.
  // The buyer pays no new fee — only the fee agreed on the original order is carried over.
  const rules = await deliveryRulesFor(original.countryId, vendorId);
  const crossBorder = vendor.countryId !== original.countryId;
  const reached = vendorMinimumReached(vendorInput(rules.vendor), goodsNet, lines.reduce((a, l) => a + l.calc.qty, 0));
  const mode: DeliveryMode = vendor.isInHouse ? "FIRINGI_FLEET" : reached ? (crossBorder ? "CARRIER" : "VENDOR_FLEET") : crossBorder ? "CARRIER" : "FIRINGI_FLEET";
  const ruleId = mode === "FIRINGI_FLEET" ? rules.firingi?.id ?? null : rules.vendor?.id ?? null;
  let feeVat = new Decimal(0);
  const feeRule = feeNet.gt(0) ? await tx.deliveryRule.findFirst({ where: { id: { in: [original.deliveryRuleId ?? "", rules.firingi?.id ?? ""] }, feeTaxCategoryId: { not: null } } }) : null;
  if (feeRule?.feeTaxCategoryId) feeVat = await vatRate(tx, original.countryId, addr.regionId ?? null, feeRule.feeTaxCategoryId);
  const t = computeTotals(lines.map((l) => l.calc), { feeNet, feeVatPercent: feeVat });

  const number = await nextNumber(tx, "order", "FO");
  const order = await tx.order.create({
    data: {
      number, flow: original.flow, buyerCompanyId: original.buyerCompanyId, sellerCompanyId: vendorId, placedByUserId: original.placedByUserId,
      countryId: original.countryId, status: "NEW", deliveryMode: mode, deliveryRuleId: ruleId, deliveryAddress: original.deliveryAddress as Prisma.InputJsonValue,
      requestedDeliveryDate: original.requestedDeliveryDate, buyerNotes: original.buyerNotes, parentOrderId: original.parentOrderId, routedByFiringi: original.routedByFiringi,
      branchId: original.branchId ?? null, costCentre: original.costCentre ?? null, poReference: original.poReference ?? null,
      listNet: t.listNet.toFixed(2), discountTotal: t.discountTotal.toFixed(2), deliveryFeeNet: t.deliveryFeeNet.toFixed(2), netTotal: t.netTotal.toFixed(2),
      vatTotal: t.vatTotal.toFixed(2), grandTotal: t.grandTotal.toFixed(2), commissionTotal: t.commissionTotal.toFixed(2),
      vendorPayableNet: t.vendorPayableNet.toFixed(2), firingiMarginNet: t.firingiMarginNet.toFixed(2),
    },
  });
  for (const { it, c, calc } of lines) {
    const res = await reserveStock(tx, order.id, c.offerId, c.qty);
    if (!res.ok) throw new AppError("OUT_OF_STOCK", `Only ${res.available} left of ${it.sku} at the new supplier.`, 409);
    if (!order.sourceAddressId) { await tx.order.update({ where: { id: order.id }, data: { sourceAddressId: res.addressId } }); order.sourceAddressId = res.addressId; }
    const offer = await tx.vendorOffer.findUniqueOrThrow({ where: { id: c.offerId }, select: { packaging: { select: { name: true } } } });
    await tx.orderLine.create({
      data: {
        orderId: order.id, offerId: c.offerId, productName: it.name, sku: it.sku, packagingName: offer.packaging.name as Prisma.InputJsonValue, qtyOrdered: c.qty,
        unitListPriceNet: calc.unitListPriceNet.toFixed(4), firingiFundedDiscount: calc.firingiFundedDiscount.toFixed(4), vendorFundedDiscount: calc.vendorFundedDiscount.toFixed(4),
        unitSalePriceNet: calc.unitSalePriceNet.toFixed(4), taxRate: it.taxRate, lineNet: calc.lineNet.toFixed(2), lineVat: calc.lineVat.toFixed(2),
        commissionRuleId: commission.id, commissionType: commission.type, commissionRate: commission.rate, commissionBase: calc.commissionBase.toFixed(2),
        commissionAmount: calc.commissionAmount.toFixed(2), vendorUnitCostNet: calc.vendorUnitCostNet.toFixed(4), vendorLineNet: calc.vendorLineNet.toFixed(2),
      },
    });
  }
  await tx.orderStatusHistory.create({ data: { orderId: order.id, toStatus: "NEW", byUserId, reason: why } });
  await tx.order.update({ where: { id: order.id }, data: { status: "PENDING_CONFIRMATION" } });
  await tx.orderStatusHistory.create({ data: { orderId: order.id, fromStatus: "NEW", toStatus: "PENDING_CONFIRMATION", reason: "Sent to supplier" } });
  return { orderId: order.id, number, vendorId, mode, goodsNet: Number(t.goodsNet.toFixed(2)), marginNet: Number(t.firingiMarginNet.toFixed(2)) };
}

// ── allocate ────────────────────────────────────────────────────────────────

const TRIGGER_TEXT: Record<AllocationTrigger, string> = {
  DECLINED: "supplier declined", SHORTFALL: "supplier confirmed less", NO_RESPONSE: "supplier didn't confirm in time", MANUAL: "moved by FIRINGI",
};

export type AllocateInput = {
  orderId: string; trigger: AllocationTrigger; automatic: boolean; byUserId?: string | null;
  /** The buyer (who had chosen this supplier) asked FIRINGI to find another one. */ buyerApproved?: boolean;
  /** Manual: move to this supplier only. */ vendorId?: string; /** Manual: accept a margin below the floor. */ marginOverride?: boolean; note?: string | null;
};

export async function allocate(input: AllocateInput) {
  const rules = await allocationRules();
  const order = await prisma.order.findUnique({ where: { id: input.orderId }, include: { lines: true } });
  if (!order) throw new NotFoundError("Order");
  // Wholesalers buying from distributors: a distributor's cancellation simply cancels the order.
  if (order.flow === "WHOLESALER_FROM_DISTRIBUTOR") {
    if (input.automatic) return null;
    throw new ValidationError("Distributor orders aren't moved: when a distributor cancels, the order is cancelled.");
  }
  if (input.automatic && input.trigger !== "MANUAL" && !rules.triggers[input.trigger === "DECLINED" ? "declined" : input.trigger === "SHORTFALL" ? "shortfall" : "noResponse"]) return null;
  const items = await itemsToMove(order, input.trigger);
  if (!items.length) {
    if (input.automatic) return null;
    throw new ValidationError("Nothing left to move on this order.");
  }
  const chain = await chainOf(order);
  const base = { orderId: order.id, trigger: input.trigger, automatic: input.automatic, fromVendorId: order.sellerCompanyId, items: items as unknown as Prisma.InputJsonValue, byUserId: input.byUserId ?? null };

  const record = async (status: AllocationStatus, extra: Partial<Prisma.AllocationEventUncheckedCreateInput> = {}) => {
    const resolved = status === "MOVED" || status === "DISMISSED";
    const ev = await prisma.allocationEvent.create({ data: { ...base, status, ...extra, ...(resolved ? { resolvedAt: new Date(), resolvedById: input.byUserId ?? null } : {}) } });
    if (status === "AWAITING_BUYER") {
      const seller = await prisma.company.findUniqueOrThrow({ where: { id: order.sellerCompanyId }, select: { legalName: true, tradeName: true } });
      await notify("order.supplier_unavailable", [{ companyId: order.buyerCompanyId, link: `/buy/orders/${order.id}` }], { number: order.number, supplier: seller.tradeName ?? seller.legalName }, { ref: { type: "Order", id: order.id } });
    } else if (!resolved) await notify("allocation.needed", [{ companyId: (await prisma.company.findFirstOrThrow({ where: { type: "ADMIN" }, select: { id: true } })).id, link: `/admin/allocation/manual-allocation?order=${order.id}` }], { number: order.number, reason: TRIGGER_TEXT[input.trigger] }, { ref: { type: "Order", id: order.id } });
    return ev;
  };

  // The buyer chose this supplier: the buyer decides (let FIRINGI find another one, or cancel).
  if (input.automatic && !order.routedByFiringi && !input.buyerApproved && input.trigger !== "MANUAL")
    return record("AWAITING_BUYER", { note: `Waiting for the buyer — ${TRIGGER_TEXT[input.trigger]}` });
  if (input.automatic && chain.moves >= rules.maxMoves) return record("NO_CANDIDATE", { note: `Already moved ${chain.moves} time(s) — limit reached` });
  const exclude = new Set(chain.vendors);
  if (input.vendorId) exclude.delete(input.vendorId);
  const cands = await findCandidates(await targetOf(order), items, rules, exclude);
  const candJson = cands.map(({ covers, ...c }) => ({ ...c, covers: covers.map((x) => ({ index: x.index, qty: x.qty, saleUnitNet: x.saleUnitNet, candidateSaleUnitNet: x.candidateSaleUnitNet })) })) as unknown as Prisma.InputJsonValue;

  if (input.automatic && !rules.auto && !input.buyerApproved) return record("PENDING", { candidates: candJson, note: "Automatic moves are off" });

  const marginOnly = (c: Candidate) => c.reasons.length > 0 && c.reasons.every((r) => r.startsWith("Margin "));
  const allowed = input.vendorId
    ? (c: Candidate) => c.vendorId === input.vendorId && (c.eligible || (!!input.marginOverride && marginOnly(c)))
    : (c: Candidate) => c.eligible;
  if (input.vendorId && !cands.some(allowed)) {
    const c = cands.find((x) => x.vendorId === input.vendorId);
    throw new ValidationError(c ? `This supplier can't take it: ${c.reasons.join("; ")}.` : "This supplier doesn't offer these items.");
  }
  const { picks, leftover } = planMoves(cands, items.length, input.vendorId ? 1 : rules.maxSplitOrders, allowed);
  if (!picks.length) {
    const why = cands.slice(0, 3).map((c) => `${c.name}: ${c.reasons.join(", ")}`).join("; ");
    return record("NO_CANDIDATE", { candidates: candJson, note: input.note ?? (why || "No other supplier offers these items") });
  }

  // Whole order moves → the original is cancelled (unless the supplier already cancelled it).
  const movesAll = leftover.length === 0 && input.trigger !== "SHORTFALL" && !(input.trigger === "MANUAL" && order.status !== "PENDING_CONFIRMATION" && order.status !== "CANCELLED");
  const why = `Moved from ${order.number} (${TRIGGER_TEXT[input.trigger]})`;
  let created: Awaited<ReturnType<typeof createAllocatedOrder>>[] = [];
  const orderBase: OrderBase = { ...order, parentOrderId: order.id, routedByFiringi: true };
  try {
    created = await prisma.$transaction(async (tx) => {
      if (movesAll && order.status === "PENDING_CONFIRMATION")
        await applyOrderTransition(tx, order, "CANCELLED", { reason: `Moved to another supplier (${TRIGGER_TEXT[input.trigger]})`, userId: input.byUserId ?? null, companyId: null });
      // The agreed delivery fee follows the goods when the whole order moves (first new order only).
      const carryFee = movesAll && (order.status === "PENDING_CONFIRMATION" || order.status === "CANCELLED") ? new Decimal(order.deliveryFeeNet.toString()) : new Decimal(0);
      const out = [];
      for (const [i, p] of picks.entries()) out.push(await createAllocatedOrder(tx, orderBase, p.candidate.vendorId, items, p.covers, i === 0 ? carryFee : new Decimal(0), why, input.byUserId ?? null));
      for (const o of out) await (await import("@/server/integrations/webhooks")).emitOrderEvents(tx, o.orderId, { from: "NEW", to: "PENDING_CONFIRMATION", placed: true, reason: "moved" });
      await writeAudit({ actorUserId: input.byUserId ?? null, actorCompanyId: null, action: "order.reallocated", entityType: "Order", entityId: order.id, after: { trigger: input.trigger, automatic: input.automatic, to: out.map((o) => o.number) } }, tx);
      return out;
    });
  } catch (e) {
    return record("FAILED", { candidates: candJson, note: e instanceof Error ? e.message : String(e) });
  }
  const absorbed = picks.reduce((a, p) => a + p.covers.reduce((s, c) => s + Math.max(0, Number(c.candidateSaleUnitNet) - Number(c.saleUnitNet)) * c.qty, 0), 0);
  const status: AllocationStatus = leftover.length ? "PARTIAL" : "MOVED";
  // A manual move (or the buyer's go-ahead) closes the open cases for this order.
  if (!input.automatic || input.buyerApproved) await prisma.allocationEvent.updateMany({ where: { orderId: order.id, resolvedAt: null }, data: { resolvedAt: new Date(), resolvedById: input.byUserId ?? null } });
  const ev = await record(status, {
    candidates: candJson, newOrders: created as unknown as Prisma.InputJsonValue, absorbedNet: absorbed.toFixed(2),
    marginOverride: !!input.marginOverride && picks.some((p) => !p.candidate.eligible), note: input.note ?? (leftover.length ? `${leftover.length} item(s) found no supplier` : null),
  });
  for (const c of created) {
    const [seller, totals] = await Promise.all([
      prisma.company.findUniqueOrThrow({ where: { id: c.vendorId }, select: { legalName: true, tradeName: true } }),
      prisma.order.findUniqueOrThrow({ where: { id: c.orderId }, select: { grandTotal: true, buyer: { select: { legalName: true, tradeName: true } } } }),
    ]);
    await notify("order.new", [{ companyId: c.vendorId, link: `/vendor/orders/${c.orderId}` }], { number: c.number, buyer: totals.buyer.tradeName ?? totals.buyer.legalName, total: totals.grandTotal.toNumber() }, { ref: { type: "Order", id: c.orderId } });
    await notify("order.reallocated", [{ companyId: order.buyerCompanyId, link: `/buy/orders/${c.orderId}` }], { number: order.number, newNumber: c.number, supplier: seller.tradeName ?? seller.legalName }, { ref: { type: "Order", id: c.orderId } });
  }
  if (movesAll && input.trigger !== "DECLINED")
    await notify("order.cancelled", [{ companyId: order.sellerCompanyId, link: `/vendor/orders/${order.id}` }], { number: order.number, reason: `Moved to another supplier (${TRIGGER_TEXT[input.trigger]}).` }, { ref: { type: "Order", id: order.id } });
  return ev;
}

// ── triggers ────────────────────────────────────────────────────────────────

/** Called after a supplier action; never throws (the supplier's action already succeeded). */
export async function onSupplierEvent(orderId: string, trigger: "DECLINED" | "SHORTFALL") {
  try {
    return await allocate({ orderId, trigger, automatic: true });
  } catch (e) {
    console.error("allocation failed", orderId, e);
    return null;
  }
}

/** Orders waiting longer than the response time → moved (cron / "Run now"). */
export async function processOverdue(now = new Date()) {
  const rules = await allocationRules();
  if (!rules.triggers.noResponse) return { checked: 0, moved: 0, waiting: 0 };
  const cutoff = new Date(now.getTime() - rules.responseHours * 3600_000);
  const overdue = await prisma.$queryRaw<{ id: string }[]>`
    SELECT o.id FROM "Order" o
    WHERE o.status = 'PENDING_CONFIRMATION'
      AND (SELECT max(h.at) FROM "OrderStatusHistory" h WHERE h."orderId" = o.id AND h."toStatus" = 'PENDING_CONFIRMATION') < ${cutoff}
      AND NOT EXISTS (SELECT 1 FROM "AllocationEvent" e WHERE e."orderId" = o.id AND e.trigger = 'NO_RESPONSE')
    ORDER BY o."placedAt" LIMIT 100`;
  // Buyers who didn't decide in time: the case closes (nothing was charged).
  await prisma.allocationEvent.updateMany({
    where: { status: "AWAITING_BUYER", resolvedAt: null, createdAt: { lt: new Date(now.getTime() - rules.buyerDecisionHours * 3600_000) } },
    data: { status: "DISMISSED", resolvedAt: now, note: "The buyer didn't decide in time" },
  });
  let moved = 0, waiting = 0;
  for (const { id } of overdue) {
    const ev = await allocate({ orderId: id, trigger: "NO_RESPONSE", automatic: true }).catch((e) => { console.error("allocation failed", id, e); return null; });
    if (ev?.status === "MOVED" || ev?.status === "PARTIAL") moved++;
    else if (ev) waiting++;
  }
  return { checked: overdue.length, moved, waiting };
}

// ── buyer's decision ────────────────────────────────────────────────────────

/** The open "supplier can't deliver" decision for this order, if the caller is its buyer. */
export async function openBuyerDecision(ctx: Ctx, orderId: string) {
  return prisma.allocationEvent.findFirst({
    where: { orderId, status: "AWAITING_BUYER", resolvedAt: null, order: { buyerCompanyId: ctx.company.id } },
    orderBy: { createdAt: "desc" }, select: { id: true, trigger: true, items: true, createdAt: true },
  });
}

/**
 * The buyer chose this supplier and it can't deliver: FIRINGI finds another (same price or
 * lower; the Control Tower takes over if nobody can), or the buyer cancels.
 */
export async function buyerDecision(ctx: Ctx, eventId: string, choice: "FIRINGI" | "CANCEL") {
  if (!can(ctx, "buyer.orders.place")) throw new ForbiddenError();
  const ev = await prisma.allocationEvent.findUnique({ where: { id: eventId }, include: { order: { include: { lines: true } } } });
  if (!ev || ev.order.buyerCompanyId !== ctx.company.id || ev.status !== "AWAITING_BUYER" || ev.resolvedAt) throw new NotFoundError("Decision");
  const order = ev.order;
  // Supplier answered meanwhile (late confirmation): nothing to decide any more.
  if (ev.trigger === "NO_RESPONSE" && order.status !== "PENDING_CONFIRMATION") {
    await prisma.allocationEvent.update({ where: { id: ev.id }, data: { status: "DISMISSED", resolvedAt: new Date(), resolvedById: ctx.user.id, note: "The supplier answered meanwhile" } });
    throw new ValidationError("The supplier has answered meanwhile — nothing to decide.");
  }
  if (choice === "CANCEL") {
    if (order.status === "PENDING_CONFIRMATION")
      await prisma.$transaction((tx) => applyOrderTransition(tx, order, "CANCELLED", { reason: "Cancelled by the buyer (supplier didn't confirm)", userId: ctx.user.id, companyId: ctx.company.id }));
    await prisma.allocationEvent.update({ where: { id: ev.id }, data: { status: "DISMISSED", resolvedAt: new Date(), resolvedById: ctx.user.id, note: "The buyer cancelled" } });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "allocation.buyer_cancelled", entityType: "Order", entityId: order.id });
    return { status: "CANCELLED" as const, newOrders: [] as { orderId: string; number: string }[] };
  }
  await prisma.allocationEvent.update({ where: { id: ev.id }, data: { resolvedAt: new Date(), resolvedById: ctx.user.id } });
  const next = await allocate({ orderId: order.id, trigger: ev.trigger, automatic: true, buyerApproved: true, byUserId: ctx.user.id });
  return { status: next?.status ?? "NO_CANDIDATE", newOrders: ((next?.newOrders ?? []) as { orderId: string; number: string }[]) };
}

// ── back office ─────────────────────────────────────────────────────────────

export async function manualMove(ctx: Ctx, input: { orderId: string; vendorId: string; marginOverride?: boolean; note?: string | null }) {
  assertAllocationManager(ctx);
  const order = await prisma.order.findUnique({ where: { id: input.orderId }, select: { status: true } });
  if (!order) throw new NotFoundError("Order");
  if (!["PENDING_CONFIRMATION", "CANCELLED", "SUPPLIER_PROCESSING", "READY_FOR_PICKUP"].includes(order.status)) throw new ValidationError("This order can no longer be moved.");
  const ev = await allocate({ orderId: input.orderId, trigger: "MANUAL", automatic: false, byUserId: ctx.user.id, vendorId: input.vendorId, marginOverride: input.marginOverride, note: input.note });
  if (ev && ev.status === "FAILED") throw new AppError("ALLOCATION_FAILED", ev.note ?? "The move failed.", 409);
  return ev;
}

/** Candidates for the manual page (nothing is changed). */
export async function previewCandidates(ctx: Ctx, orderId: string) {
  assertAllocationManager(ctx);
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { lines: true } });
  if (!order) throw new NotFoundError("Order");
  const items = await itemsToMove(order, "MANUAL");
  const rules = await allocationRules();
  const chain = await chainOf(order);
  return { order, items, rules, candidates: items.length ? await findCandidates(await targetOf(order), items, rules, chain.vendors) : [] };
}

export async function dismissEvent(ctx: Ctx, eventId: string, note: string) {
  assertAllocationManager(ctx);
  if (!note.trim()) throw new ValidationError("Please give a reason.");
  const ev = await prisma.allocationEvent.findUnique({ where: { id: eventId } });
  if (!ev || ev.resolvedAt) throw new NotFoundError("Open allocation case");
  await prisma.allocationEvent.update({ where: { id: eventId }, data: { status: "DISMISSED", resolvedAt: new Date(), resolvedById: ctx.user.id, note: `${ev.note ? `${ev.note}\n` : ""}Closed: ${note.trim()}` } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "allocation.dismissed", entityType: "Order", entityId: ev.orderId, after: { eventId, note } });
}

export async function saveVendorProfile(ctx: Ctx, companyId: string, input: { priority?: number; excluded?: boolean; dailyOrderCapacity?: number | null; note?: string | null }) {
  assertAllocationManager(ctx);
  const c = await prisma.company.findUnique({ where: { id: companyId }, select: { type: true } });
  if (!c || (c.type !== "WHOLESALER" && c.type !== "DISTRIBUTOR")) throw new NotFoundError("Supplier");
  const before = await prisma.vendorAllocationProfile.findUnique({ where: { companyId } });
  const data: Prisma.VendorAllocationProfileUncheckedUpdateInput = { updatedById: ctx.user.id };
  if (input.priority !== undefined) {
    if (!Number.isInteger(input.priority) || input.priority < 0 || input.priority > 100) throw new ValidationError("Priority must be a whole number from 0 to 100.");
    data.priority = input.priority;
  }
  if (input.excluded !== undefined) data.excluded = input.excluded;
  if (input.dailyOrderCapacity !== undefined) {
    if (input.dailyOrderCapacity !== null && (!Number.isInteger(input.dailyOrderCapacity) || input.dailyOrderCapacity < 1 || input.dailyOrderCapacity > 10000)) throw new ValidationError("Daily capacity must be a whole number from 1 to 10000, or empty for no limit.");
    data.dailyOrderCapacity = input.dailyOrderCapacity;
  }
  if (input.note !== undefined) data.note = input.note?.trim() || null;
  const after = await prisma.vendorAllocationProfile.upsert({ where: { companyId }, update: data, create: { ...(data as Prisma.VendorAllocationProfileUncheckedCreateInput), companyId } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "allocation.vendor_profile", entityType: "Company", entityId: companyId, before, after });
  return after;
}
