/**
 * Invoicing — FIRINGI issues EVERY invoice to buyers; vendors invoice FIRINGI.
 *
 * When an order is delivered:
 *   1. FIRINGI issues the SALES INVOICE to the buyer (seller = FIRINGI legal entity).
 *   2. A VENDOR BILLING STATEMENT tells the vendor exactly what to invoice FIRINGI
 *      (list − vendor-funded discounts − commission; domestic VAT, or 0 % reverse
 *      charge for a vendor in another EU country). Both are linked by the order.
 * Corrections only via CREDIT NOTES (issued documents are immutable — DB trigger).
 */
import type { InvoiceDocType, Prisma, TaxRegime } from "@prisma/client";
import Decimal from "decimal.js";
import type { Tx } from "@/server/db";
import { invoiceProvider } from "./provider";

const r2 = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const PREFIX: Record<InvoiceDocType, string> = { INVOICE: "FT", INVOICE_RECEIPT: "FR", CREDIT_NOTE: "NC" };

export async function legalEntityFor(tx: Tx, countryId: string) {
  const le = await tx.legalEntity.findFirst({ where: { countryId, isActive: true } });
  if (!le) throw new Error("No FIRINGI legal entity configured for this country.");
  return le;
}

/** Gap-free number in a series (row-locked; rolls back with the transaction). */
async function takeNumber(tx: Tx, legalEntityId: string, countryId: string, docType: InvoiceDocType) {
  const year = new Date().getFullYear();
  const prefix = `${PREFIX[docType]} FIR${year}`;
  await tx.invoiceSeries.upsert({
    where: { legalEntityId_docType_prefix_year: { legalEntityId, docType, prefix, year } },
    update: {},
    create: { legalEntityId, countryId, docType, prefix, year },
  });
  const rows = await tx.$queryRaw<{ id: string; n: number; code: string | null }[]>`
    UPDATE "InvoiceSeries" SET "nextNumber" = "nextNumber" + 1
    WHERE "legalEntityId" = ${legalEntityId} AND "docType" = ${docType}::"InvoiceDocType" AND prefix = ${prefix} AND year = ${year}
    RETURNING id, "nextNumber" - 1 AS n, "atcudValidationCode" AS code`;
  return { seriesId: rows[0].id, number: Number(rows[0].n), fullNumber: `${prefix}/${rows[0].n}`, validationCode: rows[0].code };
}

async function previousHash(tx: Tx, seriesId: string) {
  return (await tx.invoice.findFirst({ where: { seriesId, status: { not: "DRAFT" } }, orderBy: { number: "desc" }, select: { hash: true } }))?.hash ?? null;
}

type DraftLine = { orderLineId?: string | null; description: string; qty: Decimal; unitPriceNet: Decimal; discountNet?: Decimal; taxRate: Decimal; saftTaxCode?: string | null; lineNet: Decimal; lineVat: Decimal };

