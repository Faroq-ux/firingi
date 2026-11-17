/**
 * Phase 40: returnables & deposits — deposit items (crates) and refill swaps (gas cylinders): deposits on the
 * delivery invoice and the supplier's statement, empties counted by the driver, the supplier's check with
 * refunds by credit note (never more than was paid), disputes decided by FIRINGI, drop-offs, opening
 * balances, pickups, the overdue rule, the VAT rule per country.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { changeOrderStatus, confirmOrder, placeOrder } from "@/server/services/orders";
import { addToCart, clearCart } from "@/server/services/cart";
import { setStock } from "@/server/services/vendor-catalogue";
import { assignDelivery, completeDelivery, pickUp, startDelivery } from "@/server/services/deliveries";
import { addDriver } from "@/server/services/fleet";
import * as R from "@/server/returnables/service";
import { ageUnits, chargedUnits, DEFAULT_RETURNABLE_SETTINGS, depositVatRate, overdueUnits, splitEmpties, unitsFor } from "@/lib/returnables";
import * as A from "@/server/app/service";
import { ctxFor } from "../helpers";

const KEBAB = "owner@kebabhouse.test", LX = "owner@lisboacentral.test", SA = "superadmin@firingi.test", OPS = "ops@firingi.test", FIR_DRIVER = "driver@firingi.test";
const PNG = new File([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])], "sig.png", { type: "image/png" });
let mozz = "", arroz = "", addressId = "", kebabId = "", lxId = "";
const CRATE = "rt_crate_24", GAS = "rt_gas_butane_13";

async function deliver(orderId: string, empties: Record<string, number> | null) {
  const lx = await ctxFor(LX);
  await confirmOrder(lx, orderId, {});
  const d = await prisma.delivery.findUniqueOrThrow({ where: { orderId } });
  const driver = await prisma.driver.findFirstOrThrow({ where: { user: { email: FIR_DRIVER } } });
  if (d.mode !== "FIRINGI_FLEET") await prisma.delivery.update({ where: { id: d.id }, data: { mode: "FIRINGI_FLEET", executingCompanyId: (await prisma.company.findFirstOrThrow({ where: { type: "ADMIN" } })).id } });
  await prisma.delivery.updateMany({ where: { driverId: driver.id, status: { in: ["ASSIGNED", "PICKED_UP", "OUT_FOR_DELIVERY"] }, id: { not: d.id } }, data: { driverId: null, status: "UNASSIGNED", routeId: null } });
  await prisma.driver.update({ where: { id: driver.id }, data: { availability: "AVAILABLE" } });
  await assignDelivery(await ctxFor(OPS), d.id, { driverId: driver.id });
  await changeOrderStatus(lx, orderId, "READY_FOR_PICKUP");
  const drv = await ctxFor(FIR_DRIVER);
  await pickUp(drv, d.id);
  await startDelivery(drv, d.id);
  await completeDelivery(drv, d.id, { recipientName: "Ahmed", signature: PNG, empties });
  return prisma.invoice.findFirstOrThrow({ where: { orderId, docType: "INVOICE" }, include: { lines: true } });
}
async function order(items: { offerId: string; qty: number }[]) {
  const kb = await ctxFor(KEBAB);
  await clearCart(kb);
  for (const i of items) await addToCart(kb, i.offerId, i.qty);
  return (await placeOrder(kb, { deliveryAddressId: addressId })).id;
}
const held = async (typeId: string) => (await R.holdings({ customerCompanyId: kebabId, supplierCompanyId: lxId, typeId }))[0]?.qty ?? 0;
const depositLine = (inv: { lines: { description: string; qty: unknown; lineNet: unknown; taxRate: unknown }[] }, code: string) => inv.lines.find((l) => l.description.endsWith(`[${code}]`));

beforeAll(async () => {
  const lx = await ctxFor(LX), kb = await ctxFor(KEBAB);
  lxId = lx.company.id; kebabId = kb.company.id;
  await prisma.setting.deleteMany({ where: { key: { in: ["returnables.settings", "returnables.reminded"] } } });
  const wh = await prisma.address.findFirstOrThrow({ where: { companyId: lxId, kind: { in: ["WAREHOUSE", "PICKUP"] } } });
  for (const sku of ["GRO-MOZZ2", "GRO-ARROZ1"]) {
    const o = await prisma.vendorOffer.findFirstOrThrow({ where: { vendorCompanyId: lxId, vendorSku: sku, status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
    const cur = await prisma.stockLevel.findUnique({ where: { offerId_addressId: { offerId: o.id, addressId: wh.id } } });
    await setStock(lx, o.id, wh.id, Math.max(400, (cur?.reserved ?? 0) + 300));
    if (sku === "GRO-MOZZ2") mozz = o.id; else arroz = o.id;
  }
  addressId = (await prisma.address.findFirstOrThrow({ where: { companyId: kebabId, kind: "DELIVERY", isActive: true }, orderBy: { isDefault: "desc" } })).id;
  // clean slate for Kebab House × Lisboa Central
  await prisma.returnableMovement.deleteMany({ where: { customerCompanyId: kebabId } });
  await prisma.emptiesReturn.deleteMany({ where: { customerCompanyId: kebabId } });
  await prisma.emptiesPickup.deleteMany({ where: { customerCompanyId: kebabId } });
  await prisma.offerReturnable.deleteMany({ where: { offerId: { in: [mozz, arroz] } } });
});
afterAll(async () => {
  await prisma.offerReturnable.deleteMany({ where: { offerId: { in: [mozz, arroz] } } });
  await prisma.setting.deleteMany({ where: { key: { in: ["returnables.settings", "returnables.reminded"] } } });
  await prisma.$disconnect();
});

describe("pure rules", () => {
  it("units, swaps, charged deposits, VAT per country, ageing", () => {
    expect([...unitsFor([{ offerId: "a", qty: 3 }, { offerId: "b", qty: 2 }], [{ offerId: "a", typeId: "crate", qtyPerUnit: 1 }, { offerId: "a", typeId: "bottle", qtyPerUnit: 24 }, { offerId: "b", typeId: "crate", qtyPerUnit: 2 }])])
      .toEqual([["crate", 7], ["bottle", 72]]);
    expect(splitEmpties({ gas: 5, crate: 3, x: 0 }, [{ typeId: "gas", kind: "EXCHANGE", qtyOut: 2 }, { typeId: "crate", kind: "DEPOSIT", qtyOut: 4 }])).toEqual({ swaps: { gas: 2 }, returns: { gas: 3, crate: 3 } });
    expect(chargedUnits("EXCHANGE", 5, 3)).toBe(2);
    expect(chargedUnits("EXCHANGE", 2, 9)).toBe(0);
    expect(chargedUnits("DEPOSIT", 4, 4)).toBe(4);
    const s = { ...DEFAULT_RETURNABLE_SETTINGS, vat: { PT: { mode: "NONE" as const }, ES: { mode: "FIXED" as const, rate: 10 } } };
    expect(depositVatRate(s, "PT", [23, 6])).toBe(0);
    expect(depositVatRate(s, "ES", [21])).toBe(10);
    expect(depositVatRate(s, "DE", [7, 19])).toBe(19);
    const d = (days: number) => new Date(Date.now() - days * 86_400_000);
    const lots = ageUnits([{ qty: 5, at: d(100) }, { qty: -3, at: d(50) }, { qty: 4, at: d(10) }]);
    expect(lots.map((l) => l.qty)).toEqual([2, 4]);
    expect(overdueUnits(lots, 90)).toBe(2);
    expect(overdueUnits(lots, 5)).toBe(6);
  });
});

describe("types and product links", () => {
  it("suppliers add their own items and link products; FIRINGI keeps the shared list", async () => {
    const lx = await ctxFor(LX);
    const own = await R.saveType(lx, { code: "lx keg 20", name: "Barril 20 L", category: "KEG", kind: "EXCHANGE", depositNet: 20 }, "pt-PT");
    expect(own).toMatchObject({ code: "LX-KEG-20", ownerCompanyId: lxId });
    await expect(R.saveType(lx, { code: "LX-KEG-20", name: "Outro", category: "KEG", kind: "EXCHANGE", depositNet: 5 })).rejects.toThrow(/already/);
    await expect(R.saveType(lx, { code: "X1", name: "Bad", category: "SPACESHIP", kind: "DEPOSIT", depositNet: 1 })).rejects.toThrow(/kind of item/);
    const list = await R.listTypes(lx, "pt-PT");
    expect(list.some((t) => t.code === "CRATE-24" && t.shared && t.name.startsWith("Grade"))).toBe(true);
    expect(list.some((t) => t.code === "LX-KEG-20" && t.mine)).toBe(true);
    // another supplier doesn't see Lisboa's own item
    const other = await prisma.user.findFirst({ where: { memberships: { some: { company: { type: "DISTRIBUTOR", id: { not: lxId } } } } } });
    if (other) expect((await R.listTypes(await ctxFor(other.email))).some((t) => t.code === "LX-KEG-20")).toBe(false);
    await R.linkOffer(lx, arroz, CRATE, 1);
    await R.linkOffer(lx, mozz, GAS, 1);
    await expect(R.linkOffer(lx, mozz, own.id, 0)).rejects.toThrow(/1 to 1000/);
    const view = await R.offerReturnables([mozz, arroz], "pt-PT");
    expect(view[mozz]).toEqual([expect.objectContaining({ code: "GAS-BUTANE-13", kind: "EXCHANGE", depositNet: 25 })]);
    expect(view[arroz][0]).toMatchObject({ code: "CRATE-24", kind: "DEPOSIT", depositNet: 3, qtyPerUnit: 1 });
    await prisma.returnableType.delete({ where: { id: own.id } });
  });
});

describe("deposits on the invoice", () => {
  it("first delivery: every unit carries its deposit (outside VAT in Portugal); the supplier's statement has the same", async () => {
    const id = await order([{ offerId: arroz, qty: 4 }, { offerId: mozz, qty: 3 }]);
    expect(await R.orderReturnables(id)).toEqual(expect.arrayContaining([expect.objectContaining({ code: "CRATE-24", qtyOut: 4, estimatedQty: 4 }), expect.objectContaining({ code: "GAS-BUTANE-13", qtyOut: 3, swapPlanned: 0, estimatedQty: 3 })]));
    const inv = await deliver(id, {});
    expect(depositLine(inv, "CRATE-24")).toMatchObject({ qty: expect.anything() });
    expect(Number(depositLine(inv, "CRATE-24")!.qty)).toBe(4);
    expect(Number(depositLine(inv, "CRATE-24")!.lineNet)).toBe(12);
    expect(Number(depositLine(inv, "GAS-BUTANE-13")!.lineNet)).toBe(75);
    expect(Number(depositLine(inv, "GAS-BUTANE-13")!.taxRate)).toBe(0);
    const st = await prisma.vendorBillingStatement.findFirstOrThrow({ where: { orderId: id, isCreditStatement: false } });
    const stLines = st.lines as { sku: string; lineNet: string; commission: string }[];
    expect(stLines.find((l) => l.sku === "DEPOSIT:CRATE-24")).toMatchObject({ lineNet: "12.00", commission: "0" });
    expect(await held(CRATE)).toBe(4);
    expect(await held(GAS)).toBe(3);
  });

  it("refill: the empties the buyer holds are swapped by default; the driver's count decides; extra empties wait for the supplier", async () => {
    const id = await order([{ offerId: mozz, qty: 5 }]);
    expect((await R.orderReturnables(id))[0]).toMatchObject({ code: "GAS-BUTANE-13", qtyOut: 5, swapPlanned: 3, estimatedQty: 2 });
    // the driver sees what can be taken back
    const drvSnap = async () => (await A.snapshot(await ctxFor(FIR_DRIVER), "driver", "pt-PT")).driver!.stops;
    const inv = await deliver(id, { [GAS]: 3, [CRATE]: 4 });
    expect(Number(depositLine(inv, "GAS-BUTANE-13")!.qty)).toBe(2); // 5 full out, 3 swapped
    expect(depositLine(inv, "CRATE-24")).toBeUndefined();
    expect(await held(GAS)).toBe(5);
    expect(await held(CRATE)).toBe(4); // not until the supplier checks
    const ret = await prisma.emptiesReturn.findFirstOrThrow({ where: { orderId: id }, include: { lines: true } });
    expect(ret).toMatchObject({ source: "DELIVERY", status: "COLLECTED" });
    expect(ret.lines).toEqual([expect.objectContaining({ typeId: CRATE, counted: 4 })]);
    expect(Array.isArray(await drvSnap())).toBe(true);
  });

  it("the supplier checks: good empties refunded by credit note, damaged and missing not; the customer contests; FIRINGI decides", async () => {
    const lx = await ctxFor(LX), kb = await ctxFor(KEBAB);
    const ret = await prisma.emptiesReturn.findFirstOrThrow({ where: { customerCompanyId: kebabId, status: "COLLECTED" } });
    await expect(R.confirmReturn(lx, ret.id, [{ typeId: CRATE, accepted: 4, damaged: 1 }])).rejects.toThrow(/more than were counted/);
    const done = await R.confirmReturn(lx, ret.id, [{ typeId: CRATE, accepted: 2, damaged: 1 }]);
    expect(done.status).toBe("CONFIRMED");
    expect(Number(done.creditGross)).toBe(6);
    expect(await held(CRATE)).toBe(1); // 3 taken back, 1 missing
    const cn = await prisma.invoice.findFirstOrThrow({ where: { id: done.creditNoteIds[0] }, include: { lines: true } });
    expect(cn).toMatchObject({ docType: "CREDIT_NOTE" });
    expect(cn.lines[0].description).toMatch(/CRATE-24/);
    expect(await prisma.vendorBillingStatement.count({ where: { salesInvoiceId: cn.id, isCreditStatement: true } })).toBe(1);
    await expect(R.confirmReturn(lx, ret.id, [])).rejects.toThrow(/already checked/);
    // the customer says 3 were good
    await expect(R.disputeReturn(kb, ret.id, "no")).rejects.toThrow(/why/);
    await R.disputeReturn(kb, ret.id, "We handed over 4 crates, only one was broken");
    await expect(R.resolveDispute(lx, ret.id, "CUSTOMER", "x")).rejects.toThrow();
    const res = await R.resolveDispute(await ctxFor(SA), ret.id, "CUSTOMER", "Driver's count stands");
    expect(res.status).toBe("RESOLVED");
    expect(Number(res.creditGross)).toBe(9); // one more crate refunded
    expect(await held(CRATE)).toBe(0);
  });

  it("refunds never exceed the deposits paid: an opening balance brought back is taken but not refunded", async () => {
    const lx = await ctxFor(LX);
    await expect(R.adjustBalance(lx, kebabId, CRATE, -5, "fix")).rejects.toThrow(/holds 0/);
    await R.adjustBalance(lx, kebabId, CRATE, 6, "Opening balance");
    expect(await held(CRATE)).toBe(6);
    const r = await R.recordDropOff(lx, kebabId, [{ typeId: CRATE, accepted: 6, damaged: 0 }], "Brought to the warehouse");
    expect(r.status).toBe("CONFIRMED");
    expect(r.lines[0]).toMatchObject({ counted: 6, accepted: 6, credited: 1 }); // 4 paid, 3 refunded before → 1 left
    expect(Number(r.creditGross)).toBe(3);
    expect(await held(CRATE)).toBe(0);
  });
});

describe("collections", () => {
  it("the customer asks; the supplier plans a driver; the driver collects; the supplier checks", async () => {
    const kb = await ctxFor(KEBAB), lx = await ctxFor(LX);
    await expect(R.requestPickup(kb, { supplierId: lxId, addressId, lines: [{ typeId: GAS, qty: 99 }] })).rejects.toThrow(/You hold 5/);
    const p = await R.requestPickup(kb, { supplierId: lxId, addressId, lines: [{ typeId: GAS, qty: 2 }], note: "Back door" });
    await expect(R.requestPickup(kb, { supplierId: lxId, addressId, lines: [{ typeId: GAS, qty: 1 }] })).rejects.toThrow(/already asked/);
    const email = `empties.${Date.now().toString(36)}@lisboacentral.test`;
    const added = await addDriver(lx, { name: "Rita Vasilhame", email, password: "Driver!2026x", licenceNumber: "LX-404040" });
    await prisma.driver.update({ where: { id: added.id }, data: { status: "APPROVED" } });
    const driver = await prisma.driver.findUniqueOrThrow({ where: { id: added.id }, include: { user: true } });
    await R.planPickup(lx, p.id, driver.id, new Date(Date.now() + 86_400_000));
    const drv = await ctxFor(driver.user.email);
    const mine = await R.driverPickups(drv, "pt-PT");
    expect(mine.find((x) => x.id === p.id)?.items).toEqual(expect.arrayContaining([expect.objectContaining({ code: "GAS-BUTANE-13", held: 5, expected: 2 })]));
    const ret = await R.collectPickup(drv, p.id, { [GAS]: 2 });
    expect(ret).toMatchObject({ source: "PICKUP" });
    await expect(R.collectPickup(drv, p.id, { [GAS]: 2 })).rejects.toThrow(/not planned/);
    const ok = await R.confirmReturn(lx, ret!.id, [{ typeId: GAS, accepted: 2, damaged: 0 }]);
    expect(Number(ok.creditGross)).toBe(50);
    expect(await held(GAS)).toBe(3);
    const view = await R.buyerOverview(kb, "pt-PT");
    expect(view.balances.find((b) => b.typeId === GAS)).toMatchObject({ held: 3, paid: 3, depositValue: 75 });
    expect(view.pickups[0]).toMatchObject({ status: "COLLECTED" });
    const st = await R.statement(kb, "CUSTOMER", {});
    expect(st.at(-1)).toMatchObject({ kind: "RETURN", qty: -2, balance: 3, code: "GAS-BUTANE-13" });
  });
});

describe("overdue and VAT settings", () => {
  it("reminds once per period, or keeps the deposit when the admin says so (per supplier)", async () => {
    const sa = await ctxFor(SA);
    await expect(R.saveReturnableSettings(await ctxFor(LX), DEFAULT_RETURNABLE_SETTINGS)).rejects.toThrow();
    await R.saveReturnableSettings(sa, { ...DEFAULT_RETURNABLE_SETTINGS, overdue: { days: 30, action: "REMIND", remindEveryDays: 7 } });
    await prisma.returnableMovement.updateMany({ where: { customerCompanyId: kebabId, typeId: GAS }, data: { at: new Date(Date.now() - 60 * 86_400_000) } });
    expect((await R.runReturnablesJob()).reminded).toBe(1);
    expect((await R.runReturnablesJob()).reminded).toBe(0);
    await R.saveReturnableSettings(sa, { ...DEFAULT_RETURNABLE_SETTINGS, overdue: { days: 30, action: "REMIND", remindEveryDays: 7 }, suppliers: { [lxId]: { days: 30, action: "KEEP" } } });
    expect((await R.runReturnablesJob()).kept).toBe(1);
    expect(await held(GAS)).toBe(0);
    // kept units can't be refunded any more
    const lx = await ctxFor(LX);
    await R.adjustBalance(lx, kebabId, GAS, 1, "found one");
    const r = await R.recordDropOff(lx, kebabId, [{ typeId: GAS, accepted: 1, damaged: 0 }], null);
    expect(r.lines[0].credited).toBe(0);
  });

  it("a fixed deposit VAT rate in the buyer's country goes on the invoice", async () => {
    await R.saveReturnableSettings(await ctxFor(SA), { ...DEFAULT_RETURNABLE_SETTINGS, vat: { PT: { mode: "FIXED", rate: 23 } } });
    const id = await order([{ offerId: arroz, qty: 5 }]);
    const inv = await deliver(id, null);
    const l = depositLine(inv, "CRATE-24")!;
    expect(Number(l.taxRate)).toBe(23);
    expect(Number(l.lineNet)).toBe(15);
    expect(Number((l as unknown as { lineVat: unknown }).lineVat)).toBe(3.45);
  });
});

describe("cart and offline delivery", () => {
  it("the cart estimates deposits and lets the buyer choose the empties to swap; the offline driver's count travels with the delivery", async () => {
    await R.saveReturnableSettings(await ctxFor(SA), DEFAULT_RETURNABLE_SETTINGS);
    const kb = await ctxFor(KEBAB), lx = await ctxFor(LX);
    await R.adjustBalance(lx, kebabId, GAS, 2, "Opening balance");
    await clearCart(kb);
    await addToCart(kb, mozz, 5);
    let c = await R.cartReturnables(kb, "pt-PT");
    expect(c!.lines[0]).toMatchObject({ code: "GAS-BUTANE-13", qtyOut: 5, held: 2, swap: 2, charged: 3, depositTotal: 75 });
    await R.setCartSwap(kb, lxId, GAS, 1);
    c = await R.cartReturnables(kb, "pt-PT");
    expect(c!.lines[0]).toMatchObject({ swap: 1, charged: 4 });
    const id = (await placeOrder(kb, { deliveryAddressId: addressId })).id;
    expect((await prisma.cart.findFirstOrThrow({ where: { buyerCompanyId: kebabId, userId: kb.user.id } })).emptySwaps).toBeNull();
    expect((await R.orderReturnables(id))[0]).toMatchObject({ swapPlanned: 1 });
    // deliver offline: the phone sends the proof with the empties counted
    await confirmOrder(lx, id, {});
    const d = await prisma.delivery.findUniqueOrThrow({ where: { orderId: id } });
    const driver = await prisma.driver.findFirstOrThrow({ where: { user: { email: FIR_DRIVER } } });
    if (d.mode !== "FIRINGI_FLEET") await prisma.delivery.update({ where: { id: d.id }, data: { mode: "FIRINGI_FLEET", executingCompanyId: (await prisma.company.findFirstOrThrow({ where: { type: "ADMIN" } })).id } });
    await prisma.delivery.updateMany({ where: { driverId: driver.id, status: { in: ["ASSIGNED", "PICKED_UP", "OUT_FOR_DELIVERY"] }, id: { not: d.id } }, data: { driverId: null, status: "UNASSIGNED", routeId: null } });
    await prisma.driver.update({ where: { id: driver.id }, data: { availability: "AVAILABLE" } });
    await assignDelivery(await ctxFor(OPS), d.id, { driverId: driver.id });
    await changeOrderStatus(lx, id, "READY_FOR_PICKUP");
    const drv = await ctxFor(FIR_DRIVER);
    const snap = await A.snapshot(drv, "driver", "pt-PT");
    expect(snap.driver!.stops.find((s) => s.deliveryId === d.id)!.empties).toEqual(expect.arrayContaining([expect.objectContaining({ code: "GAS-BUTANE-13", held: 2, fullOut: 5 })]));
    const cid = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    for (const step of ["PICK_UP", "START"]) expect((await A.syncOp(drv, { clientId: cid(), kind: "delivery.step", portal: "driver", data: { deliveryId: d.id, step } })).status).toBe("DONE");
    const png = "data:image/png;base64," + Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).toString("base64");
    const r = await A.syncOp(drv, { clientId: cid(), kind: "delivery.complete", portal: "driver", data: { deliveryId: d.id, recipientName: "Karim", signature: png, empties: { [GAS]: 2, [CRATE]: 1 } } });
    expect(r.status).toBe("DONE");
    const inv = await prisma.invoice.findFirstOrThrow({ where: { orderId: id, docType: "INVOICE" }, include: { lines: true } });
    expect(Number(depositLine(inv, "GAS-BUTANE-13")!.qty)).toBe(3); // 5 out, 2 swapped
    expect(await prisma.emptiesReturn.findFirst({ where: { orderId: id }, include: { lines: true } })).toMatchObject({ status: "COLLECTED", lines: [expect.objectContaining({ typeId: CRATE, counted: 1 })] });
  });
});

