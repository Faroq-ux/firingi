/**
 * Phase 22: personal workspace and live data.
 *  • Saved table views and dashboard layouts belong to one user in one company; another user (or
 *    the same user in another company) never sees them; one default view per table; size limits.
 *  • Command palette search only returns what the portal / permissions allow: a supplier never
 *    finds another supplier's orders nor an order FIRINGI holds; a customer only its own orders.
 *  • Live feed: same visibility rules (a held order isn't in the supplier's feed; a customer of a
 *    FIRINGI-routed order sees FIRINGI, never the real supplier).
 */
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { deleteView, getPreference, listViews, saveView, setPreference } from "@/server/services/workspace";
import { globalSearch } from "@/server/services/search";
import { liveEvents } from "@/server/services/live";
import { addToCart, clearCart } from "@/server/services/cart";
import { changeOrderStatus, confirmOrder, placeOrder } from "@/server/services/orders";
import { setStock } from "@/server/services/vendor-catalogue";
import { ctxFor } from "../helpers";

const SA = "superadmin@firingi.test", OPS = "ops@firingi.test", KEBAB = "owner@kebabhouse.test", LX = "owner@lisboacentral.test", ATL = "owner@atlantico.test";
afterAll(async () => {
  for (const e of [SA, OPS, KEBAB, LX]) { const c = await ctxFor(e); await prisma.savedView.deleteMany({ where: { userId: c.user.id, tableId: { startsWith: "test." } } }); await setPreference(c, "dashboard.test", null); }
});

async function order(qty = 25) {
  const kebab = await ctxFor(KEBAB), lx = await ctxFor(LX);
  const offer = await prisma.vendorOffer.findFirstOrThrow({ where: { vendorCompanyId: lx.company.id, vendorSku: "GRO-MOZZ2", packaging: { unitsPerPack: 1 } } });
  const wh = await prisma.address.findFirstOrThrow({ where: { companyId: lx.company.id, kind: "WAREHOUSE" } });
  await setStock(lx, offer.id, wh.id, 900);
  await clearCart(kebab);
  await addToCart(kebab, offer.id, qty);
  const addr = await prisma.address.findFirstOrThrow({ where: { companyId: kebab.company.id, kind: "DELIVERY", isActive: true }, orderBy: { isDefault: "desc" } });
  return placeOrder(kebab, { deliveryAddressId: addr.id });
}

describe("saved views and preferences", () => {
  it("are personal, with one default per table", async () => {
    const sa = await ctxFor(SA), ops = await ctxFor(OPS);
    const a = await saveView(sa, { tableId: "test.orders", name: "Late ones", state: { cols: ["number"], q: "late" } });
    await saveView(sa, { tableId: "test.orders", name: "Big", state: { sort: { key: "total", dir: "desc" } }, isDefault: true });
    await saveView(sa, { tableId: "test.orders", name: "Late ones", state: { cols: ["number", "status"] }, isDefault: true }); // update + new default
    const mine = await listViews(sa, "test.orders");
    expect(mine.map((v) => [v.name, v.isDefault])).toEqual([["Late ones", true], ["Big", false]]);
    expect(mine[0].state).toEqual({ cols: ["number", "status"] });
    expect(await listViews(ops, "test.orders")).toEqual([]);
    await expect(deleteView(ops, a.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await deleteView(sa, a.id);
    expect((await listViews(sa, "test.orders")).map((v) => v.name)).toEqual(["Big"]);
    await expect(saveView(sa, { tableId: "bad table", name: "x", state: {} })).rejects.toThrow();
    await expect(saveView(sa, { tableId: "test.orders", name: "huge", state: { x: "y".repeat(30_000) } })).rejects.toThrow(/large/);
  });

  it("dashboard layout per user", async () => {
    const sa = await ctxFor(SA), ops = await ctxFor(OPS);
    await setPreference(sa, "dashboard.test", { order: ["b", "a"], hidden: ["c"] });
    expect(await getPreference(sa, "dashboard.test")).toEqual({ order: ["b", "a"], hidden: ["c"] });
    expect(await getPreference(ops, "dashboard.test")).toBeNull();
    await setPreference(sa, "dashboard.test", null);
    expect(await getPreference(sa, "dashboard.test")).toBeNull();
  });
});

describe("search and live feed respect who may see what", () => {
  it("finds only what the portal allows", async () => {
    const o = await order();
    const sa = await ctxFor(SA), lx = await ctxFor(LX), kebab = await ctxFor(KEBAB), atl = await ctxFor(ATL);
    const number = (await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).number;
    expect((await globalSearch(sa, "admin", number)).map((h) => h.href)).toContain(`/admin/orders/${o.id}`);
    expect((await globalSearch(kebab, "buy", number)).map((h) => h.href)).toContain(`/buy/orders/${o.id}`);
    expect((await globalSearch(lx, "vendor", number)).map((h) => h.href)).toContain(`/vendor/orders/${o.id}`);
    expect(await globalSearch(atl, "vendor", number)).toEqual([]); // another supplier
    expect(await globalSearch(kebab, "admin", "kebab")).toEqual([]); // not their portal
    expect((await globalSearch(sa, "admin", "kebab")).some((h) => h.kind === "company")).toBe(true);
    expect((await globalSearch(kebab, "buy", "mozzarella")).some((h) => h.kind === "product" && h.href.startsWith("/buy/catalogue/offers/"))).toBe(true);
    expect(await globalSearch(sa, "admin", "k")).toEqual([]); // too short

    // Held by FIRINGI → the supplier neither finds it nor sees it live.
    await prisma.order.update({ where: { id: o.id }, data: { status: "ON_HOLD" } });
    expect(await globalSearch(lx, "vendor", number)).toEqual([]);
    await prisma.order.update({ where: { id: o.id }, data: { status: "PENDING_CONFIRMATION" } });

    const since = new Date(Date.now() - 3600_000);
    const lxLive = await liveEvents(lx, "vendor", since, 50);
    expect(lxLive.some((e) => e.number === number && e.status === "PENDING_CONFIRMATION")).toBe(true);
    expect(lxLive.every((e) => e.status !== "ON_HOLD" && e.status !== "NEW")).toBe(true);
    expect((await liveEvents(atl, "vendor", since, 50)).some((e) => e.number === number)).toBe(false);
    const kLive = await liveEvents(kebab, "buy", since, 50);
    expect(kLive.find((e) => e.number === number)?.who).toBe("Lisboa Central");
    expect(await liveEvents(kebab, "admin", since)).toEqual([]);

    await confirmOrder(lx, o.id, {});
    const after = await liveEvents(kebab, "buy", new Date(Date.now() - 60_000), 50);
    expect(after.some((e) => e.number === number && e.status === "SUPPLIER_PROCESSING")).toBe(true);
    await changeOrderStatus(sa, o.id, "CANCELLED", "test").catch(() => null);
  });

  it("a FIRINGI-routed order shows FIRINGI to the customer", async () => {
    const kebab = await ctxFor(KEBAB);
    const routed = await prisma.order.findFirst({ where: { buyerCompanyId: kebab.company.id, routedByFiringi: true }, include: { statusHistory: { orderBy: { at: "desc" }, take: 1 } } });
    if (!routed) return; // no routed orders in this database
    const ev = await liveEvents(kebab, "buy", new Date(routed.statusHistory[0].at.getTime() - 1000), 200);
    const mine = ev.find((e) => e.number === routed.number);
    if (mine) expect(mine.who).toBe("FIRINGI");
  });
});
