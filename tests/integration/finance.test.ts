/**
 * Phase 5 checklist:
 *  - one order creates a FIRINGI sales invoice to the buyer + a linked vendor billing statement
 *  - two vendors with different commission rates are calculated correctly
 *  - a vendor promotion does not reduce FIRINGI's commission
 *  - an admin promotion records who paid for it
 * plus credit notes, vendor invoice matching, payments, reverse charge, VAT, access.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { prisma } from "@/server/db";
import { addToCart, clearCart } from "@/server/services/cart";
import { changeOrderStatus, placeOrder } from "@/server/services/orders";
import { setStock } from "@/server/services/vendor-catalogue";
import { answerPromotion, saveAdminPromotion, saveVendorPromotion, setPromotionStatus } from "@/server/services/promotions";
import { catalogueItem } from "@/server/data/catalogue-buyer";
import {
  balances, invoiceForViewer, issueCreditNote, listSalesInvoices, recordPayment, reviewVendorInvoice, statementForViewer, submitVendorInvoice, vatReport,
} from "@/server/services/finance";
import { ctxFor, pdfFile } from "../helpers";

afterAll(() => prisma.$disconnect());
const KEBAB = "owner@kebabhouse.test";
const LX_BUYER = "purchasing@lisboacentral.test";

async function offerOf(vendor: string, sku: string, units?: number) {
  return prisma.vendorOffer.findFirstOrThrow({ where: { vendor: { legalName: vendor }, packaging: { variant: { sku }, ...(units ? { unitsPerPack: units } : {}) } } });
}
async function restock(offerId: string, ownerEmail: string) {
  const v = await ctxFor(ownerEmail);
  const wh = await prisma.address.findFirstOrThrow({ where: { companyId: v.company.id, kind: { in: ["WAREHOUSE", "PICKUP"] } } });
  const cur = await prisma.stockLevel.findUnique({ where: { offerId_addressId: { offerId, addressId: wh.id } } });
  await setStock(v, offerId, wh.id, Math.max(1000, (cur?.reserved ?? 0) + 500));
}
/** Buyer orders, vendor confirms + prepares, FIRINGI / vendor delivers → invoices are issued. */
async function deliveredOrder(buyerEmail: string, offerId: string, qty: number, vendorOwner: string) {
  await restock(offerId, vendorOwner);
  const buyer = await ctxFor(buyerEmail);
  await clearCart(buyer);
  await addToCart(buyer, offerId, qty);
  const addr = await prisma.address.findFirstOrThrow({ where: { companyId: buyer.company.id, kind: "DELIVERY" } });
  const { id } = await placeOrder(buyer, { deliveryAddressId: addr.id });
  const vendor = await ctxFor(vendorOwner);
  const ops = await ctxFor("superadmin@firingi.test");
  await changeOrderStatus(vendor, id, "SUPPLIER_PROCESSING");
  await changeOrderStatus(vendor, id, "READY_FOR_PICKUP");
  for (const s of ["DISPATCHED", "OUT_FOR_DELIVERY", "DELIVERED"] as const) await changeOrderStatus(ops, id, s);
  return prisma.order.findUniqueOrThrow({ where: { id }, include: { lines: { include: { discounts: true } }, invoices: { include: { lines: true, taxSummary: true } }, billingStatements: true } });
}

beforeEach(async () => {
  await prisma.promotion.updateMany({ where: { status: "ACTIVE" }, data: { status: "ENDED" } }); // isolate promotion tests
});

