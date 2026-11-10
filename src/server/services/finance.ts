/**
 * Finance: vendor invoices (uploaded, matched to billing statements, approved),
 * credit notes, the payments ledger (inbound from buyers, outbound to vendors), open
 * balances and the VAT report. Vendors and buyers only ever see their own documents.
 */
import type { InvoiceDocType, PaymentMethod, Prisma } from "@prisma/client";
import Decimal from "decimal.js";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { creditInvoice } from "@/server/invoicing/service";
import { scopeWhere } from "./admin-access";
import { storeUpload } from "./storage";
import { writeAudit } from "./audit";
import { notify } from "@/server/notify/dispatch";

const TOLERANCE = new Decimal("0.02"); // rounding differences accepted when matching
const isAdmin = (ctx: Ctx, perm: Parameters<typeof can>[1]) => ctx.company.type === "ADMIN" && can(ctx, perm);
const isVendor = (ctx: Ctx) => ctx.company.type === "DISTRIBUTOR" || ctx.company.type === "WHOLESALER";

// ── Sales invoices (FIRINGI → buyer) ────────────────────────────────────────

/** Amount paid on each invoice (sum of allocations of confirmed payments). */
async function paidMap(invoiceIds: string[]) {
  const rows = await prisma.paymentAllocation.groupBy({ by: ["invoiceId"], where: { invoiceId: { in: invoiceIds }, payment: { status: "CONFIRMED" } }, _sum: { amount: true } });
  return new Map(rows.map((r) => [r.invoiceId!, new Decimal(r._sum.amount?.toString() ?? 0)]));
}

export async function listSalesInvoices(ctx: Ctx, f: { as: "BUYER" | "ADMIN"; docType?: InvoiceDocType; buyerType?: "CUSTOMER" | "WHOLESALER"; unpaidOnly?: boolean } ) {
  let where: Prisma.InvoiceWhereInput;
  if (f.as === "BUYER") {
    if (!can(ctx, ["buyer.invoices.view", "buyer.payments.view"])) throw new ForbiddenError();
    where = { recipientCompanyId: ctx.company.id };
  } else {
    if (!isAdmin(ctx, ["admin.invoices.view", "admin.finance.view"])) throw new ForbiddenError();
    where = { recipient: { ...scopeWhere(ctx), ...(f.buyerType ? { type: f.buyerType } : {}) } };
  }
  const rows = await prisma.invoice.findMany({
    where: { ...where, status: { not: "DRAFT" }, ...(f.docType ? { docType: f.docType } : {}) },
    include: { recipient: { select: { legalName: true } }, order: { select: { id: true, number: true } }, originalInvoice: { select: { fullNumber: true } } },
    orderBy: { issuedAt: "desc" },
    take: 300,
  });
  const paid = await paidMap(rows.map((r) => r.id));
  const out = rows.map((r) => {
    const p = paid.get(r.id) ?? new Decimal(0);
    const open = r.docType === "CREDIT_NOTE" ? new Decimal(0) : new Decimal(r.grossTotal.toString()).minus(p);
    return { ...r, paid: p.toFixed(2), open: open.toFixed(2), overdue: open.gt(0) && !!r.dueAt && r.dueAt < new Date() };
  });
  return f.unpaidOnly ? out.filter((r) => new Decimal(r.open).gt(0)) : out;
}

/** Load an invoice if the caller may see it (buyer = recipient, or FIRINGI staff). */
export async function invoiceForViewer(ctx: Ctx, id: string) {
  const inv = await prisma.invoice.findUnique({
    where: { id },
    include: { lines: { orderBy: { position: "asc" } }, taxSummary: true, order: { select: { number: true } }, originalInvoice: { select: { fullNumber: true } }, recipient: { select: { type: true } } },
  });
  if (!inv || inv.status === "DRAFT") throw new NotFoundError("Invoice");
  const mine = inv.recipientCompanyId === ctx.company.id && can(ctx, ["buyer.invoices.view", "buyer.payments.view"]);
  const staff = isAdmin(ctx, ["admin.invoices.view", "admin.finance.view"]) && (await prisma.company.count({ where: { id: inv.recipientCompanyId, ...scopeWhere(ctx) } })) > 0;
  if (!mine && !staff) throw new NotFoundError("Invoice");
  return inv;
}

