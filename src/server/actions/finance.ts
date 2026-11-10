"use server";
/** Promotions, credit notes, vendor invoices and payments (services re-check permissions). */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction, runAction } from "./_action";
import * as promos from "@/server/services/promotions";
import * as fin from "@/server/services/finance";
import * as payments from "@/server/services/payments";

const done = <T>(v: T) => { revalidatePath("/", "layout"); return v; };
const ids = z.array(z.string()).optional();
const promoSchema = z.object({
  id: z.string().optional(),
  name: z.object({ en: z.string().trim().min(2).max(80), pt: z.string().trim().max(80).optional().nullable() }),
  kind: z.enum(["PERCENT", "FIXED_AMOUNT"]),
  value: z.coerce.number().positive(),
  validFrom: z.string(),
  validTo: z.string().optional().nullable(),
  minQty: z.coerce.number().int().min(1).optional().nullable(),
  targets: z.object({ offerIds: ids, productIds: ids, categoryIds: ids, vendorIds: ids, customerGroupIds: ids }),
  firingiFundPct: z.coerce.number().min(0).max(100).optional(),
  countryCode: z.string().length(2).optional().nullable(),
});
const toInput = (i: z.infer<typeof promoSchema>) => ({ ...i, validFrom: new Date(i.validFrom), validTo: i.validTo ? new Date(i.validTo) : null });

export const saveVendorPromotionAction = defineAction({ permission: "vendor.promotions.manage", schema: promoSchema, handler: async (ctx, i) => done(await promos.saveVendorPromotion(ctx, toInput(i))) });
export const saveAdminPromotionAction = defineAction({ permission: ["admin.pricing.manage", "admin.marketing.manage"], schema: promoSchema, handler: async (ctx, i) => done(await promos.saveAdminPromotion(ctx, toInput(i))) });
export const setPromotionStatusAction = defineAction({
  permission: null, schema: z.object({ id: z.string(), status: z.enum(["ACTIVE", "PAUSED", "ENDED"]) }),
  handler: async (ctx, i) => done(await promos.setPromotionStatus(ctx, i.id, i.status)),
});
export const answerPromotionAction = defineAction({
  permission: "vendor.promotions.manage", schema: z.object({ id: z.string(), accept: z.boolean() }),
  handler: async (ctx, i) => done(await promos.answerPromotion(ctx, i.id, i.accept)),
});
export const issueCreditNoteAction = defineAction({
  permission: "admin.invoices.issue",
  schema: z.object({ invoiceId: z.string(), all: z.boolean(), lines: z.array(z.object({ invoiceLineId: z.string(), qty: z.coerce.number().min(0) })).optional(), reason: z.string().trim().min(3).max(300) }),
  handler: async (ctx, i) => done({ id: (await fin.issueCreditNote(ctx, i.invoiceId, { lines: i.all ? "ALL" : (i.lines ?? []).filter((l) => l.qty > 0), reason: i.reason })).id }),
});
export async function submitVendorInvoiceAction(fd: FormData) {
  return runAction(async (ctx) => {
    const i = z.object({
      statementIds: z.array(z.string()).min(1, "Choose at least one statement"), docType: z.enum(["INVOICE", "CREDIT_NOTE"]),
      externalNumber: z.string().trim().min(1).max(60), issueDate: z.string().min(8), netTotal: z.string(), vatTotal: z.string(),
    }).parse({
      statementIds: fd.getAll("statementIds").map(String), docType: fd.get("docType"), externalNumber: fd.get("externalNumber"), issueDate: fd.get("issueDate"),
      netTotal: String(fd.get("netTotal") ?? "").replace(",", "."), vatTotal: String(fd.get("vatTotal") ?? "").replace(",", "."),
    });
    const vi = await fin.submitVendorInvoice(ctx, { ...i, issueDate: new Date(i.issueDate), file: fd.get("file") as File });
    return done({ id: vi.id, status: vi.status });
  });
}
export const reviewVendorInvoiceAction = defineAction({
  permission: "admin.finance.manage", schema: z.object({ id: z.string(), decision: z.enum(["APPROVED", "REJECTED"]), note: z.string().trim().max(300).optional().nullable() }),
  handler: async (ctx, i) => done(await fin.reviewVendorInvoice(ctx, i.id, i.decision, i.note)),
});
export const recordPaymentAction = defineAction({
  permission: "admin.finance.manage",
  schema: z.object({
    direction: z.enum(["INBOUND", "OUTBOUND"]), companyId: z.string(), method: z.enum(["BANK_TRANSFER", "CASH", "CARD", "MB_WAY", "MULTIBANCO", "DIRECT_DEBIT", "OTHER"]),
    amount: z.coerce.number().positive(), reference: z.string().max(80).optional().nullable(), paidAt: z.string(),
    allocations: z.array(z.object({ documentId: z.string(), amount: z.coerce.number().positive() })),
  }),
  handler: async (ctx, i) => done({ id: (await fin.recordPayment(ctx, { ...i, paidAt: new Date(i.paidAt) })).id }),
});
export const setCustomerTermsAction = defineAction({
  permission: "admin.customers.manage",
  schema: z.object({ companyId: z.string(), paymentTermsDays: z.coerce.number().int().min(0).max(180), creditLimit: z.coerce.number().min(0).nullable() }),
  handler: async (ctx, i) => done(await payments.setCustomerTerms(ctx, i.companyId, i.paymentTermsDays, i.creditLimit)),
});
