/** Assemble PDF data for documents the caller may see. */
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { invoiceForViewer, statementForViewer } from "@/server/services/finance";
import { NotFoundError } from "@/server/errors";
import { can } from "@/server/rbac/guard";
import { taxLabel } from "@/lib/tax-label";
import type { InvoicePdfData, StatementPdfData } from "@/server/pdf/documents";

const VIEW_INCLUDE = { lines: { orderBy: { position: "asc" as const } }, taxSummary: true, order: { select: { number: true, branchId: true, costCentre: true, poReference: true, branch: { select: { name: true } } } }, originalInvoice: { select: { fullNumber: true, providerNumber: true } }, recipient: { select: { type: true } } };

/** `ctx` null = FIRINGI's own system (e-invoice queue, e-mail copies): no viewer check. */
export async function invoicePdfData(ctx: Ctx | null, id: string): Promise<InvoicePdfData> {
  const inv = ctx ? await invoiceForViewer(ctx, id) : await prisma.invoice.findUniqueOrThrow({ where: { id }, include: VIEW_INCLUDE });
  const issuer = inv.issuerSnapshot as InvoicePdfData["issuer"];
  const recipient = inv.recipientSnapshot as InvoicePdfData["recipient"] & { reason?: string };
  // Phase 46: the document's language(s); line texts translated from the stored (legal-record) text
  const lang = inv.language ?? (issuer.country && issuer.country !== "PT" ? "en" : "pt-PT");
  const second = inv.secondLanguage;
  const { localizeLine, countryLegalTexts } = await import("@/server/einvoice/doc-i18n");
  const ols = await prisma.orderLine.findMany({ where: { id: { in: inv.lines.map((l) => l.orderLineId).filter((x): x is string => !!x) } }, select: { id: true, productName: true, packagingName: true, sku: true } });
  const olMap = new Map(ols.map((o) => [o.id, o]));
  const desc = (l: { description: string; orderLineId: string | null }, lg: string) => localizeLine({ description: l.description, orderLine: l.orderLineId ? olMap.get(l.orderLineId) ?? null : null }, lg);
  const ed = await prisma.eInvoiceDocument.findFirst({ where: { invoiceId: inv.id, direction: "OUTBOUND", status: { in: ["SENT", "DELIVERED", "ACCEPTED"] } }, orderBy: { createdAt: "desc" }, select: { format: true, networkRef: true, status: true } });
  const { einvoiceSettings } = await import("@/server/einvoice/service");
  const es = await einvoiceSettings();
  let plGross = Number(inv.currencyCode === "PLN" ? inv.grossTotalLocal ?? 0 : 0);
  if (issuer.country === "PL" && inv.currencyCode !== "PLN") {
    const r = await prisma.exchangeRate.findFirst({ where: { baseCode: "EUR", quoteCode: "PLN" }, orderBy: { date: "desc" }, select: { rate: true } });
    plGross = Number(inv.grossTotal) * Number(r?.rate ?? 4.3);
  }
  const legalTexts = countryLegalTexts(issuer.country ?? "PT", { splitPayment: es.plSplitPaymentFrom > 0 && plGross >= es.plSplitPaymentFrom, verifactu: ed?.format === "VERIFACTU", lang, selfBilled: false });
  const base: InvoicePdfData = {
    language: lang, secondLanguage: second, legalTexts, einvoice: ed ? { format: ed.format, networkRef: ed.networkRef, status: ed.status } : null,
    // A document issued at Moloni carries Moloni's legal number; only live Moloni is certified.
    docType: inv.docType, fullNumber: inv.providerNumber ?? inv.fullNumber!, issuedAt: inv.issuedAt!, dueAt: inv.dueAt, atcud: inv.atcud, hash: inv.hash,
    certified: inv.fiscalStatus === "DONE" && inv.externalProvider === "moloni", orderNumber: inv.order?.number ?? null,
    branch: inv.order?.branch?.name ?? null, costCentre: inv.order?.costCentre ?? null, poReference: inv.order?.poReference ?? null, originalNumber: inv.originalInvoice?.providerNumber ?? inv.originalInvoice?.fullNumber ?? null,
    reason: recipient.reason ?? null, taxRegime: inv.taxRegime, issuer, recipient, taxLabel: taxLabel(issuer.country ?? "PT"),
    lines: inv.lines.map((l) => ({ description: desc(l, lang), description2: second ? desc(l, second) : null, qty: l.qty.toString(), unitPriceNet: l.unitPriceNet.toString(), discountNet: l.discountNet.toString(), taxRate: l.taxRate.toString(), lineNet: l.lineNet.toString(), exciseNet: l.exciseNet.toString() })),
    taxSummary: inv.taxSummary.map((t) => ({ taxRate: t.taxRate.toString(), base: t.base.toString(), vat: t.vat.toString() })),
    netTotal: inv.netTotal.toString(), vatTotal: inv.vatTotal.toString(), grossTotal: inv.grossTotal.toString(),
  };
  if (inv.currencyCode === "EUR" || inv.grossTotalLocal == null) return base;
  // Phase 45: the invoice in the customer's currency — lines, VAT summary and totals in it; the EUR equivalent at the reference rate
  const { invoiceEurEquivalent } = await (await import("@/server/currency/service")).currencySettings();
  const dp = inv.currencyCode === "ISK" ? 0 : 2;
  const n = (v: unknown) => Number(v ?? 0);
  const lines = inv.lines.map((l) => {
    const unit = l.unitPriceLocal != null ? n(l.unitPriceLocal) : n(l.unitPriceNet) * n(inv.eurRate);
    const net = l.lineNetLocal != null ? n(l.lineNetLocal) : n(l.lineNet) * n(inv.eurRate);
    const disc = Math.max(0, unit * n(l.qty) - net);
    return { description: desc(l, lang), description2: second ? desc(l, second) : null, qty: l.qty.toString(), unitPriceNet: unit.toFixed(4), discountNet: disc.toFixed(dp), taxRate: l.taxRate.toString(), lineNet: net.toFixed(dp), exciseNet: (n(l.exciseNet) * n(inv.eurRate)).toFixed(dp), vat: n(l.lineVatLocal ?? n(l.lineVat) * n(inv.eurRate)) };
  });
  const byRate = new Map<string, { base: number; vat: number }>();
  for (const l of lines) { const c = byRate.get(l.taxRate) ?? { base: 0, vat: 0 }; byRate.set(l.taxRate, { base: c.base + Number(l.lineNet), vat: c.vat + l.vat }); }
  const mid = n(inv.midRate) || n(inv.eurRate) || 1;
  const midRow = await prisma.exchangeRate.findFirst({ where: { quoteCode: inv.currencyCode, date: { lte: inv.issuedAt ?? new Date() } }, orderBy: { date: "desc" }, select: { date: true } });
  return {
    ...base, lines: lines.map(({ vat: _v, ...l }) => l),
    taxSummary: [...byRate].map(([taxRate, v]) => ({ taxRate, base: v.base.toFixed(dp), vat: v.vat.toFixed(dp) })),
    netTotal: n(inv.netTotalLocal).toFixed(dp), vatTotal: n(inv.vatTotalLocal).toFixed(dp), grossTotal: n(inv.grossTotalLocal).toFixed(dp),
    currency: {
      code: inv.currencyCode, rate: String(mid), date: midRow?.date.toISOString().slice(0, 10) ?? null,
      eur: invoiceEurEquivalent ? { net: (n(inv.netTotalLocal) / mid).toFixed(2), vat: (n(inv.vatTotalLocal) / mid).toFixed(2), gross: (n(inv.grossTotalLocal) / mid).toFixed(2) } : null,
    },
  };
}

