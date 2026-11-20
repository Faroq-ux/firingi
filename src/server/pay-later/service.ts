/**
 * Pay later (Phase 50). A buyer chooses a term at checkout (N days or monthly instalments); FIRINGI finances it
 * through a payment gateway's "buy now, pay later" partner (the partner pays FIRINGI when the invoice is issued and
 * collects from the buyer) or with its own credit (FIRINGI waits for the buyer's payments, per instalment). Per
 * country FIRINGI switches each model on / off and picks which is tried first; when the first declines, the other is
 * tried. The fee (FIRINGI's settings per term) is paid by the buyer (a line on its invoice), by FIRINGI, or shared.
 * Every part is FIRINGI's switch: the feature, each term, buyer types, models per country, each business.
 */
import "server-only";
import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";
import { notify } from "@/server/notify/dispatch";
import { activePartner } from "./partner";
import { cleanPayLater, countryModels, feeFor, lastDueDays, mergePayLater, modelOrder, schedule, type PayLaterSettings, type PayLaterTerm } from "@/lib/pay-later";

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
const KEY = "paylater.settings";
const FEATURE = "PAY_LATER";
const LIVE = ["ACTIVE", "INVOICED", "OVERDUE"] as const;
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const nameOf = (c: { tradeName: string | null; legalName: string }) => c.tradeName ?? c.legalName;

export function termLabel(t: Pick<PayLaterTerm, "kind" | "days" | "count">) { return t.kind === "DAYS" ? `${t.days} days` : `${t.count} monthly instalments`; }

// ── settings & switches ─────────────────────────────────────────────────────

export async function payLaterSettings(): Promise<PayLaterSettings> {
  const row = await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: KEY } });
  return mergePayLater(row?.value as Partial<PayLaterSettings> | null);
}

function staff(ctx: Ctx, manage = false) {
  if (ctx.company.type !== "ADMIN") throw new ForbiddenError();
  if (!can(ctx, manage ? ["admin.finance.manage", "admin.settings.manage"] : ["admin.finance.view", "admin.finance.manage", "admin.settings.manage"])) throw new ForbiddenError();
}

export async function savePayLaterSettings(ctx: Ctx, input: PayLaterSettings) {
  staff(ctx, true);
  let v: PayLaterSettings;
  try { v = cleanPayLater(input); } catch (e) { throw new ValidationError((e as Error).message); }
  const before = await payLaterSettings();
  const row = await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: KEY } });
  if (row) await prisma.setting.update({ where: { id: row.id }, data: { value: v } });
  else await prisma.setting.create({ data: { scope: "GLOBAL", scopeId: "", key: KEY, value: v } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "paylater.settings_saved", entityType: "Setting", entityId: KEY, before, after: v });
  return v;
}

export async function companySwitch(companyId: string): Promise<"DEFAULT" | "ON" | "OFF"> {
  const f = await prisma.companyFeature.findUnique({ where: { companyId_key: { companyId, key: FEATURE } } });
  return !f ? "DEFAULT" : f.enabled ? "ON" : "OFF";
}

export async function setCompanySwitch(ctx: Ctx, companyId: string, state: "DEFAULT" | "ON" | "OFF") {
  staff(ctx, true);
  const co = await prisma.company.findUnique({ where: { id: companyId }, select: { type: true } });
  if (!co || (co.type !== "CUSTOMER" && co.type !== "WHOLESALER")) throw new NotFoundError("Business");
  if (state === "DEFAULT") await prisma.companyFeature.deleteMany({ where: { companyId, key: FEATURE } });
  else await prisma.companyFeature.upsert({ where: { companyId_key: { companyId, key: FEATURE } }, create: { companyId, key: FEATURE, enabled: state === "ON", updatedById: ctx.user.id }, update: { enabled: state === "ON", updatedById: ctx.user.id } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "paylater.company_switch", entityType: "Company", entityId: companyId, after: { state } });
}

