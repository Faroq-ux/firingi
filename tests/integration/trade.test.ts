/**
 * Phase 57: EU trade reporting — Intrastat arrivals from a supplier in Spain (customs data, file, filing, a credit
 * after filing becoming a correction in the next return), an exempt intra-EU sale from FIRINGI's Portuguese entity
 * after a VIES check (proof kept; a number that isn't valid gets Portuguese VAT), dispatches and the EC Sales List,
 * suppliers' customs data and own report, reminders and access.
 */
process.env.VIES_SIMULATE = "1";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { prisma } from "@/server/db";
import { addToCart, clearCart } from "@/server/services/cart";
import { changeOrderStatus, placeOrder } from "@/server/services/orders";
import { setStock } from "@/server/services/vendor-catalogue";
import { issueCreditNote } from "@/server/services/finance";
import * as T from "@/server/trade/service";
import { DEFAULT_TRADE_SETTINGS, nextPeriod, periodOf } from "@/lib/trade";
import { ctxFor, makeApprovedCompany } from "../helpers";

const SA = "superadmin@firingi.test";
const LX_BUYER = "purchasing@lisboacentral.test";
const IBERICAS = "owner@ibericas.test";
const KEBAB = "owner@kebabhouse.test";
const NOW = periodOf(new Date(), "MONTHLY");
let ptEntity = "";
let savedSettings: unknown = null;

async function offerOf(vendor: string, sku: string, units?: number) {
  return prisma.vendorOffer.findFirstOrThrow({ where: { vendor: { legalName: vendor }, status: "ACTIVE", packaging: { variant: { sku }, ...(units ? { unitsPerPack: units } : {}) } }, include: { packaging: { include: { variant: true } } } });
}
async function restock(offerId: string, ownerEmail: string) {
  const v = await ctxFor(ownerEmail);
  const wh = await prisma.address.findFirstOrThrow({ where: { companyId: v.company.id, kind: { in: ["WAREHOUSE", "PICKUP"] } } });
  const cur = await prisma.stockLevel.findUnique({ where: { offerId_addressId: { offerId, addressId: wh.id } } });
  await setStock(v, offerId, wh.id, Math.max(1000, (cur?.reserved ?? 0) + 500));
}
/** Buyer orders, the supplier prepares, FIRINGI delivers; `beforeDelivery` can change the order first. */
async function deliveredOrder(buyerEmail: string, offerId: string, qty: number, vendorOwner: string, beforeDelivery?: (orderId: string) => Promise<void>) {
  await restock(offerId, vendorOwner);
  const buyer = await ctxFor(buyerEmail);
  await clearCart(buyer);
  await addToCart(buyer, offerId, qty);
  const addr = await prisma.address.findFirstOrThrow({ where: { companyId: buyer.company.id, kind: "DELIVERY" } });
  const { id } = await placeOrder(buyer, { deliveryAddressId: addr.id });
  const vendor = await ctxFor(vendorOwner);
  const ops = await ctxFor(SA);
  await changeOrderStatus(vendor, id, "SUPPLIER_PROCESSING");
  await changeOrderStatus(vendor, id, "READY_FOR_PICKUP");
  for (const s of ["DISPATCHED", "OUT_FOR_DELIVERY"] as const) await changeOrderStatus(ops, id, s);
  if (beforeDelivery) await beforeDelivery(id);
  await changeOrderStatus(ops, id, "DELIVERED");
  return prisma.order.findUniqueOrThrow({ where: { id }, include: { invoices: { include: { lines: true } }, billingStatements: true } });
}

beforeAll(async () => {
  ptEntity = (await prisma.legalEntity.findFirstOrThrow({ where: { country: { code: "PT" }, isActive: true } })).id;
  savedSettings = (await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: "trade.settings" } }))?.value ?? null;
  await prisma.tradeReturn.deleteMany({});
  await T.saveTradeSettings(await ctxFor(SA), DEFAULT_TRADE_SETTINGS);
});
afterAll(async () => {
  await prisma.tradeReturn.deleteMany({});
  if (savedSettings === null) await prisma.setting.deleteMany({ where: { scope: "GLOBAL", scopeId: "", key: "trade.settings" } });
  else await prisma.setting.updateMany({ where: { scope: "GLOBAL", scopeId: "", key: "trade.settings" }, data: { value: savedSettings as object } });
  await prisma.$disconnect();
});

