/**
 * Supplier plans (Phase 36). FIRINGI sells suppliers (wholesalers, distributors) monthly plans that
 *   - unlock ERP features (PLAN_FEATURES) — menus and pages of features outside the plan are replaced by
 *     an upgrade card, and the supplier API needs INTEGRATIONS;
 *   - set limits: active products, users, warehouses, own drivers;
 *   - can set the commission on sales (null = keep each supplier's agreed rate; FIRINGI can still fix a
 *     supplier's commission by hand, which locks it against plan changes);
 *   - set early-payout terms (see early-pay.ts).
 * Nothing changes until FIRINGI switches plans on. Then every supplier starts a free trial of the trial plan
 * (all its features) — existing ones keep everything they use — with reminders before it ends; at the end
 * the plan the supplier chose starts, else the default (Free) plan. Paid plans are invoiced monthly in
 * advance (FIRINGI service invoice): deducted from payouts or on normal terms. Upgrades start at once (the
 * difference for the rest of the period is invoiced); downgrades and cancelling take effect at period end.
 */
import "server-only";
import Decimal from "decimal.js";
import type { PlanBilling, Prisma, SupplierPlan } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";
import { notify } from "@/server/notify/dispatch";
import { DEFAULT_PLANS_SETTINGS, EARLY_PAY_MODELS, PLAN_FEATURES, type LimitKind, type PlanFeature, type PlansSettings } from "@/lib/plans";

type Tx = Prisma.TransactionClient;
const KEY = "plans.settings";
const DAY = 86400_000;
const D = (v: Decimal.Value | { toString(): string }) => new Decimal(typeof v === "object" && !(v instanceof Decimal) ? v.toString() : (v as Decimal.Value));
const SUPPLIER_TYPES = ["WHOLESALER", "DISTRIBUTOR"] as const;

// ── settings & plans ────────────────────────────────────────────────────────

export async function plansSettings(): Promise<PlansSettings> {
  const row = await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: KEY } });
  const v = (row?.value as Partial<PlansSettings>) ?? {};
  return { ...DEFAULT_PLANS_SETTINGS, ...v, earlyPay: { ...DEFAULT_PLANS_SETTINGS.earlyPay, ...(v.earlyPay ?? {}) } };
}

function staff(ctx: Ctx, manage = false) {
  if (ctx.company.type !== "ADMIN") throw new ForbiddenError();
  const ok = manage ? can(ctx, ["admin.vendors.commission", "admin.settings.manage"]) : can(ctx, ["admin.vendors.view", "admin.vendors.commission", "admin.finance.view", "admin.finance.manage", "admin.settings.view", "admin.settings.manage"]);
  if (!ok) throw new ForbiddenError();
}

export async function savePlansSettings(ctx: Ctx, input: Partial<PlansSettings>) {
  staff(ctx, true);
  const cur = await plansSettings();
  const next: PlansSettings = { ...cur, ...input, earlyPay: { ...cur.earlyPay, ...(input.earlyPay ?? {}) } };
  if (!Number.isInteger(next.trialDays) || next.trialDays < 0 || next.trialDays > 365) throw new ValidationError("Free trial: 0 to 365 days.");
  if (!Number.isInteger(next.invoiceDueDays) || next.invoiceDueDays < 0 || next.invoiceDueDays > 90) throw new ValidationError("Invoice terms: 0 to 90 days.");
  if (!(next.earlyPay.defaultLimit >= 0)) throw new ValidationError("Early payout limit must be 0 or more.");
  if (!Number.isInteger(next.earlyPay.minDaysEarly) || next.earlyPay.minDaysEarly < 1 || next.earlyPay.minDaysEarly > 60) throw new ValidationError("Minimum days early: 1 to 60.");
  next.reminderDays = [...new Set(next.reminderDays.filter((d) => Number.isInteger(d) && d > 0 && d <= 60))].sort((a, b) => b - a);
  await ensureDefaultPlans();
  const codes = (await prisma.supplierPlan.findMany({ select: { code: true } })).map((p) => p.code);
  if (!codes.includes(next.trialPlanCode)) throw new ValidationError("Choose an existing plan for the trial.");
  if (!codes.includes(next.defaultPlanCode)) throw new ValidationError("Choose an existing default plan.");
  await prisma.setting.upsert({
    where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key: KEY } },
    update: { value: next as unknown as Prisma.InputJsonValue, updatedById: ctx.user.id },
    create: { scope: "GLOBAL", key: KEY, value: next as unknown as Prisma.InputJsonValue, updatedById: ctx.user.id },
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "plans.settings_changed", entityType: "Setting", entityId: KEY, before: cur, after: next });
  return next;
}

