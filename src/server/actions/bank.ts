"use server";
/** Bank reconciliation actions (Phase 37). Who may do what is checked again in the services (FIRINGI finance / the company's own bank). */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction, runAction } from "./_action";
import * as S from "@/server/bank/service";
import * as M from "@/server/bank/match";
import { ValidationError } from "@/server/errors";
import { BANK_CATEGORIES } from "@/lib/bank/settings";

const id = z.string().min(1).max(64);
const done = <T>(v: T) => { revalidatePath("/admin/finance/bank", "layout"); revalidatePath("/vendor/finance/bank", "layout"); revalidatePath("/buy/finance/bank", "layout"); return v; };
const kind = z.enum(["CUSTOMER_PAYMENT", "VENDOR_PAYOUT", "PAYMENT", "FIRINGI_INVOICE", "ENTRY", "FEE", "OTHER"]);
const money = z.number().finite().min(-100_000_000).max(100_000_000);
const mapping = z.object({
  headerRow: z.number().int().min(1).max(50), date: z.string().max(120), valueDate: z.string().max(120).nullable().optional(), amount: z.string().max(120).nullable().optional(),
  debit: z.string().max(120).nullable().optional(), credit: z.string().max(120).nullable().optional(), counterparty: z.string().max(120).nullable().optional(), iban: z.string().max(120).nullable().optional(),
  remittance: z.array(z.string().max(120)).max(6).optional(), reference: z.string().max(120).nullable().optional(), dateOrder: z.enum(["DMY", "MDY", "YMD"]), decimal: z.enum([",", "."]), sign: z.string().max(120).nullable().optional(),
});

// ── accounts ──
export const saveBankAccountAction = defineAction({
  permission: null,
  schema: z.object({ id: id.nullable(), name: z.string().max(80), iban: z.string().max(42), bic: z.string().max(11).nullable(), currencyCode: z.string().length(3), legalEntityId: id.nullable().optional(), active: z.boolean().optional() }),
  handler: async (ctx, i) => { const a = await S.saveAccount(ctx, i); return done({ id: a.id }); },
});
export const deleteBankAccountAction = defineAction({ permission: null, schema: z.object({ id }), handler: async (ctx, i) => done(await S.deleteAccount(ctx, i.id)) });
export const setAutoBookAction = defineAction({
  permission: null, schema: z.object({ id, on: z.boolean() }),
  handler: async (ctx, i) => {
    const owner = S.ownerOf(ctx, true);
    if (owner.side === "FIRINGI") throw new ValidationError("FIRINGI's accounts follow the reconciliation settings.");
    const a = await S.accountFor(owner, i.id);
    const { prisma } = await import("@/server/db");
    await prisma.bankAccount.update({ where: { id: a.id }, data: { autoBook: i.on } });
    if (i.on) await M.matchLines(owner, (await prisma.bankLine.findMany({ where: { accountId: a.id, status: { in: ["OPEN", "SUGGESTED"] } }, select: { id: true } })).map((l) => l.id));
    return done(true);
  },
});

// ── import (FormData: accountId, file) ──
export async function importStatementAction(fd: FormData) {
  return runAction(async (ctx) => {
    const accountId = String(fd.get("accountId") ?? "");
    const f = fd.get("file");
    if (!(f instanceof File) || !f.size) throw new ValidationError("Choose a statement file.");
    const r = await S.importStatement(ctx, accountId, { name: f.name, buf: Buffer.from(await f.arrayBuffer()) }, null, { remap: fd.get("remap") === "1" });
    return done(r);
  });
}
export const importWithMappingAction = defineAction({
  permission: null, schema: z.object({ accountId: id, token: z.string().max(64), mapping }),
  handler: async (ctx, i) => done(await S.importStatement(ctx, i.accountId, { token: i.token }, { ...i.mapping, remittance: i.mapping.remittance ?? [] })),
});

