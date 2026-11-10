/**
 * Phase 4: cart lock, checkout, delivery decision, stock, status machine, access.
 * Checklist: "A customer cannot add products from two wholesalers to one cart."
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { prisma } from "@/server/db";
import { addToCart, cartView, clearCart, setCartQty } from "@/server/services/cart";
import { changeOrderStatus, confirmOrder, getOrder, listOrders, placeOrder } from "@/server/services/orders";
import { ensureBaseList, setPrice } from "@/server/services/pricing";
import { setStock } from "@/server/services/vendor-catalogue";
import { removeZoneRule, setFiringiRule, setVendorMinimum } from "@/server/services/delivery-rules";
import { ctxFor, makeApprovedCompany } from "../helpers";

afterAll(() => prisma.$disconnect());

const KEBAB = "owner@kebabhouse.test";
const LX = "Grossista Lisboa Central, Lda";

async function offerOf(vendorLegalName: string, sku: string, unitsPerPack?: number) {
  return prisma.vendorOffer.findFirstOrThrow({
    where: { vendor: { legalName: vendorLegalName }, packaging: { variant: { sku }, ...(unitsPerPack ? { unitsPerPack } : {}) } },
  });
}
async function stockOf(offerId: string) {
  const l = await prisma.stockLevel.findMany({ where: { offerId } });
  return { onHand: l.reduce((a, x) => a + x.onHand, 0), reserved: l.reduce((a, x) => a + x.reserved, 0) };
}
async function deliveryAddress(email: string) {
  const ctx = await ctxFor(email);
  return (await prisma.address.findFirstOrThrow({ where: { companyId: ctx.company.id, kind: "DELIVERY" } })).id;
}
/** Give an offer plenty of stock at the vendor's warehouse. */
async function restock(offerId: string, vendorOwnerEmail: string, qty = 500) {
  const v = await ctxFor(vendorOwnerEmail);
  const wh = await prisma.address.findFirstOrThrow({ where: { companyId: v.company.id, kind: { in: ["WAREHOUSE", "PICKUP"] } } });
  const cur = await prisma.stockLevel.findUnique({ where: { offerId_addressId: { offerId, addressId: wh.id } } });
  await setStock(v, offerId, wh.id, Math.max(qty, cur?.reserved ?? 0));
}

beforeEach(async () => {
  await clearCart(await ctxFor(KEBAB));
  await clearCart(await ctxFor("purchasing@lisboacentral.test"));
});

describe("cart: one supplier at a time (checklist)", () => {
  it("adding a product from a second wholesaler is refused with a clear message", async () => {
    const kebab = await ctxFor(KEBAB);
    // A second approved wholesaler in Portugal with a priced, stocked offer.
    const other = await makeApprovedCompany("WHOLESALER", "PT");
    const otherCtx = await ctxFor(other.email);
    const pack = await prisma.packagingUnit.findFirstOrThrow({ where: { variant: { sku: "FIR-ARROZ1" } } });
    const offer = await prisma.vendorOffer.create({ data: { vendorCompanyId: other.companyId, sellerType: "WHOLESALER", packagingUnitId: pack.id, countryId: otherCtx.company.countryId, status: "ACTIVE" } });
    await setPrice(otherCtx, (await ensureBaseList(otherCtx)).id, offer.id, 1, 10);

    await addToCart(kebab, (await offerOf(LX, "FIR-MOZZ2", 1)).id, 2);
    await expect(addToCart(kebab, offer.id, 1)).rejects.toThrow(/one supplier at a time/);
    // The database refuses it too, even bypassing the service.
    const cart = await prisma.cart.findFirstOrThrow({ where: { buyerCompanyId: kebab.company.id, userId: kebab.user.id } });
    await expect(prisma.cartItem.create({ data: { cartId: cart.id, offerId: offer.id, qty: 1 } })).rejects.toThrow(/CART_SELLER_MISMATCH/);
    // After clearing the cart the other wholesaler is fine.
    await clearCart(kebab);
    await addToCart(kebab, offer.id, 1);
    expect((await cartView(kebab)).seller!.name).toMatch(/Fixture/);
  });

  it("customers can't put distributor products in the cart", async () => {
    await expect(addToCart(await ctxFor(KEBAB), (await offerOf("Distribuidora Atlântico, Lda", "FIR-MOZZ2")).id, 1)).rejects.toThrow(/not found/);
  });

  it("quantity rules apply", async () => {
    const kebab = await ctxFor(KEBAB);
    const o = await offerOf(LX, "FIR-MOZZ2", 1);
    await prisma.vendorOffer.update({ where: { id: o.id }, data: { minOrderQty: 2, qtyStep: 2 } });
    await expect(addToCart(kebab, o.id, 1)).rejects.toThrow(/minimum/);
    await addToCart(kebab, o.id, 2);
    await expect(setCartQty(kebab, o.id, 3)).rejects.toThrow(/multiples/);
    await prisma.vendorOffer.update({ where: { id: o.id }, data: { minOrderQty: 1, qtyStep: 1 } });
  });
});

