/**
 * Phase 9: supplier allocation — declined / short / unanswered orders move to another
 * supplier at the buyer's original price; rules (exclusion, margin floor, capacity,
 * automatic off) and manual moves from the back office.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { addToCart, clearCart } from "@/server/services/cart";
import { changeOrderStatus, confirmOrder, placeOrder } from "@/server/services/orders";
import { setStock } from "@/server/services/vendor-catalogue";
import { DEFAULT_RULES, allocationRules, updateAllocationRules } from "@/server/allocation/rules";
import { dismissEvent, manualMove, planMoves, previewCandidates, processOverdue, saveVendorProfile, type Candidate } from "@/server/allocation/engine";
import { ctxFor } from "../helpers";

const KEBAB = "owner@kebabhouse.test";
const LX_OWNER = "owner@lisboacentral.test";
const CCA_OWNER = "owner@ccalmada.test";
const SA = "superadmin@firingi.test";
let cca = "";
let lx = "";

async function stockUp(email: string, sku: string) {
  const v = await ctxFor(email);
  const offer = await prisma.vendorOffer.findFirstOrThrow({ where: { vendorCompanyId: v.company.id, status: "ACTIVE", packaging: { variant: { sku }, unitsPerPack: 1 } } });
  const wh = await prisma.address.findFirstOrThrow({ where: { companyId: v.company.id, kind: { in: ["WAREHOUSE", "PICKUP"] } } });
  const cur = await prisma.stockLevel.findUnique({ where: { offerId_addressId: { offerId: offer.id, addressId: wh.id } } });
  await setStock(v, offer.id, wh.id, Math.max(800, (cur?.reserved ?? 0) + 500));
  return offer;
}
/** Kebab House orders `qty` mozzarella from Lisboa Central. */
async function orderMozz(qty = 30) {
  const kebab = await ctxFor(KEBAB);
  await clearCart(kebab);
  const offer = await stockUp(LX_OWNER, "FIR-MOZZ2");
  await addToCart(kebab, offer.id, qty);
  const addr = await prisma.address.findFirstOrThrow({ where: { companyId: kebab.company.id, kind: "DELIVERY", isActive: true }, orderBy: { isDefault: "desc" } });
  return (await placeOrder(kebab, { deliveryAddressId: addr.id })).id;
}
const children = (id: string) => prisma.order.findMany({ where: { parentOrderId: id }, include: { lines: true } });
const lastEvent = (id: string) => prisma.allocationEvent.findFirst({ where: { orderId: id }, orderBy: { createdAt: "desc" } });

beforeAll(async () => {
  cca = (await ctxFor(CCA_OWNER)).company.id;
  lx = (await ctxFor(LX_OWNER)).company.id;
  await stockUp(CCA_OWNER, "FIR-MOZZ2");
});
afterEach(async () => {
  await prisma.setting.deleteMany({ where: { key: "allocation.rules" } });
  await prisma.vendorAllocationProfile.deleteMany({});
});
afterAll(() => prisma.$disconnect());

/** C&C Almada is a little dearer than Lisboa Central: let FIRINGI absorb up to 10 %. */
const absorb = async () => updateAllocationRules(await ctxFor(SA), { minMarginPercent: -10 });

