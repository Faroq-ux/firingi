/**
 * Phase 32: loyalty & rewards — points on delivered goods (tier and campaign multipliers), spent at
 * checkout as a FIRINGI-funded discount (supplier payout unchanged) or as a credit note on an unpaid
 * invoice; cancelled orders give points back, credited goods take them back; expiry and reminders;
 * tiers by 12-month spend with Gold perks; referral bonus; the switches.
 */
import Decimal from "decimal.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { addToCart, cartView, clearCart, setCartPoints } from "@/server/services/cart";
import { changeOrderStatus, confirmOrder, placeOrder } from "@/server/services/orders";
import { setStock } from "@/server/services/vendor-catalogue";
import { issueCreditNote } from "@/server/services/finance";
import { openTicket } from "@/server/services/support";
import { openAmounts } from "@/server/payments/service";
import { setCompanyFeature } from "@/server/accounting/features";
import * as L from "@/server/loyalty/service";
import { ctxFor, makeApprovedCompany } from "../helpers";

const KEBAB = "owner@kebabhouse.test", LX_OWNER = "owner@lisboacentral.test", SA = "superadmin@firingi.test", OPS = "ops@firingi.test", MKT = "sales@firingi.test";
let original: L.LoyaltySettings;

beforeAll(async () => {
  original = await L.loyaltySettings();
  const k = await ctxFor(KEBAB);
  await prisma.loyaltyEntry.deleteMany({ where: { companyId: k.company.id } });
  await prisma.loyaltyAccount.deleteMany({ where: { companyId: k.company.id } });
  await prisma.loyaltyCampaign.deleteMany({});
});
afterAll(async () => {
  // leave no points, levels or perks behind for the other test files (Gold = free delivery, priority support)
  await prisma.loyaltyEntry.deleteMany({});
  await prisma.loyaltyAccount.updateMany({ data: { referredById: null } });
  await prisma.loyaltyAccount.deleteMany({});
  await prisma.setting.deleteMany({ where: { key: "loyalty.settings" } });
  await prisma.loyaltyCampaign.deleteMany({});
  await prisma.companyFeature.deleteMany({ where: { key: "LOYALTY" } });
  await prisma.$disconnect();
});

async function order(sku: string, qty: number, opts: { points?: number; unitsPerPack?: number } = {}) {
  const kebab = await ctxFor(KEBAB), lx = await ctxFor(LX_OWNER);
  await clearCart(kebab);
  const offer = await prisma.vendorOffer.findFirstOrThrow({ where: { vendorCompanyId: lx.company.id, status: "ACTIVE", packaging: { variant: { sku }, ...(opts.unitsPerPack ? { unitsPerPack: opts.unitsPerPack } : {}) } } });
  const wh = await prisma.address.findFirstOrThrow({ where: { companyId: lx.company.id, kind: { in: ["WAREHOUSE", "PICKUP"] } } });
  const cur = await prisma.stockLevel.findUnique({ where: { offerId_addressId: { offerId: offer.id, addressId: wh.id } } });
  await setStock(lx, offer.id, wh.id, Math.max(800, (cur?.reserved ?? 0) + 500));
  await addToCart(kebab, offer.id, qty);
  if (opts.points) await setCartPoints(kebab, opts.points);
  const addr = await prisma.address.findFirstOrThrow({ where: { companyId: kebab.company.id, kind: "DELIVERY", isActive: true }, orderBy: { isDefault: "desc" } });
  const { id } = await placeOrder(kebab, { deliveryAddressId: addr.id }) as { id: string };
  return id;
}
async function deliver(id: string) {
  const lx = await ctxFor(LX_OWNER);
  await confirmOrder(lx, id, {});
  for (const s of ["READY_FOR_PICKUP", "DISPATCHED", "OUT_FOR_DELIVERY", "DELIVERED"] as const) await changeOrderStatus(lx, id, s);
}
const balance = async () => (await prisma.loyaltyAccount.findUniqueOrThrow({ where: { companyId: (await ctxFor(KEBAB)).company.id } })).balance;
const goodsOf = async (orderId: string) => {
  const inv = await prisma.invoice.findFirstOrThrow({ where: { orderId, docType: "INVOICE" }, include: { lines: { where: { orderLineId: { not: null } } } } });
  return inv.lines.reduce((a, l) => a.plus(l.lineNet.toString()), new Decimal(0));
};