/** The three starting plans (FIRINGI edits them; nothing about commission until FIRINGI sets it). */
export async function ensureDefaultPlans() {
  if (await prisma.supplierPlan.count()) return;
  await prisma.supplierPlan.createMany({
    data: [
      { code: "FREE", name: "Free", description: "Sell on FIRINGI with the basics.", monthlyPrice: 0, features: [], maxProducts: 50, maxUsers: 2, maxWarehouses: 1, maxDrivers: 1, earlyPayModel: "OFF", isDefault: true, sortOrder: 1 },
      { code: "PRO", name: "Pro", description: "Inventory, planning, price insights, advertising and routes.", monthlyPrice: 49, features: ["INVENTORY", "PLANNING", "PRICE_INSIGHTS", "ADS", "ROUTES", "ASSISTANT"], maxProducts: 500, maxUsers: 10, maxWarehouses: 3, maxDrivers: 5, earlyPayModel: "PER_DAY", earlyPayRate: 0.05, earlyPayMinFee: 5, sortOrder: 2 },
      { code: "BUSINESS", name: "Business", description: "Everything, no limits, the cheapest early payout.", monthlyPrice: 149, features: [...PLAN_FEATURES], earlyPayModel: "PER_DAY", earlyPayRate: 0.03, earlyPayMinFee: 3, freeEarlyPays: 2, sortOrder: 3 },
    ],
  });
}

export async function listPlans(opts: { activeOnly?: boolean } = {}) {
  await ensureDefaultPlans();
  return prisma.supplierPlan.findMany({ where: opts.activeOnly ? { active: true } : {}, orderBy: [{ sortOrder: "asc" }, { monthlyPrice: "asc" }] });
}

export type PlanInput = {
  id?: string | null; code: string; name: string; description?: string | null; monthlyPrice: number; commissionPct: number | null;
  features: string[]; maxProducts: number | null; maxUsers: number | null; maxWarehouses: number | null; maxDrivers: number | null;
  earlyPayModel: string; earlyPayRate: number; earlyPayMinFee: number; freeEarlyPays: number; active: boolean; sortOrder: number;
};

export async function savePlan(ctx: Ctx, input: PlanInput) {
  staff(ctx, true);
  const code = input.code.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "");
  if (code.length < 2 || code.length > 20) throw new ValidationError("Code: 2 to 20 letters or digits.");
  if (input.name.trim().length < 2) throw new ValidationError("Give the plan a name.");
  if (!(input.monthlyPrice >= 0 && input.monthlyPrice <= 100_000)) throw new ValidationError("Monthly price: 0 to 100 000 €.");
  if (input.commissionPct !== null && !(input.commissionPct >= 0 && input.commissionPct <= 50)) throw new ValidationError("Commission: 0 to 50 %.");
  const features = [...new Set(input.features)].filter((f): f is PlanFeature => (PLAN_FEATURES as readonly string[]).includes(f));
  if (features.includes("PLANNING") && !features.includes("INVENTORY")) throw new ValidationError("Planning needs Inventory in the same plan.");
  for (const k of ["maxProducts", "maxUsers", "maxWarehouses", "maxDrivers"] as const) {
    const v = input[k];
    if (v !== null && !(Number.isInteger(v) && v >= 1 && v <= 1_000_000)) throw new ValidationError("Limits: a whole number from 1, or empty for no limit.");
  }
  if (!(EARLY_PAY_MODELS as readonly string[]).includes(input.earlyPayModel)) throw new ValidationError("Choose how early payout is charged.");
  if (input.earlyPayModel === "PER_DAY" && !(input.earlyPayRate > 0 && input.earlyPayRate <= 1)) throw new ValidationError("Early payout per day: more than 0 %, at most 1 % a day.");
  if (input.earlyPayModel === "FLAT" && !(input.earlyPayRate > 0 && input.earlyPayRate <= 15)) throw new ValidationError("Early payout flat fee: more than 0 %, at most 15 %.");
  if (!(input.earlyPayMinFee >= 0) || !(Number.isInteger(input.freeEarlyPays) && input.freeEarlyPays >= 0 && input.freeEarlyPays <= 30)) throw new ValidationError("Check the minimum fee and the free early payouts.");
  const before = input.id ? await prisma.supplierPlan.findUnique({ where: { id: input.id } }) : null;
  if (input.id && !before) throw new NotFoundError("Plan");
  const clash = await prisma.supplierPlan.findFirst({ where: { code, ...(input.id ? { id: { not: input.id } } : {}) } });
  if (clash) throw new ValidationError("Another plan has this code.");
  const s = await plansSettings();
  if (before && !input.active && [s.defaultPlanCode, s.trialPlanCode].includes(before.code)) throw new ValidationError("The default and the trial plan must stay offered.");

  // A plan's commission applies to all its suppliers: like any commission change, it needs a second person.
  const newCommission = input.commissionPct === null ? null : new Decimal(input.commissionPct).toFixed(3);
  const oldCommission = before?.commissionPct ? D(before.commissionPct).toFixed(3) : null;
  const commissionChanged = !!before && newCommission !== oldCommission;
  if (commissionChanged) {
    const { approvalSettings, fourEyes } = await import("@/server/approvals/gate");
    const a = await approvalSettings();
    if (a.enabled && a.commissionChanges)
      await fourEyes(ctx, { kind: "COMMISSION", summary: `Plan ${before!.name}: commission ${oldCommission === null ? "each supplier's own" : `${Number(oldCommission)} %`} → ${newCommission === null ? "each supplier's own" : `${Number(newCommission)} %`}`, payload: { plan: { ...input, code } } });
  }
  const data = {
    code, name: input.name.trim(), description: input.description?.trim() || null, monthlyPrice: new Decimal(input.monthlyPrice).toFixed(2), commissionPct: newCommission,
    features, maxProducts: input.maxProducts, maxUsers: input.maxUsers, maxWarehouses: input.maxWarehouses, maxDrivers: input.maxDrivers,
    earlyPayModel: input.earlyPayModel, earlyPayRate: input.earlyPayModel === "OFF" ? 0 : input.earlyPayRate, earlyPayMinFee: new Decimal(input.earlyPayMinFee).toFixed(2), freeEarlyPays: input.freeEarlyPays,
    active: input.active, sortOrder: input.sortOrder,
  };
  const plan = before ? await prisma.supplierPlan.update({ where: { id: before.id }, data }) : await prisma.supplierPlan.create({ data });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: before ? "plans.plan_changed" : "plans.plan_created", entityType: "SupplierPlan", entityId: plan.id, before, after: plan });
  if (commissionChanged && plan.commissionPct !== null) {
    const subs = await prisma.planSubscription.findMany({ where: { planId: plan.id, status: "ACTIVE", commissionLocked: false } });
    for (const sub of subs) await prisma.$transaction((tx) => applyCommission(tx, sub.companyId, plan, ctx.user.id));
  }
  return plan;
}

