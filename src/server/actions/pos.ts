"use server";
/** Till (POS) actions (Phase 47). Rights and FIRINGI's switches are checked again in the service. */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction } from "./_action";
import * as S from "@/server/pos/service";
import { emailReceipt, recordSale, refundSale } from "@/server/pos/sales";
import { retryFiscal } from "@/server/pos/fiscal";
import { savePosSettings } from "@/server/pos/settings";
import { POS_FEATURES, POS_PROVIDERS, RECIPE_UNITS } from "@/lib/pos";
import { SCHENGEN } from "@/lib/einvoice";

const SELL = ["company.pos.sell", "company.pos.manage"] as const;
const MANAGE = "company.pos.manage" as const;
const id = z.string().min(1).max(64);
const money = z.number().min(0).max(10_000_000);
const paths = (...p: string[]) => { for (const base of ["/vendor/pos", "/buy/pos"]) { revalidatePath(base); for (const x of p) revalidatePath(`${base}/${x}`); } return true; };

const countrySchema = z.object({ enabled: z.boolean(), stage: z.enum(["NONFISCAL", "PROVIDER"]), provider: z.enum(POS_PROVIDERS).nullable(), fallbackNonFiscal: z.boolean() });
const settingsSchema = z.object({
  enabled: z.boolean(),
  types: z.object({ DISTRIBUTOR: z.boolean(), WHOLESALER: z.boolean(), CUSTOMER: z.boolean() }),
  countries: z.object(Object.fromEntries(SCHENGEN.map((c) => [c, countrySchema])) as Record<string, typeof countrySchema>),
  features: z.object(Object.fromEntries(POS_FEATURES.map((f) => [f, z.boolean()])) as Record<string, z.ZodBoolean>),
  offlineHours: z.number().int().min(1).max(168), offlineMaxSales: z.number().int().min(10).max(5000), tillsWithoutApproval: z.number().int().min(0).max(100),
});
const stateSchema = z.object({ companyId: id, state: z.enum(["DEFAULT", "ON", "OFF"]) });
const idSchema = z.object({ id });
const lineSchema = z.object({ itemId: id.nullable().optional(), name: z.string().max(120).nullable().optional(), qty: z.number().positive().max(100_000), unitPrice: money, discountPct: z.number().min(0).max(100).optional(), vatRate: z.number().min(0).max(50).nullable().optional() });
const paymentSchema = z.object({ method: z.enum(["CASH", "CARD", "MBWAY", "VOUCHER", "POINTS", "OTHER"]), amount: money, tendered: money.nullable().optional(), ref: z.string().max(80).nullable().optional() });
const saleSchema = z.object({
  clientId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/), registerId: id, shiftId: id, n: z.number().int().min(1).max(1_000_000), soldAt: z.string().max(40),
  lines: z.array(lineSchema).min(1).max(300), saleDiscountPct: z.number().min(0).max(100).optional(), payments: z.array(paymentSchema).max(10),
  customerTaxId: z.string().max(32).nullable().optional(), customerName: z.string().max(120).nullable().optional(), customerEmail: z.string().max(200).nullable().optional(),
  memberId: id.nullable().optional(), pointsUsed: z.number().int().min(0).max(100_000_000).optional(), ageChecked: z.boolean().optional(), tableRef: z.string().max(40).nullable().optional(),
  note: z.string().max(300).nullable().optional(), approvedById: id.nullable().optional(), ticketId: id.nullable().optional(),
});
const refundSchema = z.object({
  clientId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/), saleId: id, registerId: id, shiftId: id, n: z.number().int().min(1).max(1_000_000),
  lines: z.array(z.object({ lineId: id, qty: z.number().positive().max(100_000) })).min(1).max(300), method: paymentSchema.shape.method, reason: z.string().min(1).max(300), restock: z.boolean().optional(), approvedById: id.nullable().optional(),
});
const openSchema = z.object({ registerId: id, openingFloat: money });
const closeSchema = z.object({ shiftId: id, countedCash: money, note: z.string().max(300).nullable().optional() });
const cashSchema = z.object({ shiftId: id, kind: z.enum(["PAY_IN", "PAY_OUT", "NO_SALE"]), amount: z.number().min(0).max(10_000_000), reason: z.string().max(200).nullable().optional(), approvedById: id.nullable().optional() });
const itemSchema = z.object({
  id: id.nullable().optional(), name: z.string().min(1).max(80), category: z.string().max(40).nullable().optional(), barcode: z.string().max(40).nullable().optional(), plu: z.string().max(6).nullable().optional(),
  price: money, vatRate: z.number().min(0).max(50), byWeight: z.boolean().optional(), offerId: id.nullable().optional(), stockPerUnit: z.number().positive().max(10_000).optional(),
  restriction: z.enum(["ALCOHOL", "TOBACCO"]).nullable().optional(), allergens: z.array(z.string().max(30)).max(20).optional(), color: z.string().max(7).nullable().optional(),
  quick: z.boolean().optional(), kitchen: z.boolean().optional(), active: z.boolean().optional(), sortOrder: z.number().int().min(-1000).max(100000).optional(),
  registerIds: z.array(id).max(100).optional(),
});
const recipeSchema = z.object({ itemId: id, lines: z.array(z.object({ offerId: id, qty: z.number().positive().max(10_000), unit: z.enum(RECIPE_UNITS) })).max(30) });
const memberSchema = z.object({ id: id.nullable().optional(), name: z.string().min(1).max(80), code: z.string().max(32).nullable().optional(), phone: z.string().max(30).nullable().optional(), email: z.string().max(200).nullable().optional(), consent: z.boolean() });
const registerSchema = z.object({ id: id.nullable().optional(), name: z.string().min(1).max(60), code: z.string().min(1).max(6), addressId: id.nullable().optional(), branchId: id.nullable().optional(), active: z.boolean().optional() });
const peopleSchema = z.object({ registerId: id, users: z.array(z.object({ userId: id, role: z.enum(["SELL", "MANAGE"]) })).max(200) });
const companySchema = z.object({
  receiptHeader: z.string().max(300).nullable().optional(), receiptFooter: z.string().max(300).nullable().optional(), loyaltyOn: z.boolean().optional(),
  pointsPerUnit: z.number().min(0).max(100).optional(), pointValue: z.number().min(0).max(100).optional(), minRedeem: z.number().int().min(0).max(1_000_000).optional(),
  discountLimit: z.number().min(0).max(100).optional(), refundDays: z.number().int().min(0).max(365).optional(), emailReceipts: z.boolean().optional(), postToAccounting: z.boolean().optional(),
});
const fiscalSchema = z.object({ provider: z.enum(POS_PROVIDERS).nullable(), account: z.string().max(120), secret: z.string().max(500) });
const pinSchema = z.object({ userId: id, pin: z.string().regex(/^\d{4,8}$/) });
const verifySchema = z.object({ pin: z.string().regex(/^\d{4,8}$/), manager: z.boolean().optional() });
const ticketSchema = z.object({ id: id.nullable().optional(), registerId: id, label: z.string().min(1).max(40), lines: z.array(z.record(z.string(), z.unknown())).max(300), sentLines: z.number().int().min(0).max(300).optional() });
const emailSchema = z.object({ saleId: id, email: z.string().max(200) });
const cartSchema = z.object({ offerId: id, qty: z.number().int().min(1).max(10_000) });
const emptySchema = z.object({});