describe("dual invoicing (checklist)", () => {
  it("a delivered order produces FIRINGI's sales invoice to the buyer and a linked vendor statement", async () => {
    const o = await deliveredOrder(KEBAB, (await offerOf("Grossista Lisboa Central, Lda", "FIR-MOZZ2", 1)).id, 5, "owner@lisboacentral.test");
    expect(o.invoices).toHaveLength(1);
    const inv = o.invoices[0];
    expect(inv.status).toBe("ISSUED");
    expect(inv.fullNumber).toMatch(/^FT FIR\d{4}\/\d+$/);
    expect((inv.issuerSnapshot as { name: string }).name).toBe("FIRINGI, Lda"); // FIRINGI is the seller
    expect((inv.recipientSnapshot as { name: string }).name).toBe("Kebab House Lisboa, Lda");
    expect(inv.grossTotal.toString()).toBe(o.grandTotal.toString());
    expect(inv.netTotal.toString()).toBe(o.netTotal.toString());
    expect(inv.lines.map((l) => l.description).join()).toMatch(/Entrega/); // delivery fee line
    expect(inv.atcud).toMatch(/^0-\d+$/);

    expect(o.billingStatements).toHaveLength(1);
    const st = o.billingStatements[0];
    expect(st.salesInvoiceId).toBe(inv.id); // linked by order + invoice
    expect(st.vendorCompanyId).toBe(o.sellerCompanyId);
    expect(st.expectedNet.toString()).toBe(o.vendorPayableNet.toString()); // list − commission
    expect(st.taxRegime).toBe("DOMESTIC");
    // Issued invoices are immutable.
    await expect(prisma.invoice.update({ where: { id: inv.id }, data: { grossTotal: 1 } })).rejects.toThrow(/INVOICE_IMMUTABLE/);
  });

  it("two vendors with different commission rates are calculated correctly", async () => {
    const lx = await deliveredOrder(KEBAB, (await offerOf("Grossista Lisboa Central, Lda", "FIR-FARINHA25")).id, 4, "owner@lisboacentral.test"); // 8 %
    const al = await deliveredOrder(KEBAB, (await offerOf("Cash & Carry Almada, Lda", "FIR-FARINHA25")).id, 4, "owner@ccalmada.test"); // 7 %
    const check = (o: typeof lx, rate: number) => {
      const list = o.lines.reduce((a, l) => a.plus(l.commissionBase.toString()), new Decimal(0));
      expect(o.commissionTotal.toFixed(2)).toBe(list.mul(rate).div(100).toDecimalPlaces(2).toFixed(2));
      expect(o.lines[0].commissionRate!.toNumber()).toBe(rate);
    };
    check(lx, 8);
    check(al, 7);
  });
});

describe("promotions (checklist)", () => {
  it("a vendor promotion lowers the buyer's price but NOT FIRINGI's commission", async () => {
    const lx = await ctxFor("owner@lisboacentral.test");
    const offer = await offerOf("Grossista Lisboa Central, Lda", "FIR-PIZZABOX33");
    const promo = await saveVendorPromotion(lx, { name: { en: "Box week" }, kind: "PERCENT", value: 10, validFrom: new Date(Date.now() - 1000), targets: { offerIds: [offer.id] } });
    const shown = (await catalogueItem(await ctxFor(KEBAB), offer.id)).item.price!;
    expect(shown.promotions[0]).toMatchObject({ id: promo.id, ownerType: "VENDOR" });
    expect(Number(shown.unitPriceNet)).toBeCloseTo(Number(shown.listUnitNet) * 0.9, 2);

    const o = await deliveredOrder(KEBAB, offer.id, 4, "owner@lisboacentral.test");
    const l = o.lines[0];
    const listTotal = new Decimal(l.unitListPriceNet.toString()).mul(4);
    expect(l.commissionBase.toFixed(2)).toBe(listTotal.toFixed(2)); // commission on pre-discount price
    expect(l.commissionAmount.toFixed(2)).toBe(listTotal.mul(8).div(100).toDecimalPlaces(2).toFixed(2));
    expect(Number(l.lineNet)).toBeCloseTo(listTotal.toNumber() * 0.9, 2); // buyer paid 10 % less
    expect(l.discounts).toHaveLength(1);
    expect(l.discounts[0]).toMatchObject({ promotionId: promo.id });
    expect(l.discounts[0].firingiAmount.toNumber()).toBe(0); // 100 % vendor-funded
    expect(l.discounts[0].vendorAmount.toFixed(2)).toBe(l.discounts[0].amount.toFixed(2));
    // FIRINGI's margin on the line equals its full commission.
    expect(new Decimal(l.lineNet.toString()).minus(l.vendorLineNet.toString()).toFixed(2)).toBe(l.commissionAmount.toFixed(2));
    await setPromotionStatus(lx, promo.id, "ENDED");
  });

  it("an admin promotion records who paid: split 50/50 needs the vendor's acceptance first", async () => {
    const ops = await ctxFor("superadmin@firingi.test");
    const vendorId = (await prisma.company.findFirstOrThrow({ where: { legalName: "Grossista Lisboa Central, Lda" } })).id;
    const offer = await offerOf("Grossista Lisboa Central, Lda", "FIR-KEBAB10");
    const promo = await saveAdminPromotion(ops, { name: { en: "Kebab month" }, kind: "FIXED_AMOUNT", value: 4, firingiFundPct: 50, validFrom: new Date(Date.now() - 1000), targets: { vendorIds: [vendorId] } });
    // Not yet accepted → not applied.
    expect((await catalogueItem(await ctxFor(KEBAB), offer.id)).item.price!.promotions).toEqual([]);
    await answerPromotion(await ctxFor("owner@lisboacentral.test"), promo.id, true);
    const shown = (await catalogueItem(await ctxFor(KEBAB), offer.id)).item.price!;
    expect(shown.promotions[0]).toMatchObject({ ownerType: "ADMIN", perUnit: "4.0000", firingiPerUnit: "2.0000", vendorPerUnit: "2.0000" });

    const o = await deliveredOrder(KEBAB, offer.id, 2, "owner@lisboacentral.test");
    const d = o.lines[0].discounts[0];
    expect(d.promotionId).toBe(promo.id);
    expect([d.amount, d.firingiAmount, d.vendorAmount].map((x) => x.toFixed(2))).toEqual(["8.00", "4.00", "4.00"]);
    // Vendor pays its half through a lower payout; commission still on the list price.
    const l = o.lines[0];
    expect(l.commissionBase.toFixed(2)).toBe(new Decimal(l.unitListPriceNet.toString()).mul(2).toFixed(2));
    expect(l.vendorLineNet.toFixed(2)).toBe(new Decimal(l.commissionBase.toString()).minus(4).minus(l.commissionAmount.toString()).toFixed(2));
  });

  it("a FIRINGI-funded promotion doesn't need acceptance; vendors can't create admin-style funding", async () => {
    const ops = await ctxFor("superadmin@firingi.test");
    const cat = await prisma.category.findUniqueOrThrow({ where: { slug: "rice-pasta" } });
    await saveAdminPromotion(ops, { name: { en: "Rice deal" }, kind: "PERCENT", value: 5, firingiFundPct: 100, validFrom: new Date(Date.now() - 1000), targets: { categoryIds: [cat.id] } });
    const rice = await offerOf("Grossista Lisboa Central, Lda", "FIR-ARROZ1");
    expect((await catalogueItem(await ctxFor(KEBAB), rice.id)).item.price!.promotions[0]).toMatchObject({ ownerType: "ADMIN", vendorPerUnit: "0.0000" });
    // A vendor can't target another vendor's offers.
    const other = await offerOf("Cash & Carry Almada, Lda", "FIR-ARROZ1");
    await expect(saveVendorPromotion(await ctxFor("owner@lisboacentral.test"), { name: { en: "x" }, kind: "PERCENT", value: 5, validFrom: new Date(), targets: { offerIds: [other.id] } })).rejects.toThrow(/own products/);
  });
});

