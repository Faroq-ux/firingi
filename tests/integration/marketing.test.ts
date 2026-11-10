/**
 * Phase 15: coupons and customer offers — the money must be right.
 * € off the order (spread over lines, VAT per line), free delivery paid by FIRINGI or the
 * supplier, buy X get Y, coupon limits, first order, segment / company targeting, routed carts.
 */
import Decimal from "decimal.js";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { addToCart, applyCoupon, cartView, clearCart, removeCoupon, setCartQty } from "@/server/services/cart";
import { changeOrderStatus, placeOrder } from "@/server/services/orders";
import { setStock } from "@/server/services/vendor-catalogue";
import { saveAdminPromotion, saveVendorPromotion } from "@/server/services/promotions";
import { setVendorMinimum } from "@/server/services/delivery-rules";
import { saveSegment } from "@/server/services/crm-insights";
import { catalogueItem } from "@/server/data/catalogue-buyer";
import { ctxFor } from "../helpers";

afterAll(() => prisma.$disconnect());
const KEBAB = "owner@kebabhouse.test";
const LXB = "purchasing@lisboacentral.test";
const SA = "superadmin@firingi.test";
const since = () => new Date(Date.now() - 1000);
let n = 0;
const code = (p: string) => `${p}${Date.now().toString(36).toUpperCase()}${n++}`;

async function offerOf(vendor: string, sku: string, units?: number) {
  return prisma.vendorOffer.findFirstOrThrow({ where: { vendor: { legalName: vendor }, status: "ACTIVE", packaging: { variant: { sku }, ...(units ? { unitsPerPack: units } : {}) } } });
}
async function restock(offerId: string, ownerEmail: string) {
  const v = await ctxFor(ownerEmail);
  const wh = await prisma.address.findFirstOrThrow({ where: { companyId: v.company.id, kind: { in: ["WAREHOUSE", "PICKUP"] } } });
  const cur = await prisma.stockLevel.findUnique({ where: { offerId_addressId: { offerId, addressId: wh.id } } });
  await setStock(v, offerId, wh.id, Math.max(2000, (cur?.reserved ?? 0) + 1000));
}
const addressOf = async (companyId: string) => (await prisma.address.findFirstOrThrow({ where: { companyId, kind: "DELIVERY", isActive: true }, orderBy: { isDefault: "desc" } })).id;
async function cartWith(email: string, offerId: string, qty: number, owner: string) {
  await restock(offerId, owner);
  const b = await ctxFor(email);
  await clearCart(b);
  await removeCoupon(b);
  await addToCart(b, offerId, qty);
  return b;
}
const order = (id: string) => prisma.order.findUniqueOrThrow({ where: { id }, include: { lines: { include: { discounts: true } }, redemptions: true } });

beforeEach(async () => {
  await prisma.promotion.updateMany({ where: { status: "ACTIVE" }, data: { status: "ENDED" } }); // isolate
});

