/**
 * Phase 21: FIRINGI API v2 (the operations behind /api/v2; the HTTP layer is covered by the e2e).
 *  • Self-service keys: a company creates its own (shown once, hashed), only scopes for its type,
 *    revokes them; a key's permissions = its scopes ∩ the user's permissions.
 *  • Suppliers: list own offers, sync prices / stock from the ERP (dry run, big change needs
 *    confirmation); the import history shows it.
 *  • Buyers: catalogue without who-funds-what; place an order in one call (refused while the
 *    user's portal cart has products; the cart is left empty when the order fails).
 *  • What each side sees: buyers never see commission / payout, suppliers never FIRINGI's margin.
 *  • Rate limit per key.
 */
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { loadContext, type Ctx } from "@/server/context";
import { createOwnApiKey, listOwnApiKeys, resolveApiKey, revokeOwnApiKey, scopePermissions, scopesFor } from "@/server/services/api-keys";
import { orderForApi, presentLine, presentOrder, rateLimit } from "@/server/api/v2";
import { catalogueForApi, confirmViaApi, deliveryAddresses, invoicesForApi, listOwnOffers, ordersForApi, placeOrderViaApi, statusViaApi, syncOffers, whoAmI } from "@/server/api/v2-ops";
import { addToCart, cartCount, clearCart } from "@/server/services/cart";
import { setStock } from "@/server/services/vendor-catalogue";
import { changeOrderStatus } from "@/server/services/orders";
import { ctxFor } from "../helpers";

const LX = "owner@lisboacentral.test", KEBAB = "owner@kebabhouse.test", ATL = "owner@atlantico.test";
const keys: { ctx: Ctx; id: string }[] = [];

/** What getContext() builds for "Authorization: Bearer <key>". */
async function keyCtx(raw: string) {
  const k = await resolveApiKey(`Bearer ${raw}`);
  if (!k) throw new Error("key not resolved");
  const ctx = (await loadContext(k.userId, `api:${k.id}`, k.companyId))!;
  const allowed = scopePermissions(k.scopes);
  return { ...ctx, permissions: new Set([...ctx.permissions].filter((p) => allowed.has(p))) } as Ctx;
}
async function newKey(email: string, scopes: string[]) {
  const ctx = await ctxFor(email);
  const k = await createOwnApiKey(ctx, { name: `test ${scopes.join(",")}`, scopes });
  keys.push({ ctx, id: k.id });
  return { ...k, ctx: await keyCtx(k.key) };
}
afterAll(async () => {
  for (const k of keys) await revokeOwnApiKey(k.ctx, k.id).catch(() => null);
  await clearCart(await ctxFor(KEBAB)).catch(() => null);
});