// ── who is on which plan ────────────────────────────────────────────────────

const isSupplier = (c: { type: string; isInHouse: boolean }) => (SUPPLIER_TYPES as readonly string[]).includes(c.type) && !c.isInHouse;

/**
 * The supplier's subscription — a trial of the trial plan is started the first time it is needed once plans
 * are on. null: plans are off, or not a supplier (customers, FIRINGI's own warehouse).
 */
export async function subscriptionOf(companyId: string, now = new Date()) {
  const s = await plansSettings();
  if (!s.enabled) return null;
  const co = await prisma.company.findUnique({ where: { id: companyId }, select: { type: true, isInHouse: true, status: true } });
  if (!co || !isSupplier(co)) return null;
  const existing = await prisma.planSubscription.findUnique({ where: { companyId }, include: { plan: true, pending: true } });
  if (existing) return existing;
  await ensureDefaultPlans();
  const trial = await prisma.supplierPlan.findUnique({ where: { code: s.trialPlanCode } }) ?? await prisma.supplierPlan.findFirstOrThrow({ where: { isDefault: true } });
  // menu and page load together: the second request finds the row the first one made (no unique-key error)
  const made = await prisma.planSubscription.createMany({
    data: [{ companyId, planId: trial.id, status: s.trialDays > 0 ? "TRIAL" : "ACTIVE", trialEndsAt: s.trialDays > 0 ? new Date(now.getTime() + s.trialDays * DAY) : null, billing: s.billing as PlanBilling }],
    skipDuplicates: true,
  });
  const created = await prisma.planSubscription.findUniqueOrThrow({ where: { companyId }, include: { plan: true, pending: true } });
  if (!made.count) return created;
  await writeAudit({ actorUserId: null, actorCompanyId: null, action: "plans.trial_started", entityType: "Company", entityId: companyId, after: { plan: trial.code, endsAt: created.trialEndsAt } });
  return created;
}

/** Is a plan feature available to this company? Always yes while plans are off and for non-suppliers. */
export async function planAllows(companyId: string, feature: PlanFeature) {
  const sub = await subscriptionOf(companyId);
  return !sub || sub.plan.features.includes(feature);
}

/** Plan features this company lacks (empty while plans are off). */
export async function planMissing(companyId: string): Promise<PlanFeature[]> {
  const sub = await subscriptionOf(companyId);
  return sub ? PLAN_FEATURES.filter((f) => !sub.plan.features.includes(f)) : [];
}

const LIMIT_FIELD = { products: "maxProducts", users: "maxUsers", warehouses: "maxWarehouses", drivers: "maxDrivers" } as const;

async function usage(companyId: string, kind: LimitKind, tx: Tx | typeof prisma = prisma) {
  switch (kind) {
    case "products": return tx.vendorOffer.count({ where: { vendorCompanyId: companyId, status: "ACTIVE" } });
    case "users": return tx.membership.count({ where: { companyId, status: "ACTIVE" } });
    case "warehouses": return tx.address.count({ where: { companyId, isActive: true, kind: { in: ["WAREHOUSE", "PICKUP"] } } });
    case "drivers": return tx.driver.count({ where: { ownerCompanyId: companyId, status: { in: ["APPROVED", "PENDING"] } } });
  }
}

