/**
 * Phases 9–10: supplier allocation.
 *  • Customer chose the wholesaler → if it can't deliver, the customer decides (FIRINGI finds
 *    another one at the same price or lower, or cancel).
 *  • Customer ordered from FIRINGI → FIRINGI picks the wholesaler (nearest / cheapest / in-house)
 *    and moves the order automatically if that wholesaler can't deliver.
 *  • Wholesaler ← distributor: a distributor's cancellation cancels the order.
 * Plus rules (exclusion, margin floor, capacity, automatic off) and manual moves.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { addToCart, cartView, clearCart } from "@/server/services/cart";
import { changeOrderStatus, confirmOrder, placeOrder } from "@/server/services/orders";
import { setStock } from "@/server/services/vendor-catalogue";
import { browseCatalogue, visibleSuppliers } from "@/server/data/catalogue-buyer";
import { allocationRules, updateAllocationRules } from "@/server/allocation/rules";
import { buyerDecision, dismissEvent, manualMove, planMoves, previewCandidates, processOverdue, saveVendorProfile, type Candidate } from "@/server/allocation/engine";
import { planRouted } from "@/server/allocation/routed";
import { ctxFor } from "../helpers";

const KEBAB = "owner@kebabhouse.test";
const LX_OWNER = "owner@lisboacentral.test";
const CCA_OWNER = "owner@ccalmada.test";
const INHOUSE = "armazem@firingi.test";
const SA = "superadmin@firingi.test";
let cca = "", lx = "", inHouse = "";

async function stockUp(email: string, sku: string, unitsPerPack = 1) {
  const v = await ctxFor(email);
  const offer = await prisma.vendorOffer.findFirstOrThrow({ where: { vendorCompanyId: v.company.id, status: "ACTIVE", packaging: { variant: { sku }, unitsPerPack } } });
  const wh = await prisma.address.findFirstOrThrow({ where: { companyId: v.company.id, kind: { in: ["WAREHOUSE", "PICKUP"] } } });
  const cur = await prisma.stockLevel.findUnique({ where: { offerId_addressId: { offerId: offer.id, addressId: wh.id } } });
  await setStock(v, offer.id, wh.id, Math.max(800, (cur?.reserved ?? 0) + 500));
  return offer;
}
const kebabAddress = async () => {
  const k = await ctxFor(KEBAB);
  return (await prisma.address.findFirstOrThrow({ where: { companyId: k.company.id, kind: "DELIVERY", isActive: true }, orderBy: { isDefault: "desc" } })).id;
};
/** Kebab House orders `qty` mozzarella — from Lisboa Central (choose mode) or from FIRINGI. */
async function orderMozz(qty = 30) {
  const kebab = await ctxFor(KEBAB);
  await clearCart(kebab);
  const offer = await stockUp(LX_OWNER, "FIR-MOZZ2");
  await addToCart(kebab, offer.id, qty);
  return (await placeOrder(kebab, { deliveryAddressId: await kebabAddress() })).id;
}
const children = (id: string) => prisma.order.findMany({ where: { parentOrderId: id }, include: { lines: true } });
const lastEvent = (id: string) => prisma.allocationEvent.findFirst({ where: { orderId: id }, orderBy: { createdAt: "desc" } });
const setMode = async (mode: "CHOOSE_SUPPLIER" | "FIRINGI") => prisma.country.update({ where: { code: "PT" }, data: { customerOrderMode: mode } });
/** C&C Almada is a little dearer than Lisboa Central: let FIRINGI absorb up to 10 %; in-house off unless a test turns it on. */
const baseRules = async (extra: Parameters<typeof updateAllocationRules>[1] = {}) => updateAllocationRules(await ctxFor(SA), { minMarginPercent: -10, inHouse: "OFF", ...extra });
/** The customer chose Lisboa Central; it declines; the customer lets FIRINGI find another. */
async function declinedAndApproved(qty = 30) {
  const id = await orderMozz(qty);
  await changeOrderStatus(await ctxFor(LX_OWNER), id, "CANCELLED", "Out of stock");
  const ev = await lastEvent(id);
  return { id, ev, decided: await buyerDecision(await ctxFor(KEBAB), ev!.id, "FIRINGI") };
}

