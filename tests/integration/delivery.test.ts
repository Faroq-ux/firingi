/**
 * Phase 6: service areas & zones (PostGIS), fleet, delivery lifecycle with proof of
 * delivery, failed deliveries (retry / return to supplier), returns with credit notes.
 */
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { addToCart, clearCart } from "@/server/services/cart";
import { changeOrderStatus, confirmOrder, placeOrder } from "@/server/services/orders";
import { browseCatalogue } from "@/server/data/catalogue-buyer";
import { addServiceArea, createZone, removeServiceArea } from "@/server/services/service-areas";
import { addDriver, addVehicle, ownFleet, setDriverActive } from "@/server/services/fleet";
import { assignDelivery, completeDelivery, deliveryForViewer, failDelivery, pickUp, returnToSupplier, startDelivery } from "@/server/services/deliveries";
import { DEFAULT_POLICY, ordersPerDriver, setMultiOrderPolicy, setVendorMultiOrder } from "@/server/services/delivery-settings";
import { listReturns, receiveReturn, requestReturn, returnableLines, reviewReturn } from "@/server/services/returns";
import { setStock } from "@/server/services/vendor-catalogue";
import { excludedVendorIds, postalMatches } from "@/server/delivery/coverage";
import { ctxFor, pngFile } from "../helpers";

const KEBAB = "owner@kebabhouse.test";
const LX_OWNER = "owner@lisboacentral.test";
const LX = "Grossista Lisboa Central, Lda";
const OPS = "ops@firingi.test";
const FIR_DRIVER = "driver@firingi.test";
const tag = Date.now().toString(36);
const areaIds: string[] = [];

afterAll(async () => {
  const lx = await ctxFor(LX_OWNER);
  for (const id of areaIds) await removeServiceArea(lx, id).catch(() => {});
  await prisma.$disconnect();
});

async function offerOf(sku: string, unitsPerPack?: number) {
  return prisma.vendorOffer.findFirstOrThrow({ where: { vendor: { legalName: LX }, packaging: { variant: { sku }, ...(unitsPerPack ? { unitsPerPack } : {}) } } });
}
async function stockOf(offerId: string) {
  const l = await prisma.stockLevel.findMany({ where: { offerId } });
  return { onHand: l.reduce((a, x) => a + x.onHand, 0), reserved: l.reduce((a, x) => a + x.reserved, 0) };
}
async function restock(offerId: string, qty = 500) {
  const v = await ctxFor(LX_OWNER);
  const wh = await prisma.address.findFirstOrThrow({ where: { companyId: v.company.id, kind: { in: ["WAREHOUSE", "PICKUP"] } } });
  const cur = await prisma.stockLevel.findUnique({ where: { offerId_addressId: { offerId, addressId: wh.id } } });
  await setStock(v, offerId, wh.id, Math.max(qty, cur?.reserved ?? 0));
}
async function kebabAddress() {
  const k = await ctxFor(KEBAB);
  return prisma.address.findFirstOrThrow({ where: { companyId: k.company.id, kind: "DELIVERY", isActive: true }, orderBy: { isDefault: "desc" } });
}
/** Place + confirm an order from Lisboa Central; `qty` boxes decide who delivers. */
async function orderFromLx(sku: string, qty: number, unitsPerPack?: number) {
  const kebab = await ctxFor(KEBAB);
  await clearCart(kebab);
  const offer = await offerOf(sku, unitsPerPack);
  await restock(offer.id);
  await addToCart(kebab, offer.id, qty);
  const { id } = await placeOrder(kebab, { deliveryAddressId: (await kebabAddress()).id });
  await confirmOrder(await ctxFor(LX_OWNER), id, {});
  const d = await prisma.delivery.findUniqueOrThrow({ where: { orderId: id } });
  return { orderId: id, deliveryId: d.id, offerId: offer.id };
}
const orderStatus = async (id: string) => (await prisma.order.findUniqueOrThrow({ where: { id } })).status;