export class PlanLimitError extends AppError {
  constructor(kind: LimitKind, max: number, plan: string) {
    super("PLAN_LIMIT", `Your ${plan} plan allows ${max} ${kind === "products" ? "active products" : kind}. Upgrade your plan (Company › Plan & Billing) to add more.`, 409, { kind, max: String(max), plan });
  }
}

/** Throws PLAN_LIMIT when adding `adding` more would go over the plan's limit. */
export async function assertWithinLimit(companyId: string, kind: LimitKind, adding = 1, tx?: Tx) {
  const sub = await subscriptionOf(companyId);
  if (!sub) return;
  const max = sub.plan[LIMIT_FIELD[kind]];
  if (max === null) return;
  if ((await usage(companyId, kind, tx)) + adding > max) {
    const err = new PlanLimitError(kind, max, sub.plan.name);
    // in the supplier's language when called from a page or action (English otherwise, e.g. tests and jobs)
    try {
      const { getTranslations } = await import("next-intl/server");
      const t = await getTranslations("plans");
      err.message = t("limitError", { plan: sub.plan.name, max, kind: t(`limits.${kind}`) });
    } catch { /* outside a request */ }
    throw err;
  }
}

// ── commission & invoices ───────────────────────────────────────────────────

/** The plan's commission becomes the supplier's rule (unless FIRINGI fixed the supplier's rate). */
async function applyCommission(tx: Tx, companyId: string, plan: SupplierPlan, actorUserId: string | null) {
  if (plan.commissionPct === null) return;
  const sub = await tx.planSubscription.findUnique({ where: { companyId } });
  if (sub?.commissionLocked) return;
  const current = await tx.commissionRule.findFirst({ where: { vendorCompanyId: companyId, validTo: null, categoryId: null } });
  if (current && D(current.rate).eq(D(plan.commissionPct)) && current.type === "PERCENT") return;
  const now = new Date();
  if (current) await tx.commissionRule.update({ where: { id: current.id }, data: { validTo: now } });
  await tx.commissionRule.create({ data: { vendorCompanyId: companyId, type: "PERCENT", rate: plan.commissionPct, validFrom: now, note: `Plan ${plan.name}`, createdById: actorUserId } });
  await writeAudit({ actorUserId, actorCompanyId: null, action: "vendor.commission_set", entityType: "Company", entityId: companyId, before: current ? { rate: current.rate.toString() } : null, after: { rate: plan.commissionPct.toString(), plan: plan.code } }, tx);
}

const addMonth = (d: Date) => { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() + 1); return x; };
const fmtDay = (d: Date) => d.toISOString().slice(0, 10);

async function invoicePlan(tx: Tx, companyId: string, plan: SupplierPlan, from: Date, to: Date, net: Decimal, kind: "PERIOD" | "UPGRADE", billing: PlanBilling, actorUserId: string | null) {
  if (net.lte(0)) return null;
  const s = await plansSettings();
  const { issueServiceInvoice } = await import("@/server/invoicing/service");
  const label = kind === "UPGRADE" ? `Plano FIRINGI ${plan.name} — mudança de plano ${fmtDay(from)} a ${fmtDay(to)}` : `Plano FIRINGI ${plan.name} — ${fmtDay(from)} a ${fmtDay(to)}`;
  const inv = await issueServiceInvoice(tx, { recipientCompanyId: companyId, docType: "INVOICE", dueDays: billing === "PAYOUT" ? 0 : s.invoiceDueDays, actorUserId, lines: [{ description: label, net }] });
  await tx.planInvoice.create({ data: { companyId, planId: plan.id, invoiceId: inv.id, periodStart: from, periodEnd: to, billing, net: D(inv.netTotal).toFixed(2), gross: D(inv.grossTotal).toFixed(2), kind } });
  return inv;
}

/** Start a paid (or free) period on a plan now. */
async function activate(tx: Tx, companyId: string, plan: SupplierPlan, now: Date, actorUserId: string | null) {
  const sub = await tx.planSubscription.update({
    where: { companyId }, data: { planId: plan.id, status: "ACTIVE", trialEndsAt: null, pendingPlanId: null, periodStart: now, periodEnd: addMonth(now), remindersSent: [] },
  });
  await invoicePlan(tx, companyId, plan, now, sub.periodEnd!, D(plan.monthlyPrice), "PERIOD", sub.billing, actorUserId);
  await applyCommission(tx, companyId, plan, actorUserId);
  return sub;
}

