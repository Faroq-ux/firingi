/**
 * Phase 51: sustainability & CO₂ — category values (default by slug, FIRINGI's own, inherited), an offer's footprint
 * per pack, a supplier's own value (FIRINGI checks it; AUTO uses it at once), badges (low CO₂, eco packaging), an
 * order's footprint at checkout and at delivery, the buyer's report, goal and CSRD-style export, supplier grade,
 * FIRINGI's switches.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import * as C from "@/server/co2/service";
import { changeOrderStatus, confirmOrder, placeOrder } from "@/server/services/orders";
import { setStock } from "@/server/services/vendor-catalogue";
import { DEFAULT_CO2_SETTINGS, type Co2Settings } from "@/lib/co2";
import { ctxFor, makeOffers } from "../helpers";

const SA = "superadmin@firingi.test", LX = "owner@lisboacentral.test", KEBAB = "owner@kebabhouse.test";
let lxId = "", kebabId = "", offer = "", categoryId = "";

async function settings(p: Partial<Co2Settings> = {}) { return C.saveCo2Settings(await ctxFor(SA), { ...DEFAULT_CO2_SETTINGS, ...p }); }
async function addr(companyId: string) { return (await prisma.address.findFirstOrThrow({ where: { companyId, kind: "DELIVERY", isActive: true }, orderBy: { isDefault: "desc" } })).id; }

beforeAll(async () => {
  await prisma.setting.deleteMany({ where: { key: "co2.settings" } });
  await prisma.companyFeature.deleteMany({ where: { key: "CO2" } });
  await prisma.co2CategoryFactor.deleteMany({});
  lxId = (await ctxFor(LX)).company.id; kebabId = (await ctxFor(KEBAB)).company.id;
  offer = Object.values(await makeOffers(["Grossista Lisboa Central, Lda"]))[0];
  const o = await prisma.vendorOffer.findUniqueOrThrow({ where: { id: offer }, select: { packaging: { select: { id: true, variant: { select: { product: { select: { categoryId: true } } } } } } } });
  categoryId = o.packaging.variant.product.categoryId;
  await prisma.packagingUnit.update({ where: { id: o.packaging.id }, data: { netWeightKg: "7.920" } }); // 24 × 0.33 L
  const list = await prisma.priceList.findFirstOrThrow({ where: { vendorCompanyId: lxId, scope: "BASE", isActive: true } });
  await prisma.priceListItem.create({ data: { priceListId: list.id, offerId: offer, minQty: 1, unitPriceNet: "12.0000" } });
  const wh = (await prisma.address.findFirstOrThrow({ where: { companyId: lxId, kind: { in: ["WAREHOUSE", "PICKUP"] } } })).id;
  await setStock(await ctxFor(LX), offer, wh, 1000);
});
afterAll(async () => {
  await prisma.setting.deleteMany({ where: { key: "co2.settings" } });
  await prisma.companyFeature.deleteMany({ where: { key: "CO2" } });
  await prisma.co2CategoryFactor.deleteMany({});
  await prisma.co2Goal.deleteMany({ where: { companyId: kebabId } });
  await prisma.$disconnect();
});

describe("category values and an offer's footprint", () => {
  it("default by slug (soft drinks 0.4), FIRINGI's own value, children inherit", async () => {
    await settings();
    let f = await C.categoryFactors();
    expect(f.get(categoryId)).toEqual({ kgPerKg: 0.4, own: false });
    await C.saveCategoryFactor(await ctxFor(SA), categoryId, 0.5, "FIRINGI table 2026");
    f = await C.categoryFactors();
    expect(f.get(categoryId)).toEqual({ kgPerKg: 0.5, own: true });
    await C.saveCategoryFactor(await ctxFor(SA), categoryId, null);
  });

  it("per pack: kg of product × kg CO₂e per kg (+ packaging when known)", async () => {
    const fp = (await C.offerFootprints([offer])).get(offer)!;
    expect(fp.netKg).toBe(7.92);
    expect(fp.perPack).toEqual({ product: 3.168, packaging: 0, total: 3.168 }); // 7.92 × 0.4
  });
});

describe("a supplier's own value", () => {
  it("FIRINGI checks it first; then it is used and earns badges", async () => {
    const r = await C.saveOfferCo2(await ctxFor(LX), offer, { kgPerKg: 0.25, packaging: "GLASS", recyclable: true, source: "EPD 2025 (bottler)" });
    expect(r.status).toBe("PENDING");
    expect((await C.offerFootprints([offer])).get(offer)!.kgPerKg).toBe(0.4); // not used yet
    await expect(C.reviewOfferCo2(await ctxFor(SA), offer, false, "")).rejects.toThrow(/why/);
    await C.reviewOfferCo2(await ctxFor(SA), offer, true, null);
    const fp = (await C.offerFootprints([offer])).get(offer)!;
    expect(fp.kgPerKg).toBe(0.25);
    expect(fp.perPack).toEqual({ product: 1.98, packaging: 6, total: 7.98 }); // 7.92 × 0.25; glass 0.25 × 24 items
    const b = (await C.co2Badges(await ctxFor(KEBAB), [offer])).get(offer)!;
    expect(b.badges).toEqual(expect.arrayContaining(["LOW_CO2", "ECO_PACKAGING"])); // 0.25 ≤ 70 % of 0.4
  });

  it("a value needs its source; AUTO approval uses it at once", async () => {
    await expect(C.saveOfferCo2(await ctxFor(LX), offer, { kgPerKg: 0.3, packaging: null, recyclable: false, source: null })).rejects.toThrow(/comes from/);
    await settings({ approval: "AUTO" });
    expect((await C.saveOfferCo2(await ctxFor(LX), offer, { kgPerKg: 0.25, packaging: "GLASS", recyclable: true, source: "EPD 2025" })).status).toBe("APPROVED");
  });
});

describe("orders, reports, goal, export", () => {
  it("an order's footprint at checkout and at delivery; the buyer's report, goal and export", async () => {
    const kb = await ctxFor(KEBAB);
    const placed = await placeOrder(kb, { deliveryAddressId: await addr(kebabId), items: [{ offerId: offer, qty: 10 }], approved: true });
    let o = await prisma.order.findUniqueOrThrow({ where: { id: placed.id }, include: { lines: true } });
    expect(Number(o.co2ProductsKg)).toBeCloseTo(19.8, 3); // 10 × 1.98
    expect(Number(o.co2PackagingKg)).toBeCloseTo(60, 3);
    expect(Number(o.lines[0].co2Kg)).toBeCloseTo(79.8, 3);
    expect(Number(o.co2DeliveryKg)).toBeGreaterThanOrEqual(0);
    await confirmOrder(await ctxFor(LX), placed.id, {});
    for (const st of ["READY_FOR_PICKUP", "DISPATCHED", "OUT_FOR_DELIVERY", "DELIVERED"] as const) await changeOrderStatus(await ctxFor(SA), placed.id, st);
    o = await prisma.order.findUniqueOrThrow({ where: { id: placed.id }, include: { lines: true } });
    expect(o.co2At).not.toBeNull();
    const view = await C.orderCo2(kb, placed.id);
    expect(view).toMatchObject({ products: 19.8, packaging: 60, final: true });
    const year = new Date().getUTCFullYear();
    await C.setGoal(kb, year, 10);
    const r = await C.co2ReportFor(kb, "BUYER", year);
    expect(r.total).toBeGreaterThanOrEqual(79.8);
    expect(r.parties.some((p) => p.name.includes("Lisboa Central"))).toBe(true);
    expect(r.goal?.reductionPct).toBe(10);
    const csv = await C.co2Csv(kb, "BUYER", year);
    expect(csv.split("\n")[0]).toBe("month,category,ghg_scope,kg_co2e");
    expect(csv).toMatch(/Scope 3 · Cat\. 1 Purchased goods/);
    expect(csv).toMatch(/TOTAL,,,\d+\.\d{3}/);
  });

  it("a supplier's green grade", async () => {
    const g = (await C.supplierGrades([lxId])).get(lxId)!;
    expect(g.grade).toMatch(/^[A-E]$/);
  });
});

describe("FIRINGI's switches", () => {
  it("off, a buyer type off, one business on / off; badges hidden when switched off", async () => {
    await settings({ enabled: false });
    expect((await C.co2Access({ id: kebabId, type: "CUSTOMER" })).why).toBe("OFF");
    await settings({ buyers: { CUSTOMER: false, WHOLESALER: true } });
    expect((await C.co2Access({ id: kebabId, type: "CUSTOMER" })).buyer).toBe(false);
    await C.setCompanySwitch(await ctxFor(SA), kebabId, "ON");
    expect((await C.co2Access({ id: kebabId, type: "CUSTOMER" })).buyer).toBe(true);
    await C.setCompanySwitch(await ctxFor(SA), kebabId, "DEFAULT");
    await settings({ show: { ...DEFAULT_CO2_SETTINGS.show, badges: false } });
    expect((await C.co2Badges(await ctxFor(KEBAB), [offer])).size).toBe(0);
    await settings();
  });
});
