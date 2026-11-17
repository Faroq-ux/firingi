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
import { invoiceWeightText } from "@/server/catchweight/service";
import type { Tx } from "@/server/db";
import { invoiceProvider } from "./provider";
import { usesMoloni } from "./fiscal";

const r2 = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const PREFIX: Record<InvoiceDocType, string> = { INVOICE: "FT", INVOICE_RECEIPT: "FR", CREDIT_NOTE: "NC" };

export async function legalEntityFor(tx: Tx, countryId: string) {
  const le = await tx.legalEntity.findFirst({ where: { countryId, isActive: true } });
  if (!le) throw new Error("No FIRINGI legal entity configured for this country.");
  return le;
}

/** Gap-free number in a series (row-locked; rolls back with the transaction). */
async function takeNumber(tx: Tx, legalEntityId: string, countryId: string, docType: InvoiceDocType, reference = false) {
  const year = new Date().getFullYear();
  // Documents issued at Moloni get Moloni's legal number; FIRINGI then only needs its own
  // reference, from a separate series so its fiscal series stays gap-free and hash-chained.
  const prefix = `${PREFIX[docType]}${reference ? "-REF" : ""} FIR${year}`;
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
  const viaMoloni = await usesMoloni(tx);
  const num = await takeNumber(tx, d.legalEntityId, d.countryId, d.docType, viaMoloni);
  const issuedAt = new Date();
  if (viaMoloni) {
    // Booked now (FIRINGI reference, totals, balances); the legal document is issued at Moloni by
    // the fiscal queue right after this transaction commits (see fiscal.ts).
    return issued(tx, await tx.invoice.update({
      where: { id: draft.id },
      data: { status: "ISSUED", seriesId: num.seriesId, number: num.number, fullNumber: num.fullNumber, issuedAt, dueAt: new Date(issuedAt.getTime() + d.dueDays * 86400000), externalProvider: "moloni", fiscalStatus: "PENDING" },
    }));
  }
  const fiscal = await invoiceProvider().issue({
    docType: d.docType, fullNumber: num.fullNumber, number: num.number, seriesValidationCode: num.validationCode, issuedAt,
    issuerTaxId: issuer.taxId, recipientTaxId: d.recipientSnapshot.taxId ?? "999999990", recipientCountry: d.recipientSnapshot.country ?? "PT",
    netTotal: net.toFixed(2), vatTotal: vat.toFixed(2), grossTotal: net.plus(vat).toFixed(2), previousHash: await previousHash(tx, num.seriesId),
  });
  return issued(tx, await tx.invoice.update({
    where: { id: draft.id },
    data: {
      status: "ISSUED", seriesId: num.seriesId, number: num.number, fullNumber: num.fullNumber, issuedAt, dueAt: new Date(issuedAt.getTime() + d.dueDays * 86400000),
      atcud: fiscal.atcud, hash: fiscal.hash, previousHash: await previousHash(tx, num.seriesId), qrPayload: fiscal.qrPayload, externalProvider: fiscal.provider, externalId: fiscal.externalId,
    },
  }));
}