export async function issueCreditNote(ctx: Ctx, invoiceId: string, input: { lines: { invoiceLineId: string; qty: number }[] | "ALL"; reason: string }) {
  if (!isAdmin(ctx, "admin.invoices.issue")) throw new ForbiddenError();
  if (input.reason.trim().length < 3) throw new ValidationError("Give the reason for the credit note.");
  await invoiceForViewer(ctx, invoiceId);
  try {
    const cn = await prisma.$transaction(async (tx) => {
      const doc = await creditInvoice(tx, invoiceId, { ...input, actorUserId: ctx.user.id });
      await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "invoice.credit_note_issued", entityType: "Invoice", entityId: doc.id, after: { original: invoiceId, reason: input.reason, number: doc.fullNumber } }, tx);
      return doc;
    });
    await notify("invoice.credit_note", [{ companyId: cn.recipientCompanyId, link: "/buy/finance/invoices" }], { document: cn.fullNumber }, { ref: { type: "Invoice", id: cn.id } });
    return cn;
  } catch (e) {
    const m = e instanceof Error ? e.message : "";
    if (m.startsWith("QTY_TOO_HIGH")) throw new ValidationError("You can't credit more than was invoiced (minus earlier credit notes).");
    if (m === "NOT_CREDITABLE") throw new AppError("NOT_CREDITABLE", "This document can't be credited.", 409);
    if (m === "NOTHING_TO_CREDIT") throw new ValidationError("Choose at least one line to credit.");
    throw e;
  }
}

// ── Vendor side: statements and invoices to FIRINGI ─────────────────────────

export async function listStatements(ctx: Ctx, as: "VENDOR" | "ADMIN", f: { openOnly?: boolean } = {}) {
  if (as === "VENDOR" && !(isVendor(ctx) && can(ctx, ["vendor.invoices.view", "vendor.invoices.submit"]))) throw new ForbiddenError();
  if (as === "ADMIN" && !isAdmin(ctx, ["admin.invoices.view", "admin.finance.view"])) throw new ForbiddenError();
  return prisma.vendorBillingStatement.findMany({
    where: { ...(as === "VENDOR" ? { vendorCompanyId: ctx.company.id } : {}), ...(f.openOnly ? { status: { in: ["OPEN", "DISPUTED"] } } : {}) },
    include: { order: { select: { id: true, number: true } }, vendor: { select: { legalName: true, type: true } }, allocations: { include: { vendorInvoice: { select: { externalNumber: true, status: true } } } } },
    orderBy: { createdAt: "desc" },
    take: 300,
  });
}

export async function statementForViewer(ctx: Ctx, id: string) {
  const st = await prisma.vendorBillingStatement.findUnique({ where: { id }, include: { order: { select: { number: true, placedAt: true } }, vendor: { include: { country: true } } } });
  if (!st) throw new NotFoundError("Statement");
  const mine = st.vendorCompanyId === ctx.company.id && can(ctx, ["vendor.invoices.view", "vendor.invoices.submit"]);
  if (!mine && !isAdmin(ctx, ["admin.invoices.view", "admin.finance.view"])) throw new NotFoundError("Statement");
  return st;
}