describe("service areas and zones (PostGIS)", () => {
  it("postal patterns", () => {
    expect(postalMatches("1100-319", ["1100-*"])).toBe(true);
    expect(postalMatches("1200-001", ["1100-*", "4000-*"])).toBe(false);
    expect(postalMatches("1100-319", ["11*"])).toBe(true);
  });

  it("a radius around the warehouse decides which buyers see the wholesaler", async () => {
    const lx = await ctxFor(LX_OWNER);
    const kebab = await ctxFor(KEBAB);
    // Porto delivery address for a second check.
    const porto = await prisma.city.findFirstOrThrow({ where: { name: "Porto" } });
    const portoAddr = await prisma.address.create({
      data: { companyId: kebab.company.id, kind: "DELIVERY", label: `Porto ${tag}`, line1: "Rua de Santa Catarina 1", postalCode: "4000-447", cityId: porto.id, cityName: "Porto", countryId: porto.countryId, latitude: porto.latitude, longitude: porto.longitude },
    });
    const wh = await prisma.address.findFirstOrThrow({ where: { companyId: lx.company.id, kind: { in: ["WAREHOUSE", "PICKUP"] } } });
    const a = await addServiceArea(lx, { type: "RADIUS_KM", originAddressId: wh.id, radiusKm: 25 });
    areaIds.push(a.id);

    expect(await excludedVendorIds((await kebabAddress()).id)).not.toContain(lx.company.id); // Lisbon: inside 25 km
    expect(await excludedVendorIds(portoAddr.id)).toContain(lx.company.id); // Porto: ~275 km away
    // The buyer's catalogue still shows Lisboa Central (default address is in Lisbon) …
    const res = await browseCatalogue(kebab, { q: "mozzarella" });
    expect(res.items.some((i) => i.vendor.name.includes("Lisboa Central"))).toBe(true);
    // … but checkout to the Porto address is refused.
    await clearCart(kebab);
    const box = await offerOf("FIR-PIZZABOX33");
    await restock(box.id);
    await addToCart(kebab, box.id, 8);
    await expect(placeOrder(kebab, { deliveryAddressId: portoAddr.id })).rejects.toThrow(/doesn't deliver to that address/);
    await clearCart(kebab);
    await prisma.address.update({ where: { id: portoAddr.id }, data: { isActive: false } });
  });

  it("zones by postal code or by polygon", async () => {
    const ops = await ctxFor(OPS);
    const lx = await ctxFor(LX_OWNER);
    const k = await kebabAddress();
    const byPostal = await createZone(ops, { countryCode: "PT", name: `Baixa ${tag}`, postalCodePatterns: [`${k.postalCode.slice(0, 4)}-*`] });
    // A small square around Kebab House's point (≈2 km).
    const lat = Number(k.latitude), lng = Number(k.longitude), e = 0.01;
    const square = { type: "Polygon", coordinates: [[[lng - e, lat - e], [lng + e, lat - e], [lng + e, lat + e], [lng - e, lat + e], [lng - e, lat - e]]] };
    const byShape = await createZone(ops, { countryCode: "PT", name: `Square ${tag}`, postalCodePatterns: [], polygon: square });
    await expect(createZone(ops, { countryCode: "PT", name: "Bad", postalCodePatterns: [], polygon: { type: "Polygon", coordinates: [[[0, 0], [1, 1], [1, 0], [0, 1], [0, 0]]] } })).rejects.toThrow(/not valid/);

    // Replace the radius with the polygon zone only.
    for (const id of areaIds.splice(0)) await removeServiceArea(lx, id);
    const z = await addServiceArea(lx, { type: "ZONE", zoneId: byShape.id });
    expect(await excludedVendorIds(k.id)).not.toContain(lx.company.id);
    await removeServiceArea(lx, z.id);
    const z2 = await addServiceArea(lx, { type: "ZONE", zoneId: byPostal.id });
    expect(await excludedVendorIds(k.id)).not.toContain(lx.company.id);
    await removeServiceArea(lx, z2.id);
    // A zone elsewhere (Porto postal codes) hides Lisboa Central from Kebab House.
    const far = await createZone(ops, { countryCode: "PT", name: `Porto ${tag}`, postalCodePatterns: ["4000-*"] });
    const z3 = await addServiceArea(lx, { type: "ZONE", zoneId: far.id });
    expect(await excludedVendorIds(k.id)).toContain(lx.company.id);
    await removeServiceArea(lx, z3.id);
  });

  it("wholesalers can't sell outside their own country", async () => {
    const lx = await ctxFor(LX_OWNER);
    const es = await prisma.country.findUniqueOrThrow({ where: { code: "ES" } });
    await expect(addServiceArea(lx, { type: "COUNTRY", countryId: es.id })).rejects.toThrow(/own country/);
  });
});

describe("fleet: vendors add their own drivers and vehicles", () => {
  it("a vendor's driver and vehicle are active at once and only in that fleet", async () => {
    const lx = await ctxFor(LX_OWNER);
    const v = await addVehicle(lx, { plate: `AA-${tag.slice(-4)}`.toUpperCase().slice(0, 9), type: "REFRIGERATED_VAN", capacityKg: 900 });
    expect(v.status).toBe("ACTIVE");
    expect(v.isRefrigerated).toBe(true);
    await expect(addVehicle(lx, { plate: v.plate, type: "VAN" })).rejects.toThrow(/already have/);
    const d = await addDriver(lx, { name: "Rui Entregas", email: `rui.${tag}@lisboacentral.test`, password: "Driver!2026x", licenceNumber: "LX-998877" });
    expect(d.status).toBe("APPROVED");
    const driverCtx = await ctxFor(`rui.${tag}@lisboacentral.test`);
    expect(driverCtx.permissions.has("driver.deliveries.update")).toBe(true);
    expect(driverCtx.permissions.has("vendor.orders.manage")).toBe(false);
    const fleet = await ownFleet(lx);
    expect(fleet.drivers.some((x) => x.id === d.id) && fleet.vehicles.some((x) => x.id === v.id)).toBe(true);
    // Kebab House (a customer) has no fleet to manage.
    await expect(addVehicle(await ctxFor(KEBAB), { plate: "ZZ99ZZ", type: "VAN" })).rejects.toThrow();
  });
});

describe("delivery lifecycle", () => {
  let vendorDriver: string, vendorVehicle: string, vendorDriverEmail: string;

  it("vendor delivers its own free-delivery order with proof of delivery → invoice", async () => {
    const lx = await ctxFor(LX_OWNER);
    vendorDriverEmail = `ana.${tag}@lisboacentral.test`;
    vendorDriver = (await addDriver(lx, { name: "Ana Condutora", email: vendorDriverEmail, password: "Driver!2026x", licenceNumber: "LX-112233" })).id;
    vendorVehicle = (await addVehicle(lx, { plate: `BB${tag.slice(-4)}`.toUpperCase(), type: "VAN" })).id;

    const { orderId, deliveryId, offerId } = await orderFromLx("FIR-PIZZABOX33", 8); // 156 € → vendor fleet
    const d0 = await prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId }, include: { executor: true } });
    expect(d0.mode).toBe("VENDOR_FLEET");
    expect(d0.executor.legalName).toBe(LX);
    expect(d0.status).toBe("UNASSIGNED");

    // FIRINGI's driver can't be put on a vendor delivery (service and DB).
    const firDriver = await prisma.driver.findFirstOrThrow({ where: { user: { email: FIR_DRIVER } } });
    await expect(assignDelivery(lx, deliveryId, { driverId: firDriver.id })).rejects.toThrow(/your fleet/);
    await expect(prisma.delivery.update({ where: { id: deliveryId }, data: { driverId: firDriver.id } })).rejects.toThrow(/DELIVERY_DRIVER_NOT_EXECUTOR/);

    await assignDelivery(lx, deliveryId, { driverId: vendorDriver, vehicleId: vendorVehicle });
    const drv = await ctxFor(vendorDriverEmail);
    expect((await deliveryForViewer(drv, deliveryId)).driverActions).toEqual([]); // not ready yet
    await expect(pickUp(drv, deliveryId)).rejects.toThrow(/ready for pickup/);
    await changeOrderStatus(lx, orderId, "READY_FOR_PICKUP");
    expect((await deliveryForViewer(drv, deliveryId)).driverActions).toEqual(["PICK_UP"]);

    const before = await stockOf(offerId);
    await pickUp(drv, deliveryId);
    expect(await orderStatus(orderId)).toBe("DISPATCHED");
    expect((await stockOf(offerId)).onHand).toBe(before.onHand - 8);
    await startDelivery(drv, deliveryId);
    expect(await orderStatus(orderId)).toBe("OUT_FOR_DELIVERY");
    expect((await prisma.driver.findUniqueOrThrow({ where: { id: vendorDriver } })).availability).toBe("BUSY");

    await expect(completeDelivery(drv, deliveryId, { recipientName: "Ahmed" })).rejects.toThrow(/signature or a photo/);
    // Another driver can't touch it.
    await expect(completeDelivery(await ctxFor(FIR_DRIVER), deliveryId, { recipientName: "Xavier", signature: pngFile() })).rejects.toThrow(/not found/i);
    await completeDelivery(drv, deliveryId, { recipientName: "Ahmed Kebab", signature: pngFile("sig.png"), photos: [pngFile("box.png")], latitude: 38.71, longitude: -9.13 });
    expect(await orderStatus(orderId)).toBe("DELIVERED");
    const d = await prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId }, include: { proof: true, attempts: true } });
    expect(d.status).toBe("DELIVERED");
    expect(d.proof!.recipientName).toBe("Ahmed Kebab");
    expect(d.proof!.photoKeys).toHaveLength(1);
    expect(d.attempts.filter((a) => a.succeeded)).toHaveLength(1);
    expect(await prisma.invoice.count({ where: { orderId, docType: "INVOICE" } })).toBe(1);
    expect((await prisma.driver.findUniqueOrThrow({ where: { id: vendorDriver } })).availability).toBe("AVAILABLE");
    // Proof of delivery can't be altered.
    await expect(prisma.proofOfDelivery.update({ where: { id: d.proof!.id }, data: { recipientName: "Someone else" } })).rejects.toThrow(/POD_IMMUTABLE/);
    // The buyer can follow it and see the proof.
    const buyerView = await deliveryForViewer(await ctxFor(KEBAB), deliveryId);
    expect(buyerView.role).toBe("VIEWER");
  });

  it("FIRINGI delivery fails, is retried, fails again and goes back to the supplier", async () => {
    const ops = await ctxFor(OPS);
    const lx = await ctxFor(LX_OWNER);
    const { orderId, deliveryId, offerId } = await orderFromLx("FIR-MOZZ2", 5, 1); // 61 € → FIRINGI fleet
    const d0 = await prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId }, include: { executor: true } });
    expect(d0.mode).toBe("FIRINGI_FLEET");
    expect(d0.executor.type).toBe("ADMIN");
    // The vendor can see but not dispatch FIRINGI's delivery.
    await expect(assignDelivery(lx, deliveryId, { driverId: vendorDriver })).rejects.toThrow();

    const firDriver = await prisma.driver.findFirstOrThrow({ where: { user: { email: FIR_DRIVER } } });
    await assignDelivery(ops, deliveryId, { driverId: firDriver.id });
    await changeOrderStatus(lx, orderId, "READY_FOR_PICKUP");
    const drv = await ctxFor(FIR_DRIVER);
    const before = await stockOf(offerId);
    await pickUp(drv, deliveryId);
    await startDelivery(drv, deliveryId);
    await expect(failDelivery(drv, deliveryId, { reasonCode: "OTHER" })).rejects.toThrow(/Describe/);
    await failDelivery(drv, deliveryId, { reasonCode: "CUSTOMER_ABSENT", note: "Shop closed at 15:00", photo: pngFile("door.png") });
    expect(await orderStatus(orderId)).toBe("EXCEPTION");
    const ex = await prisma.orderException.findFirstOrThrow({ where: { orderId, isResolved: false } });
    expect(ex.type).toBe("DELIVERY_FAILED");
    expect(ex.description).toMatch(/customer absent/);

    // Retry: back on the road (goods are still with FIRINGI), exception resolved.
    await assignDelivery(ops, deliveryId, { driverId: firDriver.id });
    expect(await orderStatus(orderId)).toBe("DISPATCHED");
    expect((await prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId } })).status).toBe("PICKED_UP");
    expect(await prisma.orderException.count({ where: { orderId, isResolved: false } })).toBe(0);
    await startDelivery(drv, deliveryId);
    await failDelivery(drv, deliveryId, { reasonCode: "REFUSED" });

    await expect(returnToSupplier(lx, deliveryId, "x")).rejects.toThrow();
    await returnToSupplier(ops, deliveryId, "Customer refused twice");
    expect(await orderStatus(orderId)).toBe("CANCELLED");
    const d = await prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId }, include: { attempts: true } });
    expect(d.status).toBe("RETURNED");
    expect(d.attempts.filter((a) => !a.succeeded)).toHaveLength(2);
    // Stock that had shipped is back on hand; nothing stays reserved; no invoice.
    const after = await stockOf(offerId);
    expect(after.onHand).toBe(before.onHand);
    expect(after.reserved).toBe(before.reserved - 5);
    expect(await prisma.invoice.count({ where: { orderId } })).toBe(0);
  });

  it("manual status changes keep the delivery in sync (carrier-free vendor order)", async () => {
    const lx = await ctxFor(LX_OWNER);
    const { orderId, deliveryId } = await orderFromLx("FIR-PIZZABOX33", 8);
    for (const s of ["READY_FOR_PICKUP", "DISPATCHED", "OUT_FOR_DELIVERY", "DELIVERED"] as const) await changeOrderStatus(lx, orderId, s);
    const d = await prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId } });
    expect(d.status).toBe("DELIVERED");
    expect(d.completedAt).not.toBeNull();
  });

  it("a suspended driver loses unstarted deliveries", async () => {
    const lx = await ctxFor(LX_OWNER);
    const { deliveryId } = await orderFromLx("FIR-PIZZABOX33", 8);
    await assignDelivery(lx, deliveryId, { driverId: vendorDriver });
    await expect(setDriverActive(lx, vendorDriver, false)).rejects.toThrow(/reason/);
    await setDriverActive(lx, vendorDriver, false, "Licence check");
    const d = await prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId } });
    expect(d.driverId).toBeNull();
    expect(d.status).toBe("UNASSIGNED");
    expect((await ctxFor(vendorDriverEmail)).permissions.has("driver.deliveries.view")).toBe(false);
    await setDriverActive(lx, vendorDriver, true);
  });
});