beforeAll(async () => {
  cca = (await ctxFor(CCA_OWNER)).company.id;
  lx = (await ctxFor(LX_OWNER)).company.id;
  inHouse = (await ctxFor(INHOUSE)).company.id;
  await stockUp(CCA_OWNER, "FIR-MOZZ2");
  await stockUp(INHOUSE, "FIR-MOZZ2");
});
beforeEach(() => baseRules());
afterEach(async () => {
  await prisma.setting.deleteMany({ where: { key: "allocation.rules" } });
  await prisma.vendorAllocationProfile.deleteMany({});
  await setMode("CHOOSE_SUPPLIER");
});
afterAll(() => prisma.$disconnect());

describe("customer chose the wholesaler: the customer decides", () => {
  it("declined → customer asked; 'let FIRINGI find another' moves it at the same price", async () => {
    const id = await orderMozz(30);
    const original = await prisma.order.findUniqueOrThrow({ where: { id }, include: { lines: true } });
    await changeOrderStatus(await ctxFor(LX_OWNER), id, "CANCELLED", "Out of stock");
    const ev = await lastEvent(id);
    expect(ev).toMatchObject({ trigger: "DECLINED", status: "AWAITING_BUYER", resolvedAt: null });
    expect(await children(id)).toHaveLength(0);
    const kebab = await ctxFor(KEBAB);
    const asked = await prisma.notification.findFirst({ where: { userId: kebab.user.id, link: `/buy/orders/${id}` }, orderBy: { createdAt: "desc" } });
    expect(asked?.title).toContain(original.number);
    // someone else's buyer can't decide
    await expect(buyerDecision(await ctxFor(LX_OWNER), ev!.id, "FIRINGI")).rejects.toThrow();
    const res = await buyerDecision(kebab, ev!.id, "FIRINGI");
    expect(res.status).toBe("MOVED");
    const [child] = await children(id);
    expect(child).toMatchObject({ sellerCompanyId: cca, status: "PENDING_CONFIRMATION", routedByFiringi: true });
    expect(child.lines[0].qtyOrdered).toBe(30);
    expect(Number(child.lines[0].unitSalePriceNet)).toBeLessThanOrEqual(Number(original.lines[0].unitSalePriceNet));
    expect(Number(child.deliveryFeeNet)).toBe(Number(original.deliveryFeeNet));
    expect((await prisma.allocationEvent.findUniqueOrThrow({ where: { id: ev!.id } })).resolvedAt).not.toBeNull();
    await expect(buyerDecision(kebab, ev!.id, "FIRINGI")).rejects.toThrow(); // decided once
  });

  it("declined → customer cancels: nothing else happens", async () => {
    const id = await orderMozz(30);
    await changeOrderStatus(await ctxFor(LX_OWNER), id, "CANCELLED", "No");
    const ev = await lastEvent(id);
    expect((await buyerDecision(await ctxFor(KEBAB), ev!.id, "CANCEL")).status).toBe("CANCELLED");
    expect((await prisma.allocationEvent.findUniqueOrThrow({ where: { id: ev!.id } })).status).toBe("DISMISSED");
    expect(await children(id)).toHaveLength(0);
  });

  it("short supply → only the missing quantity moves when the customer agrees", async () => {
    const id = await orderMozz(30);
    const o = await prisma.order.findUniqueOrThrow({ where: { id }, include: { lines: true } });
    await confirmOrder(await ctxFor(LX_OWNER), id, { [o.lines[0].id]: 20 });
    const ev = await lastEvent(id);
    expect(ev).toMatchObject({ trigger: "SHORTFALL", status: "AWAITING_BUYER" });
    await buyerDecision(await ctxFor(KEBAB), ev!.id, "FIRINGI");
    expect((await prisma.order.findUniqueOrThrow({ where: { id } })).status).toBe("SUPPLIER_PROCESSING");
    const [child] = await children(id);
    expect(child.lines[0].qtyOrdered).toBe(10);
    expect(Number(child.deliveryFeeNet)).toBe(0);
  });

  it("no answer in time → customer asked; cancelling cancels the waiting order", async () => {
    const id = await orderMozz(30);
    await processOverdue(new Date()); // not overdue yet
    expect(await prisma.allocationEvent.count({ where: { orderId: id } })).toBe(0);
    await processOverdue(new Date(Date.now() + 5 * 3600_000));
    const ev = await lastEvent(id);
    expect(ev).toMatchObject({ trigger: "NO_RESPONSE", status: "AWAITING_BUYER" });
    expect((await prisma.order.findUniqueOrThrow({ where: { id } })).status).toBe("PENDING_CONFIRMATION");
    await buyerDecision(await ctxFor(KEBAB), ev!.id, "CANCEL");
    expect((await prisma.order.findUniqueOrThrow({ where: { id } })).status).toBe("CANCELLED");
    // checked once
    await processOverdue(new Date(Date.now() + 10 * 3600_000));
    expect(await prisma.allocationEvent.count({ where: { orderId: id } })).toBe(1);
  });

  it("undecided cases expire after the decision time", async () => {
    const id = await orderMozz(30);
    await changeOrderStatus(await ctxFor(LX_OWNER), id, "CANCELLED", "No");
    await processOverdue(new Date(Date.now() + 49 * 3600_000));
    expect(await lastEvent(id)).toMatchObject({ status: "DISMISSED" });
  });

  it("a moved order isn't moved back to a supplier that already had it", async () => {
    const { id } = await declinedAndApproved();
    const [child] = await children(id);
    // the replacement was FIRINGI's choice → its decline moves automatically, but nobody is left
    await changeOrderStatus(await ctxFor(CCA_OWNER), child.id, "CANCELLED", "No either");
    const ev = await lastEvent(child.id);
    expect(ev).toMatchObject({ status: "NO_CANDIDATE", resolvedAt: null });
    expect(await children(child.id)).toHaveLength(0);
  });
});