/** Vendor uploads the invoice (or credit note) it issued to FIRINGI for one or more statements. */
export async function submitVendorInvoice(ctx: Ctx, input: {
  statementIds: string[]; docType: "INVOICE" | "CREDIT_NOTE"; externalNumber: string; issueDate: Date; netTotal: string; vatTotal: string; file: File;
}) {
  if (!isVendor(ctx) || !can(ctx, "vendor.invoices.submit")) throw new ForbiddenError();
  if (!input.statementIds.length) throw new ValidationError("Choose the statement(s) this invoice covers.");
  const statements = await prisma.vendorBillingStatement.findMany({ where: { id: { in: input.statementIds }, vendorCompanyId: ctx.company.id } });
  if (statements.length !== input.statementIds.length) throw new NotFoundError("Statement");
  if (statements.some((s) => s.status !== "OPEN" && s.status !== "DISPUTED")) throw new ValidationError("One of the statements already has an invoice.");
  const isCredit = input.docType === "CREDIT_NOTE";
  if (statements.some((s) => s.isCreditStatement !== isCredit)) throw new ValidationError(isCredit ? "Credit notes go against credit statements." : "Invoices go against normal statements (use a credit note for credit statements).");
  if (new Set(statements.map((s) => s.taxRegime)).size > 1) throw new ValidationError("Statements with different VAT treatment must be invoiced separately.");
  if (await prisma.vendorInvoice.findUnique({ where: { vendorCompanyId_externalNumber: { vendorCompanyId: ctx.company.id, externalNumber: input.externalNumber.trim() } } }))
    throw new AppError("DUPLICATE", "You already submitted a document with this number.", 409);

  const net = new Decimal(input.netTotal), vat = new Decimal(input.vatTotal);
  const expNet = statements.reduce((a, s) => a.plus(s.expectedNet.toString()), new Decimal(0));
  const expVat = statements.reduce((a, s) => a.plus(s.expectedVat.toString()), new Decimal(0));
  const diffs: Record<string, string> = {};
  if (net.minus(expNet).abs().gt(TOLERANCE)) diffs.net = `${net.toFixed(2)} ≠ expected ${expNet.toFixed(2)}`;
  if (vat.minus(expVat).abs().gt(TOLERANCE)) diffs.vat = `${vat.toFixed(2)} ≠ expected ${expVat.toFixed(2)}`;
  const matched = Object.keys(diffs).length === 0;
  const regime = statements[0].taxRegime;
  // Reverse charge: FIRINGI self-assesses Portuguese VAT on the purchase (for the VAT return).
  let selfAssessed = new Decimal(0);
  if (regime === "INTRA_EU_REVERSE_CHARGE")
    for (const s of statements) {
      const lines = s.lines as { orderLineId: string; lineNet: string }[];
      const ols = await prisma.orderLine.findMany({ where: { id: { in: lines.map((l) => l.orderLineId) } }, select: { id: true, taxRate: true } });
      for (const l of lines) selfAssessed = selfAssessed.plus(new Decimal(l.lineNet).mul(ols.find((o) => o.id === l.orderLineId)?.taxRate.toString() ?? 0).div(100));
    }
  const stored = await storeUpload(input.file, `vendor-invoices/${ctx.company.id}`);

  const vi = await prisma.$transaction(async (tx) => {
    const created = await tx.vendorInvoice.create({
      data: {
        vendorCompanyId: ctx.company.id, docType: input.docType, externalNumber: input.externalNumber.trim(), issueDate: input.issueDate, taxRegime: regime,
        netTotal: net.toFixed(2), vatTotal: vat.toFixed(2), grossTotal: net.plus(vat).toFixed(2), selfAssessedVat: selfAssessed.toDecimalPlaces(2).toFixed(2),
        fileKey: stored.key, status: matched ? "MATCHED" : "DISPUTED", matchResult: matched ? { ok: true } : diffs, submittedById: ctx.user.id,
        allocations: { create: statements.map((s) => ({ statementId: s.id, amountNet: s.expectedNet })) },
      },
    });
    await tx.vendorBillingStatement.updateMany({ where: { id: { in: input.statementIds } }, data: { status: matched ? "MATCHED" : "DISPUTED" } });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "vendor_invoice.submitted", entityType: "VendorInvoice", entityId: created.id, after: { number: input.externalNumber, net: net.toFixed(2), vat: vat.toFixed(2), matched, diffs } }, tx);
    return created;
  });
  return vi;
}

