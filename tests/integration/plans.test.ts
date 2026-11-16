/**
 * Phase 36: supplier plans & early payout — plans off changes nothing; switching on starts a free trial of the
 * top plan for everyone; choosing a plan during the trial starts it at the end (invoice, commission, settled
 * against payouts); features and limits follow the plan; upgrade now (difference invoiced), downgrade at
 * period end; FIRINGI's per-supplier options; a plan's commission change needs a second person.
 * Early payout: quote per day early / flat, minimum fee, free ones, limit, request → FIRINGI pays (fee invoice,
 * bank transfer + compensation → invoices fully paid) or turns it down; big ones need a second person.
 */
import Decimal from "decimal.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import * as P from "@/server/plans/service";
import * as E from "@/server/plans/early-pay";
import { companyFeatureOn } from "@/server/accounting/features";
import { openAmounts } from "@/server/payments/service";
import { ctxFor } from "../helpers";

const SA = "superadmin@firingi.test", LX = "owner@lisboacentral.test", KEBAB = "owner@kebabhouse.test", IB = "owner@ibericas.test";
const DAY = 86400_000;
let lxId = "", oldRate: string | null = null;
const createdVi: string[] = [];

async function wipe() {
  await prisma.earlyPayout.deleteMany({});
  await prisma.planInvoice.deleteMany({});
  await prisma.planSubscription.deleteMany({});
  await prisma.supplierPlan.deleteMany({});
  await prisma.setting.deleteMany({ where: { key: "plans.settings" } });
}
async function approvals(commissionChanges: boolean) {
  const cur = (await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: "approvals.rules" } }))?.value as object | undefined;
  await prisma.setting.upsert({ where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key: "approvals.rules" } }, update: { value: { ...(cur ?? {}), commissionChanges } }, create: { scope: "GLOBAL", key: "approvals.rules", value: { commissionChanges } } });
}
async function vendorInvoice(gross: number, dueInDays: number) {
  const tag = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
  const vi = await prisma.vendorInvoice.create({
    data: { vendorCompanyId: lxId, externalNumber: `FT T/${tag}`, issueDate: new Date(), dueDate: new Date(Date.now() + dueInDays * DAY), netTotal: (gross / 1.23).toFixed(2), vatTotal: (gross - gross / 1.23).toFixed(2), grossTotal: gross.toFixed(2), fileKey: "test/none.pdf", status: "APPROVED" },
  });
  createdVi.push(vi.id);
  return vi;
}

beforeAll(async () => {
  await wipe();
  lxId = (await ctxFor(LX)).company.id;
  oldRate = (await prisma.commissionRule.findFirst({ where: { vendorCompanyId: lxId, validTo: null, categoryId: null } }))?.rate.toString() ?? null;
});
afterAll(async () => {
  await prisma.paymentAllocation.deleteMany({ where: { vendorInvoiceId: { in: createdVi } } });
  await prisma.payment.deleteMany({ where: { allocations: { none: {} }, companyId: lxId } });
  await prisma.vendorInvoice.deleteMany({ where: { id: { in: createdVi } } });
  await wipe();
  // put Lisboa Central's agreed commission back
  const cur = await prisma.commissionRule.findFirst({ where: { vendorCompanyId: lxId, validTo: null, categoryId: null } });
  if (oldRate && cur && cur.rate.toString() !== oldRate) {
    await prisma.commissionRule.update({ where: { id: cur.id }, data: { validTo: new Date() } });
    await prisma.commissionRule.create({ data: { vendorCompanyId: lxId, type: "PERCENT", rate: oldRate, validFrom: new Date() } });
  }
  await approvals(true);
  await prisma.$disconnect();
});