/** FIRINGI's own credit limit for one business (null = the default for its type). */
export async function setOwnLimit(ctx: Ctx, companyId: string, limit: number | null) {
  staff(ctx, true);
  if (limit != null && !(limit >= 0 && limit <= 1e7)) throw new ValidationError("Check the limit.");
  await prisma.payLaterAccount.upsert({ where: { companyId }, create: { companyId, ownLimit: limit == null ? null : limit.toFixed(2) }, update: { ownLimit: limit == null ? null : limit.toFixed(2) } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "paylater.own_limit", entityType: "Company", entityId: companyId, after: { limit } });
}

// ── standing ────────────────────────────────────────────────────────────────

type Co = { id: string; type: string; countryId: string; taxId: string | null; payBeforeShipping?: boolean };

export async function access(co: { id: string; type: string }, s?: PayLaterSettings) {
  const set = s ?? (await payLaterSettings());
  if (!set.enabled || (co.type !== "CUSTOMER" && co.type !== "WHOLESALER")) return { ok: false, why: "OFF" as const };
  const sw = await companySwitch(co.id);
  if (sw === "OFF") return { ok: false, why: "COMPANY_OFF" as const };
  if (sw !== "ON" && !set.buyers[co.type as "CUSTOMER" | "WHOLESALER"]) return { ok: false, why: "TYPE_OFF" as const };
  if (await prisma.payLaterPlan.count({ where: { companyId: co.id, status: "OVERDUE" } })) return { ok: false, why: "OVERDUE" as const };
  return { ok: true, why: null };
}

/** What the business still owes FIRINGI on its own-credit plans. */
export async function ownExposure(companyId: string, db: Tx | typeof prisma = prisma) {
  const plans = await db.payLaterPlan.findMany({ where: { companyId, model: "OWN", status: { in: [...LIVE] } }, include: { instalments: { where: { paidAt: null }, select: { amount: true } } } });
  return r2(plans.reduce((a, p) => a + (p.status === "ACTIVE" ? Number(p.amount) + Number(p.buyerFee) : p.instalments.reduce((b, i) => b + Number(i.amount), 0)), 0));
}

export async function ownLimitFor(co: { id: string; type: string }, s: PayLaterSettings) {
  const acc = await prisma.payLaterAccount.findUnique({ where: { companyId: co.id } });
  return acc?.ownLimit != null ? Number(acc.ownLimit) : s.ownLimit[co.type as "CUSTOMER" | "WHOLESALER"] ?? 0;
}

async function countryCode(countryId: string) { return (await prisma.country.findUniqueOrThrow({ where: { id: countryId }, select: { code: true } })).code; }

/** The pay-later options at checkout for this gross amount (fees for the buyer, schedule preview). */
export async function checkoutOptions(ctx: Ctx, gross: number) {
  const s = await payLaterSettings();
  const a = await access(ctx.company, s);
  const co = await prisma.company.findUniqueOrThrow({ where: { id: ctx.company.id }, select: { payBeforeShipping: true, countryId: true } });
  const models = modelOrder(countryModels(s, await countryCode(co.countryId))).filter((m) => m === "PARTNER" ? !!activePartner() : !co.payBeforeShipping);
  const limit = await ownLimitFor(ctx.company, s), used = await ownExposure(ctx.company.id);
  const why = !a.ok ? a.why : !models.length ? "NO_MODEL" : gross < s.minOrder ? "MIN_ORDER" : null;
  const now = new Date();
  return {
    available: !why, why, minOrder: s.minOrder,
    own: models.includes("OWN") ? { limit, used, left: r2(Math.max(0, limit - used)) } : null,
    terms: why ? [] : s.terms.filter((t) => t.enabled).map((t) => {
      const fee = feeFor(t, gross);
      return { id: t.id, kind: t.kind, days: t.days, count: t.count, fee: fee.buyer, schedule: schedule(t, now, gross + fee.buyer) };
    }),
  };
}

/**
 * Before the orders are created: pick the model for this checkout (first per country; the other when declined or
 * over the limit). Throws when pay later isn't possible for it.
 */