describe("Intrastat arrivals (FIRINGI buys from a supplier in Spain)", () => {
  let orderId = "", productId = "", packId = "", returnId = "";
  it("turns the reverse-charge statement into arrival lines, flagging missing customs data", async () => {
    const offer = await offerOf("Distribuciones Ibéricas S.L.", "FIR-ARROZ1");
    productId = offer.packaging.variant.productId; packId = offer.packagingUnitId;
    await prisma.product.update({ where: { id: productId }, data: { hsCode: null, originCountryCode: null } });
    await prisma.packagingUnit.update({ where: { id: packId }, data: { netWeightKg: null } });
    const o = await deliveredOrder(LX_BUYER, offer.id, 60, IBERICAS);
    orderId = o.id;
    expect(o.billingStatements[0].taxRegime).toBe("INTRA_EU_REVERSE_CHARGE");
    const r = await T.openReturn(await ctxFor(SA), { legalEntityId: ptEntity, kind: "ARRIVALS", period: NOW });
    returnId = r.id;
    const d = await T.returnDetail(await ctxFor(SA), r.id);
    const mine = d.items.filter((l) => l.orderId === orderId);
    expect(mine).toHaveLength(1);
    expect(mine[0].vat).toBe("ESB12345678");
    expect(mine[0].country).toBe("ES");
    expect(mine[0].problems).toEqual(expect.arrayContaining(["MISSING_CN", "MISSING_MASS", "MISSING_ORIGIN"]));
    const goods = (o.billingStatements[0].lines as { sku: string; lineNet: string }[]).find((l) => l.sku === "FIR-ARROZ1")!;
    expect(Number(mine[0].value)).toBeCloseTo(Number(goods.lineNet), 2);
  });

  it("uses the category's default CN8 code (flagged) and then the product's checked data", async () => {
    const ctx = await ctxFor(SA);
    const cat = await prisma.product.findUniqueOrThrow({ where: { id: productId }, select: { categoryId: true } });
    await T.setCategoryCn(ctx, cat.categoryId, { cnCode: "1006 30 98", suppUnit: null });
    let d = await T.returnDetail(ctx, (await T.rebuildReturn(returnId)).id);
    let line = d.items.find((l) => l.orderId === orderId)!;
    expect(line.cn).toBe("10063098");
    expect(line.problems).toContain("CATEGORY_CN");
    await expect(T.setProductCustoms(ctx, productId, { cnCode: "1006 30", originCountryCode: "ES", suppUnit: null })).rejects.toThrow(/8 digits/);
    await T.setProductCustoms(ctx, productId, { cnCode: "1006 30 27", originCountryCode: "es", suppUnit: null, packs: [{ id: packId, netWeightKg: 1, suppUnits: null }] });
    d = await T.returnDetail(ctx, (await T.rebuildReturn(returnId)).id);
    line = d.items.find((l) => l.orderId === orderId)!;
    expect(line.cn).toBe("10063027");
    expect(line.origin).toBe("ES");
    expect(Number(line.massKg)).toBe(60);
    expect(line.problems).toEqual([]);
    await T.setCategoryCn(ctx, cat.categoryId, { cnCode: null, suppUnit: null });
  });

  it("downloads the Portuguese INE layout, a CSV and an Excel file", async () => {
    const ctx = await ctxFor(SA);
    const pt = await T.returnFile(ctx, returnId, "national");
    expect(pt.fileName).toBe(`INTRASTAT_INTRO_${NOW}.csv`);
    expect(String(pt.body)).toContain("10063027;ES;11;3;DAP;");
    expect(String(pt.body)).toContain("ESB12345678;ES");
    const csv = await T.returnFile(ctx, returnId, "csv");
    expect(String(csv.body).split("\r\n")[0]).toContain("CN8");
    const xlsx = await T.returnFile(ctx, returnId, "xlsx");
    expect(Buffer.isBuffer(xlsx.body) && xlsx.body.subarray(0, 2).toString()).toBe("PK");
  });

  it("is filed with the reference; a credit after filing goes into the next return as a correction", async () => {
    const ctx = await ctxFor(SA);
    await expect(T.markFiled(ctx, returnId, { reference: "x" })).rejects.toThrow(/reference/);
    await T.markFiled(ctx, returnId, { reference: "INE-2026-778899" });
    await expect(T.rebuildReturn(returnId)).rejects.toThrow(/filed/);
    const inv = await prisma.invoice.findFirstOrThrow({ where: { orderId, docType: "INVOICE" }, include: { lines: true } });
    const goods = inv.lines.find((l) => l.description.includes("FIR-ARROZ1"))!;
    await issueCreditNote(ctx, inv.id, { lines: [{ invoiceLineId: goods.id, qty: 10 }], reason: "Damaged sacks" });
    // the filed return doesn't change…
    expect((await T.returnDetail(ctx, returnId)).items.filter((l) => l.orderId === orderId)).toHaveLength(1);
    // …the next one carries the correction
    const next = await T.openReturn(ctx, { legalEntityId: ptEntity, kind: "ARRIVALS", period: nextPeriod(NOW) });
    const corr = (await T.returnDetail(ctx, next.id)).items.filter((l) => l.orderId === orderId);
    expect(corr).toHaveLength(1);
    expect(corr[0].corrects).toBe(NOW);
    expect(Number(corr[0].value)).toBeLessThan(0);
    expect(Number(corr[0].massKg)).toBe(-10);
    expect(corr[0].source).toBe("CREDIT_STATEMENT");
  });

  it("only tax staff reopen a filed return, with a reason", async () => {
    await expect(T.reopenReturn(await ctxFor(SA), returnId, "x")).rejects.toThrow(/why/);
    await expect(T.reopenReturn(await ctxFor(KEBAB), returnId, "because")).rejects.toThrow();
    await T.reopenReturn(await ctxFor(SA), returnId, "Filed the wrong file, refiled");
    expect((await prisma.tradeReturn.findUniqueOrThrow({ where: { id: returnId } })).status).toBe("OPEN");
  });
});

