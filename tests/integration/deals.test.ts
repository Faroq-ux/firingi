/**
 * Phase 38: clearance deals — kinds on/off, limits, auto-approval within limits (or FIRINGI decides),
 * clearance (short-dated lot) → lower commission on the deal price; the cart / order at the deal price
 * (flash, volume tiers, multi-buy, whole lot, best offer with counter-offer); quantity and per-buyer
 * limits; promotions don't stack; lots sell out; watchlist and smart alerts; the job ends deals.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import * as S from "@/server/deals/service";
import { priceCheckout } from "@/server/orders/pricing";
import { placeOrder } from "@/server/services/orders";
import { setStock } from "@/server/services/vendor-catalogue";
import { DEFAULT_DEAL_SETTINGS } from "@/lib/deals";
import { ctxFor, makeOffers } from "../helpers";

const SA = "superadmin@firingi.test", LX = "owner@lisboacentral.test", KEBAB = "owner@kebabhouse.test";
const DAY = 86_400_000;
let lxId = "", kebabId = "", addr = "", wh = "", baseList = "";
const offers: string[] = [];

async function offer(price: number, stock = 500) {
  const o = Object.values(await makeOffers(["Grossista Lisboa Central, Lda"]))[0];
  await prisma.priceListItem.create({ data: { priceListId: baseList, offerId: o, minQty: 1, unitPriceNet: price.toFixed(4) } });
  await setStock(await ctxFor(LX), o, wh, stock);
  offers.push(o);
  return o;
}
async function settings(p: Partial<typeof DEFAULT_DEAL_SETTINGS>) {
  return S.saveDealSettings(await ctxFor(SA), { ...DEFAULT_DEAL_SETTINGS, ...p, approval: { ...DEFAULT_DEAL_SETTINGS.approval, ...(p.approval ?? {}) }, kinds: { ...DEFAULT_DEAL_SETTINGS.kinds, ...(p.kinds ?? {}) } });
}
const now = () => new Date(Date.now() - 60_000);
const inDays = (d: number) => new Date(Date.now() + d * DAY);
async function price(offerId: string, qty: number) {
  const kb = await ctxFor(KEBAB);
  const pc = await priceCheckout(kb, { items: [{ offerId, qty }], couponCode: null }, { regionId: null, addressId: addr, commissionRates: new Map([[lxId, 8]]) });
  return pc.parts[0].lines[0];
}

beforeAll(async () => {
  await prisma.clearanceAlert.deleteMany({}); await prisma.clearanceWatch.deleteMany({}); await prisma.clearanceDigestOptIn.deleteMany({});
  await prisma.setting.deleteMany({ where: { key: "deals.settings" } });
  const lx = await ctxFor(LX), kb = await ctxFor(KEBAB);
  lxId = lx.company.id; kebabId = kb.company.id;
  addr = (await prisma.address.findFirstOrThrow({ where: { companyId: kebabId, kind: "DELIVERY", isActive: true }, orderBy: { isDefault: "desc" } })).id;
  wh = (await prisma.address.findFirstOrThrow({ where: { companyId: lxId, kind: "WAREHOUSE" } })).id;
  baseList = (await prisma.priceList.findFirstOrThrow({ where: { vendorCompanyId: lxId, scope: "BASE", isActive: true } })).id;
});
afterAll(async () => {
  await prisma.clearanceBid.deleteMany({ where: { deal: { offerId: { in: offers } } } });
  await prisma.setting.deleteMany({ where: { key: "deals.settings" } });
  await prisma.clearanceAlert.deleteMany({}); await prisma.clearanceWatch.deleteMany({});
  await prisma.$disconnect();
});

describe("creating deals", () => {
  it("kinds FIRINGI switched off are refused; a deal must be cheaper than the minimum discount", async () => {
    const lx = await ctxFor(LX);
    const o = await offer(10);
    await settings({ kinds: { ...DEFAULT_DEAL_SETTINGS.kinds, LOT: false } });
    await expect(S.createDeal(lx, { offerId: o, kind: "LOT", startsAt: now(), endsAt: inDays(3), maxQty: 10, lotPrice: 50 })).rejects.toThrow(/doesn't offer this kind/);
    await expect(S.createDeal(lx, { offerId: o, kind: "FLASH", startsAt: now(), endsAt: inDays(3), dealPrice: 9.8 })).rejects.toThrow(/at least 5 %/);
    await expect(S.createDeal(lx, { offerId: o, kind: "FLASH", startsAt: now(), endsAt: inDays(40), dealPrice: 8 })).rejects.toThrow(/at most 30 days/);
  });

  it("AUTO: within the limits it starts by itself; beyond them (or 'trusted only') FIRINGI decides", async () => {
    const lx = await ctxFor(LX), sa = await ctxFor(SA);
    await settings({ approval: { mode: "AUTO", maxDiscountPct: 30, maxDays: 7, trustedOnly: false } });
    const d1 = await S.createDeal(lx, { offerId: await offer(10), kind: "FLASH", startsAt: now(), endsAt: inDays(3), dealPrice: 8 });
    expect(d1).toMatchObject({ status: "APPROVED", autoApproved: true });
    const d2 = await S.createDeal(lx, { offerId: await offer(10), kind: "FLASH", startsAt: now(), endsAt: inDays(3), dealPrice: 5 }); // −50 %
    expect(d2.status).toBe("PENDING");
    await settings({ approval: { mode: "AUTO", maxDiscountPct: 30, maxDays: 7, trustedOnly: true } });
    const d3 = await S.createDeal(lx, { offerId: await offer(10), kind: "FLASH", startsAt: now(), endsAt: inDays(3), dealPrice: 9 });
    expect(d3.status).toBe("PENDING");
    await S.setTrusted(sa, lxId, true);
    const d4 = await S.createDeal(lx, { offerId: await offer(10), kind: "FLASH", startsAt: now(), endsAt: inDays(3), dealPrice: 9 });
    expect(d4.status).toBe("APPROVED");
    await S.setTrusted(sa, lxId, false);
    // FIRINGI rejects with a reason; approves another with its own commission
    await expect(S.reviewDeal(sa, d2.id, false, null)).rejects.toThrow(/why/);
    await S.reviewDeal(sa, d2.id, false, "Too deep");
    const r = await S.reviewDeal(sa, d3.id, true, null, 3);
    expect(Number(r.commissionPct)).toBe(3);
    await expect(S.createDeal(lx, { offerId: d1.offerId, kind: "FLASH", startsAt: now(), endsAt: inDays(2), dealPrice: 8.5 })).rejects.toThrow(/already has a deal/);
    await settings({});
  });

  it("clearance: a lot expiring soon → clearance deal, FIRINGI's lower commission", async () => {
    const lx = await ctxFor(LX);
    const o = await offer(20, 0);
    const batch = await prisma.stockBatch.create({ data: { offerId: o, addressId: wh, lotCode: `L-${Date.now()}`, expiresOn: inDays(6), onHand: 40, source: "OPENING" } });
    await prisma.stockLevel.upsert({ where: { offerId_addressId: { offerId: o, addressId: wh } }, create: { offerId: o, addressId: wh, onHand: 40 }, update: { onHand: 40 } });
    const info = await S.dealFormInfo(lx, o);
    expect(info).toMatchObject({ clearance: true, reason: "EXPIRY", list: 20 });
    const d = await S.createDeal(lx, { offerId: o, kind: "FLASH", startsAt: now(), endsAt: inDays(5), dealPrice: 15, batchId: batch.id });
    expect(d).toMatchObject({ clearance: true, clearanceReason: "EXPIRY" });
    expect(Number(d.commissionPct)).toBe(Math.min(Number(info.usualCommission), 4));
    // priced in the cart: deal price, commission on the deal price at the clearance rate
    const l = await price(o, 4);
    expect(l.deal).toMatchObject({ dealId: d.id });
    expect(Number(l.calc.unitSalePriceNet)).toBe(15);
    expect(Number(l.calc.commissionBase)).toBe(60);
    expect(Number(l.calc.commissionAmount)).toBe(Number((60 * Number(d.commissionPct) / 100).toFixed(2)));
    expect(Number(l.calc.vendorLineNet)).toBe(Number((60 - Number(l.calc.commissionAmount)).toFixed(2)));
  });
});

describe("prices in the cart", () => {
  it("volume tiers, multi-buy and whole lot", async () => {
    const lx = await ctxFor(LX);
    const v = await offer(10);
    await S.createDeal(lx, { offerId: v, kind: "VOLUME", startsAt: now(), endsAt: inDays(3), tiers: [{ minQty: 10, unitPrice: 9 }, { minQty: 50, unitPrice: 8 }] });
    expect(Number((await price(v, 5)).calc.unitSalePriceNet)).toBe(10);
    expect((await price(v, 5)).item.dealNote).toMatchObject({ why: "QTY_TIER" });
    expect(Number((await price(v, 12)).calc.unitSalePriceNet)).toBe(9);
    expect(Number((await price(v, 60)).calc.unitSalePriceNet)).toBe(8);
    const b = await offer(10);
    await S.createDeal(lx, { offerId: b, kind: "BUNDLE", startsAt: now(), endsAt: inDays(3), bundleQty: 3, bundlePrice: 20 });
    expect(Number((await price(b, 3)).calc.lineNet)).toBe(20);
    expect(Number((await price(b, 4)).calc.lineNet)).toBe(30); // one pack + one at list
    const lot = await offer(10);
    await S.createDeal(lx, { offerId: lot, kind: "LOT", startsAt: now(), endsAt: inDays(3), maxQty: 40, lotPrice: 300 });
    expect((await price(lot, 20)).item.dealNote).toMatchObject({ why: "LOT_QTY" });
    expect(Number((await price(lot, 40)).calc.lineNet)).toBe(300);
  });

  it("limits: units on the deal and per buyer; the lot sells out after the order", async () => {
    const lx = await ctxFor(LX), kb = await ctxFor(KEBAB);
    const f = await offer(10);
    await S.createDeal(lx, { offerId: f, kind: "FLASH", startsAt: now(), endsAt: inDays(3), dealPrice: 8, maxQty: 30, perBuyerMax: 12 });
    expect((await price(f, 13)).item.dealNote).toMatchObject({ why: "PER_BUYER", left: 12 });
    expect(Number((await price(f, 12)).calc.unitSalePriceNet)).toBe(8);
    const placed = await placeOrder(kb, { deliveryAddressId: addr, items: [{ offerId: f, qty: 12 }], approved: true });
    const line = await prisma.orderLine.findFirstOrThrow({ where: { orderId: (placed as { id: string }).id } });
    expect(line.dealId).toBeTruthy();
    expect(Number(line.unitSalePriceNet)).toBe(8);
    expect((await price(f, 1)).item.dealNote).toMatchObject({ why: "PER_BUYER", left: 0 });
    // whole lot: ordered → SOLD_OUT, gone from the deals list
    const lot = await offer(10);
    const d = await S.createDeal(lx, { offerId: lot, kind: "LOT", startsAt: now(), endsAt: inDays(3), maxQty: 25, lotPrice: 200 });
    await placeOrder(kb, { deliveryAddressId: addr, items: [{ offerId: lot, qty: 25 }], approved: true });
    expect((await prisma.clearanceDeal.findUniqueOrThrow({ where: { id: d.id } })).status).toBe("SOLD_OUT");
    expect((await S.liveDeals(kb)).some((x) => x.id === d.id)).toBe(false);
  });
});

describe("best offer", () => {
  it("at/above the floor → accepted at once; below → the supplier counters; the buyer takes it; the order uses the price", async () => {
    const lx = await ctxFor(LX), kb = await ctxFor(KEBAB);
    const o = await offer(10);
    const d = await S.createDeal(lx, { offerId: o, kind: "BEST_OFFER", startsAt: now(), endsAt: inDays(3), floorPrice: 8, minBidQty: 10, maxQty: 100 });
    expect((await S.liveDeals(kb)).find((x) => x.id === d.id)).toMatchObject({ kind: "BEST_OFFER", bestUnit: null });
    await expect(S.placeBid(kb, d.id, 5, 7, null)).rejects.toThrow(/at least 10/);
    const b = await S.placeBid(kb, d.id, 20, 7, "for this week");
    expect(b.status).toBe("PENDING");
    expect((await price(o, 20)).deal).toBeNull(); // no accepted price yet
    await expect(S.placeBid(kb, d.id, 20, 7.5, null)).rejects.toThrow(/already have an offer/);
    await expect(S.answerBid(lx, b.id, "COUNTER", 6)).rejects.toThrow(/between/);
    await S.answerBid(lx, b.id, "COUNTER", 7.6);
    await S.respondToCounter(kb, b.id, true);
    expect((await price(o, 10)).item.dealNote).toMatchObject({ why: "BID_QTY", left: 20 });
    const l = await price(o, 20);
    expect(Number(l.calc.unitSalePriceNet)).toBe(7.6);
    const placed = await placeOrder(kb, { deliveryAddressId: addr, items: [{ offerId: o, qty: 20 }], approved: true });
    expect(await prisma.clearanceBid.findUniqueOrThrow({ where: { id: b.id } })).toMatchObject({ status: "ORDERED", orderId: (placed as { id: string }).id });
    // a bid at the floor is accepted straight away
    await prisma.clearanceBid.deleteMany({ where: { id: b.id } });
    const b2 = await S.placeBid(kb, d.id, 10, 8, null);
    expect(b2.status).toBe("ACCEPTED");
  });
});

describe("alerts and the job", () => {
  it("watchers and buyers who bought the product hear about a new deal once; the job ends deals", async () => {
    const lx = await ctxFor(LX), kb = await ctxFor(KEBAB);
    const o = await offer(10);
    const productId = (await prisma.vendorOffer.findUniqueOrThrow({ where: { id: o }, select: { packaging: { select: { variant: { select: { productId: true } } } } } })).packaging.variant.productId;
    await S.watch(kb, { kind: "PRODUCT", id: productId }, true);
    await S.watch(kb, { kind: "PRODUCT", id: productId }, true); // once
    expect((await S.myWatches(kb)).filter((w) => w.targetId === productId)).toHaveLength(1);
    const d = await S.createDeal(lx, { offerId: o, kind: "FLASH", startsAt: now(), endsAt: inDays(1), dealPrice: 9 });
    expect(await prisma.clearanceAlert.count({ where: { dealId: d.id, userId: kb.user.id, reason: "WATCH" } })).toBe(1);
    expect(await S.alertDeal(d.id)).toBe(0); // already sent
    await prisma.clearanceDeal.update({ where: { id: d.id }, data: { endsAt: new Date(Date.now() - 1000) } });
    const r = await S.runDealsJob();
    expect(r.ended).toBeGreaterThanOrEqual(1);
    expect((await prisma.clearanceDeal.findUniqueOrThrow({ where: { id: d.id } })).status).toBe("ENDED");
  });
});