describe("automatic moves", () => {
  beforeEach(absorb);
  it("a declined order moves to another supplier at the same price", async () => {
    const id = await orderMozz(30);
    const original = await prisma.order.findUniqueOrThrow({ where: { id }, include: { lines: true } });
    await changeOrderStatus(await ctxFor(LX_OWNER), id, "CANCELLED", "Out of stock");
    const ev = await lastEvent(id);
    expect(ev).toMatchObject({ trigger: "DECLINED", status: "MOVED", automatic: true, fromVendorId: lx });
    expect(ev!.resolvedAt).not.toBeNull();
    expect(Number(ev!.absorbedNet)).toBeGreaterThanOrEqual(0);
    const [child] = await children(id);
    expect(child).toMatchObject({ sellerCompanyId: cca, buyerCompanyId: original.buyerCompanyId, status: "PENDING_CONFIRMATION" });
    expect(child.lines[0].qtyOrdered).toBe(30);
    expect(Number(child.lines[0].unitSalePriceNet)).toBeLessThanOrEqual(Number(original.lines[0].unitSalePriceNet));
    expect(Number(child.deliveryFeeNet)).toBe(Number(original.deliveryFeeNet)); // agreed fee follows the goods
    // stock reserved at the new supplier
    expect(await prisma.stockMovement.count({ where: { orderId: child.id, type: "RESERVE" } })).toBeGreaterThan(0);
    // buyer told about the move (not just "cancelled"); new supplier gets the order
    const kebab = await ctxFor(KEBAB);
    const note = await prisma.notification.findFirst({ where: { userId: kebab.user.id, link: `/buy/orders/${child.id}` }, orderBy: { createdAt: "desc" } });
    expect(note?.title).toContain(original.number);
    const ccaOwner = await ctxFor(CCA_OWNER);
    expect(await prisma.notification.count({ where: { userId: ccaOwner.user.id, link: `/vendor/orders/${child.id}` } })).toBe(1);
  });

  it("short supply: only the missing quantity moves", async () => {
    const id = await orderMozz(30);
    const o = await prisma.order.findUniqueOrThrow({ where: { id }, include: { lines: true } });
    await confirmOrder(await ctxFor(LX_OWNER), id, { [o.lines[0].id]: 20 });
    expect((await prisma.order.findUniqueOrThrow({ where: { id } })).status).toBe("SUPPLIER_PROCESSING");
    const [child] = await children(id);
    expect(child.sellerCompanyId).toBe(cca);
    expect(child.lines[0].qtyOrdered).toBe(10);
    expect(Number(child.deliveryFeeNet)).toBe(0); // fee already on the original
    expect((await lastEvent(id))?.trigger).toBe("SHORTFALL");
  });

  it("no answer within the response time: moved by the scheduled check", async () => {
    const id = await orderMozz(30);
    await processOverdue(new Date()); // not overdue yet
    expect(await prisma.allocationEvent.count({ where: { orderId: id } })).toBe(0);
    const res = await processOverdue(new Date(Date.now() + (DEFAULT_RULES.responseHours + 1) * 3600_000));
    expect(res.moved).toBeGreaterThanOrEqual(1);
    expect((await prisma.order.findUniqueOrThrow({ where: { id } })).status).toBe("CANCELLED");
    expect((await lastEvent(id))).toMatchObject({ trigger: "NO_RESPONSE", status: "MOVED" });
    expect((await children(id))[0].sellerCompanyId).toBe(cca);
    // the slow supplier is told
    const lxOwner = await ctxFor(LX_OWNER);
    expect(await prisma.notification.count({ where: { userId: lxOwner.user.id, link: `/vendor/orders/${id}` } })).toBeGreaterThanOrEqual(2);
    // checked only once
    const again = await processOverdue(new Date(Date.now() + 10 * 3600_000));
    expect(await prisma.allocationEvent.count({ where: { orderId: id } })).toBe(1);
    expect(again.checked).toBeGreaterThanOrEqual(0);
  });

  it("a moved order isn't moved back to a supplier that already had it", async () => {
    const id = await orderMozz(30);
    await changeOrderStatus(await ctxFor(LX_OWNER), id, "CANCELLED", "No");
    const [child] = await children(id);
    await changeOrderStatus(await ctxFor(CCA_OWNER), child.id, "CANCELLED", "No either");
    const ev = await lastEvent(child.id);
    expect(ev?.status).toBe("NO_CANDIDATE");
    expect(ev?.resolvedAt).toBeNull();
    expect(await children(child.id)).toHaveLength(0);
  });
});