/** Webhook "invoice.issued" for the recipient (same transaction). */
async function issued<T extends { id: string; recipientCompanyId: string; fullNumber: string | null; docType: string; orderId: string | null; grossTotal: { toString(): string }; dueAt: Date | null }>(tx: Tx, inv: T): Promise<T> {
  const { emitWebhook } = await import("@/server/integrations/webhooks");
  await emitWebhook(tx, inv.recipientCompanyId, "invoice.issued", { invoiceId: inv.id, number: inv.fullNumber, docType: inv.docType, orderId: inv.orderId, total: inv.grossTotal.toString(), dueAt: inv.dueAt?.toISOString() ?? null });
  return inv;
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
    // Phase 41: a weighed line keeps its units; price per unit = its billed weight's share, weight and €/kg in the text
    const f = l.cwBilledKg != null && l.cwNominalKg ? new Decimal(l.cwBilledKg.toString()).div(l.cwNominalKg.toString()).div(qty) : new Decimal(1);
    const unitPriceNet = new Decimal(l.unitListPriceNet.toString()).mul(f).toDecimalPlaces(4);
    const lineNet = new Decimal(l.lineNet.toString());
    lines.push({
      orderLineId: l.id, description: `${pick(l.productName)} — ${pick(l.packagingName)} (SKU ${l.sku})${invoiceWeightText(l)}`, qty: new Decimal(qty), unitPriceNet,
      // weighed: the discount takes the rounding, so qty × price − discount is exactly the line (as the fiscal provider recomputes it)
      discountNet: f.eq(1) ? new Decimal(l.unitListPriceNet.toString()).minus(l.unitSalePriceNet.toString()).mul(qty) : Decimal.max(0, r2(unitPriceNet.mul(qty).minus(lineNet))),
      taxRate: new Decimal(l.taxRate.toString()), lineNet, lineVat: new Decimal(l.lineVat.toString()),
    });
  }
  const goodsVat = lines.reduce((a, l) => a.plus(l.lineVat), new Decimal(0));
  // Rate of the fee's tax category in the delivery region (e.g. 23 % mainland PT).
  const feeTaxRate = async () => {
    const regionId = (order.deliveryAddress as { regionId?: string | null }).regionId ?? null;
    const rates = order.deliveryRule?.feeTaxCategoryId
      ? await tx.taxRate.findMany({ where: { countryId: order.countryId, taxCategoryId: order.deliveryRule.feeTaxCategoryId, validTo: null }, orderBy: { validFrom: "desc" } })
      : [];
    return new Decimal((rates.find((r) => regionId && r.regionId === regionId) ?? rates.find((r) => r.regionId === null))?.rate.toString() ?? "0");
  };
  if (order.deliveryFeeNet.gt(0)) {
    const fee = new Decimal(order.deliveryFeeNet.toString());
    const feeVat = r2(new Decimal(order.vatTotal.toString()).minus(goodsVat)); // exactly what the buyer was charged
    lines.push({ description: order.deliveryMode === "FIRINGI_FLEET" ? "Entrega (FIRINGI)" : "Entrega (taxa fixa do fornecedor)", qty: new Decimal(1), unitPriceNet: fee, taxRate: await feeTaxRate(), lineNet: fee, lineVat: feeVat });
  }
  // Phase 40: deposits on returnables (crates, kegs, gas cylinders…) — after the goods and the fee
  const { invoiceDeposits } = await import("@/server/returnables/service");
  const deposits = await invoiceDeposits(tx, orderId, {
    buyerCompanyId: order.buyerCompanyId, sellerCompanyId: order.sellerCompanyId, countryCode: order.buyer.country.code,
    crossBorder: order.seller.countryId !== le.countryId, goodsRates: order.lines.map((l) => Number(l.taxRate)), userId: actorUserId,
  });
  lines.push(...deposits.invoiceLines);
  const buyerAddr = await billingAddress(tx, order.buyerCompanyId);
  const invoice = await issueDocument(tx, {
    legalEntityId: le.id, countryId: le.countryId, docType: "INVOICE", taxRegime: "DOMESTIC", recipientCompanyId: order.buyerCompanyId, orderId,
    issuerSnapshot: { name: le.legalName, taxId: le.taxId, vatNumber: le.vatNumber, address: `${le.addressLine}, ${le.postalCode} ${le.city}`, email: le.email, iban: le.iban, country: leCountry.code },
    recipientSnapshot: companySnapshot(order.buyer, buyerAddr),
    lines, dueDays: order.buyer.paymentTermsDays, createdById: actorUserId,
  });

  // What the vendor must invoice FIRINGI.
  const crossBorder = order.seller.countryId !== le.countryId;
  if (crossBorder) {
    // Intra-EU reverse charge only. Non-EU Schengen sellers (NO, CH, IS, LI) need customs /
    // import handling, which does not exist yet — their markets stay closed until then.
    const sellerCountry = await tx.country.findUniqueOrThrow({ where: { id: order.seller.countryId }, select: { isEU: true, code: true } });
    if (!sellerCountry.isEU) throw new Error(`NON_EU_SELLER_NOT_SUPPORTED:${sellerCountry.code}`);
  }
  const regime: TaxRegime = crossBorder ? "INTRA_EU_REVERSE_CHARGE" : "DOMESTIC";
  const stLines = order.lines.filter((l) => (l.qtyDelivered ?? l.qtyConfirmed ?? l.qtyOrdered) > 0).map((l) => {
    const net = new Decimal(l.vendorLineNet.toString());
    const rate = crossBorder ? new Decimal(0) : new Decimal(l.taxRate.toString());
    return { orderLineId: l.id as string | null, sku: l.sku, description: `${pick(l.productName)} — ${pick(l.packagingName)}${l.cwBilledKg != null ? ` · ${new Decimal(l.cwBilledKg.toString()).toFixed(3).replace(".", ",")} kg` : ""}`, qty: l.qtyDelivered ?? l.qtyConfirmed ?? l.qtyOrdered,
      unitCostNet: l.vendorUnitCostNet.toString(), lineNet: net.toFixed(2), taxRate: rate.toFixed(3), vat: r2(net.mul(rate).div(100)).toFixed(2), commission: l.commissionAmount.toString() };
  });
  // Supplier's own flat delivery rate (distributor → wholesaler): FIRINGI invoiced it to the buyer and pays it on
  // — also when a FIRINGI-paid free-delivery offer waived it for the buyer (deliveryDiscountNet).
  const vendorFee = new Decimal(order.deliveryFeeNet.toString()).plus(order.deliveryDiscountNet.toString());
  if (order.deliveryMode !== "FIRINGI_FLEET" && vendorFee.gt(0)) {
    const fee = vendorFee;
    const buyerRate = await feeTaxRate();
    const feeRate = crossBorder ? new Decimal(0) : buyerRate;
    stLines.push({
      orderLineId: null, sku: "DELIVERY", description: "Entrega (taxa fixa)", qty: 1, unitCostNet: fee.toFixed(4), lineNet: fee.toFixed(2),
      taxRate: feeRate.toFixed(3), vat: r2(fee.mul(feeRate).div(100)).toFixed(2), commission: "0",
      ...(crossBorder ? { selfAssessRate: buyerRate.toFixed(3) } : {}),
    });
  }
  stLines.push(...deposits.statementLines); // deposits pass through: the supplier charges FIRINGI the same
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
 * creates a CREDIT billing statement so the vendor issues its own credit note to FIRINGI
 * (unless `chargeVendor` is false — FIRINGI then carries the cost).
 */
