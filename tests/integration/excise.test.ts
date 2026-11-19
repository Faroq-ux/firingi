/**
 * Phase 43: licensed & excise goods — duty in the price (PAID) vs added by FIRINGI (ADDED) through order, invoice,
 * supplier statement and credit note; licences block / warn; country restriction and quantity cap; FIRINGI
 * reviews uploads; the driver's licence check; excise document; monthly report; accounting split; reminders.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { prisma } from "@/server/db";
import { changeOrderStatus, confirmOrder, placeOrder } from "@/server/services/orders";
import { addToCart, clearCart } from "@/server/services/cart";
import { setStock } from "@/server/services/vendor-catalogue";
import { assignDelivery, completeDelivery, pickUp, startDelivery } from "@/server/services/deliveries";
import { creditInvoice } from "@/server/invoicing/service";
import { toEntries, DEFAULT_ACCOUNTS, type Doc } from "@/server/integrations/accounting";
import * as X from "@/server/excise/service";
import { DEFAULT_EXCISE_SETTINGS, type ExciseSettings } from "@/lib/excise";
import { ctxFor } from "../helpers";

const KEBAB = "owner@kebabhouse.test", LX = "owner@lisboacentral.test", SA = "superadmin@firingi.test", OPS = "ops@firingi.test", FIR_DRIVER = "driver@firingi.test";
const PNG = new File([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])], "sig.png", { type: "image/png" });
const PDF = () => new File([Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF")], "licence.pdf", { type: "application/pdf" });
let beer = "", cig = "", kebabId = "", addressId = "";
const placed: string[] = [];

const settings = async (patch: Partial<ExciseSettings> = {}) => X.saveExciseSettings(await ctxFor(SA), { ...DEFAULT_EXCISE_SETTINGS, ...patch });
async function order(items: { offerId: string; qty: number }[]) {
  const kb = await ctxFor(KEBAB);
  await clearCart(kb);
  for (const i of items) await addToCart(kb, i.offerId, i.qty);
  const id = (await placeOrder(kb, { deliveryAddressId: addressId })).id;
  placed.push(id);
  return id;
}
async function deliver(orderId: string, opts: { licenceChecked?: boolean } = {}) {
  const lx = await ctxFor(LX);
  await confirmOrder(lx, orderId, {});
  const d = await prisma.delivery.findUniqueOrThrow({ where: { orderId } });
  const driver = await prisma.driver.findFirstOrThrow({ where: { user: { email: FIR_DRIVER } } });
  if (d.mode !== "FIRINGI_FLEET") await prisma.delivery.update({ where: { id: d.id }, data: { mode: "FIRINGI_FLEET", executingCompanyId: (await prisma.company.findFirstOrThrow({ where: { type: "ADMIN" } })).id } });
  await prisma.delivery.updateMany({ where: { driverId: driver.id, status: { in: ["ASSIGNED", "PICKED_UP", "OUT_FOR_DELIVERY"] }, id: { not: d.id } }, data: { driverId: null, status: "UNASSIGNED", routeId: null } });
  await prisma.driver.update({ where: { id: driver.id }, data: { availability: "AVAILABLE" } });
  await assignDelivery(await ctxFor(OPS), d.id, { driverId: driver.id });
  await changeOrderStatus(lx, orderId, "READY_FOR_PICKUP");
  const drv = await ctxFor(FIR_DRIVER);
  await pickUp(drv, d.id);
  await startDelivery(drv, d.id);
  await completeDelivery(drv, d.id, { recipientName: "Ahmed", signature: PNG, licenceChecked: opts.licenceChecked });
  return d.id;
}
const alcoholLicence = () => prisma.customerLicence.findFirstOrThrow({ where: { companyId: kebabId, typeId: "lt_alcohol", status: "APPROVED", supersededAt: null } });

beforeAll(async () => {
  const lx = await ctxFor(LX), kb = await ctxFor(KEBAB);
  kebabId = kb.company.id;
  await prisma.setting.deleteMany({ where: { key: "excise.settings" } });
  const wh = await prisma.address.findFirstOrThrow({ where: { companyId: lx.company.id, kind: { in: ["WAREHOUSE", "PICKUP"] } } });
  for (const sku of ["GRO-SBOCK33", "GRO-CIG20"]) {
    const o = await prisma.vendorOffer.findFirstOrThrow({ where: { vendorCompanyId: lx.company.id, vendorSku: sku, status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
    const cur = await prisma.stockLevel.findUnique({ where: { offerId_addressId: { offerId: o.id, addressId: wh.id } } });
    await setStock(lx, o.id, wh.id, Math.max(200, (cur?.reserved ?? 0) + 100));
    if (sku === "GRO-SBOCK33") beer = o.id; else cig = o.id;
  }
  addressId = (await prisma.address.findFirstOrThrow({ where: { companyId: kebabId, kind: "DELIVERY", isActive: true }, orderBy: { isDefault: "desc" } })).id;
  // FIRINGI records the restaurant's alcohol and tobacco licences (seen on paper)
  await prisma.customerLicence.deleteMany({ where: { companyId: kebabId } });
  const sa = await ctxFor(SA);
  for (const typeId of ["lt_alcohol", "lt_tobacco"]) await X.recordLicence(sa, { companyId: kebabId, typeId, number: `CML-${typeId}`, expiresOn: "2029-12-31" });
});
afterAll(async () => {
  const sa = await ctxFor(SA);
  const open = await prisma.order.findMany({ where: { id: { in: placed }, status: { notIn: ["DELIVERED", "CANCELLED", "RETURNED"] } }, select: { id: true } });
  await prisma.delivery.updateMany({ where: { orderId: { in: open.map((o) => o.id) }, status: { notIn: ["DELIVERED", "FAILED", "RETURNED", "CANCELLED"] } }, data: { status: "CANCELLED", driverId: null, routeId: null } });
  for (const o of open) await changeOrderStatus(sa, o.id, "CANCELLED", "test clean-up").catch(() => null);
  await prisma.vendorOffer.updateMany({ where: { id: { in: [beer, cig] } }, data: { dutyMode: "PAID", exciseCountries: [] } });
  await prisma.exciseCategory.updateMany({ data: { maxPerOrder: null, blockedCountries: [] } });
  await prisma.customerLicence.deleteMany({ where: { companyId: kebabId } });
  await prisma.setting.deleteMany({ where: { key: "excise.settings" } });
  await prisma.$disconnect();
});

describe("duty", () => {
  it("in the price (PAID): kept on the line, shown on the invoice, totals unchanged", async () => {
    const id = await order([{ offerId: beer, qty: 4 }]);
    const l = await prisma.orderLine.findFirstOrThrow({ where: { orderId: id } });
    // 24 × 33 cl at 5,2 % vol, PT 4,50 € / hl / % vol → 1,8533 per case
    expect([l.exciseCategoryId, l.exciseMode, l.exciseUnitNet?.toString(), l.exciseNet.toString()]).toEqual(["ec_beer", "PAID", "1.8533", "7.41"]);
    const o = await prisma.order.findUniqueOrThrow({ where: { id } });
    expect([o.exciseIncludedNet.toString(), o.exciseAddedNet.toString()]).toEqual(["7.41", "0"]);
    expect(new Decimal(o.grandTotal.toString()).eq(new Decimal(o.netTotal.toString()).plus(o.vatTotal.toString()))).toBe(true);
    await deliver(id);
    const inv = await prisma.invoice.findFirstOrThrow({ where: { orderId: id, docType: "INVOICE" }, include: { lines: true } });
    expect(inv.lines.filter((x) => x.orderLineId).map((x) => x.exciseNet.toString())).toEqual(["7.41"]);
    expect(inv.grossTotal.toString()).toBe(o.grandTotal.toString());
  });

  it("added by FIRINGI (ADDED): own invoice line with VAT, passed on to the supplier, credited with the goods", async () => {
    await X.saveOfferExcise(await ctxFor(LX), { offerId: beer, dutyMode: "ADDED", volumeL: 7.92, abv: 5.2 });
    const id = await order([{ offerId: beer, qty: 4 }]);
    const o = await prisma.order.findUniqueOrThrow({ where: { id }, include: { lines: true } });
    expect([o.exciseAddedNet.toString(), o.exciseAddedVat.toString(), o.lines[0].exciseMode]).toEqual(["7.41", "1.7", "ADDED"]);
    await deliver(id);
    const inv = await prisma.invoice.findFirstOrThrow({ where: { orderId: id, docType: "INVOICE" }, include: { lines: { orderBy: { position: "asc" } } } });
    const ex = inv.lines.find((x) => x.description.startsWith("Imposto especial de consumo"))!;
    expect([ex.qty.toString(), ex.unitPriceNet.toString(), ex.lineNet.toString(), ex.lineVat.toString(), ex.exciseNet.toString(), ex.orderLineId]).toEqual(["4", "1.8533", "7.41", "1.7", "7.41", o.lines[0].id]);
    expect(new Decimal(inv.grossTotal.toString()).toFixed(2)).toBe(new Decimal(o.grandTotal.toString()).plus("7.41").plus("1.7").toFixed(2));
    const st = await prisma.vendorBillingStatement.findFirstOrThrow({ where: { orderId: id, isCreditStatement: false } });
    expect((st.lines as { sku: string; lineNet: string }[]).find((x) => x.sku.startsWith("EXCISE-"))?.lineNet).toBe("7.41");
    // crediting 1 of the 4 cases credits a quarter of the duty too, and the supplier's share comes back
    const goods = inv.lines.find((x) => !x.description.startsWith("Imposto"))!;
    const actor = (await ctxFor(SA)).user.id;
    const cn = await prisma.$transaction((tx) => creditInvoice(tx, inv.id, { lines: [{ invoiceLineId: goods.id, qty: 1 }], reason: "Damaged case", actorUserId: actor }));
    const cnLines = await prisma.invoiceLine.findMany({ where: { invoiceId: cn.id } });
    expect(cnLines.find((x) => x.description.startsWith("Imposto"))?.lineNet.toString()).toBe("1.85");
    const cst = await prisma.vendorBillingStatement.findUniqueOrThrow({ where: { id: cn.creditStatementId! } });
    expect((cst.lines as { sku: string }[]).map((x) => x.sku.startsWith("EXCISE-"))).toEqual([false, true]);
  });
});

describe("licences and restrictions", () => {
  it("no licence: hidden and refused (or only warned, or not asked in a country)", async () => {
    const kb = await ctxFor(KEBAB), sa = await ctxFor(SA);
    const { allowedRestrictions } = await import("@/server/services/restrictions");
    expect((await allowedRestrictions(kebabId)).sort()).toEqual(["ALCOHOL", "TOBACCO"]);
    const lic = await alcoholLicence();
    await X.revokeLicence(sa, lic.id, "Licence withdrawn by the city");
    expect(await allowedRestrictions(kebabId)).toEqual(["TOBACCO"]); // the catalogue hides the alcohol again
    await clearCart(kb);
    await expect(addToCart(kb, beer, 1)).rejects.toThrow(/not found/i);
    expect((await X.checkItems(kebabId, [{ offerId: beer, qty: 1 }]))[0]).toMatchObject({ code: "LICENCE", kind: "ALCOHOL", block: true });
    await addToCart(kb, cig, 1); // the tobacco licence is still valid
    // FIRINGI only warns: visible, can be ordered, the customer is told
    await settings({ licences: { ...DEFAULT_EXCISE_SETTINGS.licences, enforcement: "WARN" } });
    expect((await allowedRestrictions(kebabId)).sort()).toEqual(["ALCOHOL", "TOBACCO"]);
    await addToCart(kb, beer, 1);
    expect((await X.checkItems(kebabId, [{ offerId: beer, qty: 1 }]))[0]).toMatchObject({ code: "LICENCE", block: false });
    expect((await X.offerBadges(kb, [{ offerId: beer }], "pt-PT")).get(beer)?.licence).toBe("MISSING_WARN");
    // no licence asked in Portugal
    await settings({ licences: { ...DEFAULT_EXCISE_SETTINGS.licences, countries: { PT: { buyer: false } } } });
    expect(await X.checkItems(kebabId, [{ offerId: beer, qty: 1 }])).toEqual([]);
    // back to BLOCK: the old cart can't be checked out
    await settings();
    await expect(placeOrder(kb, { deliveryAddressId: addressId })).rejects.toThrow();
    await clearCart(kb);
    // a catalogue approval from before Phase 43 still counts
    const ra = await prisma.restrictionApproval.create({ data: { companyId: kebabId, restriction: "ALCOHOL", status: "APPROVED", validUntil: new Date("2029-01-01") } });
    expect([...(await X.coveredKinds(kebabId, "PT"))].sort()).toEqual(["ALCOHOL", "TOBACCO", "VAPING"]);
    await prisma.restrictionApproval.delete({ where: { id: ra.id } });
  });

  it("the customer uploads a licence, FIRINGI approves it, it counts; reject needs a reason", async () => {
    const kb = await ctxFor(KEBAB), sa = await ctxFor(SA);
    const exp = new Date(Date.now() + 400 * 86_400_000).toISOString().slice(0, 10);
    await expect(X.uploadLicence(kb, { typeId: "lt_alcohol", number: "", expiresOn: exp, file: PDF() })).rejects.toThrow(/number/);
    const id = await X.uploadLicence(kb, { typeId: "lt_alcohol", number: "LIC-ALC-2027", issuer: "Câmara Municipal de Lisboa", expiresOn: exp, file: PDF() });
    expect((await X.myLicences(kb, "pt-PT")).covered).not.toContain("ALCOHOL");
    expect((await X.licenceRegister(sa)).pending).toBeGreaterThanOrEqual(1);
    await expect(X.rejectLicence(sa, id, " ")).rejects.toThrow(/why/);
    await X.approveLicence(sa, id);
    expect((await X.myLicences(kb, "pt-PT")).covered).toContain("ALCOHOL");
    await addToCart(kb, beer, 1);
    await clearCart(kb);
    expect((await X.licenceFile(kb, id)).fileName).toBe("licence.pdf");
    await expect(X.licenceFile(await ctxFor(LX), id)).rejects.toThrow();
  });

  it("country restriction and quantity cap", async () => {
    const kb = await ctxFor(KEBAB), lx = await ctxFor(LX), sa = await ctxFor(SA);
    await X.saveOfferExcise(lx, { offerId: cig, dutyMode: "PAID", exciseUnits: 200, exciseCountries: ["ES"] });
    await clearCart(kb);
    await expect(addToCart(kb, cig, 1)).rejects.toMatchObject({ code: "EXCISE_COUNTRY" });
    await X.saveOfferExcise(lx, { offerId: cig, dutyMode: "PAID", exciseUnits: 200, exciseCountries: [] });
    await X.saveCategory(sa, "ec_cigarettes", { maxPerOrder: 3 });
    await addToCart(kb, cig, 3);
    await expect(addToCart(kb, cig, 1)).rejects.toMatchObject({ code: "EXCISE_QTY_CAP" });
    await settings({ restrictions: { ...DEFAULT_EXCISE_SETTINGS.restrictions, qtyCaps: false } });
    await addToCart(kb, cig, 1);
    await settings();
    await X.saveCategory(sa, "ec_cigarettes", { maxPerOrder: null });
    await clearCart(kb);
    // the supplier must give the measures its category needs
    await expect(X.saveOfferExcise(lx, { offerId: cig, dutyMode: "PAID" })).rejects.toThrow(/exciseUnits/);
  });
});

describe("delivery, records", () => {
  it("the driver checks the licence when FIRINGI asks; the supplier records the e-DA", async () => {
    await settings({ restrictions: { ...DEFAULT_EXCISE_SETTINGS.restrictions, driverCheck: true } });
    const id = await order([{ offerId: cig, qty: 1 }]);
    expect((await X.stopCheck(id)).required).toBe(true);
    await expect(deliver(id)).rejects.toMatchObject({ code: "EXCISE_CHECK_REQUIRED" });
    const d = await prisma.delivery.findUniqueOrThrow({ where: { orderId: id } });
    await completeDelivery(await ctxFor(FIR_DRIVER), d.id, { recipientName: "Ahmed", signature: PNG, licenceChecked: true });
    expect((await prisma.delivery.findUniqueOrThrow({ where: { id: d.id } })).exciseCheckedAt).not.toBeNull();
    await settings();
    const lx = await ctxFor(LX);
    await expect(X.recordExciseDoc(lx, id, { docType: "E_DA", docRef: "x" })).rejects.toThrow(/reference/);
    await X.recordExciseDoc(lx, id, { docType: "E_DA", docRef: "26PTA00000012345678901" });
    const v = await X.orderExcise(await ctxFor(KEBAB), id, "BUYER", "pt-PT");
    expect(v).toMatchObject({ licensed: true, doc: { type: "E_DA", ref: "26PTA00000012345678901", canEdit: false } });
    expect(v!.check.at).not.toBeNull();
  });

  it("monthly report, accounting split, licence reminders", async () => {
    const ym = new Date().toISOString().slice(0, 7);
    const r = await X.exciseReport(await ctxFor(LX), ym, "pt-PT");
    const beerPaid = r.rows.find((x) => x.code === "BEER" && x.mode === "PAID" && x.country === "PT")!;
    expect(beerPaid.units).toBeGreaterThanOrEqual(2);
    expect(beerPaid.lpa).toBeCloseTo(beerPaid.units * 0.41184, 3); // 7,92 l × 5,2 %
    expect(r.rows.some((x) => x.code === "CIGARETTES" && x.sticks >= 200)).toBe(true);
    expect(X.reportCsv(r).split("\n")[0]).toContain("litres_pure_alcohol");
    await expect(X.exciseReport(await ctxFor(KEBAB), ym)).rejects.toThrow();

    const doc: Doc = { journal: "SALES", date: new Date(), number: "FT 1", kind: "INVOICE", partner: "K", taxId: "1", country: "PT", net: new Decimal(100), vat: new Decimal(23), gross: new Decimal(123), byRate: [{ rate: "23", base: new Decimal(100), vat: new Decimal(23) }], dueDate: null, reference: "", status: "ISSUED", excise: new Decimal(3.71) };
    const e = toEntries([doc], DEFAULT_ACCOUNTS);
    expect(e.find((x) => x.account === "711")?.credit.toString()).toBe("96.29");
    expect(e.find((x) => x.account === "7118")?.credit.toString()).toBe("3.71");
    expect(toEntries([doc], { ...DEFAULT_ACCOUNTS, excise: "" }).find((x) => x.account === "711")?.credit.toString()).toBe("100");

    const lic = await alcoholLicence();
    await prisma.customerLicence.update({ where: { id: lic.id }, data: { expiresOn: new Date(Date.now() + 10 * 86_400_000), remindedDays: [] } });
    const j = await X.runExciseJob();
    expect(j.reminders).toBeGreaterThanOrEqual(1);
    expect((await prisma.customerLicence.findUniqueOrThrow({ where: { id: lic.id } })).remindedDays.sort()).toEqual([14, 30]);
    expect(await prisma.notificationMessage.count({ where: { eventKey: "excise.licence_expiring" } })).toBeGreaterThanOrEqual(1);
    await prisma.customerLicence.update({ where: { id: lic.id }, data: { expiresOn: new Date(Date.now() - 2 * 86_400_000) } });
    await X.runExciseJob();
    expect((await prisma.customerLicence.findUniqueOrThrow({ where: { id: lic.id } })).status).toBe("EXPIRED");
    await prisma.customerLicence.update({ where: { id: lic.id }, data: { expiresOn: new Date("2029-12-31"), status: "APPROVED" } });
  });

  it("FIRINGI: rates history, licence types, settings switch the supplier certificate", async () => {
    const sa = await ctxFor(SA);
    await X.addRate(sa, { categoryId: "ec_beer", countryCode: "PT", rate: 5, validFrom: "2099-01-01" });
    const pt = (await X.listCategories()).find((c) => c.code === "BEER")!.rates.filter((x) => x.countryCode === "PT");
    expect(pt.map((x) => [x.rate, x.validTo?.toISOString().slice(0, 10) ?? null])).toEqual([[5, null], [4.5, "2098-12-31"]]);
    await expect(X.addRate(sa, { categoryId: "ec_beer", countryCode: "PT", rate: 6, validFrom: "2099-01-01" })).rejects.toThrow(/later date/);
    await expect(X.addRate(sa, { categoryId: "ec_beer", countryCode: "PT", rate: 6, adValoremPct: 10, validFrom: "2099-06-01" })).rejects.toThrow(/tobacco/);
    await prisma.exciseRate.deleteMany({ where: { categoryId: "ec_beer", countryCode: "PT", validFrom: new Date("2099-01-01") } });
    await prisma.exciseRate.updateMany({ where: { id: "er_pt_beer" }, data: { validTo: null } });
    await settings({ licences: { ...DEFAULT_EXCISE_SETTINGS.licences, supplier: true } });
    expect((await prisma.certificateType.findUniqueOrThrow({ where: { key: "excise-authorisation" } })).required).toBe(true);
    await settings();
    expect((await prisma.certificateType.findUniqueOrThrow({ where: { key: "excise-authorisation" } })).required).toBe(false);
    await expect(X.saveExciseSettings(await ctxFor(KEBAB), DEFAULT_EXCISE_SETTINGS)).rejects.toThrow();
  });
});
