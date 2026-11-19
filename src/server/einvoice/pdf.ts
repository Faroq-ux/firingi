/**
 * Phase 46 — the self-billed supplier invoice as a PDF (issued by FIRINGI in the supplier's name, in the supplier's
 * language). Rendered when asked for (and archived with the e-invoice when one is sent).
 */
import "server-only";
import { prisma } from "@/server/db";
import { renderInvoicePdf, type InvoicePdfData } from "@/server/pdf/documents";
import { countryLegalTexts } from "./doc-i18n";
import { statementEDoc } from "./model";

export async function selfBilledPdfData(statementId: string): Promise<InvoicePdfData> {
  const { doc } = await statementEDoc(statementId);
  const st = await prisma.vendorBillingStatement.findUniqueOrThrow({ where: { id: statementId }, select: { taxRegime: true, isCreditStatement: true, vendor: { select: { einvoiceProfile: { select: { selfBillingAgreement: true } } } } } });
  const party = (p: typeof doc.seller) => ({ name: p.name, taxId: p.taxId ?? "", vatNumber: p.vatId, address: [p.street, [p.postalCode, p.city].filter(Boolean).join(" ")].filter(Boolean).join(", "), email: p.email ?? undefined, country: p.countryCode });
  const ed = await prisma.eInvoiceDocument.findFirst({ where: { statementId, direction: "OUTBOUND", status: { in: ["SENT", "DELIVERED", "ACCEPTED"] } }, orderBy: { createdAt: "desc" }, select: { format: true, networkRef: true, status: true } });
  return {
    docType: st.isCreditStatement ? "CREDIT_NOTE" : "INVOICE", selfBilled: true, agreement: st.vendor.einvoiceProfile?.selfBillingAgreement ?? null,
    fullNumber: doc.number, issuedAt: new Date(doc.issueDate), dueAt: null, atcud: null, hash: null, certified: false,
    orderNumber: doc.orderReference, originalNumber: null, reason: null, taxRegime: st.taxRegime, poReference: doc.buyerReference,
    issuer: party(doc.seller), recipient: party(doc.buyer), taxLabel: "VAT",
    lines: doc.lines.map((l) => ({ description: l.name, qty: l.qty, unitPriceNet: l.price, discountNet: "0", taxRate: l.vatRate, lineNet: l.net })),
    taxSummary: doc.taxes.map((x) => ({ taxRate: x.rate, base: x.base, vat: x.vat })),
    netTotal: doc.totals.net, vatTotal: doc.totals.vat, grossTotal: doc.totals.gross,
    currency: doc.currency !== "EUR" ? { code: doc.currency, rate: "1", date: null, eur: null } : null,
    language: doc.language, secondLanguage: null,
    legalTexts: countryLegalTexts(doc.seller.countryCode, { splitPayment: false, verifactu: false, lang: doc.language, selfBilled: true }),
    einvoice: ed ? { format: ed.format, networkRef: ed.networkRef, status: ed.status } : null,
  };
}

export async function selfBilledPdf(statementId: string): Promise<Buffer> {
  return Buffer.from(await renderInvoicePdf(await selfBilledPdfData(statementId)));
}