describe("supplier plans", () => {
  it("plans off: nothing limited, no subscription", async () => {
    expect(await P.subscriptionOf(lxId)).toBeNull();
    expect(await P.planAllows(lxId, "WAREHOUSE")).toBe(true);
    await expect(P.assertWithinLimit(lxId, "users", 1000)).resolves.toBeUndefined();
    await expect(P.savePlansSettings(await ctxFor(LX), { enabled: true })).rejects.toThrow();
  });

  it("switching on: free trial of the top plan for every supplier; the plan picked starts at the end", async () => {
    const sa = await ctxFor(SA);
    await expect(P.savePlansSettings(sa, { trialPlanCode: "NOPE" })).rejects.toThrow(/existing plan/);
    await P.savePlansSettings(sa, { enabled: true, trialDays: 30, billing: "PAYOUT" });
    const sub = await P.subscriptionOf(lxId);
    expect(sub).toMatchObject({ status: "TRIAL", plan: { code: "BUSINESS" } });
    expect(Math.round((sub!.trialEndsAt!.getTime() - Date.now()) / DAY)).toBe(30);
    expect(await P.planAllows(lxId, "WAREHOUSE")).toBe(true); // trial = everything
    expect(await P.subscriptionOf((await ctxFor(KEBAB)).company.id)).toBeNull(); // customers have no plan

    // FIRINGI sets Pro's commission: a second person must approve (when the rule is on)
    const plans = await P.listPlans();
    const pro = plans.find((p) => p.code === "PRO")!;
    const input = { ...pro, id: pro.id, monthlyPrice: 49, commissionPct: 9.5, earlyPayRate: Number(pro.earlyPayRate), earlyPayMinFee: Number(pro.earlyPayMinFee), description: pro.description } as P.PlanInput;
    await approvals(true);
    await expect(P.savePlan(sa, input)).rejects.toThrow(/approval/i);
    await approvals(false);
    await expect(P.savePlan(sa, { ...input, features: ["PLANNING"] })).rejects.toThrow(/Planning needs Inventory/);
    await P.savePlan(sa, input);

    // the supplier picks Pro during the trial → starts when the trial ends
    const lx = await ctxFor(LX);
    expect(await P.choosePlan(lx, pro.id)).toMatchObject({ when: "TRIAL_END" });
    await expect(P.choosePlan(await ctxFor(KEBAB), pro.id)).rejects.toThrow();
    await vendorInvoice(1000, 40); // FIRINGI owes Lisboa Central something → the plan invoice is settled against it
    const after = new Date(Date.now() + 31 * DAY);
    const r = await P.runPlansJob(after);
    expect(r.trialsEnded).toBeGreaterThanOrEqual(1);
    const now = await P.subscriptionOf(lxId);
    expect(now).toMatchObject({ status: "ACTIVE", plan: { code: "PRO" }, pendingPlanId: null });
    const inv = await prisma.planInvoice.findFirstOrThrow({ where: { companyId: lxId, kind: "PERIOD" } });
    expect(Number(inv.net)).toBe(49);
    expect(Number((await openAmounts([inv.invoiceId])).get(inv.invoiceId) ?? 0)).toBe(0); // settled against payouts
    const rule = await prisma.commissionRule.findFirstOrThrow({ where: { vendorCompanyId: lxId, validTo: null, categoryId: null } });
    expect(Number(rule.rate)).toBe(9.5);
  });

  it("features and limits follow the plan", async () => {
    expect(await P.planAllows(lxId, "WAREHOUSE")).toBe(false);
    expect(await P.planAllows(lxId, "INVENTORY")).toBe(true);
    expect(await companyFeatureOn(lxId, "ADS")).toBe(true); // Pro includes advertising
    expect(await P.planMissing(lxId)).toEqual(expect.arrayContaining(["WAREHOUSE", "INTEGRATIONS"]));
    const pro = (await P.listPlans()).find((p) => p.code === "PRO")!;
    const users = await prisma.membership.count({ where: { companyId: lxId, status: "ACTIVE" } });
    await prisma.supplierPlan.update({ where: { id: pro.id }, data: { maxUsers: users } });
    await expect(P.assertWithinLimit(lxId, "users")).rejects.toThrow(/allows/);
    await prisma.supplierPlan.update({ where: { id: pro.id }, data: { maxUsers: 10 } });
    await expect(P.assertWithinLimit(lxId, "users")).resolves.toBeUndefined();
  });

  it("upgrade now (difference invoiced), downgrade at the end of the period; FIRINGI's options", async () => {
    const lx = await ctxFor(LX);
    const plans = await P.listPlans();
    const business = plans.find((p) => p.code === "BUSINESS")!, free = plans.find((p) => p.code === "FREE")!;
    expect(await P.choosePlan(lx, business.id)).toMatchObject({ when: "NOW" });
    const up = await prisma.planInvoice.findFirstOrThrow({ where: { companyId: lxId, kind: "UPGRADE" } });
    expect(Number(up.net)).toBeGreaterThan(0);
    expect(Number(up.net)).toBeLessThanOrEqual(100); // 149 − 49 for the rest of the month
    expect(await P.planAllows(lxId, "WAREHOUSE")).toBe(true);

    expect(await P.choosePlan(lx, free.id)).toMatchObject({ when: "PERIOD_END" });
    expect((await P.subscriptionOf(lxId))!.plan.code).toBe("BUSINESS");
    const sub = await P.subscriptionOf(lxId);
    await P.runPlansJob(new Date(sub!.periodEnd!.getTime() + 1000));
    expect((await P.subscriptionOf(lxId))!.plan.code).toBe("FREE");
    expect(await prisma.planInvoice.count({ where: { companyId: lxId, planId: free.id } })).toBe(0); // free: no invoice

    const sa = await ctxFor(SA);
    await P.adminSetPlan(sa, lxId, business.id, true);
    expect((await P.subscriptionOf(lxId))!.plan.code).toBe("BUSINESS");
    await P.setSubscriptionOptions(sa, lxId, { commissionLocked: true, billing: "INVOICE" });
    await P.adminSetPlan(sa, lxId, plans.find((p) => p.code === "PRO")!.id, true);
    expect((await P.subscriptionOf(lxId))!.billing).toBe("INVOICE");
    await expect(P.setSubscriptionOptions(await ctxFor(LX), lxId, { earlyPayLimit: 1 })).rejects.toThrow();
    await P.adminSetPlan(sa, lxId, business.id, true);
    const ov = await P.plansOverview(sa);
    expect(ov.mrr).toBeGreaterThanOrEqual(149);
  });
});