describe("FIRINGI sells into a country without its own entity (exempt intra-EU supply)", () => {
  async function esBuyer(vat: string) {
    const c = await makeApprovedCompany("WHOLESALER", "ES");
    await prisma.company.update({ where: { id: c.companyId }, data: { vatNumber: vat } });
    return c.companyId;
  }
  /** A Portuguese distributor's order re-addressed to a wholesaler in Spain just before delivery: FIRINGI Portugal invoices it. */
  async function sellTo(buyerId: string) {
    const es = await prisma.country.findUniqueOrThrow({ where: { code: "ES" } });
    const offer = await offerOf("Distribuidora Atlântico, Lda", "FIR-COLA33", 24);
    return deliveredOrder(LX_BUYER, offer.id, 30, "owner@atlantico.test", async (id) => { await prisma.order.update({ where: { id }, data: { buyerCompanyId: buyerId, countryId: es.id } }); });
  }

  it("checks the buyer's VAT number at VIES, keeps the proof and invoices without VAT (M16)", async () => {
    const buyer = await esBuyer(`ESB${Date.now().toString().slice(-8)}`);
    const o = await sellTo(buyer);
    const inv = o.invoices.find((i) => i.docType === "INVOICE")!;
    expect(inv.legalEntityId).toBe(ptEntity);
    expect(inv.taxRegime).toBe("INTRA_EU_SUPPLY");
    expect(Number(inv.vatTotal)).toBe(0);
    expect(inv.lines.every((l) => Number(l.taxRate) === 0)).toBe(true);
    const m16 = await prisma.taxExemptionReason.findFirst({ where: { code: "M16", country: { code: "PT" } } });
    if (m16) expect(inv.lines.every((l) => l.exemptionReasonId === m16.id)).toBe(true);
    const proof = await prisma.vatValidation.findFirstOrThrow({ where: { companyId: buyer, invoiceId: inv.id } });
    expect(proof.result).toBe("VALID");
    expect(proof.purpose).toBe("INVOICE");
    expect((inv.recipientSnapshot as { vies?: { ref: string } }).vies?.ref).toBe(proof.consultationRef);
    // the statement from the Portuguese distributor stays domestic
    expect(o.billingStatements[0].taxRegime).toBe("DOMESTIC");
    // a second sale reuses the recent check (no new VIES call)
    const before = await prisma.vatValidation.count({ where: { companyId: buyer } });
    await sellTo(buyer);
    expect(await prisma.vatValidation.count({ where: { companyId: buyer } })).toBe(before);
    // checkout shows 0 % VAT to this buyer
    expect(await T.zeroRatedBuyer(buyer)).toBe(true);

    // dispatches and the EC Sales List
    const ctx = await ctxFor(SA);
    const dis = await T.returnDetail(ctx, (await T.openReturn(ctx, { legalEntityId: ptEntity, kind: "DISPATCHES", period: NOW })).id);
    const dl = dis.items.filter((l) => l.orderId === o.id);
    expect(dl.length).toBeGreaterThan(0);
    expect(dl[0].country).toBe("ES");
    const ecsl = await T.returnDetail(ctx, (await T.openReturn(ctx, { legalEntityId: ptEntity, kind: "ECSL", period: NOW })).id);
    const el = ecsl.items.find((l) => l.orderId === o.id)!;
    expect(el.indicator).toBe("GOODS");
    expect(Number(el.value)).toBeCloseTo(Number(inv.netTotal), 2);
    const file = await T.returnFile(ctx, ecsl.id, "national");
    expect(String(file.body)).toContain(`ES;${el.vat!.slice(2)};`);
  });

  it("charges Portuguese VAT when the number isn't valid at VIES", async () => {
    const buyer = await esBuyer(`ESB${Date.now().toString().slice(-5)}000`);
    const o = await sellTo(buyer);
    const inv = o.invoices.find((i) => i.docType === "INVOICE")!;
    expect(inv.taxRegime).toBe("DOMESTIC");
    expect(Number(inv.vatTotal)).toBeGreaterThan(0);
    expect(inv.lines.some((l) => new Decimal(l.taxRate.toString()).gt(0))).toBe(true);
    expect((await prisma.vatValidation.findFirstOrThrow({ where: { companyId: buyer, invoiceId: inv.id } })).result).toBe("INVALID");
    expect(await T.zeroRatedBuyer(buyer)).toBe(false);
  });

  it("cross-border sales can be switched off (no entity → not invoiced)", async () => {
    const ctx = await ctxFor(SA);
    await T.saveTradeSettings(ctx, { ...DEFAULT_TRADE_SETTINGS, crossBorderSales: false });
    const buyer = await esBuyer(`ESB${Date.now().toString().slice(-8)}`);
    await expect(prisma.$transaction((tx) => T.saleFor(tx, { countryId: "x", buyer: { id: buyer, vatNumber: "ESB1", country: { code: "ES", isEU: true } }, seller: { countryId: "y" } }))).rejects.toThrow(/legal entity/);
    await T.saveTradeSettings(ctx, DEFAULT_TRADE_SETTINGS);
  });
});

