/**
 * Phase 27: multi-site buyers and the optional accounting.
 *  • Shops (branches) under one company: a shop with its own address and category, staff assigned to
 *    a shop only order to / see orders and approvals of their shop; head office sees everything; the
 *    branch, its cost centre and the PO reference go on the order; a required PO reference.
 *  • Notifications about an order reach only the staff of its shop (and head office).
 *  • Budgets: block / needs approval / warn, categories, alerts once at 80 % / 100 %.
 *  • Reports: spend per shop, the price each shop paid for the same product.
 *  • Accounting (switched on per company by FIRINGI): daily close, expenses, monthly fixed expenses
 *    (added once, a deleted one isn't re-added), profit & loss with FIRINGI purchases / sales, VAT.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { prisma } from "@/server/db";
import { addToCart, clearCart } from "@/server/services/cart";
import { getOrder, listOrders, placeOrder } from "@/server/services/orders";
import { addShopAddress, branchScope, deleteBranch, getBranch, listBranches, saveBranch, setAddressBranch, setBranchActive, setBranchMember, setPoRequired } from "@/server/multisite/branches";
import { budgetAlertsAfterOrder, deleteBudget, evaluateBudgets, listBudgets, periodBounds, saveBudget, spentFor } from "@/server/multisite/budgets";
import { branchComparison, invoiceSummary, priceComparison } from "@/server/multisite/reports";
import { companiesWithFeatures, setCompanyFeature } from "@/server/accounting/features";
import { addEntry, dailySales, deleteEntry, listEntries, runRecurringExpenses, saveDailySales, saveRecurringExpense } from "@/server/accounting/entries";
import { accountingDashboard, periodOf, profitAndLoss } from "@/server/accounting/pnl";
import { notify } from "@/server/notify/dispatch";
import { ctxFor } from "../helpers";

const SA = "superadmin@firingi.test", KEBAB = "owner@kebabhouse.test", PURCHASER = "buyer@kebabhouse.test", LX = "owner@lisboacentral.test", ATL = "owner@atlantico.test";
const DAY = 86_400_000;
let mozz: string, cola: string, addrA: string, addrB: string, shopA: string, shopB: string, kebabId: string, purchaserMembership: string;

async function order(email: string, address: string, qty = 6, extra: Partial<Parameters<typeof placeOrder>[1]> = {}) {
  const c = await ctxFor(email);
  await clearCart(c);
  await addToCart(c, mozz, qty);
  return placeOrder(c, { deliveryAddressId: address, ...extra });
}

let savedApproval: unknown = null;
beforeAll(async () => {
  // these tests are about shops, not FIRINGI's address approval (tested in addresses.test.ts): approval off here
  savedApproval = (await prisma.setting.findFirst({ where: { key: "address.approval" } }))?.value ?? null;
  await prisma.setting.upsert({ where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key: "address.approval" } }, update: { value: { enabled: false } }, create: { scope: "GLOBAL", scopeId: "", key: "address.approval", value: { enabled: false } } });
  const lx = await ctxFor(LX), kebab = await ctxFor(KEBAB);
  kebabId = kebab.company.id;
  mozz = (await prisma.vendorOffer.findFirstOrThrow({ where: { vendorCompanyId: lx.company.id, vendorSku: "GRO-MOZZ2", packaging: { unitsPerPack: 1 } } })).id;
  cola = (await prisma.vendorOffer.findFirstOrThrow({ where: { vendorCompanyId: lx.company.id, vendorSku: "GRO-COLA33", packaging: { unitsPerPack: 24 } } })).id;
  addrA = (await prisma.address.findFirstOrThrow({ where: { companyId: kebabId, kind: "DELIVERY", isActive: true }, orderBy: { isDefault: "desc" } })).id;
  purchaserMembership = (await ctxFor(PURCHASER)).membership.id;
  await prisma.buyerApprovalRule.deleteMany({ where: { companyId: kebabId } });
});
afterAll(async () => {
  await prisma.setting.deleteMany({ where: { key: "address.approval" } });
  if (savedApproval) await prisma.setting.create({ data: { scope: "GLOBAL", scopeId: "", key: "address.approval", value: savedApproval as never } });
  await prisma.budget.deleteMany({ where: { companyId: kebabId } });
  await prisma.branchMember.deleteMany({ where: { branch: { companyId: kebabId } } });
  await prisma.address.updateMany({ where: { companyId: kebabId }, data: { branchId: null } });
  await prisma.company.update({ where: { id: kebabId }, data: { requirePoReference: false } });
  for (const e of [KEBAB, PURCHASER]) await clearCart(await ctxFor(e)).catch(() => null);
});

describe("shops (branches) under one company", () => {
  it("head office creates shops — one with its own new address and a category", async () => {
    const owner = await ctxFor(KEBAB);
    shopA = await saveBranch(owner, null, { name: "Baixa", code: "LX1", category: "kebab_pizza", costCentre: "CC-100" });
    await setAddressBranch(owner, addrA, shopA);
    shopB = await saveBranch(owner, null, {
      name: "Almada", code: "AL1", category: "restaurant", costCentre: "CC-200", managerMembershipId: purchaserMembership,
      address: { line1: "Rua Cândido dos Reis 12", postalCode: "2800-270", cityName: "Almada", countryCode: "PT", contactName: "Bruno" },
    });
    const b = await getBranch(owner, shopB);
    expect(b).toMatchObject({ name: "Almada", category: "restaurant", costCentre: "CC-200", manager: expect.any(String) });
    expect(b.addresses).toHaveLength(1);
    addrB = b.addresses[0].id;
    const addr = await prisma.address.findUniqueOrThrow({ where: { id: addrB } });
    expect(addr).toMatchObject({ companyId: kebabId, kind: "DELIVERY", branchId: shopB, label: "Almada" }); // same company, the shop's own address
    expect(b.members.map((m) => m.membershipId)).toContain(purchaserMembership); // the manager works at the shop
    await expect(saveBranch(owner, null, { name: "baixa" })).rejects.toThrow(/already have/);
    await expect(saveBranch(owner, null, { name: "X", category: "spaceship" })).rejects.toThrow(/category/);
    await expect(saveBranch(await ctxFor(PURCHASER), null, { name: "Mine" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(saveBranch(await ctxFor(LX), null, { name: "Not a buyer shop" })).resolves.toBeTruthy(); // a wholesaler buys too
    const lxShop = await prisma.branch.findFirstOrThrow({ where: { name: "Not a buyer shop" } });
    await deleteBranch(await ctxFor(LX), lxShop.id);
    await expect(saveBranch(await ctxFor(ATL), null, { name: "Distributor" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("staff assigned to a shop only order to / see that shop; head office sees all; branch, cost centre, PO go on the order", async () => {
    const purchaser = await ctxFor(PURCHASER);
    expect(await branchScope(purchaser)).toEqual([shopB]);
    expect(await branchScope(await ctxFor(KEBAB))).toBeNull();
    await expect(order(PURCHASER, addrA)).rejects.toThrow(/delivery addresses/);
    const pb = await order(PURCHASER, addrB, 6, { poReference: "PO-7781" });
    const ob = await prisma.order.findUniqueOrThrow({ where: { id: pb.orders[0].id } });
    expect(ob).toMatchObject({ branchId: shopB, costCentre: "CC-200", poReference: "PO-7781" });
    const pa = await order(KEBAB, addrA);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: pa.orders[0].id } })).branchId).toBe(shopA);

    const mine = (await listOrders(await ctxFor(PURCHASER), "BUYER", { pageSize: 500 })).rows.map((o) => o.id);
    expect(mine).toContain(pb.orders[0].id);
    expect(mine).not.toContain(pa.orders[0].id);
    await expect(getOrder(await ctxFor(PURCHASER), pa.orders[0].id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const all = (await listOrders(await ctxFor(KEBAB), "BUYER", { pageSize: 500 })).rows.map((o) => o.id);
    expect(all).toEqual(expect.arrayContaining([pa.orders[0].id, pb.orders[0].id]));

    // notifications about an order reach that shop's staff (and head office), not the other shop's
    const before = await prisma.notification.count({ where: { user: { email: PURCHASER }, type: "order.confirmed" } });
    await notify("order.confirmed", [{ companyId: kebabId }], { number: "X", supplier: "Y" }, { ref: { type: "Order", id: pa.orders[0].id } });
    expect(await prisma.notification.count({ where: { user: { email: PURCHASER }, type: "order.confirmed" } })).toBe(before);
    await notify("order.confirmed", [{ companyId: kebabId }], { number: "X", supplier: "Y" }, { ref: { type: "Order", id: pb.orders[0].id } });
    expect(await prisma.notification.count({ where: { user: { email: PURCHASER }, type: "order.confirmed" } })).toBe(before + 1);

    // a required PO reference
    await setPoRequired(await ctxFor(KEBAB), true);
    await expect(order(PURCHASER, addrB)).rejects.toMatchObject({ code: "PO_REQUIRED" });
    await setPoRequired(await ctxFor(KEBAB), false);

    // a deactivated shop can't be ordered to
    await setBranchActive(await ctxFor(KEBAB), shopB, false);
    await expect(order(KEBAB, addrB)).rejects.toThrow(/delivery addresses/);
    await setBranchActive(await ctxFor(KEBAB), shopB, true);
    await expect(deleteBranch(await ctxFor(KEBAB), shopB)).rejects.toMatchObject({ code: "BRANCH_IN_USE" });
    expect((await listBranches(await ctxFor(PURCHASER))).map((b) => b.id)).toEqual([shopB]);
  });
});

describe("budgets", () => {
  it("periods: months, weeks from Monday", () => {
    expect(periodBounds("MONTHLY", new Date("2026-11-17T10:00:00Z")).start.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    const w = periodBounds("WEEKLY", new Date("2026-11-15T10:00:00Z")); // a Sunday
    expect(w.start.toISOString()).toBe("2026-11-09T00:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-11-16T00:00:00.000Z");
  });

  it("block / approval / warn, alerts once, categories", async () => {
    const owner = await ctxFor(KEBAB);
    const spent = await spentFor({ id: "x", companyId: kebabId, branchId: shopB, name: "x", period: "MONTHLY", amount: new Decimal(1), categoryIds: [], action: "WARN" });
    expect(spent.toNumber()).toBeGreaterThan(0); // the order above

    const block = await saveBudget(owner, null, { name: "Almada cap", branchId: shopB, period: "MONTHLY", amount: spent.toNumber() + 10, categoryIds: [], action: "BLOCK" });
    await expect(order(PURCHASER, addrB)).rejects.toMatchObject({ code: "BUDGET_EXCEEDED" });
    await expect(order(KEBAB, addrB)).rejects.toMatchObject({ code: "BUDGET_EXCEEDED" }); // a block applies to everyone
    await expect(order(KEBAB, addrA)).resolves.toBeTruthy(); // another shop's budget doesn't matter

    await saveBudget(owner, block, { name: "Almada cap", branchId: shopB, period: "MONTHLY", amount: spent.toNumber() + 10, categoryIds: [], action: "APPROVAL" });
    const held = await order(PURCHASER, addrB);
    expect(held.approval?.id).toBeTruthy();
    const ap = await prisma.buyerApproval.findUniqueOrThrow({ where: { id: held.approval!.id } });
    expect((ap.reasons as string[]).join()).toMatch(/Budget: Almada cap/);
    await prisma.buyerApproval.update({ where: { id: ap.id }, data: { status: "CANCELLED" } });
    const managerOrder = await order(KEBAB, addrB); // people who may approve go through
    expect(managerOrder.approval).toBeUndefined();

    await saveBudget(owner, block, { name: "Almada cap", branchId: shopB, period: "MONTHLY", amount: 10, categoryIds: [], action: "WARN" });
    await prisma.budgetAlert.deleteMany({ where: { budgetId: block } });
    const n0 = await prisma.notification.count({ where: { type: "budget.threshold" } });
    const m0 = await prisma.notification.count({ where: { type: "budget.threshold", user: { email: PURCHASER } } });
    await budgetAlertsAfterOrder(kebabId, shopB);
    await budgetAlertsAfterOrder(kebabId, shopB);
    expect(await prisma.budgetAlert.count({ where: { budgetId: block, level: 100 } })).toBe(1);
    expect(await prisma.notification.count({ where: { type: "budget.threshold" } })).toBeGreaterThan(n0);
    expect(await prisma.notification.count({ where: { type: "budget.threshold", user: { email: PURCHASER } } })).toBe(m0 + 1); // the shop manager, once

    // a category budget counts only those products
    const dairy = await prisma.vendorOffer.findUniqueOrThrow({ where: { id: mozz }, select: { packaging: { select: { variant: { select: { product: { select: { categoryId: true } } } } } } } });
    const cat = dairy.packaging.variant.product.categoryId;
    const catBudget = await saveBudget(owner, null, { name: "Dairy", branchId: null, period: "WEEKLY", amount: 100000, categoryIds: [cat], action: "WARN" });
    const checks = await evaluateBudgets(kebabId, shopB, [{ gross: 50, categoryIds: [cat] }, { gross: 70, categoryIds: ["other"] }]);
    expect(checks.find((c) => c.id === catBudget)!.adding).toBe("50.00");
    const listed = await listBudgets(owner);
    expect(listed.find((b) => b.id === catBudget)!.spent).not.toBe("0.00");
    await deleteBudget(owner, catBudget);
    await deleteBudget(owner, block);
  });
});

describe("branch reports", () => {
  it("spend per shop and the price each shop paid", async () => {
    const owner = await ctxFor(KEBAB);
    const from = new Date(Date.now() - DAY), to = new Date(Date.now() + DAY);
    const cmp = await branchComparison(owner, from, to, "pt-PT");
    const a = cmp.rows.find((r) => r.id === shopA)!, b = cmp.rows.find((r) => r.id === shopB)!;
    expect(a.orders).toBeGreaterThan(0);
    expect(b.orders).toBeGreaterThan(0);
    expect(b.top[0].name).toMatch(/Mozzarella/i);
    const prices = await priceComparison(owner, from, to, "pt-PT");
    const p = prices.find((x) => x.offerId === mozz)!;
    expect(p.prices.map((x) => x.branch).sort()).toEqual(["Almada", "Baixa"]);
    const scoped = await branchComparison(await ctxFor(PURCHASER), from, to, "pt-PT");
    expect(scoped.rows.map((r) => r.id)).toEqual([shopB]);
    const inv = await invoiceSummary(owner, new Date());
    expect(inv.total.count).toBe(inv.invoices.length);
  });
});

describe("accounting (optional, per company)", () => {
  it("is off until FIRINGI switches it on", async () => {
    const owner = await ctxFor(KEBAB);
    await prisma.companyFeature.deleteMany({ where: { companyId: kebabId } });
    await expect(listEntries(owner, { from: new Date(), to: new Date() })).rejects.toMatchObject({ code: "FEATURE_OFF" });
    await expect(setCompanyFeature(owner, kebabId, "ACCOUNTING", true)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const sa = await ctxFor(SA);
    await setCompanyFeature(sa, kebabId, "ACCOUNTING", true);
    expect((await companiesWithFeatures(sa)).find((c) => c.id === kebabId)!.accounting).toBe(true);
    await expect(listEntries(owner, { from: new Date(), to: new Date() })).resolves.toBeTruthy();
    await expect(listEntries(await ctxFor(PURCHASER), { from: new Date(), to: new Date() })).rejects.toMatchObject({ code: "FORBIDDEN" }); // no accounting permission
  });

  it("daily close, expenses, P&L with FIRINGI purchases, VAT", async () => {
    const owner = await ctxFor(KEBAB);
    const today = new Date();
    const { from, to } = periodOf("DAY", today);
    await prisma.accountingEntry.deleteMany({ where: { companyId: kebabId } });
    await saveDailySales(owner, { date: today, branchId: shopA, cash: 300, card: 500, deliveryApps: 0, vatRate: 13 });
    await saveDailySales(owner, { date: today, branchId: shopA, cash: 400, card: 500, deliveryApps: 113, vatRate: 13 }); // saved again: replaces
    expect(await dailySales(owner, today, shopA)).toMatchObject({ cash: 400, card: 500, deliveryApps: 113, other: 0, vatRate: 13 });
    await addEntry(owner, { category: "ELECTRICITY", date: today, amount: 123, vatRate: 23, branchId: shopA, payee: "EDP" });
    await addEntry(owner, { category: "SALARIES", date: today, amount: 1000, branchId: null });
    await expect(addEntry(owner, { category: "RENT", date: new Date(Date.now() + 5 * DAY), amount: 10 })).rejects.toThrow(/future/);
    await expect(addEntry(owner, { category: "RENT", date: today, amount: -5 })).rejects.toThrow(/above 0/);

    const pl = await profitAndLoss(owner, { from, to, basis: "GROSS" });
    expect(pl.sales.total).toBe("1013.00");
    const inv = await prisma.invoice.findMany({ where: { recipientCompanyId: kebabId, status: { not: "DRAFT" }, issuedAt: { gte: from, lt: new Date(to.getTime() + DAY) } } });
    const firingi = inv.reduce((a, i) => a.plus(new Decimal(i.grossTotal.toString()).mul(i.docType === "CREDIT_NOTE" ? -1 : 1)), new Decimal(0));
    expect(pl.purchases.total).toBe(firingi.toFixed(2));
    expect(pl.expenses.total).toBe("1123.00");
    expect(pl.netProfit).toBe(new Decimal(1013).minus(firingi).minus(1123).toFixed(2));
    const net = await profitAndLoss(owner, { from, to, basis: "NET" });
    expect(net.sales.total).toBe("896.46"); // 1013 / 1.13
    expect(net.expenses.total).toBe("1100.00"); // 123 / 1.23 + 1000 (no VAT)
    expect(Number(net.vat.onSales)).toBeCloseTo(116.54, 2);

    const shopOnly = await profitAndLoss(owner, { from, to, branch: shopA });
    expect(shopOnly.expenses.total).toBe("123.00"); // the salary is head office's
    const dash = await accountingDashboard(owner);
    expect(dash.today.sales).toBe("1013.00");
    expect(dash.branches.find((b) => b.id === shopA)!.sales).toBe("1013.00");
  });

  it("fixed monthly expenses are added on their day once; a deleted one isn't added again", async () => {
    const owner = await ctxFor(KEBAB);
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1));
    const id = await saveRecurringExpense(owner, null, { category: "RENT", amount: 1500, dayOfMonth: 1, startsOn: start, branchId: shopA, payee: "Landlord" });
    const rows = await prisma.accountingEntry.findMany({ where: { recurringId: id }, orderBy: { date: "asc" } });
    expect(rows).toHaveLength(3);
    expect((await runRecurringExpenses()).added).toBe(0);
    await deleteEntry(owner, rows[0].id);
    await runRecurringExpenses();
    expect(await prisma.accountingEntry.count({ where: { recurringId: id } })).toBe(2);
    const listed = await listEntries(owner, { from: start, to: now, kind: "EXPENSE" });
    expect(listed.filter((e) => e.recurring)).toHaveLength(2);
  });

  it("a supplier's P&L includes its sales through FIRINGI", async () => {
    const sa = await ctxFor(SA), lx = await ctxFor(LX);
    await setCompanyFeature(sa, lx.company.id, "ACCOUNTING", true);
    const st = await prisma.vendorBillingStatement.findFirst({ where: { vendorCompanyId: lx.company.id }, orderBy: { createdAt: "desc" } });
    if (st) {
      const d = periodOf("DAY", st.createdAt);
      const pl = await profitAndLoss(lx, { ...d });
      expect(pl.sales.lines.find((l) => l.key === "FIRINGI_SALES")).toBeTruthy();
    }
    await expect(addEntry(lx, { category: "RENT", date: new Date(), amount: 10, branchId: shopA })).rejects.toBeTruthy(); // not its shop
    await setCompanyFeature(sa, lx.company.id, "ACCOUNTING", false);
    await expect(profitAndLoss(lx, periodOf("DAY", new Date()))).rejects.toMatchObject({ code: "FEATURE_OFF" });
  });
});
