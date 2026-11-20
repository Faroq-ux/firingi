/**
 * Phase 55: rewards shop — FIRINGI's switches (shop, business type, each business; loyalty must be on); vouchers that
 * become a coupon only this business can use, used on an order, cancelled or expired (points back); a supplier's
 * product (approved by FIRINGI) free on the buyer's next order from that supplier and paid by the supplier, given
 * back when the order is cancelled and delivered with the next one; the supplier cancelling (points back); gifts with
 * a stock count shipped by FIRINGI; partner codes from a pool; limits (tier, per business, monthly, points); goals;
 * the daily job and FIRINGI's numbers.
 */
import Decimal from "decimal.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { addToCart, cartView, clearCart } from "@/server/services/cart";
import { changeOrderStatus, confirmOrder, placeOrder } from "@/server/services/orders";
import { setStock } from "@/server/services/vendor-catalogue";
import { setCompanyFeature } from "@/server/accounting/features";
import * as L from "@/server/loyalty/service";
import * as R from "@/server/rewards/service";
import { DEFAULT_REWARDS_SETTINGS, type RewardsSettings } from "@/lib/rewards";
import { ctxFor, makeApprovedCompany } from "../helpers";

const SA = "superadmin@firingi.test", KEBAB = "owner@kebabhouse.test", LX = "owner@lisboacentral.test";
let co = "", lxId = "", offerId = "";
const DAY = 86_400_000;

async function settings(p: Partial<RewardsSettings> = {}) { return R.saveRewardsSettings(await ctxFor(SA), { ...DEFAULT_REWARDS_SETTINGS, ...p }); }
const balance = async () => (await prisma.loyaltyAccount.findUniqueOrThrow({ where: { companyId: co } })).balance;
const base = { stock: null, perBuyerLimit: null, minTier: null, buyerTypes: [], countryCodes: [], featured: false, sortOrder: 0, description: null, terms: null, voucherAmount: null, voucherMinOrder: null, voucherDays: null, giftCost: null, partnerName: null, partnerUrl: null };
const voucher = async (p: Partial<R.AdminRewardInput> = {}) => (await R.saveAdminReward(await ctxFor(SA), { ...base, kind: "VOUCHER", points: 1000, voucherAmount: 5, title: { en: "€5 voucher" }, ...p })).id;

async function cleanRewards() {
  const promos = (await prisma.rewardRedemption.findMany({ where: { promotionId: { not: null } }, select: { promotionId: true } })).map((r) => r.promotionId!);
  await prisma.rewardPartnerCode.deleteMany({});
  await prisma.rewardRedemption.deleteMany({});
  await prisma.rewardItem.deleteMany({});
  await prisma.promotionTarget.deleteMany({ where: { promotionId: { in: promos } } });
  await prisma.cart.updateMany({ where: { couponCode: { startsWith: "RW-" } }, data: { couponCode: null } });
  return promos;
}

async function order(qty: number) {
  const kebab = await ctxFor(KEBAB);
  if (qty > 0) await addToCart(kebab, offerId, qty);
  const addr = await prisma.address.findFirstOrThrow({ where: { companyId: co, kind: "DELIVERY", isActive: true }, orderBy: { isDefault: "desc" } });
  return ((await placeOrder(kebab, { deliveryAddressId: addr.id })) as { id: string }).id;
}
async function deliver(id: string) {
  const lx = await ctxFor(LX), sa = await ctxFor(SA);
  await confirmOrder(lx, id, {});
  for (const s of ["READY_FOR_PICKUP", "DISPATCHED", "OUT_FOR_DELIVERY", "DELIVERED"] as const) await changeOrderStatus(sa, id, s);
}

