/** Buying from several wholesalers: supplier names / "FIRINGI <area>" for buyers, where suppliers stand, cart suggestions. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import * as H from "@/server/catalogue/cart-help";
import { searchAcrossSuppliers } from "@/server/data/catalogue-buyer";
import { addToCart, cartView, clearCart } from "@/server/services/cart";
import { listOrders } from "@/server/services/orders";
import { ctxFor } from "../helpers";

const SA = "superadmin@firingi.test";
const KEBAB = "owner@kebabhouse.test";
const SUP = "owner@lisboacentral.test";
const COLA = "5449000000996";
const clean = async () => { await prisma.setting.deleteMany({ where: { key: { in: ["cartHelp.settings", "supplierNames.settings"] } } }); };

beforeAll(async () => {
  await clean();
  // the test database may start without orders: two small ones from Lisboa Central, handed over on the spot
  const k = await ctxFor(KEBAB), lx = await ctxFor(SUP);
  if ((await prisma.order.count({ where: { buyerCompanyId: k.company.id, sellerCompanyId: lx.company.id } })) < 2) {
    const { placeOrder } = await import("@/server/services/orders");
    const wh = await prisma.address.findFirstOrThrow({ where: { companyId: lx.company.id, kind: "WAREHOUSE", isActive: true } });
    const addr = await prisma.address.findFirstOrThrow({ where: { companyId: k.company.id, kind: "DELIVERY", isActive: true } });
    const offer = await prisma.vendorOffer.findFirstOrThrow({ where: { vendorCompanyId: lx.company.id, vendorSku: "GRO-ARROZ1", status: "ACTIVE" } });
    for (let i = 0; i < 2; i++) await placeOrder(k, { deliveryAddressId: addr.id, items: [{ offerId: offer.id, qty: 1 }], approved: true, handover: { warehouseId: wh.id, paidNow: true, reason: "cart help test" } });
  }
});
afterAll(async () => { await clean(); await clearCart(await ctxFor(KEBAB)).catch(() => null); });

describe("supplier names for buyers", () => {
  it("by default buyers see the wholesaler's name", async () => {
    const r = await searchAcrossSuppliers(await ctxFor(KEBAB), COLA);
    expect(r.items.some((i) => i.vendor.name === "Lisboa Central")).toBe(true);
  });

  it("FIRINGI + area for customers in a country — search, filters, orders, cart; a supplier override wins; suppliers unaffected", async () => {
    const admin = await ctxFor(SA);
    await H.saveSupplierNameSettings(admin, { countries: { PT: "AREA" } });
    const k = await ctxFor(KEBAB);
    const r = await searchAcrossSuppliers(k, COLA);
    const names = [...new Set(r.items.map((i) => i.vendor.name))];
    expect(names.every((n) => n.startsWith("FIRINGI"))).toBe(true);
    expect(names).toContain("FIRINGI Almada");
    expect(names.some((n) => /^FIRINGI Lisboa( 2)?$/.test(n))).toBe(true);

    const orders = await listOrders(k, "BUYER", { pageSize: 20 });
    expect(orders.rows.length).toBeGreaterThan(0);
    expect(orders.rows.every((o) => (o.seller.tradeName ?? o.seller.legalName).startsWith("FIRINGI"))).toBe(true);
    const { getOrder } = await import("@/server/services/orders");
    const one = await getOrder(k, orders.rows[0].id);
    expect(one.order.seller.tradeName).toMatch(/^FIRINGI/);

    const lc = r.items.find((i) => i.vendor.name.startsWith("FIRINGI Lisboa") && i.price)!;
    await clearCart(k);
    await addToCart(k, lc.offerId, lc.minOrderQty);
    const cart = await cartView(k);
    expect(cart.groups[0].supplier.name).toBe(lc.vendor.name);

    // C&C Almada always shown by name
    const almada = await prisma.company.findFirstOrThrow({ where: { tradeName: "C&C Almada" } });
    await H.setCompanyNameMode(admin, almada.id, "NAME");
    expect((await searchAcrossSuppliers(k, COLA)).items.some((i) => i.vendor.name === "C&C Almada")).toBe(true);

    // the supplier still sees its own orders with the buyer's name, unchanged
    const own = await listOrders(await ctxFor(SUP), "VENDOR", { pageSize: 5 });
    expect(own.rows.every((o) => !(o.buyer.tradeName ?? o.buyer.legalName).startsWith("FIRINGI"))).toBe(true);

    // the notification text a buyer gets
    const masked = await H.maskSupplierText({ id: k.company.id, type: "CUSTOMER", countryCode: "PT" }, "Lisboa Central confirmed your order");
    expect(masked).toMatch(/^FIRINGI Lisboa( 2)? confirmed your order$/);
    await clean();
  });
});

describe("supplier minimums", () => {
  it("where suppliers stand: in the cart below the minimum, others show their minimum", async () => {
    const k = await ctxFor(KEBAB);
    const r = await searchAcrossSuppliers(k, COLA);
    const can = r.items.find((i) => i.vendor.name === "Lisboa Central" && i.packaging.unitsPerPack === 1 && i.price)!;
    await clearCart(k);
    await addToCart(k, can.offerId, can.minOrderQty);
    const help = await H.resultsHelp(k, [...new Set(r.items.map((i) => i.vendor.id))]);
    expect(help).not.toBeNull();
    expect(help!.inCart.has(can.vendor.id)).toBe(true);
    const mine = help!.standing.get(can.vendor.id)!;
    expect(mine.inCart).toBe(true);
    expect(["MINIMUM", "FREE"]).toContain(mine.state);
    expect(Number(mine.missing)).toBeGreaterThan(0);
    const almada = r.items.find((i) => i.vendor.name === "C&C Almada")!;
    expect(help!.standing.get(almada.vendor.id)).toMatchObject({ inCart: false });
  });

  it("cart suggestions: what the customer usually buys from that supplier, not already in the cart, at least the minimum", async () => {
    const k = await ctxFor(KEBAB);
    const lc = await prisma.company.findFirstOrThrow({ where: { tradeName: "Lisboa Central" } });
    const inCart = (await prisma.cartItem.findMany({ where: { cart: { buyerCompanyId: k.company.id, userId: k.user.id } }, select: { offerId: true } })).map((x) => x.offerId);
    const s = await H.topUpSuggestions(k, lc.id, inCart);
    expect(s.length).toBeGreaterThan(0);
    for (const x of s) {
      expect(inCart).not.toContain(x.item.offerId);
      expect(x.item.vendor.id).toBe(lc.id);
      expect(x.qty).toBeGreaterThanOrEqual(x.item.minOrderQty);
      expect((x.qty - x.item.minOrderQty) % Math.max(1, x.item.qtyStep)).toBe(0);
    }
  });

  it("switched off for a country → no help", async () => {
    await H.saveCartHelpSettings(await ctxFor(SA), { offCountries: ["PT"] });
    expect(await H.resultsHelp(await ctxFor(KEBAB), [])).toBeNull();
    await clean();
    await expect(H.saveCartHelpSettings(await ctxFor(KEBAB), { enabled: false })).rejects.toThrow();
  });
});