/** Create the document as DRAFT, add lines + tax summary, then issue it (number, hash, ATCUD). */
async function issueDocument(tx: Tx, d: {
  legalEntityId: string; countryId: string; docType: InvoiceDocType; taxRegime: TaxRegime; recipientCompanyId: string; orderId: string | null;
  originalInvoiceId?: string | null; issuerSnapshot: Prisma.InputJsonValue; recipientSnapshot: Prisma.InputJsonValue & { taxId?: string; country?: string };
  lines: DraftLine[]; dueDays: number; createdById: string | null;
}) {
  const net = r2(d.lines.reduce((a, l) => a.plus(l.lineNet), new Decimal(0)));
  const vat = r2(d.lines.reduce((a, l) => a.plus(l.lineVat), new Decimal(0)));
  const draft = await tx.invoice.create({
    data: {
      legalEntityId: d.legalEntityId, docType: d.docType, status: "DRAFT", taxRegime: d.taxRegime, recipientCompanyId: d.recipientCompanyId, orderId: d.orderId,
      originalInvoiceId: d.originalInvoiceId ?? null, issuerSnapshot: d.issuerSnapshot, recipientSnapshot: d.recipientSnapshot,
      netTotal: net.toFixed(2), vatTotal: vat.toFixed(2), grossTotal: net.plus(vat).toFixed(2), createdById: d.createdById,
    },
  });
  await tx.invoiceLine.createMany({
    data: d.lines.map((l, i) => ({
      invoiceId: draft.id, orderLineId: l.orderLineId ?? null, position: i + 1, description: l.description, qty: l.qty.toFixed(3), unitPriceNet: l.unitPriceNet.toFixed(4),
      discountNet: (l.discountNet ?? new Decimal(0)).toFixed(2), taxRate: l.taxRate.toFixed(3), saftTaxCode: l.saftTaxCode ?? null, lineNet: l.lineNet.toFixed(2), lineVat: l.lineVat.toFixed(2),
    })),
  });
  const byRate = new Map<string, { base: Decimal; vat: Decimal }>();
  for (const l of d.lines) {
    const k = l.taxRate.toFixed(3);
    const cur = byRate.get(k) ?? { base: new Decimal(0), vat: new Decimal(0) };
    byRate.set(k, { base: cur.base.plus(l.lineNet), vat: cur.vat.plus(l.lineVat) });
  }
  await tx.invoiceTaxSummary.createMany({ data: [...byRate].map(([rate, v]) => ({ invoiceId: draft.id, taxRate: rate, base: r2(v.base).toFixed(2), vat: r2(v.vat).toFixed(2) })) });

  const issuer = d.issuerSnapshot as { taxId: string };
  const num = await takeNumber(tx, d.legalEntityId, d.countryId, d.docType);
  const issuedAt = new Date();
  const fiscal = await invoiceProvider().issue({
    docType: d.docType, fullNumber: num.fullNumber, number: num.number, seriesValidationCode: num.validationCode, issuedAt,
    issuerTaxId: issuer.taxId, recipientTaxId: d.recipientSnapshot.taxId ?? "999999990", recipientCountry: d.recipientSnapshot.country ?? "PT",
    netTotal: net.toFixed(2), vatTotal: vat.toFixed(2), grossTotal: net.plus(vat).toFixed(2), previousHash: await previousHash(tx, num.seriesId),
  });
  return tx.invoice.update({
    where: { id: draft.id },
    data: {
      status: "ISSUED", seriesId: num.seriesId, number: num.number, fullNumber: num.fullNumber, issuedAt, dueAt: new Date(issuedAt.getTime() + d.dueDays * 86400000),
      atcud: fiscal.atcud, hash: fiscal.hash, previousHash: await previousHash(tx, num.seriesId), qrPayload: fiscal.qrPayload, externalProvider: fiscal.provider, externalId: fiscal.externalId,
    },
  });
}

function companySnapshot(c: { legalName: string; tradeName: string | null; taxId: string; vatNumber: string | null; email: string; country: { code: string } }, addr: { line1: string; line2: string | null; postalCode: string; cityName: string } | null) {
  return { name: c.legalName, tradeName: c.tradeName, taxId: c.taxId, vatNumber: c.vatNumber, email: c.email, country: c.country.code, address: addr ? `${addr.line1}${addr.line2 ? `, ${addr.line2}` : ""}, ${addr.postalCode} ${addr.cityName}` : null };
}

async function billingAddress(tx: Tx, companyId: string) {
  return (await tx.address.findFirst({ where: { companyId, isActive: true, kind: "BILLING" }, orderBy: { isDefault: "desc" } })) ??
    (await tx.address.findFirst({ where: { companyId, isActive: true, kind: "HEAD_OFFICE" } }));
}

const pick = (v: unknown) => { const o = v as Record<string, string>; return o.pt ?? o.en ?? ""; };

/**
 * Issue FIRINGI's sales invoice and the vendor billing statement for a delivered order.
 * Idempotent: returns the existing pair if already issued.
 */