export async function statementPdfData(ctx: Ctx, id: string): Promise<StatementPdfData> {
  const st = await statementForViewer(ctx, id);
  const order = await prisma.order.findUniqueOrThrow({ where: { id: st.orderId }, select: { countryId: true } });
  const le = await prisma.legalEntity.findFirstOrThrow({ where: { countryId: order.countryId } });
  const addr = await prisma.address.findFirst({ where: { companyId: st.vendorCompanyId, kind: "HEAD_OFFICE", isActive: true } });
  return {
    number: st.number, createdAt: st.createdAt, isCredit: st.isCreditStatement, orderNumber: st.order.number, taxRegime: st.taxRegime,
    vendor: { name: st.vendor.legalName, taxId: st.vendor.taxId, vatNumber: st.vendor.vatNumber, address: addr ? `${addr.line1}, ${addr.postalCode} ${addr.cityName}` : null },
    firingi: { name: le.legalName, taxId: le.taxId, vatNumber: le.vatNumber, address: `${le.addressLine}, ${le.postalCode} ${le.city}`, email: le.email },
    lines: st.lines as StatementPdfData["lines"],
    expectedNet: st.expectedNet.toString(), expectedVat: st.expectedVat.toString(), expectedGross: st.expectedGross.toString(), commissionTotal: st.commissionTotal.toString(),
    // Phase 45: a statement in the supplier's currency — every amount in it (the statement's locked rate)
    ...(st.currencyCode !== "EUR" && st.expectedNetLocal != null ? (() => {
      const k = Number(st.rate);
      const c = (v: unknown) => (Number(v) * k).toFixed(st.currencyCode === "ISK" ? 0 : 2);
      return {
        currencyCode: st.currencyCode,
        lines: (st.lines as StatementPdfData["lines"]).map((l) => ({ ...l, unitCostNet: (Number(l.unitCostNet) * k).toFixed(4), lineNet: c(l.lineNet), vat: c(l.vat) })),
        expectedNet: String(st.expectedNetLocal), expectedVat: String(st.expectedVatLocal), expectedGross: String(st.expectedGrossLocal), commissionTotal: c(st.commissionTotal),
      };
    })() : {}),
  };
}

/** The file a vendor uploaded — the vendor itself or FIRINGI finance only. */
export async function vendorInvoiceFile(ctx: Ctx, id: string) {
  const vi = await prisma.vendorInvoice.findUnique({ where: { id } });
  const ok = vi && ((vi.vendorCompanyId === ctx.company.id && can(ctx, ["vendor.invoices.view", "vendor.invoices.submit"])) || (ctx.company.type === "ADMIN" && can(ctx, ["admin.invoices.view", "admin.finance.view"])));
  if (!vi || !ok) throw new NotFoundError("Document");
  return vi;
}