describe("suppliers", () => {
  it("send customs data; FIRINGI accepts (copied to the product) or rejects with a reason", async () => {
    const v = await ctxFor(IBERICAS);
    const offer = await offerOf("Distribuciones Ibéricas S.L.", "FIR-ARROZ1");
    await expect(T.proposeCustoms(v, { productId: offer.packaging.variant.productId, cnCode: "123" })).rejects.toThrow(/8 digits/);
    const p = await T.proposeCustoms(v, { productId: offer.packaging.variant.productId, packagingUnitId: offer.packagingUnitId, cnCode: "10063098", netWeightKg: 1.02, originCountryCode: "ES" });
    const list = await T.supplierCustoms(v, "es");
    expect(list.rows.find((r) => r.packagingUnitId === offer.packagingUnitId)?.proposal?.status).toBe("PENDING");
    const ctx = await ctxFor(SA);
    expect((await T.codesPage(ctx)).pending.some((x) => x.id === p.id)).toBe(true);
    await expect(T.reviewProposal(ctx, p.id, { accept: false })).rejects.toThrow(/what is wrong/);
    await T.reviewProposal(ctx, p.id, { accept: true });
    const prod = await prisma.product.findUniqueOrThrow({ where: { id: offer.packaging.variant.productId } });
    expect(prod.hsCode).toBe("10063098");
    expect(prod.cnCheckedAt).not.toBeNull();
    expect(Number((await prisma.packagingUnit.findUniqueOrThrow({ where: { id: offer.packagingUnitId } })).netWeightKg)).toBe(1.02);
    await expect(T.proposeCustoms(await ctxFor(KEBAB), { productId: prod.id, cnCode: "10063098" })).rejects.toThrow();
  });

  it("download their own report: what FIRINGI Portugal bought from them across the border", async () => {
    const v = await ctxFor(IBERICAS);
    const r = await T.supplierReport(v, NOW, "es");
    expect(r.lines.length).toBeGreaterThan(0);
    expect(r.ecsl.rows[0][1]).toBe("PT517000008");
    expect(r.intrastat.rows.some((row) => row[0] === "10063098")).toBe(true);
    const f = await T.supplierReportFile(v, NOW, "DISPATCHES", "csv", "es");
    expect(String(f.body)).toContain("10063098");
    await expect(T.supplierReport(await ctxFor(KEBAB), NOW, "pt-PT")).rejects.toThrow();
  });
});