// ── FIRINGI ──
export const savePosSettingsAction = defineAction({ permission: "admin.settings.manage", schema: settingsSchema, handler: async (ctx, i) => { await savePosSettings(ctx, i); revalidatePath("/admin/pos"); revalidatePath("/admin/pos/settings"); return true; } });
export const setPosCompanyStateAction = defineAction({ permission: "admin.settings.manage", schema: stateSchema, handler: async (ctx, i) => { const r = await S.setPosCompanyState(ctx, i.companyId, i.state); revalidatePath("/admin/pos/companies"); return r; } });
export const decideTillAction = defineAction({ permission: "admin.settings.manage", schema: z.object({ id, approve: z.boolean(), note: z.string().max(300).nullable().optional() }), handler: async (ctx, i) => { const r = await S.decideTill(ctx, i.id, i.approve, i.note); revalidatePath("/admin/pos/companies"); revalidatePath("/admin/pos"); return r; } });
export const adminRetryPosFiscalAction = defineAction({ permission: ["admin.settings.manage", "admin.finance.manage"], schema: idSchema, handler: async (ctx, i) => { const r = await retryFiscal(ctx, i.id); revalidatePath("/admin/pos/fiscal"); return r; } });

// ── the till ──
export const posSaleAction = defineAction({ permission: [...SELL], schema: saleSchema, handler: async (ctx, i) => recordSale(ctx, i) });
export const posRefundAction = defineAction({ permission: [...SELL], schema: refundSchema, handler: async (ctx, i) => { const r = await refundSale(ctx, i); paths("sales"); return r; } });
export const openShiftAction = defineAction({ permission: [...SELL], schema: openSchema, handler: async (ctx, i) => { const r = await S.openShift(ctx, i.registerId, i.openingFloat); paths("shifts"); return r; } });
export const closeShiftAction = defineAction({ permission: [...SELL], schema: closeSchema, handler: async (ctx, i) => { const r = await S.closeShift(ctx, i); paths("shifts"); return r; } });
export const shiftReportAction = defineAction({ permission: [...SELL], schema: idSchema, handler: async (ctx, i) => S.shiftReport(ctx, i.id) });
export const cashMoveAction = defineAction({ permission: [...SELL], schema: cashSchema, handler: async (ctx, i) => S.cashMove(ctx, i) });
export const verifyPinAction = defineAction({ permission: [...SELL], schema: verifySchema, handler: async (ctx, i) => S.verifyPin(ctx, i.pin, !!i.manager) });
export const setPinAction = defineAction({ permission: [...SELL], schema: pinSchema, handler: async (ctx, i) => { await S.setPin(ctx, i.userId, i.pin); paths("settings"); return true; } });
export const saveTicketAction = defineAction({ permission: [...SELL], schema: ticketSchema, handler: async (ctx, i) => S.saveTicket(ctx, i) });
export const deleteTicketAction = defineAction({ permission: [...SELL], schema: idSchema, handler: async (ctx, i) => S.deleteTicket(ctx, i.id) });
export const saveMemberAction = defineAction({ permission: [...SELL], schema: memberSchema, handler: async (ctx, i) => { const r = await S.saveMember(ctx, i); paths("guests"); return r; } });
export const emailReceiptAction = defineAction({ permission: [...SELL], schema: emailSchema, handler: async (ctx, i) => { await S.saleDetail(ctx, i.saleId); return emailReceipt(i.saleId, i.email.trim()); } });
export const tillSnapshotAction = defineAction({ permission: [...SELL], schema: z.object({ registerId: id.nullable().optional() }), handler: async (ctx, i) => S.tillSnapshot(ctx, i.registerId ?? null) });
export const saleDetailAction = defineAction({ permission: [...SELL], schema: idSchema, handler: async (ctx, i) => S.saleDetail(ctx, i.id) });
export const retryPosFiscalAction = defineAction({ permission: MANAGE, schema: idSchema, handler: async (ctx, i) => { const r = await retryFiscal(ctx, i.id); paths("sales"); return r; } });