export async function preparePayLater(ctx: Ctx, termId: string, gross: number) {
  const s = await payLaterSettings();
  const a = await access(ctx.company, s);
  if (!a.ok) throw new ValidationError("Pay later isn't available for your business.");
  const term = s.terms.find((t) => t.id === termId && t.enabled);
  if (!term) throw new ValidationError("Choose one of the pay-later options.");
  if (gross < s.minOrder) throw new ValidationError(`Pay later starts from ${s.minOrder} €.`);
  const co = await prisma.company.findUniqueOrThrow({ where: { id: ctx.company.id }, select: { id: true, type: true, countryId: true, taxId: true, payBeforeShipping: true } }) as Co;
  const code = await countryCode(co.countryId);
  const fee = feeFor(term, gross);
  const reasons: string[] = [];
  for (const m of modelOrder(countryModels(s, code))) {
    if (m === "PARTNER") {
      const p = activePartner();
      if (!p) continue;
      const d = await p.authorize({ companyId: co.id, taxId: co.taxId, country: code, orderIds: [], amount: r2(gross + fee.buyer), termLabel: termLabel(term) });
      await prisma.payLaterAccount.upsert({ where: { companyId: co.id }, create: { companyId: co.id, partnerKey: p.key, partnerStatus: d.approved ? "APPROVED" : "DECLINED", partnerLimit: d.limit?.toFixed(2) ?? null, checkedAt: new Date() }, update: { partnerKey: p.key, partnerStatus: d.approved ? "APPROVED" : "DECLINED", partnerLimit: d.limit?.toFixed(2) ?? null, checkedAt: new Date() } });
      if (d.approved) return { model: "PARTNER" as const, term, partnerKey: p.key, partnerRef: d.ref ?? null };
      reasons.push(d.reason ?? "declined");
    } else {
      if (co.payBeforeShipping) continue;
      const left = (await ownLimitFor(co, s)) - (await ownExposure(co.id));
      if (left >= gross + fee.buyer) return { model: "OWN" as const, term, partnerKey: null, partnerRef: null };
      reasons.push("over the credit limit");
    }
  }
  throw new ValidationError(`Pay later isn't possible for this order (${reasons.join("; ") || "not offered"}). Choose another way to pay.`);
}
export type PreparedPayLater = Awaited<ReturnType<typeof preparePayLater>>;

/** In placeOrder's transaction: one plan per order (each order has its own invoice and fee). */
export async function createPlans(tx: Tx, ctx: Ctx, p: PreparedPayLater, orderIds: string[]) {
  for (const id of orderIds) {
    const o = await tx.order.findUniqueOrThrow({ where: { id }, select: { grandTotal: true } });
    const gross = Number(o.grandTotal), fee = feeFor(p.term, gross);
    await tx.payLaterPlan.create({ data: { orderId: id, companyId: ctx.company.id, model: p.model, term: p.term as object, partnerKey: p.partnerKey, partnerRef: p.partnerRef, amount: gross.toFixed(2), buyerFee: fee.buyer.toFixed(2), firingiFee: fee.firingi.toFixed(2), createdById: ctx.user.id } });
  }
}

/** For the order's invoice: the buyer's fee line (financing — VAT exempt) and the days until the last payment. */
export async function invoicePart(tx: Tx, orderId: string) {
  const plan = await tx.payLaterPlan.findUnique({ where: { orderId } });
  if (!plan || plan.status !== "ACTIVE") return null;
  const term = plan.term as unknown as PayLaterTerm;
  const fee = new Decimal(plan.buyerFee.toString());
  return {
    plan, dueDays: lastDueDays(term, new Date()),
    feeLine: fee.gt(0) ? { description: `Taxa de pagamento a prazo — ${term.kind === "DAYS" ? `${term.days} dias` : `${term.count} prestações mensais`} (isenta de IVA, art. 135.º, n.º 1, al. b) da Diretiva IVA)`, qty: new Decimal(1), unitPriceNet: fee, taxRate: new Decimal(0), lineNet: fee, lineVat: new Decimal(0) } : null,
  };
}