// ── feed ──
export const feedInstitutionsAction = defineAction({ permission: null, schema: z.object({ country: z.string().length(2) }), handler: async (ctx, i) => S.feedInstitutions(ctx, i.country) });
export const linkFeedAction = defineAction({ permission: null, schema: z.object({ accountId: id, institutionId: z.string().max(80), returnTo: z.string().max(200).regex(/^\/(admin|vendor|buy)\//) }), handler: async (ctx, i) => S.linkFeed(ctx, i.accountId, i.institutionId, i.returnTo) });
export const unlinkFeedAction = defineAction({ permission: null, schema: z.object({ accountId: id }), handler: async (ctx, i) => { await S.unlinkFeed(ctx, i.accountId); return done(true); } });
export const syncFeedAction = defineAction({ permission: null, schema: z.object({ accountId: id }), handler: async (ctx, i) => done(await S.syncFeedNow(ctx, i.accountId)) });

// ── lines ──
const proposal = z.object({
  kind, companyId: id.nullable().optional(), companyName: z.string().max(200).nullable().optional(),
  items: z.array(z.object({ id, amount: money, label: z.string().max(200).optional() })).max(200),
  credit: money.optional(), orderId: id.nullable().optional(), orderNumber: z.string().max(40).nullable().optional(),
  rest: z.object({ amount: money, kind: z.enum(["FEE", "OTHER"]), category: z.enum(BANK_CATEGORIES).nullable().optional() }).nullable().optional(),
  category: z.string().max(40).nullable().optional(), label: z.string().max(120).nullable().optional(), ruleId: id.nullable().optional(),
  confidence: z.number().min(0).max(100), reasons: z.array(z.object({ k: z.string().max(40), v: z.record(z.union([z.string().max(300), z.number()])).optional() })).max(10),
});
export const confirmMatchAction = defineAction({ permission: null, schema: z.object({ lineId: id, proposal }), handler: async (ctx, i) => done(await M.confirmMatch(ctx, i.lineId, i.proposal)) });
export const unmatchAction = defineAction({ permission: null, schema: z.object({ lineId: id }), handler: async (ctx, i) => { await M.unmatch(ctx, i.lineId); return done(true); } });
export const ignoreLineAction = defineAction({ permission: null, schema: z.object({ lineId: id, note: z.string().max(300).nullable() }), handler: async (ctx, i) => { await M.ignoreLine(ctx, i.lineId, i.note); return done(true); } });
export const lineProposalsAction = defineAction({ permission: null, schema: z.object({ lineId: id }), handler: async (ctx, i) => M.lineProposals(ctx, i.lineId) });
export const matchOptionsAction = defineAction({
  permission: null, schema: z.object({ lineId: id, kind, companyId: id.nullable().optional(), q: z.string().max(80).nullable().optional() }),
  handler: async (ctx, i) => (await M.matchOptions(ctx, i.lineId, i)).map((o) => ({ ...o, date: o.date ? o.date.toISOString().slice(0, 10) : null })),
});
export const matchCompaniesAction = defineAction({ permission: null, schema: z.object({ q: z.string().max(80) }), handler: async (ctx, i) => M.matchCompanies(ctx, i.q) });
export const rematchAction = defineAction({ permission: null, schema: z.object({}), handler: async (ctx) => done(await M.rematchAll(ctx)) });

// ── rules & remembered payers ──
export const saveBankRuleAction = defineAction({
  permission: null,
  schema: z.object({ id: id.nullable(), name: z.string().max(80), contains: z.string().max(80), direction: z.enum(["IN", "OUT"]).nullable(), kind: z.enum(["FEE", "OTHER"]), category: z.enum(BANK_CATEGORIES).nullable(), active: z.boolean().optional() }),
  handler: async (ctx, i) => { const r = await S.saveRule(ctx, i); return done({ id: r.id }); },
});
export const deleteBankRuleAction = defineAction({ permission: null, schema: z.object({ id }), handler: async (ctx, i) => { await S.deleteRule(ctx, i.id); return done(true); } });
export const deletePayerLinkAction = defineAction({ permission: null, schema: z.object({ id }), handler: async (ctx, i) => { await S.deletePayerLink(ctx, i.id); return done(true); } });

// ── FIRINGI settings ──
export const saveBankSettingsAction = defineAction({
  permission: ["admin.finance.manage", "admin.settings.manage"],
  schema: z.object({
    firingiMode: z.enum(["AUTO", "CONFIRM"]), autoConfidence: z.number(), companiesMayAuto: z.boolean(), companyAutoConfidence: z.number(),
    toleranceAmount: z.number(), tolerancePct: z.number(), windowDays: z.number(),
    feed: z.object({ enabled: z.boolean(), provider: z.enum(["SIMULATED", "GOCARDLESS"]), companiesMayLink: z.boolean() }),
  }),
  handler: async (ctx, i) => done(await S.saveBankSettings(ctx, i)),
});