describe("order from FIRINGI", () => {
  beforeEach(() => setMode("FIRINGI"));

  it("catalogue: one FIRINGI offer per product packaging, no supplier list", async () => {
    const kebab = await ctxFor(KEBAB);
    expect(await visibleSuppliers(kebab)).toHaveLength(0);
    const { items } = await browseCatalogue(kebab, { q: "mozzarella" });
    const singles = items.filter((i) => i.sku === "FIR-MOZZ2" && i.packaging.unitsPerPack === 1);
    expect(singles).toHaveLength(1);
    expect(items.every((i) => i.vendor.name === "FIRINGI" && i.vendor.id === "" && i.vendorSku === null)).toBe(true);
    // wholesalers buying from distributors still choose
    expect((await visibleSuppliers(await ctxFor(LX_OWNER))).length).toBeGreaterThan(0);
  });

  it("checkout: nearest wholesaler with free delivery takes it; the cart can mix suppliers' offers", async () => {
    const kebab = await ctxFor(KEBAB);
    await clearCart(kebab);
    const ccaMozz = await stockUp(CCA_OWNER, "FIR-MOZZ2");
    const lxCola = await stockUp(LX_OWNER, "FIR-COLA33", 24);
    await addToCart(kebab, ccaMozz.id, 20); // offer shown may be any supplier's…
    await addToCart(kebab, lxCola.id, 2); // …and the cart isn't locked to one supplier
    const view = await cartView(kebab);
    expect(view.routed).toBe(true);
    expect(view.delivery).toMatchObject({ ok: true });
    const placed = await placeOrder(kebab, { deliveryAddressId: await kebabAddress() });
    const orders = await prisma.order.findMany({ where: { id: { in: (placed as unknown as { orders: { id: string }[] }).orders.map((o) => o.id) } }, include: { lines: true } });
    expect(orders.every((o) => o.routedByFiringi && o.buyerCompanyId === kebab.company.id)).toBe(true);
    // Lisboa Central is nearest and has both → one order, delivered by the wholesaler (above its 150 € minimum)
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ sellerCompanyId: lx, deliveryMode: "VENDOR_FLEET" });
    expect(Number(orders[0].deliveryFeeNet)).toBe(0);
    expect(await prisma.cartItem.count({ where: { cart: { buyerCompanyId: kebab.company.id, userId: kebab.user.id } } })).toBe(0);
  });

  it("small orders go to FIRINGI's in-house warehouse (flat fee, FIRINGI fleet)", async () => {
    await baseRules({ inHouse: "SMALL_ORDERS" });
    const kebab = await ctxFor(KEBAB);
    await clearCart(kebab);
    await addToCart(kebab, (await stockUp(LX_OWNER, "FIR-MOZZ2")).id, 5); // ≈ 61 € < Lisboa Central's 150 € minimum
    const placed = await placeOrder(kebab, { deliveryAddressId: await kebabAddress() });
    const o = await prisma.order.findUniqueOrThrow({ where: { id: placed.id } });
    expect(o).toMatchObject({ sellerCompanyId: inHouse, deliveryMode: "FIRINGI_FLEET", routedByFiringi: true });
    expect(Number(o.deliveryFeeNet)).toBeGreaterThan(0);
  });

  it("normal-size orders go to the wholesalers even when the in-house warehouse is as close", async () => {
    await baseRules({ inHouse: "SMALL_ORDERS" });
    const kebab = await ctxFor(KEBAB);
    await clearCart(kebab);
    await addToCart(kebab, (await stockUp(LX_OWNER, "FIR-MOZZ2")).id, 30);
    const placed = await placeOrder(kebab, { deliveryAddressId: await kebabAddress() });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: placed.id } })).sellerCompanyId).toBe(lx);
  });

  it("cheapest rule ranks by the buyer's price", async () => {
    await baseRules({ pickBy: "CHEAPEST" });
    const kebab = await ctxFor(KEBAB);
    const plan = await planRouted(kebab, [{ offerId: (await stockUp(CCA_OWNER, "FIR-MOZZ2")).id, qty: 20 }], await kebabAddress());
    const eligible = plan.candidates.filter((c) => c.eligible);
    expect(eligible.length).toBeGreaterThan(1);
    expect(eligible[0].buyerCost).toBe(Math.min(...eligible.map((c) => c.buyerCost)));
    expect(plan.picks[0].candidate.vendorId).toBe(eligible[0].vendorId);
    // customers never get distributors — not even when FIRINGI picks
    const types = await prisma.company.findMany({ where: { id: { in: plan.candidates.map((c) => c.vendorId) } }, select: { type: true } });
    expect(types.every((t) => t.type === "WHOLESALER")).toBe(true);
  });

  it("a FIRINGI order the wholesaler declines moves automatically (no question to the customer)", async () => {
    const kebab = await ctxFor(KEBAB);
    await clearCart(kebab);
    await addToCart(kebab, (await stockUp(LX_OWNER, "FIR-MOZZ2")).id, 30);
    const placed = await placeOrder(kebab, { deliveryAddressId: await kebabAddress() });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: placed.id } })).sellerCompanyId).toBe(lx);
    await changeOrderStatus(await ctxFor(LX_OWNER), placed.id, "CANCELLED", "No stock");
    expect(await lastEvent(placed.id)).toMatchObject({ status: "MOVED", automatic: true });
    expect((await children(placed.id))[0].sellerCompanyId).toBe(cca);
  });
});