/** PAYOUT suppliers: settle open plan / early-payout fee invoices against what FIRINGI owes them ("Compensação"). */
export async function netAgainstPayouts(companyId: string, invoiceIds: string[], actorUserId: string | null, label = "plans") {
  if (!invoiceIds.length) return new Decimal(0);
  const { openAmounts } = await import("@/server/payments/service");
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Company" WHERE id = ${companyId} FOR UPDATE`;
    const open = await openAmounts(invoiceIds, tx);
    let total = new Decimal(0);
    for (const invoiceId of invoiceIds) {
      let need = open.get(invoiceId) ?? new Decimal(0);
      if (need.lte(0)) continue;
      const vendorOpen = await openVendorInvoices(tx, companyId);
      const allocs: { vendorInvoiceId: string; amount: Decimal }[] = [];
      for (const v of vendorOpen) {
        if (need.lte(0)) break;
        const take = Decimal.min(need, v.open);
        allocs.push({ vendorInvoiceId: v.id, amount: take });
        need = need.minus(take);
      }
      const amount = allocs.reduce((a, x) => a.plus(x.amount), new Decimal(0));
      if (amount.lte(0)) break;
      const inv = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { fullNumber: true } });
      const reference = `Compensação ${inv.fullNumber ?? ""}`.trim();
      await tx.payment.create({ data: { companyId, direction: "INBOUND", method: "OTHER", amount: amount.toFixed(2), reference, status: "CONFIRMED", paidAt: new Date(), recordedById: actorUserId, allocations: { create: [{ invoiceId, amount: amount.toFixed(2) }] } } });
      await tx.payment.create({ data: { companyId, direction: "OUTBOUND", method: "OTHER", amount: amount.toFixed(2), reference, status: "CONFIRMED", paidAt: new Date(), recordedById: actorUserId, allocations: { create: allocs.map((x) => ({ vendorInvoiceId: x.vendorInvoiceId, amount: x.amount.toFixed(2) })) } } });
      await markVendorInvoicesPaid(tx, allocs.map((x) => x.vendorInvoiceId));
      await writeAudit({ actorUserId, actorCompanyId: null, action: `${label}.netted`, entityType: "Invoice", entityId: invoiceId, after: { amount: amount.toFixed(2), vendorInvoices: allocs.map((x) => x.vendorInvoiceId) } }, tx);
      total = total.plus(amount);
    }
    return total;
  });
}

/** Supplier invoices fully covered by confirmed payments become PAID (as when FIRINGI records a payout). */
export async function markVendorInvoicesPaid(tx: Tx, vendorInvoiceIds: string[]) {
  for (const id of [...new Set(vendorInvoiceIds)]) {
    const vi = await tx.vendorInvoice.findUniqueOrThrow({ where: { id }, include: { paymentAllocations: { where: { payment: { status: "CONFIRMED" } } } } });
    const paid = vi.paymentAllocations.reduce((s, x) => s.plus(x.amount.toString()), new Decimal(0));
    if (paid.gte(vi.grossTotal.toString()) && vi.status !== "PAID") await tx.vendorInvoice.update({ where: { id }, data: { status: "PAID" } });
  }
}

export async function openVendorInvoices(tx: Tx | typeof prisma, companyId: string, opts: { excludeIds?: string[] } = {}) {
  const rows = await tx.vendorInvoice.findMany({
    where: { vendorCompanyId: companyId, status: "APPROVED", docType: { not: "CREDIT_NOTE" }, ...(opts.excludeIds?.length ? { id: { notIn: opts.excludeIds } } : {}) },
    orderBy: { issueDate: "asc" }, include: { paymentAllocations: { where: { payment: { status: "CONFIRMED" } }, select: { amount: true } } },
  });
  return rows.map((r) => ({ id: r.id, number: r.externalNumber, issueDate: r.issueDate, dueDate: r.dueDate, gross: D(r.grossTotal), open: D(r.grossTotal).minus(r.paymentAllocations.reduce((a, x) => a.plus(D(x.amount)), new Decimal(0))) })).filter((r) => r.open.gt(0.004));
}

async function netOpenPlanInvoices(companyId: string, actorUserId: string | null) {
  const rows = await prisma.planInvoice.findMany({ where: { companyId, billing: "PAYOUT" }, orderBy: { createdAt: "asc" }, select: { invoiceId: true } });
  return netAgainstPayouts(companyId, rows.map((r) => r.invoiceId), actorUserId);
}

// ── supplier: my plan, choosing a plan ──────────────────────────────────────

function requireSupplierAdmin(ctx: Ctx) {
  if (!(SUPPLIER_TYPES as readonly string[]).includes(ctx.company.type)) throw new ForbiddenError();
  if (!ctx.membership.isOwner && !can(ctx, ["company.profile.manage", "vendor.invoices.view"])) throw new ForbiddenError();
}