describe("credit notes, vendor invoices, payments", () => {
  it("partial credit note → original partially credited + vendor credit statement; can't over-credit", async () => {
    const o = await deliveredOrder(KEBAB, (await offerOf("Grossista Lisboa Central, Lda", "FIR-MOZZ2", 1)).id, 6, "owner@lisboacentral.test");
    const inv = o.invoices[0];
    const goods = inv.lines.find((l) => l.orderLineId)!;
    const ops = await ctxFor("finance@firingi.test");
    await expect(issueCreditNote(await ctxFor(KEBAB), inv.id, { lines: "ALL", reason: "x" })).rejects.toThrow(/permission/);
    const cn = await issueCreditNote(ops, inv.id, { lines: [{ invoiceLineId: goods.id, qty: 2 }], reason: "2 blocks damaged" });
    expect(cn.docType).toBe("CREDIT_NOTE");
    expect(cn.fullNumber).toMatch(/^NC FIR/);
    expect(cn.originalInvoiceId).toBe(inv.id);
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("PARTIALLY_CREDITED");
    const credit = await prisma.vendorBillingStatement.findFirstOrThrow({ where: { orderId: o.id, isCreditStatement: true } });
    expect(credit.expectedNet.toFixed(2)).toBe(new Decimal(o.lines[0].vendorUnitCostNet.toString()).mul(2).toDecimalPlaces(2).toFixed(2));
    await expect(issueCreditNote(ops, inv.id, { lines: [{ invoiceLineId: goods.id, qty: 5 }], reason: "too many" })).rejects.toThrow(/more than was invoiced/);
  });

  it("vendor invoice: matched / disputed, duplicates refused, approval, payout", async () => {
    const o = await deliveredOrder(KEBAB, (await offerOf("Cash & Carry Almada, Lda", "FIR-MOZZ2")).id, 5, "owner@ccalmada.test");
    const st = o.billingStatements[0];
    const almada = await ctxFor("owner@ccalmada.test");
    // Wrong amount → disputed
    const bad = await submitVendorInvoice(almada, { statementIds: [st.id], docType: "INVOICE", externalNumber: `FT A/${Date.now()}`, issueDate: new Date(), netTotal: "1.00", vatTotal: "0.06", file: pdfFile() });
    expect(bad.status).toBe("DISPUTED");
    const fin = await ctxFor("finance@firingi.test");
    await reviewVendorInvoice(fin, bad.id, "REJECTED", "Amount does not match statement");
    // Right amount → matched
    const num = `FT A/${Date.now()}b`;
    const good = await submitVendorInvoice(almada, { statementIds: [st.id], docType: "INVOICE", externalNumber: num, issueDate: new Date(), netTotal: st.expectedNet.toString(), vatTotal: st.expectedVat.toString(), file: pdfFile() });
    expect(good.status).toBe("MATCHED");
    await expect(submitVendorInvoice(almada, { statementIds: [st.id], docType: "INVOICE", externalNumber: num, issueDate: new Date(), netTotal: "1", vatTotal: "0", file: pdfFile() })).rejects.toThrow();
    // Another vendor can't invoice this statement or even see it.
    await expect(statementForViewer(await ctxFor("owner@lisboacentral.test"), st.id)).rejects.toThrow(/not found/);
    // Can't pay before approval.
    await expect(recordPayment(fin, { direction: "OUTBOUND", companyId: st.vendorCompanyId, method: "BANK_TRANSFER", amount: 10, paidAt: new Date(), allocations: [{ documentId: good.id, amount: 10 }] })).rejects.toThrow(/approved/);
    await reviewVendorInvoice(fin, good.id, "APPROVED");
    await recordPayment(fin, { direction: "OUTBOUND", companyId: st.vendorCompanyId, method: "BANK_TRANSFER", amount: Number(good.grossTotal), paidAt: new Date(), allocations: [{ documentId: good.id, amount: Number(good.grossTotal) }] });
    expect((await prisma.vendorInvoice.findUniqueOrThrow({ where: { id: good.id } })).status).toBe("PAID");
    expect((await prisma.vendorBillingStatement.findUniqueOrThrow({ where: { id: st.id } })).status).toBe("CLOSED");
  });

  it("buyer payment clears the invoice; only buyer and FIRINGI can open it", async () => {
    const o = await deliveredOrder(KEBAB, (await offerOf("Grossista Lisboa Central, Lda", "FIR-COLA33", 24)).id, 5, "owner@lisboacentral.test");
    const inv = o.invoices[0];
    const kebab = await ctxFor(KEBAB);
    expect((await invoiceForViewer(kebab, inv.id)).id).toBe(inv.id);
    await expect(invoiceForViewer(await ctxFor("owner@lisboacentral.test"), inv.id)).rejects.toThrow(/not found/);
    await expect(invoiceForViewer(await ctxFor("owner@ccalmada.test"), inv.id)).rejects.toThrow(/not found/);
    const fin = await ctxFor("finance@firingi.test");
    await expect(recordPayment(fin, { direction: "INBOUND", companyId: inv.recipientCompanyId, method: "MB_WAY", amount: 1, paidAt: new Date(), allocations: [{ documentId: inv.id, amount: 5 }] })).rejects.toThrow(/exceed/);
    await recordPayment(fin, { direction: "INBOUND", companyId: inv.recipientCompanyId, method: "MULTIBANCO", amount: Number(inv.grossTotal), reference: "MB 123", paidAt: new Date(), allocations: [{ documentId: inv.id, amount: Number(inv.grossTotal) }] });
    const mine = await listSalesInvoices(kebab, { as: "BUYER" });
    expect(mine.find((i) => i.id === inv.id)!.open).toBe("0.00");
    expect((await balances(fin)).receivable.every((r) => Number(r.open) >= 0)).toBe(true);
  });

  it("cross-border distributor: statement is reverse charge (0 % VAT), FIRINGI self-assesses VAT", async () => {
    const o = await deliveredOrder(LX_BUYER, (await offerOf("Distribuciones Ibéricas S.L.", "FIR-ARROZ1")).id, 60, "owner@ibericas.test");
    const st = o.billingStatements[0];
    expect(st.taxRegime).toBe("INTRA_EU_REVERSE_CHARGE");
    expect(st.expectedVat.toNumber()).toBe(0);
    const vi = await submitVendorInvoice(await ctxFor("owner@ibericas.test"), { statementIds: [st.id], docType: "INVOICE", externalNumber: `ES-${Date.now()}`, issueDate: new Date(), netTotal: st.expectedNet.toString(), vatTotal: "0", file: pdfFile() });
    expect(vi.status).toBe("MATCHED");
    expect(vi.selfAssessedVat.toFixed(2)).toBe(new Decimal(st.expectedNet.toString()).mul(6).div(100).toDecimalPlaces(2).toFixed(2)); // rice: 6 % PT
    // The buyer (Portuguese wholesaler) still gets a normal Portuguese invoice with IVA.
    expect(o.invoices[0].vatTotal.toNumber()).toBeGreaterThan(0);
  });

  it("VAT report: output VAT net of credit notes, input VAT from vendor invoices", async () => {
    const r = await vatReport(await ctxFor("finance@firingi.test"), new Date());
    expect(Number(r.outputVat)).toBeGreaterThan(0);
    expect(r.outputByRate.some((x) => Number(x.rate) === 23)).toBe(true);
    expect(Number(r.payable)).toBeCloseTo(Number(r.outputVat) - Number(r.inputVat), 2);
  });
});