export async function creditInvoice(tx: Tx, invoiceId: string, sel: { lines: { invoiceLineId: string; qty: number }[] | "ALL"; reason: string; actorUserId: string; chargeVendor?: boolean }) {
  const inv = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { lines: true, creditNotes: { include: { lines: true } }, order: { include: { lines: true, seller: true } } } });
  if (inv.docType === "CREDIT_NOTE" || inv.status === "DRAFT" || inv.status === "CREDITED") throw new Error("NOT_CREDITABLE");
  const credited = new Map<string, Decimal>(); // invoice line position → qty already credited
  for (const cn of inv.creditNotes) for (const l of cn.lines) if (!l.description.startsWith(REBATE_PREFIX)) credited.set(l.description, (credited.get(l.description) ?? new Decimal(0)).plus(l.qty.toString()));
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

  let creditStatementId: string | null = null;
  // Vendor side: credit statement for the goods returned (not when FIRINGI carries the cost, e.g. a claim for a FIRINGI delivery fault).
  if (inv.order && vendorLines.length && sel.chargeVendor !== false) {
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
    creditStatementId = (await tx.vendorBillingStatement.create({
      data: {
        number: `VBS-${year}-${String(seq[0].n).padStart(6, "0")}`, vendorCompanyId: inv.order.sellerCompanyId, orderId: inv.orderId!, salesInvoiceId: cn.id, isCreditStatement: true,
        taxRegime: orig?.taxRegime ?? "DOMESTIC", expectedNet: n.toFixed(2), expectedVat: v.toFixed(2), expectedGross: n.plus(v).toFixed(2), commissionTotal: 0, lines: stLines,
      },
    })).id;
  }
  return Object.assign(cn, { creditStatementId });
}


/** Lines of loyalty rebate credit notes start with this (they credit money, not goods). */
export const REBATE_PREFIX = "Desconto por pontos de fidelização";

/**
 * Phase 32: a rebate credit note — loyalty points turned into credit on an invoice. No goods come
 * back (no order lines, no supplier credit statement): the amount (incl. VAT) is split over the
 * invoice's VAT rates in proportion to their value, so VAT is corrected the same way. FIRINGI pays.
 */