describe("loyalty & rewards", () => {
  it("settings: defaults, checks, only marketing managers", async () => {
    expect(original.pointsPerEuro).toBe(1);
    expect(original.tiers.GOLD.freeDelivery).toBe(true);
    const sa = await ctxFor(SA);
    await expect(L.saveLoyaltySettings(await ctxFor(KEBAB), { pointsPerEuro: 2 })).rejects.toThrow();
    await expect(L.saveLoyaltySettings(sa, { maxRedeemPct: 0 })).rejects.toThrow(/Maximum share/);
    await expect(L.saveLoyaltySettings(sa, { tiers: { ...original.tiers, GOLD: { ...original.tiers.GOLD, minSpend: 10 } } })).rejects.toThrow(/Gold needs more/);
    const s = await L.saveLoyaltySettings(sa, { minRedeem: 500 });
    expect(s.minRedeem).toBe(500);
  });

  it("points on delivered goods (net, after discounts), once; a 2× campaign doubles them", async () => {
    const k = await ctxFor(KEBAB), lx = await ctxFor(LX_OWNER), sa = await ctxFor(SA);
    const id = await order("FIR-PIZZABOX33", 8);
    expect(await L.earnForOrder(id)).toBeNull(); // not delivered yet
    await deliver(id); // the delivery hook credits the points
    const goods = await goodsOf(id);
    const e = await prisma.loyaltyEntry.findUniqueOrThrow({ where: { dedupeKey: `EARN:${id}` } });
    expect(e.points).toBe(goods.floor().toNumber());
    expect(e.remaining).toBe(e.points);
    expect(e.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 300 * 86400_000);
    expect(await balance()).toBe(e.points);
    expect(await L.earnForOrder(id)).toBeNull(); // once
    await L.runLoyaltyJob();
    expect(await prisma.loyaltyEntry.count({ where: { orderId: id, kind: "EARN" } })).toBe(1); // the job doesn't add it again

    const c = await L.saveCampaign(sa, { name: "Double points Lisboa Central", multiplier: 2, startsAt: new Date(Date.now() - 3600_000), endsAt: new Date(Date.now() + 7 * 86400_000), vendorIds: [lx.company.id] });
    const id2 = await order("FIR-PIZZABOX33", 8);
    await deliver(id2);
    const e2 = await prisma.loyaltyEntry.findUniqueOrThrow({ where: { dedupeKey: `EARN:${id2}` } });
    const tier = (await prisma.loyaltyAccount.findUniqueOrThrow({ where: { companyId: k.company.id } })).tier; // the job above may have moved the level
    expect(e2.points).toBe((await goodsOf(id2)).mul(2).mul(original.tiers[tier].multiplier).floor().toNumber());
    expect(e2.campaignId).toBe(c.id);
    const me = await L.myRewards(k);
    expect(me.on && me.campaigns.map((x) => x.id)).toContain(c.id);
    await L.endCampaign(sa, c.id);

    // the programme start: set the first time it runs; orders delivered before it earn nothing
    expect((await L.loyaltySettings()).startsOn).toBe(new Date().toISOString().slice(0, 10));
    await L.saveLoyaltySettings(sa, { startsOn: new Date(Date.now() + 2 * 86400_000).toISOString().slice(0, 10) });
    const id3 = await order("FIR-PIZZABOX33", 8);
    await deliver(id3);
    expect(await prisma.loyaltyEntry.count({ where: { orderId: id3, kind: "EARN" } })).toBe(0);
    await L.saveLoyaltySettings(sa, { startsOn: null });
  });

  it("checkout: points as a FIRINGI-funded discount (supplier payout unchanged); cancelled → points back", async () => {
    const k = await ctxFor(KEBAB), sa = await ctxFor(SA);
    await L.adjustPoints(sa, k.company.id, 5000, "Test bonus");
    await expect(L.adjustPoints(await ctxFor(OPS), k.company.id, 5, "nope")).rejects.toThrow();
    const before = await balance();
    await clearCart(k);
    const offer = await prisma.vendorOffer.findFirstOrThrow({ where: { vendorCompanyId: (await ctxFor(LX_OWNER)).company.id, status: "ACTIVE", packaging: { variant: { sku: "FIR-PIZZABOX33" } } } });
    await addToCart(k, offer.id, 8);
    await expect(setCartPoints(k, 100)).rejects.toThrow(/at least 500/);
    await expect(setCartPoints(k, before + 1)).rejects.toThrow(/You have/);
    const plain = await cartView(k);
    await setCartPoints(k, 1000);
    const v = await cartView(k);
    expect(v.loyalty).toMatchObject({ requested: 1000, used: 1000, euros: "10.00" });
    expect(Number(v.totalNet)).toBeCloseTo(Number(plain.totalNet) - 10, 2);
    expect(v.offerDiscount).toBe(plain.offerDiscount); // shown apart from offers

    const addr = await prisma.address.findFirstOrThrow({ where: { companyId: k.company.id, kind: "DELIVERY", isActive: true }, orderBy: { isDefault: "desc" } });
    const { id } = await placeOrder(k, { deliveryAddressId: addr.id }) as { id: string };
    expect(await balance()).toBe(before - 1000);
    const spent = await prisma.loyaltyEntry.findFirstOrThrow({ where: { orderId: id, kind: "REDEEM_ORDER" } });
    expect(spent).toMatchObject({ points: -1000 });
    expect(Number(spent.euros)).toBe(10);
    const ds = await prisma.orderLineDiscount.findMany({ where: { promotionId: L.LOYALTY_PROMOTION_ID, orderLine: { orderId: id } } });
    expect(ds.reduce((a, d) => a + Number(d.amount), 0)).toBeCloseTo(10, 2);
    expect(ds.reduce((a, d) => a + Number(d.vendorAmount), 0)).toBe(0); // FIRINGI pays
    const o = await prisma.order.findUniqueOrThrow({ where: { id }, include: { lines: true } });
    const listCost = o.lines.reduce((a, l) => a + Number(l.vendorUnitCostNet) * l.qtyOrdered, 0);
    expect(Number(o.vendorPayableNet)).toBeCloseTo(listCost, 1); // the supplier is paid as without points
    expect((await prisma.cart.findFirstOrThrow({ where: { buyerCompanyId: k.company.id, userId: k.user.id } })).loyaltyPoints).toBe(0);

    await changeOrderStatus(sa, id, "CANCELLED", "Test: cancelled");
    expect(await balance()).toBe(before);
    expect(await prisma.loyaltyEntry.count({ where: { orderId: id, kind: "REFUND" } })).toBe(1);
    expect((await L.runLoyaltyJob()).refunded).toBe(0); // once
  });

  it("checkout: at most the share set by FIRINGI; points that are gone are refused at checkout", async () => {
    const k = await ctxFor(KEBAB), sa = await ctxFor(SA);
    await L.saveLoyaltySettings(sa, { maxRedeemPct: 10 });
    await clearCart(k);
    const offer = await prisma.vendorOffer.findFirstOrThrow({ where: { vendorCompanyId: (await ctxFor(LX_OWNER)).company.id, status: "ACTIVE", packaging: { variant: { sku: "FIR-PIZZABOX33" } } } });
    await addToCart(k, offer.id, 8);
    const bal = await balance();
    await setCartPoints(k, Math.min(bal, 100000));
    const v = await cartView(k);
    expect(v.loyalty!.reason).toBe("CAPPED");
    expect(Number(v.loyalty!.euros)).toBeLessThanOrEqual(Number(v.goodsNet) * 0.12);
    await L.saveLoyaltySettings(sa, { maxRedeemPct: 50 });
    await setCartPoints(k, 600);
    await L.adjustPoints(sa, k.company.id, -(await balance()) + 100, "Test: spend most");
    const addr = await prisma.address.findFirstOrThrow({ where: { companyId: k.company.id, kind: "DELIVERY", isActive: true }, orderBy: { isDefault: "desc" } });
    await expect(placeOrder(k, { deliveryAddressId: addr.id })).rejects.toThrow(/fewer than you chose/);
    await setCartPoints(k, 0);
    await clearCart(k);
  });

  it("points → credit note on the oldest unpaid invoice; credited goods take earned points back", async () => {
    const k = await ctxFor(KEBAB), sa = await ctxFor(SA);
    await L.adjustPoints(sa, k.company.id, 3000, "Test bonus");
    await expect(L.redeemAsCreditNote(k, 500)).rejects.toThrow(/at least 1000/);
    const id = await order("FIR-PIZZABOX33", 8);
    await deliver(id);
    const bal = await balance();
    const r = await L.redeemAsCreditNote(k, 1000);
    expect(r.gross).toBe("10.00");
    const cn = await prisma.invoice.findUniqueOrThrow({ where: { id: r.id }, include: { lines: true } });
    expect(cn.docType).toBe("CREDIT_NOTE");
    expect(cn.lines.every((l) => l.orderLineId === null && l.description.startsWith("Desconto por pontos"))).toBe(true);
    expect(Number(cn.grossTotal)).toBeCloseTo(10, 2);
    const open = await openAmounts([cn.originalInvoiceId!]);
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: cn.originalInvoiceId! } });
    expect(Number(open.get(inv.id))).toBeLessThanOrEqual(Number(inv.grossTotal) - 10 + 0.001);
    expect(await balance()).toBe(bal - 1000);
    await L.runLoyaltyJob();
    expect(await prisma.loyaltyEntry.count({ where: { kind: "REVERSE", invoiceId: r.id } })).toBe(0); // a rebate is not "goods credited"

    // goods credited (FIRINGI's credit note on the delivered order) → earned points go back
    const earn = await prisma.loyaltyEntry.findUniqueOrThrow({ where: { dedupeKey: `EARN:${id}` } });
    const invoice = await prisma.invoice.findFirstOrThrow({ where: { orderId: id, docType: "INVOICE" } });
    const before = await balance();
    await issueCreditNote(sa, invoice.id, { lines: "ALL", reason: "Test: all returned" });
    await L.runLoyaltyJob();
    const back = await prisma.loyaltyEntry.findFirstOrThrow({ where: { kind: "REVERSE", orderId: id } });
    expect(back.points).toBe(-earn.points);
    expect(await balance()).toBe(before - earn.points);
  });

  it("expiry (oldest first) and a reminder before", async () => {
    const k = await ctxFor(KEBAB), sa = await ctxFor(SA);
    const lot = await L.adjustPoints(sa, k.company.id, 700, "Test: expiring lot");
    await prisma.loyaltyEntry.update({ where: { id: lot!.id }, data: { expiresAt: new Date(Date.now() - 1000), createdAt: new Date(Date.now() - 400 * 86400_000) } });
    const soon = await L.adjustPoints(sa, k.company.id, 300, "Test: soon");
    await prisma.loyaltyEntry.update({ where: { id: soon!.id }, data: { expiresAt: new Date(Date.now() + 10 * 86400_000) } });
    await prisma.loyaltyAccount.update({ where: { companyId: k.company.id }, data: { expiryRemindedAt: null } });
    const before = await balance();
    const r = await L.runLoyaltyJob();
    expect(r.expired).toBeGreaterThanOrEqual(1);
    expect(r.reminded).toBeGreaterThanOrEqual(1);
    const exp = await prisma.loyaltyEntry.findFirstOrThrow({ where: { companyId: k.company.id, kind: "EXPIRE" }, orderBy: { createdAt: "desc" } });
    expect(exp.points).toBe(-700);
    expect(await balance()).toBe(before - 700);
    const n = await prisma.notificationMessage.findFirst({ where: { companyId: k.company.id, eventKey: "loyalty.expiring" }, orderBy: { createdAt: "desc" } });
    expect(n).toBeTruthy();
    expect((await L.runLoyaltyJob()).reminded).toBe(0); // not again so soon
    const me = await L.myRewards(k);
    expect(me.on && me.expiring?.points).toBeGreaterThanOrEqual(300);
  });

  it("tiers by 12-month spend: multiplier, Gold free delivery and priority support", async () => {
    const k = await ctxFor(KEBAB), sa = await ctxFor(SA);
    await prisma.loyaltyCampaign.updateMany({ data: { active: false } }); // no bonus campaign running here
    await L.saveLoyaltySettings(sa, { tiers: { ...original.tiers, SILVER: { ...original.tiers.SILVER, minSpend: 1 }, GOLD: { ...original.tiers.GOLD, minSpend: 2 } } });
    await prisma.loyaltyAccount.update({ where: { companyId: k.company.id }, data: { tier: "BRONZE" } });
    await L.runLoyaltyJob();
    const acc = await prisma.loyaltyAccount.findUniqueOrThrow({ where: { companyId: k.company.id } });
    expect(acc.tier).toBe("GOLD");
    expect(Number(acc.spend12m)).toBeGreaterThan(2);
    expect(await prisma.notificationMessage.count({ where: { companyId: k.company.id, eventKey: "loyalty.tier_up" } })).toBeGreaterThan(0);
    // Gold: 1.5× points
    const id = await order("FIR-PIZZABOX33", 8);
    await deliver(id);
    expect((await prisma.loyaltyEntry.findUniqueOrThrow({ where: { dedupeKey: `EARN:${id}` } })).points).toBe((await goodsOf(id)).mul(1.5).floor().toNumber());
    // Gold: free delivery on a small order that normally pays a fee (FIRINGI pays)
    await clearCart(k);
    const small = await prisma.vendorOffer.findFirstOrThrow({ where: { vendorCompanyId: (await ctxFor(LX_OWNER)).company.id, status: "ACTIVE", packaging: { variant: { sku: "FIR-MOZZ2" }, unitsPerPack: 1 } } });
    await addToCart(k, small.id, 5);
    const v = await cartView(k);
    expect(v.freeDelivery).toBeTruthy();
    expect(v.delivery && "feeNet" in v.delivery ? Number(v.delivery.feeNet) : 0).toBe(0);
    await clearCart(k);
    // Gold: priority support
    const t = await openTicket(k, { subject: "Pergunta", body: "Uma pergunta geral", category: "OTHER" });
    expect(t.priority).toBe("HIGH");
    await prisma.supportTicket.delete({ where: { id: t.id } });
    await L.saveLoyaltySettings(sa, { tiers: original.tiers });
  });

  it("referral: invite code at registration; both get points after the invited business's first delivery", async () => {
    const k = await ctxFor(KEBAB);
    const code = (await L.ensureAccount(prisma, k.company.id)).referralCode;
    // a newly registered business (no orders yet)
    const other = { id: (await makeApprovedCompany("CUSTOMER")).companyId };
    expect(await L.attachReferral(k.company.id, code)).toBe(false); // not yourself
    expect(await L.attachReferral(other.id, code.toLowerCase())).toBe(true);
    expect(await L.attachReferral(other.id, code)).toBe(false); // only once
    const before = await balance();
    await L.runLoyaltyJob(); // no delivered order of theirs yet → nothing
    expect(await balance()).toBe(before);
    await prisma.$transaction((tx) => L.addPoints(tx, other.id, { kind: "EARN", points: 10, dedupeKey: `EARN:test-${other.id}` }, original));
    await L.runLoyaltyJob();
    expect(await balance()).toBe(before + original.referral.inviter);
    expect((await prisma.loyaltyAccount.findUniqueOrThrow({ where: { companyId: other.id } })).balance).toBe(10 + original.referral.invited);
    await L.runLoyaltyJob();
    expect(await balance()).toBe(before + original.referral.inviter); // once
    const me = await L.myRewards(k);
    expect(me.on && me.invited.map((i) => i.rewarded)).toContain(true);
  });

  it("switches: per company and global; distributors aren't part of it; staff pages for marketing only", async () => {
    const k = await ctxFor(KEBAB), sa = await ctxFor(SA), lx = await ctxFor(LX_OWNER);
    await setCompanyFeature(sa, k.company.id, "LOYALTY", false);
    expect(await L.loyaltyOn(k.company.id)).toBe(false);
    expect((await L.myRewards(k)).on).toBe(false);
    await expect(setCartPoints(k, 500)).rejects.toThrow();
    await setCompanyFeature(sa, k.company.id, "LOYALTY", true);
    expect(await L.loyaltyOn(k.company.id)).toBe(true);
    const dist = await prisma.company.findFirstOrThrow({ where: { type: "DISTRIBUTOR" } });
    expect(await L.loyaltyOn(dist.id)).toBe(false);
    await expect(L.myRewards(lx)).resolves.toBeTruthy(); // Lisboa Central is a wholesaler: it buys too
    await L.saveLoyaltySettings(sa, { enabled: false });
    expect(await L.loyaltyOn(k.company.id)).toBe(false);
    expect(await L.runLoyaltyJob()).toMatchObject({ earned: 0, expired: 0 });
    await L.saveLoyaltySettings(sa, { enabled: true });
    const ov = await L.loyaltyOverview(sa);
    expect(ov.accounts).toBeGreaterThan(0);
    expect(Number(ov.liability)).toBeCloseTo(ov.balance * original.pointValue, 2);
    expect((await L.listMembers(sa)).some((m) => m.companyId === k.company.id)).toBe(true);
    await expect(L.loyaltyOverview(k)).rejects.toThrow();
    await expect(L.listMembers(await ctxFor(OPS))).rejects.toThrow();
    void MKT;
  });
});