export async function listVendorInvoices(ctx: Ctx, as: "VENDOR" | "ADMIN", f: { vendorType?: "DISTRIBUTOR" | "WHOLESALER"; statuses?: string[] } = {}) {
  if (as === "VENDOR" && !(isVendor(ctx) && can(ctx, ["vendor.invoices.view", "vendor.invoices.submit", "vendor.payments.view"]))) throw new ForbiddenError();
  if (as === "ADMIN" && !isAdmin(ctx, ["admin.invoices.view", "admin.finance.view"])) throw new ForbiddenError();
  const rows = await prisma.vendorInvoice.findMany({
    where: {
      ...(as === "VENDOR" ? { vendorCompanyId: ctx.company.id } : {}), ...(f.vendorType ? { vendor: { type: f.vendorType } } : {}),
      ...(f.statuses ? { status: { in: f.statuses as never } } : {}),
    },
    include: { vendor: { select: { legalName: true, type: true } }, allocations: { include: { statement: { select: { number: true, order: { select: { number: true } } } } } } },
    orderBy: { createdAt: "desc" },
    take: 300,
  });
  const paid = await prisma.paymentAllocation.groupBy({ by: ["vendorInvoiceId"], where: { vendorInvoiceId: { in: rows.map((r) => r.id) }, payment: { status: "CONFIRMED" } }, _sum: { amount: true } });
  const pm = new Map(paid.map((p) => [p.vendorInvoiceId!, new Decimal(p._sum.amount?.toString() ?? 0)]));
  return rows.map((r) => ({ ...r, paid: (pm.get(r.id) ?? new Decimal(0)).toFixed(2), open: r.docType === "CREDIT_NOTE" ? "0.00" : new Decimal(r.grossTotal.toString()).minus(pm.get(r.id) ?? 0).toFixed(2) }));
}

/** Finance approves (or rejects) a vendor invoice. A disputed one needs an explicit note. */
export async function reviewVendorInvoice(ctx: Ctx, id: string, decision: "APPROVED" | "REJECTED", note?: string | null) {
  if (!isAdmin(ctx, "admin.finance.manage")) throw new ForbiddenError();
  const vi = await prisma.vendorInvoice.findUnique({ where: { id }, include: { allocations: true } });
  if (!vi) throw new NotFoundError("Vendor invoice");
  if (vi.status !== "MATCHED" && vi.status !== "DISPUTED") throw new AppError("BAD_STATUS", "This invoice was already reviewed.");
  if ((decision === "REJECTED" || vi.status === "DISPUTED") && !note?.trim()) throw new ValidationError(decision === "REJECTED" ? "Give the reason for rejecting." : "This invoice doesn't match the statement — explain why you approve it.");
  await prisma.$transaction(async (tx) => {
    await tx.vendorInvoice.update({ where: { id }, data: { status: decision, reviewedById: ctx.user.id, reviewedAt: new Date(), matchResult: { ...(vi.matchResult as object), reviewNote: note ?? null } } });
    await tx.vendorBillingStatement.updateMany({ where: { id: { in: vi.allocations.map((a) => a.statementId) } }, data: { status: decision === "APPROVED" ? "CLOSED" : "OPEN" } });
    if (decision === "REJECTED") await tx.vendorInvoiceAllocation.deleteMany({ where: { vendorInvoiceId: id } });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: `vendor_invoice.${decision.toLowerCase()}`, entityType: "VendorInvoice", entityId: id, after: { note } }, tx);
  });
  await notify(`vendor_invoice.${decision.toLowerCase()}`, [{ companyId: vi.vendorCompanyId, link: "/vendor/finance/invoices" }], { document: vi.externalNumber, reason: note });
}

