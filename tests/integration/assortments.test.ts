/**
 * Phase 64: customer assortments — hidden items for one customer, an approved list for all customers, must-stock
 * products (visible even when not on the approved list, gaps, add to cart, weekly reminder), the customer's own list
 * beats a hidden list, other suppliers untouched, FIRINGI's switches (per supplier, per kind of list).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { pricedOffers } from "@/server/data/catalogue-buyer";
import { clearCart } from "@/server/services/cart";
import * as A from "@/server/assortments/service";
import { ctxFor } from "../helpers";

const LX = "owner@lisboacentral.test", KB = "owner@kebabhouse.test", ADMIN = "superadmin@firingi.test";
let lxId = "", kbId = "", a = "", b = "", c = "", other: string | null = null;
const visible = async (ids: string[]) => new Set((await pricedOffers(await ctxFor(KB), ids.map((offerId) => ({ offerId, qty: 1 })))).items.map((i) => i.offerId));

beforeAll(async () => {
  const lx = await ctxFor(LX), kb = await ctxFor(KB);
  lxId = lx.company.id; kbId = kb.company.id;
  await prisma.assortment.deleteMany({ where: { vendorCompanyId: lxId } });
  await prisma.setting.deleteMany({ where: { key: "assortments.settings" } });
  await prisma.mustStockReminder.deleteMany({ where: { buyerCompanyId: kbId } });
  // three of Lisboa Central's products Kebab House can buy now (c: one it never ordered), and another supplier's
  const own = (await prisma.vendorOffer.findMany({ where: { vendorCompanyId: lxId, status: "ACTIVE" }, select: { id: true }, take: 60 })).map((o) => o.id);
  const vis = [...(await visible(own))];
  const ordered = new Set((await prisma.orderLine.findMany({ where: { order: { buyerCompanyId: kbId }, offerId: { in: vis } }, select: { offerId: true } })).map((l) => l.offerId));
  const never = vis.filter((id) => !ordered.has(id));
  expect(vis.length).toBeGreaterThanOrEqual(3);
  expect(never.length).toBeGreaterThanOrEqual(1);
  c = never[0];
  [a, b] = vis.filter((id) => id !== c);
  const others = (await prisma.vendorOffer.findMany({ where: { vendorCompanyId: { not: lxId }, status: "ACTIVE", sellerType: "WHOLESALER" }, select: { id: true }, take: 40 })).map((o) => o.id);
  other = [...(await visible(others))][0] ?? null;
});
afterAll(async () => {
  await prisma.assortment.deleteMany({ where: { vendorCompanyId: lxId } });
  await prisma.setting.deleteMany({ where: { key: "assortments.settings" } });
  await prisma.mustStockReminder.deleteMany({ where: { buyerCompanyId: kbId } });
  await clearCart(await ctxFor(KB)).catch(() => null);
  await prisma.$disconnect();
});

describe("customer assortments", () => {
  it("hidden items for one customer: gone from every channel for that customer", async () => {
    const lx = await ctxFor(LX);
    const h = await A.createAssortment(lx, { name: "Not for Kebab House", mode: "HIDE_LISTED", target: "CUSTOMER", targetCompanyId: kbId });
    await A.addItems(lx, h.id, { offerIds: [b] });
    const v = await visible([a, b, c]);
    expect(v.has(a)).toBe(true);
    expect(v.has(b)).toBe(false);
    const { addToCart } = await import("@/server/services/cart");
    await expect(addToCart(await ctxFor(KB), b, 1)).rejects.toThrow();
  });

  it("an approved list for all customers: only listed products of this supplier; others untouched", async () => {
    const lx = await ctxFor(LX);
    const o = await A.createAssortment(lx, { name: "Core range", mode: "ONLY_LISTED", target: "ALL" });
    const r = await A.addItems(lx, o.id, { offerIds: [a], skus: "NOPE-123" });
    expect(r.notFound).toEqual(["NOPE-123"]);
    const v = await visible([a, b, c, ...(other ? [other] : [])]);
    expect(v.has(a)).toBe(true);
    expect(v.has(b)).toBe(false);
    expect(v.has(c)).toBe(false);
    if (other) expect(v.has(other)).toBe(true);
    const p = await A.previewForCustomer(lx, kbId);
    expect(p.visible).toBeGreaterThanOrEqual(1);
    expect(p.lists.length).toBe(2);
  });

  it("must-stock: visible even off the approved list, a gap when never ordered, added to the cart", async () => {
    const lx = await ctxFor(LX), kb = await ctxFor(KB);
    const m = await A.createAssortment(lx, { name: "Kebab essentials", mode: "MUST_STOCK", target: "CUSTOMER", targetCompanyId: kbId });
    await A.addItems(lx, m.id, { offerIds: [c] });
    expect((await visible([c])).has(c)).toBe(true);
    expect(await A.hasMustStock(kbId)).toBe(true);
    const mine = await A.myMustStock(kb);
    const it = mine.suppliers.find((s) => s.vendorId === lxId)!.items.find((i) => i.offerId === c)!;
    expect(it).toMatchObject({ gap: true, available: true, lastOrdered: null });
    await clearCart(kb).catch(() => null);
    const r = await A.addGapsToCart(kb, lxId);
    expect(r.added).toBeGreaterThanOrEqual(1);
    expect(await prisma.cartItem.count({ where: { cart: { buyerCompanyId: kbId }, offerId: c } })).toBe(1);
    const gaps = await A.mustStockGapsFor(lxId, kbId, "en");
    expect(gaps.some((g) => g.offerId === c)).toBe(true);
  });

  it("the customer's own list beats a hidden list", async () => {
    const lx = await ctxFor(LX);
    const own = await A.createAssortment(lx, { name: "Kebab House extras", mode: "ONLY_LISTED", target: "CUSTOMER", targetCompanyId: kbId });
    await A.addItems(lx, own.id, { offerIds: [b] });
    expect((await visible([b])).has(b)).toBe(true);
    await A.deleteAssortment(lx, own.id);
    expect((await visible([b])).has(b)).toBe(false);
  });

  it("weekly reminder of gaps, once a week", async () => {
    const r1 = await A.processAssortments();
    expect(r1.reminded).toBeGreaterThanOrEqual(1);
    expect(await prisma.mustStockReminder.count({ where: { buyerCompanyId: kbId } })).toBe(1);
    const before = (await prisma.mustStockReminder.findUniqueOrThrow({ where: { buyerCompanyId: kbId } })).sentAt;
    await A.processAssortments();
    expect((await prisma.mustStockReminder.findUniqueOrThrow({ where: { buyerCompanyId: kbId } })).sentAt.getTime()).toBe(before.getTime());
  });

  it("FIRINGI's switches: a kind of list off, the supplier off", async () => {
    const admin = await ctxFor(ADMIN), lx = await ctxFor(LX);
    await A.saveAssortmentSettings(admin, { modes: { ONLY_LISTED: false, HIDE_LISTED: true, MUST_STOCK: true } });
    let v = await visible([a, b, c]);
    expect(v.has(a) && v.has(c)).toBe(true);
    expect(v.has(b)).toBe(false); // still hidden by the hidden-items list
    await expect(A.createAssortment(lx, { name: "x", mode: "ONLY_LISTED", target: "ALL" })).rejects.toThrow(/doesn't allow/);
    await A.setVendorAssortments(admin, lxId, false);
    v = await visible([a, b, c]);
    expect(v.has(b)).toBe(true);
    await expect(A.createAssortment(lx, { name: "y", mode: "HIDE_LISTED", target: "ALL" })).rejects.toThrow(/switched off/);
    await prisma.setting.deleteMany({ where: { key: "assortments.settings" } });
  });
});
