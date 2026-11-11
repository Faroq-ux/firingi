"use server";
/** Certified invoicing (Moloni) settings, retries; supplier payouts (services re-check access). */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction } from "./_action";
import * as fiscal from "@/server/invoicing/fiscal";
import { recordPayment } from "@/server/services/finance";

const done = <T>(v: T) => { revalidatePath("/", "layout"); return v; };
const id = z.number().int().positive().nullable();

export const saveFiscalSettingsAction = defineAction({
  permission: ["admin.settings.manage", "admin.tax.manage"],
  schema: z.object({
    provider: z.enum(["internal", "moloni"]),
    moloni: z.object({ companyId: id, invoiceSetId: id, creditNoteSetId: id, maturityDateId: id, paymentMethodId: id, categoryId: id, unitId: id, exemptionReason: z.string().trim().min(2).max(10), taxMap: z.record(z.string(), z.number().int().positive()) }),
  }),
  handler: async (ctx, i) => done(await fiscal.saveFiscalSettings(ctx, i)),
});
export const retryFiscalAction = defineAction({ permission: ["admin.settings.manage", "admin.tax.manage"], schema: z.object({ invoiceId: z.string() }), handler: async (ctx, i) => done(await fiscal.retryFiscal(ctx, i.invoiceId)) });
export const runFiscalQueueAction = defineAction({ permission: ["admin.settings.manage", "admin.tax.manage"], schema: z.object({}), handler: async () => done(await fiscal.processFiscalQueue(50)) });
/** Pay one approved supplier invoice in full by bank transfer (four-eyes above the threshold). */
export const payVendorInvoiceAction = defineAction({
  permission: "admin.finance.manage",
  schema: z.object({ vendorInvoiceId: z.string(), vendorId: z.string(), amount: z.number().positive(), reference: z.string().trim().max(100).optional().nullable(), paidAt: z.string() }),
  handler: async (ctx, i) => done(await recordPayment(ctx, { direction: "OUTBOUND", companyId: i.vendorId, method: "BANK_TRANSFER", amount: i.amount, reference: i.reference ?? null, paidAt: new Date(i.paidAt), allocations: [{ documentId: i.vendorInvoiceId, amount: i.amount }] })),
});