describe("coupons", () => {
  it("% coupon (FIRINGI pays): shown in the cart, recorded per line and as a redemption; once per customer", async () => {
    const sa = await ctxFor(SA);
    const c = code("BEMVINDO");
    const promo = await saveAdminPromotion(sa, { name: { en: "Welcome 10 %" }, kind: "PERCENT", value: 10, firingiFundPct: 100, validFrom: since(), code: c.toLowerCase(), maxPerCustomer: 1, targets: {} });
    const mozz = await offerOf("Grossista Lisboa Central, Lda", "FIR-MOZZ2", 1);
    const k = await cartWith(KEBAB, mozz.id, 10, "owner@lisboacentral.test");
    const before = await cartView(k);
    await expect(applyCoupon(k, "NOPE-123")).rejects.toMatchObject({ code: "COUPON_UNKNOWN" });
    await applyCoupon(k, ` ${c.toLowerCase()} `);
    const v = await cartView(k);
    expect(v.coupon).toMatchObject({ code: c, ok: true });
    expect(Number(v.goodsNet)).toBeCloseTo(Number(before.goodsNet) * 0.9, 1);
    expect(Number(v.coupon!.savings)).toBeCloseTo(Number(before.goodsNet) * 0.1, 1);

    const { id } = await placeOrder(k, { deliveryAddressId: await addressOf(k.company.id) });
    const o = await order(id);
    expect(o.couponCode).toBe(c);
    const d = o.lines[0].discounts.find((x) => x.promotionId === promo.id)!;
    expect(d.vendorAmount.toFixed(2)).toBe("0.00");
    expect(Number(d.firingiAmount)).toBeCloseTo(Number(before.goodsNet) * 0.1, 1);
    // FIRINGI pays: the supplier's payout is unchanged, commission still on the list price.
    expect(o.lines[0].vendorFundedDiscount.toFixed(4)).toBe("0.0000");
    expect(o.lines[0].commissionBase.toFixed(2)).toBe(new Decimal(o.lines[0].unitListPriceNet.toString()).mul(10).toFixed(2));
    expect(o.redemptions.map((r) => [r.promotionId, r.code, r.vendorAmount.toFixed(2)])).toEqual([[promo.id, c, "0.00"]]);
    expect(Number(o.redemptions[0].amount)).toBeCloseTo(Number(d.firingiAmount), 2);
    expect((await prisma.cart.findFirstOrThrow({ where: { buyerCompanyId: k.company.id, userId: k.user.id } })).couponCode).toBeNull();

    await cartWith(KEBAB, mozz.id, 10, "owner@lisboacentral.test");
    await expect(applyCoupon(k, c)).rejects.toMatchObject({ code: "COUPON_LIMIT_REACHED" });
    // A cancelled order gives the use back.
    await changeOrderStatus(k, id, "CANCELLED", "test");
    await applyCoupon(k, c);
    await clearCart(k); await removeCoupon(k);
  });

  it("€ off the order: needs the minimum, spread over the lines with VAT per line; total uses capped", async () => {
    const sa = await ctxFor(SA);
    const c = code("MENOS20");
    const promo = await saveAdminPromotion(sa, { name: { en: "20 € off" }, kind: "ORDER_AMOUNT", value: 20, firingiFundPct: 100, validFrom: since(), code: c, minOrderValue: 200, maxRedemptions: 1, targets: {} });
    const mozz = await offerOf("Grossista Lisboa Central, Lda", "FIR-MOZZ2", 1);
    const box = await offerOf("Grossista Lisboa Central, Lda", "FIR-PIZZABOX33");
    const k = await cartWith(KEBAB, mozz.id, 5, "owner@lisboacentral.test");
    await applyCoupon(k, c);
    let v = await cartView(k);
    expect(v.coupon).toMatchObject({ ok: false, error: { code: "COUPON_MIN_ORDER" } });
    expect(v.offerDiscount).toBe("0.00");
    await expect(placeOrder(k, { deliveryAddressId: await addressOf(k.company.id) })).rejects.toMatchObject({ code: "COUPON_MIN_ORDER" });

    await restock(box.id, "owner@lisboacentral.test");
    await addToCart(k, box.id, 10);
    await setCartQty(k, mozz.id, 12);
    v = await cartView(k);
    expect(v.coupon).toMatchObject({ ok: true, savings: "20.00" });
    expect(v.offerDiscount).toBe("20.00");
    const linesSum = v.lines.reduce((a, l) => a + Number(l.lineNet), 0);
    expect(Number(v.goodsNet)).toBeCloseTo(linesSum - 20, 2);

    const { id } = await placeOrder(k, { deliveryAddressId: await addressOf(k.company.id) });
    const o = await order(id);
    const given = o.lines.flatMap((l) => l.discounts.filter((d) => d.promotionId === promo.id));
    expect(given).toHaveLength(2); // both lines carry a share
    expect(Math.abs(given.reduce((a, d) => a + Number(d.firingiAmount), 0) - 20)).toBeLessThanOrEqual(0.02);
    // VAT is on each line's discounted value (mozzarella 6 %, boxes 23 %).
    for (const l of o.lines) expect(l.lineVat.toFixed(2)).toBe(new Decimal(l.lineNet.toString()).mul(l.taxRate.toString()).div(100).toDecimalPlaces(2).toFixed(2));
    expect(o.discountTotal.toNumber()).toBeGreaterThanOrEqual(19.98);

    // maxRedemptions 1 → used up for everyone
    const lxb = await cartWith(LXB, (await offerOf("Distribuidora Atlântico, Lda", "FIR-FARINHA25")).id, 20, "owner@atlantico.test");
    await expect(applyCoupon(lxb, c)).rejects.toMatchObject({ code: "COUPON_USED_UP" });
    await clearCart(lxb);
  });

  it("first-order-only coupons and another supplier's coupon are refused", async () => {
    const sa = await ctxFor(SA);
    const first = code("PRIMEIRA");
    await saveAdminPromotion(sa, { name: { en: "First order" }, kind: "PERCENT", value: 15, firingiFundPct: 100, validFrom: since(), code: first, firstOrderOnly: true, targets: {} });
    const lx = await ctxFor("owner@lisboacentral.test");
    const theirs = code("LXBOX");
    await saveVendorPromotion(lx, { name: { en: "LX boxes" }, kind: "PERCENT", value: 5, validFrom: since(), code: theirs, targets: {} });
    const cca = await offerOf("Cash & Carry Almada, Lda", "FIR-ARROZ1");
    const k = await cartWith(KEBAB, cca.id, 30, "owner@ccalmada.test");
    await expect(applyCoupon(k, first)).rejects.toMatchObject({ code: "COUPON_FIRST_ORDER" });
    await expect(applyCoupon(k, theirs)).rejects.toMatchObject({ code: "COUPON_OTHER_SUPPLIER" });
    await clearCart(k);
  });

  it("supplier coupon buy 10 get 1: the supplier pays the free units", async () => {
    const lx = await ctxFor("owner@lisboacentral.test");
    const c = code("LEVA11");
    const mozz = await offerOf("Grossista Lisboa Central, Lda", "FIR-MOZZ2", 1);
    const promo = await saveVendorPromotion(lx, { name: { en: "10 + 1" }, kind: "BUY_X_GET_Y", value: 1, buyQty: 10, freeQty: 1, validFrom: since(), code: c, targets: { offerIds: [mozz.id] } });
    const k = await cartWith(KEBAB, mozz.id, 5, "owner@lisboacentral.test");
    await applyCoupon(k, c);
    expect((await cartView(k)).coupon).toMatchObject({ ok: false, error: { code: "COUPON_QTY" } });
    await setCartQty(k, mozz.id, 22); // 2 free
    const v = await cartView(k);
    const unit = Number(v.lines[0].price!.listUnitNet);
    expect(Number(v.coupon!.savings)).toBeCloseTo(unit * 2, 1);
    const { id } = await placeOrder(k, { deliveryAddressId: await addressOf(k.company.id) });
    const o = await order(id);
    const d = o.lines[0].discounts.find((x) => x.promotionId === promo.id)!;
    expect(Number(d.vendorAmount)).toBeCloseTo(unit * 2, 1);
    expect(d.firingiAmount.toFixed(2)).toBe("0.00");
    // the supplier gets less: list − its discount − commission
    const l = o.lines[0];
    expect(Number(l.vendorLineNet)).toBeCloseTo(Number(l.unitListPriceNet) * 22 - Number(d.vendorAmount) - Number(l.commissionAmount), 1);
  });
});