export async function invoiceDeliveredOrder(tx: Tx, orderId: string, actorUserId: string | null) {
  const existing = await tx.invoice.findFirst({ where: { orderId, docType: "INVOICE", status: { not: "DRAFT" } } });
  if (existing) return { invoice: existing, statement: await tx.vendorBillingStatement.findFirst({ where: { orderId, isCreditStatement: false } }) };

  const order = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { lines: true, buyer: { include: { country: true } }, seller: { include: { country: true } }, deliveryRule: true },
  });
  const le = await legalEntityFor(tx, order.countryId);
  const leCountry = await tx.country.findUniqueOrThrow({ where: { id: le.countryId } });
  const lines: DraftLine[] = [];
  for (const l of order.lines) {
    const qty = l.qtyDelivered ?? l.qtyConfirmed ?? l.qtyOrdered;
    if (qty <= 0) continue;
    lines.push({
      orderLineId: l.id, description: `${pick(l.productName)} — ${pick(l.packagingName)} (SKU ${l.sku})`, qty: new Decimal(qty), unitPriceNet: new Decimal(l.unitListPriceNet.toString()),
      discountNet: new Decimal(l.unitListPriceNet.toString()).minus(l.unitSalePriceNet.toString()).mul(qty), taxRate: new Decimal(l.taxRate.toString()),
      lineNet: new Decimal(l.lineNet.toString()), lineVat: new Decimal(l.lineVat.toString()),
    });
  }
  const goodsVat = lines.reduce((a, l) => a.plus(l.lineVat), new Decimal(0));
  if (order.deliveryFeeNet.gt(0)) {
    const fee = new Decimal(order.deliveryFeeNet.toString());
    const feeVat = r2(new Decimal(order.vatTotal.toString()).minus(goodsVat)); // exactly what the buyer was charged
    // Rate of the fee's tax category in the delivery region (e.g. 23 % mainland PT).
    const regionId = (order.deliveryAddress as { regionId?: string | null }).regionId ?? null;
    const rates = order.deliveryRule?.feeTaxCategoryId
      ? await tx.taxRate.findMany({ where: { countryId: order.countryId, taxCategoryId: order.deliveryRule.feeTaxCategoryId, validTo: null }, orderBy: { validFrom: "desc" } })
      : [];
    const rate = (rates.find((r) => regionId && r.regionId === regionId) ?? rates.find((r) => r.regionId === null))?.rate.toString() ?? "0";
    lines.push({ description: "Entrega (FIRINGI)", qty: new Decimal(1), unitPriceNet: fee, taxRate: new Decimal(rate), lineNet: fee, lineVat: feeVat });
  }
  const buyerAddr = await billingAddress(tx, order.buyerCompanyId);
  const invoice = await issueDocument(tx, {
    legalEntityId: le.id, countryId: le.countryId, docType: "INVOICE", taxRegime: "DOMESTIC", recipientCompanyId: order.buyerCompanyId, orderId,
    issuerSnapshot: { name: le.legalName, taxId: le.taxId, vatNumber: le.vatNumber, address: `${le.addressLine}, ${le.postalCode} ${le.city}`, email: le.email, iban: le.iban, country: leCountry.code },
    recipientSnapshot: companySnapshot(order.buyer, buyerAddr),
    lines, dueDays: order.buyer.paymentTermsDays, createdById: actorUserId,
  });

  // What the vendor must invoice FIRINGI.
  const crossBorder = order.seller.countryId !== le.countryId;
  const regime: TaxRegime = crossBorder ? "INTRA_EU_REVERSE_CHARGE" : "DOMESTIC";
  const stLines = order.lines.filter((l) => (l.qtyDelivered ?? l.qtyConfirmed ?? l.qtyOrdered) > 0).map((l) => {
    const net = new Decimal(l.vendorLineNet.toString());
    const rate = crossBorder ? new Decimal(0) : new Decimal(l.taxRate.toString());
    return { orderLineId: l.id, sku: l.sku, description: `${pick(l.productName)} — ${pick(l.packagingName)}`, qty: l.qtyDelivered ?? l.qtyConfirmed ?? l.qtyOrdered,
      unitCostNet: l.vendorUnitCostNet.toString(), lineNet: net.toFixed(2), taxRate: rate.toFixed(3), vat: r2(net.mul(rate).div(100)).toFixed(2), commission: l.commissionAmount.toString() };
  });
  const expNet = stLines.reduce((a, l) => a.plus(l.lineNet), new Decimal(0));
  const expVat = stLines.reduce((a, l) => a.plus(l.vat), new Decimal(0));
  const year = new Date().getFullYear();
  const seq = await tx.$queryRaw<{ n: number }[]>`INSERT INTO "Sequence" (name, year, "nextValue") VALUES ('statement', ${year}, 2)
    ON CONFLICT (name, year) DO UPDATE SET "nextValue" = "Sequence"."nextValue" + 1 RETURNING "nextValue" - 1 AS n`;
  const statement = await tx.vendorBillingStatement.create({
    data: {
      number: `VBS-${year}-${String(seq[0].n).padStart(6, "0")}`, vendorCompanyId: order.sellerCompanyId, orderId, salesInvoiceId: invoice.id, taxRegime: regime,
      expectedNet: expNet.toFixed(2), expectedVat: expVat.toFixed(2), expectedGross: expNet.plus(expVat).toFixed(2), commissionTotal: order.commissionTotal.toString(), lines: stLines,
    },
  });
  return { invoice, statement };
}

/**
 * Credit note on a sales invoice — whole invoice, or chosen quantities per line. Also
 * creates a CREDIT billing statement so the vendor issues its own credit note to FIRINGI.
 */