describe("checkout & delivery decision", () => {
  it("below FIRINGI's minimum (admin-set) checkout is blocked", async () => {
    const kebab = await ctxFor(KEBAB);
    await addToCart(kebab, (await offerOf(LX, "FIR-COLA33", 1)).id, 10); // 6.20 €
    const view = await cartView(kebab);
    expect(view.delivery).toMatchObject({ ok: false, reason: "BELOW_MINIMUM", minimum: "50.00" });
    await expect(placeOrder(kebab, { deliveryAddressId: await deliveryAddress(KEBAB) })).rejects.toThrow(/Minimum order/);
  });

  it("under the vendor's minimum → FIRINGI delivers with a fee; snapshots, stock, numbering", async () => {
    const kebab = await ctxFor(KEBAB);
    const mozz = await offerOf(LX, "FIR-MOZZ2", 1); // contract price 12.20 for Kebab House
    await restock(mozz.id, "owner@lisboacentral.test");
    const before = await stockOf(mozz.id);
    await addToCart(kebab, mozz.id, 5); // 61.00 €
    const { id, number } = await placeOrder(kebab, { deliveryAddressId: await deliveryAddress(KEBAB), notes: "Back door" });
    expect(number).toMatch(/^FO-\d{4}-\d{6}$/);

    const o = await prisma.order.findUniqueOrThrow({ where: { id }, include: { lines: true, statusHistory: true } });
    expect(o.flow).toBe("CUSTOMER_FROM_WHOLESALER");
    expect(o.status).toBe("PENDING_CONFIRMATION");
    expect(o.statusHistory.map((h) => h.toStatus)).toEqual(["NEW", "PENDING_CONFIRMATION"]);
    expect(o.deliveryMode).toBe("FIRINGI_FLEET");
    expect(o.deliveryFeeNet.toFixed(2)).toBe("9.90");
    const l = o.lines[0];
    expect(l.unitListPriceNet.toFixed(2)).toBe("12.20");
    expect(l.taxRate.toFixed(0)).toBe("6"); // cheese: reduced rate in mainland Portugal
    expect(l.commissionRate!.toFixed(0)).toBe("8"); // Lisboa Central's commission, frozen
    expect(l.commissionAmount.toFixed(2)).toBe("4.88");
    expect(l.vendorLineNet.toFixed(2)).toBe("56.12");
    expect(o.netTotal.toFixed(2)).toBe("70.90");
    expect(o.vatTotal.toFixed(2)).toBe(new Decimal("3.66").plus("2.28").toFixed(2)); // goods 6% + fee 23%
    expect(o.firingiMarginNet.toFixed(2)).toBe("4.88");
    expect((await stockOf(mozz.id)).reserved).toBe(before.reserved + 5);
    expect((await cartView(kebab)).lines).toHaveLength(0); // cart emptied
  });

  it("at or above the vendor's own minimum → the vendor delivers, no fee", async () => {
    const kebab = await ctxFor(KEBAB);
    const box = await offerOf(LX, "FIR-PIZZABOX33");
    await restock(box.id, "owner@lisboacentral.test");
    await addToCart(kebab, box.id, 8); // group price 19.50 × 8 = 156 €
    const { id } = await placeOrder(kebab, { deliveryAddressId: await deliveryAddress(KEBAB) });
    const o = await prisma.order.findUniqueOrThrow({ where: { id } });
    expect(o.deliveryMode).toBe("VENDOR_FLEET");
    expect(o.deliveryFeeNet.toNumber()).toBe(0);
  });

  it("not enough stock → nothing is created and nothing is reserved", async () => {
    const kebab = await ctxFor(KEBAB);
    const azeite = await offerOf(LX, "FIR-AZEITE75", 6);
    await restock(azeite.id, "owner@lisboacentral.test", 3);
    const before = await stockOf(azeite.id);
    const count = await prisma.order.count();
    await addToCart(kebab, azeite.id, 4);
    await expect(placeOrder(kebab, { deliveryAddressId: await deliveryAddress(KEBAB) })).rejects.toThrow(/Only 3 available/);
    expect(await prisma.order.count()).toBe(count);
    expect(await stockOf(azeite.id)).toEqual(before);
  });
});