beforeAll(async () => {
  const kebab = await ctxFor(KEBAB), lx = await ctxFor(LX), sa = await ctxFor(SA);
  co = kebab.company.id; lxId = lx.company.id;
  await cleanRewards();
  await prisma.setting.deleteMany({ where: { key: { in: ["rewards.settings", "loyalty.settings"] } } });
  await prisma.companyFeature.deleteMany({ where: { key: { in: ["REWARDS_SHOP", "LOYALTY"] } } });
  await prisma.loyaltyEntry.deleteMany({ where: { companyId: co } });
  await prisma.loyaltyAccount.deleteMany({ where: { companyId: co } });
  await clearCart(kebab);
  const offer = await prisma.vendorOffer.findFirstOrThrow({ where: { vendorCompanyId: lxId, status: "ACTIVE", packaging: { variant: { sku: "FIR-MOZZ2" }, unitsPerPack: 1 } } });
  offerId = offer.id;
  const wh = await prisma.address.findFirstOrThrow({ where: { companyId: lxId, kind: { in: ["WAREHOUSE", "PICKUP"] } } });
  const cur = await prisma.stockLevel.findUnique({ where: { offerId_addressId: { offerId, addressId: wh.id } } });
  await setStock(lx, offerId, wh.id, Math.max(800, (cur?.reserved ?? 0) + 500));
  await L.adjustPoints(sa, co, 50_000, "Rewards shop test");
});
afterAll(async () => {
  const promos = await cleanRewards();
  await prisma.promotion.updateMany({ where: { id: { in: promos } }, data: { status: "ENDED" } });
  await clearCart(await ctxFor(KEBAB)).catch(() => null);
  await prisma.setting.deleteMany({ where: { key: { in: ["rewards.settings", "loyalty.settings"] } } });
  await prisma.companyFeature.deleteMany({ where: { key: { in: ["REWARDS_SHOP", "LOYALTY"] } } });
  await prisma.loyaltyEntry.deleteMany({ where: { companyId: co } });
  await prisma.loyaltyAccount.deleteMany({ where: { companyId: co } });
  await prisma.$disconnect();
});