describe("wholesaler ← distributor", () => {
  it("a distributor's cancellation cancels the order — nothing moves", async () => {
    const buyer = await ctxFor("purchasing@lisboacentral.test");
    const dist = await ctxFor("owner@atlantico.test");
    await clearCart(buyer);
    await addToCart(buyer, (await stockUp("owner@atlantico.test", "FIR-MOZZ2", 6)).id, 5);
    const addr = await prisma.address.findFirstOrThrow({ where: { companyId: buyer.company.id, kind: "DELIVERY", isActive: true } });
    const { id } = await placeOrder(buyer, { deliveryAddressId: addr.id });
    await changeOrderStatus(dist, id, "CANCELLED", "Not available");
    expect((await prisma.order.findUniqueOrThrow({ where: { id } })).status).toBe("CANCELLED");
    expect(await prisma.allocationEvent.count({ where: { orderId: id } })).toBe(0);
    await expect(manualMove(await ctxFor(SA), { orderId: id, vendorId: dist.company.id })).rejects.toThrow(/Distributor orders/);
  });
});

describe("rules", () => {
  it("excluded suppliers are skipped; the case waits for the back office", async () => {
    const sa = await ctxFor(SA);
    await saveVendorProfile(sa, cca, { excluded: true });
    const { id } = await declinedAndApproved();
    const ev = await lastEvent(id);
    expect(ev).toMatchObject({ status: "NO_CANDIDATE", resolvedAt: null });
    expect((ev!.candidates as { vendorId: string; reasons: string[] }[]).find((c) => c.vendorId === cca)?.reasons).toContain("Excluded by FIRINGI");
    expect(await prisma.notification.count({ where: { userId: sa.user.id, link: `/admin/allocation/manual-allocation?order=${id}` } })).toBe(1);
    await expect(manualMove(sa, { orderId: id, vendorId: cca })).rejects.toThrow(/Excluded/);
    await saveVendorProfile(sa, cca, { excluded: false });
    const moved = await manualMove(sa, { orderId: id, vendorId: cca, note: "Customer called" });
    expect(moved).toMatchObject({ status: "MOVED", automatic: false, trigger: "MANUAL", byUserId: sa.user.id });
    expect((await prisma.allocationEvent.findUniqueOrThrow({ where: { id: ev!.id } })).resolvedAt).not.toBeNull();
  });

  it("margin floor blocks automatic moves; back office may override", async () => {
    const sa = await ctxFor(SA);
    await baseRules({ minMarginPercent: 49 });
    const { id } = await declinedAndApproved();
    const ev = await lastEvent(id);
    expect(ev?.status).toBe("NO_CANDIDATE");
    expect((ev!.candidates as { vendorId: string; reasons: string[] }[]).find((c) => c.vendorId === cca)?.reasons.join()).toMatch(/Margin .* below 49%/);
    await expect(manualMove(sa, { orderId: id, vendorId: cca })).rejects.toThrow(/Margin/);
    expect(await manualMove(sa, { orderId: id, vendorId: cca, marginOverride: true })).toMatchObject({ status: "MOVED", marginOverride: true });
  });

  it("automatic moves off: FIRINGI orders wait in the Control Tower", async () => {
    const sa = await ctxFor(SA);
    await setMode("FIRINGI");
    await baseRules({ auto: false });
    const kebab = await ctxFor(KEBAB);
    await clearCart(kebab);
    await addToCart(kebab, (await stockUp(LX_OWNER, "FIR-MOZZ2")).id, 30);
    const { id } = await placeOrder(kebab, { deliveryAddressId: await kebabAddress() });
    await changeOrderStatus(await ctxFor(LX_OWNER), id, "CANCELLED", "No");
    const ev = await lastEvent(id);
    expect(ev?.status).toBe("PENDING");
    expect((ev!.candidates as { vendorId: string; eligible: boolean }[]).find((c) => c.vendorId === cca)?.eligible).toBe(true);
    await dismissEvent(sa, ev!.id, "Buyer will reorder");
    expect((await prisma.allocationEvent.findUniqueOrThrow({ where: { id: ev!.id } })).status).toBe("DISMISSED");
  });

  it("daily capacity and distance limit", async () => {
    const sa = await ctxFor(SA);
    const id = await orderMozz(10);
    await saveVendorProfile(sa, cca, { dailyOrderCapacity: 1 });
    let p = await previewCandidates(sa, id);
    expect(p.candidates.find((c) => c.vendorId === cca)?.reasons.join()).toMatch(/Daily capacity reached/);
    await saveVendorProfile(sa, cca, { dailyOrderCapacity: null });
    await baseRules({ maxDistanceKm: 1 });
    p = await previewCandidates(sa, id);
    const c = p.candidates.find((x) => x.vendorId === cca)!;
    expect(c.distanceKm).toBeGreaterThan(1);
    expect(c.reasons.join()).toMatch(/Too far/);
    await changeOrderStatus(await ctxFor(KEBAB), id, "CANCELLED", "test cleanup");
  });

  it("rules are validated and only allocation managers may change them", async () => {
    const sa = await ctxFor(SA);
    await expect(updateAllocationRules(sa, { responseHours: 0 })).rejects.toThrow(/Response time/);
    await expect(updateAllocationRules(sa, { pickBy: "RANDOM" as never })).rejects.toThrow(/nearest or cheapest/);
    await expect(updateAllocationRules(sa, { weights: { distance: 0, price: 0, priority: 0, reliability: 0, route: 0, sameBuyer: 0 } })).rejects.toThrow(/weight/);
    await expect(updateAllocationRules(await ctxFor(LX_OWNER), { auto: false })).rejects.toThrow();
    await expect(updateAllocationRules(await ctxFor("finance@firingi.test"), { auto: false })).rejects.toThrow();
    await updateAllocationRules(await ctxFor("ops@firingi.test"), { responseHours: 6, countryDistanceKm: { x: 80 } });
    expect(await allocationRules()).toMatchObject({ responseHours: 6, countryDistanceKm: { x: 80 }, auto: true });
    await expect(saveVendorProfile(sa, (await ctxFor(KEBAB)).company.id, { priority: 10 })).rejects.toThrow();
    await expect(saveVendorProfile(sa, cca, { priority: 101 })).rejects.toThrow(/Priority/);
  });
});

