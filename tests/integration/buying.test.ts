/**
 * Phase 26: B2B buying.
 *  • Quotes: request from the cart (one per supplier, target price), supplier answers (sees its
 *    payout after commission), buyer never sees commission, accept → order at exactly the quoted
 *    prices, expiry, decline, access.
 *  • The buyer's approval rules: amount / category rules hold a purchaser's order (cart moves into
 *    the request), the manager approves (placed for the purchaser) or rejects with a reason, cancel
 *    puts the items back, managers' own orders go through, an accepted quote keeps its prices.
 *  • Recurring orders: schedule maths, the job places due orders once, skip, reminder once, a failed
 *    run is reported, set up by a purchaser → approved first, order now.
 *  • Order lists: from the cart / an order, shared or private, quantities, to the cart.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { prisma } from "@/server/db";
import { addToCart, clearCart } from "@/server/services/cart";
import { placeOrder } from "@/server/services/orders";
import { acceptQuote, adminQuotes, answerQuote, buyerQuote, buyerQuotes, declineQuote, expireQuotes, rejectQuote, requestQuotes, supplierQuote, supplierQuotes } from "@/server/buying/quotes";
import { cancelApproval, decideApproval, deleteRule, getApproval, listApprovals, matchRules, saveRule } from "@/server/buying/approvals";
import { createRecurring, firstRun, getRecurring, nextRun, orderRecurringNow, runRecurringOrders, setRecurringState, updateRecurring } from "@/server/buying/recurring";
import { createList, deleteList, getList, listToCart, myLists, setListItem } from "@/server/buying/lists";
import { ctxFor } from "../helpers";

const SA = "superadmin@firingi.test", KEBAB = "owner@kebabhouse.test", PURCHASER = "buyer@kebabhouse.test", LX = "owner@lisboacentral.test", ATL = "owner@atlantico.test";
const day = 86_400_000;
let mozz: string, cola: string, address: string;

async function cartWith(email: string, items: [string, number][]) {
  const c = await ctxFor(email);
  await clearCart(c);
  for (const [o, q] of items) await addToCart(c, o, q);
  return c;
}

beforeAll(async () => {
  const lx = await ctxFor(LX), kebab = await ctxFor(KEBAB);
  mozz = (await prisma.vendorOffer.findFirstOrThrow({ where: { vendorCompanyId: lx.company.id, vendorSku: "GRO-MOZZ2", packaging: { unitsPerPack: 1 } } })).id;
  cola = (await prisma.vendorOffer.findFirstOrThrow({ where: { vendorCompanyId: lx.company.id, vendorSku: "GRO-COLA33", packaging: { unitsPerPack: 24 } } })).id;
  address = (await prisma.address.findFirstOrThrow({ where: { companyId: kebab.company.id, kind: "DELIVERY", isActive: true }, orderBy: { isDefault: "desc" } })).id;
  await prisma.buyerApprovalRule.deleteMany({ where: { companyId: kebab.company.id } });
});
afterAll(async () => {
  const kebab = await ctxFor(KEBAB);
  await prisma.buyerApprovalRule.deleteMany({ where: { companyId: kebab.company.id } });
  for (const e of [KEBAB, PURCHASER]) await clearCart(await ctxFor(e)).catch(() => null);
});

describe("quotes", () => {
  it("buyer asks, supplier answers, buyer accepts → an order at exactly the quoted prices", async () => {
    const kebab = await cartWith(KEBAB, [[mozz, 20], [cola, 4]]);
    const lx = await ctxFor(LX), atl = await ctxFor(ATL);
    const [q] = await requestQuotes(kebab, { note: "Weekly volume", items: [{ offerId: mozz, qty: 20, targetUnitNet: 10 }, { offerId: cola, qty: 4 }] });
    expect(q.number).toMatch(/^QR-\d{4}-\d{6}$/);
    expect(await prisma.notification.count({ where: { type: "quote.requested", user: { email: LX } } })).toBeGreaterThan(0);
    expect((await supplierQuotes(lx)).map((x) => x.id)).toContain(q.id);
    await expect(supplierQuote(atl, q.id, "pt-PT")).rejects.toMatchObject({ code: "NOT_FOUND" });
    const sv = await supplierQuote(lx, q.id, "pt-PT");
    expect(sv.lines.find((l) => l.offerId === mozz)).toMatchObject({ qty: 20, targetUnitNet: "10" });

    await expect(answerQuote(lx, q.id, { lines: [{ lineId: sv.lines[0].id, unitNet: 10.5 }], validUntil: new Date(Date.now() + 7 * day) })).rejects.toThrow(/every product/);
    await expect(answerQuote(lx, q.id, { lines: sv.lines.map((l) => ({ lineId: l.id, unitNet: 10.5 })), validUntil: new Date(Date.now() + 200 * day) })).rejects.toThrow(/90 days/);
    const prices = new Map([[mozz, 10.5], [cola, 11.9]]);
    await answerQuote(lx, q.id, { lines: sv.lines.map((l) => ({ lineId: l.id, unitNet: prices.get(l.offerId)! })), validUntil: new Date(Date.now() + 7 * day), note: "Price for 20+" });
    const after = await supplierQuote(lx, q.id, "pt-PT");
    const gross = 20 * 10.5 + 4 * 11.9;
    expect(Number(after.payout)).toBeCloseTo(gross * (1 - Number(after.commissionRate) / 100), 1); // the supplier sees what it receives

    const bq = await buyerQuote(kebab, q.id, "pt-PT");
    expect(bq).toMatchObject({ status: "QUOTED", total: gross.toFixed(2), canAccept: true });
    expect(JSON.stringify(bq)).not.toMatch(/commission|payout/i); // never shown to the buyer
    expect(await prisma.notification.count({ where: { type: "quote.answered", user: { email: KEBAB } } })).toBeGreaterThan(0);

    const r = await acceptQuote(kebab, q.id, { deliveryAddressId: address });
    expect(r.orders).toHaveLength(1);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: r.orders[0].id }, include: { lines: { include: { discounts: true } } } });
    for (const l of order.lines) {
      expect(Number(l.unitSalePriceNet)).toBeCloseTo(prices.get(l.offerId)!, 4);
      expect(l.discounts).toHaveLength(0);
    }
    expect(Number(order.netTotal) - Number(order.deliveryFeeNet)).toBeCloseTo(gross, 2);
    expect(order.buyerNotes).toContain(q.number);
    expect((await buyerQuote(kebab, q.id, "pt-PT"))).toMatchObject({ status: "ACCEPTED", orderId: order.id });
    await expect(acceptQuote(kebab, q.id, { deliveryAddressId: address })).rejects.toThrow(/can't be accepted/);
    const admin = (await adminQuotes(await ctxFor(SA))).find((x) => x.id === q.id)!;
    expect(Number(admin.commission)).toBeGreaterThan(0);
    await expect(adminQuotes(kebab)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("expires after its date, can be declined or rejected", async () => {
    const kebab = await ctxFor(KEBAB), lx = await ctxFor(LX);
    const [a] = await requestQuotes(kebab, { items: [{ offerId: mozz, qty: 15 }] });
    const sv = await supplierQuote(lx, a.id, "pt-PT");
    await answerQuote(lx, a.id, { lines: sv.lines.map((l) => ({ lineId: l.id, unitNet: 11 })), validUntil: new Date() });
    await prisma.quoteRequest.update({ where: { id: a.id }, data: { validUntil: new Date(Date.now() - 2 * day) } });
    expect((await buyerQuotes(kebab)).find((x) => x.id === a.id)?.status).toBe("EXPIRED");
    await expect(acceptQuote(kebab, a.id, { deliveryAddressId: address })).rejects.toThrow(/expired/);
    expect(await expireQuotes()).toBeGreaterThan(0);
    expect((await prisma.quoteRequest.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("EXPIRED");

    const [b] = await requestQuotes(kebab, { items: [{ offerId: mozz, qty: 15 }] });
    await expect(declineQuote(lx, b.id, " ")).rejects.toThrow(/reason/);
    await declineQuote(lx, b.id, "Not at that volume");
    expect(await buyerQuote(kebab, b.id, "pt-PT")).toMatchObject({ status: "DECLINED", decisionNote: "Not at that volume" });

    const [c] = await requestQuotes(kebab, { items: [{ offerId: mozz, qty: 15 }] });
    await rejectQuote(kebab, c.id, "changed my mind");
    expect((await buyerQuote(kebab, c.id, "pt-PT")).status).toBe("CANCELLED"); // withdrawn before an answer
  });
});

describe("the buyer's approval rules", () => {
  it("matches amount and category rules", () => {
    const rules = [{ id: "1", name: "Big", minGross: new Decimal(100), categoryIds: [] }, { id: "2", name: "Dairy", minGross: null, categoryIds: ["dairy"] }];
    expect(matchRules(rules, 99, [["food"]])).toEqual([]);
    expect(matchRules(rules, 100, [["food"]])).toEqual(["Big"]);
    expect(matchRules(rules, 10, [["food", "dairy"]])).toEqual(["Dairy"]);
  });

  it("holds a purchaser's order for the manager, who approves or rejects it", async () => {
    const owner = await ctxFor(KEBAB);
    await expect(saveRule(await ctxFor(PURCHASER), { name: "x", minGross: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(saveRule(owner, { name: "Nothing" })).rejects.toThrow(/amount, categories/);
    const ruleId = await saveRule(owner, { name: "Over 100 €", minGross: 100 });

    // purchaser's big order → held; the cart moves into the request
    const p = await cartWith(PURCHASER, [[mozz, 12]]);
    const r = await placeOrder(p, { deliveryAddressId: address });
    expect(r.approval?.id).toBeTruthy();
    expect(r.orders).toEqual([]);
    expect(await prisma.cartItem.count({ where: { cart: { userId: p.user.id, buyerCompanyId: p.company.id } } })).toBe(0);
    expect(await prisma.notification.count({ where: { type: "buyer_approval.pending", user: { email: KEBAB } } })).toBeGreaterThan(0);
    expect((await listApprovals(p)).map((a) => a.id)).toContain(r.approval!.id);
    const view = await getApproval(owner, r.approval!.id, "pt-PT");
    expect(view).toMatchObject({ status: "PENDING", canDecide: true, reasons: ["Over 100 €"], requestedBy: "Bruno Compras" });
    await expect(decideApproval(p, r.approval!.id, true)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const { orders } = await decideApproval(owner, r.approval!.id, true);
    expect(orders).toHaveLength(1);
    const o = await prisma.order.findUniqueOrThrow({ where: { id: orders[0].id } });
    expect(o.placedByUserId).toBe(p.user.id); // placed for the purchaser
    await expect(decideApproval(owner, r.approval!.id, false, "late")).rejects.toThrow(/already decided/);
    expect(await prisma.notification.count({ where: { type: "buyer_approval.approved", userId: p.user.id } })).toBeGreaterThan(0);

    // small order → straight through; the manager's own big order → straight through
    const small = await placeOrder(await cartWith(PURCHASER, [[mozz, 5]]), { deliveryAddressId: address });
    expect(small.orders).toHaveLength(1);
    const own = await placeOrder(await cartWith(KEBAB, [[mozz, 12]]), { deliveryAddressId: address });
    expect(own.orders).toHaveLength(1);

    // category rule catches a small order; reject needs a reason; cancel puts it back in the cart
    const cat = (await prisma.vendorOffer.findUniqueOrThrow({ where: { id: mozz }, select: { packaging: { select: { variant: { select: { product: { select: { categoryId: true } } } } } } } })).packaging.variant.product.categoryId;
    const catRule = await saveRule(owner, { name: "Dairy", categoryIds: [cat] });
    const r2 = await placeOrder(await cartWith(PURCHASER, [[mozz, 5]]), { deliveryAddressId: address });
    expect(r2.approval?.id).toBeTruthy();
    await expect(decideApproval(owner, r2.approval!.id, false)).rejects.toThrow(/reason/);
    await decideApproval(owner, r2.approval!.id, false, "We have enough cheese");
    expect((await getApproval(p, r2.approval!.id, "pt-PT"))).toMatchObject({ status: "REJECTED", decisionNote: "We have enough cheese" });
    const r3 = await placeOrder(await cartWith(PURCHASER, [[mozz, 5]]), { deliveryAddressId: address });
    await cancelApproval(p, r3.approval!.id);
    expect((await prisma.cartItem.findMany({ where: { cart: { userId: p.user.id, buyerCompanyId: p.company.id } } })).map((i) => [i.offerId, i.qty])).toEqual([[mozz, 5]]);
    await deleteRule(owner, catRule);

    // an accepted quote that needs approval keeps the quoted prices
    const lx = await ctxFor(LX);
    const [q] = await requestQuotes(p, { items: [{ offerId: mozz, qty: 12 }] });
    const sv = await supplierQuote(lx, q.id, "pt-PT");
    await answerQuote(lx, q.id, { lines: sv.lines.map((l) => ({ lineId: l.id, unitNet: 9.99 })), validUntil: new Date(Date.now() + 3 * day) });
    const acc = await acceptQuote(p, q.id, { deliveryAddressId: address });
    expect(acc.approval?.id).toBeTruthy();
    expect((await buyerQuote(p, q.id, "pt-PT")).status).toBe("QUOTED");
    const done = await decideApproval(owner, acc.approval!.id, true);
    const line = await prisma.orderLine.findFirstOrThrow({ where: { orderId: done.orders[0].id } });
    expect(Number(line.unitSalePriceNet)).toBeCloseTo(9.99, 4);
    expect((await buyerQuote(p, q.id, "pt-PT")).status).toBe("ACCEPTED");
    await deleteRule(owner, ruleId);
  });
});

describe("recurring orders", () => {
  it("computes the schedule", () => {
    const wed = new Date(Date.UTC(2026, 10, 11, 10)); // Wednesday
    expect(firstRun({ frequency: "WEEKLY", weekday: 1 }, wed).toISOString()).toBe("2026-11-16T06:00:00.000Z");
    expect(firstRun({ frequency: "WEEKLY", weekday: 3 }, new Date(Date.UTC(2026, 10, 11, 5))).toISOString()).toBe("2026-11-11T06:00:00.000Z");
    expect(firstRun({ frequency: "MONTHLY", dayOfMonth: 5 }, wed).toISOString()).toBe("2026-12-05T06:00:00.000Z");
    expect(nextRun({ frequency: "BIWEEKLY", weekday: 1 }, new Date("2026-11-16T06:00:00Z")).toISOString()).toBe("2026-11-30T06:00:00.000Z");
    expect(nextRun({ frequency: "MONTHLY", dayOfMonth: 28 }, new Date("2026-12-28T06:00:00Z")).toISOString()).toBe("2027-01-28T06:00:00.000Z");
  });

  it("places due orders once, skips, reminds once, reports a failed run", async () => {
    const owner = await ctxFor(KEBAB);
    await expect(createRecurring(owner, { name: "x", frequency: "MONTHLY", dayOfMonth: 31, items: [{ offerId: mozz, qty: 5 }], deliveryAddressId: address })).rejects.toThrow(/1 and 28/);
    const { id, pendingApproval } = await createRecurring(owner, { name: "Weekly cheese", frequency: "WEEKLY", weekday: 1, items: [{ offerId: mozz, qty: 6 }], deliveryAddressId: address });
    expect(pendingApproval).toBe(false);
    const now = new Date();
    await prisma.recurringOrder.update({ where: { id }, data: { nextRunAt: new Date(now.getTime() - 60_000) } });
    const r1 = await runRecurringOrders(now);
    expect(r1.placed).toBeGreaterThanOrEqual(1);
    const after = await getRecurring(owner, id, "pt-PT");
    expect(after).toMatchObject({ lastResult: "PLACED", runs: 1 });
    expect(after.nextRunAt.getTime()).toBeGreaterThan(now.getTime());
    expect(after.lastOrders).toHaveLength(1);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: after.lastOrders[0].id } })).buyerNotes).toContain("Weekly cheese");
    const again = await runRecurringOrders(now);
    expect((await getRecurring(owner, id, "pt-PT")).runs).toBe(1); // not twice
    void again;

    // reminder the day before, once
    await prisma.recurringOrder.update({ where: { id }, data: { nextRunAt: new Date(now.getTime() + 12 * 3600_000), reminderSentFor: null } });
    const n0 = await prisma.notification.count({ where: { type: "recurring.reminder", userId: owner.user.id } });
    await runRecurringOrders(now);
    await runRecurringOrders(now);
    expect(await prisma.notification.count({ where: { type: "recurring.reminder", userId: owner.user.id } })).toBe(n0 + 1);

    // skip the next one
    await setRecurringState(owner, id, "SKIP_NEXT");
    await prisma.recurringOrder.update({ where: { id }, data: { nextRunAt: new Date(now.getTime() - 60_000) } });
    await runRecurringOrders(now);
    expect(await getRecurring(owner, id, "pt-PT")).toMatchObject({ lastResult: "SKIPPED", skipNext: false, runs: 1 });

    // a run that can't be placed is reported, the schedule goes on
    await updateRecurring(owner, id, { items: [{ offerId: mozz, qty: 900000 }] });
    await prisma.recurringOrder.update({ where: { id }, data: { nextRunAt: new Date(now.getTime() - 60_000) } });
    await runRecurringOrders(now);
    const failed = await getRecurring(owner, id, "pt-PT");
    expect(failed.lastResult).toBe("FAILED");
    expect(failed.lastError).toMatch(/available|stock|Minimum|credit/i);
    expect(failed.status).toBe("ACTIVE");
    expect(await prisma.notification.count({ where: { type: "recurring.failed", userId: owner.user.id } })).toBeGreaterThan(0);

    // order now, pause, end
    await updateRecurring(owner, id, { items: [{ offerId: mozz, qty: 6 }] });
    const now2 = await orderRecurringNow(owner, id);
    expect(now2.orders).toHaveLength(1);
    await setRecurringState(owner, id, "PAUSE");
    await prisma.recurringOrder.update({ where: { id }, data: { nextRunAt: new Date(now.getTime() - 60_000) } });
    const runsBefore = (await getRecurring(owner, id, "pt-PT")).runs;
    await runRecurringOrders(now);
    expect((await getRecurring(owner, id, "pt-PT")).runs).toBe(runsBefore); // paused: nothing
    await setRecurringState(owner, id, "END");
    await expect(setRecurringState(owner, id, "RESUME")).rejects.toThrow(/ended/);
  });

  it("set up by a purchaser and matching a rule → the manager approves it first", async () => {
    const owner = await ctxFor(KEBAB), p = await ctxFor(PURCHASER);
    const ruleId = await saveRule(owner, { name: "Over 50 €", minGross: 50 });
    const r = await createRecurring(p, { name: "Monthly stock-up", frequency: "MONTHLY", dayOfMonth: 1, items: [{ offerId: mozz, qty: 10 }], deliveryAddressId: address });
    expect(r.pendingApproval).toBe(true);
    const rec = await prisma.recurringOrder.findUniqueOrThrow({ where: { id: r.id } });
    expect(rec.status).toBe("PENDING_APPROVAL");
    await prisma.recurringOrder.update({ where: { id: r.id }, data: { nextRunAt: new Date(Date.now() - 60_000) } });
    await runRecurringOrders();
    expect((await prisma.recurringOrder.findUniqueOrThrow({ where: { id: r.id } })).runs).toBe(0);
    await decideApproval(owner, rec.approvalId!, true);
    expect((await prisma.recurringOrder.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("ACTIVE");
    await setRecurringState(owner, r.id, "END");
    await deleteRule(owner, ruleId);
  });
});

describe("order lists", () => {
  it("saves lists from the cart and from an order, shared or private, and fills the cart", async () => {
    const owner = await cartWith(KEBAB, [[mozz, 3], [cola, 2]]);
    const p = await ctxFor(PURCHASER);
    const shared = await createList(owner, { name: "Weekly kitchen", from: "CART" });
    const priv = await createList(owner, { name: "My private list", shared: false, items: [{ offerId: mozz, qty: 1 }] });
    expect((await myLists(p)).map((l) => l.id)).toContain(shared);
    expect((await myLists(p)).map((l) => l.id)).not.toContain(priv);
    await expect(getList(p, priv, "pt-PT")).rejects.toMatchObject({ code: "NOT_FOUND" });
    const l = await getList(owner, shared, "pt-PT");
    expect(l.lines.map((x) => [x.offerId, x.qty]).sort()).toEqual([[cola, 2], [mozz, 3]].sort());
    await setListItem(p, shared, mozz, 8); // a shared list: the team can change it
    await setListItem(p, shared, cola, 0);
    expect((await getList(owner, shared, "pt-PT")).lines.map((x) => [x.offerId, x.qty])).toEqual([[mozz, 8]]);
    await expect(deleteList(p, shared)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await clearCart(p);
    expect(await listToCart(p, shared)).toEqual({ added: 1, skipped: 0 });
    expect((await prisma.cartItem.findMany({ where: { cart: { userId: p.user.id, buyerCompanyId: p.company.id } } })).map((i) => i.qty)).toEqual([8]);
    const someOrder = await prisma.order.findFirstOrThrow({ where: { buyerCompanyId: owner.company.id }, orderBy: { placedAt: "desc" } });
    const fromOrder = await createList(owner, { name: "Like last time", from: "ORDER", orderId: someOrder.id });
    expect((await getList(owner, fromOrder, "pt-PT")).lines.length).toBeGreaterThan(0);
    await deleteList(owner, shared);
    await expect(createList(await ctxFor(LX), { name: "x" })).resolves.toBeTruthy(); // wholesalers buy too
    await expect(createList(await ctxFor(SA), { name: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