// ── set-up ──
export const saveItemAction = defineAction({ permission: MANAGE, schema: itemSchema, handler: async (ctx, i) => { const r = await S.saveItem(ctx, i); paths("items"); return r; } });
export const saveRecipeAction = defineAction({ permission: MANAGE, schema: recipeSchema, handler: async (ctx, i) => { const r = await S.saveRecipe(ctx, i.itemId, i.lines); paths("items", "stock"); return r; } });
export const importCatalogueAction = defineAction({ permission: MANAGE, schema: emptySchema, handler: async (ctx) => { const r = await S.importFromCatalogue(ctx, ctx.user.locale ?? "en"); paths("items"); return r; } });
export const saveRegisterAction = defineAction({ permission: MANAGE, schema: registerSchema, handler: async (ctx, i) => { const r = await S.saveRegister(ctx, i); paths("settings"); return r; } });
export const setRegisterUsersAction = defineAction({ permission: MANAGE, schema: peopleSchema, handler: async (ctx, i) => { const r = await S.setRegisterUsers(ctx, i.registerId, i.users); paths("settings"); return r; } });
export const addTillEmployeeAction = defineAction({ permission: [...SELL], schema: z.object({ name: z.string().min(1).max(80), email: z.string().max(200), password: z.string().min(1).max(200), registerIds: z.array(id).min(1).max(50), role: z.enum(["SELL", "MANAGE"]) }), handler: async (ctx, i) => { const { addTillEmployee } = await import("@/server/pos/staff"); const r = await addTillEmployee(ctx, i); paths("staff", "settings"); return r; } });
export const removeFromTillAction = defineAction({ permission: [...SELL], schema: z.object({ registerId: id, userId: id }), handler: async (ctx, i) => { const { removeFromTill } = await import("@/server/pos/staff"); const r = await removeFromTill(ctx, i.registerId, i.userId); paths("staff"); return r; } });
export const savePosCompanyAction = defineAction({ permission: MANAGE, schema: companySchema, handler: async (ctx, i) => { const r = await S.savePosCompany(ctx, i); paths("settings"); return r; } });
export const saveFiscalConnectionAction = defineAction({ permission: MANAGE, schema: fiscalSchema, handler: async (ctx, i) => { const r = await S.saveFiscalConnection(ctx, i); paths("settings"); return r; } });
export const testFiscalAction = defineAction({ permission: MANAGE, schema: emptySchema, handler: async (ctx) => { const { testConnection } = await import("@/server/pos/fiscal"); const r = await testConnection(ctx.company.id); paths("settings"); return r; } });
export const reorderAction = defineAction({ permission: [MANAGE], schema: cartSchema, handler: async (ctx, i) => { const { addToCart } = await import("@/server/services/cart"); await addToCart(ctx, i.offerId, i.qty); revalidatePath("/buy/cart"); return true; } });