describe("planning", () => {
  const cand = (vendorId: string, score: number, idx: number[], eligible = true): Candidate => ({
    vendorId, name: vendorId, country: "PT", eligible, reasons: [], score, inHouse: false, freeDelivery: true, deliveryMinimum: null, buyerCost: 0, rank: 99,
    parts: {}, distanceKm: 1, marginPct: 10, goodsNet: 0, marginNet: 0, absorbedNet: 0,
    covers: idx.map((index) => ({ index, offerId: `${vendorId}${index}`, qty: 1, listUnitNet: "1", vendorFunded: "0", firingiFunded: "0", saleUnitNet: "1", candidateSaleUnitNet: "1", lineNet: "1", vendorLineNet: "1", commissionRate: "0" })),
  });
  it("prefers one supplier for everything, then splits up to the limit", () => {
    expect(planMoves([cand("a", 90, [0]), cand("b", 50, [0, 1, 2])], 3, 2).picks.map((p) => p.candidate.vendorId)).toEqual(["b"]);
    const split = planMoves([cand("a", 90, [0, 1]), cand("b", 50, [2]), cand("c", 60, [1, 2])], 3, 2);
    expect(split.picks.map((p) => p.candidate.vendorId)).toEqual(["a", "c"]);
    expect(split.picks[1].covers.map((c) => c.index)).toEqual([2]);
    expect(planMoves([cand("a", 90, [0]), cand("b", 50, [1])], 3, 1)).toMatchObject({ leftover: [1, 2] });
    expect(planMoves([cand("a", 90, [0], false)], 1, 2).picks).toHaveLength(0);
  });
});