describe("multi-order delivery (Super Admin + vendor switches)", () => {
  it("off by default; vendor turns it on within FIRINGI's policy; Super Admin can switch vendors off", async () => {
    const lx = await ctxFor(LX_OWNER);
    const sa = await ctxFor("superadmin@firingi.test");
    const ops = await ctxFor(OPS);
    const email = `multi.${tag}@lisboacentral.test`;
    const driverId = (await addDriver(lx, { name: "Multi Driver", email, password: "Driver!2026x", licenceNumber: "LX-445566" })).id;
    const a = await orderFromLx("FIR-PIZZABOX33", 8);
    const b = await orderFromLx("FIR-PIZZABOX33", 8);
    const c = await orderFromLx("FIR-PIZZABOX33", 8);
    await assignDelivery(lx, a.deliveryId, { driverId });
    await expect(assignDelivery(lx, b.deliveryId, { driverId })).rejects.toThrow(/switched off/);

    await expect(setVendorMultiOrder(lx, { enabled: true, max: 99 })).rejects.toThrow(/from 2 to 10/);
    await setVendorMultiOrder(lx, { enabled: true, max: 2 });
    await assignDelivery(lx, b.deliveryId, { driverId });
    await expect(assignDelivery(lx, c.deliveryId, { driverId })).rejects.toThrow(/maximum 2/);

    // Only Super Admin sets the policy (Operations can't).
    await expect(setMultiOrderPolicy(ops, { ...DEFAULT_POLICY, vendorsMayUse: false })).rejects.toThrow();
    await setMultiOrderPolicy(sa, { ...DEFAULT_POLICY, vendorsMayUse: false });
    await assignDelivery(lx, b.deliveryId, { driverId: null }); // unassign
    await expect(assignDelivery(lx, b.deliveryId, { driverId })).rejects.toThrow(/switched off/);
    await expect(setVendorMultiOrder(lx, { enabled: true, max: 3 })).rejects.toThrow(/switched off multi-order/);
    expect(await ordersPerDriver(lx.company.id, false)).toBe(1);

    // FIRINGI's own fleet follows the Super Admin switch.
    expect(await ordersPerDriver(ops.company.id, true)).toBe(1);
    await setMultiOrderPolicy(sa, { ...DEFAULT_POLICY, firingiFleet: true, firingiMax: 6 });
    expect(await ordersPerDriver(ops.company.id, true)).toBe(6);
    expect(await ordersPerDriver(lx.company.id, false)).toBe(2); // vendors allowed again → its own setting
    await setMultiOrderPolicy(sa, DEFAULT_POLICY);
    await setVendorMultiOrder(lx, { enabled: false, max: 2 });
    for (const x of [a, b]) await assignDelivery(lx, x.deliveryId, { driverId: null });
  });
});