describe("customer offers", () => {
  it("an offer for a CRM segment applies to its members only; one for one company too", async () => {
    const sa = await ctxFor(SA);
    const seg = await saveSegment(sa, null, { name: `PT customers ${Date.now()}`, rules: { types: ["CUSTOMER"], countryCodes: ["PT"] } });
    const promo = await saveAdminPromotion(sa, { name: { en: "PT customers 5 %" }, kind: "PERCENT", value: 5, firingiFundPct: 100, validFrom: since(), targets: { segmentIds: [seg.id] } });
    const mozz = await offerOf("Grossista Lisboa Central, Lda", "FIR-MOZZ2", 1);
    const k = await ctxFor(KEBAB);
    expect((await catalogueItem(k, mozz.id)).item.price!.promotions.map((p) => p.id)).toContain(promo.id);
    const flour = await offerOf("Distribuidora Atlântico, Lda", "FIR-FARINHA25");
    expect((await catalogueItem(await ctxFor(LXB), flour.id)).item.price!.promotions.map((p) => p.id)).not.toContain(promo.id); // a wholesaler

    const only = await saveAdminPromotion(sa, { name: { en: "Just Lisboa Central" }, kind: "PERCENT", value: 3, firingiFundPct: 100, validFrom: since(), targets: { buyerCompanyIds: [(await ctxFor(LXB)).company.id] } });
    expect((await catalogueItem(await ctxFor(LXB), flour.id)).item.price!.promotions.map((p) => p.id)).toContain(only.id);
    expect((await catalogueItem(k, mozz.id)).item.price!.promotions.map((p) => p.id)).not.toContain(only.id);
  });
});