/** After the invoice: the schedule over the invoice's gross; a partner plan is then paid to FIRINGI by the partner (job). */
export async function afterInvoice(tx: Tx, planId: string, invoice: { id: string; grossTotal: unknown; issuedAt: Date | null }) {
  const plan = await tx.payLaterPlan.findUniqueOrThrow({ where: { id: planId } });
  const gross = Number(invoice.grossTotal), from = invoice.issuedAt ?? new Date();
  for (const i of schedule(plan.term as unknown as PayLaterTerm, from, gross))
    await tx.payLaterInstalment.create({ data: { planId, n: i.n, dueAt: i.dueAt, amount: i.amount.toFixed(2) } });
  await tx.payLaterPlan.update({ where: { id: planId }, data: { status: "INVOICED", invoiceId: invoice.id, amount: gross.toFixed(2) } });
}

// ── the job ─────────────────────────────────────────────────────────────────

/** Every 15 min: cancelled orders end their plans; partners pay invoiced plans; own-credit instalments are tracked, reminded and flagged overdue. */
export async function runPayLaterJob(now = new Date()) {
  const s = await payLaterSettings();
  const out = { cancelled: 0, captured: 0, paid: 0, reminded: 0, overdue: 0 };
  const partner = activePartner();
  for (const p of await prisma.payLaterPlan.findMany({ where: { status: "ACTIVE", order: { status: "CANCELLED" } } })) {
    await prisma.payLaterPlan.update({ where: { id: p.id }, data: { status: "CANCELLED" } });
    if (p.partnerRef && partner) await partner.cancel(p.partnerRef).catch(() => null);
    out.cancelled++;
  }
  const { openAmounts } = await import("@/server/payments/service");
  // partner plans: the partner pays FIRINGI the invoice
  for (const p of await prisma.payLaterPlan.findMany({ where: { model: "PARTNER", status: "INVOICED", invoiceId: { not: null } }, include: { order: { select: { buyerCompanyId: true } } } })) {
    const open = (await openAmounts([p.invoiceId!])).get(p.invoiceId!);
    if (!open || open.lte(0)) { await prisma.payLaterPlan.update({ where: { id: p.id }, data: { status: "PAID" } }); out.paid++; continue; }
    if (!partner || !p.partnerRef) continue;
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: p.invoiceId! }, select: { fullNumber: true } });
    const c = await partner.capture({ ref: p.partnerRef, invoiceNumber: inv.fullNumber ?? p.invoiceId!, amount: open.toNumber() }).catch(() => null);
    if (!c) continue;
    await prisma.$transaction(async (tx) => {
      const pay = await tx.payment.create({ data: { companyId: p.order.buyerCompanyId, direction: "INBOUND", method: "OTHER", amount: c.paid.toFixed(2), reference: `Pay later (${p.partnerKey}) ${c.reference}`.slice(0, 190), status: "CONFIRMED", paidAt: now, provider: `paylater:${p.partnerKey}` } });
      await tx.paymentAllocation.create({ data: { paymentId: pay.id, invoiceId: p.invoiceId!, amount: Decimal.min(open, new Decimal(c.paid)).toFixed(2) } });
      await tx.payLaterPlan.update({ where: { id: p.id }, data: { status: "PAID" } });
    });
    out.captured++;
  }
  // own credit: what the buyer paid covers the instalments in order
  const own = await prisma.payLaterPlan.findMany({ where: { model: "OWN", status: { in: ["INVOICED", "OVERDUE"] }, invoiceId: { not: null } }, include: { instalments: { orderBy: { n: "asc" } }, order: { select: { number: true } } } });
  const opens = await openAmounts(own.map((p) => p.invoiceId!));
  for (const p of own) {
    const total = p.instalments.reduce((a, i) => a + Number(i.amount), 0);
    let paid = r2(total - (opens.get(p.invoiceId!)?.toNumber() ?? 0)), late = false;
    for (const i of p.instalments) {
      const amt = Number(i.amount);
      if (paid + 0.005 >= amt) { paid = r2(paid - amt); if (!i.paidAt) await prisma.payLaterInstalment.update({ where: { id: i.id }, data: { paidAt: now } }); continue; }
      paid = 0;
      const days = (i.dueAt.getTime() - now.getTime()) / 86_400_000;
      if (days < -1 && !i.overdueAt) {
        await prisma.payLaterInstalment.update({ where: { id: i.id }, data: { overdueAt: now } });
        await notify("paylater.overdue", [{ companyId: p.companyId, link: "/buy/finance/pay-later" }], { number: p.order.number, n: i.n, amount: amt, date: i.dueAt.toISOString().slice(0, 10) }).catch(() => null);
        out.overdue++;
      } else if (days >= 0 && days <= s.remindDays && !i.remindedAt) {
        await prisma.payLaterInstalment.update({ where: { id: i.id }, data: { remindedAt: now } });
        await notify("paylater.due_soon", [{ companyId: p.companyId, link: "/buy/finance/pay-later" }], { number: p.order.number, n: i.n, amount: amt, date: i.dueAt.toISOString().slice(0, 10) }).catch(() => null);
        out.reminded++;
      }
      if (days < -1) late = true;
    }
    const allPaid = (opens.get(p.invoiceId!)?.toNumber() ?? 0) <= 0.005;
    const status = allPaid ? "PAID" : late ? "OVERDUE" : "INVOICED";
    if (status !== p.status) { await prisma.payLaterPlan.update({ where: { id: p.id }, data: { status } }); if (status === "PAID") out.paid++; }
  }
  return out;
}

