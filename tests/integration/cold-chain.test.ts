/**
 * Phase 42: cold chain & HACCP — classes (category default, supplier's choice, order line snapshot), readings at
 * dispatch / loading / handover / receipt, out of range: accepted, refused (temperature claim credited at once,
 * fault from the readings), blocked by FIRINGI's rule, everything refused = failed delivery; required handover
 * readings; the switches; loggers (API token, alert), equipment due + logs, receiving log, certificate, monthly
 * report, overview and breach counts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { changeOrderStatus, confirmOrder, placeOrder } from "@/server/services/orders";
import { addToCart, clearCart } from "@/server/services/cart";
import { setStock } from "@/server/services/vendor-catalogue";
import { assignDelivery, completeDelivery, failDelivery, pickUp, startDelivery } from "@/server/services/deliveries";
import * as C from "@/server/coldchain/service";
import { DEFAULT_COLD_CHAIN_SETTINGS } from "@/lib/cold-chain";
import * as A from "@/server/app/service";
import { ctxFor } from "../helpers";

const KEBAB = "owner@kebabhouse.test", LX = "owner@lisboacentral.test", SA = "superadmin@firingi.test", OPS = "ops@firingi.test", FIR_DRIVER = "driver@firingi.test";
const PNG = new File([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])], "sig.png", { type: "image/png" });
const CHILLED = "tc_chilled", FROZEN = "tc_frozen";
let mozz = "", arroz = "", addressId = "", kebabId = "", lxId = "", vehicleId = "";
const placed: string[] = [];

async function order(items: { offerId: string; qty: number }[]) {
  const kb = await ctxFor(KEBAB);
  await clearCart(kb);
  for (const i of items) await addToCart(kb, i.offerId, i.qty);
  const id = (await placeOrder(kb, { deliveryAddressId: addressId })).id;
  placed.push(id);
  return id;
}
async function toDriver(orderId: string) {
  const lx = await ctxFor(LX);
  await confirmOrder(lx, orderId, {});
  const d = await prisma.delivery.findUniqueOrThrow({ where: { orderId } });
  const driver = await prisma.driver.findFirstOrThrow({ where: { user: { email: FIR_DRIVER } } });
  if (d.mode !== "FIRINGI_FLEET") await prisma.delivery.update({ where: { id: d.id }, data: { mode: "FIRINGI_FLEET", executingCompanyId: (await prisma.company.findFirstOrThrow({ where: { type: "ADMIN" } })).id } });
  await prisma.delivery.updateMany({ where: { driverId: driver.id, status: { in: ["ASSIGNED", "PICKED_UP", "OUT_FOR_DELIVERY"] }, id: { not: d.id } }, data: { driverId: null, status: "UNASSIGNED", routeId: null } });
  await prisma.driver.update({ where: { id: driver.id }, data: { availability: "AVAILABLE" } });
  await assignDelivery(await ctxFor(OPS), d.id, { driverId: driver.id });
  await prisma.delivery.update({ where: { id: d.id }, data: { vehicleId } });
  await changeOrderStatus(lx, orderId, "READY_FOR_PICKUP");
  return d.id;
}
async function onTheWay(orderId: string) {
  const id = await toDriver(orderId);
  const drv = await ctxFor(FIR_DRIVER);
  await pickUp(drv, id);
  await startDelivery(drv, id);
  return id;
}
const settings = async (patch: Partial<typeof DEFAULT_COLD_CHAIN_SETTINGS>) => C.saveColdChainSettings(await ctxFor(SA), { ...DEFAULT_COLD_CHAIN_SETTINGS, ...patch });

beforeAll(async () => {
  const lx = await ctxFor(LX), kb = await ctxFor(KEBAB);
  lxId = lx.company.id; kebabId = kb.company.id;
  await prisma.setting.deleteMany({ where: { key: "coldchain.settings" } });
  const wh = await prisma.address.findFirstOrThrow({ where: { companyId: lxId, kind: { in: ["WAREHOUSE", "PICKUP"] } } });
  for (const sku of ["GRO-MOZZ2", "GRO-ARROZ1"]) {
    const o = await prisma.vendorOffer.findFirstOrThrow({ where: { vendorCompanyId: lxId, vendorSku: sku, status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
    const cur = await prisma.stockLevel.findUnique({ where: { offerId_addressId: { offerId: o.id, addressId: wh.id } } });
    await setStock(lx, o.id, wh.id, Math.max(400, (cur?.reserved ?? 0) + 300));
    if (sku === "GRO-MOZZ2") mozz = o.id; else arroz = o.id;
  }
  await prisma.vendorOffer.updateMany({ where: { id: { in: [mozz, arroz] } }, data: { tempClassId: null } });
  addressId = (await prisma.address.findFirstOrThrow({ where: { companyId: kebabId, kind: "DELIVERY", isActive: true }, orderBy: { isDefault: "desc" } })).id;
  const admin = await prisma.company.findFirstOrThrow({ where: { type: "ADMIN" } });
  vehicleId = (await prisma.vehicle.findFirst({ where: { ownerCompanyId: admin.id } }))?.id
    ?? (await prisma.vehicle.create({ data: { ownerCompanyId: admin.id, plate: "CC-42-FR", type: "refrigerated", isRefrigerated: true, status: "ACTIVE" } })).id;
});
afterAll(async () => {
  // orders left open would keep the mozzarella / rice reserved for the tests that follow (inventory counts free stock)
  const sa = await ctxFor(SA);
  // …and an assigned delivery would keep the FIRINGI demo driver "busy" (one open delivery per driver)
  const open = await prisma.order.findMany({ where: { id: { in: placed }, status: { notIn: ["DELIVERED", "CANCELLED", "RETURNED"] } }, select: { id: true } });
  await prisma.delivery.updateMany({ where: { orderId: { in: open.map((o) => o.id) }, status: { notIn: ["DELIVERED", "FAILED", "RETURNED", "CANCELLED"] } }, data: { status: "CANCELLED", driverId: null, routeId: null } });
  for (const o of open) await changeOrderStatus(sa, o.id, "CANCELLED", "test clean-up").catch((e) => console.warn("cold-chain clean-up:", o.id, (e as Error).message));
  await prisma.vendorOffer.updateMany({ where: { id: { in: [mozz, arroz] } }, data: { tempClassId: null } }).catch(() => null);
  await prisma.setting.deleteMany({ where: { key: "coldchain.settings" } });
  await prisma.$disconnect();
});

describe("classes", () => {
  it("FIRINGI's classes, category defaults, the supplier's choice", async () => {
    const sa = await ctxFor(SA), lx = await ctxFor(LX);
    const list = await C.listClasses("pt-PT");
    expect(list.find((c) => c.code === "CHILLED")).toMatchObject({ minC: 0, maxC: 4, toleranceC: 1, range: "0–4 °C", name: "Refrigerado (0–4 °C)" });
    expect(list.find((c) => c.code === "FROZEN")?.range).toBe("≤ −18 °C");
    await expect(C.saveClass(sa, { code: "x", nameEn: "X", coldChain: true })).rejects.toThrow(/2 to 30/);
    await expect(C.saveClass(sa, { code: "WARM", nameEn: "Warm", coldChain: true })).rejects.toThrow(/minimum or a maximum/);
    await expect(C.saveClass(sa, { code: "BAD", nameEn: "Bad", coldChain: true, minC: 5, maxC: 2 })).rejects.toThrow(/above the maximum/);
    await expect(C.saveClass(lx, { code: "MINE", nameEn: "Mine", coldChain: true, maxC: 8 })).rejects.toThrow();
    const cats = await C.categoryClasses(sa, "en");
    expect(cats.find((c) => c.name === "Cheese & Dairy")?.tempClassId).toBe(CHILLED);
    expect((await C.offerClasses([mozz, arroz])).get(mozz)).toBe(CHILLED); // category default
    expect((await C.offerClasses([arroz])).get(arroz)).toBeNull();
    await C.setOfferClass(lx, arroz, FROZEN);
    expect((await C.vendorOfferClasses(lx, "pt-PT")).find((o) => o.id === arroz)).toMatchObject({ own: FROZEN, effective: FROZEN });
    await C.setOfferClass(lx, arroz, null);
    expect((await C.offerColdBadges([mozz, arroz], "pt-PT")).get(mozz)).toEqual({ code: "CHILLED", name: "Refrigerado (0–4 °C)", range: "0–4 °C" });
  });
});

describe("along the way", () => {
  it("dispatch → loading → handover out of range, refused: temperature claim credited, driver's fault", async () => {
    await settings({});
    const lx = await ctxFor(LX), kb = await ctxFor(KEBAB);
    const id = await order([{ offerId: mozz, qty: 5 }, { offerId: arroz, qty: 4 }]);
    const lines = await prisma.orderLine.findMany({ where: { orderId: id } });
    expect(lines.find((l) => l.offerId === mozz)?.tempClassId).toBe(CHILLED);
    expect(lines.find((l) => l.offerId === arroz)?.tempClassId).toBeNull();
    await expect(C.recordDispatch(lx, id, { [CHILLED]: 3 })).rejects.toThrow(/between confirmation and dispatch/);
    await confirmOrder(lx, id, {});
    await expect(C.recordDispatch(kb, id, { [CHILLED]: 3 })).rejects.toThrow();
    await expect(C.recordDispatch(lx, id, { [FROZEN]: -20 })).rejects.toThrow(/no products of that/);
    expect((await C.recordDispatch(lx, id, { [CHILLED]: "2,5" }, "P-7")).statuses).toEqual({ [CHILLED]: "OK" });
    // toDriver confirms again — undo our confirmation by going through the helper's steps manually
    const d = await prisma.delivery.findUniqueOrThrow({ where: { orderId: id } });
    const driver = await prisma.driver.findFirstOrThrow({ where: { user: { email: FIR_DRIVER } } });
    if (d.mode !== "FIRINGI_FLEET") await prisma.delivery.update({ where: { id: d.id }, data: { mode: "FIRINGI_FLEET", executingCompanyId: (await prisma.company.findFirstOrThrow({ where: { type: "ADMIN" } })).id } });
    await prisma.delivery.updateMany({ where: { driverId: driver.id, status: { in: ["ASSIGNED", "PICKED_UP", "OUT_FOR_DELIVERY"] }, id: { not: d.id } }, data: { driverId: null, status: "UNASSIGNED", routeId: null } });
    await prisma.driver.update({ where: { id: driver.id }, data: { availability: "AVAILABLE" } });
    await assignDelivery(await ctxFor(OPS), d.id, { driverId: driver.id });
    await prisma.delivery.update({ where: { id: d.id }, data: { vehicleId } });
    await changeOrderStatus(lx, id, "READY_FOR_PICKUP");
    const drv = await ctxFor(FIR_DRIVER);
    expect((await C.recordLoading(drv, d.id, { [CHILLED]: 3.5 })).statuses[CHILLED]).toBe("OK");
    await expect(C.recordLoading(lx, d.id, { [CHILLED]: 3 })).rejects.toThrow();
    await pickUp(drv, d.id);
    await startDelivery(drv, d.id);
    const stop = await C.stopClasses(id, "pt-PT");
    expect(stop.classes).toEqual([expect.objectContaining({ id: CHILLED, loaded: 3.5, range: "0–4 °C" })]);
    await expect(completeDelivery(drv, d.id, { recipientName: "Ahmed", signature: PNG, temps: { [CHILLED]: 3 }, refuseClasses: [CHILLED] })).rejects.toThrow(/only be refused .* out of range/);
    await completeDelivery(drv, d.id, { recipientName: "Ahmed", signature: PNG, temps: { [CHILLED]: 9 }, refuseClasses: [CHILLED] });
    const inc = await prisma.coldIncident.findFirstOrThrow({ where: { orderId: id, stage: "HANDOVER" } });
    expect(inc).toMatchObject({ decision: "REFUSED", fault: "DRIVER" });
    const claim = await prisma.qualityClaim.findUniqueOrThrow({ where: { id: inc.claimId! }, include: { lines: true } });
    expect(claim).toMatchObject({ reason: "TEMPERATURE", status: "APPROVED", outcome: "CREDIT", fault: "DRIVER" });
    expect(claim.lines).toEqual([expect.objectContaining({ qty: 5, approvedQty: 5 })]);
    const inv = await prisma.invoice.findFirstOrThrow({ where: { orderId: id, docType: "INVOICE" }, include: { lines: true } });
    const mozzLine = inv.lines.find((l) => l.orderLineId === lines.find((x) => x.offerId === mozz)!.id)!;
    const cn = await prisma.invoice.findFirstOrThrow({ where: { originalInvoiceId: inv.id, docType: "CREDIT_NOTE" } });
    expect(Number(cn.netTotal)).toBeCloseTo(Number(mozzLine.lineNet), 2);
    expect(await prisma.notificationMessage.count({ where: { eventKey: "coldchain.breach", refId: inc.id } })).toBeGreaterThan(0);
    // the readings in order, on the order card
    const card = await C.orderColdChain(lx, id, "SUPPLIER", "pt-PT");
    expect(card!.classes[0].readings.map((r) => `${r.stage}:${r.status}`)).toEqual(["DISPATCH:OK", "LOADING:OK", "HANDOVER:OUT"]);
    expect(card!.incidents[0]).toMatchObject({ decision: "REFUSED", fault: "DRIVER", claim: { number: claim.number } });
    expect((await C.orderColdChain(kb, id, "BUYER", "pt-PT"))!.incidents[0].fault).toBeNull(); // the customer doesn't see fault
  });

  it("FIRINGI's block rule refuses out-of-range goods; nothing recorded before on its fleet = FIRINGI's fault", async () => {
    await settings({ actions: { ...DEFAULT_COLD_CHAIN_SETTINGS.actions, block: true } });
    const id = await order([{ offerId: mozz, qty: 5 }, { offerId: arroz, qty: 4 }]);
    const did = await onTheWay(id);
    await completeDelivery(await ctxFor(FIR_DRIVER), did, { recipientName: "Ahmed", signature: PNG, temps: { [CHILLED]: "8,0" as unknown as number } });
    const inc = await prisma.coldIncident.findFirstOrThrow({ where: { orderId: id } });
    expect(inc).toMatchObject({ decision: "BLOCKED", fault: "FIRINGI" });
    expect(await prisma.qualityClaim.count({ where: { id: inc.claimId!, fault: "FIRINGI", status: "APPROVED" } })).toBe(1);
  });

  it("everything refused is not a delivery: a failed delivery (temperature) instead", async () => {
    await settings({});
    const id = await order([{ offerId: mozz, qty: 5 }]);
    const did = await onTheWay(id);
    const drv = await ctxFor(FIR_DRIVER);
    await expect(completeDelivery(drv, did, { recipientName: "Ahmed", signature: PNG, temps: { [CHILLED]: 10 }, refuseClasses: [CHILLED] })).rejects.toThrow(/failed delivery/);
    expect((await prisma.delivery.findUniqueOrThrow({ where: { id: did } })).status).toBe("OUT_FOR_DELIVERY");
    expect(await prisma.tempReading.count({ where: { orderId: id, stage: "HANDOVER" } })).toBe(0); // rolled back
    await failDelivery(drv, did, { reasonCode: "TEMPERATURE", note: "10 °C" });
    expect((await prisma.delivery.findUniqueOrThrow({ where: { id: did } })).status).toBe("FAILED");
  });

  it("accepted out of range is noted; the handover reading can be required; switches off", async () => {
    await settings({ requireHandover: true });
    const id = await order([{ offerId: mozz, qty: 5 }]);
    const did = await onTheWay(id);
    const drv = await ctxFor(FIR_DRIVER);
    await expect(completeDelivery(drv, did, { recipientName: "Ahmed", signature: PNG })).rejects.toThrow(/Record the temperature/);
    await completeDelivery(drv, did, { recipientName: "Ahmed", signature: PNG, temps: { [CHILLED]: 6.5 } });
    expect(await prisma.coldIncident.findFirstOrThrow({ where: { orderId: id } })).toMatchObject({ decision: "ACCEPTED", claimId: null });
    // receipt by the customer
    const kb = await ctxFor(KEBAB);
    expect((await C.recordReceipt(kb, id, { [CHILLED]: 4.6 })).statuses[CHILLED]).toBe("WARN");
    await settings({ record: { ...DEFAULT_COLD_CHAIN_SETTINGS.record, customerReceipt: false, supplierDispatch: false }, actions: { ...DEFAULT_COLD_CHAIN_SETTINGS.actions, customerRefuse: false } });
    await expect(C.recordReceipt(kb, id, { [CHILLED]: 4 })).rejects.toThrow(/switched off/);
    const id2 = await order([{ offerId: mozz, qty: 5 }, { offerId: arroz, qty: 4 }]);
    await confirmOrder(await ctxFor(LX), id2, {});
    await expect(C.recordDispatch(await ctxFor(LX), id2, { [CHILLED]: 3 })).rejects.toThrow(/switched off/);
    await settings({});
  });
});

describe("records", () => {
  it("receiving log (incl. outside suppliers), certificate data, monthly report", async () => {
    const kb = await ctxFor(KEBAB), lx = await ctxFor(LX);
    await expect(C.addReceivingEntry(kb, { supplierName: "x", product: "y", tempClassId: CHILLED, valueC: 3, accepted: true })).rejects.toThrow(/supplier and the product/);
    await C.addReceivingEntry(kb, { supplierName: "Talho do Bairro", product: "Frango inteiro", tempClassId: CHILLED, valueC: "3,2", accepted: true });
    await C.addReceivingEntry(kb, { supplierName: "Peixaria Sul", product: "Robalo", tempClassId: "tc_fresh_fish", valueC: 6, accepted: false, note: "Devolvido" });
    const ym = new Date().toISOString().slice(0, 7);
    const log = await C.receivingLog(kb, ym, "pt-PT");
    expect(log.some((r) => r.supplier === "Talho do Bairro" && r.status === "OK")).toBe(true);
    expect(log.some((r) => r.supplier === "Peixaria Sul" && r.status === "OUT" && r.accepted === false)).toBe(true);
    expect(log.some((r) => r.order && r.stage === "HANDOVER")).toBe(true);
    const delivered = await prisma.coldIncident.findFirstOrThrow({ where: { decision: "REFUSED", buyerId: kebabId }, orderBy: { createdAt: "desc" } });
    const cert = await C.certificateData(kb, delivered.orderId);
    expect(cert.classes[0].readings.length).toBeGreaterThanOrEqual(3);
    expect(cert.incidents[0].decision).toBe("REFUSED");
    const rep = await C.monthlyReport(lx, ym, "pt-PT");
    expect(rep.side).toBe("SUPPLIER");
    expect(rep.rows.length).toBeGreaterThan(3);
    expect(rep.rows.every((r) => r.counterpart !== "Talho do Bairro")).toBe(true); // the customer's own log isn't the supplier's
    const buyerRep = await C.monthlyReport(kb, ym, "pt-PT");
    expect(buyerRep.rows.some((r) => r.counterpart === "Peixaria Sul")).toBe(true);
    expect(C.reportCsv(buyerRep).split("\n")[0]).toBe("date;time;order;counterpart;product;stage;class;range;temperature_c;status;accepted");
    await expect(C.monthlyReport(kb, "2026-13", "pt-PT")).rejects.toThrow(/month/);
  });

  it("loggers push readings (token), alert when out of range too long; trip summary on the order", async () => {
    const sa = await ctxFor(SA);
    const { id, token } = await C.createLogger(sa, { name: "Carrinha CC-42", vehicleId, tempClassId: CHILLED });
    await expect(C.ingestReadings("fcl_wrong", { value: 3 })).rejects.toThrow(/Unknown/);
    await expect(C.ingestReadings(token, { readings: [{ value: 200 }] })).rejects.toThrow(/temperature/);
    const now = Date.now();
    const readings = Array.from({ length: 12 }, (_, i) => ({ at: new Date(now - (11 - i) * 3 * 60_000).toISOString(), value: i < 3 ? 3 : 8.5 }));
    expect((await C.ingestReadings(token, { readings })).stored).toBe(12);
    expect((await C.ingestReadings(token, { readings })).stored).toBe(0); // repeated times ignored
    expect(await prisma.notificationMessage.count({ where: { eventKey: "coldchain.logger_alert", refId: id } })).toBeGreaterThan(0);
    const lg = (await C.listEquipment(sa, "en")).loggers.find((l) => l.id === id)!;
    expect(lg).toMatchObject({ status: "OUT", lastValueC: 8.5 });
    // a delivery on that vehicle during these readings gets the trip summary
    const ord = await order([{ offerId: mozz, qty: 5 }, { offerId: arroz, qty: 4 }]);
    const did = await onTheWay(ord);
    await prisma.delivery.update({ where: { id: did }, data: { pickedUpAt: new Date(now - 40 * 60_000) } });
    const card = await C.orderColdChain(sa, ord, "ADMIN", "en");
    expect(card!.trip).toMatchObject({ count: 12, minC: 3, maxC: 8.5 });
    expect(card!.trip!.minutesOut).toBeGreaterThanOrEqual(24);
    await completeDelivery(await ctxFor(FIR_DRIVER), did, { recipientName: "Ahmed", signature: PNG, temps: { [CHILLED]: 3 } });
    await C.setLoggerActive(sa, id, false);
    await expect(C.ingestReadings(token, { value: 3 })).rejects.toThrow(/inactive/);
  });

  it("equipment: checks / cleaning / calibration due, reminders, logs", async () => {
    const lx = await ctxFor(LX);
    await expect(C.saveEquipment(lx, { kind: "COLD_ROOM", name: "", checkEveryDays: 1 })).rejects.toThrow(/name/);
    const e = await C.saveEquipment(lx, { kind: "COLD_ROOM", name: "Câmara 1", tempClassId: CHILLED, checkEveryDays: 1, cleanEveryDays: 7, calibrateEveryDays: 365 });
    await prisma.coldEquipment.update({ where: { id: e.id }, data: { createdAt: new Date(Date.now() - 3 * 86_400_000) } });
    const r = await C.runColdChainJob();
    expect(r.reminders).toBeGreaterThanOrEqual(1);
    expect(await prisma.notificationMessage.count({ where: { eventKey: "coldchain.equipment_due", refId: e.id } })).toBeGreaterThan(0);
    expect((await C.runColdChainJob()).reminders).toBe(0); // once a week per item
    await expect(C.addEquipmentLog(lx, e.id, { kind: "CHECK", ok: false })).rejects.toThrow(/what was wrong/);
    await C.addEquipmentLog(lx, e.id, { kind: "CHECK", ok: true, valueC: "2,8" });
    const row = (await C.listEquipment(lx, "pt-PT")).equipment.find((x) => x.id === e.id)!;
    expect(row.due.find((d) => d.kind === "CHECK")?.overdue).toBe(false);
    expect(row.due.find((d) => d.kind === "CLEANING")?.overdue).toBe(false);
    expect(row.logs[0]).toMatchObject({ kind: "CHECK", ok: true, valueC: 2.8 });
    await expect(C.saveEquipment(await ctxFor(KEBAB), { kind: "FREEZER", name: "x" })).rejects.toThrow();
  });

  it("overview, breach counts, the driver's stop data", async () => {
    const sa = await ctxFor(SA), lx = await ctxFor(LX);
    const ov = await C.coldOverview(sa, "en");
    expect(ov.totals.incidents).toBeGreaterThanOrEqual(3);
    expect(ov.totals.refused).toBeGreaterThanOrEqual(2);
    expect(ov.suppliers.find((s) => s.id === lxId)?.refused).toBeGreaterThanOrEqual(2);
    expect(ov.drivers.length).toBeGreaterThanOrEqual(1);
    const mine = await C.coldOverview(lx, "pt-PT");
    expect(mine.incidents.every((i) => i.supplier.includes("Lisboa"))).toBe(true);
    const b = await C.breachCounts(30);
    expect(b.bySeller.get(lxId)).toBeGreaterThanOrEqual(3);
    const id = await order([{ offerId: mozz, qty: 5 }, { offerId: arroz, qty: 4 }]);
    await toDriver(id);
    const snap = (await A.snapshot(await ctxFor(FIR_DRIVER), "driver", "pt-PT")).driver as unknown as { stops: { number: string; cold: { classes: { id: string }[] } | null }[] };
    const no = (await prisma.order.findUniqueOrThrow({ where: { id } })).number;
    expect(snap.stops.find((s) => s.number === no)?.cold?.classes).toEqual([expect.objectContaining({ id: CHILLED })]);
    // finish the stop so the FIRINGI driver and the stock are free for the tests that follow
    const drv = await ctxFor(FIR_DRIVER), did = (await prisma.delivery.findUniqueOrThrow({ where: { orderId: id } })).id;
    await pickUp(drv, did); await startDelivery(drv, did);
    await completeDelivery(drv, did, { recipientName: "Ahmed", signature: PNG, temps: { [CHILLED]: "3,0" as unknown as number } });
  });
});