describe("free delivery", () => {
  it("FIRINGI-paid: FIRINGI's fleet fee is waived for the customer", async () => {
    const sa = await ctxFor(SA);
    const k = await ctxFor(KEBAB);
    const promo = await saveAdminPromotion(sa, { name: { en: "Free delivery Kebab" }, kind: "FREE_DELIVERY", value: 100, firingiFundPct: 100, validFrom: since(), targets: { buyerCompanyIds: [k.company.id] } });
    const mozz = await offerOf("Grossista Lisboa Central, Lda", "FIR-MOZZ2", 1);
    await cartWith(KEBAB, mozz.id, 5, "owner@lisboacentral.test");
    const v = await cartView(k);
    expect(v.delivery).toMatchObject({ ok: true, mode: "FIRINGI_FLEET", feeNet: "0.00", free: "OFFER" });
    const fee = Number(v.freeDelivery!.amount);
    expect(fee).toBeGreaterThan(0);
    const { id } = await placeOrder(k, { deliveryAddressId: await addressOf(k.company.id) });
    const o = await order(id);
    expect([o.deliveryFeeNet.toFixed(2), o.deliveryDiscountNet.toNumber(), o.deliveryPromotionId]).toEqual(["0.00", fee, promo.id]);
    expect(o.redemptions.find((r) => r.promotionId === promo.id)!.firingiAmount.toFixed(2)).toBe(fee.toFixed(2));
  });

  it("distributor flat rate: FIRINGI-paid → wholesaler pays 0, FIRINGI still pays the distributor; supplier-paid → the distributor delivers free", async () => {
    const atl = await ctxFor("owner@atlantico.test");
    const sa = await ctxFor(SA);
    const before = await prisma.deliveryRule.findFirstOrThrow({ where: { scope: "VENDOR", vendorCompanyId: atl.company.id, validTo: null } });
    const flour = await offerOf("Distribuidora Atlântico, Lda", "FIR-FARINHA25");
    try {
      await setVendorMinimum(atl, { kind: "UNITS", units: 8, flatFeeNet: 12 });
      const firingiCode = code("FRETE");
      await expect(saveAdminPromotion(sa, { name: { en: "x" }, kind: "FREE_DELIVERY", value: 100, firingiFundPct: 50, validFrom: since(), code: code("HALF"), targets: {} })).rejects.toThrow(/entirely/);
      await saveAdminPromotion(sa, { name: { en: "Free delivery" }, kind: "FREE_DELIVERY", value: 100, firingiFundPct: 100, validFrom: since(), code: firingiCode, targets: {} });
      const w = await cartWith(LXB, flour.id, 7, "owner@atlantico.test");
      await applyCoupon(w, firingiCode);
      const v = await cartView(w);
      expect(v.delivery).toMatchObject({ ok: true, feeNet: "0.00" });
      expect(v.coupon).toMatchObject({ ok: true, savings: "12.00" });
      const { id } = await placeOrder(w, { deliveryAddressId: await addressOf(w.company.id) });
      const o = await order(id);
      expect([o.deliveryMode, o.deliveryFeeNet.toFixed(2), o.deliveryDiscountNet.toFixed(2)]).toEqual(["VENDOR_FLEET", "0.00", "12.00"]);
      const goodsToVendor = o.lines.reduce((a, l) => a + Number(l.vendorLineNet), 0);
      expect(Number(o.vendorPayableNet)).toBeCloseTo(goodsToVendor + 12, 2); // FIRINGI still pays the distributor's fee

      const theirs = code("ATLFRETE");
      await saveVendorPromotion(atl, { name: { en: "We deliver free" }, kind: "FREE_DELIVERY", value: 100, validFrom: since(), code: theirs, targets: {} });
      await cartWith(LXB, flour.id, 7, "owner@atlantico.test");
      await applyCoupon(w, theirs);
      const { id: id2 } = await placeOrder(w, { deliveryAddressId: await addressOf(w.company.id) });
      const o2 = await order(id2);
      expect([o2.deliveryFeeNet.toFixed(2), o2.deliveryDiscountNet.toFixed(2)]).toEqual(["0.00", "0.00"]);
      expect(Number(o2.vendorPayableNet)).toBeCloseTo(o2.lines.reduce((a, l) => a + Number(l.vendorLineNet), 0), 2);
      expect([o2.redemptions[0].vendorAmount.toFixed(2), o2.redemptions[0].firingiAmount.toFixed(2)]).toEqual(["12.00", "0.00"]);
    } finally {
      await setVendorMinimum(atl, { kind: before.vendorMinimumKind, amount: before.vendorDeliveryMinimum?.toString() ?? null, units: before.vendorMinimumUnits, flatFeeNet: before.vendorFlatFeeNet?.toString() ?? null });
      await clearCart(await ctxFor(LXB));
    }
  });
});