describe("self-service keys", () => {
  it("creates a key shown once, limited to the company's kind of scopes", async () => {
    expect(scopesFor("CUSTOMER")).toEqual(["catalogue.read", "orders.read", "orders.write", "invoices.read"]);
    expect(scopesFor("DISTRIBUTOR")).toEqual(["orders.read", "orders.write", "offers.write", "invoices.read"]);
    const kebab = await ctxFor(KEBAB);
    const k = await createOwnApiKey(kebab, { name: "Our POS", scopes: ["catalogue.read", "offers.write" /* not for buyers */] });
    keys.push({ ctx: kebab, id: k.id });
    expect(k.key).toMatch(/^fk_live_/);
    const row = await prisma.apiKey.findUniqueOrThrow({ where: { id: k.id } });
    expect(row).toMatchObject({ scopes: ["catalogue.read"], selfService: true, userId: kebab.user.id, companyId: kebab.company.id });
    expect(row.hash).not.toContain(k.key.slice(8));
    const list = await listOwnApiKeys(kebab);
    expect(list.keys.find((x) => x.id === k.id)).not.toHaveProperty("hash");
    await expect(createOwnApiKey(kebab, { name: "x", scopes: ["catalogue.read"] })).rejects.toThrow(/name/);
    await expect(createOwnApiKey(kebab, { name: "Only supplier stuff", scopes: ["offers.write"] })).rejects.toThrow(/at least one/);

    // The key's permissions: only what the scope gives.
    const c = await keyCtx(k.key);
    expect([...c.permissions].sort()).toEqual(["buyer.catalogue.view"]);
    expect((await whoAmI(c)).key).toMatchObject({ scopes: ["catalogue.read"], name: "Our POS" });

    await revokeOwnApiKey(kebab, k.id);
    expect(await resolveApiKey(`Bearer ${k.key}`)).toBeNull();
    // Another company can't revoke it (or see it).
    await expect(revokeOwnApiKey(await ctxFor(LX), k.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rate-limits per key", () => {
    process.env.API_RATE_LIMIT_PER_MIN = "3";
    try {
      const t = 1_000_000;
      expect([1, 2, 3, 4].map((i) => rateLimit("k1", t + i).ok)).toEqual([true, true, true, false]);
      expect(rateLimit("k2", t + 5).ok).toBe(true); // other keys unaffected
      const r = rateLimit("k1", t + 10);
      expect(r).toMatchObject({ ok: false, remaining: 0 });
      expect(rateLimit("k1", t + 60_010).ok).toBe(true); // window moved on
    } finally {
      delete process.env.API_RATE_LIMIT_PER_MIN;
    }
  });
});

describe("suppliers", () => {
  it("lists own offers and syncs from the ERP (dry run, big change, apply)", async () => {
    const { ctx } = await newKey(LX, ["offers.write"]);
    const { offers } = await listOwnOffers(ctx);
    const luso = offers.find((o) => o.vendorSku === "GRO-LUSO15")!;
    expect(luso).toMatchObject({ id: expect.any(String), priceNet: expect.stringMatching(/^\d+\.\d{2}$/) });
    const was = Number(luso.priceNet), stockWas = luso.stock ?? 0;

    const dry = await syncOffers(ctx, { rows: [{ vendorSku: "GRO-LUSO15", priceNet: +(was + 0.1).toFixed(2), stock: stockWas + 3 }, { vendorSku: "NOPE" }], dryRun: true });
    expect(dry).toMatchObject({ dryRun: true, summary: { updates: 1, notFound: 1 } });
    expect(dry.rows[0]).toMatchObject({ index: 0, status: "UPDATE" });
    expect((await listOwnOffers(ctx)).offers.find((o) => o.id === luso.id)!.priceNet).toBe(luso.priceNet); // unchanged

    await expect(syncOffers(ctx, { rows: [{ vendorSku: "GRO-LUSO15", priceNet: was * 3 }] })).rejects.toMatchObject({ code: "BIG_CHANGES", status: 409 });

    const done = await syncOffers(ctx, { rows: [{ vendorSku: "GRO-LUSO15", priceNet: +(was + 0.1).toFixed(2), stock: stockWas + 3 }] });
    expect(done).toMatchObject({ applied: 1, failed: 0 });
    const after = (await listOwnOffers(ctx)).offers.find((o) => o.id === luso.id)!;
    expect(Number(after.priceNet)).toBeCloseTo(was + 0.1, 2);
    expect(await prisma.importRun.count({ where: { id: done.runId, source: "API", status: "APPLIED" } })).toBe(1);
    // back
    await syncOffers(ctx, { rows: [{ vendorSku: "GRO-LUSO15", priceNet: was, stock: stockWas }] });
  });

  it("a key without offers.write can't touch offers; buyers can't either", async () => {
    const { ctx } = await newKey(LX, ["orders.read"]);
    await expect(listOwnOffers(ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const kebab = await newKey(KEBAB, ["orders.write"]);
    await expect(syncOffers(kebab.ctx, { rows: [{ vendorSku: "X", stock: 1 }] })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("buyers", () => {
  it("sees the catalogue without who funds promotions", async () => {
    const { ctx } = await newKey(KEBAB, ["catalogue.read"]);
    const r = await catalogueForApi(ctx, { lang: "pt" });
    expect(r.items.length).toBeGreaterThan(0);
    const s = JSON.stringify(r);
    for (const hidden of ["firingiPerUnit", "vendorPerUnit", "firingiFundedPerUnit", "vendorFundedPerUnit", "commission"]) expect(s).not.toContain(hidden);
    expect(r.items[0]).toMatchObject({ offerId: expect.any(String), name: expect.any(String), minQty: expect.any(Number) });
  });

  it("places an order in one call; supplier confirms and dispatches by API; each side sees its own numbers", async () => {
    const buyer = await newKey(KEBAB, ["orders.read", "orders.write", "catalogue.read", "invoices.read"]);
    const supplier = await newKey(LX, ["orders.read", "orders.write"]);
    const portal = await ctxFor(KEBAB), lx = await ctxFor(LX);
    const offer = await prisma.vendorOffer.findFirstOrThrow({ where: { vendorCompanyId: lx.company.id, vendorSku: "GRO-MOZZ2", packaging: { unitsPerPack: 1 } } });
    const wh = await prisma.address.findFirstOrThrow({ where: { companyId: lx.company.id, kind: "WAREHOUSE" } });
    await setStock(lx, offer.id, wh.id, 900);

    // Something in the user's portal cart → refused, cart untouched.
    await clearCart(portal);
    await addToCart(portal, offer.id, 2);
    await expect(placeOrderViaApi(buyer.ctx, { lines: [{ offerId: offer.id, qty: 5 }] })).rejects.toMatchObject({ code: "CART_NOT_EMPTY", status: 409 });
    expect(await cartCount(portal)).toBe(1);
    await clearCart(portal);

    // A bad line → refused with its line number, cart left empty.
    await expect(placeOrderViaApi(buyer.ctx, { lines: [{ offerId: offer.id, qty: 5 }, { offerId: "nope", qty: 1 }] })).rejects.toThrow(/Line 2/);
    expect(await cartCount(portal)).toBe(0);

    expect((await deliveryAddresses(buyer.ctx)).length).toBeGreaterThan(0);
    const placed = await placeOrderViaApi(buyer.ctx, { lines: [{ offerId: offer.id, qty: 12 }], notes: "via API" });
    expect(placed.created).toBe(true);
    const id = placed.orders[0].id;
    expect(await cartCount(portal)).toBe(0);

    // The buyer's view: no commission, no payout, no margin.
    const asBuyer = await orderForApi(buyer.ctx, id);
    const sb = JSON.stringify(asBuyer);
    for (const hidden of ["commission", "payable", "Payable", "margin", "Margin", "vendorUnitCost"]) expect(sb, hidden).not.toContain(hidden);
    expect(asBuyer).toMatchObject({ number: placed.orders[0].number, buyerNotes: "via API", lines: [{ qtyOrdered: 12 }] });

    expect(asBuyer.status).toBe("PENDING_CONFIRMATION");
    {
      // The supplier's view: its payout and commission, never FIRINGI's margin.
      const asSupplier = await orderForApi(supplier.ctx, id);
      expect(JSON.stringify(asSupplier)).not.toMatch(/margin/i);
      expect(asSupplier).toMatchObject({ payableToYouNet: expect.any(String), commission: expect.any(String), nextStatuses: expect.arrayContaining(["SUPPLIER_PROCESSING"]) });
      const list = await ordersForApi(supplier.ctx, "VENDOR", { since: null, status: "PENDING_CONFIRMATION", page: 1 });
      expect(list.orders.some((o) => o.id === id)).toBe(true);
      expect(JSON.stringify(list)).not.toMatch(/margin/i);

      const lineId = (await prisma.orderLine.findFirstOrThrow({ where: { orderId: id } })).id;
      const confirmed = await confirmViaApi(supplier.ctx, id, { quantities: { [lineId]: 10 } });
      expect(confirmed).toMatchObject({ status: "SUPPLIER_PROCESSING", lines: [{ qtyConfirmed: 10 }] });
      await expect(statusViaApi(buyer.ctx, id, { status: "DELIVERED" })).rejects.toThrow();
      const next = confirmed.nextStatuses.find((x) => x !== "CANCELLED" && x !== "EXCEPTION");
      if (next) expect(await statusViaApi(supplier.ctx, id, { status: next })).toMatchObject({ status: next });
      await changeOrderStatus(await ctxFor("superadmin@firingi.test"), id, "CANCELLED", "test").catch(() => null);
    }
    await expect(ordersForApi(buyer.ctx, "BUYER", { since: "yesterday", status: null, page: 1 })).rejects.toThrow(/ISO date/);
    expect((await invoicesForApi(buyer.ctx, "BUYER")).invoices).toBeInstanceOf(Array);
  });

  it("another company's order is 'not found'", async () => {
    const lxOrder = await prisma.order.findFirst({ where: { buyer: { email: { not: "geral@kebabhouse.test" } }, seller: { email: { not: "geral@lisboacentral.test" } } } });
    if (!lxOrder) return;
    const { ctx } = await newKey(KEBAB, ["orders.read"]);
    await expect(orderForApi(ctx, lxOrder.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("presenters", () => {
  const order = {
    id: "o", number: "FO-1", status: "DELIVERED", placedAt: new Date(0), updatedAt: new Date(0), currencyCode: "EUR", deliveryMode: null, deliveryAddress: {}, requestedDeliveryDate: null,
    buyerNotes: null, awaitingPayment: false, couponCode: null, routedByFiringi: true, listNet: 10, discountTotal: 0, deliveryFeeNet: 0, netTotal: 10, vatTotal: 2.3, grandTotal: 12.3,
    commissionTotal: 1, vendorPayableNet: 9, firingiMarginNet: 1, buyer: { legalName: "B", tradeName: null, taxId: "1" }, seller: { legalName: "S", tradeName: null },
  };
  it("shows FIRINGI as the supplier of a routed order and hides FIRINGI's side", () => {
    expect(presentOrder(order, "BUYER")).toMatchObject({ supplier: "FIRINGI", totals: { gross: "12.30" } });
    expect(presentOrder(order, "BUYER")).not.toHaveProperty("commission");
    expect(presentOrder(order, "VENDOR")).toMatchObject({ commission: "1.00", payableToYouNet: "9.00", buyer: { name: "B" } });
    expect(JSON.stringify(presentOrder(order, "VENDOR"))).not.toMatch(/margin/i);
    const line = { id: "l", offerId: "f", sku: "S", productName: { pt: "Água" }, packagingName: { en: "Pack" }, qtyOrdered: 1, qtyConfirmed: null, qtyDelivered: null, unitSalePriceNet: 1, taxRate: 23, lineNet: 1, lineVat: 0.23, vendorUnitCostNet: 0.9, vendorLineNet: 0.9, commissionAmount: 0.1 };
    expect(presentLine(line, "BUYER")).not.toHaveProperty("commission");
    expect(presentLine(line, "VENDOR")).toMatchObject({ commission: "0.10", unitPayableNet: "0.9000" });
  });
  it("a distributor (supplier only) can't be a buyer", async () => {
    const { ctx } = await newKey(ATL, ["orders.write"]);
    await expect(placeOrderViaApi(ctx, { lines: [{ offerId: "x", qty: 1 }] })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