export async function creditInvoice(tx: Tx, invoiceId: string, sel: { lines: { invoiceLineId: string; qty: number }[] | "ALL"; reason: string; actorUserId: string }) {
  const inv = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { lines: true, creditNotes: { include: { lines: true } }, order: { include: { lines: true, seller: true } } } });
  if (inv.docType === "CREDIT_NOTE" || inv.status === "DRAFT" || inv.status === "CREDITED") throw new Error("NOT_CREDITABLE");
  const credited = new Map<string, Decimal>(); // invoice line position → qty already credited
  for (const cn of inv.creditNotes) for (const l of cn.lines) credited.set(l.description, (credited.get(l.description) ?? new Decimal(0)).plus(l.qty.toString()));
  const wanted = sel.lines === "ALL" ? inv.lines.map((l) => ({ invoiceLineId: l.id, qty: Number(l.qty) - Number(credited.get(l.description) ?? 0) })) : sel.lines;
  const lines: DraftLine[] = [];
  const vendorLines: { orderLineId: string; qty: number }[] = [];
  for (const w of wanted) {
    const l = inv.lines.find((x) => x.id === w.invoiceLineId);
    if (!l) throw new Error("UNKNOWN_LINE");
    const remaining = new Decimal(l.qty.toString()).minus(credited.get(l.description) ?? 0);
    if (w.qty <= 0) continue;
    if (remaining.lt(w.qty)) throw new Error(`QTY_TOO_HIGH:${l.description}`);
    const f = new Decimal(w.qty).div(l.qty.toString());
    lines.push({ orderLineId: l.orderLineId, description: l.description, qty: new Decimal(w.qty), unitPriceNet: new Decimal(l.unitPriceNet.toString()), discountNet: r2(new Decimal(l.discountNet.toString()).mul(f)),
      taxRate: new Decimal(l.taxRate.toString()), lineNet: r2(new Decimal(l.lineNet.toString()).mul(f)), lineVat: r2(new Decimal(l.lineVat.toString()).mul(f)) });
    if (l.orderLineId) vendorLines.push({ orderLineId: l.orderLineId, qty: w.qty });
  }
  if (!lines.length) throw new Error("NOTHING_TO_CREDIT");
  const cn = await issueDocument(tx, {
    legalEntityId: inv.legalEntityId, countryId: (await tx.legalEntity.findUniqueOrThrow({ where: { id: inv.legalEntityId } })).countryId, docType: "CREDIT_NOTE",
    taxRegime: inv.taxRegime, recipientCompanyId: inv.recipientCompanyId, orderId: inv.orderId, originalInvoiceId: inv.id,
    issuerSnapshot: inv.issuerSnapshot as Prisma.InputJsonValue, recipientSnapshot: { ...(inv.recipientSnapshot as object), reason: sel.reason } as Prisma.InputJsonValue,
    lines, dueDays: 0, createdById: sel.actorUserId,
  });
  // Fully credited?
  const totalQty = inv.lines.reduce((a, l) => a + Number(l.qty), 0);
  const creditedQty = [...credited.values()].reduce((a, v) => a + v.toNumber(), 0) + lines.reduce((a, l) => a + l.qty.toNumber(), 0);
  await tx.invoice.update({ where: { id: inv.id }, data: { status: creditedQty >= totalQty ? "CREDITED" : "PARTIALLY_CREDITED" } });

  // Vendor side: credit statement for the goods returned.
  if (inv.order && vendorLines.length) {
    const stLines = vendorLines.map((v) => {
      const ol = inv.order!.lines.find((x) => x.id === v.orderLineId)!;
      const delivered = ol.qtyDelivered ?? ol.qtyConfirmed ?? ol.qtyOrdered;
      const net = r2(new Decimal(ol.vendorLineNet.toString()).mul(v.qty).div(delivered));
      const st = inv.taxRegime === "DOMESTIC" && inv.order!.seller.countryId === inv.order!.countryId ? new Decimal(ol.taxRate.toString()) : new Decimal(0);
      return { orderLineId: ol.id, sku: ol.sku, description: `${pick(ol.productName)} — ${pick(ol.packagingName)}`, qty: v.qty, unitCostNet: ol.vendorUnitCostNet.toString(), lineNet: net.toFixed(2), taxRate: st.toFixed(3), vat: r2(net.mul(st).div(100)).toFixed(2) };
    });
    const n = stLines.reduce((a, l) => a.plus(l.lineNet), new Decimal(0));
    const v = stLines.reduce((a, l) => a.plus(l.vat), new Decimal(0));
    const year = new Date().getFullYear();
    const seq = await tx.$queryRaw<{ n: number }[]>`INSERT INTO "Sequence" (name, year, "nextValue") VALUES ('statement', ${year}, 2)
      ON CONFLICT (name, year) DO UPDATE SET "nextValue" = "Sequence"."nextValue" + 1 RETURNING "nextValue" - 1 AS n`;
    const orig = await tx.vendorBillingStatement.findFirst({ where: { orderId: inv.orderId!, isCreditStatement: false } });
    await tx.vendorBillingStatement.create({
      data: {
        number: `VBS-${year}-${String(seq[0].n).padStart(6, "0")}`, vendorCompanyId: inv.order.sellerCompanyId, orderId: inv.orderId!, salesInvoiceId: cn.id, isCreditStatement: true,
        taxRegime: orig?.taxRegime ?? "DOMESTIC", expectedNet: n.toFixed(2), expectedVat: v.toFixed(2), expectedGross: n.plus(v).toFixed(2), commissionTotal: 0, lines: stLines,
      },
    });
  }
  return cn;
}
