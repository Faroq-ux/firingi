/** Shelf price labels: from purchases (margin) and the till, edits, promo, PDF, reprint list, till sync, switches. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import * as S from "@/server/labels/service";
import { DEFAULT_FIELDS } from "@/lib/shelf-labels";
import { ctxFor } from "../helpers";

const KEBAB = "owner@kebabhouse.test";
const LX = "owner@lisboacentral.test";
let kebabId = "";
beforeAll(async () => {
  const k = await ctxFor(KEBAB), lx = await ctxFor(LX);
  kebabId = k.company.id;
  await prisma.shelfLabel.deleteMany({ where: { companyId: kebabId } });
  await prisma.setting.deleteMany({ where: { key: "shelfLabels.settings" } });
  if (!(await prisma.order.count({ where: { buyerCompanyId: kebabId, sellerCompanyId: lx.company.id } }))) {
    const { placeOrder } = await import("@/server/services/orders");
    const wh = await prisma.address.findFirstOrThrow({ where: { companyId: lx.company.id, kind: "WAREHOUSE", isActive: true } });
    const addr = await prisma.address.findFirstOrThrow({ where: { companyId: kebabId, kind: "DELIVERY", isActive: true } });
    const offer = await prisma.vendorOffer.findFirstOrThrow({ where: { vendorCompanyId: lx.company.id, vendorSku: "GRO-ARROZ1", status: "ACTIVE" } });
    await placeOrder(k, { deliveryAddressId: addr.id, items: [{ offerId: offer.id, qty: 1 }], approved: true, handover: { warehouseId: wh.id, paidNow: true, reason: "shelf labels test" } });
  }
});
afterAll(async () => { await prisma.shelfLabel.deleteMany({ where: { companyId: kebabId } }); await prisma.setting.deleteMany({ where: { key: "shelfLabels.settings" } }); });

describe("shelf price labels", () => {
  it("from purchases: price = cost per item + margin incl. VAT; product barcode; content read from the name", async () => {
    const k = await ctxFor(KEBAB);
    const c = await S.labelCandidates(k, "pt-PT");
    expect(c.purchases.length).toBeGreaterThan(0);
    const pick = c.purchases[0];
    const r = await S.addFromPurchases(k, [pick.offerId], 40, "NINE", "pt-PT");
    expect(r.added).toBe(1);
    const { labels } = await S.listLabels(k);
    const l = labels.find((x) => x.offerId === pick.offerId)!;
    expect(Number(l.priceGross)).toBeGreaterThan(Number(pick.costNet));
    expect(l.priceGross.toFixed(2).endsWith("9")).toBe(true);
    expect(l.toPrint).toBe(true);
    const offer = await prisma.vendorOffer.findUniqueOrThrow({ where: { id: pick.offerId }, select: { packaging: { select: { variant: { select: { gtin: true } } } } } });
    expect(l.barcode).toBe(offer.packaging.variant.gtin); // the barcode on the product itself
  });

  it("edit price and promo; print → marked printed; a later change → to print again; margin prices follow the cost", async () => {
    const k = await ctxFor(KEBAB);
    const [l] = (await S.listLabels(k)).labels;
    await S.updateLabel(k, l.id, { priceGross: 2.49, promoPrice: 1.99, promoUntil: new Date(Date.now() + 7 * 86_400_000), content: 1, contentUnit: "KG" });
    const pdf = await S.printLabels(k, [l.id], "A4_21", { ...DEFAULT_FIELDS, origin: true }, "pt-PT");
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    let now = (await S.listLabels(k)).labels.find((x) => x.id === l.id)!;
    expect(now.toPrint).toBe(false);
    expect(now.printedPromo?.toString()).toBe("1.99");
    await S.updateLabel(k, l.id, { priceGross: 2.59 });
    now = (await S.listLabels(k)).labels.find((x) => x.id === l.id)!;
    expect(now.toPrint).toBe(true);
    expect(now.marginPct).toBeNull(); // a price by hand ends the margin pricing
    await S.updateLabel(k, l.id, { marginPct: 10 });
    now = (await S.listLabels(k)).labels.find((x) => x.id === l.id)!;
    expect(Number(now.marginPct)).toBe(10);
    // every size renders
    for (const f of ["A4_12", "A4_4", "STRIP_27", "ROLL_58x40", "ROLL_62x29", "ROLL_40x30"] as const) expect((await S.printLabels(k, [l.id], f, DEFAULT_FIELDS, "en")).length).toBeGreaterThan(500);
  });

  it("till items: price and barcode from the till; a label price saved back into the till", async () => {
    const k = await ctxFor(KEBAB);
    const item = await prisma.posItem.create({ data: { companyId: kebabId, name: "Sumo laranja 1L", barcode: "5601111222333", price: 2.2, vatRate: 23 } });
    await S.addFromTill(k, [item.id]);
    const l = (await S.listLabels(k)).labels.find((x) => x.posItemId === item.id)!;
    expect(l.priceGross.toFixed(2)).toBe("2.20");
    expect(l.contentUnit).toBe("L");
    await S.updateLabel(k, l.id, { priceGross: 2.39, syncTill: true });
    expect((await prisma.posItem.findUniqueOrThrow({ where: { id: item.id } })).price.toFixed(2)).toBe("2.39");
    await prisma.shelfLabel.deleteMany({ where: { posItemId: item.id } });
    await prisma.posItem.delete({ where: { id: item.id } });
  });

  it("FIRINGI switches: country off, a company on; suppliers can't", async () => {
    const sa = await ctxFor("superadmin@firingi.test"), k = await ctxFor(KEBAB);
    await S.saveSlSettings(sa, { offCountries: ["PT"] });
    expect((await S.slAccess(k)).on).toBe(false);
    await S.setCompanySl(sa, kebabId, "ON");
    expect((await S.slAccess(k)).on).toBe(true);
    await expect(S.listLabels(await ctxFor("owner@atlantico.test").catch(() => ctxFor(LX)))).rejects.toThrow();
  });
});