// ── reading ─────────────────────────────────────────────────────────────────

export async function myPayLater(ctx: Ctx) {
  if (!can(ctx, ["buyer.invoices.view", "buyer.orders.place"])) throw new ForbiddenError();
  const s = await payLaterSettings();
  const a = await access(ctx.company, s);
  const co = await prisma.company.findUniqueOrThrow({ where: { id: ctx.company.id }, select: { countryId: true, payBeforeShipping: true } });
  const models = modelOrder(countryModels(s, await countryCode(co.countryId)));
  const limit = await ownLimitFor(ctx.company, s), used = await ownExposure(ctx.company.id);
  const plans = await prisma.payLaterPlan.findMany({ where: { companyId: ctx.company.id }, include: { instalments: { orderBy: { n: "asc" } }, order: { select: { id: true, number: true } } }, orderBy: { createdAt: "desc" }, take: 100 });
  const invoices = await prisma.invoice.findMany({ where: { id: { in: plans.map((p) => p.invoiceId).filter((x): x is string => !!x) } }, select: { id: true, fullNumber: true } });
  return {
    access: a, settings: s, own: models.includes("OWN") && !co.payBeforeShipping ? { limit, used, left: r2(Math.max(0, limit - used)) } : null, partner: models.includes("PARTNER") && !!activePartner(),
    terms: s.terms.filter((t) => t.enabled),
    plans: plans.map((p) => ({ id: p.id, model: p.model, status: p.status, term: p.term as unknown as PayLaterTerm, amount: Number(p.amount), buyerFee: Number(p.buyerFee), order: p.order, invoice: invoices.find((i) => i.id === p.invoiceId) ?? null, createdAt: p.createdAt, instalments: p.instalments.map((i) => ({ n: i.n, dueAt: i.dueAt, amount: Number(i.amount), paidAt: i.paidAt, overdue: !!i.overdueAt && !i.paidAt })) })),
  };
}

/** The pay-later plan of one order (order pages). */
export async function planForOrder(orderId: string) {
  const p = await prisma.payLaterPlan.findUnique({ where: { orderId }, include: { instalments: { orderBy: { n: "asc" } } } });
  return p ? { model: p.model, status: p.status, term: p.term as unknown as PayLaterTerm, buyerFee: Number(p.buyerFee), instalments: p.instalments.map((i) => ({ n: i.n, dueAt: i.dueAt, amount: Number(i.amount), paidAt: i.paidAt })) } : null;
}

