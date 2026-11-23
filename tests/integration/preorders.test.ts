/**
 * Phase 71: pre-orders & price locks — a wholesaler opens a pre-order with a tier price and short supply; FIRINGI
 * approves; three customers pre-order more than there is; the close shares it out in proportion at the tier price;
 * one accepts, one declines, one is confirmed automatically; orders are placed at the final price; a deposit that is
 * not paid lapses; a price lock is asked, accepted, called off at the locked price, reminded and ends; switches.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import * as C from "@/server/preorders/campaigns";
import * as L from "@/server/preorders/locks";
import { savePreSettings, setCompanyPre } from "@/server/preorders/settings";
import { setStock } from "@/server/services/vendor-catalogue";
import { ctxFor, makeOffers } from "../helpers";

const SA = "superadmin@firingi.test", LX = "owner@lisboacentral.test";
const BUYERS = ["owner@kebabhouse.test", "owner@pizzariabella.test", "owner@minimercadosol.test"];
const DAY = 86_400_000;
let offer = "", lxId = "";
const statuses: [string, string][] = [], madeAddresses: string[] = [], campaigns: string[] = [];

async function deliveryAddress(companyId: string) {
  const a = await prisma.address.findFirst({ where: { companyId, kind: "DELIVERY", isActive: true } });
  if (a) return a.id;
  const kb = await ctxFor(BUYERS[0]);
  const { id: _i, companyId: _c, createdAt: _cr, updatedAt: _u, ...src } = await prisma.address.findFirstOrThrow({ where: { companyId: kb.company.id, kind: "DELIVERY", isActive: true } }) as Record<string, unknown> & { id: string };
  void _i; void _c; void _cr; void _u;
  const made = await prisma.address.create({ data: { ...(src as object), companyId } as never });
  madeAddresses.push(made.id);
  return made.id;
}
const admin = () => ctxFor(SA);

beforeAll(async () => {
  await prisma.setting.deleteMany({ where: { key: "preorders.settings" } });
  const lx = await ctxFor(LX);
  lxId = lx.company.id;
  offer = Object.values(await makeOffers(["Grossista Lisboa Central, Lda"]))[0];
  const baseList = (await prisma.priceList.findFirstOrThrow({ where: { vendorCompanyId: lxId, scope: "BASE", isActive: true } })).id;
  await prisma.priceListItem.create({ data: { priceListId: baseList, offerId: offer, minQty: 1, unitPriceNet: "10.0000" } });
  const wh = (await prisma.address.findFirstOrThrow({ where: { companyId: lxId, kind: "WAREHOUSE" } })).id;
  await setStock(lx, offer, wh, 1000);
  for (const n of ["Pizzaria Bella Porto, Lda", "Mini-Mercado Sol, Unipessoal Lda"]) {
    const c = await prisma.company.findFirstOrThrow({ where: { legalName: n } });
    statuses.push([c.id, c.status]);
    await prisma.company.update({ where: { id: c.id }, data: { status: "APPROVED" } });
  }
});
afterAll(async () => {
  for (const [id, status] of statuses) await prisma.company.update({ where: { id }, data: { status: status as never } });
  for (const id of madeAddresses) await prisma.address.update({ where: { id }, data: { isActive: false } }).catch(() => {});
  await prisma.preorderCampaign.deleteMany({ where: { id: { in: campaigns } } });
  await prisma.priceLock.deleteMany({ where: { offerId: offer } });
  await prisma.setting.deleteMany({ where: { key: "preorders.settings" } });
});

async function newCampaign(opts: { supply?: number | null; deposit?: number; tiers?: { minTotal: number; unitNet: number }[] } = {}) {
  const lx = await ctxFor(LX), now = Date.now();
  const c = await C.saveCampaign(lx, {
    kind: "SEASONAL", title: `Christmas cola ${campaigns.length}`, opensAt: new Date(now - 60_000), closesAt: new Date(now + 3 * DAY), deliveryDates: [new Date(now + 10 * DAY)],
    allocation: "PRO_RATA", depositPct: opts.deposit ?? 0, items: [{ offerId: offer, unitNet: 9.5, tiers: opts.tiers ?? [{ minTotal: 12, unitNet: 8.8 }], minQty: 2, maxQty: 50, supplyQty: opts.supply ?? 15 }],
  });
  campaigns.push(c.id);
  return c;
}

describe("Pre-order campaigns", () => {
  it("supplier drafts → FIRINGI approves → open; only the right buyers see it", async () => {
    const c = await newCampaign();
    expect((await C.submitCampaign(await ctxFor(LX), c.id)).status).toBe("PENDING");
    const kb = await ctxFor(BUYERS[0]);
    expect((await C.buyerPreorders(kb)).campaigns.some((x) => x.id === c.id)).toBe(false);
    await expect(C.reviewCampaign(await admin(), c.id, false, "")).rejects.toThrow(/reason/);
    expect((await C.reviewCampaign(await admin(), c.id, true)).status).toBe("OPEN");
    const v = await C.buyerPreorders(kb);
    const mine = v.campaigns.find((x) => x.id === c.id)!;
    expect(mine.items[0].price).toBe(9.5);
    expect(mine.items[0].next).toMatchObject({ minTotal: 12, unitNet: 8.8, missing: 12 });
    // a wholesaler doesn't buy from wholesalers
    await expect(C.buyerPreorders(await ctxFor("owner@ccalmada.test")).then((r) => r.campaigns.some((x) => x.id === c.id))).resolves.toBe(false);
  });

  it("three customers pre-order 25 of 15 → shared in proportion at the tier price; accept / decline / automatic; orders at the final price", async () => {
    const c = await prisma.preorderCampaign.findFirstOrThrow({ where: { id: campaigns[0] }, include: { items: true } });
    const item = c.items[0].id, day = c.deliveryDates[0];
    const qty = [10, 10, 5];
    for (const [i, email] of BUYERS.entries()) {
      const b = await ctxFor(email);
      await C.placeReservation(b, { campaignId: c.id, addressId: await deliveryAddress(b.company.id), deliveryDate: day, lines: [{ itemId: item, qty: qty[i] }] });
    }
    await expect(C.placeReservation(await ctxFor(BUYERS[0]), { campaignId: c.id, addressId: await deliveryAddress((await ctxFor(BUYERS[0])).company.id), deliveryDate: day, lines: [{ itemId: item, qty: 1 }] })).rejects.toThrow(/At least 2/);
    const d0 = await C.campaignDetail(await ctxFor(LX), c.id);
    expect(d0.items[0].total).toBe(25);
    expect(d0.items[0].price).toBe(8.8);
    const r = await C.closeNow(await ctxFor(LX), c.id);
    expect(r.allocated).toBe(3);
    const res = await prisma.preorderReservation.findMany({ where: { campaignId: c.id }, include: { lines: true }, orderBy: { createdAt: "asc" } });
    expect(res.map((x) => x.lines[0].allocatedQty)).toEqual([6, 6, 3]);
    expect(res.every((x) => x.status === "ALLOCATED")).toBe(true);
    expect(Number(res[0].lines[0].unitNet)).toBe(8.8); // 15 shared out ≥ 12 → tier price
    await C.answerAllocation(await ctxFor(BUYERS[0]), res[0].id, true);
    await C.answerAllocation(await ctxFor(BUYERS[1]), res[1].id, false);
    // the third never answers → confirmed automatically after FIRINGI's days; orders before the delivery date
    const later = new Date(day.getTime() - 1 * DAY);
    const out = await C.processCampaigns(later);
    expect(out.confirmed).toBe(1);
    const fails = await prisma.preorderReservation.findMany({ where: { campaignId: c.id, status: "FAILED" }, select: { failReason: true } });
    expect(fails.map((f) => f.failReason)).toEqual([]);
    expect(out.ordered).toBe(2);
    const after = await prisma.preorderReservation.findMany({ where: { campaignId: c.id }, orderBy: { createdAt: "asc" } });
    expect(after.map((x) => x.status)).toEqual(["ORDERED", "DECLINED", "ORDERED"]);
    const line = await prisma.orderLine.findFirstOrThrow({ where: { orderId: after[0].orderIds[0], offerId: offer } });
    expect(Number(line.qtyOrdered)).toBe(6);
    expect(Number(line.unitSalePriceNet)).toBeCloseTo(8.8, 4);
    expect((await prisma.preorderCampaign.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("DONE");
    const mine = await C.buyerPreorders(await ctxFor(BUYERS[0]));
    expect(mine.reservations.find((x) => x.campaignId === c.id)?.orders.length).toBe(1);
  });

  it("a deposit not paid before the close lapses; supplier cancels with buyers told", async () => {
    await savePreSettings(await admin(), { approval: "AUTO" });
    const c = await newCampaign({ deposit: 10, supply: null });
    expect((await C.submitCampaign(await ctxFor(LX), c.id)).status).toBe("OPEN");
    const kb = await ctxFor(BUYERS[0]);
    const it0 = (await prisma.preorderItem.findFirstOrThrow({ where: { campaignId: c.id } })).id;
    const p = await C.placeReservation(kb, { campaignId: c.id, addressId: await deliveryAddress(kb.company.id), deliveryDate: c.deliveryDates[0], lines: [{ itemId: it0, qty: 10 }] });
    expect(p.deposit).toBe(9.5);
    expect(p.payLink).toMatch(/^\/pay\//);
    const req = await prisma.paymentRequest.findFirstOrThrow({ where: { preorderRef: p.id } });
    expect(req.source).toBe("PREORDER");
    expect(Number(req.amount)).toBe(9.5);
    await C.closeCampaign(c.id, new Date(Date.now() + 4 * DAY));
    const r = await prisma.preorderReservation.findUniqueOrThrow({ where: { id: p.id } });
    expect(r.status).toBe("CANCELLED");
    expect(r.cancelReason).toMatch(/Deposit/);
    const c2 = await newCampaign({ supply: null });
    await C.submitCampaign(await ctxFor(LX), c2.id);
    const it2 = (await prisma.preorderItem.findFirstOrThrow({ where: { campaignId: c2.id } })).id;
    await C.placeReservation(kb, { campaignId: c2.id, addressId: await deliveryAddress(kb.company.id), deliveryDate: c2.deliveryDates[0], lines: [{ itemId: it2, qty: 4 }] });
    expect((await C.cancelCampaign(await ctxFor(LX), c2.id, "Harvest failed")).cancelled).toBe(1);
  });
});

describe("Price locks", () => {
  it("asked at today's price → accepted lower with no deposit → call-off at the locked price → reminder → ends", async () => {
    const kb = await ctxFor(BUYERS[0]);
    const l = await L.requestLock(kb, { offerId: offer, qty: 30, months: 3 });
    expect(Number(l.unitNet)).toBe(10);
    await expect(L.requestLock(kb, { offerId: offer, qty: 5, months: 1 })).rejects.toThrow(/already/);
    expect((await L.decideLock(await ctxFor(LX), l.id, { accept: true, unitNet: 9.2 })).status).toBe("ACTIVE");
    const addr = await deliveryAddress(kb.company.id);
    const r = await L.callOff(kb, l.id, { qty: 12, addressId: addr });
    expect(r.left).toBe(18);
    const line = await prisma.orderLine.findFirstOrThrow({ where: { orderId: r.order.id, offerId: offer } });
    expect(Number(line.unitSalePriceNet)).toBeCloseTo(9.2, 4);
    await expect(L.callOff(kb, l.id, { qty: 40, addressId: addr })).rejects.toThrow(/1 to 18/);
    const mine = await L.myLocks(kb);
    expect(mine.locks.find((x) => x.id === l.id)).toMatchObject({ left: 18, saved: 9.6 });
    const vl = await L.vendorLocks(await ctxFor(LX));
    expect(vl.committed.find((x) => x.offerId === offer)?.left).toBe(18);
    const end = (await prisma.priceLock.findUniqueOrThrow({ where: { id: l.id } })).validUntil!;
    expect((await L.processLocks(new Date(end.getTime() - 5 * DAY))).reminded).toBe(1);
    expect((await L.processLocks(new Date(end.getTime() + 60_000))).expired).toBe(1);
  });

  it("FIRINGI approves big locks; the buyer may cancel a request", async () => {
    await savePreSettings(await admin(), { lockReviewAbove: 100 });
    const kb = await ctxFor(BUYERS[0]);
    const l = await L.requestLock(kb, { offerId: offer, qty: 50, months: 2 });
    expect((await L.decideLock(await ctxFor(LX), l.id, { accept: true })).status).toBe("REVIEW");
    await L.reviewLock(await admin(), l.id, true);
    expect((await prisma.priceLock.findUniqueOrThrow({ where: { id: l.id } })).status).toBe("ACTIVE");
    await prisma.priceLock.update({ where: { id: l.id }, data: { status: "CANCELLED" } });
    const l2 = await L.requestLock(kb, { offerId: offer, qty: 5, months: 1 });
    await L.cancelLock(kb, l2.id);
    expect((await prisma.priceLock.findUniqueOrThrow({ where: { id: l2.id } })).status).toBe("CANCELLED");
  });
});

describe("Switches and AI", () => {
  it("wholesalers off → no campaigns, no customer pre-orders; one company back on; AI answers", async () => {
    await savePreSettings(await admin(), { sellers: { DISTRIBUTOR: true, WHOLESALER: false } });
    await expect(C.vendorCampaigns(await ctxFor(LX))).rejects.toThrow(/switched off/);
    await expect(C.buyerPreorders(await ctxFor(BUYERS[0]))).rejects.toThrow(/switched off/);
    await setCompanyPre(await admin(), lxId, "ON");
    await expect(C.vendorCampaigns(await ctxFor(LX))).resolves.toBeTruthy();
    await savePreSettings(await admin(), { sellers: { DISTRIBUTOR: true, WHOLESALER: true } });
    await setCompanyPre(await admin(), lxId, null);
    const { preordersForBuyerAi, preordersForVendorAi } = await import("@/server/preorders/ai");
    expect(await preordersForBuyerAi(await ctxFor(BUYERS[0]))).toMatchObject({ available: true });
    expect(await preordersForVendorAi(await ctxFor(LX))).toMatchObject({ available: true });
    const o = await C.adminOverview(await admin());
    expect(o.campaigns.length).toBeGreaterThanOrEqual(3);
  });
});