export async function myPlan(ctx: Ctx, now = new Date()) {
  if (!(SUPPLIER_TYPES as readonly string[]).includes(ctx.company.type)) throw new ForbiddenError();
  const s = await plansSettings();
  const sub = await subscriptionOf(ctx.company.id, now);
  const plans = await listPlans({ activeOnly: true });
  const [products, users, warehouses, drivers] = await Promise.all((["products", "users", "warehouses", "drivers"] as const).map((k) => usage(ctx.company.id, k)));
  const invoices = sub ? await prisma.planInvoice.findMany({ where: { companyId: ctx.company.id }, orderBy: { createdAt: "desc" }, take: 24 }) : [];
  const docs = invoices.length ? await prisma.invoice.findMany({ where: { id: { in: invoices.map((i) => i.invoiceId) } }, select: { id: true, fullNumber: true, issuedAt: true } }) : [];
  const commission = await prisma.commissionRule.findFirst({ where: { vendorCompanyId: ctx.company.id, validTo: null, categoryId: null }, orderBy: { validFrom: "desc" } });
  return {
    enabled: s.enabled, sub, plans, settings: s, canChange: ctx.membership.isOwner || can(ctx, ["company.profile.manage"]),
    trialDaysLeft: sub?.status === "TRIAL" && sub.trialEndsAt ? Math.max(0, Math.ceil((sub.trialEndsAt.getTime() - now.getTime()) / DAY)) : null,
    usage: { products, users, warehouses, drivers }, commission: commission ? Number(commission.rate) : null,
    invoices: invoices.map((i) => ({ ...i, number: docs.find((d) => d.id === i.invoiceId)?.fullNumber ?? null, issueDate: docs.find((d) => d.id === i.invoiceId)?.issuedAt ?? i.createdAt })),
  };
}

/**
 * The supplier picks a plan. In the trial: it starts when the trial ends. Upgrade (dearer): now, with the
 * difference for the rest of the period invoiced. Downgrade / cheaper / free: at the end of the period.
 */
export async function choosePlan(ctx: Ctx, planId: string, now = new Date()) {
  requireSupplierAdmin(ctx);
  if (!ctx.membership.isOwner && !can(ctx, "company.profile.manage")) throw new ForbiddenError();
  const sub = await subscriptionOf(ctx.company.id, now);
  if (!sub) throw new AppError("PLANS_OFF", "Plans aren't in use yet.", 409);
  const plan = await prisma.supplierPlan.findFirst({ where: { id: planId, active: true } });
  if (!plan) throw new NotFoundError("Plan");
  return changePlan(sub.companyId, plan, ctx.user.id, now, "SUPPLIER");
}

async function changePlan(companyId: string, plan: SupplierPlan, actorUserId: string | null, now: Date, by: "SUPPLIER" | "FIRINGI", immediate = false) {
  const res = await prisma.$transaction(async (tx) => {
    const sub = await tx.planSubscription.findUniqueOrThrow({ where: { companyId }, include: { plan: true } });
    if (sub.status === "TRIAL" && !immediate) {
      if (plan.id === sub.planId && !sub.pendingPlanId) return { when: "TRIAL_END" as const, sub };
      const u = await tx.planSubscription.update({ where: { companyId }, data: { pendingPlanId: plan.id } });
      return { when: "TRIAL_END" as const, sub: u };
    }
    if (sub.status === "TRIAL" && immediate) return { when: "NOW" as const, sub: await activate(tx, companyId, plan, now, actorUserId) };
    if (plan.id === sub.planId) {
      // staying (also undoes a pending downgrade / cancel)
      return { when: "NOW" as const, sub: await tx.planSubscription.update({ where: { companyId }, data: { pendingPlanId: null, status: "ACTIVE" } }) };
    }
    const upgrade = D(plan.monthlyPrice).gt(D(sub.plan.monthlyPrice));
    if (upgrade || immediate) {
      const end = sub.periodEnd ?? addMonth(now);
      const start = sub.periodStart ?? now;
      const left = Math.min(1, Math.max(0, (end.getTime() - now.getTime()) / (end.getTime() - start.getTime() || 1))); // never more than a full period
      const diff = D(plan.monthlyPrice).minus(D(sub.plan.monthlyPrice)).mul(left).toDecimalPlaces(2);
      const u = await tx.planSubscription.update({ where: { companyId }, data: { planId: plan.id, pendingPlanId: null, status: "ACTIVE", periodStart: sub.periodStart ?? now, periodEnd: end } });
      if (diff.gt(0)) await invoicePlan(tx, companyId, plan, now, end, diff, "UPGRADE", sub.billing, actorUserId);
      await applyCommission(tx, companyId, plan, actorUserId);
      return { when: "NOW" as const, sub: u };
    }
    const u = await tx.planSubscription.update({ where: { companyId }, data: { pendingPlanId: plan.id } });
    return { when: "PERIOD_END" as const, sub: u };
  });
  await writeAudit({ actorUserId, actorCompanyId: null, action: "plans.changed", entityType: "Company", entityId: companyId, after: { plan: plan.code, when: res.when, by } });
  if (res.when === "NOW") {
    await netOpenPlanInvoices(companyId, actorUserId).catch(() => null);
    const { kickFiscalQueue } = await import("@/server/invoicing/fiscal");
    kickFiscalQueue();
  }
  await notify("plan.changed", [{ companyId, link: "/vendor/company/plan" }], { plan: plan.name, date: res.when === "NOW" ? fmtDay(now) : fmtDay(res.sub.trialEndsAt ?? res.sub.periodEnd ?? now) }).catch(() => null);
  return { when: res.when, plan: plan.code };
}

// ── FIRINGI: per supplier ───────────────────────────────────────────────────