export async function adminPayLater(ctx: Ctx) {
  staff(ctx);
  const plans = await prisma.payLaterPlan.findMany({ include: { company: { select: { id: true, legalName: true, tradeName: true, type: true } }, order: { select: { id: true, number: true } }, instalments: { select: { amount: true, paidAt: true, dueAt: true, overdueAt: true } } }, orderBy: { createdAt: "desc" }, take: 500 });
  const sum = (f: (p: (typeof plans)[number]) => boolean, v: (p: (typeof plans)[number]) => number) => r2(plans.filter(f).reduce((a, p) => a + v(p), 0));
  const unpaid = (p: (typeof plans)[number]) => p.status === "ACTIVE" ? Number(p.amount) + Number(p.buyerFee) : p.instalments.filter((i) => !i.paidAt).reduce((a, i) => a + Number(i.amount), 0);
  return {
    overview: {
      ownOutstanding: sum((p) => p.model === "OWN" && LIVE.includes(p.status as (typeof LIVE)[number]), unpaid),
      ownOverdue: sum((p) => p.model === "OWN" && p.status === "OVERDUE", unpaid),
      partnerVolume: sum((p) => p.model === "PARTNER" && p.status !== "CANCELLED", (p) => Number(p.amount)),
      buyerFees: sum((p) => p.status !== "CANCELLED", (p) => Number(p.buyerFee)),
      firingiFees: sum((p) => p.status !== "CANCELLED", (p) => Number(p.firingiFee)),
      plans: plans.filter((p) => p.status !== "CANCELLED").length,
    },
    partner: activePartner()?.label ?? null,
    plans: plans.map((p) => ({ id: p.id, company: { id: p.company.id, name: nameOf(p.company), type: p.company.type }, order: p.order, model: p.model, status: p.status, term: p.term as unknown as PayLaterTerm, amount: Number(p.amount), buyerFee: Number(p.buyerFee), firingiFee: Number(p.firingiFee), unpaid: r2(unpaid(p)), createdAt: p.createdAt })),
  };
}

/** Businesses with their own switch or own-credit limit (admin settings page). */
export async function companyRows(ctx: Ctx) {
  staff(ctx);
  const s = await payLaterSettings();
  const [feats, accs] = await Promise.all([
    prisma.companyFeature.findMany({ where: { key: FEATURE }, select: { companyId: true, enabled: true } }),
    prisma.payLaterAccount.findMany({ where: { ownLimit: { not: null } }, select: { companyId: true, ownLimit: true } }),
  ]);
  const ids = [...new Set([...feats.map((f) => f.companyId), ...accs.map((a) => a.companyId)])];
  const cos = await prisma.company.findMany({ where: { id: { in: ids } }, select: { id: true, legalName: true, tradeName: true, type: true } });
  return Promise.all(cos.map(async (c) => ({ companyId: c.id, name: nameOf(c), type: c.type, state: (feats.find((f) => f.companyId === c.id) ? (feats.find((f) => f.companyId === c.id)!.enabled ? "ON" : "OFF") : "DEFAULT") as "DEFAULT" | "ON" | "OFF", ownLimit: accs.find((a) => a.companyId === c.id)?.ownLimit != null ? Number(accs.find((a) => a.companyId === c.id)!.ownLimit) : null, defaultLimit: s.ownLimit[c.type as "CUSTOMER" | "WHOLESALER"] ?? 0, used: await ownExposure(c.id) })));
}

/** Schengen countries (admin settings: a country of its own). */
export async function countryOptions(ctx: Ctx) {
  staff(ctx);
  const rows = await prisma.country.findMany({ where: { isSchengen: true }, select: { code: true, name: true }, orderBy: { code: "asc" } });
  return rows.map((c) => ({ code: c.code, name: pick(c.name) }));
}
const pick = (n: unknown) => (typeof n === "string" ? n : ((n as Record<string, string> | null)?.en ?? Object.values((n as Record<string, string>) ?? {})[0] ?? ""));
