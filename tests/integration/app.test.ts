/**
 * Phase 39: installable phone app — the data a phone keeps offline (per portal), actions done without
 * signal carried out once when back online (orders with the admin's price-change rule, delivery steps
 * and proof of delivery, picking), installs.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { confirmOrder, changeOrderStatus } from "@/server/services/orders";
import { setStock } from "@/server/services/vendor-catalogue";
import { assignDelivery } from "@/server/services/deliveries";
import * as A from "@/server/app/service";
import { checkOfflineOrder, DEFAULT_APP_SETTINGS, offlineDecision } from "@/lib/app";
import { ctxFor } from "../helpers";

const KEBAB = "owner@kebabhouse.test", LX = "owner@lisboacentral.test", SA = "superadmin@firingi.test", OPS = "ops@firingi.test", FIR_DRIVER = "driver@firingi.test";
const PNG = "data:image/png;base64," + Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).toString("base64");
let offers: { id: string; price: number }[] = [];
let addressId = "";
let n = 0;
const cid = () => `t${Date.now().toString(36)}${(n++).toString(36)}abcd`;

async function settings(p: Partial<typeof DEFAULT_APP_SETTINGS["offlineOrders"]>) {
  await A.saveAppSettings(await ctxFor(SA), { ...DEFAULT_APP_SETTINGS, offlineOrders: { ...DEFAULT_APP_SETTINGS.offlineOrders, ...p } });
}
async function basePrice(offerId: string) {
  const i = await prisma.priceListItem.findFirstOrThrow({ where: { offerId, minQty: { lte: 1 }, priceList: { scope: "BASE", isActive: true } }, orderBy: { minQty: "desc" } });
  return i;
}

beforeAll(async () => {
  await prisma.offlineOp.deleteMany({});
  await prisma.appInstall.deleteMany({});
  await prisma.setting.deleteMany({ where: { key: "app.settings" } });
  const lx = await ctxFor(LX);
  const kb = await ctxFor(KEBAB);
  const wh = await prisma.address.findFirstOrThrow({ where: { companyId: lx.company.id, kind: { in: ["WAREHOUSE", "PICKUP"] } } });
  for (const sku of ["GRO-MOZZ2", "GRO-ARROZ1", "GRO-LUSO15"]) {
    const o = await prisma.vendorOffer.findFirstOrThrow({ where: { vendorCompanyId: lx.company.id, vendorSku: sku, status: "ACTIVE" } });
    const cur = await prisma.stockLevel.findUnique({ where: { offerId_addressId: { offerId: o.id, addressId: wh.id } } });
    await setStock(lx, o.id, wh.id, Math.max(400, (cur?.reserved ?? 0) + 300));
    offers.push({ id: o.id, price: 0 });
  }
  // what the buyer sees today (its own price list may differ from the supplier's base list)
  const { presentOffers } = await import("@/server/data/catalogue-buyer");
  const seen = await presentOffers(kb, offers.map((o) => o.id));
  offers = offers.map((o) => ({ ...o, price: Number(seen.find((s) => s.offerId === o.id)!.price!.unitPriceNet) }));
  addressId = (await prisma.address.findFirstOrThrow({ where: { companyId: kb.company.id, kind: "DELIVERY", isActive: true }, orderBy: { isDefault: "desc" } })).id;
  await prisma.cartItem.deleteMany({ where: { cart: { buyerCompanyId: kb.company.id } } });
});
afterAll(async () => {
  await prisma.setting.deleteMany({ where: { key: "app.settings" } });
  await prisma.$disconnect();
});

describe("pure rules", () => {
  it("finds changes and unavailable lines; the admin's mode decides", () => {
    const c = checkOfflineOrder(
      [{ offerId: "a", qty: 2, seenUnitNet: 10 }, { offerId: "b", qty: 5, seenUnitNet: 4 }, { offerId: "c", qty: 1, seenUnitNet: 3 }, { offerId: "d", qty: 3, seenUnitNet: 1 }],
      [{ offerId: "a", name: "A", unitNet: 10.15, available: 9, minQty: 1, step: 1 }, { offerId: "b", name: "B", unitNet: 4, available: 2, minQty: 1, step: 1 }, { offerId: "d", name: "D", unitNet: 1, available: 9, minQty: 2, step: 2 }],
    );
    expect(c.ok.map((x) => x.offerId)).toEqual(["a"]);
    expect(c.changes).toEqual([{ offerId: "a", name: "A", was: 10, now: 10.15, pct: 1.5 }]);
    expect(c.unavailable.map((u) => [u.offerId, u.why])).toEqual([["b", "STOCK"], ["c", "GONE"], ["d", "QTY"]]);
    expect(offlineDecision(c, { mode: "AUTO", maxChangePct: 2 }, false)).toBe("ASK"); // unavailable lines always go back to the buyer
    const clean = { ...c, unavailable: [] };
    expect(offlineDecision(clean, { mode: "AUTO", maxChangePct: 2 }, false)).toBe("PLACE");
    expect(offlineDecision(clean, { mode: "AUTO", maxChangePct: 1 }, false)).toBe("ASK");
    expect(offlineDecision(clean, { mode: "ASK", maxChangePct: 50 }, false)).toBe("ASK");
    expect(offlineDecision(clean, { mode: "ASK", maxChangePct: 0 }, true)).toBe("PLACE");
    expect(offlineDecision({ ...c, ok: [] }, { mode: "ASK", maxChangePct: 0 }, true)).toBe("NOTHING");
  });
});

describe("settings & snapshot", () => {
  it("only FIRINGI changes the settings; values are checked", async () => {
    await expect(A.saveAppSettings(await ctxFor(KEBAB), DEFAULT_APP_SETTINGS)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(A.saveAppSettings(await ctxFor(SA), { ...DEFAULT_APP_SETTINGS, offlineOrders: { mode: "AUTO", maxChangePct: 90 } })).rejects.toThrow(/between 0 and 50/);
    expect((await A.appSettings()).offlineOrders.mode).toBe("ASK");
  });

  it("the buyer's phone keeps usual products (own prices), addresses, orders and invoices; others can't take it", async () => {
    const kb = await ctxFor(KEBAB);
    const s = await A.snapshot(kb, "buy", "pt-PT");
    expect(s.portal).toBe("buy");
    expect(s.buy!.addresses.some((a) => a.id === addressId)).toBe(true);
    expect(s.buy!.products.length).toBeGreaterThan(0); // usual products — or, for a new buyer, popular ones it can buy
    const p = s.buy!.products[0];
    expect(p).toMatchObject({ offerId: expect.any(String), unitNet: expect.any(Number), minQty: expect.any(Number), usualQty: expect.any(Number) });
    expect(JSON.stringify(s)).not.toMatch(/commission|margin|vendorPayable/i);
    for (const o of s.buy!.orders) for (const l of o.lines) expect(typeof l.name).toBe("string");
    await expect(A.snapshot(kb, "vendor", "pt-PT")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(A.snapshot(kb, "driver", "pt-PT")).rejects.toMatchObject({ code: "FORBIDDEN" });
    // FIRINGI can switch a portal's app off
    await A.saveAppSettings(await ctxFor(SA), { ...DEFAULT_APP_SETTINGS, portals: { ...DEFAULT_APP_SETTINGS.portals, buy: false } });
    await expect(A.snapshot(kb, "buy", "pt-PT")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await A.saveAppSettings(await ctxFor(SA), DEFAULT_APP_SETTINGS);
  });
});

describe("offline orders", () => {
  it("unchanged prices → placed once, even if the phone sends it twice", async () => {
    await settings({ mode: "ASK" });
    const kb = await ctxFor(KEBAB);
    const clientId = cid();
    const op = { clientId, kind: "order.place", portal: "buy", at: new Date().toISOString(), data: { addressId, note: "offline e2e", items: [{ offerId: offers[0].id, qty: 6, seenUnitNet: offers[0].price }] } };
    const r1 = await A.syncOp(kb, op);
    expect(r1.status).toBe("DONE");
    const number = (r1.result as { number: string }).number;
    expect(number).toMatch(/\w/);
    const r2 = await A.syncOp(kb, op);
    expect(r2).toMatchObject({ status: "DONE", result: { number } });
    expect(await prisma.offlineOp.count({ where: { clientId } })).toBe(1);
    const placed = await prisma.order.findMany({ where: { buyerNotes: "offline e2e", buyerCompanyId: kb.company.id, placedAt: { gte: new Date(Date.now() - 60_000) } } });
    expect(placed).toHaveLength(1);
    // the buyer's online cart is untouched
    expect(await prisma.cartItem.count({ where: { cart: { buyerCompanyId: kb.company.id } } })).toBe(0);
  });

  it("price changed: ASK → the buyer confirms; AUTO within the limit → placed by itself", async () => {
    const kb = await ctxFor(KEBAB);
    const item = await basePrice(offers[1].id);
    const old = Number(item.unitPriceNet);
    await prisma.priceListItem.update({ where: { id: item.id }, data: { unitPriceNet: (old * 1.01).toFixed(4) } });
    const { presentOffers } = await import("@/server/data/catalogue-buyer");
    const nowPrice = Number((await presentOffers(kb, [offers[1].id]))[0].price!.unitPriceNet);
    try {
      await settings({ mode: "ASK" });
      const op = { clientId: cid(), kind: "order.place", portal: "buy", data: { addressId, items: [{ offerId: offers[1].id, qty: 6, seenUnitNet: offers[1].price, name: "Arroz" }] } };
      const r = await A.syncOp(kb, op);
      if (Math.abs(nowPrice - offers[1].price) >= 0.005) {
        expect(r.status).toBe("NEEDS_CONFIRM");
        expect((r.result as { changes: { was: number; now: number }[] }).changes[0]).toMatchObject({ was: offers[1].price, now: nowPrice });
        expect((await prisma.offlineOp.findFirstOrThrow({ where: { clientId: op.clientId } })).status).toBe("NEEDS_CONFIRM");
        const ok = await A.syncOp(kb, { ...op, data: { ...op.data, accept: true } });
        expect(ok.status).toBe("DONE");
        await settings({ mode: "AUTO", maxChangePct: 2 });
        expect((await A.syncOp(kb, { ...op, clientId: cid() })).status).toBe("DONE");
        await settings({ mode: "AUTO", maxChangePct: 0.5 });
        expect((await A.syncOp(kb, { ...op, clientId: cid() })).status).toBe("NEEDS_CONFIRM");
      } else {
        // this buyer has its own price for the product: the list price change doesn't reach it
        expect(r.status).toBe("DONE");
      }
    } finally {
      await prisma.priceListItem.update({ where: { id: item.id }, data: { unitPriceNet: old.toFixed(4) } });
      await settings({ mode: "ASK" });
    }
  });

  it("not enough stock → always back to the buyer; accepting orders the rest", async () => {
    const kb = await ctxFor(KEBAB);
    const lx = await ctxFor(LX);
    const wh = await prisma.address.findFirstOrThrow({ where: { companyId: lx.company.id, kind: { in: ["WAREHOUSE", "PICKUP"] } } });
    const cur = await prisma.stockLevel.findUniqueOrThrow({ where: { offerId_addressId: { offerId: offers[2].id, addressId: wh.id } } });
    await setStock(lx, offers[2].id, wh.id, cur.reserved); // nothing available
    await settings({ mode: "AUTO", maxChangePct: 50 });
    const op = { clientId: cid(), kind: "order.place", portal: "buy", data: { addressId, items: [{ offerId: offers[0].id, qty: 6, seenUnitNet: offers[0].price }, { offerId: offers[2].id, qty: 4, seenUnitNet: offers[2].price }] } };
    const r = await A.syncOp(kb, op);
    expect(r.status).toBe("NEEDS_CONFIRM");
    expect((r.result as { unavailable: { offerId: string; why: string }[] }).unavailable).toEqual([expect.objectContaining({ offerId: offers[2].id, why: "STOCK" })]);
    const ok = await A.syncOp(kb, { ...op, data: { ...op.data, accept: true } });
    expect(ok.status).toBe("DONE");
    expect((ok.result as { left: unknown[] }).left).toHaveLength(1);
    await setStock(lx, offers[2].id, wh.id, cur.reserved + 300);
    await settings({ mode: "ASK" });
  });

  it("a supplier can't send buyer actions; bad ids and unknown kinds are refused", async () => {
    await expect(A.syncOp(await ctxFor(LX), { clientId: cid(), kind: "delivery.step", portal: "driver", data: {} })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(A.syncOp(await ctxFor(KEBAB), { clientId: "x", kind: "order.place", portal: "buy", data: {} })).rejects.toThrow(/Bad action id/);
    await expect(A.syncOp(await ctxFor(KEBAB), { clientId: cid(), kind: "order.delete", portal: "buy", data: {} })).rejects.toThrow(/Unknown action/);
    const r = await A.syncOp(await ctxFor(KEBAB), { clientId: cid(), kind: "order.place", portal: "buy", data: { addressId, items: [] } });
    expect(r).toMatchObject({ status: "FAILED", error: expect.stringMatching(/empty/) });
  });
});

describe("driver offline", () => {
  it("picks up, starts and delivers with a signature; the order is delivered once", async () => {
    const kb = await ctxFor(KEBAB);
    const lx = await ctxFor(LX);
    const r = await A.syncOp(kb, { clientId: cid(), kind: "order.place", portal: "buy", data: { addressId, items: [{ offerId: offers[0].id, qty: 6, seenUnitNet: offers[0].price }] } });
    expect(r.status).toBe("DONE");
    const orderId = ((r.result as { orders: { id: string }[] }).orders[0]).id;
    await confirmOrder(lx, orderId, {});
    const d = await prisma.delivery.findUniqueOrThrow({ where: { orderId } });
    const driver = await prisma.driver.findFirstOrThrow({ where: { user: { email: FIR_DRIVER } } });
    if (d.mode !== "FIRINGI_FLEET") await prisma.delivery.update({ where: { id: d.id }, data: { mode: "FIRINGI_FLEET", executingCompanyId: (await prisma.company.findFirstOrThrow({ where: { type: "ADMIN" } })).id } });
    await prisma.delivery.updateMany({ where: { driverId: driver.id, status: { in: ["ASSIGNED", "PICKED_UP", "OUT_FOR_DELIVERY"] }, id: { not: d.id } }, data: { driverId: null, status: "UNASSIGNED", routeId: null } });
    await prisma.driver.update({ where: { id: driver.id }, data: { availability: "AVAILABLE" } });
    await assignDelivery(await ctxFor(OPS), d.id, { driverId: driver.id });
    await changeOrderStatus(lx, orderId, "READY_FOR_PICKUP");
    const drv = await ctxFor(FIR_DRIVER);
    const snap = await A.snapshot(drv, "driver", "pt-PT");
    const stop = snap.driver!.stops.find((s) => s.deliveryId === d.id)!;
    expect(stop).toMatchObject({ status: "ASSIGNED", customer: expect.stringMatching(/Kebab/), items: [expect.objectContaining({ qty: 6 })] });
    expect(typeof stop.items[0].name).toBe("string"); // names in the person's language, never the stored {en, pt} object
    expect(snap.driver!.reasons).toContain("CUSTOMER_ABSENT");
    expect((await A.syncOp(drv, { clientId: cid(), kind: "delivery.step", portal: "driver", data: { deliveryId: d.id, step: "PICK_UP" } })).status).toBe("DONE");
    expect((await A.syncOp(drv, { clientId: cid(), kind: "delivery.step", portal: "driver", data: { deliveryId: d.id, step: "START" } })).status).toBe("DONE");
    const done = { clientId: cid(), kind: "delivery.complete", portal: "driver", at: new Date(Date.now() - 600_000).toISOString(), data: { deliveryId: d.id, recipientName: "Ahmed Kebab", signature: PNG, note: "left at the back door", lat: 38.711, lng: -9.135 } };
    expect((await A.syncOp(drv, done)).status).toBe("DONE");
    expect((await A.syncOp(drv, done)).status).toBe("DONE"); // sent twice: delivered once
    const after = await prisma.delivery.findUniqueOrThrow({ where: { id: d.id }, include: { proof: true, order: { select: { status: true } } } });
    expect(after.status).toBe("DELIVERED");
    expect(after.order.status).toBe("DELIVERED");
    expect(after.proof).toMatchObject({ recipientName: "Ahmed Kebab" });
    expect(after.proof!.signatureKey).toBeTruthy();
    // a step that isn't possible any more comes back as failed, with the reason
    const late = await A.syncOp(drv, { clientId: cid(), kind: "delivery.fail", portal: "driver", data: { deliveryId: d.id, reasonCode: "CLOSED" } });
    expect(late).toMatchObject({ status: "FAILED", error: expect.stringMatching(/not possible/) });
    expect((await prisma.offlineOp.findMany({ where: { userId: drv.user.id }, select: { kind: true, status: true }, orderBy: { createdAt: "asc" } })).map((o) => `${o.kind}:${o.status}`))
      .toEqual(["delivery.step:DONE", "delivery.step:DONE", "delivery.complete:DONE", "delivery.fail:FAILED"]);
  });
});

describe("installs and FIRINGI's overview", () => {
  it("records installs and opens; shows what needed attention", async () => {
    const kb = await ctxFor(KEBAB);
    await A.recordAppEvent(kb, "buy", "INSTALLED", "android");
    await A.recordAppEvent(kb, "buy", "OPENED", "android");
    await A.recordAppEvent(kb, "driver", "INSTALLED", "ios"); // not a driver: ignored
    const i = await prisma.appInstall.findMany({ where: { userId: kb.user.id } });
    expect(i.map((x) => [x.portal, x.platform])).toEqual([["buy", "android"]]);
    const s = await A.appStats(await ctxFor(SA));
    expect(s.installs.buy).toBeGreaterThanOrEqual(1);
    expect(s.ops.some((o) => o.kind === "order.place" && o.status === "DONE")).toBe(true);
    expect(s.attention.some((a) => a.kind === "delivery.fail" && a.status === "FAILED")).toBe(true);
    await expect(A.appStats(kb)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