export async function adminSetPlan(ctx: Ctx, companyId: string, planId: string, immediate: boolean) {
  staff(ctx, true);
  const sub = await subscriptionOf(companyId);
  if (!sub) throw new AppError("PLANS_OFF", "Switch plans on first (or this company isn't a supplier).", 409);
  const plan = await prisma.supplierPlan.findUnique({ where: { id: planId } });
  if (!plan) throw new NotFoundError("Plan");
  return changePlan(companyId, plan, ctx.user.id, new Date(), "FIRINGI", immediate);
}

export async function extendTrial(ctx: Ctx, companyId: string, days: number) {
  staff(ctx, true);
  if (!(Number.isInteger(days) && days >= 1 && days <= 365)) throw new ValidationError("Extend by 1 to 365 days.");
  const sub = await subscriptionOf(companyId);
  if (!sub || sub.status !== "TRIAL") throw new ValidationError("This supplier isn't on a trial.");
  const base = sub.trialEndsAt && sub.trialEndsAt > new Date() ? sub.trialEndsAt : new Date();
  const u = await prisma.planSubscription.update({ where: { companyId }, data: { trialEndsAt: new Date(base.getTime() + days * DAY), remindersSent: [] } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "plans.trial_extended", entityType: "Company", entityId: companyId, after: { days, until: u.trialEndsAt } });
  return u;
}

export async function setSubscriptionOptions(ctx: Ctx, companyId: string, input: { billing?: PlanBilling; commissionLocked?: boolean; earlyPayEnabled?: boolean; earlyPayLimit?: number | null }) {
  staff(ctx, true);
  const sub = await subscriptionOf(companyId);
  if (!sub) throw new AppError("PLANS_OFF", "Switch plans on first (or this company isn't a supplier).", 409);
  if (input.earlyPayLimit !== undefined && input.earlyPayLimit !== null && !(input.earlyPayLimit >= 0 && input.earlyPayLimit <= 10_000_000)) throw new ValidationError("Early payout limit: 0 or more.");
  const u = await prisma.planSubscription.update({
    where: { companyId },
    data: {
      ...(input.billing ? { billing: input.billing } : {}), ...(input.commissionLocked !== undefined ? { commissionLocked: input.commissionLocked } : {}),
      ...(input.earlyPayEnabled !== undefined ? { earlyPayEnabled: input.earlyPayEnabled } : {}),
      ...(input.earlyPayLimit !== undefined ? { earlyPayLimit: input.earlyPayLimit === null ? null : new Decimal(input.earlyPayLimit).toFixed(2) } : {}),
    },
    include: { plan: true },
  });
  // unlocking puts the plan's commission back
  if (input.commissionLocked === false && sub.status === "ACTIVE") await prisma.$transaction((tx) => applyCommission(tx, companyId, u.plan, ctx.user.id));
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "plans.options_changed", entityType: "Company", entityId: companyId, after: input });
  return u;
}

export async function listSubscribers(ctx: Ctx) {
  staff(ctx);
  const s = await plansSettings();
  const companies = await prisma.company.findMany({
    where: { type: { in: [...SUPPLIER_TYPES] }, status: "APPROVED", isInHouse: false },
    select: { id: true, legalName: true, tradeName: true, type: true, country: { select: { code: true } }, planSubscription: { include: { plan: true, pending: true } } },
    orderBy: { legalName: "asc" },
  });
  const rules = await prisma.commissionRule.findMany({ where: { vendorCompanyId: { in: companies.map((c) => c.id) }, validTo: null, categoryId: null } });
  return companies.map((c) => ({
    id: c.id, name: c.tradeName ?? c.legalName, type: c.type, country: c.country.code, sub: c.planSubscription,
    commission: (() => { const r = rules.find((x) => x.vendorCompanyId === c.id); return r ? Number(r.rate) : null; })(), plansOn: s.enabled,
  }));
}

export async function plansOverview(ctx: Ctx, now = new Date()) {
  staff(ctx);
  const s = await plansSettings();
  const plans = await listPlans();
  const subs = await prisma.planSubscription.findMany({ include: { plan: true } });
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [invoicedMonth, early] = await Promise.all([
    prisma.planInvoice.aggregate({ where: { createdAt: { gte: monthStart } }, _sum: { net: true } }),
    prisma.earlyPayout.aggregate({ where: { status: "PAID", decidedAt: { gte: monthStart } }, _sum: { amount: true, fee: true }, _count: true }),
  ]);
  const active = subs.filter((x) => x.status === "ACTIVE");
  return {
    settings: s, plans,
    mrr: Math.round(active.reduce((a, x) => a + Number(x.plan.monthlyPrice), 0) * 100) / 100,
    byPlan: plans.map((p) => ({ id: p.id, code: p.code, name: p.name, active: subs.filter((x) => x.planId === p.id && x.status === "ACTIVE").length, trial: subs.filter((x) => x.planId === p.id && x.status === "TRIAL").length })),
    trialsEnding: subs.filter((x) => x.status === "TRIAL" && x.trialEndsAt && x.trialEndsAt.getTime() - now.getTime() < 14 * DAY).length,
    invoicedMonth: Number(invoicedMonth._sum.net ?? 0), earlyPaidMonth: Number(early._sum.amount ?? 0), earlyFeesMonth: Number(early._sum.fee ?? 0), earlyCountMonth: early._count,
    pendingEarly: await prisma.earlyPayout.count({ where: { status: "REQUESTED" } }),
  };
}

