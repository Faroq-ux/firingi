/** Assemble PDF data for documents the caller may see. */
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { invoiceForViewer, statementForViewer } from "@/server/services/finance";
import { NotFoundError } from "@/server/errors";
import { can } from "@/server/rbac/guard";
import { taxLabel } from "@/lib/tax-label";
import type { InvoicePdfData, StatementPdfData } from "@/server/pdf/documents";

export async function invoicePdfData(ctx: Ctx, id: string): Promise<InvoicePdfData> {
  const inv = await invoiceForViewer(ctx, id);
  const issuer = inv.issuerSnapshot as InvoicePdfData["issuer"];
  const recipient = inv.recipientSnapshot as InvoicePdfData["recipient"] & { reason?: string };
  return {
    // A document issued at Moloni carries Moloni's legal number; only live Moloni is certified.
    docType: inv.docType, fullNumber: inv.providerNumber ?? inv.fullNumber!, issuedAt: inv.issuedAt!, dueAt: inv.dueAt, atcud: inv.atcud, hash: inv.hash,
    certified: inv.fiscalStatus === "DONE" && inv.externalProvider === "moloni", orderNumber: inv.order?.number ?? null,
    branch: inv.order?.branch?.name ?? null, costCentre: inv.order?.costCentre ?? null, poReference: inv.order?.poReference ?? null, originalNumber: inv.originalInvoice?.providerNumber ?? inv.originalInvoice?.fullNumber ?? null,
    reason: recipient.reason ?? null, taxRegime: inv.taxRegime, issuer, recipient, taxLabel: taxLabel(issuer.country ?? "PT"),
    lines: inv.lines.map((l) => ({ description: l.description, qty: l.qty.toString(), unitPriceNet: l.unitPriceNet.toString(), discountNet: l.discountNet.toString(), taxRate: l.taxRate.toString(), lineNet: l.lineNet.toString() })),
    taxSummary: inv.taxSummary.map((t) => ({ taxRate: t.taxRate.toString(), base: t.base.toString(), vat: t.vat.toString() })),
    netTotal: inv.netTotal.toString(), vatTotal: inv.vatTotal.toString(), grossTotal: inv.grossTotal.toString(),
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
  };
}

/** The file a vendor uploaded — the vendor itself or FIRINGI finance only. */
export async function vendorInvoiceFile(ctx: Ctx, id: string) {
  const vi = await prisma.vendorInvoice.findUnique({ where: { id } });
  const ok = vi && ((vi.vendorCompanyId === ctx.company.id && can(ctx, ["vendor.invoices.view", "vendor.invoices.submit"])) || (ctx.company.type === "ADMIN" && can(ctx, ["admin.invoices.view", "admin.finance.view"])));
  if (!vi || !ok) throw new NotFoundError("Document");
  return vi;
}