// ── Payments ledger ─────────────────────────────────────────────────────────

export async function recordPayment(ctx: Ctx, input: {
  direction: "INBOUND" | "OUTBOUND"; companyId: string; method: PaymentMethod; amount: number; reference?: string | null; paidAt: Date;
  allocations: { documentId: string; amount: number }[];
}) {
  if (!isAdmin(ctx, "admin.finance.manage")) throw new ForbiddenError();
  const amount = new Decimal(input.amount);
  if (amount.lte(0)) throw new ValidationError("Amount must be greater than 0.");
  const allocTotal = input.allocations.reduce((a, x) => a.plus(x.amount), new Decimal(0));
  if (allocTotal.gt(amount)) throw new ValidationError("Allocations exceed the payment amount.");
  const open = input.direction === "INBOUND"
    ? await listSalesInvoices(ctx, { as: "ADMIN" })
    : await listVendorInvoices(ctx, "ADMIN");
  for (const a of input.allocations) {
    const doc = open.find((d) => d.id === a.documentId) as { open: string; recipientCompanyId?: string; vendorCompanyId?: string; status: string } | undefined;
    if (!doc) throw new NotFoundError("Document");
    if ((input.direction === "INBOUND" ? doc.recipientCompanyId : doc.vendorCompanyId) !== input.companyId) throw new ValidationError("Allocation to another company's document.");
    if (input.direction === "OUTBOUND" && doc.status !== "APPROVED") throw new ValidationError("Only approved vendor invoices can be paid.");
    if (new Decimal(a.amount).gt(doc.open)) throw new ValidationError(`Allocation is more than the open amount (${doc.open}).`);
  }
  const payment = await prisma.$transaction(async (tx) => {
    const p = await tx.payment.create({
      data: {
        companyId: input.companyId, direction: input.direction, method: input.method, amount: amount.toFixed(2), reference: input.reference ?? null, status: "CONFIRMED",
        paidAt: input.paidAt, recordedById: ctx.user.id,
        allocations: { create: input.allocations.map((a) => (input.direction === "INBOUND" ? { invoiceId: a.documentId, amount: a.amount } : { vendorInvoiceId: a.documentId, amount: a.amount })) },
      },
    });
    if (input.direction === "OUTBOUND")
      for (const a of input.allocations) {
        const vi = await tx.vendorInvoice.findUniqueOrThrow({ where: { id: a.documentId }, include: { paymentAllocations: { where: { payment: { status: "CONFIRMED" } } } } });
        const paid = vi.paymentAllocations.reduce((s, x) => s.plus(x.amount.toString()), new Decimal(0));
        if (paid.gte(vi.grossTotal.toString())) await tx.vendorInvoice.update({ where: { id: vi.id }, data: { status: "PAID" } });
      }
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: `payment.${input.direction.toLowerCase()}`, entityType: "Payment", entityId: p.id, after: { ...input, paidAt: input.paidAt.toISOString() } }, tx);
    return p;
  });
  return payment;
}

export async function listPayments(ctx: Ctx, as: "BUYER" | "VENDOR" | "ADMIN", f: { direction?: "INBOUND" | "OUTBOUND"; vendorType?: "DISTRIBUTOR" | "WHOLESALER" } = {}) {
  let where: Prisma.PaymentWhereInput;
  if (as === "BUYER") { if (!can(ctx, ["buyer.payments.view", "buyer.invoices.view"])) throw new ForbiddenError(); where = { companyId: ctx.company.id, direction: "INBOUND" }; }
  else if (as === "VENDOR") { if (!(isVendor(ctx) && can(ctx, ["vendor.payments.view", "vendor.invoices.view"]))) throw new ForbiddenError(); where = { companyId: ctx.company.id, direction: "OUTBOUND" }; }
  else { if (!isAdmin(ctx, ["admin.finance.view", "admin.finance.manage"])) throw new ForbiddenError(); where = { ...(f.direction ? { direction: f.direction } : {}), ...(f.vendorType ? { company: { type: f.vendorType } } : {}) }; }
  return prisma.payment.findMany({
    where, include: { company: { select: { legalName: true } }, allocations: { include: { invoice: { select: { fullNumber: true } }, vendorInvoice: { select: { externalNumber: true } } } } },
    orderBy: { paidAt: "desc" }, take: 300,
  });
}