describe("rewards shop", () => {
  it("FIRINGI switches it: the shop, the business type, each business; it needs loyalty on", async () => {
    const kebab = await ctxFor(KEBAB), sa = await ctxFor(SA);
    expect((await R.rewardsShop(kebab, "en")).balance).toBe(50_000);
    await settings({ enabled: false });
    await expect(R.rewardsShop(kebab, "en")).rejects.toThrow(/not available/);
    await settings({ buyerTypes: { CUSTOMER: false, WHOLESALER: true } });
    await expect(R.rewardsShop(kebab, "en")).rejects.toThrow(/not available/);
    await R.setRewardsSwitch(sa, co, "ON");
    expect((await R.rewardsShop(kebab, "en")).items).toEqual([]);
    await settings();
    await R.setRewardsSwitch(sa, co, "OFF");
    await expect(R.rewardsShop(kebab, "en")).rejects.toThrow(/not available/);
    await R.setRewardsSwitch(sa, co, "DEFAULT");
    await setCompanyFeature(sa, co, "LOYALTY", false);
    await expect(R.rewardsShop(kebab, "en")).rejects.toThrow(/not available/);
    await setCompanyFeature(sa, co, "LOYALTY", true);
    // a kind switched off leaves the shop
    const v = await voucher();
    await settings({ kinds: { ...DEFAULT_REWARDS_SETTINGS.kinds, VOUCHER: false } });
    expect((await R.rewardsShop(kebab, "en")).items.find((i) => i.id === v)).toBeUndefined();
    await settings();
    expect((await R.rewardsShop(kebab, "en")).items.find((i) => i.id === v)?.blocked).toBeNull();
    await R.setRewardStatus(sa, v, "ENDED");
  });

  it("a voucher costs points, becomes a coupon only this business can use, and is used on an order", async () => {
    const kebab = await ctxFor(KEBAB);
    const id = await voucher({ voucherMinOrder: 10, voucherDays: 30 });
    const before = await balance();
    const r = await R.redeemReward(kebab, id);
    expect(r.couponCode).toMatch(/^RW-[A-Z2-9]{8}$/);
    expect(await balance()).toBe(before - 1000);
    expect(await prisma.loyaltyEntry.findFirst({ where: { companyId: co, kind: "REDEEM_REWARD", dedupeKey: `RW:${r.id}` } })).toBeTruthy();
    const promo = await prisma.promotion.findFirstOrThrow({ where: { code: r.couponCode! }, include: { targets: true } });
    expect(Number(promo.firingiFundPct)).toBe(100);
    expect(promo.maxRedemptions).toBe(1);
    expect(promo.targets.map((t) => t.buyerCompanyId)).toEqual([co]);
    // another business can't use it
    const other = await ctxFor((await makeApprovedCompany("CUSTOMER")).email);
    await addToCart(other, offerId, 1).catch(() => null);
    const { applyCoupon } = await import("@/server/services/cart");
    await expect(applyCoupon(other, r.couponCode!)).rejects.toThrow();
    // "use it": in the cart, then on the order
    await addToCart(kebab, offerId, 6);
    expect(await R.applyRedemption(kebab, r.id)).toEqual({ to: "/buy/orders/cart" });
    const orderId = await order(0);
    const used = await prisma.promotionRedemption.findFirstOrThrow({ where: { promotionId: promo.id, orderId } });
    expect(Number(used.amount)).toBeCloseTo(5, 2);
    expect(Number(used.firingiAmount)).toBeCloseTo(5, 2);
    const job = await R.runRewardsJob();
    expect(job.vouchersUsed).toBeGreaterThanOrEqual(1);
    expect((await prisma.rewardRedemption.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("USED");
    await expect(R.buyerCancelRedemption(kebab, r.id)).rejects.toThrow();
    // the order is cancelled → the voucher is open again
    await changeOrderStatus(kebab, orderId, "CANCELLED", "test");
    await R.runRewardsJob();
    expect((await prisma.rewardRedemption.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("ISSUED");
  });

  it("an unused voucher can be cancelled (points back, coupon ended); an expired one gives the points back in the job", async () => {
    const kebab = await ctxFor(KEBAB);
    const id = await voucher({ kind: "FREE_DELIVERY", voucherAmount: null, points: 700, title: { en: "Free delivery" } });
    const b0 = await balance();
    const a = await R.redeemReward(kebab, id);
    expect((await prisma.promotion.findFirstOrThrow({ where: { code: a.couponCode! } })).kind).toBe("FREE_DELIVERY");
    await R.buyerCancelRedemption(kebab, a.id);
    expect(await balance()).toBe(b0);
    expect((await prisma.promotion.findFirstOrThrow({ where: { code: a.couponCode! } })).status).toBe("ENDED");
    await expect(R.buyerCancelRedemption(kebab, a.id)).rejects.toThrow(/can't be cancelled/);
    // expired unused → points back (FIRINGI's setting); with the setting off → kept
    const b = await R.redeemReward(kebab, id);
    const c = await R.redeemReward(kebab, id);
    const past = new Date(Date.now() - DAY);
    await prisma.rewardRedemption.updateMany({ where: { id: { in: [b.id, c.id] } }, data: { expiresAt: past } });
    await settings({ refundExpired: false });
    const b1 = await balance();
    await R.runRewardsJob();
    expect(await balance()).toBe(b1);
    expect((await prisma.rewardRedemption.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("EXPIRED");
    await settings();
    await prisma.rewardRedemption.update({ where: { id: c.id }, data: { status: "ISSUED" } }); // was expired with the setting off; again with it on
    await R.runRewardsJob();
    expect(await balance()).toBe(b1 + 700);
  });

  it("a supplier's product: FIRINGI approves, the buyer redeems, it is free on the next order (supplier pays), back when cancelled, delivered with the next", async () => {
    const kebab = await ctxFor(KEBAB), lx = await ctxFor(LX), sa = await ctxFor(SA);
    const { id, status } = await R.saveSupplierReward(lx, { offerId, qty: 2, points: 800, stock: 3, perBuyerLimit: null, minTier: null, title: { en: "2 × mozzarella", pt: "2 × mozzarella" } });
    expect(status).toBe("PENDING");
    expect((await R.rewardsShop(kebab, "en")).items.find((i) => i.id === id)).toBeUndefined();
    await expect(R.saveSupplierReward(lx, { offerId, qty: 1, points: 5, stock: 3, perBuyerLimit: null, minTier: null, title: { en: "x" } })).rejects.toThrow(/Points/);
    await R.reviewSupplierReward(sa, id, true, null);
    const shop = await R.rewardsShop(kebab, "en");
    expect(shop.items.find((i) => i.id === id)?.supplier).toBeTruthy();
    const r = await R.redeemReward(kebab, id);
    expect((await prisma.rewardItem.findUniqueOrThrow({ where: { id } })).stock).toBe(2);
    expect((await R.supplierHandovers(lx, "en")).find((h) => h.id === r.id)?.status).toBe("PENDING");
    // free in the cart: 8 in the cart, 2 cost nothing — the supplier pays them (the minimum order counts what is paid)
    await clearCart(kebab);
    await addToCart(kebab, offerId, 8);
    const cart = await cartView(kebab);
    const cl = cart.lines.find((l) => l.offerId === offerId) as unknown as { freeGoods: { qty: number; grants: { id: string }[] } };
    expect(cl.freeGoods.qty).toBe(2);
    expect(cl.freeGoods.grants[0].id).toBe(`rw:${r.id}`);
    const o1 = await order(0);
    const line = await prisma.orderLine.findFirstOrThrow({ where: { orderId: o1, offerId } });
    const list = new Decimal(line.unitListPriceNet.toString());
    expect(Number(new Decimal(line.unitSalePriceNet.toString()).mul(8))).toBeCloseTo(Number(list.mul(6)), 1);
    expect(Number(line.vendorFundedDiscount)).toBeGreaterThan(0);
    let red = await prisma.rewardRedemption.findUniqueOrThrow({ where: { id: r.id } });
    expect([red.status, red.usedQty, red.orderId]).toEqual(["SHIPPED", 2, o1]);
    // cancelled → back to waiting; the next order takes them and is delivered
    await changeOrderStatus(kebab, o1, "CANCELLED", "test");
    red = await prisma.rewardRedemption.findUniqueOrThrow({ where: { id: r.id } });
    expect([red.status, red.usedQty]).toEqual(["PENDING", 0]);
    expect((await R.myRedemptions(kebab, "en")).rows.find((x) => x.id === r.id)?.canCancel).toBe(true);
    await R.applyRedemption(kebab, r.id);
    const o2 = await order(6);
    expect((await prisma.rewardRedemption.findUniqueOrThrow({ where: { id: r.id } })).usedQty).toBe(2);
    await expect(R.supplierCancelRedemption(lx, r.id, "no stock")).rejects.toThrow();
    await deliver(o2);
    await R.runRewardsJob();
    expect((await prisma.rewardRedemption.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("DELIVERED");
  });

  it("the supplier can't give it: points and stock back; not ordered in time: the job gives them back", async () => {
    const kebab = await ctxFor(KEBAB), lx = await ctxFor(LX);
    const item = await prisma.rewardItem.findFirstOrThrow({ where: { kind: "SUPPLIER_PRODUCT", supplierCompanyId: lxId } });
    const b0 = await balance();
    const a = await R.redeemReward(kebab, item.id);
    await expect(R.supplierCancelRedemption(lx, a.id, " ")).rejects.toThrow(/why/);
    await R.supplierCancelRedemption(lx, a.id, "Out of stock this week");
    expect(await balance()).toBe(b0);
    expect((await prisma.rewardItem.findUniqueOrThrow({ where: { id: item.id } })).stock).toBe(2);
    const b = await R.redeemReward(kebab, item.id);
    await prisma.rewardRedemption.update({ where: { id: b.id }, data: { expiresAt: new Date(Date.now() - DAY) } });
    const out = await R.runRewardsJob();
    expect(out.productsExpired).toBe(1);
    expect(await balance()).toBe(b0);
    expect((await prisma.rewardRedemption.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("EXPIRED");
    // the supplier pauses it: out of the shop
    await R.setSupplierRewardStatus(lx, item.id, "PAUSED");
    expect((await R.rewardsShop(kebab, "en")).items.find((i) => i.id === item.id)).toBeUndefined();
  });

  it("a gift with a stock count goes to an address and FIRINGI ships it; sold out after", async () => {
    const kebab = await ctxFor(KEBAB), sa = await ctxFor(SA);
    await expect(R.saveAdminReward(sa, { ...base, kind: "GIFT", points: 2000, title: { en: "Apron" } })).rejects.toThrow(/stock/);
    const { id } = await R.saveAdminReward(sa, { ...base, kind: "GIFT", points: 2000, stock: 1, giftCost: 12.5, title: { en: "FIRINGI apron" } });
    const detail = await R.rewardForBuyer(kebab, id, "en");
    expect(detail.addresses.length).toBeGreaterThan(0);
    const g = await R.redeemReward(kebab, id, { addressId: detail.addresses[0].id });
    expect((await R.rewardsShop(kebab, "en")).items.find((i) => i.id === id)?.blocked).toBe("SOLD_OUT");
    await expect(R.redeemReward(kebab, id)).rejects.toThrow(/sold out/);
    const row = (await R.adminRedemptions(sa, { status: "PENDING", kind: "GIFT" })).find((x) => x.id === g.id)!;
    expect(row.address).toBeTruthy();
    await R.fulfilGift(sa, g.id, "SHIP", "CTT RR123456789PT");
    await expect(R.buyerCancelRedemption(kebab, g.id)).rejects.toThrow();
    await R.fulfilGift(sa, g.id, "DELIVER", null);
    const mine = (await R.myRedemptions(kebab, "en")).rows.find((x) => x.id === g.id)!;
    expect([mine.status, mine.tracking]).toEqual(["DELIVERED", "CTT RR123456789PT"]);
  });

  it("partner offers: codes pasted (duplicates skipped), one per redemption, sold out when used up", async () => {
    const kebab = await ctxFor(KEBAB), sa = await ctxFor(SA);
    await expect(R.saveAdminReward(sa, { ...base, kind: "PARTNER", points: 300, title: { en: "Coffee" } })).rejects.toThrow(/partner/);
    const { id } = await R.saveAdminReward(sa, { ...base, kind: "PARTNER", points: 300, partnerName: "Café Partner", partnerUrl: "https://partner.example/redeem", title: { en: "10% at Café Partner" } });
    expect(await R.addPartnerCodes(sa, id, "AAA-111\nBBB-222, AAA-111\nx\n")).toEqual({ added: 2, skipped: 0, bad: 1 });
    expect((await R.addPartnerCodes(sa, id, "BBB-222")).skipped).toBe(1);
    const a = await R.redeemReward(kebab, id), b = await R.redeemReward(kebab, id);
    expect([a.partnerCode, b.partnerCode].sort()).toEqual(["AAA-111", "BBB-222"]);
    expect(a.partnerUrl).toBe("https://partner.example/redeem");
    await expect(R.redeemReward(kebab, id)).rejects.toThrow(/sold out/);
    expect((await R.adminReward(sa, id)).codes).toEqual({ total: 2, used: 2, left: 0 });
    await expect(R.buyerCancelRedemption(kebab, a.id)).rejects.toThrow();
  });

  it("limits: tier, per business, monthly points, not enough points; saving for a goal", async () => {
    const kebab = await ctxFor(KEBAB);
    const gold = await voucher({ minTier: "GOLD", title: { en: "Gold voucher" } });
    const once = await voucher({ perBuyerLimit: 1, title: { en: "Once" } });
    const big = await voucher({ points: 10_000_000, title: { en: "Huge" } });
    const shop = await R.rewardsShop(kebab, "en");
    expect(shop.items.find((i) => i.id === gold)?.blocked).toBe("TIER");
    expect(shop.items.find((i) => i.id === big)?.blocked).toBe("POINTS");
    await expect(R.redeemReward(kebab, gold)).rejects.toThrow(/tier/);
    await R.redeemReward(kebab, once);
    await expect(R.redeemReward(kebab, once)).rejects.toThrow(/as often as allowed/);
    const spent = (await R.rewardsShop(kebab, "en")).spentThisMonth;
    await settings({ monthlyLimit: spent + 500 });
    const fresh = await voucher({ title: { en: "Fresh" } });
    await expect(R.redeemReward(kebab, fresh)).rejects.toThrow(/monthly/);
    await settings();
    await R.setRewardGoal(kebab, big);
    const g = (await R.rewardsShop(kebab, "en")).goal!;
    expect(g.id).toBe(big);
    expect(g.progress.missing).toBeGreaterThan(0);
    await R.setRewardGoal(kebab, null);
    expect((await R.rewardsShop(kebab, "en")).goal).toBeNull();
  });

  it("the job warns about low stock once; FIRINGI's numbers add up", async () => {
    const sa = await ctxFor(SA);
    const { id } = await R.saveAdminReward(sa, { ...base, kind: "GIFT", points: 100, stock: 2, title: { en: "Mug" } });
    const a = await R.runRewardsJob();
    expect(a.lowStock).toBeGreaterThanOrEqual(1);
    expect((await R.runRewardsJob()).lowStock).toBe(0);
    await R.saveAdminReward(sa, { ...base, id, kind: "GIFT", points: 100, stock: 50, title: { en: "Mug" } });
    expect((await prisma.rewardItem.findUniqueOrThrow({ where: { id } })).lowStockSentAt).toBeNull();
    const o = await R.rewardsOverview(sa);
    expect(o.byKind.find((k) => k.kind === "PARTNER")?.count).toBe(2);
    expect(o.byKind.find((k) => k.kind === "GIFT")?.count).toBe(1);
    expect(Number(o.giftCost)).toBeCloseTo(12.5, 2);
    expect(Number(o.voucherDiscount)).toBeGreaterThanOrEqual(0);
    await expect(R.rewardsOverview(await ctxFor(KEBAB))).rejects.toThrow();
  });
});