export async function rebateCreditNote(tx: Tx, invoiceId: string, r: { gross: Decimal; description: string; reason: string; actorUserId: string }) {
  const inv = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { lines: true } });
  if (inv.docType === "CREDIT_NOTE" || inv.status === "DRAFT" || inv.status === "CREDITED") throw new Error("NOT_CREDITABLE");
  const byRate = new Map<string, Decimal>(); // VAT rate → gross of the invoice at that rate
  for (const l of inv.lines) {
    const k = new Decimal(l.taxRate.toString()).toFixed(3);
    byRate.set(k, (byRate.get(k) ?? new Decimal(0)).plus(l.lineNet.toString()).plus(l.lineVat.toString()));
  }
  const total = [...byRate.values()].reduce((a, v) => a.plus(v), new Decimal(0));
  if (total.lte(0) || r.gross.gt(total)) throw new Error("REBATE_TOO_HIGH");
  const entries = [...byRate.entries()].filter(([, v]) => v.gt(0));
  let given = new Decimal(0);
  const lines: DraftLine[] = entries.map(([rate, v], i) => {
    const gross = i === entries.length - 1 ? r.gross.minus(given) : r2(r.gross.mul(v).div(total));
    given = given.plus(gross);
    const rt = new Decimal(rate);
    const net = r2(gross.div(rt.div(100).plus(1)));
    return { orderLineId: null, description: entries.length > 1 ? `${r.description} (${rt.toFixed(0)} %)` : r.description, qty: new Decimal(1), unitPriceNet: net, taxRate: rt, lineNet: net, lineVat: gross.minus(net) };
  });
  return issueDocument(tx, {
    legalEntityId: inv.legalEntityId, countryId: (await tx.legalEntity.findUniqueOrThrow({ where: { id: inv.legalEntityId } })).countryId, docType: "CREDIT_NOTE",
    taxRegime: inv.taxRegime, recipientCompanyId: inv.recipientCompanyId, orderId: inv.orderId, originalInvoiceId: inv.id,
    issuerSnapshot: inv.issuerSnapshot as Prisma.InputJsonValue, recipientSnapshot: { ...(inv.recipientSnapshot as object), reason: r.reason } as Prisma.InputJsonValue,
    lines, dueDays: 0, createdById: r.actorUserId,
  });
}

/**
 * Phase 34: FIRINGI invoices a supplier for a service (advertising). B2B services are taxed where the
 * supplier is: FIRINGI's entity in that country invoices with its standard VAT rate; with no entity
 * there, the main entity invoices under the EU reverse charge (0 %, the supplier accounts for the VAT).
 * Lines are net amounts. `docType` INVOICE_RECEIPT when it is already paid (prepaid top-up).
 */
export async function issueServiceInvoice(tx: Tx, s: {
  recipientCompanyId: string; docType: "INVOICE" | "INVOICE_RECEIPT"; lines: { description: string; net: Decimal }[]; dueDays: number; actorUserId: string | null;
}) {
  const co = await tx.company.findUniqueOrThrow({ where: { id: s.recipientCompanyId }, include: { country: true } });
  let le = await tx.legalEntity.findFirst({ where: { countryId: co.countryId, isActive: true } });
  let regime: TaxRegime = "DOMESTIC";
  if (!le) {
    const def = (await tx.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: "marketplace.defaultCountry" } }))?.value as string | undefined;
    le = await tx.legalEntity.findFirst({ where: { isActive: true, ...(def ? { country: { code: def } } : {}) } }) ?? await tx.legalEntity.findFirst({ where: { isActive: true } });
    if (!le) throw new Error("No FIRINGI legal entity configured.");
    if (!co.country.isEU) throw new Error(`NON_EU_RECIPIENT_NOT_SUPPORTED:${co.country.code}`);
    regime = "INTRA_EU_REVERSE_CHARGE";
  }
  const leCountry = await tx.country.findUniqueOrThrow({ where: { id: le.countryId } });
  let rate = new Decimal(0);
  if (regime === "DOMESTIC") {
    const r = await tx.taxRate.findFirst({ where: { countryId: le.countryId, regionId: null, taxCategory: { code: "STANDARD" }, validFrom: { lte: new Date() }, OR: [{ validTo: null }, { validTo: { gte: new Date() } }] }, orderBy: { validFrom: "desc" } });
    rate = new Decimal(r?.rate.toString() ?? "0");
  }
  const lines: DraftLine[] = s.lines.filter((l) => l.net.gt(0)).map((l) => {
    const net = r2(l.net);
    return { description: l.description, qty: new Decimal(1), unitPriceNet: net, taxRate: rate, lineNet: net, lineVat: r2(net.mul(rate).div(100)) };
  });
  if (!lines.length) throw new Error("NOTHING_TO_INVOICE");
  const addr = await billingAddress(tx, co.id);
  return issueDocument(tx, {
    legalEntityId: le.id, countryId: le.countryId, docType: s.docType, taxRegime: regime, recipientCompanyId: co.id, orderId: null,
    issuerSnapshot: { name: le.legalName, taxId: le.taxId, vatNumber: le.vatNumber, address: `${le.addressLine}, ${le.postalCode} ${le.city}`, email: le.email, iban: le.iban, country: leCountry.code },
    recipientSnapshot: { ...companySnapshot(co, addr), ...(regime === "INTRA_EU_REVERSE_CHARGE" ? { note: "Autoliquidação — reverse charge (art. 196.º Diretiva IVA)" } : {}) },
    lines, dueDays: s.dueDays, createdById: s.actorUserId,
  });
}
