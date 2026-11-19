"use server";
/** E-invoicing actions (Phase 46). Rights are checked again in the service. */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction } from "./_action";
import * as S from "@/server/einvoice/service";
import { FORMATS, PROVIDERS, SCHENGEN } from "@/lib/einvoice";

const ADMIN = "/admin/invoices/e-invoicing";
const done = (extra: string[] = []) => { for (const p of [ADMIN, `${ADMIN}/settings`, `${ADMIN}/archive`, `${ADMIN}/inbound`, ...extra]) revalidatePath(p); return true; };

const routeSchema = z.object({ enabled: z.boolean(), format: z.enum(FORMATS), provider: z.enum(PROVIDERS), mandatory: z.boolean(), emailCopy: z.boolean() });
const settingsSchema = z.object({
  enabled: z.boolean(),
  documents: z.object({ customerInvoices: z.boolean(), creditNotes: z.boolean(), serviceInvoices: z.boolean(), selfBilling: z.boolean(), receiveSupplier: z.boolean() }),
  countries: z.object(Object.fromEntries(SCHENGEN.map((c) => [c, routeSchema])) as Record<string, typeof routeSchema>),
  validateBeforeSend: z.boolean(), blockOnWarnings: z.boolean(),
  retention: z.object(Object.fromEntries(SCHENGEN.map((c) => [c, z.number().int().min(1).max(30)])) as Record<string, z.ZodNumber>),
  languagePriority: z.array(z.enum(["CUSTOMER_COUNTRY", "CUSTOMER_CHOICE", "ENTITY"])).min(1).max(3),
  allowCustomerLanguage: z.boolean(), allowBilingual: z.boolean(),
  plSplitPaymentFrom: z.number().int().min(0).max(10_000_000), autoMatchTolerance: z.number().min(0).max(100),
});
const idSchema = z.object({ id: z.string().min(1).max(64) });
const invoiceSchema = z.object({ invoiceId: z.string().min(1).max(64) });
const profileSchema = z.object({
  companyId: z.string().min(1).max(64).optional(),
  delivery: z.enum(["EINVOICE", "EMAIL", "BOTH"]), peppolId: z.string().max(80).nullable(), invoiceLanguage: z.string().max(8).nullable(), secondLanguage: z.string().max(8).nullable(),
  ksefNip: z.string().max(20).nullable(), sdiCode: z.string().max(10).nullable(), pecEmail: z.string().max(200).nullable(), leitwegId: z.string().max(60).nullable(), invoiceEmail: z.string().max(200).nullable(),
  selfBilling: z.boolean().optional(), selfBillingAgreement: z.string().max(80).nullable().optional(),
});
const simSchema = z.object({ statementId: z.string().min(1).max(64), netDelta: z.number().min(-100000).max(100000).optional() });
const entitySchema = z.object({ id: z.string().min(1).max(64), language: z.string().max(8).nullable(), secondLanguage: z.string().max(8).nullable(), requireOwnLanguage: z.boolean(), peppolId: z.string().max(80).nullable() });
const emptySchema = z.object({});

export const saveEInvoiceSettingsAction = defineAction({
  permission: ["admin.settings.manage", "admin.tax.manage"],
  schema: settingsSchema,
  handler: async (ctx, i) => { await S.saveEInvoiceSettings(ctx, i); return done(); },
});

export const resendEInvoiceAction = defineAction({
  permission: ["admin.finance.manage", "admin.invoices.issue", "admin.settings.manage", "admin.tax.manage"],
  schema: idSchema,
  handler: async (ctx, i) => { const r = await S.resendDocument(ctx, i.id); done([`${ADMIN}/${i.id}`]); return { status: r }; },
});

export const checkEInvoiceAction = defineAction({
  permission: ["admin.finance.view", "admin.invoices.view", "admin.tax.manage", "admin.settings.manage"],
  schema: idSchema,
  handler: async (ctx, i) => { const r = await S.checkDocument(ctx, i.id); return { findings: r.findings }; },
});

export const sendExistingInvoiceAction = defineAction({
  permission: ["admin.finance.manage", "admin.invoices.issue", "admin.settings.manage", "admin.tax.manage"],
  schema: invoiceSchema,
  handler: async (ctx, i) => { const r = await S.sendExisting(ctx, i.invoiceId); done(); return { status: r }; },
});

export const runEInvoiceQueueAction = defineAction({
  permission: ["admin.finance.manage", "admin.settings.manage", "admin.tax.manage"],
  schema: emptySchema,
  handler: async () => { const r = await S.processEInvoiceQueue(100); done(); return r; },
});

export const saveEInvoiceProfileAction = defineAction({
  permission: null, // own company (settings rights) or FIRINGI staff — checked in the service
  schema: profileSchema,
  handler: async (ctx, i) => {
    const { companyId, ...input } = i;
    await S.saveProfile(ctx, input, companyId ?? ctx.company.id);
    for (const p of ["/buy/settings/e-invoicing", "/vendor/settings/e-invoicing", `/admin/companies/${companyId ?? ""}`]) revalidatePath(p);
    return true;
  },
});

export const simulateSupplierEInvoiceAction = defineAction({
  permission: ["admin.finance.manage", "admin.settings.manage"],
  schema: simSchema,
  handler: async (ctx, i) => { const d = await S.simulateSupplierEInvoice(ctx, i.statementId, { netDelta: i.netDelta }); done(); return { id: d?.id ?? null, status: d?.status ?? null }; },
});

export const verifyArchiveAction = defineAction({
  permission: ["admin.finance.view", "admin.invoices.view", "admin.tax.manage", "admin.settings.manage"],
  schema: emptySchema,
  handler: async (ctx) => S.verifyArchive(ctx),
});

export const saveEntityEInvoiceAction = defineAction({
  permission: ["admin.settings.manage", "admin.tax.manage"],
  schema: entitySchema,
  handler: async (ctx, i) => { const { id, ...rest } = i; await S.saveEntityEInvoice(ctx, id, rest); return done(); },
});