describe("early payout", () => {
  it("quote: % per day early, minimum fee, free ones; limit; FIRINGI pays → invoice fully paid, fee invoiced", async () => {
    const business = (await P.listPlans()).find((p) => p.code === "BUSINESS")!;
    await prisma.supplierPlan.update({ where: { id: business.id }, data: { earlyPayModel: "PER_DAY", earlyPayRate: 0.03, earlyPayMinFee: 3, freeEarlyPays: 0 } });
    const lx = await ctxFor(LX);
    const vi = await vendorInvoice(1000, 30);
    const o = await E.earlyPayOptions(lxId);
    expect(o.available).toBe(true);
    const line = o.invoices.find((i) => i.id === vi.id)!;
    expect(line.days).toBe(30);
    expect(line.fee).toBe(9); // 1000 × 0.03 % × 30 days
    const q = await E.quoteEarlyPay(lx, [vi.id]);
    expect(q).toMatchObject({ amount: 1000, fee: 9, model: "PER_DAY" });

    await P.setSubscriptionOptions(await ctxFor(SA), lxId, { earlyPayLimit: 500 });
    await expect(E.requestEarlyPay(lx, [vi.id])).rejects.toThrow(/limit/);
    await P.setSubscriptionOptions(await ctxFor(SA), lxId, { earlyPayLimit: 50_000 });
    await expect(E.requestEarlyPay(await ctxFor(KEBAB), [vi.id])).rejects.toThrow();
    const req = await E.requestEarlyPay(lx, [vi.id]);
    expect(req.status).toBe("REQUESTED");
    expect((await E.earlyPayOptions(lxId)).invoices.some((i) => i.id === vi.id)).toBe(false); // not twice

    await expect(E.payEarlyPayout(lx, req.id)).rejects.toThrow();
    const paid = await E.payEarlyPayout(await ctxFor(SA), req.id, { reference: "TRF-123" });
    expect(Number(paid.feeGross)).toBeCloseTo(9 * 1.23, 2);
    expect(Number(paid.net)).toBeCloseTo(1000 - 9 * 1.23, 2);
    const allocated = await prisma.paymentAllocation.aggregate({ where: { vendorInvoiceId: vi.id, payment: { status: "CONFIRMED" } }, _sum: { amount: true } });
    expect(Number(allocated._sum.amount)).toBeCloseTo(1000, 2); // fully paid
    expect((await prisma.vendorInvoice.findUniqueOrThrow({ where: { id: vi.id } })).status).toBe("PAID");
    expect(Number((await openAmounts([paid.feeInvoiceId!])).get(paid.feeInvoiceId!) ?? 0)).toBe(0); // fee settled
    expect((await E.earlyPayOptions(lxId)).outstanding).toBeCloseTo(1000, 2); // counts until its normal date
  });

  it("minimum fee; free early payouts; too close to the due date; turned down; big ones need a second person", async () => {
    const lx = await ctxFor(LX), sa = await ctxFor(SA);
    const small = await vendorInvoice(100, 10);
    expect((await E.quoteEarlyPay(lx, [small.id])).fee).toBe(3); // 0.30 € → minimum 3 €
    const soon = await vendorInvoice(100, 1);
    await expect(E.quoteEarlyPay(lx, [soon.id])).rejects.toThrow(/3 days or more/);

    const business = (await P.listPlans()).find((p) => p.code === "BUSINESS")!;
    await prisma.supplierPlan.update({ where: { id: business.id }, data: { freeEarlyPays: 1 } });
    expect(await E.quoteEarlyPay(lx, [small.id])).toMatchObject({ fee: 0, model: "FREE" });
    const r = await E.requestEarlyPay(lx, [small.id]);
    await expect(E.rejectEarlyPayout(sa, r.id, "")).rejects.toThrow(/why/);
    await E.rejectEarlyPayout(sa, r.id, "Invoice under review");
    expect((await prisma.earlyPayout.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("REJECTED");

    // flat %
    await prisma.supplierPlan.update({ where: { id: business.id }, data: { earlyPayModel: "FLAT", earlyPayRate: 1.5, freeEarlyPays: 0, earlyPayMinFee: 0 } });
    expect((await E.quoteEarlyPay(lx, [small.id])).fee).toBe(1.5);

    // above the four-eyes threshold
    const big = await vendorInvoice(20000, 20);
    const bigReq = await E.requestEarlyPay(lx, [big.id]);
    await expect(E.payEarlyPayout(sa, bigReq.id)).rejects.toThrow(/approval/i);
    expect(await prisma.approvalRequest.count({ where: { kind: "EARLY_PAYOUT", status: "PENDING" } })).toBeGreaterThan(0);
    await prisma.approvalRequest.deleteMany({ where: { kind: "EARLY_PAYOUT" } });

    // switched off per supplier
    await P.setSubscriptionOptions(sa, lxId, { earlyPayEnabled: false });
    expect((await E.earlyPayOptions(lxId)).why).toBe("SUPPLIER_OFF");
    await expect(E.requestEarlyPay(lx, [small.id])).rejects.toThrow(/isn't available/);
    expect((await E.myEarlyPay(await ctxFor(IB))).invoices.some((i) => createdVi.includes(i.id))).toBe(false); // others see only theirs
  });
});

void Decimal;