describe("order lifecycle & access", () => {
  async function newOrder(qty = 6) {
    const kebab = await ctxFor(KEBAB);
    const mozz = await offerOf(LX, "FIR-MOZZ2", 1);
    await restock(mozz.id, "owner@lisboacentral.test");
    await addToCart(kebab, mozz.id, qty);
    return { ...(await placeOrder(kebab, { deliveryAddressId: await deliveryAddress(KEBAB) })), mozz };
  }

  it("only the buyer, the vendor and FIRINGI can see an order", async () => {
    const { id } = await newOrder();
    expect((await getOrder(await ctxFor(KEBAB), id)).role).toBe("BUYER");
    expect((await getOrder(await ctxFor("warehouse@lisboacentral.test"), id)).role).toBe("VENDOR");
    expect((await getOrder(await ctxFor("ops@firingi.test"), id)).role).toBe("ADMIN");
    const stranger = await makeApprovedCompany("CUSTOMER", "PT");
    await expect(getOrder(await ctxFor(stranger.email), id)).rejects.toThrow(/not found/);
    await expect(getOrder(await ctxFor("owner@atlantico.test"), id)).rejects.toThrow(/not found/);
    expect((await listOrders(await ctxFor(stranger.email), "BUYER")).total).toBe(0);
  });

  it("vendor confirms with a lower quantity: totals recalculated, surplus stock released", async () => {
    const { id, mozz } = await newOrder(6);
    const o = await prisma.order.findUniqueOrThrow({ where: { id }, include: { lines: true } });
    const before = await stockOf(mozz.id);
    await expect(confirmOrder(await ctxFor(KEBAB), id, {})).rejects.toThrow(/permission|can't be confirmed/);
    await confirmOrder(await ctxFor("warehouse@lisboacentral.test"), id, { [o.lines[0].id]: 4 });
    const after = await prisma.order.findUniqueOrThrow({ where: { id }, include: { lines: true } });
    expect(after.status).toBe("SUPPLIER_PROCESSING");
    expect(after.lines[0].qtyConfirmed).toBe(4);
    expect(after.lines[0].lineNet.toFixed(2)).toBe("48.80");
    expect(after.lines[0].commissionAmount.toFixed(2)).toBe("3.90");
    expect(after.netTotal.toFixed(2)).toBe("58.70"); // 48.80 + 9.90 fee
    expect((await stockOf(mozz.id)).reserved).toBe(before.reserved - 2);
  });

  it("FIRINGI-delivered orders: vendor prepares, FIRINGI dispatches; dispatch ships the stock", async () => {
    const { id, mozz } = await newOrder(5);
    const vendor = await ctxFor("owner@lisboacentral.test");
    await changeOrderStatus(vendor, id, "SUPPLIER_PROCESSING");
    await changeOrderStatus(vendor, id, "READY_FOR_PICKUP");
    await expect(changeOrderStatus(vendor, id, "DISPATCHED")).rejects.toThrow(/can't change/);
    const before = await stockOf(mozz.id);
    const ops = await ctxFor("ops@firingi.test");
    await changeOrderStatus(ops, id, "DISPATCHED");
    expect(await stockOf(mozz.id)).toEqual({ onHand: before.onHand - 5, reserved: before.reserved - 5 });
    await changeOrderStatus(ops, id, "OUT_FOR_DELIVERY");
    await changeOrderStatus(ops, id, "DELIVERED");
    const hist = await prisma.orderStatusHistory.findMany({ where: { orderId: id }, orderBy: { at: "asc" } });
    expect(hist.map((h) => h.toStatus)).toEqual(["NEW", "PENDING_CONFIRMATION", "SUPPLIER_PROCESSING", "READY_FOR_PICKUP", "DISPATCHED", "OUT_FOR_DELIVERY", "DELIVERED"]);
    expect(hist.every((h, i) => i === 0 || h.at >= hist[i - 1].at)).toBe(true);
    // History is append-only.
    await expect(prisma.orderStatusHistory.delete({ where: { id: hist[0].id } })).rejects.toThrow(/APPEND_ONLY/);
  });

  it("buyer can cancel only before the vendor accepts; cancelling releases stock", async () => {
    const { id, mozz } = await newOrder(5);
    const before = await stockOf(mozz.id);
    await expect(changeOrderStatus(await ctxFor(KEBAB), id, "CANCELLED")).rejects.toThrow(/reason/);
    await changeOrderStatus(await ctxFor(KEBAB), id, "CANCELLED", "Ordered by mistake");
    expect((await stockOf(mozz.id)).reserved).toBe(before.reserved - 5);
    const second = await newOrder(5);
    await changeOrderStatus(await ctxFor("owner@lisboacentral.test"), second.id, "SUPPLIER_PROCESSING");
    await expect(changeOrderStatus(await ctxFor(KEBAB), second.id, "CANCELLED", "too late")).rejects.toThrow(/can't change/);
  });

  it("buyers without the order permission can't place orders; employees with it can", async () => {
    const acct = await ctxFor("purchasing@lisboacentral.test"); // wholesaler purchaser (buyer side only)
    await expect(addToCart(await ctxFor("warehouse@lisboacentral.test"), (await offerOf("Distribuidora Atlântico, Lda", "FIR-MOZZ2")).id, 1)).rejects.toThrow(/permission/);
    expect(acct.permissions.has("buyer.orders.place")).toBe(true);
  });
});

describe("wholesaler buying from distributors", () => {
  it("domestic distributor always delivers: its flat rate below its minimum (passed on to it), free above", async () => {
    const w = await ctxFor("purchasing@lisboacentral.test");
    const flour = await offerOf("Distribuidora Atlântico, Lda", "FIR-FARINHA25");
    await restock(flour.id, "owner@atlantico.test");
    await addToCart(w, flour.id, 5); // 84.50 € < 300 € → Atlântico's 15 € flat rate
    expect((await cartView(w)).delivery).toMatchObject({ ok: true, mode: "VENDOR_FLEET", feeNet: "15.00" });
    const small = await placeOrder(w, { deliveryAddressId: await deliveryAddress("purchasing@lisboacentral.test") });
    const o1 = await prisma.order.findUniqueOrThrow({ where: { id: small.id } });
    expect(o1.flow).toBe("WHOLESALER_FROM_DISTRIBUTOR");
    expect(o1.deliveryMode).toBe("VENDOR_FLEET");
    expect(o1.deliveryFeeNet.toFixed(2)).toBe("15.00");
    // FIRINGI invoices the fee and passes it on: the distributor's payout includes it, FIRINGI's margin doesn't.
    const goodsPayout = (await prisma.orderLine.findMany({ where: { orderId: small.id } })).reduce((a, l) => a + Number(l.vendorLineNet), 0);
    expect(Number(o1.vendorPayableNet)).toBeCloseTo(goodsPayout + 15, 2);
    expect((await prisma.orderLine.findFirstOrThrow({ where: { orderId: small.id } })).commissionRate!.toFixed(0)).toBe("5");
    await confirmOrder(await ctxFor("owner@atlantico.test"), small.id, {});
    const c1 = await prisma.order.findUniqueOrThrow({ where: { id: small.id } });
    expect(Number(c1.vendorPayableNet)).toBeCloseTo(goodsPayout + 15, 2); // still after confirmation
    expect((await prisma.delivery.findUniqueOrThrow({ where: { orderId: small.id }, include: { executor: true } })).executor.legalName).toBe("Distribuidora Atlântico, Lda");
    await addToCart(w, flour.id, 20); // 338 € ≥ 300
    const big = await placeOrder(w, { deliveryAddressId: await deliveryAddress("purchasing@lisboacentral.test") });
    const o2 = await prisma.order.findUniqueOrThrow({ where: { id: big.id } });
    expect([o2.deliveryMode, o2.deliveryFeeNet.toFixed(2)]).toEqual(["VENDOR_FLEET", "0.00"]);
  });

  it("distributor minimum by units: free from N units, otherwise its flat rate; no flat rate → blocked", async () => {
    const atl = await ctxFor("owner@atlantico.test");
    const w = await ctxFor("purchasing@lisboacentral.test");
    const before = await prisma.deliveryRule.findFirstOrThrow({ where: { scope: "VENDOR", vendorCompanyId: atl.company.id, validTo: null } });
    const flour = await offerOf("Distribuidora Atlântico, Lda", "FIR-FARINHA25");
    await restock(flour.id, "owner@atlantico.test");
    try {
      await setVendorMinimum(atl, { kind: "UNITS", units: 8, flatFeeNet: 12 });
      await clearCart(w);
      await addToCart(w, flour.id, 7);
      expect((await cartView(w)).delivery).toMatchObject({ ok: true, feeNet: "12.00" });
      await setCartQty(w, flour.id, 8);
      expect((await cartView(w)).delivery).toMatchObject({ ok: true, feeNet: "0.00", free: "VENDOR" });
      await setVendorMinimum(atl, { kind: "UNITS", units: 8, flatFeeNet: null });
      await setCartQty(w, flour.id, 5);
      expect((await cartView(w)).delivery).toMatchObject({ ok: false, reason: "BELOW_SUPPLIER_MINIMUM", unit: "UNITS", minimum: "8", missing: "3" });
      await expect(placeOrder(w, { deliveryAddressId: await deliveryAddress("purchasing@lisboacentral.test") })).rejects.toThrow(/8 units/);
      // a wholesaler can't set a flat rate (FIRINGI delivers below its minimum)
      await setVendorMinimum(await ctxFor("owner@lisboacentral.test"), { kind: "AMOUNT", amount: 150, flatFeeNet: 9 });
      const lxRule = await prisma.deliveryRule.findFirstOrThrow({ where: { scope: "VENDOR", vendor: { legalName: "Grossista Lisboa Central, Lda" }, validTo: null } });
      expect(lxRule.vendorFlatFeeNet).toBeNull();
    } finally {
      await setVendorMinimum(atl, { kind: before.vendorMinimumKind, amount: before.vendorDeliveryMinimum?.toString() ?? null, units: before.vendorMinimumUnits, flatFeeNet: before.vendorFlatFeeNet?.toString() ?? null });
      await clearCart(w);
    }
  });

  it("cross-border distributor must deliver itself: below its minimum checkout is blocked", async () => {
    const w = await ctxFor("purchasing@lisboacentral.test");
    const rice = await offerOf("Distribuciones Ibéricas S.L.", "FIR-ARROZ1");
    await restock(rice.id, "owner@ibericas.test");
    await addToCart(w, rice.id, 10); // 88 €  < 500 €
    expect((await cartView(w)).delivery).toMatchObject({ ok: false, reason: "BELOW_SUPPLIER_MINIMUM", minimum: "500.00" });
    await expect(placeOrder(w, { deliveryAddressId: await deliveryAddress("purchasing@lisboacentral.test") })).rejects.toThrow(/Minimum order/);
    await setCartQty(w, rice.id, 60); // 528 €
    const { id } = await placeOrder(w, { deliveryAddressId: await deliveryAddress("purchasing@lisboacentral.test") });
    expect((await prisma.order.findUniqueOrThrow({ where: { id } })).deliveryMode).toBe("CARRIER");
  });
});

describe("FIRINGI free delivery (customer orders below the wholesaler's minimum)", () => {
  it("admin switches free delivery on from an amount; a delivery zone overrides the country", async () => {
    const ops = await ctxFor("ops@firingi.test");
    const kebab = await ctxFor("owner@kebabhouse.test");
    const pt = await prisma.deliveryRule.findFirstOrThrow({ where: { scope: "COUNTRY", country: { code: "PT" }, validTo: null } });
    const base = { countryCode: "PT", minOrderValue: pt.minOrderValue!.toString(), feeNet: pt.firingiDeliveryFeeNet!.toString() };
    const addr = await prisma.address.findFirstOrThrow({ where: { companyId: kebab.company.id, kind: "DELIVERY", isActive: true }, orderBy: { isDefault: "desc" } });
    const zone = await prisma.deliveryZone.create({ data: { countryId: addr.countryId, name: `Kebab zone ${Date.now()}`, postalCodePatterns: [addr.postalCode] } });
    const mozz = await prisma.vendorOffer.findFirstOrThrow({ where: { vendor: { legalName: "Grossista Lisboa Central, Lda" }, status: "ACTIVE", packaging: { variant: { sku: "FIR-MOZZ2" }, unitsPerPack: 1 } } });
    await restock(mozz.id, "owner@lisboacentral.test");
    try {
      await clearCart(kebab);
      await addToCart(kebab, mozz.id, 5); // ≈ 61 € — below Lisboa Central's 150 € → FIRINGI delivers
      const flat = (await cartView(kebab)).delivery;
      expect(flat).toMatchObject({ ok: true, mode: "FIRINGI_FLEET", feeNet: Number(base.feeNet).toFixed(2) });

      await expect(setFiringiRule(ops, { ...base, freeEnabled: true, freeFrom: null })).rejects.toThrow(/free/);
      await setFiringiRule(ops, { ...base, freeEnabled: true, freeFrom: 60 });
      expect((await cartView(kebab)).delivery).toMatchObject({ ok: true, mode: "FIRINGI_FLEET", feeNet: "0.00", free: "FIRINGI" });
      const { id } = await placeOrder(kebab, { deliveryAddressId: addr.id });
      const o = await prisma.order.findUniqueOrThrow({ where: { id } });
      expect([o.deliveryMode, o.deliveryFeeNet.toFixed(2)]).toEqual(["FIRINGI_FLEET", "0.00"]);

      // The zone of Kebab House's address has its own rule: free delivery off, 4.50 € flat rate.
      await addToCart(kebab, mozz.id, 5);
      await setFiringiRule(ops, { zoneId: zone.id, minOrderValue: 0, feeNet: 4.5, freeEnabled: false, freeFrom: null });
      expect((await cartView(kebab)).delivery).toMatchObject({ ok: true, mode: "FIRINGI_FLEET", feeNet: "4.50" });
      await removeZoneRule(ops, zone.id);
      expect((await cartView(kebab)).delivery).toMatchObject({ ok: true, feeNet: "0.00" });
      // Switched off → the flat rate again.
      await setFiringiRule(ops, { ...base, freeEnabled: false, freeFrom: 60 });
      expect((await cartView(kebab)).delivery).toMatchObject({ ok: true, feeNet: Number(base.feeNet).toFixed(2) });
    } finally {
      await setFiringiRule(ops, { ...base, freeEnabled: pt.firingiFreeEnabled, freeFrom: pt.firingiFreeFrom?.toString() ?? null });
      await prisma.deliveryRule.deleteMany({ where: { zoneId: zone.id } });
      await prisma.deliveryZone.delete({ where: { id: zone.id } });
      await clearCart(kebab);
    }
  });
});