// ── Reports ─────────────────────────────────────────────────────────────────

/** VAT for a month: output VAT on sales (minus credit notes), input VAT on approved vendor invoices, reverse charge. */
export async function vatReport(ctx: Ctx, month: Date) {
  if (!isAdmin(ctx, ["admin.invoices.view", "admin.finance.view", "admin.tax.manage"])) throw new ForbiddenError();
  const from = new Date(month.getFullYear(), month.getMonth(), 1), to = new Date(month.getFullYear(), month.getMonth() + 1, 1);
  const sales = await prisma.invoiceTaxSummary.findMany({ where: { invoice: { issuedAt: { gte: from, lt: to }, status: { not: "DRAFT" } } }, include: { invoice: { select: { docType: true } } } });
  const byRate = new Map<string, { base: Decimal; vat: Decimal }>();
  for (const s of sales) {
    const sign = s.invoice.docType === "CREDIT_NOTE" ? -1 : 1;
    const k = s.taxRate.toString();
    const cur = byRate.get(k) ?? { base: new Decimal(0), vat: new Decimal(0) };
    byRate.set(k, { base: cur.base.plus(new Decimal(s.base.toString()).mul(sign)), vat: cur.vat.plus(new Decimal(s.vat.toString()).mul(sign)) });
  }
  const purchases = await prisma.vendorInvoice.findMany({ where: { issueDate: { gte: from, lt: to }, status: { in: ["APPROVED", "PAID", "MATCHED"] } } });
  const sum = (f: (v: (typeof purchases)[number]) => Decimal) => purchases.reduce((a, v) => a.plus(f(v)), new Decimal(0));
  const sign = (v: (typeof purchases)[number]) => (v.docType === "CREDIT_NOTE" ? -1 : 1);
  const output = [...byRate.values()].reduce((a, v) => a.plus(v.vat), new Decimal(0));
  const input = sum((v) => new Decimal(v.vatTotal.toString()).mul(sign(v)));
  const reverseCharge = sum((v) => new Decimal(v.selfAssessedVat.toString()).mul(sign(v)));
  return {
    from, to,
    outputByRate: [...byRate].map(([rate, v]) => ({ rate, base: v.base.toFixed(2), vat: v.vat.toFixed(2) })).sort((a, b) => Number(b.rate) - Number(a.rate)),
    outputVat: output.toFixed(2), inputVat: input.toFixed(2),
    // Reverse charge: FIRINGI declares it as output AND deducts it as input (net 0, but must be reported).
    reverseChargeVat: reverseCharge.toFixed(2),
    payable: output.minus(input).toFixed(2),
  };
}

/** Open receivables (buyers) and payables (vendors) per company. */
export async function balances(ctx: Ctx) {
  if (!isAdmin(ctx, ["admin.finance.view", "admin.finance.manage"])) throw new ForbiddenError();
  const [sales, vend] = await Promise.all([listSalesInvoices(ctx, { as: "ADMIN" }), listVendorInvoices(ctx, "ADMIN")]);
  const group = <T extends { open: string }>(rows: T[], key: (r: T) => string, name: (r: T) => string, overdue: (r: T) => boolean) => {
    const m = new Map<string, { name: string; open: Decimal; overdue: Decimal; count: number }>();
    for (const r of rows) {
      if (new Decimal(r.open).lte(0)) continue;
      const cur = m.get(key(r)) ?? { name: name(r), open: new Decimal(0), overdue: new Decimal(0), count: 0 };
      m.set(key(r), { name: cur.name, open: cur.open.plus(r.open), overdue: overdue(r) ? cur.overdue.plus(r.open) : cur.overdue, count: cur.count + 1 });
    }
    return [...m].map(([id, v]) => ({ id, name: v.name, open: v.open.toFixed(2), overdue: v.overdue.toFixed(2), count: v.count })).sort((a, b) => Number(b.open) - Number(a.open));
  };
  return {
    receivable: group(sales, (r) => r.recipientCompanyId, (r) => r.recipient.legalName, (r) => r.overdue),
    payable: group(vend.filter((v) => v.status === "APPROVED"), (r) => r.vendorCompanyId, (r) => r.vendor.legalName, () => false),
  };
}

