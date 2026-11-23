/**
 * Phase 70: price benchmark — three restaurants buy the same rice at different prices; the rebuild keeps the group
 * only with enough buyers; the dearest buyer sees "above the market", its position and yearly saving; the cheapest
 * "below"; the supplier sees its price position; FIRINGI's overview and AI Centre suggestion; switches.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import * as B from "@/server/benchmark/service";
import { saveBenchSettings } from "@/server/benchmark/settings";
import { processBenchmark } from "@/server/benchmark/job";
import { ctxFor } from "../helpers";

const LX = "owner@lisboacentral.test", ADMIN = "superadmin@firingi.test";
const BUYERS = ["owner@kebabhouse.test", "owner@minimercadosol.test", "owner@pizzariabella.test"];
const PRICES = [2.4, 1.2, 1.5];
let variantId = "";
const orders: string[] = [], madeAddresses: string[] = [];
const statuses: [string, "PENDING" | "UNDER_REVIEW" | "APPROVED" | string][] = [];

/** Some seeded buyers have no delivery address in the test database — borrow Kebab House's (removed afterwards). */
async function deliveryAddress(companyId: string) {
  const a = await prisma.address.findFirst({ where: { companyId, kind: "DELIVERY", isActive: true } });
  if (a) return a;
  const kb = await ctxFor(BUYERS[0]);
  const { id: _id, companyId: _c, createdAt: _cr, updatedAt: _u, ...src } = await prisma.address.findFirstOrThrow({ where: { companyId: kb.company.id, kind: "DELIVERY", isActive: true } }) as Record<string, unknown> & { id: string };
  void _id; void _c; void _cr; void _u;
  const made = await prisma.address.create({ data: { ...(src as object), companyId } as never });
  madeAddresses.push(made.id);
  return made;
}

beforeAll(async () => {
  await prisma.setting.deleteMany({ where: { key: { in: ["benchmark.settings", "benchmark.lastRun"] } } });
  const lx = await ctxFor(LX);
  const wh = await prisma.address.findFirstOrThrow({ where: { companyId: lx.company.id, kind: "WAREHOUSE", isActive: true } });
  const offer = await prisma.vendorOffer.findFirstOrThrow({ where: { vendorCompanyId: lx.company.id, vendorSku: "GRO-ARROZ1", status: "ACTIVE" }, include: { packaging: true } });
  variantId = offer.packaging.variantId;
  const { placeOrder } = await import("@/server/services/orders");
  // two seeded buyers are still pending review in the test database — approved for this test, restored afterwards
  for (const n of ["Pizzaria Bella Porto, Lda", "Mini-Mercado Sol, Unipessoal Lda"]) {
    const c = await prisma.company.findFirstOrThrow({ where: { legalName: n } });
    statuses.push([c.id, c.status]);
    await prisma.company.update({ where: { id: c.id }, data: { status: "APPROVED" } });
  }
  for (const [i, email] of BUYERS.entries()) {
    const c = await ctxFor(email);
    const addr = await deliveryAddress(c.company.id);
    const r = await placeOrder(c, { deliveryAddressId: addr.id, items: [{ offerId: offer.id, qty: 10 }], approved: true, handover: { warehouseId: wh.id, paidNow: true, reason: "Benchmark test" } });
    const id = (r as { orders?: { id: string }[]; id?: string }).orders?.[0]?.id ?? (r as { id?: string }).id ?? (await prisma.order.findFirstOrThrow({ where: { buyerCompanyId: c.company.id }, orderBy: { placedAt: "desc" } })).id;
    orders.push(id);
    await prisma.orderLine.updateMany({ where: { orderId: id }, data: { unitSalePriceNet: PRICES[i] * offer.packaging.unitsPerPack } });
  }
});
afterAll(async () => {
  for (const [id, status] of statuses) await prisma.company.update({ where: { id }, data: { status: status as never } });
  for (const id of madeAddresses) await prisma.address.update({ where: { id }, data: { isActive: false } }).catch(() => {});
  await prisma.setting.deleteMany({ where: { key: { in: ["benchmark.settings", "benchmark.lastRun"] } } }); await prisma.priceBenchmark.deleteMany({}); });

describe("Price benchmark", () => {
  it("a group is kept only with enough buyers", async () => {
    const admin = await ctxFor(ADMIN);
    await saveBenchSettings(admin, { minBuyers: 4 });
    await B.rebuild();
    expect(await prisma.priceBenchmark.count({ where: { variantId, regionKey: "", typeKey: "" } })).toBe(0);
    await saveBenchSettings(admin, { minBuyers: 3 });
    const r = await processBenchmark(new Date(), true);
    expect(r.rebuilt).toBe(true);
    const g = await prisma.priceBenchmark.findFirstOrThrow({ where: { variantId, regionKey: "", typeKey: "" } });
    expect(g.buyers).toBeGreaterThanOrEqual(3);
  });

  it("the dearest buyer: above the market, position, saving; the cheapest: below", async () => {
    const kb = await ctxFor(BUYERS[0]);
    const m = await B.mine(kb);
    const rice = m.items.find((i) => i.variantId === variantId)!;
    expect(rice.band).toBe("ABOVE");
    expect(rice.position!).toBeGreaterThanOrEqual(75);
    expect(rice.saving).toBeGreaterThan(0);
    expect(m.totals.savingYear).toBeGreaterThan(0);
    expect(m.basket!.spend).toBeGreaterThan(m.basket!.atMedian);
    expect(JSON.stringify(m)).not.toMatch(/minimercado|pizzaria/i); // no other buyer named
    const ms = await B.mine(await ctxFor(BUYERS[1]));
    expect(ms.items.find((i) => i.variantId === variantId)!.band).toBe("BELOW");
    const t = await B.trend(kb);
    expect(t.products.find((p) => p.variantId === variantId)?.market.some((x) => x !== null)).toBe(true);
    const ai = await B.priceCheckForAi(kb, "");
    expect(ai.products.length).toBeGreaterThanOrEqual(1);
  });

  it("the supplier sees its price position; FIRINGI's overview and AI suggestion", async () => {
    const lx = await ctxFor(LX);
    const rows = await B.supplierPosition(lx);
    expect(rows.find((r) => r.sku && r.stats)).toBeTruthy();
    const o = await B.adminOverview(await ctxFor(ADMIN));
    expect(o.run!.groups).toBeGreaterThanOrEqual(1);
    expect(o.top.some((x) => x.name.includes("Kebab"))).toBe(true);
    await prisma.setting.updateMany({ where: { key: "benchmark.lastRun" }, data: { value: { ...(o.run as object), topSavers: [{ companyId: (await ctxFor(BUYERS[0])).company.id, saving: 500, products: 1 }] } } });
    const recs = await B.overpayingRecommendations();
    expect(recs[0]?.kind).toBe("CUSTOMER_OVERPAYING");
  });

  it("switches: customers off, a country off", async () => {
    const admin = await ctxFor(ADMIN), kb = await ctxFor(BUYERS[0]);
    await saveBenchSettings(admin, { audiences: { customers: false, wholesalers: true } });
    await expect(B.mine(kb)).rejects.toThrow(/switched/);
    await saveBenchSettings(admin, { audiences: { customers: true, wholesalers: true }, offCountries: ["PT"] });
    await expect(B.mine(kb)).rejects.toThrow(/switched/);
    await saveBenchSettings(admin, { offCountries: [], supplierView: false });
    await expect(B.supplierPosition(await ctxFor(LX))).rejects.toThrow(/switched/);
  });
});