describe("reminders, thresholds and access", () => {
  it("reminds finance before the deadline once per reminder day", async () => {
    const ctx = await ctxFor(SA);
    const r = await T.openReturn(ctx, { legalEntityId: ptEntity, kind: "ECSL", period: NOW });
    const tomorrow = new Date(Date.now() + 86400000);
    await prisma.tradeReturn.update({ where: { id: r.id }, data: { dueOn: tomorrow, remindedDays: [] } });
    const first = await T.runTradeJob();
    expect(first.reminders).toBeGreaterThanOrEqual(1);
    const row = await prisma.tradeReturn.findUniqueOrThrow({ where: { id: r.id } });
    expect(row.remindedDays).toEqual(expect.arrayContaining([1, 3, 7]));
    await T.runTradeJob();
    expect((await prisma.tradeReturn.findUniqueOrThrow({ where: { id: r.id } })).remindedDays).toEqual(row.remindedDays);
  });

  it("shows the year so far against each country's threshold", async () => {
    const th = await T.thresholds();
    const arr = th.find((t) => t.entityId === ptEntity && t.flow === "ARRIVALS")!;
    expect(arr.threshold).toBe(650000);
    expect(arr.ytd).toBeGreaterThan(0);
  });

  it("checks a partner's VAT number on demand and keeps the history", async () => {
    const ctx = await ctxFor(SA);
    const ib = await prisma.company.findFirstOrThrow({ where: { legalName: "Distribuciones Ibéricas S.L." } });
    const row = await T.recheckVat(ctx, ib.id);
    expect(row.purpose).toBe("RECHECK");
    expect((await T.viesHistory(ctx, ib.id))[0].id).toBe(row.id);
    expect((await T.viesPartners(ctx)).some((p) => p.id === ib.id)).toBe(true);
  });

  it("keeps everything for FIRINGI staff; settings are checked", async () => {
    await expect(T.tradeOverview(await ctxFor(KEBAB))).rejects.toThrow();
    await expect(T.listReturns(await ctxFor(IBERICAS))).rejects.toThrow();
    await expect(T.saveTradeSettings(await ctxFor(SA), { ...DEFAULT_TRADE_SETTINGS, defaults: { ...DEFAULT_TRADE_SETTINGS.defaults, deliveryTerms: "XX" } })).rejects.toThrow(/Incoterm/);
    const ov = await T.tradeOverview(await ctxFor(SA));
    expect(ov.returns.length).toBeGreaterThan(0);
  });
});