export async function listPlanInvoices(ctx: Ctx) {
  staff(ctx);
  const rows = await prisma.planInvoice.findMany({ orderBy: { createdAt: "desc" }, take: 300, include: { plan: true } });
  const [docs, cos] = await Promise.all([
    prisma.invoice.findMany({ where: { id: { in: rows.map((r) => r.invoiceId) } }, select: { id: true, fullNumber: true } }),
    prisma.company.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.companyId))] } }, select: { id: true, legalName: true, tradeName: true } }),
  ]);
  const { openAmounts } = await import("@/server/payments/service");
  const open = await openAmounts(rows.map((r) => r.invoiceId));
  return rows.map((r) => ({ ...r, number: docs.find((d) => d.id === r.invoiceId)?.fullNumber ?? null, company: (() => { const c = cos.find((x) => x.id === r.companyId); return c ? c.tradeName ?? c.legalName : "—"; })(), open: Number(open.get(r.invoiceId) ?? 0) }));
}

// ── daily job ───────────────────────────────────────────────────────────────

/** Trial reminders and endings, renewals with pending changes, netting. Safe to run more than once a day. */
export async function runPlansJob(now = new Date()) {
  const s = await plansSettings();
  if (!s.enabled) return { skipped: "plans off" };
  // every supplier gets its subscription (trial) — also the ones that haven't opened a page since plans started
  const suppliers = await prisma.company.findMany({ where: { type: { in: [...SUPPLIER_TYPES] }, status: "APPROVED", isInHouse: false, planSubscription: null }, select: { id: true } });
  for (const c of suppliers) await subscriptionOf(c.id, now);
  let reminded = 0, trialsEnded = 0, renewed = 0, changed = 0;

  const trials = await prisma.planSubscription.findMany({ where: { status: "TRIAL" }, include: { plan: true, pending: true } });
  const def = await prisma.supplierPlan.findUnique({ where: { code: s.defaultPlanCode } }) ?? await prisma.supplierPlan.findFirstOrThrow({ where: { isDefault: true } });
  for (const t of trials) {
    if (!t.trialEndsAt) continue;
    const daysLeft = Math.ceil((t.trialEndsAt.getTime() - now.getTime()) / DAY);
    if (daysLeft <= 0) {
      const next = t.pending ?? def;
      await prisma.$transaction((tx) => activate(tx, t.companyId, next, now, null));
      await notify("plan.trial_ended", [{ companyId: t.companyId, link: "/vendor/company/plan" }], { plan: next.name }).catch(() => null);
      trialsEnded++;
      continue;
    }
    const due = s.reminderDays.filter((d) => daysLeft <= d && !t.remindersSent.includes(d));
    if (due.length) {
      await prisma.planSubscription.update({ where: { id: t.id }, data: { remindersSent: [...t.remindersSent, ...due] } });
      await notify("plan.trial_ending", [{ companyId: t.companyId, link: "/vendor/company/plan" }], { plan: t.plan.name, days: daysLeft, date: fmtDay(t.trialEndsAt) }).catch(() => null);
      reminded++;
    }
  }

  const ending = await prisma.planSubscription.findMany({ where: { status: { in: ["ACTIVE", "CANCELLED"] }, periodEnd: { lte: now } }, include: { plan: true, pending: true } });
  for (const e of ending) {
    const next = e.pending ?? (e.status === "CANCELLED" ? def : e.plan);
    if (next.id !== e.planId) changed++;
    await prisma.$transaction(async (tx) => {
      const start = e.periodEnd!;
      await tx.planSubscription.update({ where: { id: e.id }, data: { planId: next.id, pendingPlanId: null, status: "ACTIVE", periodStart: start, periodEnd: addMonth(start) } });
      await invoicePlan(tx, e.companyId, next, start, addMonth(start), D(next.monthlyPrice), "PERIOD", e.billing, null);
      if (next.id !== e.planId) await applyCommission(tx, e.companyId, next, null);
    });
    renewed++;
  }

  // settle open plan invoices of PAYOUT suppliers whenever FIRINGI owes them something
  const payout = await prisma.planSubscription.findMany({ where: { billing: "PAYOUT" }, select: { companyId: true } });
  let netted = new Decimal(0);
  for (const p of payout) netted = netted.plus(await netOpenPlanInvoices(p.companyId, null).catch(() => new Decimal(0)));
  if (renewed || trialsEnded) { const { kickFiscalQueue } = await import("@/server/invoicing/fiscal"); kickFiscalQueue(); }
  return { reminded, trialsEnded, renewed, changed, netted: netted.toFixed(2) };
}