describe("returns after delivery", () => {
  it("request → FIRINGI approves → supplier receives → credit note, stock back, order RETURNED", async () => {
    const lx = await ctxFor(LX_OWNER);
    const kebab = await ctxFor(KEBAB);
    const ops = await ctxFor(OPS);
    const { orderId, offerId } = await orderFromLx("FIR-PIZZABOX33", 8);
    // Not delivered yet → no returns.
    await expect(requestReturn(kebab, orderId, { lines: [], reason: "Damaged boxes" })).rejects.toThrow(/days after delivery/);
    for (const s of ["READY_FOR_PICKUP", "DISPATCHED", "OUT_FOR_DELIVERY", "DELIVERED"] as const) await changeOrderStatus(lx, orderId, s);
    const line = (await returnableLines(orderId)).lines[0];
    expect(line.returnable).toBe(8);

    await expect(requestReturn(kebab, orderId, { lines: [{ orderLineId: line.id, qty: 9 }], reason: "Damaged boxes" })).rejects.toThrow(/more than was delivered/);
    const r1 = await requestReturn(kebab, orderId, { lines: [{ orderLineId: line.id, qty: 3 }], reason: "3 boxes crushed", photos: [pngFile("crushed.png")] });
    expect((await returnableLines(orderId)).lines[0].returnable).toBe(5);
    // Only FIRINGI decides; the supplier can't receive before approval.
    await expect(reviewReturn(lx, r1.id, "APPROVED")).rejects.toThrow();
    await expect(receiveReturn(lx, r1.id, { restock: true })).rejects.toThrow(/approved/);
    await reviewReturn(ops, r1.id, "APPROVED");
    const before = await stockOf(offerId);
    await receiveReturn(lx, r1.id, { restock: true });
    const rr = await prisma.returnRequest.findUniqueOrThrow({ where: { id: r1.id } });
    expect(rr.status).toBe("CREDITED");
    const cn = await prisma.invoice.findUniqueOrThrow({ where: { id: rr.creditNoteId! }, include: { lines: true } });
    expect(cn.docType).toBe("CREDIT_NOTE");
    expect(Number(cn.lines[0].qty)).toBe(3);
    expect(await prisma.vendorBillingStatement.count({ where: { orderId, isCreditStatement: true } })).toBe(1);
    expect((await stockOf(offerId)).onHand).toBe(before.onHand + 3);
    expect(await orderStatus(orderId)).toBe("DELIVERED");

    // Rejected request needs a reason; the rest comes back damaged (no restock) → order RETURNED.
    const r2 = await requestReturn(kebab, orderId, { lines: [{ orderLineId: line.id, qty: 5 }], reason: "Wrong size delivered" });
    await expect(reviewReturn(ops, r2.id, "REJECTED")).rejects.toThrow(/reason/);
    await reviewReturn(ops, r2.id, "APPROVED");
    await receiveReturn(ops, r2.id, { restock: false });
    expect((await stockOf(offerId)).onHand).toBe(before.onHand + 3);
    expect(await orderStatus(orderId)).toBe("RETURNED");
    expect((await listReturns(kebab, "BUYER")).filter((r) => r.orderId === orderId)).toHaveLength(2);
    expect((await listReturns(lx, "VENDOR")).some((r) => r.id === r2.id)).toBe(true);
  });
});
