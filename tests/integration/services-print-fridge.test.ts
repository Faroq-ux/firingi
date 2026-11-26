/**
 * Services: refrigeration maintenance & repair (every 3 months, a repair on request with parts & labour) and printing
 * (a print supplier's products, a fixed-price order, a quote, printed shelf labels from the labels page, who invoices,
 * FIRINGI's commission, files only for the customer / supplier / FIRINGI).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import * as Cat from "@/server/servicing/catalogue";
import * as Plans from "@/server/servicing/plans";
import * as Pr from "@/server/servicing/printing";
import { putObject } from "@/server/services/storage";
import { ctxFor } from "../helpers";

const AT = "owner@atlantico.test", KB = "owner@kebabhouse.test", LX = "owner@lisboacentral.test", ADMIN = "superadmin@firingi.test";
const DAY = 86400_000;
const n = (v: { toString(): string } | null | undefined) => (v == null ? 0 : Number(v.toString()));
let fridgeId = "", printId = "", kbId = "";

async function clean() {
  await prisma.printJob.deleteMany({});
  await prisma.printProduct.deleteMany({});
  await prisma.serviceVisit.deleteMany({});
  await prisma.servicePlan.deleteMany({});
  await prisma.serviceProvider.deleteMany({});
  await prisma.setting.deleteMany({ where: { key: "services.settings" } });
  if (kbId) await prisma.shelfLabel.deleteMany({ where: { companyId: kbId } });
}
beforeAll(async () => {
  process.env.ASSISTANT_SIMULATE = "1"; // the AI translation without a key
  kbId = (await ctxFor(KB)).company.id;
  await clean();
  await Cat.ensureBuiltIns();
  fridgeId = (await prisma.serviceType.findUniqueOrThrow({ where: { code: "FRIDGE_SERVICE" } })).id;
  printId = (await prisma.serviceType.findUniqueOrThrow({ where: { code: "PRINTING" } })).id;
  const at = await ctxFor(AT), admin = await ctxFor(ADMIN);
  for (const [t, lic] of [[fridgeId, "F-GAS-123"], [printId, null]] as const) {
    await Cat.addProvider(admin, { companyId: at.company.id, serviceTypeId: t, countries: ["PT"], licenceNumber: lic, licenceExpiresAt: lic ? new Date(Date.now() + 400 * DAY) : null });
  }
});
afterAll(clean);

describe("refrigeration maintenance & repair", () => {
  it("every 3 months; a repair on request; parts & labour on the visit; FIRINGI invoices fee + parts", async () => {
    const kb = await ctxFor(KB), at = await ctxFor(AT);
    const plan = await Plans.subscribe(kb, { serviceTypeId: fridgeId, frequency: "QUARTERLY", weekday: 1, dayA: 10, dayB: 25, timeWindow: "MORNING", startsOn: new Date() });
    expect(plan.frequency).toBe("QUARTERLY");
    const v = await Plans.requestVisit(kb, { serviceTypeId: fridgeId, note: "Cold room at 9 °C, compressor noisy", reason: "CUSTOMER", date: new Date() });
    await expect(Plans.completeVisit(at, v.id, { extrasNet: 120, signedBy: "Ana" })).rejects.toThrow(/parts/);
    const done = await Plans.completeVisit(at, v.id, { extrasNet: 120, extrasNote: "Compressor relay + 1 h labour", signedBy: "Ana" });
    expect(n(done.extrasNet)).toBe(120);
    expect(n(done.feeNet)).toBe(175); // 55 visit + 120 parts & labour
    expect(n(done.providerAmount)).toBe(147); // 45 + 120 × 85 %
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: done.invoiceId! }, include: { lines: true } });
    expect(inv.lines.length).toBe(2);
    expect(inv.lines.reduce((a, l) => a + n(l.lineNet), 0)).toBeCloseTo(175, 2);
    const mine = await Plans.myServices(kb);
    const h = mine.history.find((x) => x.id === v.id)!;
    expect(h.extrasNet).toBe(120);
    expect(JSON.stringify(h)).not.toMatch(/providerAmount|commission/);
  });
});

describe("providers added by FIRINGI; names in every language", () => {
  it("FIRINGI adds a supplier as provider (approved at once); licence needed where the service needs it; not a customer", async () => {
    const admin = await ctxFor(ADMIN), at = await ctxFor(AT), kb = await ctxFor(KB);
    const p = await prisma.serviceProvider.findUniqueOrThrow({ where: { companyId_serviceTypeId: { companyId: at.company.id, serviceTypeId: fridgeId } } });
    expect(p.status).toBe("APPROVED");
    await expect(Cat.addProvider(admin, { companyId: kb.company.id, serviceTypeId: printId, countries: [] })).rejects.toThrow(/suppliers/);
    const lx = await ctxFor(LX);
    await expect(Cat.addProvider(admin, { companyId: lx.company.id, serviceTypeId: fridgeId, countries: [] })).rejects.toThrow(/licence/);
    const q = await Cat.addProvider(admin, { companyId: lx.company.id, serviceTypeId: printId, countries: [], invoicedBy: "PROVIDER", commissionPct: 9 });
    expect(q.countries).toEqual(["PT"]);
    expect(q.invoicedBy).toBe("PROVIDER");
    await expect(Cat.addProvider(at, { companyId: lx.company.id, serviceTypeId: printId, countries: [] })).rejects.toThrow();
    await prisma.serviceProvider.delete({ where: { id: q.id } });
  });
  it("a new service: AI translates the name into the 24 other languages; FIRINGI corrects one; customers see their language", async () => {
    const admin = await ctxFor(ADMIN);
    const t = await Cat.saveType(admin, null, { code: "DRAIN_CLEANING", name: "Drain cleaning", description: "Kitchen drains unblocked", kind: "VISIT", unit: "VISIT", isOil: false, needsDocument: false, frequencies: ["ON_REQUEST"], feeNet: 80, pricePerUnit: 0, buybackPerUnit: 0, providerPerVisit: 60, providerPerUnit: 0, invoicedBy: "FIRINGI", commissionPct: 15, commissionPerVisit: 0, commissionPerUnit: 0, countries: [], active: true });
    try {
      const r = await Cat.translateType(admin, t.id);
      expect(r.translated).toBe(24);
      let row = await prisma.serviceType.findUniqueOrThrow({ where: { id: t.id } });
      expect(Object.keys(row.name as object).length).toBe(25);
      const names = { ...(row.name as Record<string, string>), "pt-PT": "Desentupimento de esgotos" };
      await Cat.saveTypeTexts(admin, t.id, { names, descriptions: row.description as Record<string, string> });
      expect((await Cat.translateType(admin, t.id)).translated).toBe(0); // nothing missing; FIRINGI's own text kept
      row = await prisma.serviceType.findUniqueOrThrow({ where: { id: t.id } });
      expect((row.name as Record<string, string>)["pt-PT"]).toBe("Desentupimento de esgotos");
      // editing the English name keeps the other languages
      await Cat.saveType(admin, t.id, { code: "DRAIN_CLEANING", name: "Drain & pipe cleaning", description: "Kitchen drains unblocked", kind: "VISIT", unit: "VISIT", isOil: false, needsDocument: false, frequencies: ["ON_REQUEST"], feeNet: 80, pricePerUnit: 0, buybackPerUnit: 0, providerPerVisit: 60, providerPerUnit: 0, invoicedBy: "FIRINGI", commissionPct: 15, commissionPerVisit: 0, commissionPerUnit: 0, countries: [], active: true });
      row = await prisma.serviceType.findUniqueOrThrow({ where: { id: t.id } });
      expect(Object.keys(row.name as object).length).toBe(25);
      expect(Object.keys(row.description as object).length).toBe(25);
      const mine = await Plans.myServices(await ctxFor(KB), new Date(), "pt-PT");
      expect(mine.types.find((x) => x.id === t.id)?.name).toBe("Desentupimento de esgotos");
    } finally { await prisma.serviceType.delete({ where: { id: t.id } }); }
  });
});

describe("printing", () => {
  let leaflet = "", labelsP = "", menu = "";
  it("the print supplier lists products; the customer sees them; FIRINGI's switch", async () => {
    const at = await ctxFor(AT), kb = await ctxFor(KB);
    leaflet = (await Pr.savePrintProduct(at, null, { kind: "LEAFLET", name: "Leaflets A5, 135 g, colour both sides", unitPriceNet: 0.05, setupNet: 15, minQty: 100, stepQty: 50, priceOnRequest: false, vatRate: 23, turnaroundDays: 3, delivery: ["DELIVERY", "PICKUP"], active: true })).id;
    labelsP = (await Pr.savePrintProduct(at, null, { kind: "SHELF_LABELS", name: "Shelf labels on white self-adhesive", labelFormat: "A4_21", unitPriceNet: 0.06, setupNet: 0, minQty: 3, stepQty: 1, priceOnRequest: false, vatRate: 23, turnaroundDays: 2, delivery: ["DELIVERY"], active: true })).id;
    menu = (await Pr.savePrintProduct(at, null, { kind: "MENU", name: "Laminated menus", unitPriceNet: 0, setupNet: 0, minQty: 1, stepQty: 1, priceOnRequest: true, vatRate: 23, turnaroundDays: 5, delivery: ["PICKUP"], active: true })).id;
    await expect(Pr.savePrintProduct(at, null, { kind: "POSTER", name: "Poster", unitPriceNet: 0, setupNet: 0, minQty: 1, stepQty: 1, priceOnRequest: false, vatRate: 23, turnaroundDays: 1, delivery: ["PICKUP"], active: true })).rejects.toThrow(/price/);
    expect((await Pr.printCatalogue(kb)).map((p) => p.id).sort()).toEqual([leaflet, labelsP, menu].sort());
    await prisma.serviceType.update({ where: { id: printId }, data: { active: false } });
    expect((await Pr.printAccess(kb)).on).toBe(false);
    await prisma.serviceType.update({ where: { id: printId }, data: { active: true } });
  });

  it("fixed price: quantity rules, own files only; accept → printing → delivered; FIRINGI invoices, supplier's amount", async () => {
    const kb = await ctxFor(KB), at = await ctxFor(AT);
    const key = `print-artwork/${kbId}/2026/test-leaflet.pdf`;
    await putObject(key, Buffer.from("%PDF-1.4\n%test\n"), "application/pdf");
    const base = { productId: leaflet, title: "Opening week", delivery: "DELIVERY" as const, artwork: [{ key, fileName: "leaflet.pdf" }] };
    await expect(Pr.orderPrint(kb, { ...base, qty: 120 })).rejects.toThrow(/steps of 50/);
    await expect(Pr.orderPrint(kb, { ...base, qty: 150, artwork: [{ key: "print-artwork/someone-else/x.pdf", fileName: "x.pdf" }] })).rejects.toThrow(/Upload/);
    const j = await Pr.orderPrint(kb, { ...base, qty: 150 });
    expect(n(j.priceNet)).toBe(22.5); // 15 + 150 × 0.05
    await expect(Pr.printFileKey(await ctxFor(LX), j.id, "0")).rejects.toThrow();
    expect((await Pr.printFileKey(at, j.id, "0")).key).toBe(key);
    await Pr.printStep(at, j.id, { step: "ACCEPT" });
    await Pr.printStep(at, j.id, { step: "PRINTING" });
    const d = await Pr.printStep(at, j.id, { step: "DELIVERED" });
    expect(d.status).toBe("DELIVERED");
    expect(d.invoicedBy).toBe("FIRINGI");
    expect(d.invoiceId).toBeTruthy();
    expect(n(d.providerAmount)).toBe(19.8); // 22.5 − 12 % commission
    const mine = (await Pr.myPrintJobs(kb)).find((x) => x.id === j.id)!;
    expect(mine.priceNet).toBe(22.5);
    expect(JSON.stringify(mine)).not.toMatch(/providerAmount|commission/);
  });

  it("price on request: the supplier quotes, the customer accepts; nothing to accept before the quote", async () => {
    const kb = await ctxFor(KB), at = await ctxFor(AT);
    const j = await Pr.orderPrint(kb, { productId: menu, qty: 10, title: "Summer menu", notes: "A4 folded, 2 pages", delivery: "PICKUP" });
    expect(j.status).toBe("REQUESTED");
    await expect(Pr.customerPrintStep(kb, j.id, "ACCEPT_QUOTE")).rejects.toThrow();
    await expect(Pr.printStep(at, j.id, { step: "ACCEPT" })).rejects.toThrow();
    await Pr.printStep(at, j.id, { step: "QUOTE", priceNet: 80, note: "Laminated, 10 copies" });
    const acc = await Pr.customerPrintStep(kb, j.id, "ACCEPT_QUOTE");
    expect(acc.status).toBe("ACCEPTED");
    expect(n(acc.priceNet)).toBe(80);
  });

  it("printed shelf labels: the PDF is made for the supplier, labels count as printed; supplier invoices → FIRINGI's commission", async () => {
    const kb = await ctxFor(KB), at = await ctxFor(AT);
    const ids = [];
    for (const k of [1, 2, 3, 4]) ids.push((await prisma.shelfLabel.create({ data: { companyId: kbId, name: `Produto ${k} 1kg`, barcode: "5601000000226", vatRate: 23, priceGross: 1.99, content: 1, contentUnit: "KG" } })).id);
    const j = await Pr.orderPrint(kb, { productId: labelsP, qty: 0, title: "Shelf labels", delivery: "DELIVERY", labelIds: ids, copies: 2 }, "pt-PT");
    expect(j.qty).toBe(8);
    expect(n(j.priceNet)).toBe(0.48);
    const f = await Pr.printFileKey(at, j.id, "pdf");
    expect(f.key).toBe(j.pdfKey);
    expect(await prisma.shelfLabel.count({ where: { id: { in: ids }, printedAt: { not: null } } })).toBe(4);
    // FIRINGI lets this supplier invoice its customers
    await prisma.serviceProvider.updateMany({ where: { serviceTypeId: printId }, data: { invoicedBy: "PROVIDER" } });
    await Pr.printStep(at, j.id, { step: "ACCEPT" });
    await expect(Pr.printStep(at, j.id, { step: "DELIVERED" })).rejects.toThrow(/invoice number/);
    const d = await Pr.printStep(at, j.id, { step: "DELIVERED", providerInvoiceNo: "FT 2026/88" });
    expect(d.invoicedBy).toBe("PROVIDER");
    expect(n(d.commissionNet)).toBe(0.06); // 12 % of 0.48
    expect(await Pr.invoicePrintCommissions(null, new Date(Date.now() + DAY))).toBe(1);
    expect((await prisma.printJob.findUniqueOrThrow({ where: { id: j.id } })).commissionInvoiceId).toBeTruthy();
    const money = await Pr.printMoneyOpen();
    expect(money.provider).toBe(19.8);
    expect(await Pr.markPrintPaid(await ctxFor(ADMIN), money.rows.map((r) => r.id))).toBe(1);
  });
});