describe("my offers", () => {
  it("lists what this buyer can use: targeted offers and coupons, not others' or used-up ones", async () => {
    const sa = await ctxFor(SA);
    const k = await ctxFor(KEBAB), w = await ctxFor(LXB);
    const forKebab = await saveAdminPromotion(sa, { name: { en: "Kebab only" }, kind: "PERCENT", value: 4, firingiFundPct: 100, validFrom: since(), targets: { buyerCompanyIds: [k.company.id] } });
    const c = code("ONCE");
    const once = await saveAdminPromotion(sa, { name: { en: "Once" }, kind: "ORDER_AMOUNT", value: 5, firingiFundPct: 100, validFrom: since(), code: c, maxPerCustomer: 1, targets: {} });
    const hidden = await saveAdminPromotion(sa, { name: { en: "Hidden" }, kind: "PERCENT", value: 2, firingiFundPct: 100, validFrom: since(), showInOffers: false, targets: {} });
    const { myOffers } = await import("@/server/marketing/my-offers");
    const mine = (await myOffers(k)).map((o) => o.id);
    expect(mine).toEqual(expect.arrayContaining([forKebab.id, once.id]));
    expect(mine).not.toContain(hidden.id);
    expect((await myOffers(w)).map((o) => o.id)).not.toContain(forKebab.id);
    // used once → gone from the list
    const mozz = await offerOf("Grossista Lisboa Central, Lda", "FIR-MOZZ2", 1);
    await cartWith(KEBAB, mozz.id, 10, "owner@lisboacentral.test");
    await applyCoupon(k, c);
    await placeOrder(k, { deliveryAddressId: await addressOf(k.company.id) });
    expect((await myOffers(k)).map((o) => o.id)).not.toContain(once.id);
  });
});