/** Headline numbers for the finance overview (current month). */
export async function financeOverview(ctx: Ctx) {
  if (!isAdmin(ctx, ["admin.finance.view", "admin.finance.manage"])) throw new ForbiddenError();
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const [inv, cn, b, commission, discounts] = await Promise.all([
    prisma.invoice.aggregate({ where: { docType: "INVOICE", issuedAt: { gte: from } }, _sum: { netTotal: true, vatTotal: true, grossTotal: true }, _count: { _all: true } }),
    prisma.invoice.aggregate({ where: { docType: "CREDIT_NOTE", issuedAt: { gte: from } }, _sum: { netTotal: true } }),
    balances(ctx),
    prisma.order.aggregate({ where: { status: "DELIVERED", updatedAt: { gte: from } }, _sum: { commissionTotal: true, firingiMarginNet: true } }),
    prisma.orderLineDiscount.aggregate({ where: { orderLine: { order: { placedAt: { gte: from } } } }, _sum: { firingiAmount: true, vendorAmount: true } }),
  ]);
  // Delivery fees FIRINGI keeps (its own fleet); suppliers' flat rates are passed on to them.
  const fees = await prisma.order.aggregate({ where: { status: "DELIVERED", updatedAt: { gte: from }, deliveryMode: "FIRINGI_FLEET" }, _sum: { deliveryFeeNet: true } });
  const z = (d: Prisma.Decimal | null | undefined) => d?.toString() ?? "0";
  return {
    invoices: inv._count._all, salesNet: z(inv._sum.netTotal), vat: z(inv._sum.vatTotal), creditNotesNet: z(cn._sum.netTotal),
    commission: z(commission._sum.commissionTotal), margin: z(commission._sum.firingiMarginNet), deliveryFees: z(fees._sum.deliveryFeeNet),
    discountFiringi: z(discounts._sum.firingiAmount), discountVendors: z(discounts._sum.vendorAmount),
    receivable: b.receivable.reduce((a, r) => a.plus(r.open), new Decimal(0)).toFixed(2), overdue: b.receivable.reduce((a, r) => a.plus(r.overdue), new Decimal(0)).toFixed(2),
    payable: b.payable.reduce((a, r) => a.plus(r.open), new Decimal(0)).toFixed(2),
  };
}

/** Commission earned per vendor (delivered orders). */
export async function commissionByVendor(ctx: Ctx) {
  if (!isAdmin(ctx, ["admin.finance.view", "admin.vendors.commission"])) throw new ForbiddenError();
  const rows = await prisma.order.groupBy({ by: ["sellerCompanyId"], where: { status: "DELIVERED" }, _sum: { commissionTotal: true, netTotal: true, vendorPayableNet: true }, _count: { _all: true } });
  const vendors = await prisma.company.findMany({ where: { id: { in: rows.map((r) => r.sellerCompanyId) } }, select: { id: true, legalName: true, type: true, commissionRules: { where: { validTo: null }, select: { rate: true } } } });
  return rows.map((r) => ({ ...r, vendor: vendors.find((v) => v.id === r.sellerCompanyId)! })).sort((a, b) => Number(b._sum.commissionTotal) - Number(a._sum.commissionTotal));
}