describe("rules", () => {
  it("excluded suppliers are skipped; the case waits for the back office", async () => {
    const sa = await ctxFor(SA);
    await absorb();
    await saveVendorProfile(sa, cca, { excluded: true });
    const id = await orderMozz(30);
    await changeOrderStatus(await ctxFor(LX_OWNER), id, "CANCELLED", "Out of stock");
    const ev = await lastEvent(id);
    expect(ev).toMatchObject({ status: "NO_CANDIDATE", resolvedAt: null });
    const cands = ev!.candidates as { vendorId: string; reasons: string[] }[];
    expect(cands.find((c) => c.vendorId === cca)?.reasons).toContain("Excluded by FIRINGI");
    // back office is told
    expect(await prisma.notification.count({ where: { userId: sa.user.id, link: `/admin/allocation/manual-allocation?order=${id}` } })).toBe(1);
    // manual move refused while excluded, allowed after
    await expect(manualMove(sa, { orderId: id, vendorId: cca })).rejects.toThrow(/Excluded/);
    await saveVendorProfile(sa, cca, { excluded: false });
    const moved = await manualMove(sa, { orderId: id, vendorId: cca, note: "Customer called" });
    expect(moved).toMatchObject({ status: "MOVED", automatic: false, trigger: "MANUAL", byUserId: sa.user.id });
    expect((await prisma.allocationEvent.findUniqueOrThrow({ where: { id: ev!.id } })).resolvedAt).not.toBeNull();
  });

  it("margin floor blocks automatic moves; back office may override", async () => {
    const sa = await ctxFor(SA);
    await updateAllocationRules(sa, { minMarginPercent: 49 });
    const id = await orderMozz(30);
    await changeOrderStatus(await ctxFor(LX_OWNER), id, "CANCELLED", "No");
    const ev = await lastEvent(id);
    expect(ev?.status).toBe("NO_CANDIDATE");
    expect((ev!.candidates as { vendorId: string; reasons: string[] }[]).find((c) => c.vendorId === cca)?.reasons.join()).toMatch(/Margin .* below 49%/);
    await expect(manualMove(sa, { orderId: id, vendorId: cca })).rejects.toThrow(/Margin/);
    const moved = await manualMove(sa, { orderId: id, vendorId: cca, marginOverride: true });
    expect(moved).toMatchObject({ status: "MOVED", marginOverride: true });
  });

  it("automatic moves off: the case waits with its candidates", async () => {
    const sa = await ctxFor(SA);
    await updateAllocationRules(sa, { auto: false, minMarginPercent: -10 });
    const id = await orderMozz(30);
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
    // CCA already received moved orders today in the tests above
    let p = await previewCandidates(sa, id);
    expect(p.candidates.find((c) => c.vendorId === cca)?.reasons.join()).toMatch(/Daily capacity reached/);
    await saveVendorProfile(sa, cca, { dailyOrderCapacity: null });
    await updateAllocationRules(sa, { maxDistanceKm: 1 });
    p = await previewCandidates(sa, id);
    const c = p.candidates.find((x) => x.vendorId === cca)!;
    expect(c.distanceKm).toBeGreaterThan(1);
    expect(c.reasons.join()).toMatch(/Too far/);
    await changeOrderStatus(await ctxFor(KEBAB), id, "CANCELLED", "test cleanup");
  });

  it("rules are validated and only allocation managers may change them", async () => {
    const sa = await ctxFor(SA);
    await expect(updateAllocationRules(sa, { responseHours: 0 })).rejects.toThrow(/Response time/);
    await expect(updateAllocationRules(sa, { weights: { distance: 0, price: 0, priority: 0, reliability: 0, route: 0, sameBuyer: 0 } })).rejects.toThrow(/weight/);
    await expect(updateAllocationRules(await ctxFor(LX_OWNER), { auto: false })).rejects.toThrow();
    await expect(updateAllocationRules(await ctxFor("finance@firingi.test"), { auto: false })).rejects.toThrow();
    const ops = await ctxFor("ops@firingi.test");
    await updateAllocationRules(ops, { responseHours: 6, countryDistanceKm: { x: 80 } });
    expect(await allocationRules()).toMatchObject({ responseHours: 6, countryDistanceKm: { x: 80 }, auto: true });
    await expect(saveVendorProfile(sa, (await ctxFor(KEBAB)).company.id, { priority: 10 })).rejects.toThrow();
    await expect(saveVendorProfile(sa, cca, { priority: 101 })).rejects.toThrow(/Priority/);
  });
});

describe("planning", () => {
  const cand = (vendorId: string, score: number, idx: number[], eligible = true): Candidate => ({
    vendorId, name: vendorId, country: "PT", eligible, reasons: [], score, parts: {}, distanceKm: 1, marginPct: 10, goodsNet: 0, marginNet: 0, absorbedNet: 0,
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
